// @vitest-environment node
/** Ukrainian language pack: language registration and node-half glue. */
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { UK_DICTIONARIES } from '../src/client/dictionaries.ts'
import * as nodeHalf from '../src/index.ts'

/** A client context whose effect runs its registration immediately. */
function context() {
  const addLanguage = vi.fn(() => () => {})
  const register = vi.fn(() => () => {})
  const effect = vi.fn((contribute: () => () => void) => contribute())
  return {
    ctx: { locale: { addLanguage, register }, effect },
    addLanguage,
    register,
    effect,
  }
}

describe('ui-locale-uk', () => {
  it('requires the locale service', () => {
    expect(inject).toEqual(['locale'])
  })

  it('registers the Ukrainian language and one dictionary per namespace', () => {
    const { ctx, addLanguage, register, effect } = context()
    apply(ctx as never)
    expect(addLanguage).toHaveBeenCalledWith({ id: 'uk', label: 'Українська', fallback: 'en' })
    expect(register).toHaveBeenCalledTimes(Object.keys(UK_DICTIONARIES).length)
    for (const [namespace, dictionary] of Object.entries(UK_DICTIONARIES)) {
      expect(register).toHaveBeenCalledWith(namespace, 'uk', dictionary)
    }
    // Language plus every namespace is owned by an effect, so unmounting the
    // pack removes exactly what it added.
    expect(effect).toHaveBeenCalledTimes(Object.keys(UK_DICTIONARIES).length + 1)
  })

  it('keeps an empty node half callable', () => {
    expect(() => { nodeHalf.apply() }).not.toThrow()
  })
})
