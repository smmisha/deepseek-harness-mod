/**
 * Graceful stop: the run finishes the in-flight model response and the tool
 * batch it requested, records both, and closes the turn as `stopped` without
 * freezing a partial stream. Immediate cancellation remains the abort path.
 * @module dsh-agent-loop/tests/graceful-stop
 */
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import {
  LlmAdapter, createUserMessage,
  type GenerateOptions, type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter.ts'

async function harness(adapter: LlmAdapter) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function send(agent: Agent, text: string) {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

function turnEnds(agent: Agent) {
  return agent.session.snapshotEvents()
    .flatMap(event => event.type === 'turn/end' ? [event.data.reason] : [])
}

function assistantMessages(agent: Agent) {
  return agent.session.snapshotEvents()
    .flatMap(event => event.type === 'assistant/message' ? [event.data] : [])
}

function assistantText(agent: Agent): string {
  return assistantMessages(agent)
    .flatMap(data => data.message.content)
    .flatMap(block => block.type === 'text' ? [block.text] : [])
    .join('')
}

/** Poll until `predicate` holds, letting microtasks/timers drain between checks. */
async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 1000 && !predicate(); i++) await new Promise(r => setTimeout(r, 0))
  if (!predicate()) throw new Error('until: condition never held')
}

/** Reject when the turn signal aborts, standing in for a provider stream teardown. */
function aborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted === true) { reject(new Error('aborted')); return }
    signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
  })
}

/**
 * Adapter whose first text delta lands before the stream is released: the test
 * can request a graceful stop mid-response and then let the response finish.
 */
class GatedStreamAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []
  readonly firstDelta = Promise.withResolvers<undefined>()
  readonly release = Promise.withResolvers<undefined>()

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'hel' }
    this.firstDelta.resolve(undefined)
    await Promise.race([this.release.promise, aborted(options.signal)])
    yield { type: 'text-delta', index: 0, text: 'lo' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'hello' } }
    yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Adapter whose stream fails one request, so the retry decision runs. */
class FailingAdapter extends LlmAdapter {
  requests = 0

  override async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests++
    yield { type: 'finish', reason: { kind: 'error', failure: { message: 'provider busy', code: 'SERVER' } } }
  }
}

