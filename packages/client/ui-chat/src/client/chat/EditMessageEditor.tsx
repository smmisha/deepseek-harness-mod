/** In-place editor for one sent user message, with explicit save and cancel. */
import {
  IconCheckOutlineRegular, IconCloseOutlineRegular, InlineEditor, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import css from './EditMessageEditor.module.css'

/** Props the message row supplies to its own editor. */
export interface EditMessageEditorProps {
  /** Text being edited; the row keeps it until save or cancel. */
  readonly text: string
  /** Receive every keystroke so save always carries the latest text. */
  readonly onChange: (text: string) => void
  /** Apply the edit through the row's save path. */
  readonly onSave: () => void
  /** Discard the edit; the message and the composer stay untouched. */
  readonly onCancel: () => void
  /** Chat locale seat. */
  readonly t: ChatViewSlotProps['t']
}

/**
 * Render the message's text in a multi-line editor. Enter saves, Shift+Enter
 * breaks the line, Escape cancels, and the action pair repeats both gestures for
 * pointer users; an empty edit cannot be saved.
 * @param props - edited text, its callbacks, and the Chat copy seat.
 * @returns the editor field and its action pair.
 */
export function EditMessageEditor({ text, onChange, onSave, onCancel, t }: EditMessageEditorProps) {
  const saveLabel = t('message.editSave')
  const cancelLabel = t('message.editCancel')
  const save = (): void => {
    if (text.trim() === '') return
    onSave()
  }
  return (
    <div className={css.editor} data-message-edit="">
      <InlineEditor
        value={text}
        label={t('message.edit')}
        onChange={onChange}
        onSave={save}
        onCancel={onCancel}
        className={css.input}
      />
      <div className={css.actions}>
        <Tooltip label={cancelLabel} side="bottom">
          <button type="button" className={css.action} aria-label={cancelLabel} onClick={onCancel}>
            <IconCloseOutlineRegular size={14} />
          </button>
        </Tooltip>
        <Tooltip label={saveLabel} side="bottom">
          {/* An empty edit has nothing to hand to the composer. */}
          <button
            type="button"
            className={css.action}
            aria-label={saveLabel}
            disabled={text.trim() === ''}
            onClick={save}
          >
            <IconCheckOutlineRegular size={14} />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
