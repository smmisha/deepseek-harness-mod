/** Browser half registration: the frame-wide surface and its chrome mapping. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'

/** Boot the plugin against a declared overlay slot and a stub layout service. */
function bench() {
  const ctx = new Context()
  const slots = new SlotRegistry(ctx)
  const setChrome = vi.fn()
  ctx.provide('layout', {
    setChrome,
    selectPanel: vi.fn(),
    panelInfo: { getSnapshot: () => ({ activePanelId: null }), subscribe: () => () => {} },
  })
  ctx.provide('locale', { register: () => () => {}, bind: () => (key: string) => key })
  slots.register({
    name: 'root',
    children: { 'shell.overlay': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  const fiber = ctx.plugin({ inject: [...inject] as string[], apply })
  return { ctx, slots, setChrome, fiber }
}

describe('ui-work-mode browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale', 'layout'])
  })

  it('registers the working-mode surface and starts in the full shell', async () => {
    const { slots, setChrome, fiber } = bench()
    onTestFinished(async () => { await fiber.dispose() })
    await fiber.await()
    expect(slots.entries('shell.overlay').map(entry => entry.options.id)).toEqual(['work-mode'])
    expect(setChrome).toHaveBeenLastCalledWith('full')
  })

  it('removes the surface and restores the shell with the plugin fiber', async () => {
    const { slots, setChrome, fiber } = bench()
    await fiber.await()
    expect(setChrome).toHaveBeenLastCalledWith('full')
    await fiber.dispose()
    expect(slots.entries('shell.overlay')).toHaveLength(0)
    expect(setChrome).toHaveBeenLastCalledWith('full')
  })
})
