/**
 * External-browser fallback for provider sign-in that the embedded browser
 * cannot finish.
 *
 * The controlled Chrome/Edge profile keeps the provider session. The app waits
 * until the site itself reports a token in `localStorage.userToken`, then hands
 * the browser cookies and the three storage entries the site needs back to the
 * caller. Nothing is read from the page beyond those entries, and no token is
 * logged.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Cookie as Chrome's `Storage.getCookies` returns it. */
export interface BrowserCookie {
  readonly name: string
  readonly value: string
  readonly domain: string
  readonly path: string
  readonly secure: boolean
  readonly httpOnly: boolean
  readonly sameSite?: string | undefined
  readonly expirationDate?: number | undefined
}

/** Login material collected from the controlled browser. */
export interface ChatLoginPayload {
  readonly cookies: readonly BrowserCookie[]
  /** Raw `localStorage` values by key; absent keys are not transferred. */
  readonly storage: Readonly<Record<string, string>>
}

/** Timing for one external-browser login attempt. */
export interface ChatLoginBrowserRequest {
  /** Chat address the controlled browser opens. */
  readonly url: string
  /** Chrome or Edge executable. */
  readonly executable: string
  /** Dedicated profile directory that keeps the provider session. */
  readonly profileDir: string
  /** Overall attempt deadline. */
  readonly timeoutMs: number
  /** Delay between token checks. */
  readonly pollMs: number
  /** Returns true once the document cancelled the attempt. */
  readonly isCancelled?: (() => boolean) | undefined
}

/** `localStorage` entries the chat needs to treat the visitor as signed in. */
export const CHAT_LOGIN_STORAGE_KEYS = ['userToken', '__appKit_userInfo', 'deepseek-device-id:chat'] as const

/** The controlled browser did not reach a signed-in chat before the deadline. */
export class ChatLoginTimeoutError extends Error {
  constructor() {
    super('chat login browser: timed out before the site stored a user token')
    this.name = 'ChatLoginTimeoutError'
  }
}

/** The controlled browser or its DevTools endpoint could not be started. */
export class ChatLoginBrowserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChatLoginBrowserError'
  }
}

/** Polling seam so tests can drive a deterministic DevTools timeline. */
export interface ChatLoginSession {
  /** True once the browser process exited. */
  readonly closed: boolean
  /** Whether the site stored a non-empty `userToken.value`. */
  hasUserToken(): Promise<boolean>
  /** Read the cookies and storage entries to transfer. */
  readPayload(): Promise<ChatLoginPayload>
  /** Close the DevTools connection. */
  close(): void
}

/** Timing and clock seams for {@link awaitChatLogin}. */
export interface ChatLoginPollOptions {
  readonly timeoutMs: number
  readonly pollMs: number
  readonly now?: () => number
  readonly sleep?: (milliseconds: number) => Promise<void>
  readonly isCancelled?: (() => boolean) | undefined
}

/**
 * Resolve the Chrome or Edge executable for this platform.
 * @param environment - process environment that may override standard locations.
 * @param platform - target platform.
 * @returns the executable path, or undefined when neither browser is installed.
 */
