// @vitest-environment jsdom
/**
 * The official user row opens an in-place editor from its pencil: opening it
 * touches neither the composer nor the transcript, saving asks the Host to
 * rewind to this message and send the edited text as a new Turn, a refusal keeps
 * the editor open with its reason, cancelling leaves everything as it was, and
 * closing the editor never leaves the keyboard on the body. Any run locks the
 * edit, because saving rewinds the whole Session.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ChatConversationViewNode, UserMessageNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ChatNodeViewProps, UserActionProps, UserContentInput } from '../src/client/contract/slots.ts'
import { EditMessageAction } from '../src/client/chat/EditMessageAction.tsx'
import { UserMessageNodeView } from '../src/client/chat/MessageItem.tsx'
import { en } from '../src/client/locale.ts'
import { unusedImageLoader } from './reasoning-component-fixture.tsx'

const t = makeTranslate(en, commonEn)
const SID = SessionId('session-user-row')
const SHARED = { kind: 'user', principal: { kind: 'share-viewer', shareId: 'share-1', actor: { subjectId: 'subject-42' } } }
const IMAGE_BLOCK = {
  type: 'image',
  attachment: { attachmentId: 'sha256:aa', mediaType: 'image/png', bytes: 1_024, width: 640, height: 320, name: 'shot.png' },
}
const FILE_BLOCK = {
  type: 'file',
  attachment: { attachmentId: 'sha256:bb', name: 'notes.txt', bytes: 2_048 },
}

/** Minimal Session snapshot carrying the run bit the row reads. */
function sessionSnapshot(running: boolean): SessionSnapshot {
  return {
    sessionId: SID,
    pendingSubmissions: [],
    running,
    removed: false,
    openState: 'open',
    openError: null,
    hasMore: false,
    loadingOlder: false,
    historyLoadStatus: 'idle',
    historyWasPartial: false,
    promptError: null,
    blank: false,
    subagent: null,
    lastAgentError: null,
    promptAttempted: true,
    awaitingFirstTurn: false,
  }
}

const renderSlotChain: PropsRenderSlots<'conversation.chat.user.before'>['renderSlotChain'] = (_key, _owner, opts) =>
  opts?.fallback ?? null

interface RowOptions {
  /** The Turn that owns this message: an open one is the message the run reads. */
  readonly turn?: 'open' | 'closed'
  readonly running?: boolean
  /** Replace the official entry with one that opens the editor but grants the row no trigger ref. */
  readonly replacedAffordance?: boolean
  /** Stand-in for the composer's focus hand-off; omitted leaves the keyboard where it was. */
  readonly claimFocus?: () => void
  /** Content blocks appended after the message text, in display order. */
  readonly attachments?: readonly unknown[]
  /** Host answer to the edit; omitted accepts it. */
  readonly editMessage?: (seq: number, text: string) => Promise<void>
}

interface RowBench {
  readonly inputActions: {
    setDraft: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
    submit: ReturnType<typeof vi.fn>
  }
  /** The row's rewind-and-send action. */
  readonly editMessage: ReturnType<typeof vi.fn<(seq: number, text: string) => Promise<void>>>
  /** Every prepared content the row handed to the user content Factory. */
  readonly contentCalls: UserContentInput[]
  readonly setRunning: (running: boolean) => void
}

/** One attachment name the row's content probe rendered. */
function attachmentNames(content: UserContentInput['content']): string[] {
  return content.attachments.map(attachment => attachment.type === 'file'
    ? attachment.file.name
    : 'attachment' in attachment.image
      ? attachment.image.attachment.name ?? ''
      : attachment.image.preview.name ?? '')
}

