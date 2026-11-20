/** Turn kernel: request checks, session reuse and rotation, tool calls, failures, and thread rows. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BridgeError } from '../src/kernel/errors.ts'
import { FreeChatKernel } from '../src/kernel/kernel.ts'
import { ModelRegistry } from '../src/kernel/model-registry.ts'
import { ThreadStore } from '../src/kernel/thread-store.ts'
import { LoopbackTransport, type LoopbackScript } from '../src/transport/loopback.ts'
import type { BridgeLogger, ChatCompletionRequest, ContextPolicy, KernelChunk, WebChatSession, WebChatTransport } from '../src/types.ts'

const policy: ContextPolicy = { maxMessages: 40, maxTokens: 100_000, replayTail: 4, maxCharsPerMessage: 4_000 }
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function logger() {
  return {
    info: vi.fn<(message: string) => void>(),
    warn: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string, error?: unknown) => void>(),
  } satisfies BridgeLogger
}

async function kernelOf(transport: WebChatTransport, options: { store?: ThreadStore; now?: () => Date; log?: BridgeLogger } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'freechat-kernel-'))
  roots.push(directory)
  const log = options.log ?? logger()
  const store = options.store ?? new ThreadStore(directory)
  const kernel = new FreeChatKernel({
    transport, registry: new ModelRegistry({ ttlMs: 60_000, logger: log }), store, policy, logger: log,
    ...options.now === undefined ? {} : { now: options.now },
  })
  return { kernel, store, log }
}

async function run(kernel: FreeChatKernel, request: ChatCompletionRequest, signal?: AbortSignal): Promise<KernelChunk[]> {
  const chunks: KernelChunk[] = []
  for await (const chunk of kernel.complete(request, signal)) chunks.push(chunk)
  return chunks
}

const ask = (content: string, extra: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest => ({
  messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content }], user: 'thread-a', ...extra,
})

function failing(error: unknown): WebChatTransport {
  const session: WebChatSession = {
    id: 'broken',
    async *send(): AsyncIterable<string> { await Promise.resolve(); throw error },
    close: () => Promise.resolve(),
  }
  return { open: () => Promise.resolve(session) }
}

describe('FreeChatKernel requests', () => {
  it('refuses empty histories, unknown models, and turns after shutdown', async () => {
    const { kernel } = await kernelOf(new LoopbackTransport(() => 'ok'))
    await expect(run(kernel, { messages: [] })).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
    await expect(run(kernel, ask('hi', { model: 'nope' }))).rejects.toMatchObject({ code: 'MODEL_NOT_FOUND' })
    await expect(run(kernel, ask('hi', { model: 'nope' }))).rejects.toThrow('unknown model "nope"')
    await kernel.dispose()
    await expect(run(kernel, ask('hi'))).rejects.toMatchObject({ code: 'UNAVAILABLE', status: 503 })
  })
})

describe('FreeChatKernel turns', () => {
  it('rotates into a first session, reuses it for the delta, and reports tool calls', async () => {
    const script: LoopbackScript = prompt => (prompt.includes('read it')
      ? ['Reading. <tool_call name="read">{"path":"a"}', '</tool_call>']
      : ['Hel', 'lo'])
    const transport = new LoopbackTransport(script)
    const { kernel } = await kernelOf(transport, { now: () => new Date('2026-01-01T00:00:00.000Z') })
    const first = await run(kernel, ask('hi', { tools: [{ type: 'function', function: { name: 'read', parameters: {} } }] }))
    expect(first.filter(chunk => chunk.type === 'text').map(chunk => chunk.type === 'text' ? chunk.text : '').join('')).toBe('Hello')
    expect(first.at(-1)).toMatchObject({ type: 'finish', reason: 'stop' })
    const second = await run(kernel, {
      ...ask('hi', { tools: [{ type: 'function', function: { name: 'read', parameters: {} } }] }),
      messages: [
        { role: 'system', content: 'Be brief.' }, { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'Hello' }, { role: 'user', content: 'read it' },
      ],
    })
    expect(transport.sessions).toHaveLength(1)
    expect(second.find(chunk => chunk.type === 'tool-call')).toMatchObject({ name: 'read', arguments: '{"path":"a"}' })
    expect(second.at(-1)).toMatchObject({ type: 'finish', reason: 'tool_calls' })
    const [row] = await kernel.snapshots()
    expect(row?.id).toMatch(/^thread-a-/u)
    expect(row).toMatchObject({ turns: 2, live: true, updatedAt: '2026-01-01T00:00:00.000Z' })
    expect(await kernel.resetThread('thread-a')).toBe(true)
    expect(await kernel.resetThread('thread-a')).toBe(false)
    expect((await kernel.snapshots())[0]?.live).toBe(false)
    await run(kernel, { messages: [{ role: 'user', content: 'hi again' }] })
    expect(transport.sessions).toHaveLength(2)
    await kernel.dispose()
  })

  it('wraps transport failures, marking an aborted generation, and drops the session', async () => {
    const log = logger()
    const { kernel } = await kernelOf(failing('socket gone'), { log })
    await expect(run(kernel, ask('hi'))).rejects.toMatchObject({ code: 'TRANSPORT_FAILED', message: 'web chat transport failed: socket gone' })
    const { kernel: broken } = await kernelOf(failing(new Error('tab closed')))
    await expect(run(broken, ask('hi'))).rejects.toMatchObject({ message: 'web chat transport failed: tab closed' })
    const { kernel: refused } = await kernelOf(failing(new BridgeError('quota reached', 'TRANSPORT_FAILED', 429)))
    await expect(run(refused, ask('hi'))).rejects.toMatchObject({ message: 'quota reached', status: 429 })
    const aborted = new AbortController()
    aborted.abort()
    await expect(run(broken, ask('hi'), aborted.signal)).rejects.toMatchObject({ code: 'UNAVAILABLE', status: 499 })
    expect(log.error).toHaveBeenCalled()
    expect(await kernel.snapshots()).toEqual([])
  })

  it('keeps answering when a turn cannot be stored, dropping the live session so the next turn restores', async () => {
    const log = logger()
    const directory = await mkdtemp(join(tmpdir(), 'freechat-kernel-'))
    roots.push(directory)
    const store = new ThreadStore(directory)
    vi.spyOn(store, 'commit').mockRejectedValueOnce(new Error('disk full'))
    const transport = new LoopbackTransport(() => 'ok')
    const { kernel } = await kernelOf(transport, { store, log })
    expect((await run(kernel, ask('hi'))).at(-1)).toMatchObject({ type: 'finish' })
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('could not persist thread'), expect.any(Error))
    expect(await kernel.snapshots()).toEqual([])
    await run(kernel, ask('hi', { user: 'thread-b' }))
    await run(kernel, { messages: [{ role: 'user', content: 'third' }], user: 'thread-c' })
    const rows = await kernel.snapshots()
    expect(rows.map(row => row.turns)).toEqual([1, 1])
  })

  it('lists a live thread that has not committed a turn yet after committed ones', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'freechat-kernel-'))
    roots.push(directory)
    const store = new ThreadStore(directory)
    const release = Promise.withResolvers<undefined>()
    const transport: WebChatTransport = {
      open: () => Promise.resolve({
        id: 'slow',
        async *send(): AsyncIterable<string> { await release.promise; yield 'late' },
        close: () => Promise.resolve(),
      }),
    }
    const { kernel } = await kernelOf(new LoopbackTransport(() => 'ok'), { store })
    await run(kernel, ask('hi', { user: 'done' }))
    const { kernel: pending } = await kernelOf(transport, { store })
    const stream = pending.complete(ask('hi', { user: 'pending' }))
    const next = stream.next()
    await vi.waitFor(async () => { expect((await pending.snapshots()).some(row => row.live)).toBe(true) })
    const rows = await pending.snapshots()
    expect(rows.map(row => [row.live, row.turns])).toEqual([[false, 1], [true, 0]])
    const live = rows.find(row => row.live)
    expect(live).toMatchObject({ generation: 1, updatedAt: undefined })
    release.resolve(undefined)
    await next
    await stream.return(undefined)
  })
})
