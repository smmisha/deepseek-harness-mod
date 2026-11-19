/** Usage page controller: day rows, budget parsing, reads through the Remote, budget writes, and threshold notices. */
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import type { UsageBalance, UsageSlotRow, UsageView } from '../src/types.ts'
import { UsageController, budgetsOf, dayRows, localDay, type UsageRemote, type UsageSettings } from '../src/client/usage-controller.ts'

const NOW = new Date(2026, 10, 19, 12, 0).getTime()
const BALANCE: UsageBalance = { status: 'available', sufficient: true, entries: [{ currency: 'CNY', total: '10.00', granted: '1.00', toppedUp: '9.00' }] }

function row(overrides: Partial<UsageSlotRow> = {}): UsageSlotRow {
  return { slot: NOW, provider: 'deepseek', model: 'deepseek-chat', input: 1, cacheRead: 2, cacheWrite: 0, output: 3, calls: 1, ...overrides }
}

function view(windows: UsageView['windows'] = [], rows: readonly UsageSlotRow[] = []): UsageView {
  return { rows, windows, scannedAt: NOW }
}

function fixture(initial: UsageSettings | undefined = { limits: {} }) {
  const form = stubConfigForm<UsageSettings>()
  form.publish({ status: 'ready', value: initial, writable: true })
  const remote = {
    view: vi.fn<UsageRemote['view']>(() => Promise.resolve({ ok: true, value: view() })),
    balance: vi.fn<UsageRemote['balance']>(() => Promise.resolve({ ok: true, value: BALANCE })),
  }
  const controller = new UsageController(remote, form.scope, () => NOW)
  return { form, remote, controller }
}

const failure = <T>(message: string): RemoteResult<T> => ({ ok: false, error: new RemoteError('gateway/internal', message, {}) })