export function findChatBrowser(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const candidates = platform === 'darwin'
    ? [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ]
    : platform === 'win32'
      ? [
        join(environment.PROGRAMFILES ?? 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
        join(environment['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
        join(environment.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
        join(environment.PROGRAMFILES ?? 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
        join(environment['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
      ]
      : [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/microsoft-edge',
      ]
  return candidates.find(candidate => existsSync(candidate))
}

/**
 * Parse the site's `userToken` envelope.
 * @param raw - raw `localStorage.getItem('userToken')` result.
 * @returns the non-empty token value, or null for a missing or signed-out envelope.
 */
export function userTokenValue(raw: string | null): string | null {
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const value = (parsed as Record<string, unknown>).value
    return typeof value === 'string' && value.length > 0 ? value : null
  } catch {
    return null
  }
}

/**
 * Keep only cookies that belong to the DeepSeek chat.
 * @param cookies - cookies returned by the browser.
 * @returns cookies whose domain ends with `deepseek.com`.
 */
export function deepseekCookies(cookies: readonly BrowserCookie[]): BrowserCookie[] {
  return cookies.filter(cookie => cookie.domain.replace(/^\./u, '').endsWith('deepseek.com'))
}

/**
 * Translate one browser cookie into an Electron cookie record.
 * @param cookie - browser cookie.
 * @returns details accepted by `session.cookies.set`.
 */
export function toCookieDetails(cookie: BrowserCookie): Electron.CookiesSetDetails {
  const domain = cookie.domain.replace(/^\./u, '')
  const sameSite = cookie.sameSite?.toLowerCase()
  // `__Host-` cookies reject a Domain attribute, including the one the browser reports.
  const hostOnly = cookie.name.startsWith('__Host-')
  return {
    url: `https://${domain}${cookie.path.startsWith('/') ? cookie.path : `/${cookie.path}`}`,
    name: cookie.name,
    value: cookie.value,
    ...(hostOnly ? {} : { domain: cookie.domain }),
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    ...(cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate }),
    sameSite: sameSite === 'strict' ? 'strict'
      : sameSite === 'lax' ? 'lax'
        : sameSite === 'none' ? 'no_restriction' : 'unspecified',
  }
}

interface CdpResponse {
  readonly id: number
  readonly result?: Record<string, unknown>
  readonly error?: { readonly message?: string }
}

/** Read one string field from an unknown protocol value. */
function textField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' ? field : undefined
}

/** Collapse whitespace so log lines stay readable. */
function short(value: string): string {
  return value.replace(/\s+/gu, ' ').slice(0, 240)
}

/** Evaluate an expression in the attached page and return its JSON value. */
async function evaluate(cdp: BrowserCdp, sessionId: string, expression: string): Promise<unknown> {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId)
  const outcome = result.result as Record<string, unknown> | undefined
  return outcome?.value
}

/** Minimal DevTools protocol client over the browser WebSocket. */
class BrowserCdp {
  private nextId = 0
  private readonly pending = new Map<number, (response: CdpResponse) => void>()

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const response = JSON.parse(String(event.data)) as CdpResponse
      const resolve = this.pending.get(response.id)
      if (resolve !== undefined) {
        this.pending.delete(response.id)
        resolve(response)
      }
    })
  }

  /**
   * Connect to a browser's DevTools endpoint.
   * @param port - loopback debugging port.
   * @returns the connected client.
   */
  static async connect(port: number): Promise<BrowserCdp> {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`)
    const version: unknown = JSON.parse(await response.text())
    const endpoint = textField(version, 'webSocketDebuggerUrl')
    if (endpoint === undefined) throw new ChatLoginBrowserError('chat login browser: no DevTools endpoint')
    const socket = new WebSocket(endpoint)
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => { resolve() }, { once: true })
      socket.addEventListener('error', () => { reject(new ChatLoginBrowserError('chat login browser: DevTools connection failed')) }, { once: true })
    })
    return new BrowserCdp(socket)
  }

  /**
   * Send one protocol command.
   * @param method - protocol method.
   * @param params - method parameters.
   * @param sessionId - optional flattened target session.
   * @returns the result object.
   * @throws when the browser reports a protocol error.
   */
  async send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    const id = ++this.nextId
    const message: Record<string, unknown> = { id, method, params }
    if (sessionId !== undefined) message.sessionId = sessionId
    const response = await new Promise<CdpResponse>((resolve) => {
      this.pending.set(id, resolve)
      this.socket.send(JSON.stringify(message))
    })
    if (response.error !== undefined) throw new ChatLoginBrowserError(`chat login browser: ${short(response.error.message ?? method)}`)
    return response.result ?? {}
  }

  /** Close the protocol socket. */
  close(): void {
    this.socket.close()
  }
}

/** DevTools-backed session for the controlled browser. */
class DevToolsChatLoginSession implements ChatLoginSession {
  constructor(private readonly cdp: BrowserCdp,
    private readonly sessionId: string, private readonly browser: ChildProcess) {}

  get closed(): boolean {
    return this.browser.exitCode !== null
  }

  /** @returns whether the chat stored a non-empty user token. */
  async hasUserToken(): Promise<boolean> {
    const raw = await evaluate(this.cdp, this.sessionId,
      "(() => { try { return localStorage.getItem('userToken') } catch { return null } })()")
    return userTokenValue(typeof raw === 'string' ? raw : null) !== null
  }

  /** @returns cookies and the raw storage entries the chat needs. */
  async readPayload(): Promise<ChatLoginPayload> {
    const raw = await evaluate(this.cdp, this.sessionId,
      `(() => { const out = {}; for (const key of ${JSON.stringify(CHAT_LOGIN_STORAGE_KEYS)}) { const value = localStorage.getItem(key); if (value !== null) out[key] = value } return JSON.stringify(out) })()`)
    const storage = typeof raw === 'string' ? JSON.parse(raw) as Record<string, string> : {}
    const cookies = await this.cdp.send('Storage.getCookies') as { cookies?: readonly BrowserCookie[] }
    return { cookies: deepseekCookies(cookies.cookies ?? []), storage }
  }

  close(): void {
    this.cdp.close()
  }
}

/** Kill the browser and every helper process it started. */
function stopBrowser(child: ChildProcess): void {
  if (child.exitCode !== null) return
  if (process.platform === 'win32' && child.pid !== undefined) {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {})
    return
  }
  child.kill('SIGTERM')
}

/** Wait for the loopback port Chrome writes after starting with port zero. */
function waitForDevToolsPort(profileDir: string, deadline: number): Promise<number> {
  const file = join(profileDir, 'DevToolsActivePort')
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (Date.now() > deadline) {
        clearInterval(timer)
        reject(new ChatLoginBrowserError('chat login browser: the browser did not start in time'))
        return
      }
      if (!existsSync(file)) return
      const port = Number.parseInt(readFileSync(file, 'utf8').split('\n')[0] ?? '', 10)
      if (!Number.isInteger(port) || port <= 0) return
      clearInterval(timer)
      resolve(port)
    }, 250)
  })
}

/** Wait for the controlled browser to expose its chat page. */
async function waitForChatTarget(cdp: BrowserCdp, deadline: number): Promise<{ targetId: string; sessionId: string }> {
  while (Date.now() < deadline) {
    const targets = await cdp.send('Target.getTargets') as {
      targetInfos?: readonly { type?: string; url?: string; targetId?: string }[]
    }
    const chat = targets.targetInfos?.find(target => target.type === 'page'
      && typeof target.url === 'string' && target.url.startsWith('https://chat.deepseek.com'))
    if (chat?.targetId !== undefined) {
      const attached = await cdp.send('Target.attachToTarget', { targetId: chat.targetId, flatten: true }) as { sessionId?: string }
      if (attached.sessionId === undefined) throw new ChatLoginBrowserError('chat login browser: cannot attach to the chat page')
      return { targetId: chat.targetId, sessionId: attached.sessionId }
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new ChatLoginBrowserError('chat login browser: the browser did not open the chat page')
}

/**
 * Wait until the site stores a user token, the browser closes, or time runs out.
 * @param session - browser-backed polling seam.
 * @param options - deadline, poll interval, and optional clock seams.
 * @returns true when a token appeared, false when the browser was closed by the reader.
 * @throws ChatLoginTimeoutError when the deadline passes without either outcome.
 */
export async function awaitChatLogin(session: ChatLoginSession, options: ChatLoginPollOptions): Promise<boolean> {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)))
  const deadline = now() + options.timeoutMs
  while (now() < deadline) {
    if (options.isCancelled?.() === true) return false
    if (session.closed) return false
    if (await session.hasUserToken()) return true
    await sleep(options.pollMs)
  }
  throw new ChatLoginTimeoutError()
}

/**
 * Launch the controlled browser at the chat page and collect the sign-in.
 * @param request - address, browser, profile, and timing.
 * @returns the payload after the site stored a token, or undefined when the reader closed the browser.
 * @throws ChatLoginBrowserError when the browser cannot start.
 * @throws ChatLoginTimeoutError when the deadline passes.
 */
export async function collectChatLogin(request: ChatLoginBrowserRequest): Promise<ChatLoginPayload | undefined> {
  mkdirSync(request.profileDir, { recursive: true })
  const browser = spawn(request.executable, [
    `--user-data-dir=${request.profileDir}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    request.url,
  ], { stdio: 'ignore' })
  const deadline = Date.now() + request.timeoutMs
  try {
    const port = await waitForDevToolsPort(request.profileDir, Math.min(deadline, Date.now() + 20_000))
    const cdp = await BrowserCdp.connect(port)
    try {
      const target = await waitForChatTarget(cdp, deadline)
      const session = new DevToolsChatLoginSession(cdp, target.sessionId, browser)
      if (!await awaitChatLogin(session, {
        timeoutMs: Math.max(0, deadline - Date.now()),
        pollMs: request.pollMs,
        isCancelled: request.isCancelled,
      })) return undefined
      return await session.readPayload()
    } finally {
      cdp.close()
    }
  } finally {
    stopBrowser(browser)
  }
}
