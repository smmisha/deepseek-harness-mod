/**
 * Chrome DevTools Protocol implementation of {@link GuestPort}. It drives a real
 * signed-in chat page in a Chromium tab, so the bridge needs no API key and the
 * page's credentials are never read: scripts only touch the DOM.
 *
 * Node 24 supplies a global WebSocket, so this transport adds no dependency.
 */

import type { GuestPort } from '../types.ts'

/** Where the CDP transport finds its browser and chat page. */
export interface CdpPortOptions {
  /** Debugging port of the Chromium instance; defaults to 9222. */
  readonly port?: number
  /** Page to navigate when the dedicated tab opens. */
  readonly url?: string
  /** Budget for the browser to answer the attach handshake. */
  readonly attachTimeoutMs?: number
  /** Budget for the chat page to leave the sign-in screen. */
  readonly loginTimeoutMs?: number
}

/** Minimal shape of the CDP envelopes this port sends and receives. */
interface CdpMessage {
  readonly id?: number
  readonly method?: string
  readonly params?: Readonly<Record<string, unknown>>
  readonly result?: Readonly<Record<string, unknown>>
  readonly error?: { readonly message?: string }
  readonly sessionId?: string
}

/** Minimal WebSocket surface used here; Node's global client satisfies it. */
interface CdpSocket {
  readonly readyState: number
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: ((event: unknown) => void) | null
  send(data: string): void
  close(): void
}

/**
 * Wrap the global WebSocket client in the narrow surface the port drives, so
 * the port never asserts the platform type into its own.
 * @param url - browser-side debugger WebSocket URL.
 * @returns the socket surface; its handlers forward the client's events.
 */
function openSocket(url: string): CdpSocket {
  const client = new WebSocket(url)
  const socket: CdpSocket = {
    get readyState() { return client.readyState },
    onmessage: null,
    onclose: null,
    onerror: null,
    send: (data) => { client.send(data) },
    close: () => { client.close() },
  }
  client.onmessage = (event: MessageEvent) => { socket.onmessage?.({ data: event.data }) }
  client.onclose = () => { socket.onclose?.() }
  client.onerror = (event) => { socket.onerror?.(event) }
  return socket
}

/** One pending CDP command. */
interface Pending {
  resolve(value: Readonly<Record<string, unknown>>): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

/** Default page the free chat lives on. */
export const DEFAULT_CDP_URL = 'https://chat.deepseek.com/'

/**
 * Attach to a Chromium instance over CDP and expose one chat tab as a guest port.
 * The tab is created at {@link connect} and reused for every evaluated script.
 */
export class CdpGuestPort implements GuestPort {
  private readonly options: Required<CdpPortOptions>
  private socket: CdpSocket | null = null
  private sessionId: string | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private closed = false

  /**
   * @param options - browser port, chat URL, and attach timeout.
   */
  constructor(options: CdpPortOptions = {}) {
    this.options = {
      port: options.port ?? 9222,
      url: options.url ?? DEFAULT_CDP_URL,
      attachTimeoutMs: options.attachTimeoutMs ?? 15_000,
      loginTimeoutMs: options.loginTimeoutMs ?? 20_000,
    }
  }

  /** Open the browser connection and create the chat tab. */
  async connect(): Promise<void> {
    await this.attach()
  }

  /**
   * Reuse the live tab session, or open the connection and create the chat tab.
   * @returns the tab's CDP session id.
   */
  private async attach(): Promise<string> {
    if (this.closed) throw new Error('freechat: the CDP port is closed')
    if (this.socket !== null && this.socket.readyState === 1 && this.sessionId !== null) return this.sessionId
    const versionResponse = await fetch(`http://127.0.0.1:${this.options.port}/json/version`)
    if (!versionResponse.ok) {
      throw new Error(`freechat: CDP port ${this.options.port} answered ${versionResponse.status}`)
    }
    const version = await versionResponse.json() as { webSocketDebuggerUrl?: string }
    if (typeof version.webSocketDebuggerUrl !== 'string' || version.webSocketDebuggerUrl.length === 0) {
      throw new Error('freechat: the browser did not expose a CDP WebSocket URL')
    }
    const socket = openSocket(version.webSocketDebuggerUrl)
    this.socket = socket
    socket.onmessage = (event) => { this.receive(event.data) }
    socket.onclose = () => {
      if (this.socket === socket) this.invalidate(new Error('freechat: the CDP connection closed'))
      else this.failPending(new Error('freechat: the CDP connection closed'))
    }
    socket.onerror = () => { this.invalidate(new Error('freechat: the CDP connection failed')) }
    await this.waitForOpen(socket)
    const created = await this.send('Target.createTarget', { url: 'about:blank' })
    const targetId = created.targetId
    if (typeof targetId !== 'string') throw new Error('freechat: the browser did not create a chat tab')
    const attached = await this.send('Target.attachToTarget', { targetId, flatten: true })
    const sessionId = attached.sessionId
    if (typeof sessionId !== 'string') throw new Error('freechat: the browser did not attach to the chat tab')
    this.sessionId = sessionId
    await this.send('Page.enable', {}, sessionId)
    await this.send('Runtime.enable', {}, sessionId)
    await this.send('Page.navigate', { url: this.options.url }, sessionId)
    await this.waitForSignedIn(sessionId)
    return sessionId
  }

