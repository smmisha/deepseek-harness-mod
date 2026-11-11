/**
 * External-browser fallback for provider sign-in that the embedded browser
 * cannot finish.
 *
 * The controlled Chrome/Edge profile is dedicated to the app, so the reader's
 * own browser is never touched. The attempt completes only after the site
 * itself stores a stable, non-empty `localStorage.userToken`; the resulting
 * cookies and storage entries are handed to the caller. Nothing is read beyond
 * those entries, and no token is logged.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
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

/** Timing and logging for one external-browser login attempt. */
export interface ChatLoginBrowserRequest {
  /** Chat address the controlled browser opens. */
  readonly url: string
  /** Chrome or Edge executable. */
  readonly executable: string
  /** Dedicated profile directory owned by the app. */
  readonly profileDir: string
  /** Overall attempt deadline. */
  readonly timeoutMs: number
  /** Delay between token checks. */
  readonly pollMs: number
  /** Returns true once the document cancelled the attempt. */
  readonly isCancelled?: (() => boolean) | undefined
  /** Token-free diagnostic sink. */
  readonly log?: ((message: string) => void) | undefined
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

/** The dedicated profile is already held by a browser window the reader left open. */
export class ChatLoginWindowOpenError extends Error {
  constructor() {
    super('chat login browser: the sign-in window is already open')
    this.name = 'ChatLoginWindowOpenError'
  }
}

/** Polling and payload seam so tests can drive a deterministic DevTools timeline. */
export interface ChatLoginSession {
  /** True once the browser process exited. */
  readonly closed: boolean
  /** Current non-empty `userToken.value`, or null while signed out or unreadable. */
  readToken(): Promise<string | null>
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

/** One page target reported by `Target.getTargets`. */
export interface ChatLoginTargetInfo {
  readonly type?: string | undefined
  readonly url?: string | undefined
  readonly targetId?: string | undefined
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

/**
 * Select the chat page targets among all inspected targets.
 * @param targets - `Target.getTargets` entries.
 * @returns target ids whose page origin is `https://chat.deepseek.com`.
 */
export function selectChatTargets(targets: readonly ChatLoginTargetInfo[]): string[] {
  return targets.flatMap((target) => {
    if (target.type !== 'page' || typeof target.url !== 'string' || typeof target.targetId !== 'string') return []
    if (!URL.canParse(target.url)) return []
    return new URL(target.url).origin === 'https://chat.deepseek.com' ? [target.targetId] : []
  })
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
   * @throws ChatLoginBrowserError when the endpoint is unreachable or malformed.
   */
  static async connect(port: number): Promise<BrowserCdp> {
    let version: unknown
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      version = JSON.parse(await response.text())
    } catch (error) {
      throw new ChatLoginBrowserError(`chat login browser: ${error instanceof Error ? error.message : 'DevTools fetch failed'}`)
    }
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

/** DevTools-backed session that re-resolves chat targets on every read. */
class DevToolsChatLoginSession implements ChatLoginSession {
  private readonly attached = new Map<string, string>()

  constructor(private readonly cdp: BrowserCdp, private readonly browser: ChildProcess,
    private readonly log: (message: string) => void) {}

  get closed(): boolean {
    return this.browser.exitCode !== null
  }

  /** Attach to one chat target, caching the flattened session. */
  private async attach(targetId: string): Promise<string | undefined> {
    const sessionId = this.attached.get(targetId)
    if (sessionId !== undefined) return sessionId
    const attached = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true }) as { sessionId?: string }
    if (attached.sessionId === undefined) return undefined
    this.attached.set(targetId, attached.sessionId)
    this.log('target attached')
    return attached.sessionId
  }

  /** @returns the current non-empty token value, or null while unreadable. */
  async readToken(): Promise<string | null> {
    const targets = await this.cdp.send('Target.getTargets') as { targetInfos?: readonly ChatLoginTargetInfo[] }
    for (const targetId of selectChatTargets(targets.targetInfos ?? [])) {
      const sessionId = await this.attach(targetId)
      if (sessionId === undefined) continue
      try {
        const raw = await evaluate(this.cdp, sessionId,
          "(() => { try { return localStorage.getItem('userToken') } catch { return null } })()")
        return userTokenValue(typeof raw === 'string' ? raw : null)
      } catch {
        // The document navigated away; drop the stale session and retry next poll.
        this.attached.delete(targetId)
      }
    }
    return null
  }

  /** @returns cookies and the raw storage entries the chat needs. */
  async readPayload(): Promise<ChatLoginPayload> {
    const targets = await this.cdp.send('Target.getTargets') as { targetInfos?: readonly ChatLoginTargetInfo[] }
    const [targetId] = selectChatTargets(targets.targetInfos ?? [])
    if (targetId === undefined) throw new ChatLoginBrowserError('chat login browser: the chat page disappeared')
    const sessionId = await this.attach(targetId)
    if (sessionId === undefined) throw new ChatLoginBrowserError('chat login browser: cannot attach to the chat page')
    const raw = await evaluate(this.cdp, sessionId,
      `(() => { const out = {}; for (const key of ${JSON.stringify(CHAT_LOGIN_STORAGE_KEYS)}) { const value = localStorage.getItem(key); if (value !== null) out[key] = value } return JSON.stringify(out) })()`)
    const storage = typeof raw === 'string' ? JSON.parse(raw) as Record<string, string> : {}
    this.log(`keys read ${Object.keys(storage).join(',')}`)
    const cookies = await this.cdp.send('Storage.getCookies') as { cookies?: readonly BrowserCookie[] }
    return { cookies: deepseekCookies(cookies.cookies ?? []), storage }
  }

