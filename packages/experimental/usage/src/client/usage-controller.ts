/**
 * Usage page state: the ledger view and the DeepSeek balance read through the
 * Host Remote, the token budgets read and written through the settings form,
 * day rows in the viewer's time zone, and one warning per newly crossed
 * budget threshold.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { UsageBalance, UsageBudget, UsageLimit, UsageSlotRow, UsageView, UsageWindow } from '../types.ts'

/** The `usage` settings section as the page reads it. */
export interface UsageSettings {
  /** Budgets keyed by provider route id. */
  readonly limits?: Readonly<Record<string, UsageBudget>>
}

/** The Host Remote the page calls. */
export interface UsageRemote {
  view(since: number): Promise<RemoteResult<UsageView>>
  balance(): Promise<RemoteResult<UsageBalance>>
}

/** Periods the statistics table can cover, in days. */
export const PERIODS = [7, 30] as const
/** One statistics period. */
export type UsagePeriod = typeof PERIODS[number]

/** Windows in the order the page lists them. */
export const WINDOWS: readonly UsageWindow[] = ['fiveHours', 'week', 'month']

/** Share of a budget at which the page starts warning. */
export const NEAR_SHARE = 0.8

/** How often an open app re-reads usage to check the budgets. */
export const CHECK_INTERVAL_MS = 5 * 60_000

/** What the page shows. */
export interface UsagePageState {
  readonly status: 'loading' | 'ready' | 'failed'
  readonly period: UsagePeriod
  readonly view?: UsageView | undefined
  readonly balance?: UsageBalance | undefined
  readonly failure?: string | undefined
}

/** One day of one model, summed from quarter-hour rows. */
export interface UsageDayRow {
  /** Local calendar day, `YYYY-MM-DD`. */
  readonly day: string
  readonly provider: string
  readonly model: string
  readonly input: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly output: number
  readonly calls: number
}

/** A budget threshold crossed since the page last warned. */
export interface UsageNotice {
  readonly seq: number
  readonly provider: string
  readonly window: UsageWindow
  readonly level: 'near' | 'over'
}

const pad = (value: number): string => String(value).padStart(2, '0')

/**
 * One budget without its unset windows, so the settings document stays minimal.
 * @param provider - provider route id.
 * @param windows - window amounts, any of them unset.
 * @returns the budget.
 */
function budget(provider: string, windows: Partial<Record<UsageWindow, number | undefined>>): UsageLimit {
  return {
    provider,
    ...windows.fiveHours === undefined ? {} : { fiveHours: windows.fiveHours },
    ...windows.week === undefined ? {} : { week: windows.week },
    ...windows.month === undefined ? {} : { month: windows.month },
  }
}

/**
 * The local calendar day of one instant.
 * @param time - epoch milliseconds.
 * @returns `YYYY-MM-DD` in the viewer's time zone.
 */
export function localDay(time: number): string {
  const date = new Date(time)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Sum quarter-hour rows into local days per model, newest day first.
 * @param rows - ledger rows.
 * @returns day rows.
 */
export function dayRows(rows: readonly UsageSlotRow[]): UsageDayRow[] {
  const days = new Map<string, UsageDayRow>()
  for (const row of rows) {
    const day = localDay(row.slot)
    const id = `${day}\n${row.provider}\n${row.model}`
    const current = days.get(id)
      ?? { day, provider: row.provider, model: row.model, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0 }
    days.set(id, {
      ...current,
      input: current.input + row.input,
      cacheRead: current.cacheRead + row.cacheRead,
      cacheWrite: current.cacheWrite + row.cacheWrite,
      output: current.output + row.output,
      calls: current.calls + row.calls,
    })
  }
  return [...days.values()].sort((left, right) => right.day.localeCompare(left.day)
    || left.provider.localeCompare(right.provider) || left.model.localeCompare(right.model))
}

/**
 * Keep only well-formed budgets; the settings wire may carry anything.
 * @param value - the configured `limits`, keyed by provider route id.
 * @returns budgets with a provider and at least one positive integer window.
 */
export function budgetsOf(value: unknown): UsageLimit[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  const budgets: UsageLimit[] = []
  for (const [provider, item] of Object.entries(value)) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const amountOf = (window: UsageWindow): number | undefined => {
      const amount = record[window]
      return typeof amount === 'number' && Number.isSafeInteger(amount) && amount > 0 ? amount : undefined
    }
    const limit = budget(provider, { fiveHours: amountOf('fiveHours'), week: amountOf('week'), month: amountOf('month') })
    if (WINDOWS.some(window => limit[window] !== undefined)) budgets.push(limit)
  }
  return budgets
}

