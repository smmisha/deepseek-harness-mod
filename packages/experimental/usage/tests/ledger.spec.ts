/** Usage ledger: incremental reads, fork prefixes, cold Sessions, persistence, slots, and rolling windows. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SLOT_MS, UsageLedger, WINDOW_MS, type LedgerSource } from '../src/ledger.ts'

const HOUR = 60 * 60_000
const NOW = Date.UTC(2026, 10, 19, 12, 0)
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function ledgerFile(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'usage-ledger-'))
  roots.push(root)
  return join(root, 'nested', 'ledger.json')
}

const id = (value: string): SessionId => value as SessionId
const context = (provider: string, model: string): SessionEvent => ({ seq: 0, time: 0, type: 'request/context', data: { provider, model } } as SessionEvent)
const call = (turn: number, time: number, input: number, output = 0): SessionEvent => ({
  seq: 0, time, type: 'assistant/attempt',
  data: { turn, step: 1, stream: [{ type: 'chunk', time: 0, chunk: { type: 'usage', usage: { inputTokens: input, outputTokens: output } } }] },
} as SessionEvent)

/** A source whose Sessions a test grows and toggles. */
function source(logs: Record<string, { live: boolean; inherited?: number; events: SessionEvent[] }>) {
  const reads = vi.fn<(sessionId: SessionId) => void>()
  const value: LedgerSource = {
    listSessions: () => Promise.resolve(Object.entries(logs).map(([key, log]) => ({ id: id(key), live: log.live }))),
    readSession: (sessionId) => {
      reads(sessionId)
      const log = logs[sessionId]
      if (log === undefined) return Promise.reject(new Error('gone'))
      return Promise.resolve({ inheritedEventCount: log.inherited ?? 0, events: log.events })
    },
  }
  return { value, reads }
}

describe('UsageLedger', () => {
  it('reads every Session once, folds only new events, and skips a cold Session it already read', async () => {
    const logs = {
      live: { live: true, events: [context('opencode-go', 'hy4'), call(1, NOW - HOUR, 100, 10)] },
      cold: { live: false, events: [context('deepseek-official', 'chat'), call(1, NOW - 2 * HOUR, 50)] },
    }
    const { value, reads } = source(logs)
    const warn = vi.fn()
    const ledger = new UsageLedger(value, await ledgerFile(), { warn }, () => NOW)
    await Promise.all([ledger.refresh(), ledger.refresh()])
    expect(reads.mock.calls.map(([sessionId]) => sessionId)).toEqual(['live', 'cold'])
    logs.live.events.push(call(2, NOW - 10 * 60_000, 30))
    await ledger.refresh()
    expect(reads.mock.calls.map(([sessionId]) => sessionId)).toEqual(['live', 'cold', 'live'])
    const view = ledger.view(0)
    expect(view.scannedAt).toBe(NOW)
    expect(view.windows).toEqual([
      { provider: 'deepseek-official', fiveHours: 50, week: 50, month: 50 },
      { provider: 'opencode-go', fiveHours: 140, week: 140, month: 140 },
    ])
    expect(view.rows.map(row => [row.provider, row.calls, row.input])).toEqual([['deepseek-official', 1, 50], ['opencode-go', 1, 100], ['opencode-go', 1, 30]])
    expect(warn).not.toHaveBeenCalled()
  })

  it('primes a fork with its inherited prefix without counting the parent calls', async () => {
    const { value } = source({
      fork: { live: false, inherited: 2, events: [context('groq', 'llama'), call(1, NOW - HOUR, 999), call(2, NOW - HOUR, 5)] },
    })
    const ledger = new UsageLedger(value, await ledgerFile(), { warn: vi.fn() }, () => NOW)
    await ledger.refresh()
    expect(ledger.view(0).rows).toMatchObject([{ provider: 'groq', model: 'llama', input: 5, calls: 1 }])
  })

  it('sums calls per quarter hour and model, bounds rows by the requested start, and ages calls out of each window', async () => {
    const slot = Math.floor((NOW - HOUR) / SLOT_MS) * SLOT_MS
    const { value } = source({
      a: { live: false, events: [
        context('p', 'm1'), call(1, slot + 1_000, 10), call(2, slot + 2_000, 20),
        context('p', 'm0'), call(3, slot + 3_000, 5),
        call(4, NOW - WINDOW_MS.fiveHours - 1, 7), call(5, NOW - WINDOW_MS.week - 1, 9), call(6, NOW - WINDOW_MS.month - 1, 11),
      ] },
      b: { live: false, events: [context('o', 'm1'), call(1, slot + 4_000, 1)] },
    })
    const ledger = new UsageLedger(value, await ledgerFile(), { warn: vi.fn() }, () => NOW)
    await ledger.refresh()
    const view = ledger.view(NOW - 2 * HOUR)
    expect(view.rows.map(row => [row.slot === slot, row.provider, row.model, row.input, row.calls])).toEqual([
      [true, 'o', 'm1', 1, 1], [true, 'p', 'm0', 5, 1], [true, 'p', 'm1', 30, 2],
    ])
    expect(view.windows.find(window => window.provider === 'p')).toEqual({ provider: 'p', fiveHours: 35, week: 42, month: 51 })
  })

  it('persists the ledger, reloads it, keeps a deleted Session, and reports an unreadable one', async () => {
    const file = await ledgerFile()
    const logs: Record<string, { live: boolean; events: SessionEvent[] }> = { a: { live: false, events: [context('p', 'm'), call(1, NOW - HOUR, 10)] } }
    const first = source(logs)
    await new UsageLedger(first.value, file, { warn: vi.fn() }, () => NOW).refresh()
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ version: 1, sessions: { a: { cold: true } } })
    delete logs.a
    const second = source(logs)
    const warn = vi.fn()
    const reloaded = new UsageLedger({
      listSessions: () => Promise.resolve([{ id: id('missing'), live: true }]),
      readSession: sessionId => second.value.readSession(sessionId),
    }, file, { warn }, () => NOW)
    await reloaded.refresh()
    expect(reloaded.view(0).rows).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith('usage: could not read Session missing (gone)')
    const failing = new UsageLedger({
      listSessions: () => Promise.resolve([{ id: id('x'), live: true }]),
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the non-Error rejection IS the scenario under test
      readSession: () => Promise.reject('offline'),
    }, file, { warn }, () => NOW)
    await failing.refresh()
    expect(warn).toHaveBeenLastCalledWith('usage: could not read Session x (offline)')
  })

  it('starts over from a missing, unparsable, or foreign ledger file', async () => {
    for (const content of [undefined, '{', JSON.stringify({ version: 0, sessions: {} }), JSON.stringify({ version: 1 }), 'null']) {
      const file = await ledgerFile()
      if (content !== undefined) {
        await writeFile(join(file, '..', '..', 'seed'), '')
        await new UsageLedger(source({}).value, file, { warn: vi.fn() }).refresh()
        await writeFile(file, content)
      }
      const ledger = new UsageLedger(source({}).value, file, { warn: vi.fn() })
      await ledger.refresh()
      expect(ledger.view(0)).toMatchObject({ rows: [], windows: [] })
    }
  })
})