function renderRow(text = 'hello', options: RowOptions = {}): RowBench {
  const setDraft = vi.fn()
  const focus = vi.fn(options.claimFocus)
  const submit = vi.fn()
  const editMessage = vi.fn<(seq: number, text: string) => Promise<void>>(options.editMessage ?? (() => Promise.resolve()))
  const inputActions = {
    insertQuote: () => false,
    captureInsertion: () => ({ start: 0, end: 0, draftRev: 0 }),
    insertText: () => false,
    setDraft,
    persistDraft: () => {},
    addAttachments: () => true,
    removeAttachment: () => {},
    pruneAttachments: () => {},
    submit,
    focus,
  }
  const contentCalls: UserContentInput[] = []
  const session = createSnapshotStore(sessionSnapshot(options.running ?? false))
  const renderFactorySlot: ChatNodeViewProps['renderFactorySlot'] = (name, input) => {
    if (name === 'conversation.chat.user.content') {
      const content = (input as UserContentInput).content
      contentCalls.push(input as UserContentInput)
      return (
        <span data-content="">
          {content.text}
          {content.attachments.length > 0 && <span data-attachments="">{attachmentNames(content).join(',')}</span>}
        </span>
      )
    }
    if (name === 'conversation.chat.user.actions') {
      const action = input as UserActionProps
      // A third-party replacement owns its own markup, so the row can only fall
      // back to focusing itself when that entry ignores the trigger ref.
      if (options.replacedAffordance === true) {
        return <button type="button" aria-label={t('message.edit')} onClick={action.beginEdit} />
      }
      return (
        <EditMessageAction
          beginEdit={action.beginEdit}
          editUnavailable={action.editUnavailable}
          editTriggerRef={action.editTriggerRef}
          t={t}
        />
      )
    }
    throw new Error(`Unexpected user Factory: ${name}`)
  }
  const data: UserMessageNode = {
    kind: 'user',
    seq: 7,
    time: 7_000,
    content: [{ type: 'text', text }, ...options.attachments ?? []] as never,
    source: SHARED,
  }
  const node = {
    key: `fixture:user:${String(data.seq)}`,
    id: String(data.seq),
    kind: 'user',
    target: 'chat',
    anchorSeq: data.seq,
    location: { kind: 'turn', turn: { turn: 1, status: options.turn ?? 'closed' } },
    visibility: 'visible',
    data,
  } as ChatConversationViewNode
  const props: Partial<Omit<ChatNodeViewProps<'user'>, 'node'>> & { node: ChatConversationViewNode } = {
    node,
    t,
    loadImage: unusedImageLoader,
    renderFactorySlot,
    inputActions,
    editMessage,
    useSession: bindSnapshotSelector(session),
  }
  render(<UserMessageNodeView {...props as ChatNodeViewProps<'user'>} renderSlotChain={renderSlotChain} />)
  return {
    inputActions: { setDraft, focus, submit },
    editMessage,
    contentCalls,
    setRunning: (running) => { act(() => { session.set(sessionSnapshot(running)) }) },
  }
}

function openEditor(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: t('message.edit') }))
  return screen.getByRole('textbox', { name: t('message.edit') })
}

