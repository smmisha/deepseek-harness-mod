/**
 * Usage ledger: every billed call of every Session, kept per Session with the
 * fold state to resume from, and summed into quarter-hour rows on request.
 *
 * A Session is read in full through the Session query service and folded from
 * where the previous read stopped; a fork's inherited prefix only primes the
 * provider and model, because its calls belong to the parent. A Session that
 * was read while not live is not read again until it is live: a cold log only
 * grows once a Session is resumed. Calls of a deleted Session stay counted,
 * because the tokens were spent. The ledger is derived data; deleting its file
 * only makes the next refresh read every log again.
 */
import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { foldUsage, totalTokens, type UsageCall, type UsageFoldState } from './fold.ts'
import type { UsageSlotRow, UsageView, UsageWindow, UsageWindowTotals } from './types.ts'

/** Calls are summed per quarter hour, which every time zone offset divides. */
export const SLOT_MS = 15 * 60_000

/** Rolling window lengths in milliseconds. */
export const WINDOW_MS: Readonly<Record<UsageWindow, number>> = {
  fiveHours: 5 * 60 * 60_000,
  week: 7 * 24 * 60 * 60_000,
  month: 30 * 24 * 60 * 60_000,
}

/** Ledger file format version; any other version is read as empty. */
const LEDGER_VERSION = 1

/** One listed Session as the ledger needs it. */
export interface LedgerSessionRecord {
  readonly id: SessionId
  readonly live: boolean
}

/** The Session reads the ledger depends on. */
export interface LedgerSource {
  /** Every live and persisted Session. */
  listSessions(): Promise<readonly LedgerSessionRecord[]>
  /** One Session's complete raw log and its fork-inherited prefix length. */
  readSession(id: SessionId): Promise<{ readonly inheritedEventCount: number; readonly events: readonly SessionEvent[] }>
}

/** What the ledger keeps for one Session. */
interface SessionEntry {
  /** Events already folded, counted from the start of the log. */
  through: number
  /** Fold state after those events. */
  state: UsageFoldState
  /** Whether the last read saw the Session not live. */
  cold: boolean
  /** Calls by attempt key. */
  calls: Record<string, UsageCall>
}

interface LedgerFile {
  readonly version: number
  readonly sessions: Record<string, SessionEntry>
}

/** Narrow a parsed ledger document; anything else starts an empty ledger. */
function isLedgerFile(value: unknown): value is LedgerFile {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { version?: unknown; sessions?: unknown }
  return candidate.version === LEDGER_VERSION && typeof candidate.sessions === 'object' && candidate.sessions !== null
}

/** Diagnostic sink for per-Session read failures. */
export interface LedgerLogger {
  warn(message: string): void
}

/** Derived per-Session call store with incremental refresh. */
export class UsageLedger {
  private sessions: Record<string, SessionEntry> = {}
  private loaded = false
  private running: Promise<void> | undefined
  private scannedAt = 0

  /**
   * @param source - Session list and log reads.
   * @param file - ledger file path.
   * @param logger - diagnostics for Sessions that cannot be read.
   * @param now - clock, injectable for tests.
   */
  constructor(
    private readonly source: LedgerSource,
    private readonly file: string,
    private readonly logger: LedgerLogger,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Read new events of every changed Session and persist the ledger. Concurrent
   * callers share one refresh.
   */
  refresh(): Promise<void> {
    this.running ??= this.scan().finally(() => { this.running = undefined })
    return this.running
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      if (isLedgerFile(parsed)) this.sessions = { ...parsed.sessions }
    } catch {
      // A missing or unreadable ledger is rebuilt from the Session logs.
    }
  }

  private async scan(): Promise<void> {
    await this.load()
    for (const record of await this.source.listSessions()) {
      const entry = this.sessions[record.id]
      if (entry?.cold === true && !record.live) continue
      try {
        await this.read(record, entry)
      } catch (error) {
        this.logger.warn(`usage: could not read Session ${record.id} (${error instanceof Error ? error.message : String(error)})`)
      }
    }
    this.scannedAt = this.now()
    await writeFileAtomic(this.file, JSON.stringify({ version: LEDGER_VERSION, sessions: this.sessions }), { mode: 0o600, dirMode: 0o700 })
  }

  private async read(record: LedgerSessionRecord, previous: SessionEntry | undefined): Promise<void> {
    const log = await this.source.readSession(record.id)
    const start = previous ?? {
      through: log.inheritedEventCount,
      state: foldUsage(log.events.slice(0, log.inheritedEventCount)).state,
      cold: false,
      calls: {},
    }
    const folded = foldUsage(log.events.slice(start.through), start.state)
    const calls = { ...start.calls }
    for (const call of folded.calls) calls[call.key] = call
    this.sessions[record.id] = { through: Math.max(start.through, log.events.length), state: folded.state, cold: !record.live, calls }
  }

  /**
   * Sum the calls into quarter-hour rows and rolling-window totals.
   * @param since - earliest call time the rows include, in epoch milliseconds.
   * @returns the page view.
   */
  view(since: number): UsageView {
    const now = this.now()
    const rows = new Map<string, UsageSlotRow>()
    const windows = new Map<string, { fiveHours: number; week: number; month: number }>()
    for (const entry of Object.values(this.sessions)) {
      for (const call of Object.values(entry.calls)) {
        const totals = windows.get(call.provider) ?? { fiveHours: 0, week: 0, month: 0 }
        const tokens = totalTokens(call)
        for (const window of ['fiveHours', 'week', 'month'] as const) {
          if (now - call.time < WINDOW_MS[window]) totals[window] += tokens
        }
        windows.set(call.provider, totals)
        if (call.time < since) continue
        const slot = Math.floor(call.time / SLOT_MS) * SLOT_MS
        const id = `${slot}\n${call.provider}\n${call.model}`
        const row = rows.get(id)
          ?? { slot, provider: call.provider, model: call.model, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0 }
        rows.set(id, {
          ...row,
          input: row.input + call.input,
          cacheRead: row.cacheRead + call.cacheRead,
          cacheWrite: row.cacheWrite + call.cacheWrite,
          output: row.output + call.output,
          calls: row.calls + 1,
        })
      }
    }
    const windowRows: UsageWindowTotals[] = [...windows].map(([provider, totals]) => ({ provider, ...totals }))
    return {
      rows: [...rows.values()].sort((left, right) => left.slot - right.slot
        || left.provider.localeCompare(right.provider) || left.model.localeCompare(right.model)),
      windows: windowRows.sort((left, right) => left.provider.localeCompare(right.provider)),
      scannedAt: this.scannedAt,
    }
  }
}
