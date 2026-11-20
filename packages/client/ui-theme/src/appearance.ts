/**
 * Color palettes and accent colors layered over the built-in light and dark
 * themes. Pure and Cordis-free: the client runtime and the pre-plugin boot read
 * the same tables. One palette and one accent fold into a single token layer,
 * the accent winning over the palette's own accent.
 */

/** Palettes a user can choose; `default` keeps the built-in tokens. */
export const PALETTES = ['default', 'moonlight'] as const

/** Selected color palette. */
export type PaletteId = typeof PALETTES[number]

/** Palette when the user-settings document has no override. */
export const DEFAULT_PALETTE: PaletteId = 'default'

/** One color scheme of a palette, as `#rrggbb` colors. */
export interface PaletteColors {
  /** Application canvas. */
  readonly bg: string
  /** Raised surfaces over the canvas. */
  readonly raised: string
  /** Sidebar and platform module fill. */
  readonly sidebar: string
  /** User message bubble. */
  readonly bubble: string
  /** Cards and the composer field. */
  readonly card: string
  /** Opaque hover fill. */
  readonly hover: string
  /** Primary text; secondary, tertiary, and caption text derive from it. */
  readonly text: string
  /** The palette's own accent, used while no accent is chosen. */
  readonly accent: string
}

/** Light and dark schemes of one palette. */
export interface Palette {
  readonly light: PaletteColors
  readonly dark: PaletteColors
}

/** Palette tables; `default` has none. */
export const PALETTE_COLORS: Readonly<Record<Exclude<PaletteId, 'default'>, Palette>> = {
  moonlight: {
    light: {
      bg: '#f7f9fc', raised: '#ffffff', sidebar: '#eef2f8', bubble: '#e5ebf5',
      card: '#ffffff', hover: '#e6ecf5', text: '#121826', accent: '#1e86ff',
    },
    dark: {
      bg: '#0b1020', raised: '#141c33', sidebar: '#10172a', bubble: '#1a2340',
      card: '#141c33', hover: '#1e2847', text: '#e8edf7', accent: '#4f9dff',
    },
  },
}

/** Preset accent colors offered as swatches, in display order. */
export const ACCENT_PRESETS = [
  { id: 'indigo', color: '#5b6bff' },
  { id: 'violet', color: '#8b5cf6' },
  { id: 'pink', color: '#e8457c' },
  { id: 'orange', color: '#f26b1d' },
  { id: 'amber', color: '#e0a100' },
  { id: 'green', color: '#1fa463' },
  { id: 'teal', color: '#0f9fae' },
  { id: 'graphite', color: '#5f6b7a' },
] as const

/** A `#rrggbb` accent color. */
const ACCENT_PATTERN = /^#[0-9a-f]{6}$/u

/**
 * Whether a value is an accepted accent color.
 * @param value - candidate from settings or a color input.
 * @returns true for a lowercase `#rrggbb` color.
 */
export function isAccentColor(value: unknown): value is string {
  return typeof value === 'string' && ACCENT_PATTERN.test(value)
}

/**
 * Normalize a color input's value to the stored form.
 * @param value - `#rgb` or `#rrggbb` in any case.
 * @returns lowercase `#rrggbb`, or undefined when the value is not a hex color.
 */
