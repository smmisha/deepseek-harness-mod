import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FreeChatKernel } from '../src/kernel/kernel.ts'
import { ModelRegistry } from '../src/kernel/model-registry.ts'
import { ThreadStore } from '../src/kernel/thread-store.ts'
import { createFreeChatServer } from '../src/server/openai-server.ts'
import { LoopbackTransport } from '../src/transport/loopback.ts'
import type { LoopbackScript } from '../src/transport/loopback.ts'
import type { BridgeLogger, ChatCompletionChunk, ContextPolicy } from '../src/types.ts'

const logger: BridgeLogger = { info: () => undefined, warn: () => undefined, error: () => undefined }
const policy: ContextPolicy = { maxMessages: 40, maxTokens: 100_000, replayTail: 4, maxCharsPerMessage: 4_000 }

/** One booted proxy plus the collaborators a test inspects. */
interface Harness {
  readonly origin: string
  readonly transport: LoopbackTransport
  close(): Promise<void>
}

const running: Harness[] = []

afterEach(async () => {
  await Promise.all(running.splice(0).map(async harness => harness.close()))
})

/** Boot the proxy on an ephemeral port with the scripted transport. */
async function boot(script: LoopbackScript, token = ''): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), 'freechat-test-'))
  const transport = new LoopbackTransport(script)
  const registry = new ModelRegistry({ ttlMs: 60_000, logger })
  const kernel = new FreeChatKernel({ transport, registry, store: new ThreadStore(directory), policy, logger })
  const server = createFreeChatServer({
    kernel,
    registry,
    logger,
    host: '127.0.0.1',
    port: 0,
    token,
    maxBodyBytes: 1_000_000,
  })
  const origin = await server.listen()
  const harness: Harness = {
    origin,
    transport,
    async close() {
      await server.close()
      await kernel.dispose()
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    },
  }
  running.push(harness)
  return harness
}