describe('graceful stop mode', () => {
  it('finishes the in-flight model response and records it without an interrupted prefix', async () => {
    const adapter = new GatedStreamAdapter()
    const ctx = await harness(adapter)
    try {
      const agent = await ctx.agentLoop.create(SessionId('graceful-model'), { provider: 'mock', model: 'mock' })
      const stoppedHooks: number[] = []
      ctx.on('agent/turn-stopping', ({ turn }) => { stoppedHooks.push(turn) })

      send(agent, 'say hello slowly')
      await adapter.firstDelta.promise
      agent.cancel({ kind: 'user' }, { mode: 'graceful' })
      adapter.release.resolve(undefined)
      await agent.whenIdle()

      expect(assistantText(agent)).toBe('hello')
      expect(assistantMessages(agent)).toHaveLength(1)
      expect(assistantMessages(agent)[0]?.interrupted).toBeUndefined()
      expect(turnEnds(agent)).toEqual([{ kind: 'stopped' }])
      expect(adapter.requests).toHaveLength(1)
      // The turn did not reach the natural stopping hook: the operator ended it.
      expect(stoppedHooks).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('lets the running tool call settle before closing the turn', async () => {
    const adapter = new MockAdapter([toolCallResponse('c1', 'slow', { id: '1' }), textResponse('unreachable')])
    const ctx = await harness(adapter)
    try {
      const gates = new Map<string, () => void>()
      ctx.tools.register(defineContentToolFixture({
        name: 'slow',
        description: 'blocked tool',
        parameters: { id: { type: 'string', required: true } },
        async execute(args) {
          await new Promise<void>((resolve) => { gates.set(args.id, resolve) })
          return [{ type: 'text', text: `done-${args.id}` }]
        },
      }))
      const agent = await ctx.agentLoop.create(SessionId('graceful-tool'), { provider: 'mock', model: 'mock' })

      send(agent, 'use the tool')
      await until(() => gates.has('1'))
      agent.cancel({ kind: 'user' }, { mode: 'graceful' })
      gates.get('1')?.()
      await agent.whenIdle()

      expect(agent.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(1)
      expect(turnEnds(agent)).toEqual([{ kind: 'stopped' }])
      expect(adapter.requests).toHaveLength(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('ends after a step whose tool already finished', async () => {
    const adapter = new MockAdapter([toolCallResponse('c1', 'quick', { id: '1' }), textResponse('unreachable')])
    const ctx = await harness(adapter)
    try {
      ctx.tools.register(defineContentToolFixture({
        name: 'quick',
        description: 'fast tool',
        parameters: { id: { type: 'string', required: true } },
        async execute(args) {
          return [{ type: 'text', text: `done-${args.id}` }]
        },
      }))
      const agent = await ctx.agentLoop.create(SessionId('graceful-settled-tool'), { provider: 'mock', model: 'mock' })
      ctx.on('session/event', (session, event) => {
        if (session === agent.session && event.type === 'tool/result') agent.cancel({ kind: 'user' }, { mode: 'graceful' })
      })

      send(agent, 'use the tool')
      await agent.whenIdle()

      expect(turnEnds(agent)).toEqual([{ kind: 'stopped' }])
      expect(adapter.requests).toHaveLength(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('is a no-op without a running turn and does not arm later work', async () => {
    const adapter = new MockAdapter([textResponse('next turn')])
    const ctx = await harness(adapter)
    try {
      const agent = await ctx.agentLoop.create(SessionId('graceful-idle'), { provider: 'mock', model: 'mock' })
      agent.cancel({ kind: 'user' }, { mode: 'graceful' })
      agent.cancel({ kind: 'user' }, { mode: 'graceful' })
      expect(turnEnds(agent)).toEqual([])
      expect(agent.status).toBe('idle')

      send(agent, 'ordinary turn')
      await agent.whenIdle()
      expect(turnEnds(agent)).toEqual([{ kind: 'completed' }])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('closes a turn armed before its first step without a model request', async () => {
    const adapter = new MockAdapter([textResponse('unreachable')])
    const ctx = await harness(adapter)
    try {
      const agent = await ctx.agentLoop.create(SessionId('graceful-before-step'), { provider: 'mock', model: 'mock' })
      ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === agent && status === 'running') agent.cancel({ kind: 'user' }, { mode: 'graceful' })
      })

      send(agent, 'stop before the first step')
      await agent.whenIdle()

      const events = agent.session.snapshotEvents()
      expect(events.some(event => event.type === 'step/start')).toBe(false)
      expect(turnEnds(agent)).toEqual([{ kind: 'stopped' }])
      expect(adapter.requests).toHaveLength(0)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('keeps queued work pending while ending, and a later delivery runs it', async () => {
    const adapter = new GatedStreamAdapter()
    const ctx = await harness(adapter)
    try {
      const agent = await ctx.agentLoop.create(SessionId('graceful-queue'), { provider: 'mock', model: 'mock' })
      send(agent, 'first')
      await adapter.firstDelta.promise
      send(agent, 'queued')
      agent.cancel({ kind: 'user' }, { mode: 'graceful' })
      adapter.release.resolve(undefined)
      await agent.whenIdle()

      expect(turnEnds(agent)).toEqual([{ kind: 'stopped' }])
      expect(adapter.requests).toHaveLength(1)
      expect(agent.inbox.nextTurn.map(message => message.content)).toHaveLength(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('runs a waking delivery made after the stop request in a later turn', async () => {
    const adapter = new GatedStreamAdapter()
    const ctx = await harness(adapter)
    try {
      const agent = await ctx.agentLoop.create(SessionId('graceful-wake'), { provider: 'mock', model: 'mock' })
      send(agent, 'first')
      await adapter.firstDelta.promise
      agent.cancel({ kind: 'user' }, { mode: 'graceful' })
      send(agent, 'later')
      adapter.release.resolve(undefined)
      await agent.whenIdle()

      expect(turnEnds(agent)).toEqual([{ kind: 'stopped' }, { kind: 'completed' }])
      expect(adapter.requests).toHaveLength(2)
      expect(agent.inbox.nextTurn).toHaveLength(0)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('does not start another model request while recovering a failed attempt', async () => {
    const adapter = new FailingAdapter()
    const ctx = await harness(adapter)
    try {
      const agent = await ctx.agentLoop.create(SessionId('graceful-retry'), { provider: 'mock', model: 'mock' })
      ctx.on('agent/request-error', () => {
        agent.cancel({ kind: 'user' }, { mode: 'graceful' })
        return Promise.resolve({ kind: 'retry' as const })
      })

      send(agent, 'fail once')
      await agent.whenIdle()

      expect(turnEnds(agent)).toEqual([{ kind: 'stopped' }])
      expect(adapter.requests).toBe(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('ignores a second graceful request while one is already pending', async () => {
    const adapter = new GatedStreamAdapter()
    const ctx = await harness(adapter)
    try {
      const agent = await ctx.agentLoop.create(SessionId('graceful-repeat'), { provider: 'mock', model: 'mock' })
      send(agent, 'stop twice')
      await adapter.firstDelta.promise
      agent.cancel({ kind: 'user' }, { mode: 'graceful' })
      agent.cancel({ kind: 'user' }, { mode: 'graceful' })
      adapter.release.resolve(undefined)
      await agent.whenIdle()

      expect(turnEnds(agent)).toEqual([{ kind: 'stopped' }])
      expect(adapter.requests).toHaveLength(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('still aborts immediately when cancel follows a graceful request', async () => {
    const adapter = new GatedStreamAdapter()
    const ctx = await harness(adapter)
    try {
      const agent = await ctx.agentLoop.create(SessionId('graceful-escalated'), { provider: 'mock', model: 'mock' })
      send(agent, 'start')
      await adapter.firstDelta.promise
      agent.cancel({ kind: 'user' }, { mode: 'graceful' })
      agent.cancel({ kind: 'user' })
      await agent.whenIdle()

      expect(turnEnds(agent)).toEqual([{ kind: 'aborted', reason: { kind: 'user' } }])
      expect(assistantMessages(agent)[0]?.interrupted).toBe(true)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
