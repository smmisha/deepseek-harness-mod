/**
 * Appearance preference registered into the General section item slot
 * (figma 501:30012 'Frame 2117131228'): title + three theme choices. Registered
 * by this package — the theme feature owns its own settings surface. Selection
 * follows the persisted preference, never the resolved active theme.
 *
 * The choice is a native radio group: each tile is a label for a visually
 * hidden radio, so the browser supplies the group semantics, the arrow-key
 * movement, and the single tab stop; the selected tile is drawn with the
 * theme's raised material (SegmentedTabs uses the same one) instead of a
 * bespoke border. The row marks itself as a `block` so the General section
 * keeps it full width rather than laying it out as a field row.
 */
import { useId } from 'react'
import clsx from 'clsx'
import {
  IconDarkOutlineMedium, IconFollowsystemOutlineMedium, IconLightOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ThemePreference } from '../theme-settings.ts'
import type { ThemeKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createAppearanceRowStore } from './settings-store.ts'
import css from './AppearanceRow.module.css'

/** Injected business face: the preference write (t rides the standard locale seat). */
export interface AppearanceRowInjected {
  /** Switch the theme preference. */
  setTheme: (id: ThemePreference) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type AppearanceRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createAppearanceRowStore>>
  & PropsLocale<'settings.theme'> & AppearanceRowInjected

/** Tile order and icons (figma 501:30015-30017: Light, Dark, System). */
const CUBES: readonly { id: ThemePreference; labelKey: ThemeKey; Icon: typeof IconLightOutlineMedium }[] = [
  { id: 'light', labelKey: 'appearance.light', Icon: IconLightOutlineMedium },
  { id: 'dark', labelKey: 'appearance.dark', Icon: IconDarkOutlineMedium },
  { id: 'system', labelKey: 'appearance.system', Icon: IconFollowsystemOutlineMedium },
]

/**
 * Render the Appearance row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function AppearanceRow({ t, setTheme, useStore }: AppearanceRowComponentProps) {
  const preference = useStore(s => s.preference)
  const titleId = useId()
  const groupName = useId()
  return (
    <div data-settings-item="block">
      <div className={css.title} id={titleId}>{t('appearance.title')}</div>
      <div className={css.tiles} role="radiogroup" aria-labelledby={titleId}>
        {CUBES.map(({ id, labelKey, Icon }) => (
          <label key={id} className={clsx(css.tile, preference === id && css.selected)}>
            <input
              type="radio"
              className={css.input}
              name={groupName}
              checked={preference === id}
              onChange={() => { setTheme(id) }}
            />
            <Icon className={css.icon} aria-hidden="true" />
            <span className={css.label}>{t(labelKey)}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
