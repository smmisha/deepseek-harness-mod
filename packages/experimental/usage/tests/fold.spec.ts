/** Usage fold: attribution, attempt replacement, retries, and agreement with token-meter's projection. */
import { Context } from '@deepseek-ai/cordis'
import { createMessage, type TokenUsage } from '@deepseek-ai/dsh-llm'
import { RetryId } from '@deepseek-ai/dsh-llm-retry'
import SessionStore, { type Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import { describe, expect, it } from 'vitest'
import { foldUsage, INITIAL_FOLD, totalTokens } from '../src/fold.ts'

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(TokenMeter)
  return { ctx, session: ctx.sessions.create() }
}

const usage = (inputTokens: number, outputTokens: number, cacheReadTokens?: number, cacheWriteTokens?: number): TokenUsage => ({
  inputTokens, outputTokens,
  ...cacheReadTokens === undefined ? {} : { cacheReadTokens },
  ...cacheWriteTokens === undefined ? {} : { cacheWriteTokens },
})

function attempt(session: Session, sample: TokenUsage, turn: number, step: number): void {
  session.append('assistant/attempt', { turn, step, stream: [{ type: 'chunk', time: 0, chunk: { type: 'usage', usage: sample } }] })
}

function settle(session: Session, sample: TokenUsage | undefined, turn: number, step: number): void {
  session.append('assistant/message', {
    stream: sample === undefined ? [] : [{ type: 'chunk', time: 0, chunk: { type: 'usage', usage: sample } }],
    turn, step,
    message: createMessage({ role: 'assistant', content: [], source: { kind: 'model', provider: 'mock', model: 'mock' } }),
    ...sample === undefined ? {} : { usage: sample },
  }, { surfaceOp: 'append' })
}

const projected = (ctx: Context, session: Session): TokenUsageProjection => ctx.sessionProjections.snapshot(session).values.tokenUsage!

describe('foldUsage', () => {
  it('agrees with the tokenUsage projection across replacement, retries, and settlements without usage', async () => {
    const { ctx, session } = await harness()
    session.append('request/context', { provider: 'opencode-go', model: 'hy4' })
    session.append('step/start', { turn: 1, step: 1 })
    attempt(session, usage(10, 2, 3), 1, 1)
    attempt(session, usage(12, 4, 3, 1), 1, 1)
    session.append('llm/retry-started', { retryId: RetryId('r1'), turn: 1, step: 1, retry: 1 })
    session.append('llm/retry-started', { retryId: RetryId('r2'), turn: 1, step: 1, retry: 2 })
    settle(session, usage(20, 5), 1, 1)
    session.append('step/end', { turn: 1, step: 1 })
    session.append('request/context', { provider: 'deepseek-official', model: 'deepseek-chat' })
    session.append('step/start', { turn: 1, step: 2 })
    session.append('llm/retry-started', { retryId: RetryId('r3'), turn: 1, step: 2, retry: 1 })
    settle(session, undefined, 1, 2)
    settle(session, usage(7, 1), 1, 2)
    session.append('step/end', { turn: 1, step: 2 })
    const { calls, state } = foldUsage(session.ownEvents())
    const totals = projected(ctx, session)
    const sum = (field: 'input' | 'cacheRead' | 'cacheWrite' | 'output') => calls.reduce((total, call) => total + call[field], 0)
    expect({ uncachedInputTokens: sum('input'), cacheReadTokens: sum('cacheRead'), cacheWriteTokens: sum('cacheWrite'), outputTokens: sum('output') }).toEqual(totals)
    expect(calls.map(call => [call.key, call.provider, call.model])).toEqual([
      ['1:1:0', 'opencode-go', 'hy4'], ['1:1:2', 'opencode-go', 'hy4'], ['1:2:1', 'deepseek-official', 'deepseek-chat'],
    ])
    expect(state).toEqual({ provider: 'deepseek-official', model: 'deepseek-chat', retry: { turn: 1, step: 2, count: 1 } })
  })

  it('resumes from a carried state and ignores unusable counts', () => {
    const resumed = foldUsage([], { ...INITIAL_FOLD, provider: 'p', model: 'm' })
    expect(resumed).toEqual({ calls: [], state: { provider: 'p', model: 'm', retry: null } })
    const odd = foldUsage([{
      seq: 1, time: 5, type: 'assistant/attempt',
      data: { turn: 2, step: 1, stream: [{ type: 'chunk', time: 0, chunk: { type: 'usage', usage: { inputTokens: -1, outputTokens: 1.5 } } }] },
    } as never], { provider: 'p', model: 'm', retry: { turn: 1, step: 1, count: 3 } })
    expect(odd.calls).toEqual([{ key: '2:1:0', time: 5, provider: 'p', model: 'm', input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }])
    expect(totalTokens({ input: 1, cacheRead: 2, cacheWrite: 3, output: 4 })).toBe(10)
  })
})
