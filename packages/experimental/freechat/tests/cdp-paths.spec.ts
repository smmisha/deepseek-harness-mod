/** CDP guest port failure paths: handshake answers, socket opening, envelopes, timeouts, and reconnection. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CdpGuestPort } from '../src/transport/cdp.ts'

interface Command {
  readonly id: number
  readonly method: string
  readonly params: Readonly<Record<string, unknown>>
}

/** What one command answers: a result, a raw frame, nothing, or a send failure. */
type Answer =
  | { readonly result?: Readonly<Record<string, unknown>>; readonly error?: { readonly message?: string } }
  | { readonly raw: unknown }
  | { readonly silent: true }
  | { readonly throws: unknown }

const SIGNED_IN = { result: { result: { value: { url: 'https://chat.deepseek.com/', composer: true, body: 500 } } } }

class FakeSocket {
  static readonly created: FakeSocket[] = []
  static initialState = 1
  static answer: (command: Command) => Answer = command => defaultAnswer(command)
  readyState = FakeSocket.initialState
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  readonly sent: Command[] = []

  constructor() { FakeSocket.created.push(this) }

  send(data: string): void {
    const command = JSON.parse(data) as Command
    this.sent.push(command)
    const answer = FakeSocket.answer(command)
    if ('throws' in answer) throw answer.throws
    if ('silent' in answer) return
    const frame = 'raw' in answer ? answer.raw : JSON.stringify({ id: command.id, ...answer })
    queueMicrotask(() => { this.onmessage?.({ data: frame }) })
  }

  close(): void {
    this.readyState = 3
    this.onclose?.()
  }
}

function defaultAnswer(command: Command): Answer {
  if (command.method === 'Target.createTarget') return { result: { targetId: 'tab' } }
  if (command.method === 'Target.attachToTarget') return { result: { sessionId: 'session' } }
  if (command.method === 'Runtime.evaluate') {
    return typeof command.params.expression === 'string' && command.params.expression.includes('location.href')
      ? SIGNED_IN
      : { result: { result: { value: 'value' } } }
  }
  return {}
}

function browser(version: { ok?: boolean; status?: number; body?: unknown } = {}) {
  FakeSocket.created.length = 0
  FakeSocket.initialState = 1
  FakeSocket.answer = defaultAnswer
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok: version.ok ?? true,
    status: version.status ?? 200,
    json: () => Promise.resolve(version.body ?? { webSocketDebuggerUrl: 'ws://fake' }),
  })))
  vi.stubGlobal('WebSocket', FakeSocket)
}

const last = (): FakeSocket => FakeSocket.created.at(-1)!

afterEach(() => { vi.unstubAllGlobals() })

describe('CdpGuestPort handshake', () => {
  it('reports a browser that refuses the version probe or exposes no socket URL', async () => {
    browser({ ok: false, status: 404 })
    await expect(new CdpGuestPort({ port: 9333 }).connect()).rejects.toThrow('CDP port 9333 answered 404')
    browser({ body: {} })
    await expect(new CdpGuestPort().connect()).rejects.toThrow('did not expose a CDP WebSocket URL')
    browser({ body: { webSocketDebuggerUrl: '' } })
    await expect(new CdpGuestPort().connect()).rejects.toThrow('did not expose a CDP WebSocket URL')
  })

  it('reports a tab the browser does not create or attach to', async () => {
    browser()
    FakeSocket.answer = command => (command.method === 'Target.createTarget' ? { result: {} } : defaultAnswer(command))
    await expect(new CdpGuestPort().connect()).rejects.toThrow('did not create a chat tab')
    browser()
    FakeSocket.answer = command => (command.method === 'Target.attachToTarget' ? {} : defaultAnswer(command))
    await expect(new CdpGuestPort().connect()).rejects.toThrow('did not attach to the chat tab')
  })

  it('reuses a live tab, and reattaches once the socket is no longer open', async () => {
    browser()
    const port = new CdpGuestPort()
    await port.connect()
    await port.connect()
    expect(FakeSocket.created).toHaveLength(1)
    const first = last()
    first.readyState = 3
    await port.connect()
    expect(FakeSocket.created).toHaveLength(2)
    // The replaced socket's late close only fails what it still had outstanding.
    first.close()
    expect(await port.evaluate('1')).toBe('value')
    await port.close()
    await expect(port.connect()).rejects.toThrow('the CDP port is closed')
  })

  it('accepts a page that left sign-in without a composer, and waits for a page that has not rendered', async () => {
    browser()
    let probes = 0
    FakeSocket.answer = (command) => {
      if (command.method !== 'Runtime.evaluate') return defaultAnswer(command)
      probes += 1
      return probes === 1
        ? { result: { result: { value: { url: 'https://chat.deepseek.com/a', composer: true, body: 10 } } } }
        : { result: { result: { value: { url: 'https://chat.deepseek.com/a', composer: false, body: 500 } } } }
    }
    await new CdpGuestPort({ loginTimeoutMs: 2_000 }).connect()
    expect(probes).toBe(2)
  })
})

