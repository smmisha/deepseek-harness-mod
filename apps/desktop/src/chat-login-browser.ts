/**
 * External-browser sign-in hand-off for the embedded Chat.
 *
 * Google refuses OAuth inside embedded browsers, and Electron cannot read a
 * normal browser profile: cookies are encrypted and the profile is locked while
 * Chrome runs. This module launches a dedicated Chrome/Edge profile with the
 * DevTools protocol enabled, lets the reader finish the provider flow there,
 * and returns the resulting DeepSeek cookies for the app's chat partition. The
 * dedicated profile keeps the provider session, so later hand-offs are quick.
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

/** One browser hand-off request. */
export interface ChatLoginBrowserRequest {
  /** Provider URL the reader would otherwise open inside the guest. */
  readonly url: string
  /** Chrome or Edge executable. */
  readonly executable: string
  /** Dedicated profile directory that keeps the provider session. */
  readonly profileDir: string
  /** Overall deadline; defaults to five minutes. */
  readonly timeoutMs?: number
  /** Poll interval; defaults to two seconds. */
  readonly pollMs?: number
}

/** Minimum time a chat page must stay loaded before its cookies are collected. */
const SETTLE_MS = 2500

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
  const record = value as Record<string, unknown>
  const field = record[key]
  return typeof field === 'string' ? field : undefined
}

/** Collapse whitespace so log lines stay readable. */
function short(value: string): string {
  return value.replace(/\s+/gu, ' ').slice(0, 240)
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
    if (endpoint === undefined) throw new Error('chat login browser: no DevTools endpoint')
    const socket = new WebSocket(endpoint)
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => { resolve() }, { once: true })
      socket.addEventListener('error', () => { reject(new Error('chat login browser: DevTools connection failed')) }, { once: true })
    })
    return new BrowserCdp(socket)
  }

  /**
   * Send one protocol command.
   * @param method - protocol method.
   * @param params - method parameters.
   * @returns the result object.
   * @throws when the browser reports a protocol error.
   */
  async send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = ++this.nextId
    const response = await new Promise<CdpResponse>((resolve) => {
      this.pending.set(id, resolve)
      this.socket.send(JSON.stringify({ id, method, params }))
    })
    if (response.error !== undefined) throw new Error(`chat login browser: ${short(response.error.message ?? method)}`)
    return response.result ?? {}
  }

  /** Close the protocol socket. */
  close(): void {
    this.socket.close()
  }
}

/**
 * Read the loopback port Chrome wrote after starting with port zero.
 * @param profileDir - dedicated profile directory.
 * @param deadline - time after which the file is considered missing.
 * @returns the debugging port.
 * @throws when Chrome did not expose a port before the deadline.
 */
function waitForDevToolsPort(profileDir: string, deadline: number): Promise<number> {
  const file = join(profileDir, 'DevToolsActivePort')
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (Date.now() > deadline) {
        clearInterval(timer)
        reject(new Error('chat login browser: the browser did not start in time'))
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

/** Stop the browser and every helper process it started. */
function stopBrowser(child: ChildProcess): void {
  if (child.exitCode !== null) return
  if (process.platform === 'win32' && child.pid !== undefined) {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {})
    return
  }
  child.kill('SIGTERM')
}

/**
 * Launch the controlled browser, wait for the reader to reach the chat, and
 * return its DeepSeek cookies.
 * @param request - provider URL, browser executable, profile directory, and timing.
 * @returns the cookies to copy into the chat partition, or undefined when the flow timed out.
 */
export async function collectChatLoginCookies(request: ChatLoginBrowserRequest): Promise<readonly BrowserCookie[] | undefined> {
  mkdirSync(request.profileDir, { recursive: true })
  const child = spawn(request.executable, [
    `--user-data-dir=${request.profileDir}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    request.url,
  ], { stdio: 'ignore' })
  const timeoutMs = request.timeoutMs ?? 300_000
  const pollMs = request.pollMs ?? 2_000
  const deadline = Date.now() + timeoutMs
  let connected: BrowserCdp | undefined
  try {
    const port = await waitForDevToolsPort(request.profileDir, Math.min(deadline, Date.now() + 20_000))
    connected = await BrowserCdp.connect(port)
    while (Date.now() < deadline) {
      const targets = await connected.send('Target.getTargets') as {
        targetInfos?: readonly { type?: string; url?: string }[]
      }
      const chat = targets.targetInfos?.some(target => target.type === 'page'
        && typeof target.url === 'string'
        && target.url.startsWith('https://chat.deepseek.com/')
        && !target.url.startsWith('https://chat.deepseek.com/sign_in'))
      if (chat === true) {
        await new Promise(resolve => setTimeout(resolve, SETTLE_MS))
        const cookies = await connected.send('Storage.getCookies') as { cookies?: readonly BrowserCookie[] }
        return deepseekCookies(cookies.cookies ?? [])
      }
      await new Promise(resolve => setTimeout(resolve, pollMs))
    }
    return undefined
  } finally {
    connected?.close()
    stopBrowser(child)
  }
}