  close(): void {
    this.cdp.close()
  }
}

/** Kill the browser process this attempt started; never touches foreign processes. */
function stopOwnBrowser(child: ChildProcess): void {
  if (child.exitCode !== null) return
  child.kill()
}

/** Read the loopback port Chrome writes after starting with port zero. */
function readDevToolsPort(profileDir: string): number | undefined {
  const file = join(profileDir, 'DevToolsActivePort')
  if (!existsSync(file)) return undefined
  const port = Number.parseInt(readFileSync(file, 'utf8').split('\n')[0] ?? '', 10)
  return Number.isInteger(port) && port > 0 ? port : undefined
}

/**
 * Connect to a DevTools endpoint, re-reading the port after a stale one.
 * @param options - deadline, port reader, connector, and optional reset/exited seams.
 * @param log - token-free diagnostic sink.
 * @returns the connected client.
 * @throws ChatLoginWindowOpenError when the browser exited before exposing a port.
 * @throws ChatLoginBrowserError when no endpoint becomes reachable.
 */
export async function retryDevToolsConnection<T>(options: {
  readonly deadline: number
  readonly readPort: () => number | undefined
  readonly connect: (port: number) => Promise<T>
  readonly reset?: () => void
  readonly exited?: () => boolean
  readonly sleep?: (milliseconds: number) => Promise<void>
}, log: (message: string) => void = () => {}): Promise<T> {
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)))
  let lastError: ChatLoginBrowserError | undefined
  while (Date.now() < options.deadline) {
    if (options.exited?.() === true && options.readPort() === undefined) throw new ChatLoginWindowOpenError()
    const port = options.readPort()
    if (port !== undefined) {
      log(`port found ${String(port)}`)
      try {
        const connected = await options.connect(port)
        log('devtools connected')
        return connected
      } catch (error) {
        lastError = error instanceof ChatLoginBrowserError ? error : new ChatLoginBrowserError(String(error))
        log('devtools reconnect')
        options.reset?.()
      }
    }
    await sleep(250)
  }
  throw lastError ?? new ChatLoginBrowserError('chat login browser: the browser did not start in time')
}

/**
 * Connect to the browser, re-reading the port file after a stale endpoint.
 * @param profileDir - dedicated profile directory.
 * @param browser - browser process this attempt started.
 * @param deadline - overall attempt deadline.
 * @param log - token-free diagnostic sink.
 * @returns the connected DevTools session.
 * @throws ChatLoginWindowOpenError when a previous window still holds the profile.
 * @throws ChatLoginBrowserError when no endpoint becomes reachable before the deadline.
 */
async function openDevTools(profileDir: string, browser: ChildProcess, deadline: number,
  log: (message: string) => void): Promise<BrowserCdp> {
  return retryDevToolsConnection({
    deadline,
    readPort: () => readDevToolsPort(profileDir),
    connect: port => BrowserCdp.connect(port),
    reset: () => { rmSync(join(profileDir, 'DevToolsActivePort'), { force: true }) },
    exited: () => browser.exitCode !== null,
  }, log)
}

/**
 * Wait until the site stores two identical non-empty tokens, the browser closes,
 * or time runs out. Evaluate failures during navigation mean "not signed in yet".
 * @param session - browser-backed polling seam.
 * @param options - deadline, poll interval, and optional clock seams.
 * @returns true when a stable token appeared, false when the browser was closed or cancelled.
 * @throws ChatLoginTimeoutError when the deadline passes without either outcome.
 */
export async function awaitChatLogin(session: ChatLoginSession, options: ChatLoginPollOptions): Promise<boolean> {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)))
  const deadline = now() + options.timeoutMs
  let previous: string | null = null
  while (now() < deadline) {
    if (options.isCancelled?.() === true) return false
    if (session.closed) return false
    let token: string | null = null
    try {
      token = await session.readToken()
    } catch {
      token = null
    }
    if (token !== null) {
      if (previous === token) return true
      previous = token
      await sleep(options.pollMs)
      continue
    }
    previous = null
    await sleep(options.pollMs)
  }
  throw new ChatLoginTimeoutError()
}

/**
 * Launch the controlled browser at the chat page and collect the sign-in.
 * @param request - address, browser, dedicated profile, timing, and diagnostics.
 * @returns the payload after the site stored a stable token, or undefined when the reader closed the browser.
 * @throws ChatLoginWindowOpenError when a previous window still holds the profile.
 * @throws ChatLoginBrowserError when the browser cannot start.
 * @throws ChatLoginTimeoutError when the deadline passes.
 */
export async function collectChatLogin(request: ChatLoginBrowserRequest): Promise<ChatLoginPayload | undefined> {
  const log = request.log ?? (() => {})
  mkdirSync(request.profileDir, { recursive: true })
  // A leftover port file from an earlier run would point at a dead endpoint.
  rmSync(join(request.profileDir, 'DevToolsActivePort'), { force: true })
  const browser = spawn(request.executable, [
    `--user-data-dir=${request.profileDir}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    request.url,
  ], { stdio: 'ignore' })
  const deadline = Date.now() + request.timeoutMs
  let cdp: BrowserCdp | undefined
  try {
    cdp = await openDevTools(request.profileDir, browser, Math.min(deadline, Date.now() + 20_000), log)
    const session = new DevToolsChatLoginSession(cdp, browser, log)
    const signedIn = await awaitChatLogin(session, {
      timeoutMs: Math.max(0, deadline - Date.now()),
      pollMs: request.pollMs,
      isCancelled: request.isCancelled,
    })
    if (!signedIn) return undefined
    log('token detected')
    return await session.readPayload()
  } finally {
    cdp?.close()
    stopOwnBrowser(browser)
  }
}
