/** In-place editor for one sent user message, with explicit save and cancel. */
import type { KeyboardEvent } from 'react'
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
  /** Save action label; defaults to applying the edited text. */
  readonly saveLabel?: string
  /** Consequence of saving, shown beside the action pair. */
  readonly note?: string
  /** Refusal of the last save, shown in place of the note. */
  readonly error?: string
  /** A save is in flight: both actions wait and the field stays as typed. */
  readonly busy?: boolean
}

/**
 * Render the message's text in a multi-line editor. Enter saves, Shift+Enter
 * breaks the line, Escape cancels, and the action pair repeats both gestures for
 * pointer users; an empty edit cannot be saved. Escape cancels wherever focus
 * sits inside the editor, including its Save and Cancel buttons, and is consumed
 * there so no enclosing surface closes with it.
 * @param props - edited text, its callbacks, and the Chat copy seat.
 * @returns the editor field and its action pair.
 */
export function EditMessageEditor({
  text, onChange, onSave, onCancel, t, saveLabel = t('message.editSave'), note, error, busy = false,
}: EditMessageEditorProps) {
  const cancelLabel = t('message.editCancel')
  const save = (): void => {
    if (text.trim() === '' || busy) return
    onSave()
  }
  // Capture so the editor owns the key before the field handler or any ancestor
  // sees it; Escape means "leave the editor" wherever its keyboard sits.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onCancel()
  }
  return (
    <div className={css.editor} data-message-edit="" onKeyDownCapture={onKeyDown}>
      <div className={css.field}>
        {/*
          * The field's width comes from the draft, not from the row: a textarea's
          * intrinsic width follows its cols attribute rather than its value, so
          * this hidden copy of the text carries the bubble's width family while
          * the field itself overlays it. It holds no keyboard or pointer target.
          */}
        <span className={css.sizer} aria-hidden="true" dir="auto">{text}</span>
        <InlineEditor
          value={text}
          label={t('message.edit')}
          onChange={onChange}
          onSave={save}
          onCancel={onCancel}
          className={css.input}
        />
      </div>
      <div className={css.footer}>
        {error === undefined
          ? note === undefined ? null : <span className={css.note}>{note}</span>
          : <span className={css.error} role="alert">{error}</span>}
        <div className={css.actions}>
          <Tooltip label={cancelLabel} side="bottom">
            <button type="button" className={`${css.action} ${css.cancel}`} aria-label={cancelLabel} disabled={busy} onClick={onCancel}>
              <IconCloseOutlineRegular size={14} />
            </button>
          </Tooltip>
          <Tooltip label={saveLabel} side="bottom">
            {/* An empty edit has nothing to apply or send. */}
            <button
              type="button"
              className={`${css.action} ${css.save}`}
              aria-label={saveLabel}
              disabled={text.trim() === '' || busy}
              aria-busy={busy || undefined}
              onClick={save}
            >
              <IconCheckOutlineRegular size={14} />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
