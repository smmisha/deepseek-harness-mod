import { describe, expect, it } from 'vitest'
import { commitThreadState, estimateTokens, planSync, toolResultPrompt } from '../src/kernel/context-window.ts'
import { normalizeHistory } from '../src/kernel/messages.ts'
import type { ContextPolicy, NormalizedMessage, ThreadState, WireMessage } from '../src/types.ts'

const policy: ContextPolicy = { maxMessages: 10, maxTokens: 10_000, replayTail: 2, maxCharsPerMessage: 4_000 }
const now = '2026-01-01T00:00:00.000Z'

/** Normalize a caller history exactly as the kernel does. */
function history(messages: readonly WireMessage[]): NormalizedMessage[] {
  return normalizeHistory(messages, policy.maxCharsPerMessage)
}

/** Build the state a previous turn would have committed for one history. */
function stateOf(messages: readonly WireMessage[], generation = 1): ThreadState {
  return {
    id: 'thread',
    generation,
    webSessionId: 'web-1',
    synced: history(messages).map(message => message.fingerprint),
    tokens: 10,
    turns: 1,
    createdAt: now,
    updatedAt: now,
  }
}

const firstTurn: readonly WireMessage[] = [
  { role: 'system', content: 'You are a coding agent.' },
  { role: 'user', content: 'read the file' },
]

const extended: readonly WireMessage[] = [
  ...firstTurn,
  { role: 'assistant', content: 'The file contains a router.' },
  { role: 'user', content: 'now change it' },
]

describe('context planner', () => {
  it('rotates on the first turn and sends the messages without a restoration envelope', () => {
    const plan = planSync(undefined, history(extended), policy)
    expect(plan.kind).toBe('rotate')
    if (plan.kind !== 'rotate') throw new Error('expected rotation')
    expect(plan.reason).toBe('first-turn')
    expect(plan.outgoing[0]?.text).toContain('You are a coding agent.')
    expect(plan.outgoing[0]?.text).not.toContain('<recent_conversation>')
    expect(plan.outgoing.some(message => message.text.includes('now change it'))).toBe(true)
  })

  it('reuses the live session and sends only the delta', () => {
    const state = stateOf(firstTurn)
    const plan = planSync(state, history(extended), policy)
    expect(plan.kind).toBe('reuse')
    if (plan.kind !== 'reuse') throw new Error('expected reuse')
    expect(plan.outgoing[0]?.text).toBe('now change it')
  })

  it('skips an assistant echo, which the web chat already holds', () => {
    const state = stateOf(firstTurn)
    const echoOnly: readonly WireMessage[] = [...firstTurn, { role: 'assistant', content: 'The file contains a router.' }]
    const plan = planSync(state, history(echoOnly), policy)
    expect(plan.kind).toBe('reuse')
    if (plan.kind !== 'reuse') throw new Error('expected reuse')
    expect(plan.outgoing[0]?.text).toBe('Continue from your last message.')
  })

  it('rotates when the caller history diverges from what was delivered', () => {
    const state = stateOf(firstTurn)
    const rewritten: readonly WireMessage[] = [
      { role: 'user', content: 'something else entirely' },
    ]
    const plan = planSync(state, history(rewritten), policy)
    expect(plan.kind).toBe('rotate')
    if (plan.kind !== 'rotate') throw new Error('expected rotation')
    expect(plan.reason).toBe('diverged')
  })

  it('rotates when no live web session remains', () => {
    const state = stateOf(firstTurn)
    const plan = planSync(state, history(extended), policy, false)
    expect(plan.kind).toBe('rotate')
    if (plan.kind !== 'rotate') throw new Error('expected rotation')
    expect(plan.reason).toBe('diverged')
  })

  it('rotates on the message budget and on the token budget', () => {
    const tightMessages = planSync(stateOf(firstTurn), history(extended), { ...policy, maxMessages: 2 })
    expect(tightMessages.kind).toBe('rotate')
    if (tightMessages.kind !== 'rotate') throw new Error('expected rotation')
    expect(tightMessages.reason).toBe('message-limit')

    const tightTokens = planSync(stateOf(firstTurn), history(extended), { ...policy, maxTokens: 1 })
    expect(tightTokens.kind).toBe('rotate')
    if (tightTokens.kind !== 'rotate') throw new Error('expected rotation')
    expect(tightTokens.reason).toBe('overflow')
  })

  it('commits the sent history and increments the generation after a rotation', () => {
    const previous = stateOf(firstTurn)
    const reused = commitThreadState(previous, history(extended), policy, 'web-2', false, now)
    expect(reused.generation).toBe(1)
    expect(reused.synced).toHaveLength(history(extended).length)
    expect(reused.turns).toBe(2)

    const rotated = commitThreadState(previous, history(extended), policy, 'web-3', true, now)
    expect(rotated.generation).toBe(2)
    expect(rotated.webSessionId).toBe('web-3')
  })

  it('nudges a live session to continue when nothing new arrived', () => {
    const state = stateOf(firstTurn)
    const plan = planSync(state, history(firstTurn), policy)
    expect(plan.kind).toBe('reuse')
    expect(plan.outgoing).toHaveLength(1)
  })

  it('digests older turns by their first line, shortening long ones, when a session rotates', () => {
    const long = `${'w'.repeat(200)}\nsecond line`
    const plan = planSync(undefined, history([{ role: 'user', content: 'one' }]), policy)
    expect(plan.kind).toBe('rotate')
    const rotated = planSync(stateOf([{ role: 'user', content: 'other' }]), history([
      { role: 'user', content: long }, { role: 'assistant', content: 'short' }, { role: 'user', content: 'a' }, { role: 'user', content: 'b' },
    ]), policy)
    const prompt = rotated.kind === 'rotate' ? rotated.outgoing.map(part => part.text).join('\n') : ''
    expect(prompt).toContain(`- user: ${'w'.repeat(160)}…`)
    expect(prompt).not.toContain('second line')
    expect(prompt).toContain('- assistant: short')
  })

  it('starts a thread at generation one without a previous state and renders tool results', () => {
    const first = commitThreadState(undefined, history(firstTurn), policy, 'web-1', false, now)
    expect(first.generation).toBe(1)
    expect(first.id).toBe('thread')
    expect(toolResultPrompt('c1', 'read', 'ok')).toBe('<tool_result call_id="c1" name="read">\nok\n</tool_result>')
  })

  it('estimates tokens monotonically', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('four')).toBe(1)
    expect(estimateTokens('x'.repeat(401))).toBeGreaterThan(estimateTokens('x'.repeat(400)))
  })
})
