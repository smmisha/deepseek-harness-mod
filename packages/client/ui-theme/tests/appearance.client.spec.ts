/** Palettes, accents, and their single token layer. */
import { describe, expect, it } from 'vitest'
import {
  ACCENT_PRESETS, accentInk, accentTokens, appearanceTokens, DARK_INK, isAccentColor, LIGHT_INK, lighten,
  normalizeAccentColor, PALETTE_COLORS, paletteCanvas, paletteTokens, withAlpha,
} from '../src/appearance.ts'

describe('accent colors', () => {
  it('accepts only lowercase #rrggbb and normalizes color input values', () => {
    expect(isAccentColor('#1e86ff')).toBe(true)
    expect(isAccentColor('#1E86FF')).toBe(false)
    expect(isAccentColor('#fff')).toBe(false)
    expect(isAccentColor(42)).toBe(false)
    expect(normalizeAccentColor(' #1E86FF ')).toBe('#1e86ff')
    expect(normalizeAccentColor('#AbC')).toBe('#aabbcc')
    expect(normalizeAccentColor('red')).toBeUndefined()
    for (const preset of ACCENT_PRESETS) expect(isAccentColor(preset.color)).toBe(true)
  })

  it('mixes toward white and expresses alpha', () => {
    expect(lighten('#000000', 0.25)).toBe('#404040')
    expect(lighten('#ff0000', 1)).toBe('#ffffff')
    expect(withAlpha('#1e86ff', 0.12)).toBe('rgba(30, 134, 255, 0.12)')
  })

  it('writes white on dark accents and near-black on light ones', () => {
    expect(accentInk('#1f3a8a')).toBe(LIGHT_INK)
    expect(accentInk('#f2e64d')).toBe(DARK_INK)
  })

  it('sets the business accent, its soft fill, links, and their ink for both schemes', () => {
    expect(accentTokens('#e0a100')).toEqual({
      '--dsw-alias-state-business-primary': { light: '#e0a100', dark: lighten('#e0a100', 0.25) },
      '--dsw-alias-state-business-tertiary': { light: withAlpha('#e0a100', 0.12), dark: withAlpha(lighten('#e0a100', 0.25), 0.24) },
      '--dsw-alias-link': { light: '#e0a100', dark: lighten('#e0a100', 0.25) },
      '--dsw-alias-label-on-color': { light: DARK_INK, dark: DARK_INK },
    })
  })
})

describe('palettes', () => {
  it('leaves the built-in tokens for the default palette', () => {
    expect(paletteTokens('default')).toEqual({})
    expect(appearanceTokens('default', null)).toEqual({})
    expect(paletteCanvas('default', 'dark')).toBeUndefined()
  })

  it('covers canvas, surfaces, text, and its own accent in both schemes', () => {
    const tokens = paletteTokens('moonlight')
    const { light, dark } = PALETTE_COLORS.moonlight
    expect(tokens['--dsw-alias-bg-base']).toEqual({ light: light.bg, dark: dark.bg })
    expect(tokens['--dsw-specific-sidebar-fill']).toEqual({ light: light.sidebar, dark: dark.sidebar })
    expect(tokens['--dsw-specific-bubble']).toEqual({ light: light.bubble, dark: dark.bubble })
    expect(tokens['--dsw-alias-label-tertiary']).toEqual({ light: withAlpha(light.text, 0.6), dark: withAlpha(dark.text, 0.6) })
    expect(tokens['--dsw-alias-state-business-primary']).toEqual({ light: light.accent, dark: dark.accent })
    expect(paletteCanvas('moonlight', 'light')).toBe(light.bg)
  })

  it('lets a chosen accent win over the palette accent in the one layer', () => {
    const tokens = appearanceTokens('moonlight', '#e8457c')
    expect(tokens['--dsw-alias-state-business-primary']).toEqual({ light: '#e8457c', dark: lighten('#e8457c', 0.25) })
    expect(tokens['--dsw-alias-bg-base']).toEqual(paletteTokens('moonlight')['--dsw-alias-bg-base'])
    expect(appearanceTokens('default', '#e8457c')).toEqual(accentTokens('#e8457c'))
  })
})
