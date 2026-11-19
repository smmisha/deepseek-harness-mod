import { afterEach, describe, expect, it, vi } from 'vitest'
import { CdpGuestPort } from '../src/transport/cdp.ts'

/** One command the fake browser received. */
interface Sent {
  readonly method: string
  readonly params: Readonly<Record<string, unknown>>
}

/** Answer the CDP handshake commands used by the transport. */
function handshake(): Record<string, unknown> {
  return {
    'Target.createTarget': { targetId: 'tab-1' },
    'Target.attachToTarget': { sessionId: 'session-1' },
  }
}

/** What a test reads from the fake browser's socket. */
interface SentLog {
  readonly sent: readonly Sent[]
  /** Close the socket as the browser would. */
  close(): void
}

/** Install a fake browser and expose the last socket it created. */
function fakeBrowser(handler: (message: Sent) => unknown): () => SentLog {
  const created: FakeSocket[] = []
  class FakeSocket {
    readyState = 1
    onmessage: ((event: { data: unknown }) => void) | null = null
    onclose: (() => void) | null = null
    onerror: ((event: unknown) => void) | null = null
    readonly sent: Sent[] = []

    constructor() { created.push(this) }

    send(data: string): void {
      const message = JSON.parse(data) as Sent & { id: number }
      this.sent.push(message)
      queueMicrotask(() => {
        this.onmessage?.({ data: JSON.stringify({ id: message.id, result: handler(message) }) })
      })
    }

    close(): void {
      this.readyState = 3
      this.onclose?.()
    }
  }
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ webSocketDebuggerUrl: 'ws://fake' }),
  })))
  vi.stubGlobal('WebSocket', FakeSocket)
  return () => {
    const last = created.at(-1)
    if (last === undefined) throw new Error('fake browser was never connected')
    return last
  }
}

/** Recognize the transport's sign-in probe among evaluated expressions. */
function isProbe(expression: unknown): boolean {
  return typeof expression === 'string' && expression.includes('composer: document.querySelector')
}

/** Value the sign-in probe reads from a signed-in chat page. */
const signedInValue = { url: 'https://chat.deepseek.com/', composer: true, body: 500 }

afterEach(() => { vi.unstubAllGlobals() })

describe('CdpGuestPort', () => {
  it('attaches to a tab and evaluates scripts by value', async () => {
    const socketOf = fakeBrowser((message) => {
      if (message.method in handshake()) return handshake()[message.method]!
      if (message.method === 'Runtime.evaluate') {
        return { result: { type: 'string', value: isProbe(message.params.expression) ? signedInValue : 'hello' } }
      }
      return {}
    })
    const port = new CdpGuestPort({ loginTimeoutMs: 100 })
    await port.connect()
    expect(await port.evaluate<string>('1 + 1')).toBe('hello')
    expect(socketOf().sent.map(command => command.method)).toContain('Target.createTarget')
    expect(socketOf().sent.map(command => command.method)).toContain('Page.navigate')
    await port.close()
  })

  it('reports an exception raised by the guest script', async () => {
    fakeBrowser((message) => {
      if (message.method === 'Runtime.evaluate') {
        if (isProbe(message.params.expression)) return { result: { value: signedInValue } }
        return { exceptionDetails: { text: 'Uncaught', exception: { description: 'boom' } } }
      }
      return handshake()[message.method] ?? {}
    })
    const port = new CdpGuestPort({ loginTimeoutMs: 100 })
    await expect(port.evaluate('throw new Error("boom")')).rejects.toThrow('boom')
  })

  it('fails with an actionable message while the page is signed out', async () => {
    fakeBrowser((message) => {
      if (message.method === 'Runtime.evaluate') {
        return { result: { value: { url: 'https://chat.deepseek.com/sign_in', composer: false, body: 500 } } }
      }
      return handshake()[message.method] ?? {}
    })
    const port = new CdpGuestPort({ loginTimeoutMs: 30 })
    await expect(port.connect()).rejects.toThrow('not signed in')
  })

  it('reattaches after the browser closes', async () => {
    const socketOf = fakeBrowser((message) => {
      if (message.method === 'Runtime.evaluate') return { result: { value: isProbe(message.params.expression) ? signedInValue : 'again' } }
      return handshake()[message.method] ?? {}
    })
    const port = new CdpGuestPort({ loginTimeoutMs: 100 })
    await port.connect()
    const first = socketOf()
    first.close()
    expect(await port.evaluate('1')).toBe('again')
    expect(socketOf()).not.toBe(first)
    expect(socketOf().sent.map(command => command.method)).toContain('Target.createTarget')
    await port.close()
  })

  it('rejects outstanding commands when the browser closes', async () => {
    const socketOf = fakeBrowser((message) => {
      if (message.method === 'Runtime.evaluate') return { result: { value: signedInValue } }
      return handshake()[message.method] ?? {}
    })
    const port = new CdpGuestPort({ loginTimeoutMs: 100 })
    await port.connect()
    const pending = port.evaluate('1')
    socketOf().close()
    await expect(pending).rejects.toThrow('closed')
  })
})