/**
 * The settings document form of the budgets.
 * @param limits - budgets with their provider.
 * @returns the budgets keyed by provider route id.
 */
export function limitsDocument(limits: readonly UsageLimit[]): Record<string, UsageBudget> {
  return Object.fromEntries(limits.map(({ provider, ...windows }) => [provider, windows]))
}

/** Page controller shared by the Settings section and the warning toast. */
export class UsageController {
  /** Page state. */
  readonly page = createSnapshotStore<UsagePageState>({ status: 'loading', period: 7 })
  /** Configured budgets. */
  readonly limits = createSnapshotStore<readonly UsageLimit[]>([])
  /** The newest threshold warning, or null. */
  readonly notice = createSnapshotStore<UsageNotice | null>(null)
  private readonly warned = new Set<string>()
  private seq = 0
  private readonly unsubscribe: () => void

  /**
   * @param remote - the `usage` Remote.
   * @param form - the `usage` settings section.
   * @param now - clock, injectable for tests.
   */
  constructor(
    private readonly remote: UsageRemote,
    private readonly form: ConfigForm<UsageSettings>,
    private readonly now: () => number = Date.now,
  ) {
    const adopt = (): void => { this.limits.set(budgetsOf(form.getSnapshot().value?.limits)) }
    this.unsubscribe = form.subscribe(() => {
      adopt()
      this.check()
    })
    adopt()
  }

  /** Release the settings subscription. */
  dispose(): void { this.unsubscribe() }

  /** Re-read the ledger and the balance for the current period. */
  async refresh(): Promise<void> {
    const { period } = this.page.getSnapshot()
    const start = new Date(this.now())
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - (period - 1))
    const fail = (failure: string): void => { this.page.set({ ...this.page.getSnapshot(), status: 'failed', failure }) }
    let view: RemoteResult<UsageView>
    let balance: RemoteResult<UsageBalance>
    try {
      [view, balance] = await Promise.all([this.remote.view(start.getTime()), this.remote.balance()])
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
      return
    }
    if (!view.ok) {
      fail(view.error.message)
      return
    }
    this.page.set({ status: 'ready', period, view: view.value, balance: balance.ok ? balance.value : { status: 'failed', reason: balance.error.message } })
    this.check()
  }

  /**
   * Switch the statistics period and re-read.
   * @param period - days the table covers.
   * @returns the refresh.
   */
  setPeriod(period: UsagePeriod): Promise<void> {
    this.page.set({ ...this.page.getSnapshot(), period })
    return this.refresh()
  }

  /**
   * Set or clear one budget and write the budgets through the settings form.
   * @param provider - provider route id.
   * @param window - rolling window.
   * @param amount - token budget, or undefined to remove it.
   */
  setLimit(provider: string, window: UsageWindow, amount: number | undefined): void {
    const current = this.limits.getSnapshot()
    const existing = current.find(limit => limit.provider === provider)
    const next = budget(provider, { fiveHours: existing?.fiveHours, week: existing?.week, month: existing?.month, [window]: amount })
    const kept = WINDOWS.some(name => next[name] !== undefined)
    const others = current.filter(limit => limit.provider !== provider)
    const limits = kept ? [...others, next] : others
    this.limits.set(limits)
    // A refused write reloads the form, which re-adopts; a failed transport keeps what the form holds.
    this.form.set('limits', limitsDocument(limits)).catch(() => { this.limits.set(budgetsOf(this.form.getSnapshot().value?.limits)) })
  }

  /** Clear the shown warning. */
  dismissNotice(): void { this.notice.set(null) }

  /** Warn once for each budget threshold newly reached in the latest view. */
  private check(): void {
    const view = this.page.getSnapshot().view
    if (view === undefined) return
    for (const limit of this.limits.getSnapshot()) {
      const used = view.windows.find(window => window.provider === limit.provider)
      for (const window of WINDOWS) {
        const budget = limit[window]
        if (budget === undefined) continue
        const spent = used?.[window] ?? 0
        const level = spent >= budget ? 'over' : spent >= budget * NEAR_SHARE ? 'near' : undefined
        const key = `${limit.provider}\n${window}`
        if (level === undefined) {
          this.warned.delete(`${key}\nnear`)
          this.warned.delete(`${key}\nover`)
          continue
        }
        if (this.warned.has(`${key}\n${level}`)) continue
        this.warned.add(`${key}\n${level}`)
        this.seq += 1
        this.notice.set({ seq: this.seq, provider: limit.provider, window, level })
      }
    }
  }
}