export function normalizeAccentColor(value: string): string | undefined {
  const hex = value.trim().toLowerCase()
  if (/^#[0-9a-f]{3}$/u.test(hex)) return hex.replace(/[0-9a-f]/gu, digit => digit + digit)
  return ACCENT_PATTERN.test(hex) ? hex : undefined
}

function channels(hex: string): readonly [number, number, number] {
  const at = (offset: number): number => Number.parseInt(hex.slice(offset, offset + 2), 16)
  return [at(1), at(3), at(5)]
}

function toHex(rgb: readonly number[]): string {
  return `#${rgb.map(value => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0')).join('')}`
}

/**
 * Mix a color toward white.
 * @param hex - `#rrggbb` color.
 * @param amount - share of white, from 0 (unchanged) to 1 (white).
 * @returns the mixed `#rrggbb` color.
 */
export function lighten(hex: string, amount: number): string {
  return toHex(channels(hex).map(value => value + (255 - value) * amount))
}

/**
 * Express a color with an alpha.
 * @param hex - `#rrggbb` color.
 * @param alpha - opacity from 0 to 1.
 * @returns an `rgba()` color.
 */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function linear(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex)
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** Ink for text on a dark accent fill. */
export const LIGHT_INK = '#ffffff'

/** Ink for text on a light accent fill. */
export const DARK_INK = '#141414'

/**
 * Choose the readable ink for text drawn on an accent fill.
 * @param hex - accent `#rrggbb` color.
 * @returns white or near-black, whichever contrasts more with the accent.
 */
export function accentInk(hex: string): string {
  const fill = luminance(hex)
  const onWhite = (1.05) / (fill + 0.05)
  const onDark = (fill + 0.05) / (luminance(DARK_INK) + 0.05)
  return onWhite >= onDark ? LIGHT_INK : DARK_INK
}

/** One token's value for each built-in color scheme. */
export interface TokenModes {
  readonly light: string
  readonly dark: string
}

/** Token name → per-scheme values, the shape a theme override layer takes. */
export type AppearanceTokens = Readonly<Record<string, TokenModes>>

function accentModes(light: string, dark: string): AppearanceTokens {
  return {
    '--dsw-alias-state-business-primary': { light, dark },
    '--dsw-alias-state-business-tertiary': { light: withAlpha(light, 0.12), dark: withAlpha(dark, 0.24) },
    '--dsw-alias-link': { light, dark },
    '--dsw-alias-label-on-color': { light: accentInk(light), dark: accentInk(dark) },
  }
}

/**
 * Tokens one accent color sets. Dark scheme fills lighten the color a quarter
 * toward white, as the built-in accent does, so it stays legible on dark canvases.
 * @param hex - accent `#rrggbb` color.
 * @returns the accent's token layer.
 */
export function accentTokens(hex: string): AppearanceTokens {
  return accentModes(hex, lighten(hex, 0.25))
}

/**
 * Tokens one palette sets, its own accent included.
 * @param palette - selected palette.
 * @returns the palette's token layer; empty for the default palette.
 */
export function paletteTokens(palette: PaletteId): AppearanceTokens {
  if (palette === 'default') return {}
  const { light, dark } = PALETTE_COLORS[palette]
  const pair = (pick: (colors: PaletteColors) => string): TokenModes => ({ light: pick(light), dark: pick(dark) })
  return {
    '--dsw-alias-bg-base': pair(colors => colors.bg),
    '--dsw-alias-bg-layer-1': pair(colors => colors.raised),
    '--dsw-alias-bg-layer-2': pair(colors => colors.raised),
    '--dsw-alias-bg-layer-3': pair(colors => colors.hover),
    '--dsw-alias-bg-module-platform': pair(colors => colors.sidebar),
    '--dsw-specific-sidebar-fill': pair(colors => colors.sidebar),
    '--dsw-specific-input-major': pair(colors => colors.card),
    '--dsw-specific-bubble': pair(colors => colors.bubble),
    '--dsw-alias-card-fill': pair(colors => colors.card),
    '--dsw-alias-interactive-bg-hover-solid': pair(colors => colors.hover),
    '--dsw-alias-label-primary': pair(colors => colors.text),
    '--dsw-alias-label-secondary': pair(colors => withAlpha(colors.text, 0.74)),
    '--dsw-alias-label-tertiary': pair(colors => withAlpha(colors.text, 0.6)),
    '--dsw-alias-label-caption': pair(colors => withAlpha(colors.text, 0.45)),
    ...accentModes(light.accent, dark.accent),
  }
}

/**
 * The single layer one palette and one accent produce, the accent winning.
 * @param palette - selected palette.
 * @param accent - chosen accent color, or null to keep the palette's or the built-in accent.
 * @returns the combined token layer.
 */
export function appearanceTokens(palette: PaletteId, accent: string | null): AppearanceTokens {
  return { ...paletteTokens(palette), ...accent === null ? {} : accentTokens(accent) }
}

/**
 * The canvas color the boot paints before scripts run.
 * @param palette - selected palette.
 * @param scheme - resolved color scheme.
 * @returns the palette canvas, or undefined to keep the built-in canvas.
 */
export function paletteCanvas(palette: PaletteId, scheme: 'light' | 'dark'): string | undefined {
  return palette === 'default' ? undefined : PALETTE_COLORS[palette][scheme].bg
}

/** How much the interface animates: follow the system, reduce, or switch animation off. */
export const MOTION_LEVELS = ['full', 'reduced', 'none'] as const

/** Interface motion level. */
export type MotionLevel = typeof MOTION_LEVELS[number]

/** Motion when the user-settings document has no override: follow the system preference. */
export const DEFAULT_MOTION: MotionLevel = 'full'

/** Root attribute naming a motion level other than `full`. */
export const MOTION_ATTRIBUTE = 'data-dsh-motion'
