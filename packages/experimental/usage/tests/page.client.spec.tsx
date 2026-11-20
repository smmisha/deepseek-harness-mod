// @vitest-environment jsdom
/** Usage section: the Settings entry and notice with their Remote lifetime, the section body, and the notice. */
import { Context, Service } from '@deepseek-ai/cordis'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { bindSnapshotSelector, makeTranslate, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UsageBalance, UsageView } from '../src/types.ts'
import { CHECK_INTERVAL_MS, UsageController, type UsageRemote, type UsageSettings } from '../src/client/usage-controller.ts'
import { UsagePage, UsageToast, parseBudget, type UsagePageInjected, type UsagePageProps, type UsageToastInjected } from '../src/client/UsagePage.tsx'
import { inject, mountUsage } from '../src/client/mount.ts'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en)
const n = (value: number): string => value.toLocaleString()
const contribution: TypertRemoteContribution = { package: '@deepseek-ai/dsh-usage', descriptors: [] }
const NOW = new Date(2026, 10, 19, 12, 0).getTime()
const VIEW: UsageView = {
  rows: [
    { slot: NOW, provider: 'deepseek', model: 'deepseek-chat', input: 1000, cacheRead: 200, cacheWrite: 5, output: 300, calls: 2 },
    { slot: NOW, provider: 'deepseek', model: 'deepseek-reasoner', input: 10, cacheRead: 0, cacheWrite: 0, output: 20, calls: 1 },
  ],
  windows: [{ provider: 'deepseek', fiveHours: 900, week: 1200, month: 1500 }],
  scannedAt: NOW,
}
const LOW: UsageBalance = { status: 'available', sufficient: false, entries: [{ currency: 'CNY', total: '0.50', granted: '0.00', toppedUp: '0.50' }] }

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function remoteOf(value: UsageView = VIEW, balance: UsageBalance = LOW) {
  return {
    view: vi.fn<UsageRemote['view']>(() => Promise.resolve({ ok: true, value })),
    balance: vi.fn<UsageRemote['balance']>(() => Promise.resolve({ ok: true, value: balance })),
  }
}

function setup(options: { view?: UsageView; balance?: UsageBalance; limits?: UsageSettings['limits']; writable?: boolean } = {}) {
  const form = stubConfigForm<UsageSettings>()
  form.publish({ status: 'ready', value: { limits: options.limits ?? {} }, writable: options.writable ?? true })
  const remote = remoteOf(options.view, options.balance)
  const controller = new UsageController(remote, form.scope, () => NOW)
  const refresh = vi.fn(() => controller.refresh())
  const setLimit = vi.fn((provider: string, window: Parameters<UsagePageInjected['setLimit']>[1], amount: number | undefined) => {
    controller.setLimit(provider, window, amount)
  })
  const props = {
    close: vi.fn(),
    t,
    useUsagePage: bindSnapshotSelector(controller.page),
    useUsageLimits: bindSnapshotSelector(controller.limits),
    useUsageSettings: bindSnapshotSelector(form.scope),
    refresh,
    setPeriod: period => controller.setPeriod(period),
    setLimit,
  } as UsagePageProps
  return { form, remote, controller, props, refresh, setLimit }
}

describe('parseBudget', () => {
  it('reads positive integers and an empty field', () => {
    expect(parseBudget('')).toBeUndefined()
    expect(parseBudget(' 1 000,000 ')).toBe(1_000_000)
    expect(parseBudget('0')).toBeNull()
    expect(parseBudget('1e3')).toBeNull()
    expect(parseBudget('99999999999999999999')).toBeNull()
  })
})

