/** Editing a sent user message over the real AgentLoop and the Session Remote owner. */
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { expect, it, onTestFinished, vi } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import type { SessionEditMessageRequest, SessionRequestId } from '../src/types.ts'
import { createSessionTestRemote } from './test-remote.ts'

async function setup(replies: readonly string[]) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new MockAdapter(replies.map(reply => textResponse(reply)))
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  const remote = await createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'mock', model: 'mock' }), cwd: '/workspace' })
  const agent = await ctx.agentLoop.create(SessionId('edit-message'), { provider: 'mock', model: 'mock' })
  const send = async (text: string): Promise<void> => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }
  const sentSeq = (text: string): number => {
    const event = agent.session.snapshotEvents().find(candidate => candidate.type === 'user/message'
      && candidate.data.content.some(block => block.type === 'text' && block.text === text))
    if (event === undefined) throw new Error(`no user message "${text}"`)
    return event.seq
  }
  const edit = (seq: number, text: string, id = 'edit-1'): SessionEditMessageRequest => ({
    sessionId: agent.id, requestId: id as SessionRequestId, seq, text,
  })
  return { ctx, remote, agent, adapter, send, sentSeq, edit }
}

/** Text of every model-visible message in one request, in order. */
function transcript(messages: MockAdapter['requests'][number]['messages']): string[] {
  return messages.flatMap(message => message.role === 'system'
    ? []
    : [`${message.role}: ${message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')}`])
}

function rewinds(events: readonly SessionEvent[]): SessionEvent<'user/message'>[] {
  return events.flatMap(event => event.type === 'user/message' && event.data.source.kind === 'rewind' ? [event] : [])
}

it('retracts the edited Turn and every later message, then answers the edited text', async () => {
  const { remote, agent, adapter, send, sentSeq, edit } = await setup(['first reply', 'second reply', 'edited reply'])
  await send('first')
  await send('second')
  expect((await remote.editMessage(edit(sentSeq('first'), 'first, edited'))).ok).toBe(true)
  await agent.whenIdle()

  expect(adapter.requests).toHaveLength(3)
  expect(transcript(adapter.requests[2]!.messages)).toEqual(['user: first, edited'])
  const events = agent.session.snapshotEvents()
  const [rewind] = rewinds(events)
  expect(rewind).toMatchObject({
    data: { content: [], source: { kind: 'rewind', rpcId: 'edit-1' } },
    surfaceOp: { op: 'replace', startSeq: sentSeq('first') },
  })
  // The retraction lands between Turns, and the edited message opens its own balanced Turn.
  const after = events.slice(rewind!.seq + 1)
  expect(after.filter(event => event.type === 'turn/start')).toHaveLength(1)
  expect(after.find(event => event.type === 'user/message')).toMatchObject({
    surfaceOp: 'append',
    data: { content: [{ type: 'text', text: 'first, edited' }], source: { kind: 'user', rpcId: 'edit-1' } },
  })
  expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
})

it('keeps earlier exchanges and deduplicates a repeated request', async () => {
  const { remote, agent, adapter, send, sentSeq, edit } = await setup(['first reply', 'second reply', 'edited reply'])
  await send('first')
  await send('second')
  const request = edit(sentSeq('second'), 'second, edited')
  expect((await remote.editMessage(request)).ok).toBe(true)
  await agent.whenIdle()
  expect((await remote.editMessage(request)).ok).toBe(true)
  await agent.whenIdle()

  expect(adapter.requests).toHaveLength(3)
  expect(transcript(adapter.requests[2]!.messages))
    .toEqual(['user: first', 'assistant: first reply', 'user: second, edited'])
  expect(rewinds(agent.session.snapshotEvents())).toHaveLength(1)
})

it('accepts a concurrent copy of the request once the first copy has started its Turn', async () => {
  const { remote, agent, adapter, send, sentSeq, edit } = await setup(['reply', 'edited reply'])
  await send('draft')
  const request = edit(sentSeq('draft'), 'better')
  const results = await Promise.all([remote.editMessage(request), remote.editMessage(request)])
  expect(results.map(result => result.ok)).toEqual([true, true])
  await agent.whenIdle()
  expect(adapter.requests).toHaveLength(2)
  expect(rewinds(agent.session.snapshotEvents())).toHaveLength(1)
})