  /** Drop a dead socket so the next request reattaches to a restarted browser. */
  private invalidate(error: Error): void {
    this.socket = null
    this.sessionId = null
    this.failPending(error)
  }

  /** Fail with an actionable message when the browser still shows the login page. */
  private async waitForSignedIn(sessionId: string): Promise<void> {
    const deadline = Date.now() + this.options.loginTimeoutMs
    while (Date.now() < deadline) {
      const page = await this.evaluateIn<{ url: string; composer: boolean; body: number }>(sessionId, `(() => ({
        url: location.href,
        composer: document.querySelector('textarea, [contenteditable="true"]') !== null,
        body: document.body ? document.body.innerHTML.length : 0,
      }))()`)
      if (page.composer && page.body > 100) return
      if (!page.url.includes('sign_in') && page.body > 100) return
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    throw new Error('freechat: the web chat is not signed in. Complete the login in the Chrome window once, then retry.')
  }

  /** Resolve when the browser-side socket accepts commands. */
  private async waitForOpen(socket: CdpSocket): Promise<void> {
    if (socket.readyState === 1) return
    const deadline = Date.now() + this.options.attachTimeoutMs
    while (Date.now() < deadline) {
      if (socket.readyState === 1) return
      if (socket.readyState === 3) break
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw new Error('freechat: timed out opening the CDP WebSocket')
  }

  /** Route one CDP response to its command. */
  private receive(data: unknown): void {
    if (typeof data !== 'string') return
    let message: CdpMessage
    try {
      message = JSON.parse(data) as CdpMessage
    } catch {
      return
    }
    if (typeof message.id !== 'number') return
    const pending = this.pending.get(message.id)
    if (pending === undefined) return
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error !== undefined) pending.reject(new Error(message.error.message ?? 'CDP command failed'))
    else pending.resolve(message.result ?? {})
  }

  /** Reject every outstanding command after a transport failure. */
  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  /** Send one CDP command and await its matching response. */
  private send(
    method: string, params: Readonly<Record<string, unknown>> = {}, sessionId?: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    const socket = this.socket
    if (socket === null || this.closed) return Promise.reject(new Error('freechat: the CDP port is not connected'))
    const id = this.nextId++
    const envelope: CdpMessage = { id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.invalidate(new Error(`freechat: CDP command ${method} timed out`))
        reject(new Error(`freechat: CDP command ${method} timed out`))
      }, this.options.attachTimeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        socket.send(JSON.stringify(envelope))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        this.invalidate(error instanceof Error ? error : new Error(String(error)))
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /** Evaluate one script in the chat tab and return its JSON-serializable value. */
  async evaluate<T>(script: string): Promise<T> {
    return this.evaluateIn<T>(this.sessionId ?? await this.attach(), script)
  }

  /** Evaluate one script in one attached tab session. */
  private async evaluateIn<T>(sessionId: string, script: string): Promise<T> {
    const response = await this.send('Runtime.evaluate', {
      expression: script,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    }, sessionId)
    const details = response.exceptionDetails as { text?: string; exception?: { description?: string } } | undefined
    if (details !== undefined) {
      throw new Error(`freechat: guest script failed: ${details.exception?.description ?? details.text ?? 'unknown error'}`)
    }
    return (response.result as { value?: T } | undefined)?.value as T
  }

  /** Close the connection; the tab stays open for inspection. */
  close(): Promise<void> {
    this.closed = true
    this.failPending(new Error('freechat: the CDP port was closed'))
    this.socket?.close()
    this.socket = null
    this.sessionId = null
    return Promise.resolve()
  }
}