/** One OpenAI-compatible chat request. */
async function chat(origin: string, body: unknown, token = ''): Promise<Response> {
  return fetch(`${origin}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token.length > 0 ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

/** Collect streamed SSE payloads from one response body. */
async function readSse(response: Response): Promise<{ payloads: ChatCompletionChunk[]; done: boolean }> {
  const text = await response.text()
  const payloads: ChatCompletionChunk[] = []
  let done = false
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const body = line.slice('data: '.length)
    if (body === '[DONE]') {
      done = true
      continue
    }
    payloads.push(JSON.parse(body) as ChatCompletionChunk)
  }
  return { payloads, done }
}

/** Concatenate the incremental content of one stream. */
function contentOf(payloads: readonly ChatCompletionChunk[]): string {
  return payloads.map(payload => payload.choices[0]?.delta.content ?? '').join('')
}

describe('OpenAI-compatible proxy', () => {
  it('lists the playable models', async () => {
    const harness = await boot(() => 'unused')
    const response = await fetch(`${harness.origin}/v1/models`)
    expect(response.status).toBe(200)
    const body = await response.json() as { data: { id: string }[] }
    expect(body.data.map(model => model.id)).toContain('deepseek-web-chat')
  })

  it('streams a completion as server-sent events', async () => {
    const harness = await boot(() => ['Hel', 'lo world'])
    const response = await chat(harness.origin, {
      model: 'deepseek-web-chat',
      stream: true,
      user: 'session-a',
      messages: [{ role: 'user', content: 'greet me' }],
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const { payloads, done } = await readSse(response)
    expect(done).toBe(true)
    expect(contentOf(payloads)).toBe('Hello world')
    expect(payloads.at(-1)?.choices[0]?.finish_reason).toBe('stop')
    expect(harness.transport.sessions).toHaveLength(1)
  })

  it('reuses the live web session on an extended history', async () => {
    const harness = await boot(() => 'Hello world')
    await chat(harness.origin, {
      model: 'deepseek-web-chat',
      stream: true,
      user: 'session-b',
      messages: [{ role: 'user', content: 'hi' }],
    })
    await chat(harness.origin, {
      model: 'deepseek-web-chat',
      stream: true,
      user: 'session-b',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'Hello world' },
        { role: 'user', content: 'again' },
      ],
    })
    expect(harness.transport.sessions).toHaveLength(1)
    // The first turn rotates into a restored-context prompt; the second reuses
    // that same session and therefore carries only the new user message.
    expect(harness.transport.sessions[0]?.prompts[1]).toBe('again')
  })

  it('rotates the web session when the caller history is rewritten', async () => {
    const harness = await boot(() => 'Hello world')
    await chat(harness.origin, {
      model: 'deepseek-web-chat',
      user: 'session-c',
      messages: [{ role: 'user', content: 'hi' }],
    })
    await chat(harness.origin, {
      model: 'deepseek-web-chat',
      user: 'session-c',
      messages: [{ role: 'user', content: 'completely different start' }],
    })
    expect(harness.transport.sessions).toHaveLength(2)
    expect(harness.transport.sessions[1]?.prompts[0]).toContain('reset')
  })

  it('answers with one JSON body when streaming is off', async () => {
    const harness = await boot(() => 'Hello world')
    const response = await chat(harness.origin, {
      model: 'deepseek-web-chat',
      user: 'session-d',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(response.status).toBe(200)
    const body = await response.json() as { choices: { message: { content: string } }[]; usage: { total_tokens: number } }
    expect(body.choices[0]?.message.content).toBe('Hello world')
    expect(body.usage.total_tokens).toBeGreaterThan(0)
  })

  it('reports tool calls as native OpenAI tool_calls', async () => {
    const harness = await boot(() => '<tool_call name="github_search">{"query":"harness"}</tool_call>')
    const { payloads } = await readSse(await chat(harness.origin, {
      model: 'deepseek-web-chat',
      stream: true,
      user: 'session-e',
      messages: [{ role: 'user', content: 'search' }],
      tools: [{ type: 'function', function: { name: 'github_search', parameters: { type: 'object' } } }],
    }))
    const calls = payloads.flatMap(payload => payload.choices[0]?.delta.tool_calls ?? [])
    expect(calls[0]?.function?.name).toBe('github_search')
    expect(payloads.at(-1)?.choices[0]?.finish_reason).toBe('tool_calls')
  })

  it('refuses an unknown model with 400', async () => {
    const harness = await boot(() => 'unused')
    const response = await chat(harness.origin, {
      model: 'not-a-route',
      user: 'session-f',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(response.status).toBe(400)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('MODEL_NOT_FOUND')
  })

  it('requires the configured bearer token', async () => {
    const harness = await boot(() => 'Hello world', 'secret-token')
    const denied = await chat(harness.origin, { user: 'session-g', messages: [{ role: 'user', content: 'hi' }] })
    expect(denied.status).toBe(401)
    const allowed = await chat(harness.origin, { user: 'session-g', messages: [{ role: 'user', content: 'hi' }] }, 'secret-token')
    expect(allowed.status).toBe(200)
  })

  it('reports models and thread rows for a settings surface', async () => {
    const harness = await boot(() => 'Hello world')
    const turn = await chat(harness.origin, {
      model: 'deepseek-web-chat',
      stream: true,
      user: 'session-h',
      messages: [{ role: 'user', content: 'hi' }],
    })
    // Drain the stream so the turn commits before the state read.
    await turn.text()
    const response = await fetch(`${harness.origin}/admin/state`)
    expect(response.status).toBe(200)
    const body = await response.json() as {
      ok: boolean
      models: { id: string }[]
      threads: { id: string; generation: number; turns: number; live: boolean }[]
    }
    expect(body.ok).toBe(true)
    expect(body.models.map(model => model.id)).toContain('deepseek-web-chat')
    expect(body.threads).toHaveLength(1)
    expect(body.threads[0]).toMatchObject({ generation: 1, live: true })
    expect(body.threads[0]?.turns).toBeGreaterThan(0)
  })

  it('refuses an admin state read without the token', async () => {
    const harness = await boot(() => 'unused', 'secret-token')
    const response = await fetch(`${harness.origin}/admin/state`)
    expect(response.status).toBe(401)
  })

  it('answers preflight and liveness, and accepts the token as x-api-key', async () => {
    const harness = await boot(() => 'unused', 'secret-token')
    expect((await fetch(`${harness.origin}/v1/models`, { method: 'OPTIONS' })).status).toBe(204)
    expect(await (await fetch(`${harness.origin}/healthz`)).json()).toEqual({ ok: true })
    expect((await fetch(`${harness.origin}/v1/models`, { headers: { 'x-api-key': 'secret-token' } })).status).toBe(200)
    expect((await fetch(`${harness.origin}/v1/models`, { headers: { 'x-api-key': 'wrong' } })).status).toBe(401)
    expect((await fetch(`${harness.origin}/v1/models`, { headers: { authorization: 'Basic x' } })).status).toBe(401)
  })

  it('refuses oversized, unparsable, and malformed request bodies', async () => {
    const harness = await boot(() => 'unused')
    const post = (body: string) => fetch(`${harness.origin}/v1/chat/completions`, { method: 'POST', body })
    expect((await post('x'.repeat(1_000_001))).status).toBe(413)
    for (const [body, message] of [['{', 'not valid JSON'], ['null', 'must be an object'], ['{"messages":1}', 'messages must be an array']] as const) {
      const response = await post(body)
      expect(response.status).toBe(400)
      expect(((await response.json()) as { error: { message: string } }).error.message).toContain(message)
    }
  })

  it('ends a stream with an error payload when the turn fails after it started', async () => {
    function* broken(): Generator<string> {
      yield 'partial'
      throw new Error('tab crashed')
    }
    const harness = await boot(() => broken() as never)
    const response = await chat(harness.origin, { stream: true, messages: [{ role: 'user', content: 'hi' }] })
    const text = await response.text()
    expect(text).toContain('"content":"partial"')
    expect(text).toContain('web chat transport failed: tab crashed')
    expect(text).not.toContain('[DONE]')
  })

  it('answers a stream that fails before its first frame with a JSON error', async () => {
    const harness = await boot(() => 'unused')
    const response = await chat(harness.origin, { stream: true, model: 'nope', messages: [{ role: 'user', content: 'hi' }] })
    expect(response.status).toBe(400)
    const named = await chat(harness.origin, { stream: true, model: 'deepseek-web-chat', messages: [{ role: 'user', content: 'hi' }] })
    expect(await named.text()).toContain('"model":"deepseek-web-chat"')
  })

  it('returns tool calls in a one-shot body', async () => {
    const harness = await boot(() => 'Reading. <tool_call name="read">{"path":"a"}</tool_call>')
    const response = await chat(harness.origin, { messages: [{ role: 'user', content: 'read' }] })
    const body = await response.json() as {
      choices: { message: { tool_calls?: { function: { name: string } }[] }; finish_reason: string }[]
    }
    expect(body.choices[0]?.message.tool_calls?.[0]?.function.name).toBe('read')
    expect(body.choices[0]?.finish_reason).toBe('tool_calls')
  })

  it('resets a thread, reports a malformed id as an internal failure, and answers unknown routes with 404', async () => {
    const harness = await boot(() => 'unused')
    const reset = await fetch(`${harness.origin}/admin/threads/thread-x/reset`, { method: 'POST' })
    expect(await reset.json()).toEqual({ reset: true, closedSession: false })
    const malformed = await fetch(`${harness.origin}/admin/threads/%E0/reset`, { method: 'POST' })
    expect(malformed.status).toBe(500)
    expect(((await malformed.json()) as { error: { code: string } }).error.code).toBe('INTERNAL')
    expect((await fetch(`${harness.origin}/nowhere`)).status).toBe(404)
  })

  it('reports closing a server that never listened', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'freechat-test-'))
    const registry = new ModelRegistry({ ttlMs: 60_000, logger })
    const kernel = new FreeChatKernel({ transport: new LoopbackTransport(() => 'x'), registry, store: new ThreadStore(directory), policy, logger })
    const server = createFreeChatServer({ kernel, registry, logger, host: '127.0.0.1', port: 0, token: '', maxBodyBytes: 10 })
    expect(server.origin()).toBe('http://127.0.0.1:0')
    await expect(server.close()).rejects.toThrow()
    await rm(directory, { recursive: true, force: true })
  })
})
