/**
 * Palette, accent, and motion rows registered into the General section. Each
 * is a native radio group like the Appearance row: the browser supplies group
 * semantics, arrow-key movement, and one tab stop. Palette and motion reuse the
 * Appearance tiles; accents are color swatches, the last of which opens the
 * native color picker for a custom color.
 */
import { useId, useSyncExternalStore, type CSSProperties } from 'react'
import clsx from 'clsx'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  ACCENT_PRESETS, MOTION_LEVELS, normalizeAccentColor, PALETTE_COLORS, PALETTES,
  type MotionLevel, type PaletteId,
} from '../appearance.ts'
import type { ThemeKey } from './locales.ts'
import tiles from './AppearanceRow.module.css'
import css from './AppearanceOptions.module.css'

/** Injected face shared by the three rows. */
export interface AppearanceOptionsInjected {
  palette: ObservableSnapshot<PaletteId>
  accent: ObservableSnapshot<string | null>
  motion: ObservableSnapshot<MotionLevel>
  setPalette: (palette: PaletteId) => void
  setAccent: (accent: string | null) => void
  setMotion: (motion: MotionLevel) => void
}

/** Full row props. */
export type AppearanceOptionsProps =
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings.theme'> & AppearanceOptionsInjected

/** The hue wheel the custom swatch shows until a custom color is chosen; decorative, not a theme color. */
const HUE_WHEEL = 'conic-gradient(#ff4d4d, #ffb84d, #f2e64d, #4dd96b, #4dc8f2, #6b6bff, #d94df2, #ff4d4d)'

function useValue<T>(source: ObservableSnapshot<T>): T {
  return useSyncExternalStore(listener => source.subscribe(listener), () => source.getSnapshot())
}

/** Preview colors per tile; the built-in palette previews the built-in canvas, sidebar, and accent. */
function previewStyle(palette: PaletteId): CSSProperties {
  if (palette === 'default') {
    return {
      '--preview-bg-light': '#ffffff', '--preview-side-light': '#f8f9fa', '--preview-accent-light': 'rgb(65, 118, 230)',
      '--preview-bg-dark': '#151517', '--preview-side-dark': '#1f2023', '--preview-accent-dark': 'rgb(122, 170, 255)',
    } as CSSProperties
  }
  const { light, dark } = PALETTE_COLORS[palette]
  return {
    '--preview-bg-light': light.bg, '--preview-side-light': light.sidebar, '--preview-accent-light': light.accent,
    '--preview-bg-dark': dark.bg, '--preview-side-dark': dark.sidebar, '--preview-accent-dark': dark.accent,
  } as CSSProperties
}

/**
 * Render the color palette row.
 * @param props - composed slot props.
 * @returns the palette tiles.
 */
export function PaletteRow({ palette, setPalette, t }: AppearanceOptionsProps) {
  const value = useValue(palette)
  const titleId = useId()
  const groupName = useId()
  return (
    <div data-settings-item="block">
      <div className={tiles.title} id={titleId}>{t('palette.title')}</div>
      <div className={tiles.tiles} role="radiogroup" aria-labelledby={titleId}>
        {PALETTES.map(id => (
          <label key={id} className={clsx(tiles.tile, value === id && tiles.selected)}>
            <input type="radio" className={tiles.input} name={groupName} checked={value === id}
              onChange={() => { setPalette(id) }} />
            <span className={css.preview} style={previewStyle(id)} aria-hidden="true">
              <span className={css.previewSide} />
              <span className={css.previewAccent} />
            </span>
            <span className={tiles.label}>{t(`palette.${id}` satisfies ThemeKey)}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

/**
 * Render the accent row: the default accent, the presets, and a custom color.
 * @param props - composed slot props.
 * @returns the accent swatches.
 */
export function AccentRow({ accent, setAccent, t }: AppearanceOptionsProps) {
  const value = useValue(accent)
  const titleId = useId()
  const groupName = useId()
  const custom = value !== null && !ACCENT_PRESETS.some(preset => preset.color === value)
  return (
    <div data-settings-item="block">
      <div className={tiles.title} id={titleId}>{t('accent.title')}</div>
      <div className={css.swatches} role="radiogroup" aria-labelledby={titleId}>
        <label className={clsx(css.swatch, css.defaultSwatch, value === null && css.swatchSelected)} title={t('accent.default')}>
          <input type="radio" className={tiles.input} name={groupName} checked={value === null}
            aria-label={t('accent.default')} onChange={() => { setAccent(null) }} />
        </label>
        {ACCENT_PRESETS.map(preset => (
          <label key={preset.id} className={clsx(css.swatch, value === preset.color && css.swatchSelected)}
            style={{ '--swatch': preset.color } as CSSProperties} title={t(`accent.${preset.id}` satisfies ThemeKey)}>
            <input type="radio" className={tiles.input} name={groupName} checked={value === preset.color}
              aria-label={t(`accent.${preset.id}` satisfies ThemeKey)} onChange={() => { setAccent(preset.color) }} />
          </label>
        ))}
        <label className={clsx(css.swatch, css.customSwatch, custom && css.swatchSelected)}
          style={(custom ? { '--swatch': value } : { '--swatch-wheel': HUE_WHEEL }) as CSSProperties} title={t('accent.custom')}>
          <input type="color" className={css.colorInput} value={custom ? value : '#5b6bff'}
            aria-label={t('accent.custom')}
            onChange={(event) => {
              const color = normalizeAccentColor(event.target.value)
              if (color !== undefined) setAccent(color)
            }} />
        </label>
      </div>
    </div>
  )
}

/**
 * Render the interface motion row.
 * @param props - composed slot props.
 * @returns the motion tiles.
 */
export function MotionRow({ motion, setMotion, t }: AppearanceOptionsProps) {
  const value = useValue(motion)
  const titleId = useId()
  const groupName = useId()
  return (
    <div data-settings-item="block">
      <div className={tiles.title} id={titleId}>{t('motion.title')}</div>
      <div className={tiles.tiles} role="radiogroup" aria-labelledby={titleId}>
        {MOTION_LEVELS.map(id => (
          <label key={id} className={clsx(tiles.tile, css.textTile, value === id && tiles.selected)}>
            <input type="radio" className={tiles.input} name={groupName} checked={value === id}
              onChange={() => { setMotion(id) }} />
            <span className={tiles.label}>{t(`motion.${id}` satisfies ThemeKey)}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
