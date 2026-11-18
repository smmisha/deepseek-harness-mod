/** Pencil action that seeds the composer with a sent user message for editing. */
import { IconEditOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './MessageIconActions.module.css'

/** Props the session standard kit supplies with the factory's own message text. */
type EditMessageActionProps = {
  readonly text: string
  readonly inputActions: InputActions
} & Pick<PropsLocale<'chat'>, 't'>

/**
 * Load one sent user message back into the composer so the human can change it
 * and resubmit; the original message stays in the transcript.
 * @param props - the message text, this Session's input actions, and Chat copy.
 * @returns the pencil action button.
 */
export function EditMessageAction({ text, inputActions, t }: EditMessageActionProps) {
  const label = t('message.edit')
  return (
    <Tooltip label={label} side="bottom">
      <button
        type="button"
        className={css.action}
        aria-label={label}
        onClick={() => { inputActions.setDraft(text); inputActions.focus() }}
      >
        <IconEditOutlineRegular />
      </button>
    </Tooltip>
  )
}
