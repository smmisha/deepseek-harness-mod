// @vitest-environment jsdom
/** The plugin apply world: dictionaries, frame chrome, and the shell overlay seat. */
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'

describe('ui-work-mode browser half', () => {
  it('registers dictionaries, follows the mode store, and contributes the overlay', () => {
    const register = vi.fn()
    const cleanups: (() => void)[] = []
    const effect = vi.fn((callback: () => unknown) => {
      const cleanup = callback()
      if (typeof cleanup === 'function') cleanups.push(cleanup as () => void)
      return cleanup
    })
    const setChrome = vi.fn()
    const setFrameCovered = vi.fn()
    const setTopBand = vi.fn()
    const locale = { register: vi.fn(), bind: vi.fn(() => (key: string) => key) }
    const slots = {
      inject: vi.fn((_name: string, contribute: () => unknown) => contribute()),
      register,
    }
    const ctx = { effect, locale, layout: { setChrome, setFrameCovered, setTopBand }, slots }
    apply(ctx as never)
    expect(locale.register).toHaveBeenCalledTimes(1)
    expect(slots.inject).toHaveBeenCalledWith('shell.overlay', expect.any(Function))
    expect(register).toHaveBeenCalledTimes(1)
    const [declaration] = register.mock.calls[0] as [Record<string, unknown>, unknown]
    expect(declaration.name).toBe('shell.overlay')
    expect(declaration.id).toBe('work-mode')
    const store = declaration.store as { create: () => unknown }
    expect(store.create()).toBe(store.create())
    const face = (declaration.inject as () => { setTopBand: (px: number | null) => void })()
    face.setTopBand(40)
    expect(setTopBand).toHaveBeenCalledWith(40)
    for (const cleanup of cleanups) cleanup()
    expect(setChrome).toHaveBeenCalledWith('full')
    expect(setFrameCovered).toHaveBeenCalledWith(false)
  })

})