describe('user message row editing', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('opens the editor in place without seeding the composer or sending', () => {
    const bench = renderRow('sent text')
    const field = openEditor()
    expect(field).toHaveProperty('value', 'sent text')
    expect(bench.inputActions.setDraft).not.toHaveBeenCalled()
    expect(bench.inputActions.focus).not.toHaveBeenCalled()
    expect(bench.inputActions.submit).not.toHaveBeenCalled()
    expect(document.querySelector('[data-content]')).toBeNull()
  })

  it('sends the edited text through the Host rewind, never through the composer', async () => {
    const bench = renderRow('sent text')
    const field = openEditor()
    expect(screen.getByText(t('message.editNote'))).toBeDefined()
    fireEvent.change(field, { target: { value: 'sent text, corrected' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: t('message.editSend') })) })
    expect(bench.editMessage).toHaveBeenCalledExactlyOnceWith(7, 'sent text, corrected')
    expect(bench.inputActions.setDraft).not.toHaveBeenCalled()
    expect(bench.inputActions.submit).not.toHaveBeenCalled()
    expect(bench.inputActions.focus).toHaveBeenCalledOnce()
    expect(screen.queryByRole('textbox', { name: t('message.edit') })).toBeNull()
  })

  it('waits on the Host with both actions locked', async () => {
    const answer = Promise.withResolvers<undefined>()
    renderRow('sent text', { editMessage: () => answer.promise })
    const field = openEditor()
    fireEvent.change(field, { target: { value: 'corrected' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: t('message.editSend') })) })
    const send = screen.getByRole('button', { name: t('message.editSend') })
    expect(send).toHaveProperty('disabled', true)
    expect(send.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('button', { name: t('message.editCancel') })).toHaveProperty('disabled', true)
    await act(async () => { answer.resolve(undefined); await answer.promise })
    expect(screen.queryByRole('textbox', { name: t('message.edit') })).toBeNull()
  })

  it('keeps the editor and the typed text open with the Host refusal', async () => {
    const bench = renderRow('sent text', {
      editMessage: () => Promise.reject(new Error('conversation.editMessage failed: session/agent-busy: stop the running turn before editing a message')),
    })
    const field = openEditor()
    fireEvent.change(field, { target: { value: 'corrected' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: t('message.editSend') })) })
    expect(screen.getByRole('alert').textContent)
      .toBe(t('message.editFailed', { reason: 'stop the running turn before editing a message' }))
    expect(screen.getByRole('textbox', { name: t('message.edit') })).toHaveProperty('value', 'corrected')
    expect(screen.queryByText(t('message.editNote'))).toBeNull()
    expect(bench.inputActions.focus).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox', { name: t('message.edit') }), { target: { value: 'corrected again' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('cancels without touching the composer or the message', () => {
    const bench = renderRow('sent text')
    const field = openEditor()
    fireEvent.change(field, { target: { value: 'discarded' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(bench.inputActions.setDraft).not.toHaveBeenCalled()
    expect(bench.inputActions.focus).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: t('message.edit') })).toBeNull()
    expect(document.querySelector('[data-content]')?.textContent).toBe('sent text')
  })

  it('returns focus to the pencil after Cancel, without reopening the editor or scrolling', () => {
    renderRow('sent text')
    const field = openEditor()
    fireEvent.change(field, { target: { value: 'discarded' } })
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')
    fireEvent.click(screen.getByRole('button', { name: t('message.editCancel') }))
    const pencil = screen.getByRole('button', { name: t('message.edit') })
    expect(document.activeElement).toBe(pencil)
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true })
    expect(screen.queryByRole('textbox', { name: t('message.edit') })).toBeNull()
  })

  it('returns focus to the pencil when Escape cancels from the field', () => {
    renderRow('sent text')
    const field = openEditor()
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: t('message.edit') }))
    expect(screen.queryByRole('textbox', { name: t('message.edit') })).toBeNull()
  })

  it('returns focus to the pencil when Escape cancels from the editor action pair', () => {
    renderRow('sent text')
    openEditor()
    const cancel = screen.getByRole('button', { name: t('message.editCancel') })
    cancel.focus()
    fireEvent.keyDown(cancel, { key: 'Escape' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: t('message.edit') }))
    expect(screen.queryByRole('textbox', { name: t('message.edit') })).toBeNull()
  })

  it('returns focus to the message row when the action entry offers no edit trigger', () => {
    renderRow('sent text', { replacedAffordance: true })
    openEditor()
    fireEvent.click(screen.getByRole('button', { name: t('message.editCancel') }))
    const active = document.activeElement
    expect(active?.getAttribute('tabindex')).toBe('-1')
    expect(active?.textContent).toContain('sent text')
  })

  it('keeps a save hand-off in the composer instead of pulling it back to the pencil', async () => {
    const composer = document.createElement('button')
    composer.textContent = 'Type a message'
    document.body.append(composer)
    try {
      renderRow('sent text', { claimFocus: () => { composer.focus() } })
      const field = openEditor()
      fireEvent.change(field, { target: { value: 'corrected' } })
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: t('message.editSend') })) })
      expect(document.activeElement).toBe(composer)
    } finally {
      composer.remove()
    }
  })

  it('never leaves the keyboard on the body after saving', async () => {
    renderRow('sent text')
    const field = openEditor()
    fireEvent.change(field, { target: { value: 'corrected' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: t('message.editSend') })) })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: t('message.edit') }))
    expect(screen.queryByRole('textbox', { name: t('message.edit') })).toBeNull()
  })

  it('locks the message while its own Turn runs', () => {
    const bench = renderRow('sent text', { turn: 'open', running: true })
    const pencil = screen.getByRole('button', { name: t('message.edit') })
    expect(pencil.getAttribute('aria-disabled')).toBe('true')
    expect(pencil.getAttribute('aria-describedby')).toBe(screen.getByText(t('message.editUnavailable')).id)
    fireEvent.click(pencil)
    expect(screen.queryByRole('textbox', { name: t('message.edit') })).toBeNull()
    bench.setRunning(false)
    expect(openEditor()).toHaveProperty('value', 'sent text')
  })

  it('locks an earlier message while a later Turn runs, because saving rewinds the Session', () => {
    const bench = renderRow('sent text', { turn: 'closed', running: true })
    const pencil = screen.getByRole('button', { name: t('message.edit') })
    expect(pencil.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(pencil)
    expect(screen.queryByRole('textbox', { name: t('message.edit') })).toBeNull()
    bench.setRunning(false)
    expect(openEditor()).toHaveProperty('value', 'sent text')
  })

  it('hides an open editor while the run reads the message and restores what was typed', () => {
    const bench = renderRow('sent text', { turn: 'open' })
    const field = openEditor()
    fireEvent.change(field, { target: { value: 'half-typed' } })
    bench.setRunning(true)
    expect(screen.queryByRole('textbox', { name: t('message.edit') })).toBeNull()
    expect(document.querySelector('[data-content]')?.textContent).toBe('sent text')
    bench.setRunning(false)
    expect(screen.getByRole('textbox', { name: t('message.edit') })).toHaveProperty('value', 'half-typed')
  })
})

