// @vitest-environment jsdom
/**
 * The official user row opens an in-place editor from its pencil: opening it
 * touches neither the composer nor the transcript, saving hands the edited text
 * to the composer draft without sending, and cancelling leaves everything as it
 * was. Only the message the running agent is reading is locked; an earlier or
 * queued message stays editable.
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
}

interface RowBench {
  readonly inputActions: {
    setDraft: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
    submit: ReturnType<typeof vi.fn>
  }
  readonly setRunning: (running: boolean) => void
}

function renderRow(text = 'hello', options: RowOptions = {}): RowBench {
  const setDraft = vi.fn()
  const focus = vi.fn()
  const submit = vi.fn()
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
  const session = createSnapshotStore(sessionSnapshot(options.running ?? false))
  const renderFactorySlot: ChatNodeViewProps['renderFactorySlot'] = (name, input) => {
    if (name === 'conversation.chat.user.content') {
      return <span data-content="">{(input as UserContentInput).content.text}</span>
    }
    if (name === 'conversation.chat.user.actions') {
      const action = input as UserActionProps
      return <EditMessageAction beginEdit={action.beginEdit} editUnavailable={action.editUnavailable} t={t} />
    }
    throw new Error(`Unexpected user Factory: ${name}`)
  }
  const data: UserMessageNode = {
    kind: 'user',
    seq: 7,
    time: 7_000,
    content: [{ type: 'text', text }] as never,
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
    useSession: bindSnapshotSelector(session),
  }
  render(<UserMessageNodeView {...props as ChatNodeViewProps<'user'>} renderSlotChain={renderSlotChain} />)
  return {
    inputActions: { setDraft, focus, submit },
    setRunning: (running) => { act(() => { session.set(sessionSnapshot(running)) }) },
  }
}

function openEditor(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: t('message.edit') }))
  return screen.getByRole('textbox', { name: t('message.edit') })
}

describe('user message row editing', () => {
  afterEach(cleanup)

  it('opens the editor in place without seeding the composer or sending', () => {
    const bench = renderRow('sent text')
    const field = openEditor()
    expect(field).toHaveProperty('value', 'sent text')
    expect(bench.inputActions.setDraft).not.toHaveBeenCalled()
    expect(bench.inputActions.focus).not.toHaveBeenCalled()
    expect(bench.inputActions.submit).not.toHaveBeenCalled()
    expect(document.querySelector('[data-content]')).toBeNull()
  })

  it('saves the edited text into the composer draft without sending it', () => {
    const bench = renderRow('sent text')
    const field = openEditor()
    fireEvent.change(field, { target: { value: 'sent text, corrected' } })
    fireEvent.click(screen.getByRole('button', { name: t('message.editSave') }))
    expect(bench.inputActions.setDraft).toHaveBeenCalledExactlyOnceWith('sent text, corrected')
    expect(bench.inputActions.focus).toHaveBeenCalledOnce()
    expect(bench.inputActions.submit).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: t('message.edit') })).toBeNull()
    expect(document.querySelector('[data-content]')?.textContent).toBe('sent text')
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

  it('locks only the message its running Turn is reading', () => {
    const bench = renderRow('sent text', { turn: 'open', running: true })
    const pencil = screen.getByRole('button', { name: t('message.edit') })
    expect(pencil.getAttribute('aria-disabled')).toBe('true')
    expect(pencil.getAttribute('aria-describedby')).toBe(screen.getByText(t('message.editUnavailable')).id)
    fireEvent.click(pencil)
    expect(screen.queryByRole('textbox', { name: t('message.edit') })).toBeNull()
    bench.setRunning(false)
    expect(openEditor()).toHaveProperty('value', 'sent text')
  })

  it('keeps an earlier message editable while another Turn runs', () => {
    // The message is not what the agent reads: a settled Turn stays editable, and
    // a queued message keeps its own QueueDock editor.
    renderRow('sent text', { turn: 'closed', running: true })
    const pencil = screen.getByRole('button', { name: t('message.edit') })
    expect(pencil.getAttribute('aria-disabled')).toBeNull()
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
