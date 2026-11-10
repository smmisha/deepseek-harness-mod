/**
 * Chat | Harness switch in the shape the conversation header used to carry:
 * one capsule, two modes, and the DeepSeek whale on the Harness segment.
 */
import { SegmentedControl, WhaleMark } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkMode } from './store.ts'
import css from './ModeSwitcher.module.css'

/** Props of the presentational switch; the surrounding occupant owns the store. */
export type ModeSwitcherProps = PropsLocale<'workMode'> & {
  /** The mode currently shown. */
  readonly mode: WorkMode
  /** Switch to the chosen mode. */
  readonly onSelect: (mode: WorkMode) => void
}

/**
 * Render the Chat/Harness capsule.
 * @param props - selected mode, the owner's callback, and the `workMode` locale seat.
 * @returns The segmented control with localized segment text.
 */
export function ModeSwitcher({ mode, onSelect, t }: ModeSwitcherProps) {
  return (
    <SegmentedControl
      id="work-mode"
      value={mode}
      options={[
        { value: 'chat', label: t('mode.chat') },
        { value: 'harness', label: t('mode.harness'), icon: <WhaleMark size={14} /> },
      ]}
      onChange={onSelect}
      label={t('mode.label')}
      className={css.switcher}
    />
  )
}