it('edits an already edited message again', async () => {
  const { remote, agent, adapter, send, sentSeq, edit } = await setup(['reply', 'edited reply', 'twice edited reply'])
  await send('draft')
  expect((await remote.editMessage(edit(sentSeq('draft'), 'better'))).ok).toBe(true)
  await agent.whenIdle()
  expect((await remote.editMessage(edit(sentSeq('better'), 'best', 'edit-2'))).ok).toBe(true)
  await agent.whenIdle()

  expect(transcript(adapter.requests[2]!.messages)).toEqual(['user: best'])
  expect(rewinds(agent.session.snapshotEvents())).toHaveLength(2)
})

it('refuses events that are not sent user messages, blank text, and pending input without retracting', async () => {
  const { remote, agent, adapter, send, sentSeq, edit } = await setup(['reply'])
  await send('first')
  const turnEnd = agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')!

  const notUser = await remote.editMessage(edit(turnEnd.seq, 'x'))
  expect(notUser.ok ? undefined : notUser.error).toMatchObject({ code: 'session/edit-unavailable', details: { reason: 'NOT_A_USER_MESSAGE' } })
  const blank = await remote.editMessage(edit(sentSeq('first'), '   '))
  expect(blank.ok ? undefined : blank.error.code).toBe('gateway/bad-request')
  const negative = await remote.editMessage(edit(-1, 'x'))
  expect(negative.ok ? undefined : negative.error.code).toBe('gateway/bad-request')

  agent.inbox.append('next-turn', createUserMessage({ content: [{ type: 'text', text: 'queued' }], source: { kind: 'user' } }))
  const pending = await remote.editMessage(edit(sentSeq('first'), 'x'))
  expect(pending.ok ? undefined : pending.error).toMatchObject({ code: 'session/edit-unavailable', details: { reason: 'PENDING_INPUT' } })
  agent.inbox.clear()

  await agent.runMaintenance(async () => {
    const busy = await remote.editMessage(edit(sentSeq('first'), 'x'))
    expect(busy.ok ? undefined : busy.error.code).toBe('session/agent-busy')
  })
  expect(rewinds(agent.session.snapshotEvents())).toHaveLength(0)
  expect(adapter.requests).toHaveLength(1)
})

it('refuses a user message that did not open its Turn', async () => {
  const { remote, agent, edit } = await setup([])
  const opener = agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'opener' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  const later = agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'steered' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  const refused = await remote.editMessage(edit(later.seq, 'x'))
  expect(refused.ok ? undefined : refused.error).toMatchObject({ code: 'session/edit-unavailable', details: { reason: 'NOT_A_USER_MESSAGE' } })
  expect(opener.seq).toBeLessThan(later.seq)
  expect(rewinds(agent.session.snapshotEvents())).toHaveLength(0)
})

it('reports an unreadable Session history without retracting', async () => {
  const { ctx, remote, agent, send, sentSeq, edit } = await setup(['reply'])
  await send('first')
  vi.spyOn(ctx.sessionQuery, 'observeSession').mockRejectedValueOnce(new Error('disk unavailable'))
  const failed = await remote.editMessage(edit(sentSeq('first'), 'x'))
  expect(failed.ok ? undefined : failed.error.code).toBe('gateway/internal')
  expect(rewinds(agent.session.snapshotEvents())).toHaveLength(0)
})

it('refuses a message that a retraction already removed from the model-visible surface', async () => {
  const { remote, agent, send, sentSeq, edit } = await setup(['first reply', 'second reply', 'edited reply'])
  await send('first')
  await send('second')
  const second = sentSeq('second')
  expect((await remote.editMessage(edit(sentSeq('first'), 'replacement'))).ok).toBe(true)
  await agent.whenIdle()

  const stale = await remote.editMessage(edit(second, 'x', 'edit-2'))
  expect(stale.ok ? undefined : stale.error).toMatchObject({ code: 'session/edit-unavailable', details: { reason: 'NOT_ON_SURFACE' } })
})