describe('CdpGuestPort socket opening', () => {
  it('waits for a connecting socket, and gives up on one that closes or never opens', async () => {
    browser()
    FakeSocket.initialState = 0
    const opening = new CdpGuestPort().connect()
    await vi.waitFor(() => { expect(FakeSocket.created).toHaveLength(1) })
    last().readyState = 1
    await opening
    browser()
    FakeSocket.initialState = 0
    const closing = new CdpGuestPort().connect()
    await vi.waitFor(() => { expect(FakeSocket.created).toHaveLength(1) })
    last().readyState = 3
    await expect(closing).rejects.toThrow('timed out opening the CDP WebSocket')
    browser()
    FakeSocket.initialState = 0
    await expect(new CdpGuestPort({ attachTimeoutMs: 30 }).connect()).rejects.toThrow('timed out opening the CDP WebSocket')
  })

  it('refuses commands once the socket failed or the port closed while it was opening', async () => {
    browser()
    FakeSocket.initialState = 0
    const failed = new CdpGuestPort().connect()
    await vi.waitFor(() => { expect(FakeSocket.created).toHaveLength(1) })
    last().onerror?.(new Event('error'))
    last().readyState = 1
    await expect(failed).rejects.toThrow('the CDP port is not connected')
    browser()
    FakeSocket.initialState = 0
    const port = new CdpGuestPort()
    const closing = port.connect()
    await vi.waitFor(() => { expect(FakeSocket.created).toHaveLength(1) })
    await port.close()
    last().readyState = 1
    await expect(closing).rejects.toThrow('the CDP port is not connected')
  })
})

describe('CdpGuestPort envelopes', () => {
  it('ignores frames that are not answers to an outstanding command', async () => {
    browser()
    const port = new CdpGuestPort()
    await port.connect()
    const socket = last()
    for (const data of [42, '{not json', JSON.stringify({ method: 'Page.loadEventFired' }), JSON.stringify({ id: 999, result: {} })]) {
      socket.onmessage?.({ data })
    }
    expect(await port.evaluate('1')).toBe('value')
  })

  it('maps command errors, empty results, and guest exceptions', async () => {
    browser()
    const port = new CdpGuestPort()
    await port.connect()
    const reply = (answer: Answer) => { FakeSocket.answer = command => (command.method === 'Runtime.evaluate' ? answer : defaultAnswer(command)) }
    reply({ error: { message: 'No target' } })
    await expect(port.evaluate('1')).rejects.toThrow('No target')
    reply({ error: {} })
    await expect(port.evaluate('1')).rejects.toThrow('CDP command failed')
    reply({})
    expect(await port.evaluate('1')).toBeUndefined()
    reply({ result: { exceptionDetails: { text: 'Uncaught' } } })
    await expect(port.evaluate('1')).rejects.toThrow('guest script failed: Uncaught')
    reply({ result: { exceptionDetails: {} } })
    await expect(port.evaluate('1')).rejects.toThrow('guest script failed: unknown error')
  })

  it('times out a command the browser never answers', async () => {
    browser()
    FakeSocket.answer = command => (command.method === 'Target.createTarget' ? { silent: true } : defaultAnswer(command))
    await expect(new CdpGuestPort({ attachTimeoutMs: 30 }).connect()).rejects.toThrow('CDP command Target.createTarget timed out')
  })

  it('fails a command whose send throws, wrapping a non-error value', async () => {
    browser()
    FakeSocket.answer = command => (command.method === 'Target.createTarget' ? { throws: new Error('socket busy') } : defaultAnswer(command))
    await expect(new CdpGuestPort().connect()).rejects.toThrow('socket busy')
    browser()
    FakeSocket.answer = command => (command.method === 'Target.createTarget' ? { throws: 'refused' } : defaultAnswer(command))
    await expect(new CdpGuestPort().connect()).rejects.toThrow('refused')
  })
})
