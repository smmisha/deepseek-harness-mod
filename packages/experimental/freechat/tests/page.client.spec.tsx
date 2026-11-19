// @vitest-environment jsdom
/** Free web chat card: the Plugins page entry, its Host Remote lifetime, and the page body. */
import { Context, Service } from '@deepseek-ai/cordis'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { RemoteError, type RemoteResult, type TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FreeChatPage, type FreeChatPageInjected, type FreeChatPageProps, type FreeChatPageState } from '../src/client/FreeChatPage.tsx'
import { inject, mountFreeChat } from '../src/client/mount.ts'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en)
const contribution: TypertRemoteContribution = { package: '@deepseek-ai/dsh-freechat', descriptors: [] }
const STATE: FreeChatPageState = {
  models: [{ id: 'free-chat', name: 'Free', contextWindow: 128000, maxOutputTokens: 8192 }],
  threads: [
    { id: 'thread-a', generation: 2, turns: 3, updatedAt: '2026-11-19T10:20:30.000Z', live: true },
    { id: 'thread-b', generation: 1, turns: 0, live: false },
  ],
}

afterEach(cleanup)

/** Read the page face a registration injects, checking its shape instead of asserting it. */
function pageFace(value: Record<string, unknown> | undefined): FreeChatPageInjected {
  const load = value?.load
  const reset = value?.reset
  if (typeof load !== 'function' || typeof reset !== 'function') throw new Error('not the free web chat page face')
  return { load: load as FreeChatPageInjected['load'], reset: reset as FreeChatPageInjected['reset'] }
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
  const state = vi.fn<() => Promise<RemoteResult<FreeChatPageState>>>().mockResolvedValue({ ok: true, value: STATE })
  const resetThread = vi.fn<() => Promise<RemoteResult<{ closedSession: boolean }>>>()
    .mockResolvedValue({ ok: true, value: { closedSession: true } })
  ctx.provide('remote.freechatAdmin', { state, resetThread })
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry)
  ctx.slots.register({ name: 'root', children: { 'plugins.item': { kind: 'list', scope: 'root' } } } as never, () => null)
  if (fail) vi.spyOn(ctx.slots, 'inject').mockImplementationOnce(() => { throw new Error('slot unavailable') })
  return { ctx, unmount, state, resetThread }
}

describe('mountFreeChat', () => {
  it('lists the card on the Plugins page through the Host Remote and withdraws both together', async () => {
    const f = await fixture()
    const fiber = f.ctx.plugin({ inject: [...inject], apply: ctx => mountFreeChat(ctx, contribution) })
    await fiber.await()
    const entry = f.ctx.slots.entries('plugins.item').find(e => e.options.id === 'freechat')
    expect(entry?.options.order).toBe(60)
    expect((entry?.options.label as () => string)()).toBe(en.title)
    const face = pageFace(entry?.inject?.())
    expect(await face.load()).toBe(STATE)
    await face.reset('thread-a')
    expect(f.resetThread).toHaveBeenCalledWith('thread-a')
    f.state.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'Host gone', {}) })
    await expect(face.load()).rejects.toThrow('Host gone')
    f.resetThread.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'Host gone', {}) })
    await expect(face.reset('thread-a')).rejects.toThrow('Host gone')
    await fiber.dispose()
    expect(f.ctx.slots.entries('plugins.item')).toEqual([])
    expect(f.unmount).toHaveBeenCalledTimes(1)
  })

  it('releases the Remote when the card cannot register', async () => {
    const f = await fixture(true)
    await expect(mountFreeChat(f.ctx, contribution)).rejects.toThrow('slot unavailable')
    expect(f.unmount).toHaveBeenCalledTimes(1)
  })
})

describe('FreeChatPage', () => {
  function props(overrides: Partial<FreeChatPageInjected> = {}, view: 'summary' | 'page' = 'page'): FreeChatPageProps {
    return {
      view,
      load: vi.fn(() => Promise.resolve(STATE)),
      reset: vi.fn(() => Promise.resolve()),
      t,
      ...overrides,
    } as FreeChatPageProps
  }

  it('reads as its one-liner in the list', () => {
    render(<>{FreeChatPage(props({}, 'summary'))}</>)
    expect(screen.getByText(en.summary)).toBeDefined()
  })

  it('shows routes and threads, resets one thread, and reads the bridge again', async () => {
    const page = props()
    render(<FreeChatPage {...page} />)
    expect(screen.getByRole('status').textContent).toBe(en.loading)
    expect(await screen.findByText('free-chat')).toBeDefined()
    expect(screen.getByText(/generation 2 · turns 3 · live · updated 2026-11-19 10:20/u)).toBeDefined()
    expect(screen.getByText(/generation 1 · turns 0 · idle$/u)).toBeDefined()
    fireEvent.click(screen.getAllByRole('button', { name: en.reset })[0]!)
    expect(screen.getByRole('button', { name: en.resetting })).toBeDefined()
    await waitFor(() => { expect(page.load).toHaveBeenCalledTimes(2) })
    expect(page.reset).toHaveBeenCalledWith('thread-a')
    await waitFor(() => { expect(screen.getAllByRole('button', { name: en.reset })).toHaveLength(2) })
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    await waitFor(() => { expect(page.load).toHaveBeenCalledTimes(3) })
  })

  it('says when the bridge has no thread yet', async () => {
    render(<FreeChatPage {...props({ load: () => Promise.resolve({ models: [], threads: [] }) })} />)
    expect(await screen.findByText(en.empty)).toBeDefined()
  })

  it('reports read and reset failures in place', async () => {
    const load = vi.fn<() => Promise<FreeChatPageState>>().mockRejectedValueOnce('offline').mockResolvedValue(STATE)
    const reset = vi.fn(() => Promise.reject(new Error('refused')))
    render(<FreeChatPage {...props({ load, reset })} />)
    expect((await screen.findByRole('alert')).textContent).toBe('Could not read the bridge: offline')
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    expect(await screen.findByText('free-chat')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: en.reset })[0]!)
    expect((await screen.findByRole('alert')).textContent).toBe('Could not read the bridge: refused')
  })
})
