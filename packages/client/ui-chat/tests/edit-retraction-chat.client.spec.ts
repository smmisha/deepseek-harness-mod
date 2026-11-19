/** An edited message's retraction over the real Chat definitions and a realistic Inbox history. */
import { describe, expect, it } from 'vitest'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionLiveEventEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import {
  ConversationNodeAssembler,
  type ConversationNodeDefinition,
  type ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { assistantDefinition } from '../src/client/conversation-nodes/assistant.ts'
import { chatViewDefinition } from '../src/client/conversation-nodes/chat-snapshot-builder.ts'
import { unknownFallbackDefinition } from '../src/client/conversation-nodes/fallback.ts'
import { nextStepInboxDefinition, nextTurnInboxDefinition } from '../src/client/conversation-nodes/inbox.ts'
import { messageDefinition } from '../src/client/conversation-nodes/message.ts'
import { turnTailDefinition } from '../src/client/conversation-nodes/turn-tail.ts'
import { processEvidenceDefinition, turnProcessDefinition } from '../src/client/conversation-nodes/turn-process.ts'

const DEFINITIONS: readonly ConversationNodeDefinition[] = [
  nextStepInboxDefinition,
  nextTurnInboxDefinition,
  messageDefinition,
  assistantDefinition,
  turnProcessDefinition,
  processEvidenceDefinition,
  turnTailDefinition,
]

function at(seq: number, type: string, data: unknown, extra: Record<string, unknown> = {}): SessionLiveEventEntry {
  return { type: 'event', event: { seq, time: 1_700_000_000_000 + seq, type, data, ...extra } as unknown as SessionEvent }
}

function input(id: string, text: string, kind = 'user') {
  return { id, role: 'user', content: [{ type: 'text', text }], source: { kind } }
}

/** One complete Turn as AgentLoop logs it: insert, start, claim, step, input, reply, end. */
function turn(seq: number, turnNo: number, message: ReturnType<typeof input>, reply: string): SessionLiveEventEntry[] {
  return [
    at(seq, 'agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message] }),
    at(seq + 1, 'turn/start', { turn: turnNo }),
    at(seq + 2, 'agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] }),
    at(seq + 3, 'step/start', { turn: turnNo, step: 1 }),
    at(seq + 4, 'user/message', message, { surfaceOp: 'append' }),
    at(seq + 5, 'assistant/message', {
      turn: turnNo, step: 1, stream: [],
      message: { id: `reply-${String(turnNo)}`, role: 'assistant', content: [{ type: 'text', text: reply }], source: { kind: 'model', provider: 'p', model: 'm' } },
    }, { surfaceOp: 'append' }),
    at(seq + 6, 'step/end', { turn: turnNo, step: 1 }),
    at(seq + 7, 'turn/end', { turn: turnNo, reason: { kind: 'completed' } }),
  ]
}

function rows(value: ConversationNodeAssembler): string[] {
  value.flush()
  const snapshot = value.snapshot('chat') as ChatSnapshot
  return snapshot.order.flatMap((key) => {
    const node = snapshot.nodes.get(key)
    if (node === undefined) return []
    const data = node.data as { content?: readonly { type: string; text?: string }[] }
    const text = data.content?.flatMap(block => block.type === 'text' ? [block.text] : []).join('') ?? ''
    return [`${node.kind}${text === '' ? '' : `: ${text}`}`]
  })
}

describe('edited-message retraction in Chat', () => {
  it('replaces the edited exchange and keeps later notice-woken Turns classified', () => {
    const history = [
      ...turn(0, 1, input('first', 'first'), 'first reply'),
      ...turn(8, 2, input('second', 'second'), 'second reply'),
    ]
    const edited = [
      at(16, 'user/message', { id: 'rewind', role: 'user', content: [], source: { kind: 'rewind', rpcId: 'edit' } }, {
        surfaceOp: { op: 'replace', startSeq: 4, endSeq: 13 },
      }),
      ...turn(17, 3, input('edited', 'first, edited'), 'edited reply'),
      // A notice wakes the next Turn: its opening input stays a turn trigger.
      ...turn(25, 4, input('notice', 'scheduled check', 'schedule'), 'notice reply'),
    ]
    const value = new ConversationNodeAssembler(
      { entries: () => DEFINITIONS, fallbackEntry: () => unknownFallbackDefinition },
      { entries: (): readonly ConversationViewDefinition[] => [chatViewDefinition] },
    )
    value.replaceWindow(history, false)
    value.activateTarget('chat')
    expect(rows(value).filter(row => row.startsWith('user'))).toEqual(['user: first', 'user: second'])

    for (const entry of edited) value.append(entry)
    const live = rows(value)
    expect(live.filter(row => row.startsWith('user') || row.startsWith('turn-trigger'))).toEqual([
      'user: first, edited', 'turn-trigger: scheduled check',
    ])
    expect(live.join('\n')).not.toMatch(/second|first reply/u)

    // A fresh load of the same log presents the same rows.
    value.replaceWindow([...history, ...edited], false)
    expect(rows(value)).toEqual(live)
  })
})