describe('user message row editing context', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('keeps the message attachments visible above the editor, out of the tab order', () => {
    const bench = renderRow('sent text', { attachments: [IMAGE_BLOCK, FILE_BLOCK] })
    openEditor()
    const context = document.querySelector('[data-message-edit-attachments]')
    expect(context).not.toBeNull()
    // Read-only context for the edit: the attachments stay in view but never
    // join the keyboard order of the editor.
    expect(context?.hasAttribute('inert')).toBe(true)
    expect(context?.textContent).toContain('shot.png')
    expect(context?.textContent).toContain('notes.txt')
    const block = document.querySelector('[data-message-edit-block]')
    expect(block?.firstElementChild).toBe(context)
    expect(block?.lastElementChild?.hasAttribute('data-message-edit')).toBe(true)
    // The attachments are context, so the row never asks the editor to carry them.
    expect(screen.getByRole('textbox', { name: t('message.edit') })).toHaveProperty('value', 'sent text')
    expect(bench.contentCalls.at(-1)?.content).toMatchObject({ text: '', extraBlocks: [] })
    expect(bench.contentCalls.at(-1)?.content.attachments).toHaveLength(2)
  })

  it('edits only the text and leaves the message attachments in place', async () => {
    const bench = renderRow('sent text', { attachments: [IMAGE_BLOCK] })
    const field = openEditor()
    fireEvent.change(field, { target: { value: 'sent text, corrected' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: t('message.editSend') })) })
    // Only the text travels: the Host keeps the message's own attachments. Until the
    // retraction arrives, the resting row renders them with the unchanged text.
    expect(bench.editMessage).toHaveBeenCalledExactlyOnceWith(7, 'sent text, corrected')
    const restored = bench.contentCalls.at(-1)?.content
    expect(restored?.text).toBe('sent text')
    expect(restored?.attachments).toHaveLength(1)
    expect(document.querySelector('[data-message-edit-attachments]')).toBeNull()
    expect(document.querySelector('[data-attachments]')?.textContent).toBe('shot.png')
  })

  it('opens no attachment context for a message that has none', () => {
    renderRow('sent text')
    openEditor()
    expect(document.querySelector('[data-message-edit-attachments]')).toBeNull()
    expect(document.querySelector('[data-message-edit-block]')?.children).toHaveLength(1)
  })
})
