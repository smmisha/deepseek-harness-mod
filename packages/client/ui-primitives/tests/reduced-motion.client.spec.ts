// @vitest-environment jsdom
/** Scripted motion follows the system preference and the Interface motion setting. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prefersReducedMotion } from '../src/reduced-motion.ts'

function systemReduces(matches: boolean): void {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches })))
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-dsh-motion')
})

describe('prefersReducedMotion', () => {
  it('follows the system preference while motion follows the system', () => {
    systemReduces(false)
    expect(prefersReducedMotion()).toBe(false)
    systemReduces(true)
    expect(prefersReducedMotion()).toBe(true)
  })

  it('reduces whenever the Interface motion setting is reduced or none', () => {
    systemReduces(false)
    for (const level of ['reduced', 'none']) {
      document.documentElement.setAttribute('data-dsh-motion', level)
      expect(prefersReducedMotion()).toBe(true)
    }
  })

  it('animates where no media query is available', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(prefersReducedMotion()).toBe(false)
  })
})
