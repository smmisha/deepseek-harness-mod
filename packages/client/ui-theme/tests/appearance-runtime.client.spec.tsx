// @vitest-environment jsdom
/** Palette, accent, and motion preferences: Host reconciliation, token layer, motion attribute, and rows. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { appearanceTokens, MOTION_ATTRIBUTE } from '../src/appearance.ts'
import type { ThemeSettings } from '../src/theme-settings.ts'
import { APPEARANCE_LAYER, AppearanceRuntime } from '../src/client/appearance-runtime.ts'
import { AccentRow, MotionRow, PaletteRow, type AppearanceOptionsProps } from '../src/client/AppearanceOptions.tsx'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en, commonEn)

afterEach(cleanup)

function settings(overrides: Partial<ThemeSettings> = {}): ThemeSettings {
  return {
    preference: 'system', fontSize: 14, codeFontSize: 11, terminalFontSize: 13,
    textFontFamily: '', codeFontFamily: '', terminalFontFamily: '',
    palette: 'default', accent: '', motion: 'full',
    ...overrides,
  }
}

function fakeTheme() {
  const released = vi.fn()
  const overrideTokens = vi.fn(() => released)
  return { overrideTokens, released }
}

describe('AppearanceRuntime', () => {
  it('publishes choices at once, writes each once, and refuses malformed accents', () => {
    const host = stubConfigForm<ThemeSettings>()
    const runtime = new AppearanceRuntime(host.scope)
    runtime.setPalette('moonlight')
    runtime.setPalette('moonlight')
    runtime.setAccent('#e8457c')
    runtime.setAccent('#e8457c')
    runtime.setMotion('none')
    runtime.setMotion('none')
    runtime.setAccent(null)
    expect(runtime.palette.getSnapshot()).toBe('moonlight')
    expect(runtime.accent.getSnapshot()).toBeNull()
    expect(runtime.motion.getSnapshot()).toBe('none')
    expect(host.set.mock.calls).toEqual([
      ['palette', 'moonlight'], ['accent', '#e8457c'], ['motion', 'none'], ['accent', ''],
    ])
    expect(() => { runtime.setAccent('#E8457C') }).toThrow(/lowercase #rrggbb/)
  })

  it('adopts accepted Host settings, keeping defaults for absent or unknown values', () => {
    const host = stubConfigForm<ThemeSettings>()
    host.publish({ value: settings({ palette: 'moonlight', accent: '#0f9fae', motion: 'reduced' }) })
    const runtime = new AppearanceRuntime(host.scope)
    expect([runtime.palette.getSnapshot(), runtime.accent.getSnapshot(), runtime.motion.getSnapshot()])
      .toEqual(['moonlight', '#0f9fae', 'reduced'])
    host.publish({ value: { ...settings(), palette: 'sepia' as never, accent: 'nope', motion: 'wild' as never } })
    expect([runtime.palette.getSnapshot(), runtime.accent.getSnapshot(), runtime.motion.getSnapshot()])
      .toEqual(['default', null, 'full'])
    host.publish({ value: undefined })
    expect(runtime.palette.getSnapshot()).toBe('default')
    runtime.dispose()
    expect(host.listenerCount()).toBe(0)
  })

  it('keeps one token layer in step with the palette and accent and drops it when empty', () => {
    const host = stubConfigForm<ThemeSettings>()
    const runtime = new AppearanceRuntime(host.scope)
    const theme = fakeTheme()
    const release = runtime.layer(theme)
    expect(theme.overrideTokens).not.toHaveBeenCalled()
    runtime.setPalette('moonlight')
    runtime.setAccent('#5b6bff')
    expect(theme.overrideTokens).toHaveBeenLastCalledWith(APPEARANCE_LAYER, appearanceTokens('moonlight', '#5b6bff'))
    runtime.setPalette('default')
    runtime.setAccent(null)
    expect(theme.released).toHaveBeenCalledTimes(1)
    runtime.setAccent('#5b6bff')
    release()
    expect(theme.released).toHaveBeenCalledTimes(2)
    runtime.setAccent('#e8457c')
    expect(theme.overrideTokens).toHaveBeenCalledTimes(4)
  })

  it('names reduced and none motion on the root and clears it for full and on release', () => {
    const host = stubConfigForm<ThemeSettings>()
    const runtime = new AppearanceRuntime(host.scope)
    const root = document.createElement('div')
    const release = runtime.presentMotion(root)
    expect(root.hasAttribute(MOTION_ATTRIBUTE)).toBe(false)
    runtime.setMotion('reduced')
    expect(root.getAttribute(MOTION_ATTRIBUTE)).toBe('reduced')
    runtime.setMotion('full')
    expect(root.hasAttribute(MOTION_ATTRIBUTE)).toBe(false)
    runtime.setMotion('none')
    release()
    expect(root.hasAttribute(MOTION_ATTRIBUTE)).toBe(false)
  })
})

describe('appearance rows', () => {
  function props(runtime: AppearanceRuntime): AppearanceOptionsProps {
    return {
      palette: runtime.palette,
      accent: runtime.accent,
      motion: runtime.motion,
      setPalette: (palette) => { runtime.setPalette(palette) },
      setAccent: (accent) => { runtime.setAccent(accent) },
      setMotion: (motion) => { runtime.setMotion(motion) },
      t,
    } as AppearanceOptionsProps
  }

  it('chooses a palette and a motion level through their radio groups', () => {
    const runtime = new AppearanceRuntime(stubConfigForm<ThemeSettings>().scope)
    render(<><PaletteRow {...props(runtime)} /><MotionRow {...props(runtime)} /></>)
    expect(screen.getByRole('radiogroup', { name: t('palette.title') })).toBeDefined()
    fireEvent.click(screen.getByRole('radio', { name: t('palette.moonlight') }))
    expect(runtime.palette.getSnapshot()).toBe('moonlight')
    expect(screen.getByRole('radio', { name: t('palette.moonlight') })).toHaveProperty('checked', true)
    fireEvent.click(screen.getByRole('radio', { name: t('motion.reduced') }))
    expect(runtime.motion.getSnapshot()).toBe('reduced')
  })

  it('chooses a preset, a custom color, and the default accent', () => {
    const runtime = new AppearanceRuntime(stubConfigForm<ThemeSettings>().scope)
    render(<AccentRow {...props(runtime)} />)
    expect(screen.getByRole('radio', { name: t('accent.default') })).toHaveProperty('checked', true)
    fireEvent.click(screen.getByRole('radio', { name: t('accent.teal') }))
    expect(runtime.accent.getSnapshot()).toBe('#0f9fae')
    const picker = screen.getByLabelText(t('accent.custom'))
    fireEvent.change(picker, { target: { value: '#123ABC' } })
    expect(runtime.accent.getSnapshot()).toBe('#123abc')
    expect(picker).toHaveProperty('value', '#123abc')
    // Browsers sanitize color inputs to #rrggbb; a value outside that form changes nothing.
    Object.defineProperty(picker, 'value', { configurable: true, get: () => 'not-a-color' })
    fireEvent.change(picker)
    expect(runtime.accent.getSnapshot()).toBe('#123abc')
    fireEvent.click(screen.getByRole('radio', { name: t('accent.default') }))
    expect(runtime.accent.getSnapshot()).toBeNull()
  })
})
