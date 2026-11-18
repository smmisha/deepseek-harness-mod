// @vitest-environment jsdom
/** The in-place message editor: explicit save and cancel, with keyboard parity. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { EditMessageEditor } from '../src/client/chat/EditMessageEditor.tsx'
import { en } from '../src/client/locale.ts'

const t = makeTranslate(en, commonEn)

function editor(text = 'hello') {
  const onChange = vi.fn()
  const onSave = vi.fn()
  const onCancel = vi.fn()
  render(<EditMessageEditor text={text} onChange={onChange} onSave={onSave} onCancel={onCancel} t={t} />)
  const field = screen.getByRole('textbox', { name: t('message.edit') })
  return { onChange, onSave, onCancel, field }
}

describe('message editor', () => {
  afterEach(cleanup)

  it('reports every keystroke and starts from the message text', () => {
    const { onChange, field } = editor('sent text')
    expect(field).toHaveProperty('value', 'sent text')
    fireEvent.change(field, { target: { value: 'sent text, edited' } })
    expect(onChange).toHaveBeenCalledExactlyOnceWith('sent text, edited')
  })

  it('saves on Enter and keeps Shift+Enter for a line break', () => {
    const { onSave, onCancel, field } = editor()
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true })
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onSave).toHaveBeenCalledOnce()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('cancels on Escape without saving', () => {
    const { onSave, onCancel, field } = editor()
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves and cancels through the action pair', () => {
    const { onSave, onCancel } = editor()
    fireEvent.click(screen.getByRole('button', { name: t('message.editSave') }))
    expect(onSave).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: t('message.editCancel') }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('refuses an empty edit from both the button and Enter', () => {
    const { onSave, field } = editor('   ')
    expect(screen.getByRole('button', { name: t('message.editSave') })).toHaveProperty('disabled', true)
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onSave).not.toHaveBeenCalled()
  })
})
