/**
 * The General section: one column of feature-owned preference rows, read in two
 * groups. "Interface" holds the rows that change how the product reads
 * (language, appearance, font size); "Working with the agent" holds the rows
 * that change what the agent and the transcript do. A group's heading is the
 * only thing the shell contributes to the column — every row, its copy, its
 * control and its write path stay with the feature that owns the preference
 * (GeneralSection.module.css carries the shared row geometry).
 */
import { Fragment, useId } from 'react'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import css from './GeneralSection.module.css'

/** One reading group of the General column: a heading over ordered item ids. */
export interface GeneralGroup {
  /** Stable group key (the heading's element id derives from it). */
  id: string
  /** Dictionary key of the group heading. */
  labelKey: 'general.group.interface' | 'general.group.work'
  /** `settings.general.item` ids in render order. */
  items: readonly string[]
}

/**
 * Registrant-private injected share (assembled in apply): the projected item
 * groups. The source re-projects when the item ledger changes, so a feature
 * that registers, replaces or unregisters its row lands in its group without
 * re-registering the section.
 */
export interface GeneralSectionInjected {
  hooks: {
    /** settings.general.item ledger projected into reading groups. */
    groups: HostObservable<readonly GeneralGroup[]>
  }
}

/** Full component props: section owner share plus item render share and the injected groups. */
export type GeneralSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.general.item'>
  & PropsLocale<'settings'> & InjectFace<GeneralSectionInjected>

/**
 * Render the General section content column.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the grouped section element tree.
 */
export function GeneralSection({ renderSlot, useGroups, t }: GeneralSectionComponentProps) {
  const groups = useGroups(value => value)
  const headingPrefix = useId()
  return (
    <div className={css.section}>
      {groups.filter(group => group.items.length > 0).map((group) => {
        const headingId = `${headingPrefix}-${group.id}`
        return (
          <section key={group.id} className={css.group} aria-labelledby={headingId}>
            <h2 className={css.groupLabel} id={headingId}>
              {t(group.labelKey)}
            </h2>
            {group.items.map(id => (
              <Fragment key={id}>{renderSlot('settings.general.item', {}, { only: id })}</Fragment>
            ))}
          </section>
        )
      })}
    </div>
  )
}
