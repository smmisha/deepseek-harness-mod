/** An edited message's retraction hides the retracted Turns from every View, live and on load. */
import { describe, expect, it } from 'vitest'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConversationNodeDefinition, ConversationViewDefinition, ConversationViewNode } from '@deepseek-ai/dsh-client-ui-conversation/client'

function at(seq: number, type: string, data: unknown, extra: Record<string, unknown> = {}): SessionEventLikeEntry {
  return { type: 'event', event: { seq: SessionSeq(seq), time: seq, type, data, ...extra } as SessionEvent }
}

function user(seq: number, text: string): SessionEventLikeEntry {
  return at(seq, 'user/message', { id: `m${String(seq)}`, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }, { surfaceOp: 'append' })
}

function reply(seq: number, text: string): SessionEventLikeEntry {
  return at(seq, 'assistant/message', { turn: 0, step: 1, message: { id: `a${String(seq)}`, role: 'assistant', content: [{ type: 'text', text }] } }, { surfaceOp: 'append' })
}

function retraction(seq: number, startSeq: number, endSeq: number): SessionEventLikeEntry {
  return at(seq, 'user/message', { id: `r${String(seq)}`, role: 'user', content: [], source: { kind: 'rewind', rpcId: 'edit' } }, {
    surfaceOp: { op: 'replace', startSeq, endSeq },
  })
}

/** Every text-bearing message renders one node holding its text. */
const textNodes: ConversationNodeDefinition<string> = {
  kind: 'text',
  target: 'test',
  match: (event) => {
    if (event.type !== 'user/message' && event.type !== 'assistant/message') return null
    return { id: String(event.seq), role: 'start' }
  },
  start: (_context, match) => {
    const event = match.event as SessionEvent
    const content = event.type === 'user/message'
      ? event.data.content
      : (event.data as { message: { content: readonly ContentBlock[] } }).message.content
    return content.map(block => block.type === 'text' ? block.text : '').join('')
  },
  update: context => context.state,
  buildViewNode: context => context.state === undefined || context.state === ''
    ? null
    : { key: context.key, kind: context.kind, id: context.id, target: 'test', data: context.state },
}

const view: ConversationViewDefinition<ConversationViewNode, readonly string[]> = {
  target: 'test',
  create: () => {
    let current: readonly string[] = []
    return {
      empty: current,
      replace: ({ nodes }) => (current = nodes.map(node => String(node.data))),
      apply: ({ upserts }) => (current = [...current, ...upserts.map(node => String(node.data))]),
    }
  },
}

function assembler(): ConversationNodeAssembler {
  const created = new ConversationNodeAssembler(
    { entries: () => [textNodes], fallbackEntry: () => undefined },
    { entries: () => [view] },
  )
  created.activateTarget('test')
  return created
}

function texts(target: ConversationNodeAssembler): readonly string[] {
  target.flush()
  return target.snapshot('test') as readonly string[]
}

/** Two settled Turns: "first" (seq 0 to 3) and "second" (seq 4 to 7). */
const twoTurns: readonly SessionEventLikeEntry[] = [
  at(0, 'turn/start', { turn: 1 }), user(1, 'first'), reply(2, 'first reply'), at(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  at(4, 'turn/start', { turn: 2 }), user(5, 'second'), reply(6, 'second reply'), at(7, 'turn/end', { turn: 2, reason: { kind: 'completed' } }),
]

/** Editing "first" retracts both Turns and opens a third with the edited text. */
const editedFirst: readonly SessionEventLikeEntry[] = [
  retraction(8, 1, 6),
  at(9, 'turn/start', { turn: 3 }), user(10, 'first, edited'), reply(11, 'edited reply'), at(12, 'turn/end', { turn: 3, reason: { kind: 'completed' } }),
]

describe('edited-message retraction', () => {
  it('drops the retracted Turns when the retraction arrives live', () => {
    const target = assembler()
    target.replaceWindow(twoTurns, false)
    expect(texts(target)).toEqual(['first', 'first reply', 'second', 'second reply'])
    for (const entry of editedFirst) target.append(entry)
    expect(texts(target)).toEqual(['first, edited', 'edited reply'])
    expect(target.openTurn()).toBeUndefined()
  })

  it('keeps earlier Turns when a later message is edited', () => {
    const target = assembler()
    target.replaceWindow([...twoTurns, retraction(8, 5, 6), at(9, 'turn/start', { turn: 3 }), user(10, 'second, edited')], false)
    expect(texts(target)).toEqual(['first', 'first reply', 'second, edited'])
    expect(target.openTurn()).toBe(3)
  })

  it('hides a retracted Turn whose start an older page supplies later', () => {
    const target = assembler()
    const editedSecond = [
      retraction(8, 5, 6),
      at(9, 'turn/start', { turn: 3 }), user(10, 'second, edited'), reply(11, 'edited reply'),
      at(12, 'turn/end', { turn: 3, reason: { kind: 'completed' } }),
    ]
    // The window opens inside the retracted Turn, before its start: the loaded part of it is hidden.
    target.replaceWindow([...twoTurns.slice(5), ...editedSecond], true)
    expect(texts(target)).toEqual(['second, edited', 'edited reply'])
    // The older page brings the retracted Turn's start and the untouched first Turn.
    target.prepend(twoTurns.slice(0, 5), false)
    expect(texts(target)).toEqual(['first', 'first reply', 'second, edited', 'edited reply'])
  })
})
