/** Pencil action that opens the in-place editor of one sent user message. */
import { useId } from 'react'
import { IconEditOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import css from './MessageIconActions.module.css'

/** Props the official entry consumes from the row's Factory contract. */
export type EditMessageActionProps = Pick<
  FactoryComponentPropsOf<'conversation.chat.user.actions'>,
  'beginEdit' | 'editUnavailable' | 'editTriggerRef' | 't'
>

/**
 * Render the pencil beside one finalized user message. The click only opens the
 * row's editor: it never writes the composer draft and never submits, so the
 * message is not resent on opening. While the Session runs, the same entry stays
 * visible but unavailable, and its reason is programmatically associated. The
 * button also carries the row's trigger ref, so closing the editor can return
 * the keyboard to it.
 * @param props - the row's edit callbacks, its focus-return ref, and the Chat copy seat.
 * @returns the pencil action and, when unavailable, its visually hidden reason.
 */
export function EditMessageAction({ beginEdit, editUnavailable, editTriggerRef, t }: EditMessageActionProps) {
  const reasonId = useId()
  const label = t('message.edit')
  const reason = t('message.editUnavailable')
  return (
    <>
      <Tooltip label={editUnavailable ? reason : label} side="bottom" openOnClick={editUnavailable}>
        {/* Native disabled buttons deliver no hover/focus events for the reason tooltip. */}
        <button
          ref={editTriggerRef}
          type="button"
          className={css.action}
          aria-label={label}
          aria-disabled={editUnavailable || undefined}
          aria-describedby={editUnavailable ? reasonId : undefined}
          data-unavailable={editUnavailable || undefined}
          onClick={editUnavailable ? undefined : beginEdit}
        >
          <IconEditOutlineRegular />
        </button>
      </Tooltip>
      {editUnavailable && <span id={reasonId} className={css.visuallyHidden}>{reason}</span>}
    </>
  )
}
