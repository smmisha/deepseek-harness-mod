/**
 * Main-process ownership and fixed isolation policy for embedded webview guests.
 *
 * Two guest kinds share one attachment check: the right-Sidebar browser keeps a
 * process-local partition per workspace, while the Chat tab keeps one persistent
 * partition and a navigation allowlist. Provider sign-in hops are part of the
 * chat allowlist, and Apple's popup sign-in gets a child window on the same
 * partition with the opener preserved. Every attachment still has to name a
 * main-issued lease, match its partition, and come from the application window;
 * the kind only decides the session policy and where disallowed pages go.
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, Menu, session, shell, type BrowserWindow, type BrowserWindowConstructorOptions, type MenuItemConstructorOptions, type Session, type WebContents } from 'electron'
import type { DesktopBrowserLeaseId, DesktopBrowserOpenRequest, DesktopBrowserReservation } from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'
import type { DesktopChatConfig, DesktopChatLeaseId, DesktopChatLoginPhase, DesktopChatReservation } from '@deepseek-ai/dsh-client-ui-work-mode/types'
import type { DesktopMessages } from './locale.ts'
import {
  ChatLoginBrowserError,
  ChatLoginTimeoutError,
  collectChatLogin,
  findChatBrowser,
  toCookieDetails,
  type ChatLoginPayload,
} from './chat-login-browser.ts'
import { logChatLogin } from './chat-login-log.ts'
import { DESKTOP_IPC } from './ipc.ts'

/** The single persistent partition the Chat tab's guest uses. */
export const CHAT_PARTITION = 'persist:dsh-chat'

/** Chat guest permissions that keep the site's copy control working without letting it read the clipboard. */
const CHAT_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write'])