describe('UsagePage', () => {
  it('shows the balance, every provider budget, and the day table', async () => {
    const s = setup({ limits: { deepseek: { fiveHours: 1000, week: 1000 }, openai: { month: 10 } } })
    render(<UsagePage {...s.props} />)
    expect(screen.getByRole('status').textContent).toBe(en.loading)
    expect(await screen.findByText('0.50 CNY')).toBeDefined()
    expect(screen.getByText(en.balanceLow)).toBeDefined()
    expect(screen.getByText('granted 0.00 · topped up 0.50')).toBeDefined()
    expect(screen.getByText(/^Session logs read at /u)).toBeDefined()
    expect(screen.getByText('openai')).toBeDefined()
    const bars = screen.getAllByRole('progressbar')
    expect(bars.map(bar => bar.getAttribute('aria-valuenow'))).toEqual(['90', '100', '0', '0', '0', '0'])
    expect(screen.getByText(`900 of ${n(1000)}`)).toBeDefined()
    expect(screen.getByText(`${n(1200)} of ${n(1000)}`)).toBeDefined()
    expect(screen.getByText(n(1500))).toBeDefined()
    expect(screen.getByText('0 of 10')).toBeDefined()
    expect(screen.getByRole('columnheader', { name: en.cacheWrite })).toBeDefined()
    const total = screen.getByRole('rowheader', { name: en.total }).parentElement!
    expect([...total.querySelectorAll('td')].map(cell => cell.textContent)).toEqual([n(1010), '200', '5', '320', '3'])
    expect(screen.queryByText(en.readOnly)).toBeNull()
  })

  it('writes a budget on Enter or blur, clears an emptied one, and restores invalid or escaped input', async () => {
    const s = setup({ limits: { deepseek: { week: 2000 } } })
    render(<UsagePage {...s.props} />)
    const field = (window: string) => screen.getByRole<HTMLInputElement>('textbox', { name: `deepseek budget for ${window}` })
    await screen.findByText('0.50 CNY')
    fireEvent.change(field(en.fiveHours), { target: { value: '2,000' } })
    fireEvent.keyDown(field(en.fiveHours), { key: 'Enter' })
    expect(s.setLimit).toHaveBeenLastCalledWith('deepseek', 'fiveHours', 2000)
    await waitFor(() => { expect(field(en.fiveHours).value).toBe('2000') })
    fireEvent.blur(field(en.fiveHours))
    expect(s.setLimit).toHaveBeenCalledTimes(1)
    fireEvent.change(field(en.week), { target: { value: 'lots' } })
    fireEvent.blur(field(en.week))
    expect(field(en.week).value).toBe('2000')
    fireEvent.change(field(en.week), { target: { value: '5' } })
    fireEvent.keyDown(field(en.week), { key: 'Escape' })
    expect(field(en.week).value).toBe('2000')
    fireEvent.keyDown(field(en.week), { key: 'a' })
    fireEvent.change(field(en.week), { target: { value: '' } })
    fireEvent.blur(field(en.week))
    expect(s.setLimit).toHaveBeenLastCalledWith('deepseek', 'week', undefined)
    expect(s.form.set).toHaveBeenLastCalledWith('limits', { deepseek: { fiveHours: 2000 } })
  })

  it('switches the period and re-reads on Refresh', async () => {
    const s = setup({ balance: { ...LOW, sufficient: true } })
    render(<UsagePage {...s.props} />)
    await screen.findByText('0.50 CNY')
    expect(screen.queryByText(en.balanceLow)).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: en.days30 }))
    await waitFor(() => { expect(s.remote.view).toHaveBeenLastCalledWith(new Date(2026, 9, 21).getTime()) })
    fireEvent.click(screen.getByRole('tab', { name: en.days7 }))
    await waitFor(() => { expect(s.remote.view).toHaveBeenLastCalledWith(new Date(2026, 10, 13).getTime()) })
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    await waitFor(() => { expect(s.refresh).toHaveBeenCalledTimes(2) })
  })

  it('says when nothing was spent, and when budgets are read-only', async () => {
    const s = setup({ view: { rows: [], windows: [], scannedAt: NOW }, balance: { status: 'unconfigured' }, writable: false })
    render(<UsagePage {...s.props} />)
    expect(await screen.findByText(en.balanceUnconfigured)).toBeDefined()
    expect(screen.getByText(en.limitsEmpty)).toBeDefined()
    expect(screen.getByText(en.statsEmpty)).toBeDefined()
    expect(screen.getByText(en.readOnly)).toBeDefined()
  })

  it('reports a failed read without hiding the last view', async () => {
    const s = setup({ balance: { status: 'failed', reason: 'unauthorized' } })
    s.remote.view.mockRejectedValueOnce(new Error('socket closed'))
    render(<UsagePage {...s.props} />)
    expect((await screen.findByRole('alert')).textContent).toBe('Could not read usage: socket closed')
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    expect(await screen.findByText('Could not read the balance: unauthorized')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('columnheader', { name: en.cacheWrite })).toBeDefined()
    act(() => { s.controller.page.set({ status: 'ready', period: 7, view: { ...VIEW, rows: [VIEW.rows[1]!] } }) })
    expect(screen.queryByRole('region', { name: en.balanceTitle })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: en.cacheWrite })).toBeNull()
  })
})

