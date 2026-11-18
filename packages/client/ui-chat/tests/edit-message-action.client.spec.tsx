// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { EditMessageAction } from '../src/client/chat/EditMessageAction.tsx'
import { en } from '../src/client/locale.ts'

const t = makeTranslate(en, commonEn)

/** Complete input-action face with the two verbs this entry calls observable. */
function inputActions(): { actions: InputActions; setDraft: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> } {
  const setDraft = vi.fn()
  const focus = vi.fn()
  const actions: InputActions = {
    insertQuote: () => true,
    captureInsertion: () => ({ start: 0, end: 0, draftRev: 0 }),
    insertText: () => true,
    setDraft,
    persistDraft: () => {},
    addAttachments: () => true,
    removeAttachment: () => {},
    pruneAttachments: () => {},
    submit: () => {},
    focus,
  }
  return { actions, setDraft, focus }
}

describe('user message edit action', () => {
  afterEach(cleanup)

  it('seeds the composer with the message text and focuses it', () => {
    const { actions, setDraft, focus } = inputActions()
    render(<EditMessageAction text="Проверка связи" inputActions={actions} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: t('message.edit') }))
    expect(setDraft).toHaveBeenCalledExactlyOnceWith('Проверка связи')
    expect(focus).toHaveBeenCalledOnce()
  })
})