/** Desktop Chrome user agent the Chat page sees instead of Electron's client token. */
const CHAT_USER_AGENT = (() => {
  const platform = process.platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`
})()

/** Upper bound on each configured provider list. */
const MAX_LOGIN_ENTRIES = 16

/** Lowercase host name, without scheme, path, port, or wildcard characters. */
const HOST_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/u

/** Upper bound on a configured navigation allowlist. */
const MAX_ALLOWED_ORIGINS = 8

/** Fields every attached guest carries, whichever kind issued it. */
interface GuestLeaseBase {
  readonly owner: WebContents
  readonly partition: string
  attached: boolean
  guest?: WebContents
  releaseInput?: () => void
}

/** Browser guest in a workspace partition. */
interface BrowserLease extends GuestLeaseBase {
  readonly kind: 'browser'
}

/** Chat guest in the persistent chat partition, with its enforced allowlist. */
interface ChatLease extends GuestLeaseBase {
  readonly kind: 'chat'
  policy: ChatPolicy
}

/** Navigation policy the shell enforces for the chat guest. */
interface ChatPolicy {
  readonly allowedOrigins: readonly string[]
  readonly loginHosts: readonly string[]
  readonly loginHostSuffixes: readonly string[]
  readonly browserLoginTimeoutMs: number
  readonly browserLoginPollMs: number
}

/** Default timing of the external-browser fallback when a profile omits it. */
const DEFAULT_BROWSER_LOGIN_TIMEOUT_MS = 300_000
const DEFAULT_BROWSER_LOGIN_POLL_MS = 2_000

type GuestLease = BrowserLease | ChatLease

type GuestLeaseId = DesktopBrowserLeaseId | DesktopChatLeaseId

/** Normalize one exact provider host from untrusted input. */
function readLoginHost(value: unknown): string {
  if (typeof value !== 'string') throw new Error('desktop chat guest: invalid provider host')
  const entry = value.trim().toLowerCase()
  if (!HOST_NAME.test(entry)) throw new Error('desktop chat guest: invalid provider host')
  return entry
}

/** Normalize one provider pattern from untrusted input. */
function readLoginSuffix(value: unknown): string {
  if (typeof value !== 'string') throw new Error('desktop chat guest: invalid provider suffix')
  const entry = value.trim().toLowerCase()
  const body = entry.startsWith('.') ? entry.slice(1) : entry.endsWith('.') ? entry.slice(0, -1) : undefined
  if (body === undefined || !HOST_NAME.test(body)) {
    throw new Error('desktop chat guest: a provider suffix must start with "." or end with "."')
  }
  return entry
}

/** Normalize one fallback timing value from untrusted input. */
function readTiming(value: unknown, fallback: number, min: number, max: number, name: string): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`desktop chat guest: ${name} must be an integer between ${String(min)} and ${String(max)} milliseconds`)
  }
  return value
}

/**
 * Read a chat guest configuration from untrusted IPC input.
 * @param value - renderer-supplied configuration.
 * @returns the https address, the normalized allowlists, and provider hosts.
 * @throws when the address, an origin, or a provider pattern is invalid.
 */
export function parseChatConfig(value: unknown): DesktopChatConfig {
  if (typeof value !== 'object' || value === null) throw new Error('desktop chat guest: invalid configuration')
  const row = value as Record<string, unknown>
  const source = row.url
  if (typeof source !== 'string') throw new Error('desktop chat guest: a chat URL is required')
  const url = new URL(source)
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new Error('desktop chat guest: the chat URL must be credential-free HTTPS')
  }
  const listed = row.allowedOrigins
  if (!Array.isArray(listed) || listed.length === 0 || listed.length > MAX_ALLOWED_ORIGINS) {
    throw new Error('desktop chat guest: allowedOrigins must name between one and eight origins')
  }
  const origins = listed.map((entry): string => {
    if (typeof entry !== 'string') throw new Error('desktop chat guest: invalid allowed origin')
    const origin = new URL(entry)
    if (origin.protocol !== 'https:' || origin.username !== '' || origin.password !== '') {
      throw new Error('desktop chat guest: allowed origins must be credential-free HTTPS origins')
    }
    return origin.origin
  })
  const loginHosts = row.loginHosts === undefined ? [] : (() => {
    const entry = row.loginHosts
    if (!Array.isArray(entry) || entry.length > MAX_LOGIN_ENTRIES) {
      throw new Error(`desktop chat guest: loginHosts must name at most ${String(MAX_LOGIN_ENTRIES)} entries`)
    }
    return [...new Set(entry.map(readLoginHost))]
  })()
  const loginHostSuffixes = row.loginHostSuffixes === undefined ? [] : (() => {
    const entry = row.loginHostSuffixes
    if (!Array.isArray(entry) || entry.length > MAX_LOGIN_ENTRIES) {
      throw new Error(`desktop chat guest: loginHostSuffixes must name at most ${String(MAX_LOGIN_ENTRIES)} entries`)
    }
    return [...new Set(entry.map(readLoginSuffix))]
  })()
  return {
    url: url.href,
    allowedOrigins: [...new Set(origins)],
    loginHosts,
    loginHostSuffixes,
    browserLoginTimeoutMs: readTiming(row.browserLoginTimeoutMs, DEFAULT_BROWSER_LOGIN_TIMEOUT_MS, 10_000, 1_800_000, 'browserLoginTimeoutMs'),
    browserLoginPollMs: readTiming(row.browserLoginPollMs, DEFAULT_BROWSER_LOGIN_POLL_MS, 250, 10_000, 'browserLoginPollMs'),
  }
}

/**
 * Whether the chat guest may stay on a URL.
 * @param value - candidate main-frame URL.
 * @param allowedOrigins - normalized allowlist.
 * @returns true for a credential-free HTTPS page of an allowed origin.
 */
export function chatNavigationAllowed(value: string, allowedOrigins: readonly string[]): boolean {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return url.protocol === 'https:' && url.username === '' && url.password === ''
    && allowedOrigins.includes(url.origin)
}

/**
 * Whether a chat navigation belongs to a sign-in provider hop.
 * @param value - candidate main-frame URL.
 * @param policy - the chat guest's provider hosts and patterns.
 * @returns true for a credential-free HTTPS provider page.
 */
export function chatLoginNavigationAllowed(value: string, policy: Pick<ChatPolicy, 'loginHosts' | 'loginHostSuffixes'>): boolean {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return false
  const host = url.hostname.toLowerCase()
  return policy.loginHosts.includes(host)
    || policy.loginHostSuffixes.some(pattern => pattern.startsWith('.') ? host.endsWith(pattern) : host.startsWith(pattern))
}

/** A page the shell opens in the system browser instead of embedding it. */
function openableExternally(value: string): boolean {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return ['http:', 'https:'].includes(url.protocol) && url.username === '' && url.password === ''
}

/** Owns workspace storage partitions and the persistent chat partition. */
export class DesktopBrowserGuests {
  private readonly partitions = new Map<string, string>()
  private readonly leases = new Map<GuestLeaseId, GuestLease>()
  private readonly configuredChatSessions = new Set<Session>()
  private readonly chatLoginWindows = new Map<number, Set<BrowserWindow>>()
  private readonly chatLoginStates = new Map<number, DesktopChatLoginPhase>()
  private readonly chatLoginAttempts = new Map<number, { cancelled: boolean }>()
  private chatOrigins: readonly string[] = []

  /** @param hostUrl - current authenticated DSH Host, which guests cannot request. */
  constructor(private readonly hostUrl: () => string | undefined) {}

  /**
   * Reserve one browser guest in a workspace's process-lifetime partition.
   * @param owner - authenticated primary application WebContents.
   * @param workspace - workspace identity received over IPC.
   * @returns opaque lease and the partition approved for it.
   */
  acquire(owner: WebContents, workspace: unknown): DesktopBrowserReservation {
    if (typeof workspace !== 'string' || workspace.length === 0 || workspace.length > 4096) {
      throw new Error('desktop browser: a workspace storage identity is required')
    }
    let partition = this.partitions.get(workspace)
    if (partition === undefined) {
      partition = `dsh-sidebar-browser-${randomUUID()}`
      this.configureSession(session.fromPartition(partition))
      this.partitions.set(workspace, partition)
    }
    const lease = randomUUID() as DesktopBrowserLeaseId
    this.leases.set(lease, { owner, kind: 'browser', partition, attached: false })
    return { lease, partition }
  }

  /**
   * Reserve the Chat tab's guest in its persistent partition.
   * @param owner - authenticated primary application WebContents.
   * @param value - untrusted chat configuration received over IPC.
   * @returns the lease and the fixed persistent partition.
   * @throws when the configuration is invalid.
   */
  acquireChat(owner: WebContents, value: unknown): DesktopChatReservation {
    const config = parseChatConfig(value)
    this.chatOrigins = config.allowedOrigins
    logChatLogin(`policy hosts=${config.loginHosts.join(',')} suffixes=${config.loginHostSuffixes.join(',')}`)
    const existing = [...this.leases.entries()].find(([, lease]) => lease.kind === 'chat' && lease.owner === owner)
    if (existing !== undefined) {
      const lease = existing[1] as ChatLease
      if (!lease.attached && lease.guest === undefined) {
        // Not attached yet: the same lease still owns the partition.
        lease.policy = {
          allowedOrigins: config.allowedOrigins,
          loginHosts: config.loginHosts,
          loginHostSuffixes: config.loginHostSuffixes,
          browserLoginTimeoutMs: config.browserLoginTimeoutMs,
          browserLoginPollMs: config.browserLoginPollMs,
        }
        return { lease: existing[0] as DesktopChatLeaseId, partition: CHAT_PARTITION }
      }
      // An attached lease whose guest never arrived (a crash before `dom-ready`) or
      // is being replaced still holds the attachment slot; retire it so the
      // attachment check accepts the fresh one.
      this.retireLease(existing[0], lease)
    }
    const browserSession = session.fromPartition(CHAT_PARTITION)
    if (!this.configuredChatSessions.has(browserSession)) {
      this.configuredChatSessions.add(browserSession)
      this.configureChatSession(browserSession)
    }
    const lease = randomUUID() as DesktopChatLeaseId
    this.leases.set(lease, {
      owner, kind: 'chat', partition: CHAT_PARTITION, attached: false,
      policy: {
        allowedOrigins: config.allowedOrigins,
        loginHosts: config.loginHosts,
        loginHostSuffixes: config.loginHostSuffixes,
        browserLoginTimeoutMs: config.browserLoginTimeoutMs,
        browserLoginPollMs: config.browserLoginPollMs,
      },
    })
    return { lease, partition: CHAT_PARTITION }
  }

  /**
   * Release only a lease issued to this application window; workspace storage survives.
   * @param owner - authenticated IPC sender.
   * @param id - lease received over IPC.
   */
  async release(owner: WebContents, id: unknown): Promise<void> {
    if (typeof id !== 'string') throw new Error('desktop browser: invalid guest lease')
    const key = id as GuestLeaseId
    const lease = this.leases.get(key)
    if (lease === undefined) return
    if (lease.owner !== owner) throw new Error('desktop browser: guest belongs to another window')
    lease.releaseInput?.()
    this.leases.delete(key)
    const guest = lease.guest
    if (guest !== undefined && !guest.isDestroyed()) {
      const destroyed = new Promise<void>((resolve) => { guest.once('destroyed', resolve) })
      guest.close({ waitForBeforeUnload: false })
      await destroyed
    }
  }

  /**
   * Install attachment checks before the application document can create a webview.
   * @param window - primary application window.
   * @param attachInput - attaches native input after guest ownership is verified and returns its disposer.
   * @param messages - resolved Desktop messages for the guest context menu.
   */
  bind(window: BrowserWindow, attachInput: (guest: WebContents, name: DesktopBrowserLeaseId) => () => void,
    messages: () => DesktopMessages): void {
    const owner = window.webContents
    owner.on('will-attach-webview', (event, preferences, params) => {
      const id = typeof params.src === 'string' && params.src.startsWith('about:blank#')
        ? params.src.slice('about:blank#'.length) : ''
      const lease = this.leases.get(id as GuestLeaseId)
      if (lease === undefined || lease.owner !== owner || lease.attached || params.partition !== lease.partition) {
        event.preventDefault()
        return
      }
      lease.attached = true
      // Keep Electron's allowpopups dispatch flag; the guest handler still denies native windows.
      for (const key of Object.keys(preferences)) {
        if (key !== 'disablePopups') Reflect.deleteProperty(preferences, key)
      }
      Object.assign(preferences, {
        partition: lease.partition,
        nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
        contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
        webviewTag: false, plugins: false, navigateOnDragDrop: false, disableDialogs: true,
        // A hidden Chat tab keeps its stream and timers alive.
        ...(lease.kind === 'chat' ? { backgroundThrottling: false } : {}),
        devTools: !app.isPackaged,
      })
      params.httpreferrer = ''
    })
    owner.on('did-attach-webview', (_event, guest) => {
      let attachedLease: GuestLeaseId | undefined
      // The first document is an inert about:blank carrying the approved lease.
      // Bind on the main-process event before the renderer can navigate the ready guest.
      guest.once('dom-ready', () => {
        const url = guest.getURL()
        const id = (url.startsWith('about:blank#') ? url.slice('about:blank#'.length) : '') as GuestLeaseId
        const lease = this.leases.get(id)
        if (lease === undefined || lease.owner !== owner || lease.guest !== undefined) {
          guest.close({ waitForBeforeUnload: false })
          return
        }
        lease.guest = guest
        attachedLease = id
        // The right Sidebar's frame routing owns input for its own guests only.
        if (lease.kind === 'browser') lease.releaseInput = attachInput(guest, id as DesktopBrowserLeaseId)
        guest.once('destroyed', () => {
          lease.releaseInput?.()
          this.closeChatLoginWindows(owner)
          this.leases.delete(id)
        })
        if (lease.kind === 'chat') {
          logChatLogin('guest attached')
          guest.on('did-finish-load', () => {
            if (URL.canParse(guest.getURL())) logChatLogin(`guest loaded host=${new URL(guest.getURL()).hostname}`)
          })
          this.attachChatPolicies(window, guest, messages)
        }
      })
      guest.setWindowOpenHandler(({ url, postBody }) => {
        const lease = attachedLease === undefined ? undefined : this.leases.get(attachedLease)
        if (attachedLease === undefined || lease?.guest !== guest || lease.owner !== owner || owner.isDestroyed()) {
          return { action: 'deny' }
        }
        if (postBody !== undefined) return { action: 'deny' }
        if (lease.kind === 'chat') {
          // Apple's popup sign-in needs a real child window on the chat
          // partition so its web_message reply can reach the opener.
          if (chatLoginNavigationAllowed(url, lease.policy)) {
            logChatLogin(`provider window host=${new URL(url).hostname}`)
            return { action: 'allow', overrideBrowserWindowOptions: this.chatLoginWindowOptions() }
          }
          if (openableExternally(url)) void shell.openExternal(url)
          return { action: 'deny' }
        }
        if (this.allowedNavigation(url)) {
          const request: DesktopBrowserOpenRequest = { lease: attachedLease as DesktopBrowserLeaseId, url: new URL(url).href }
          owner.send(DESKTOP_IPC.browserOpenRequested, request)
        }
        return { action: 'deny' }
      })
      guest.on('did-create-window', (child) => {
        if (attachedLease === undefined) {
          child.destroy()
          return
        }
        child.webContents.setUserAgent(CHAT_USER_AGENT)
        child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        child.webContents.on('did-navigate', (_event, url) => {
          if (URL.canParse(url)) logChatLogin(`provider window navigated host=${new URL(url).hostname}`)
        })
        this.trackChatLoginWindow(owner, child)
      })
      guest.on('will-frame-navigate', (event) => {
        if (!event.isMainFrame) return
        const lease = attachedLease === undefined ? undefined : this.leases.get(attachedLease)
        if (this.allows(lease, event.url)) {
          if (lease?.kind === 'chat' && chatLoginNavigationAllowed(event.url, lease.policy)) {
            logChatLogin(`allowed navigation host=${new URL(event.url).hostname}`)
          }
          return
        }
        event.preventDefault()
        this.reportBlocked(lease, event.url, owner)
      })
      guest.on('will-redirect', (event, url, _inPlace, mainFrame) => {
        if (!mainFrame) return
        const lease = attachedLease === undefined ? undefined : this.leases.get(attachedLease)
        if (this.allows(lease, url)) {
          if (lease?.kind === 'chat' && chatLoginNavigationAllowed(url, lease.policy)) {
            logChatLogin(`allowed redirect host=${new URL(url).hostname}`)
          }
          return
        }
        event.preventDefault()
        this.reportBlocked(lease, url)
      })
      guest.on('will-attach-webview', (event) => { event.preventDefault() })
      guest.on('login', (event, _details, _authInfo, callback) => { event.preventDefault(); callback() })
    })
    const releaseAll = (): void => {
      for (const [id, lease] of this.leases) {
        if (lease.owner === owner) void this.release(owner, id).catch((error: unknown) => { console.error(error) })
      }
    }
    owner.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) releaseAll()
    })
    owner.on('render-process-gone', releaseAll)
    owner.once('destroyed', releaseAll)
  }

  /** Retire one lease and close the guest it still holds. */
  private retireLease(id: GuestLeaseId, lease: GuestLease): void {
    lease.releaseInput?.()
    this.leases.delete(id)
    const guest = lease.guest
    if (guest !== undefined && !guest.isDestroyed()) guest.close({ waitForBeforeUnload: false })
  }

  /** Navigation guards, context menu, and user-agent policy for one chat guest. */
  private attachChatPolicies(window: BrowserWindow, guest: WebContents, messages: () => DesktopMessages): void {
    const owner = window.webContents
    guest.on('did-navigate', (_event, url) => {
      if (!URL.canParse(url)) return
      const parsed = new URL(url)
      if (parsed.hostname === 'accounts.google.com' && parsed.pathname.includes('/signin/rejected')) {
        logChatLogin('provider rejected the embedded browser')
        this.publishLogin(owner, { kind: 'failed', reason: 'provider-rejected' })
      }
    })
    guest.on('context-menu', (_event, params) => {
      const items: MenuItemConstructorOptions[] = []
      if (params.isEditable) {
        items.push(
          { role: 'undo', enabled: params.editFlags.canUndo },
          { role: 'redo', enabled: params.editFlags.canRedo },
          { type: 'separator' },
          { role: 'cut', enabled: params.editFlags.canCut },
          { role: 'copy', enabled: params.editFlags.canCopy },
          { role: 'paste', enabled: params.editFlags.canPaste },
          { type: 'separator' },
          { role: 'selectAll', enabled: params.editFlags.canSelectAll },
        )
      } else if (params.selectionText.length > 0) {
        items.push({ role: 'copy', enabled: params.editFlags.canCopy })
      }
      if (items.length === 0) return
      // Empty accelerators suppress Electron's default shortcut labels for native roles.
      const dictionary = messages()
      Menu.buildFromTemplate(items.map(item => ({
        ...item,
        ...(process.platform === 'win32' && item.role !== undefined && item.role in dictionary
          ? { label: dictionary[item.role as keyof DesktopMessages] } : {}),
        accelerator: '',
      }))).popup({ window })
    })
    // A destroyed renderer leaves nothing to show; the renderer reports the failure itself.
    guest.on('render-process-gone', () => {
      if (!guest.isDestroyed()) guest.close({ waitForBeforeUnload: false })
    })
  }

  /** Provider popup: same partition, sandbox, and user agent as the chat guest. */
  private chatLoginWindowOptions(): BrowserWindowConstructorOptions {
    return {
      width: 780,
      height: 820,
      autoHideMenuBar: true,
      webPreferences: {
        partition: CHAT_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        devTools: !app.isPackaged,
      },
    }
  }

  /** Publish one sign-in phase to the document. */
  private publishLogin(owner: WebContents, phase: DesktopChatLoginPhase): void {
    this.chatLoginStates.set(owner.id, phase)
    if (owner.isDestroyed()) return
    owner.send(DESKTOP_IPC.chatLoginState, phase)
  }

  /** Sign-in phase currently visible for one document. */
  chatLoginPhase(owner: WebContents): DesktopChatLoginPhase {
    return this.chatLoginStates.get(owner.id) ?? { kind: 'idle' }
  }

  /** Track one provider window until it closes, and publish the phase. */
  private trackChatLoginWindow(owner: WebContents, child: BrowserWindow): void {
    const windows = this.chatLoginWindows.get(owner.id) ?? new Set<BrowserWindow>()
    windows.add(child)
    this.chatLoginWindows.set(owner.id, windows)
    logChatLogin('provider window opened')
    this.publishLogin(owner, { kind: 'window' })
    child.once('closed', () => {
      windows.delete(child)
      if (windows.size === 0) this.chatLoginWindows.delete(owner.id)
      logChatLogin('provider window closed')
      if (windows.size === 0 && this.chatLoginPhase(owner).kind === 'window') this.publishLogin(owner, { kind: 'idle' })
    })
  }

  /** Close every provider window the document still owns. */
  private closeChatLoginWindows(owner: WebContents): void {
    const windows = this.chatLoginWindows.get(owner.id)
    if (windows === undefined) return
    this.chatLoginWindows.delete(owner.id)
    for (const window of windows) if (!window.isDestroyed()) window.destroy()
  }

  /** Close the provider window or stop the browser attempt for one document. */
  cancelChatLogin(owner: WebContents): void {
    const attempt = this.chatLoginAttempts.get(owner.id)
    if (attempt !== undefined) attempt.cancelled = true
    this.closeChatLoginWindows(owner)
    this.publishLogin(owner, { kind: 'idle' })
  }

  /**
   * Start the controlled-browser fallback for one document.
   * @param owner - authenticated application WebContents.
   */
  async startChatBrowserLogin(owner: WebContents): Promise<void> {
    if (this.chatLoginAttempts.has(owner.id)) return
    const executable = findChatBrowser()
    if (executable === undefined) {
      logChatLogin('browser login failed reason=browser-missing')
      this.publishLogin(owner, { kind: 'failed', reason: 'browser-missing' })
      return
    }
    const attempt = { cancelled: false }
    const isCancelled = (): boolean => attempt.cancelled
    this.chatLoginAttempts.set(owner.id, attempt)
    this.publishLogin(owner, { kind: 'browser' })
    logChatLogin('browser login started')
    const lease = [...this.leases.values()].find((entry): entry is ChatLease =>
      entry.kind === 'chat' && entry.owner === owner)
    const policy = lease?.policy
    try {
      const payload = await collectChatLogin({
        url: 'https://chat.deepseek.com/',
        executable,
        profileDir: join(app.getPath('userData'), 'chat-login-browser'),
        timeoutMs: policy?.browserLoginTimeoutMs ?? DEFAULT_BROWSER_LOGIN_TIMEOUT_MS,
        pollMs: policy?.browserLoginPollMs ?? DEFAULT_BROWSER_LOGIN_POLL_MS,
        isCancelled,
      })
      if (isCancelled()) return
      if (payload === undefined) {
        logChatLogin('browser login ended: browser closed')
        this.publishLogin(owner, { kind: 'idle' })
        return
      }
      const guest = lease?.guest
      if (guest === undefined || guest.isDestroyed()) {
        logChatLogin('browser login failed reason=transfer (no guest)')
        this.publishLogin(owner, { kind: 'failed', reason: 'transfer' })
        return
      }
      await this.transferChatLogin(guest, payload)
      if (isCancelled()) return
      logChatLogin('browser login imported')
      this.publishLogin(owner, { kind: 'idle' })
    } catch (error) {
      if (isCancelled()) return
      const reason = error instanceof ChatLoginTimeoutError ? 'timeout'
        : error instanceof ChatLoginBrowserError ? 'browser-missing' : 'transfer'
      logChatLogin(`browser login failed reason=${reason} error=${error instanceof Error ? error.name : 'unknown'}`)
      this.publishLogin(owner, { kind: 'failed', reason })
    } finally {
      this.chatLoginAttempts.delete(owner.id)
    }
  }

  /** Apply the controlled browser's cookies and storage to the chat guest. */
  private async transferChatLogin(guest: WebContents, payload: ChatLoginPayload): Promise<void> {
    const chatSession = session.fromPartition(CHAT_PARTITION)
    for (const cookie of payload.cookies) {
      try {
        await chatSession.cookies.set(toCookieDetails(cookie))
      } catch (error) {
        // A browser-only cookie must not stop the session from being restored.
        void error
      }
    }
    await guest.loadURL('https://chat.deepseek.com/')
    const assignments = Object.entries(payload.storage)
      .map(([key, value]) => `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});`)
      .join(' ')
    if (assignments.length > 0) await guest.executeJavaScript(`(() => { ${assignments} })()`)
    await guest.loadURL('https://chat.deepseek.com/')
  }

  /** Browser policy for the right Sidebar, chat policy for the Chat tab. */
  private allows(lease: GuestLease | undefined, value: string): boolean {
    if (lease?.kind === 'chat') {
      return chatNavigationAllowed(value, lease.policy.allowedOrigins)
        || chatLoginNavigationAllowed(value, lease.policy)
    }
    return this.allowedNavigation(value)
  }

  /** Report a blocked chat navigation and hand the target to the reader's browser. */
  private reportBlocked(lease: GuestLease | undefined, value: string, owner?: WebContents): void {
    if (lease?.kind !== 'chat') return
    if (URL.canParse(value)) logChatLogin(`blocked host=${new URL(value).hostname}`)
    // A user-clicked page outside the allowlist belongs to the reader's browser in every build.
    if (owner === undefined) return
    if (openableExternally(value)) void shell.openExternal(value)
  }

  private configureSession(browserSession: Session): void {
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false) })
    browserSession.setPermissionCheckHandler(() => false)
    browserSession.setDevicePermissionHandler(() => false)
    browserSession.setDisplayMediaRequestHandler((_request, callback) => { callback({}) })
    browserSession.on('will-download', (event) => { event.preventDefault() })
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url)
      const network = ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)
      callback({ cancel: network
        ? url.username !== '' || url.password !== '' || this.isApplicationHost(url)
        : !['about:', 'data:', 'blob:'].includes(url.protocol) })
    })
  }

  /** The Chat tab keeps its sign-in, and only clipboard access besides. */
  private configureChatSession(browserSession: Session): void {
    browserSession.setUserAgent(CHAT_USER_AGENT)
    const permitted = (permission: string): boolean => CHAT_PERMISSIONS.has(permission)
    const fromChatOrigin = (origin: string): boolean => {
      if (!URL.canParse(origin)) return false
      return this.chatOrigins.includes(new URL(origin).origin)
    }
    browserSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
      callback(permitted(permission) && fromChatOrigin(details.requestingUrl))
    })
    browserSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
      return permitted(permission) && fromChatOrigin(requestingOrigin)
    })
    browserSession.setDevicePermissionHandler(() => false)
    browserSession.setDisplayMediaRequestHandler((_request, callback) => { callback({}) })
    browserSession.on('will-download', (event) => { event.preventDefault() })
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url)
      const network = ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)
      callback({ cancel: network
        ? url.username !== '' || url.password !== '' || this.isApplicationHost(url)
        : !['about:', 'data:', 'blob:'].includes(url.protocol) })
    })
  }

  private allowedNavigation(value: string): boolean {
    if (!URL.canParse(value)) return false
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && url.username === '' && url.password === ''
      && !this.isApplicationHost(url)
  }

  private isApplicationHost(url: URL): boolean {
    const value = this.hostUrl()
    if (value === undefined) return false
    const host = new URL(value)
    return url.port === host.port
      && (url.hostname === host.hostname || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  }
}