describe('day rows and budgets', () => {
  it('sums quarter hours into local days per model, newest first', () => {
    const yesterday = NOW - 24 * 3_600_000
    expect(dayRows([
      row(), row({ slot: NOW + 900_000, cacheWrite: 4, calls: 2 }),
      row({ slot: yesterday }), row({ model: 'deepseek-reasoner' }), row({ provider: 'anthropic', model: 'z' }),
    ])).toEqual([
      { day: localDay(NOW), provider: 'anthropic', model: 'z', input: 1, cacheRead: 2, cacheWrite: 0, output: 3, calls: 1 },
      { day: localDay(NOW), provider: 'deepseek', model: 'deepseek-chat', input: 2, cacheRead: 4, cacheWrite: 4, output: 6, calls: 3 },
      { day: localDay(NOW), provider: 'deepseek', model: 'deepseek-reasoner', input: 1, cacheRead: 2, cacheWrite: 0, output: 3, calls: 1 },
      { day: localDay(yesterday), provider: 'deepseek', model: 'deepseek-chat', input: 1, cacheRead: 2, cacheWrite: 0, output: 3, calls: 1 },
    ])
    expect(localDay(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05')
  })

  it('keeps only well-formed budgets from the settings wire', () => {
    expect(budgetsOf(undefined)).toEqual([])
    expect(budgetsOf([{ provider: 'a', week: 5 }])).toEqual([])
    expect(budgetsOf({ x: null, y: 'z', a: { fiveHours: 0, week: 1.5, month: 100 }, b: { fiveHours: 5 }, c: {} }))
      .toEqual([{ provider: 'a', month: 100 }, { provider: 'b', fiveHours: 5 }])
  })
})

describe('UsageController', () => {
  it('reads usage from the start of the period in local days', async () => {
    const f = fixture()
    await f.controller.refresh()
    expect(f.remote.view).toHaveBeenCalledWith(new Date(2026, 10, 13).getTime())
    expect(f.controller.page.getSnapshot()).toEqual({ status: 'ready', period: 7, view: view(), balance: BALANCE })
    await f.controller.setPeriod(30)
    expect(f.remote.view).toHaveBeenLastCalledWith(new Date(2026, 9, 21).getTime())
    expect(f.controller.page.getSnapshot().period).toBe(30)
  })

  it('shows a failed balance in place and reports failed reads', async () => {
    const f = fixture()
    f.remote.balance.mockResolvedValueOnce(failure('no route'))
    await f.controller.refresh()
    expect(f.controller.page.getSnapshot().balance).toEqual({ status: 'failed', reason: 'no route' })
    f.remote.view.mockResolvedValueOnce(failure('ledger busy'))
    await f.controller.refresh()
    expect(f.controller.page.getSnapshot()).toMatchObject({ status: 'failed', failure: 'ledger busy', view: view() })
    f.remote.view.mockRejectedValueOnce(new Error('socket closed'))
    await f.controller.refresh()
    expect(f.controller.page.getSnapshot().failure).toBe('socket closed')
    f.remote.view.mockRejectedValueOnce('offline')
    await f.controller.refresh()
    expect(f.controller.page.getSnapshot().failure).toBe('offline')
  })

  it('writes budgets through the settings form and drops a provider with none left', async () => {
    const f = fixture({ limits: { openai: { week: 5 } } })
    expect(f.controller.limits.getSnapshot()).toEqual([{ provider: 'openai', week: 5 }])
    f.controller.setLimit('deepseek', 'fiveHours', 100)
    f.controller.setLimit('deepseek', 'month', 900)
    expect(f.controller.limits.getSnapshot()).toEqual([{ provider: 'openai', week: 5 }, { provider: 'deepseek', fiveHours: 100, month: 900 }])
    expect(f.form.set).toHaveBeenLastCalledWith('limits', { openai: { week: 5 }, deepseek: { fiveHours: 100, month: 900 } })
    f.controller.setLimit('openai', 'week', undefined)
    expect(f.controller.limits.getSnapshot()).toEqual([{ provider: 'deepseek', fiveHours: 100, month: 900 }])
    f.form.set.mockRejectedValueOnce(new Error('Host gone'))
    f.controller.setLimit('deepseek', 'week', 1)
    await vi.waitFor(() => { expect(f.controller.limits.getSnapshot()).toEqual([{ provider: 'openai', week: 5 }]) })
    f.form.publish({ value: undefined })
    expect(f.controller.limits.getSnapshot()).toEqual([])
  })

  it('warns once per newly crossed threshold and again after usage falls back', async () => {
    const f = fixture({ limits: { deepseek: { fiveHours: 100 }, idle: { month: 10 } } })
    f.form.publish({ value: { limits: { deepseek: { fiveHours: 100 }, idle: { month: 10 } } } })
    expect(f.controller.notice.getSnapshot()).toBeNull()
    const spend = (fiveHours: number) => { f.remote.view.mockResolvedValueOnce({ ok: true, value: view([{ provider: 'deepseek', fiveHours, week: fiveHours, month: fiveHours }]) }) }
    spend(50)
    await f.controller.refresh()
    expect(f.controller.notice.getSnapshot()).toBeNull()
    spend(80)
    await f.controller.refresh()
    expect(f.controller.notice.getSnapshot()).toEqual({ seq: 1, provider: 'deepseek', window: 'fiveHours', level: 'near' })
    spend(90)
    await f.controller.refresh()
    expect(f.controller.notice.getSnapshot()?.seq).toBe(1)
    spend(100)
    await f.controller.refresh()
    expect(f.controller.notice.getSnapshot()).toEqual({ seq: 2, provider: 'deepseek', window: 'fiveHours', level: 'over' })
    f.controller.dismissNotice()
    expect(f.controller.notice.getSnapshot()).toBeNull()
    spend(10)
    await f.controller.refresh()
    spend(85)
    await f.controller.refresh()
    expect(f.controller.notice.getSnapshot()).toMatchObject({ seq: 3, level: 'near' })
    f.form.publish({ value: { limits: { deepseek: { fiveHours: 50 } } } })
    expect(f.controller.notice.getSnapshot()).toMatchObject({ seq: 4, level: 'over' })
    f.controller.dispose()
    expect(f.form.listenerCount()).toBe(0)
  })
})