describe('UsageToast', () => {
  it('shows the newest notice and nothing without one', () => {
    const form = stubConfigForm<UsageSettings>()
    const controller = new UsageController(remoteOf(), form.scope)
    const dismiss = vi.fn()
    const toastProps = { t, useUsageNotice: bindSnapshotSelector(controller.notice), dismiss }
    const { container } = render(<UsageToast {...toastProps} />)
    expect(container.textContent).toBe('')
    act(() => { controller.notice.set({ seq: 1, provider: 'deepseek', window: 'week', level: 'near' }) })
    expect(screen.getByText('deepseek has spent 80% of its token budget for 7 days.')).toBeDefined()
    act(() => { controller.notice.set({ seq: 2, provider: 'deepseek', window: 'fiveHours', level: 'over' }) })
    expect(screen.getByText('deepseek has spent its whole token budget for 5 hours.')).toBeDefined()
  })
})

/** Read the section face a registration injects, checking its shape instead of asserting it. */
function pageFace(value: Record<string, unknown> | undefined): UsagePageInjected {
  const { hooks, refresh, setPeriod, setLimit } = value ?? {}
  if (typeof refresh !== 'function' || typeof setPeriod !== 'function' || typeof setLimit !== 'function' || typeof hooks !== 'object') {
    throw new Error('not the usage section face')
  }
  return {
    hooks: hooks as UsagePageInjected['hooks'],
    refresh: refresh as UsagePageInjected['refresh'],
    setPeriod: setPeriod as UsagePageInjected['setPeriod'],
    setLimit: setLimit as UsagePageInjected['setLimit'],
  }
}

/** Read the notice face a registration injects. */
function toastFace(value: Record<string, unknown> | undefined): UsageToastInjected {
  if (typeof value?.dismiss !== 'function' || typeof value.hooks !== 'object') throw new Error('not the usage notice face')
  return { hooks: value.hooks as UsageToastInjected['hooks'], dismiss: value.dismiss as UsageToastInjected['dismiss'] }
}

async function fixture(fail = false) {
  const ctx = new Context()
  const unmount = vi.fn(async () => {})
  class Remote extends Service {
    constructor() { super(ctx, 'remote') }
    async $mount(received: TypertRemoteContribution) {
      expect(received).toBe(contribution)
      const owned = this.ctx.effect(() => unmount)
      return () => owned()
    }
  }
  new Remote()
  const remote = remoteOf()
  const form = stubConfigForm<UsageSettings>()
  form.publish({ status: 'ready', value: { limits: {} }, writable: true })
  const get = vi.fn(() => form.scope)
  ctx.provide('remote.usage', remote)
  ctx.provide('configForms', { get })
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry)
  ctx.slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' }, 'shell.overlay': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  if (fail) vi.spyOn(ctx.slots, 'inject').mockImplementationOnce(() => { throw new Error('slot unavailable') })
  return { ctx, unmount, remote, form, get }
}

describe('mountUsage', () => {
  it('lists the section and the notice, re-reads periodically, and withdraws everything together', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const f = await fixture()
    const fiber = f.ctx.plugin({ inject: [...inject], apply: ctx => mountUsage(ctx, contribution) })
    await fiber.await()
    expect(f.get).toHaveBeenCalledWith('usage')
    await vi.waitFor(() => { expect(f.remote.view).toHaveBeenCalledTimes(1) })
    vi.advanceTimersByTime(CHECK_INTERVAL_MS)
    await vi.waitFor(() => { expect(f.remote.view).toHaveBeenCalledTimes(2) })
    const section = f.ctx.slots.entries('settings.section').find(e => e.options.id === 'usage')
    expect(section?.options.order).toBe(30)
    expect((section?.options.label as () => string)()).toBe(en.nav)
    const face = pageFace(section?.inject?.())
    await face.refresh()
    await face.setPeriod(30)
    expect(f.remote.view).toHaveBeenCalledTimes(4)
    face.setLimit('deepseek', 'week', 10)
    expect(f.form.set).toHaveBeenCalledWith('limits', { deepseek: { week: 10 } })
    const overlay = f.ctx.slots.entries('shell.overlay').find(e => e.options.id === 'usage.notice')
    const toast = toastFace(overlay?.inject?.())
    toast.dismiss()
    await fiber.dispose()
    expect(f.ctx.slots.entries('settings.section')).toEqual([])
    expect(f.ctx.slots.entries('shell.overlay')).toEqual([])
    expect(f.unmount).toHaveBeenCalledTimes(1)
    expect(f.form.listenerCount()).toBe(0)
    vi.advanceTimersByTime(CHECK_INTERVAL_MS)
    expect(f.remote.view).toHaveBeenCalledTimes(4)
  })

  it('releases the Remote when the section cannot register', async () => {
    const f = await fixture(true)
    await expect(mountUsage(f.ctx, contribution)).rejects.toThrow('slot unavailable')
    expect(f.unmount).toHaveBeenCalledTimes(1)
  })
})
