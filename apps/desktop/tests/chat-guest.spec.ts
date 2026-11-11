/**
 * Chat guest policy: the persistent partition, the attachment check that keeps
 * the side-browser checks intact, the navigation allowlist, and the clipboard
 * permission the site needs.
 */
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatLoginBrowserInUseError, ChatLoginTimeoutError } from '../src/chat-login-browser.ts'

const state = vi.hoisted(() => ({
  sessions: [] as Array<Record<string, unknown>>,
  openExternal: vi.fn(async () => {}),
  packaged: false,
  warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
}))

const browserLogin = vi.hoisted(() => ({
  find: vi.fn<() => string | undefined>(() => 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'),
  collect: vi.fn<(request: unknown) => Promise<unknown>>(async () => undefined),
}))

vi.mock('../src/chat-login-browser.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/chat-login-browser.ts')>()
  return { ...actual, findChatBrowser: browserLogin.find, collectChatLogin: browserLogin.collect }
})

vi.mock('electron', () => ({
  app: { get isPackaged() { return state.packaged }, getPath: vi.fn(() => 'C:\\temp\\userData') },
  session: {
    fromPartition: vi.fn((partition: string) => {
      const existing = state.sessions.find(value => value.partition === partition)
      if (existing !== undefined) return existing
      const cookiesSet = vi.fn(async () => {})
      const created: Record<string, unknown> = {
        partition,
        requestHandler: undefined,
        checkHandler: undefined,
        userAgent: undefined,
        cookiesSet,
        cookies: { set: cookiesSet },
        setUserAgent: vi.fn((agent: string) => { created.userAgent = agent }),
        setPermissionRequestHandler: vi.fn((handler: unknown) => { created.requestHandler = handler }),
        setPermissionCheckHandler: vi.fn((handler: unknown) => { created.checkHandler = handler }),
        setDevicePermissionHandler: vi.fn(),
        setDisplayMediaRequestHandler: vi.fn(),
        on: vi.fn(),
        webRequest: { onBeforeRequest: vi.fn() },
      }
      state.sessions.push(created)
      return created
    }),
  },
  shell: { openExternal: state.openExternal },
  Menu: { buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })) },
}))

const { CHAT_PARTITION, DesktopBrowserGuests, chatLoginNavigationAllowed, chatNavigationAllowed, parseChatConfig } = await import('../src/browser-guests.ts')

type OwnerDouble = Electron.WebContents & EventEmitter & { send: ReturnType<typeof vi.fn> }

const OWNER = (): OwnerDouble => {
  const owner = new EventEmitter() as OwnerDouble
  Object.assign(owner, { id: 7, send: vi.fn(), isDestroyed: () => false })
  return owner
}

type WindowOpenResult = { action: 'deny' } | { action: 'allow'; overrideBrowserWindowOptions?: unknown }
type AttachedGuest = EventEmitter & {
  windowOpen?: (details: { url: string; postBody?: unknown }) => WindowOpenResult
  loadURL?: (url: string) => Promise<void>
  executeJavaScript?: (script: string) => Promise<unknown>
}

/** Minimal guest double with the events the policy attaches to. */
function guest() {
  const emitter = new EventEmitter()
  let url = ''
  let closed = false
  const self = Object.assign(emitter, {
    id: 31,
    loadURL: vi.fn(async () => {}),
    executeJavaScript: vi.fn(async () => undefined),
    getURL: () => url,
    setURL: (next: string) => { url = next },
    close: () => { closed = true; emitter.emit('destroyed') },
    isDestroyed: () => closed,
    setWindowOpenHandler: (handler: (details: { url: string; postBody?: unknown }) => WindowOpenResult) => {
      self.windowOpen = handler
    },
    windowOpen: undefined as ((details: { url: string; postBody?: unknown }) => WindowOpenResult) | undefined,
  })
  return self
}

function windowOf(owner: Electron.WebContents) {
  const window = new EventEmitter() as Electron.BrowserWindow & EventEmitter
  Object.assign(window, { webContents: owner })
  return window
}

/** Attach one guest the way Electron reports it after the lease-bearing document is ready. */
function attach(owner: Electron.WebContents, lease: string): EventEmitter & { windowOpen?: unknown } {
  const fake = guest()
  owner.emit('did-attach-webview', {}, fake)
  fake.setURL(`about:blank#${lease}`)
  fake.emit('dom-ready')
  return fake
}

const MESSAGES = () => ({ cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select all', undo: 'Undo', redo: 'Redo' }) as never

beforeEach(() => {
  state.sessions.length = 0
  state.openExternal.mockClear()
  state.warn.mockClear()
  state.packaged = false
  browserLogin.find.mockReturnValue('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  browserLogin.collect.mockReset()
  browserLogin.collect.mockResolvedValue(undefined)
})

describe('parseChatConfig', () => {
  it('accepts a credential-free HTTPS address and origins', () => {
    expect(parseChatConfig({ url: 'https://chat.deepseek.com/', allowedOrigins: ['https://chat.deepseek.com'] }))
      .toEqual({
        url: 'https://chat.deepseek.com/',
        allowedOrigins: ['https://chat.deepseek.com'],
        loginHosts: [],
        loginHostSuffixes: [],
        browserLoginTimeoutMs: 300_000,
        browserLoginPollMs: 2_000,
      })
  })

  it('normalizes configured provider hosts and patterns', () => {
    expect(parseChatConfig({
      url: 'https://chat.deepseek.com/',
      allowedOrigins: ['https://chat.deepseek.com'],
      loginHosts: ['AppleID.Apple.com', 'appleid.apple.com'],
      loginHostSuffixes: ['accounts.google.', 'accounts.google.'],
    })).toEqual({
      url: 'https://chat.deepseek.com/',
      allowedOrigins: ['https://chat.deepseek.com'],
      loginHosts: ['appleid.apple.com'],
      loginHostSuffixes: ['accounts.google.'],
      browserLoginTimeoutMs: 300_000,
      browserLoginPollMs: 2_000,
    })
  })

  it('refuses plain HTTP, credentials, an empty list, and more than eight origins', () => {
    expect(() => parseChatConfig({ url: 'http://chat.deepseek.com/', allowedOrigins: ['https://chat.deepseek.com'] })).toThrow()
    expect(() => parseChatConfig({ url: 'https://u:p@chat.deepseek.com/', allowedOrigins: ['https://chat.deepseek.com'] })).toThrow()
    expect(() => parseChatConfig({ url: 'https://chat.deepseek.com/', allowedOrigins: [] })).toThrow()
    expect(() => parseChatConfig({
      url: 'https://chat.deepseek.com/',
      allowedOrigins: Array.from({ length: 9 }, (_value, index) => `https://o${index}.example`),
    })).toThrow()
    expect(() => parseChatConfig({ url: 'https://chat.deepseek.com/', allowedOrigins: ['http://chat.deepseek.com'] })).toThrow()
  })

  it('refuses malformed provider entries', () => {
    expect(() => parseChatConfig({
      url: 'https://chat.deepseek.com/', allowedOrigins: ['https://chat.deepseek.com'], loginHosts: ['https://accounts.google.com'],
    })).toThrow()
    expect(() => parseChatConfig({
      url: 'https://chat.deepseek.com/', allowedOrigins: ['https://chat.deepseek.com'], loginHostSuffixes: ['accounts.google.com'],
    })).toThrow()
  })
})

describe('chatNavigationAllowed', () => {
  const origins = ['https://chat.deepseek.com']

  it('keeps allowed HTTPS pages inside the guest', () => {
    expect(chatNavigationAllowed('https://chat.deepseek.com/sign_in?x=1', origins)).toBe(true)
  })

  it('opens every other target outside', () => {
    expect(chatNavigationAllowed('https://example.com/', origins)).toBe(false)
    expect(chatNavigationAllowed('http://chat.deepseek.com/', origins)).toBe(false)
    expect(chatNavigationAllowed('https://chat.deepseek.com@evil.example/', origins)).toBe(false)
    expect(chatNavigationAllowed('javascript:alert(1)', origins)).toBe(false)
  })
})

describe('DesktopBrowserGuests chat kind', () => {
  it('issues the single persistent partition and reuses the lease', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    const config = { url: 'https://chat.deepseek.com/', allowedOrigins: ['https://chat.deepseek.com'] }
    const first = guests.acquireChat(owner, config)
    expect(first.partition).toBe(CHAT_PARTITION)
    expect(CHAT_PARTITION.startsWith('persist:')).toBe(true)
    const second = guests.acquireChat(owner, config)
    expect(second.lease).toBe(first.lease)
  })

  it('retires a lease that attached but never produced a guest', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const config = { url: 'https://chat.deepseek.com/', allowedOrigins: ['https://chat.deepseek.com'] }
    const first = guests.acquireChat(owner, config)
    // The renderer may crash between attaching the webview and `dom-ready`.
    owner.emit('will-attach-webview', { preventDefault: () => undefined }, {}, {
      src: `about:blank#${first.lease}`, partition: CHAT_PARTITION,
    })
    const second = guests.acquireChat(owner, config)
    expect(second.lease).not.toBe(first.lease)
    expect(second.partition).toBe(CHAT_PARTITION)
  })

  it('forces the hardened preferences and the chat throttling policy on attachment', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const lease = guests.acquireChat(owner, { url: 'https://chat.deepseek.com/', allowedOrigins: ['https://chat.deepseek.com'] }).lease
    const event = { preventDefault: vi.fn() }
    const preferences: Record<string, unknown> = { nodeIntegration: true, backgroundThrottling: true }
    owner.emit('will-attach-webview', event, preferences, { src: `about:blank#${lease}`, partition: CHAT_PARTITION })
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(preferences).toMatchObject({
      sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, backgroundThrottling: false,
    })
  })

  it('keeps the side-browser checks: wrong partition, unknown lease, and a browser lease are refused', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const chat = guests.acquireChat(owner, { url: 'https://chat.deepseek.com/', allowedOrigins: ['https://chat.deepseek.com'] })
    const foreign = { preventDefault: vi.fn() }
    owner.emit('will-attach-webview', foreign, {}, { src: `about:blank#${chat.lease}`, partition: 'persist:other' })
    expect(foreign.preventDefault).toHaveBeenCalled()
    const unknown = { preventDefault: vi.fn() }
    owner.emit('will-attach-webview', unknown, {}, { src: 'about:blank#not-a-lease', partition: CHAT_PARTITION })
    expect(unknown.preventDefault).toHaveBeenCalled()
    const browser = guests.acquire(owner, 'workspace-a')
    const crossed = { preventDefault: vi.fn() }
    owner.emit('will-attach-webview', crossed, {}, { src: `about:blank#${browser.lease}`, partition: CHAT_PARTITION })
    expect(crossed.preventDefault).toHaveBeenCalled()
  })

  it('issues a fresh lease once the previous guest is gone', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const config = { url: 'https://chat.deepseek.com/', allowedOrigins: ['https://chat.deepseek.com'] }
    const first = guests.acquireChat(owner, config)
    attach(owner, first.lease)
    const second = guests.acquireChat(owner, config)
    expect(second.lease).not.toBe(first.lease)
    expect(second.partition).toBe(CHAT_PARTITION)

    const stale = { preventDefault: vi.fn() }
    owner.emit('will-attach-webview', stale, {}, { src: `about:blank#${first.lease}`, partition: CHAT_PARTITION })
    expect(stale.preventDefault).toHaveBeenCalled()
    const fresh = { preventDefault: vi.fn() }
    owner.emit('will-attach-webview', fresh, {}, { src: `about:blank#${second.lease}`, partition: CHAT_PARTITION })
    expect(fresh.preventDefault).not.toHaveBeenCalled()
  })

  it('allows only the sanitized clipboard write from an allowed origin', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    guests.acquireChat(owner, { url: 'https://chat.deepseek.com/', allowedOrigins: ['https://chat.deepseek.com'] })
    const chatSession = state.sessions.find(value => value.partition === CHAT_PARTITION)!
    const request = chatSession.requestHandler as (
      contents: unknown, permission: string, callback: (allowed: boolean) => void, details: { requestingUrl?: string },
    ) => void
    const write = vi.fn()
    request({}, 'clipboard-sanitized-write', write, { requestingUrl: 'https://chat.deepseek.com/sign_in' })
    expect(write).toHaveBeenCalledWith(true)
    const read = vi.fn()
    request({}, 'clipboard-read', read, { requestingUrl: 'https://chat.deepseek.com/' })
    expect(read).toHaveBeenCalledWith(false)
    const media = vi.fn()
    request({}, 'media', media, { requestingUrl: 'https://chat.deepseek.com/' })
    expect(media).toHaveBeenCalledWith(false)
    const foreign = vi.fn()
    request({}, 'clipboard-sanitized-write', foreign, { requestingUrl: 'https://evil.example/' })
    expect(foreign).toHaveBeenCalledWith(false)
  })

  it('leaves the browser session denying every permission', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    guests.acquire(owner, 'workspace-a')
    const browserSession = state.sessions.find(value => String(value.partition).startsWith('dsh-sidebar-browser-'))!
    const browserRequest = browserSession.requestHandler as (
      contents: unknown, permission: string, callback: (allowed: boolean) => void,
    ) => void
    const browserDecision = vi.fn()
    browserRequest({}, 'clipboard-sanitized-write', browserDecision)
    expect(browserDecision).toHaveBeenCalledWith(false)
  })

  it('sends allowed pages inside and other links to the system browser', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const lease = guests.acquireChat(owner, { url: 'https://chat.deepseek.com/', allowedOrigins: ['https://chat.deepseek.com'] }).lease
    const attached = attach(owner, lease) as AttachedGuest

    const inside = { isMainFrame: true, url: 'https://chat.deepseek.com/a', preventDefault: vi.fn() }
    attached.emit('will-frame-navigate', inside)
    expect(inside.preventDefault).not.toHaveBeenCalled()

    const outside = { isMainFrame: true, url: 'https://example.com/article', preventDefault: vi.fn() }
    attached.emit('will-frame-navigate', outside)
    expect(outside.preventDefault).toHaveBeenCalled()
    expect(state.openExternal).toHaveBeenCalledWith('https://example.com/article')

    const opened = attached.windowOpen?.({ url: 'https://docs.deepseek.com/', postBody: undefined })
    expect(opened).toEqual({ action: 'deny' })
    expect(state.openExternal).toHaveBeenCalledWith('https://docs.deepseek.com/')
  })

  it('keeps the navigation log quiet in packaged builds and still opens the system browser', () => {
    state.packaged = true
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const lease = guests.acquireChat(owner, { url: 'https://chat.deepseek.com/', allowedOrigins: ['https://chat.deepseek.com'] }).lease
    const attached = attach(owner, lease) as EventEmitter
    const blocked = { isMainFrame: true, url: 'https://example.com/x', preventDefault: vi.fn() }
    attached.emit('will-frame-navigate', blocked)
    expect(blocked.preventDefault).toHaveBeenCalled()
    expect(state.openExternal).toHaveBeenCalledWith('https://example.com/x')
    expect(state.warn).not.toHaveBeenCalled()
  })
})

const LOGIN_POLICY = {
  loginHosts: ['accounts.youtube.com', 'appleid.apple.com'],
  loginHostSuffixes: ['accounts.google.'],
}

describe('chatLoginNavigationAllowed', () => {
  it('accepts provider hops and the Google regional chain', () => {
    expect(chatLoginNavigationAllowed('https://accounts.google.com/o/oauth2/v2/auth?client_id=x', LOGIN_POLICY)).toBe(true)
    expect(chatLoginNavigationAllowed('https://accounts.google.co.uk/', LOGIN_POLICY)).toBe(true)
    expect(chatLoginNavigationAllowed('https://accounts.youtube.com/accounts/CheckConnection', LOGIN_POLICY)).toBe(true)
    expect(chatLoginNavigationAllowed('https://appleid.apple.com/auth/authorize', LOGIN_POLICY)).toBe(true)
  })

  it('rejects the chat itself, lookalikes, plain HTTP, credentials, and unknown hosts', () => {
    expect(chatLoginNavigationAllowed('https://chat.deepseek.com/', LOGIN_POLICY)).toBe(false)
    expect(chatLoginNavigationAllowed('https://notaccounts.google.com/', LOGIN_POLICY)).toBe(false)
    expect(chatLoginNavigationAllowed('http://accounts.google.com/', LOGIN_POLICY)).toBe(false)
    expect(chatLoginNavigationAllowed('https://user:pass@accounts.google.com/', LOGIN_POLICY)).toBe(false)
    expect(chatLoginNavigationAllowed('https://example.com/', LOGIN_POLICY)).toBe(false)
    expect(chatLoginNavigationAllowed('javascript:alert(1)', LOGIN_POLICY)).toBe(false)
  })
})

describe('DesktopBrowserGuests chat sign-in', () => {
  const CONFIG = {
    url: 'https://chat.deepseek.com/',
    allowedOrigins: ['https://chat.deepseek.com'],
    loginHosts: ['accounts.youtube.com', 'appleid.apple.com'],
    loginHostSuffixes: ['accounts.google.'],
  }

  it('gives the chat session a desktop Chrome user agent', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.acquireChat(owner, CONFIG)
    const chatSession = state.sessions.find(value => value.partition === CHAT_PARTITION)!
    expect(chatSession.userAgent).toEqual(expect.stringContaining('Chrome/'))
    expect(chatSession.userAgent).not.toEqual(expect.stringContaining('Electron/'))
  })

  it('lets the Google hops navigate the guest main frame, including redirects', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const lease = guests.acquireChat(owner, CONFIG).lease
    const attached = attach(owner, lease) as AttachedGuest

    const navigate = { isMainFrame: true, url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x', preventDefault: vi.fn() }
    attached.emit('will-frame-navigate', navigate)
    expect(navigate.preventDefault).not.toHaveBeenCalled()
    expect(state.openExternal).not.toHaveBeenCalled()

    const redirect = { isMainFrame: true, url: 'https://accounts.youtube.com/accounts/CheckConnection', preventDefault: vi.fn() }
    attached.emit('will-redirect', redirect)
    expect(redirect.preventDefault).not.toHaveBeenCalled()
  })

  it('still hands unrelated blocked pages to the system browser', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const lease = guests.acquireChat(owner, CONFIG).lease
    const attached = attach(owner, lease) as AttachedGuest

    const blocked = { isMainFrame: true, url: 'https://example.com/article', preventDefault: vi.fn() }
    attached.emit('will-frame-navigate', blocked)
    expect(blocked.preventDefault).toHaveBeenCalled()
    expect(state.openExternal).toHaveBeenCalledWith('https://example.com/article')
  })

  it('opens Apple sign-in as a child window on the chat partition with the opener kept', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const lease = guests.acquireChat(owner, CONFIG).lease
    const attached = attach(owner, lease) as AttachedGuest

    const opened = attached.windowOpen?.({ url: 'https://appleid.apple.com/auth/authorize?client_id=x', postBody: undefined })
    expect(opened).toMatchObject({
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: { partition: CHAT_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
      },
    })
    expect(state.openExternal).not.toHaveBeenCalled()
  })

  it('keeps unrelated popups outside the guest', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const lease = guests.acquireChat(owner, CONFIG).lease
    const attached = attach(owner, lease) as AttachedGuest

    const opened = attached.windowOpen?.({ url: 'https://docs.deepseek.com/guide', postBody: undefined })
    expect(opened).toEqual({ action: 'deny' })
    expect(state.openExternal).toHaveBeenCalledWith('https://docs.deepseek.com/guide')
  })

  it('applies the chat user agent to the child window and denies popups inside it', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const lease = guests.acquireChat(owner, CONFIG).lease
    const attached = attach(owner, lease)

    const handlers: Record<string, () => void> = {}
    const webContents = {
      setUserAgent: vi.fn(),
      setWindowOpenHandler: vi.fn((handler: () => { action: 'deny' }) => { webContents.windowOpen = handler }),
      on: vi.fn((name: string, listener: () => void) => { handlers[name] = listener }),
      windowOpen: undefined as (() => { action: 'deny' }) | undefined,
    }
    const child = Object.assign(new EventEmitter(), {
      webContents,
      destroy: vi.fn(),
      isDestroyed: () => false,
    })
    attached.emit('did-create-window', child)

    expect(webContents.setUserAgent).toHaveBeenCalledWith(expect.stringContaining('Chrome/'))
    expect(webContents.windowOpen?.()).toEqual({ action: 'deny' })
    expect(owner.send).toHaveBeenCalledWith('dsh-desktop:chat-login-state', { kind: 'window' })

    child.emit('closed')
    expect(owner.send).toHaveBeenLastCalledWith('dsh-desktop:chat-login-state', { kind: 'idle' })
  })

  it('closes the provider window when the document cancels the sign-in', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const lease = guests.acquireChat(owner, CONFIG).lease
    const attached = attach(owner, lease)
    const child = Object.assign(new EventEmitter(), {
      webContents: { setUserAgent: vi.fn(), setWindowOpenHandler: vi.fn(), on: vi.fn() },
      destroy: vi.fn(),
      isDestroyed: () => false,
    })
    attached.emit('did-create-window', child)

    guests.cancelChatLogin(owner)
    expect(child.destroy).toHaveBeenCalled()
  })

  it('reports Google refusing the embedded browser once per attempt', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const lease = guests.acquireChat(owner, CONFIG).lease
    const attached = attach(owner, lease) as AttachedGuest

    attached.emit('did-navigate', {}, 'https://accounts.google.com/v3/signin/rejected?continue=x')
    expect(owner.send).toHaveBeenCalledWith('dsh-desktop:chat-login-state',
      { kind: 'failed', reason: 'provider-rejected' })
    const reports = owner.send.mock.calls.filter(call => call[0] === 'dsh-desktop:chat-login-state'
      && (call[1] as { kind?: string }).kind === 'failed')
    expect(reports).toHaveLength(1)

    attached.emit('did-navigate', {}, 'https://accounts.google.com/v3/signin/rejected?continue=y')
    expect(owner.send.mock.calls.filter(call => call[0] === 'dsh-desktop:chat-login-state'
      && (call[1] as { kind?: string }).kind === 'failed')).toHaveLength(1)
  })

  it('imports cookies and storage from the controlled browser and reloads the guest', async () => {
    browserLogin.collect.mockResolvedValue({
      cookies: [{ name: 'ds_session_id', value: 'abc', domain: '.deepseek.com', path: '/', secure: true, httpOnly: true }],
      storage: { userToken: 'token-value', '__appKit_userInfo': '{"id":1}', 'deepseek-device-id:chat': 'device' },
    })
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const lease = guests.acquireChat(owner, CONFIG).lease
    const attached = attach(owner, lease) as AttachedGuest

    await guests.startChatBrowserLogin(owner)

    expect(owner.send).toHaveBeenCalledWith('dsh-desktop:chat-login-state', { kind: 'browser' })
    const chatSession = state.sessions.find(value => value.partition === CHAT_PARTITION)!
    expect(chatSession.cookiesSet).toHaveBeenCalledWith(expect.objectContaining({ name: 'ds_session_id' }))
    expect(attached.loadURL).toHaveBeenCalledTimes(2)
    expect(attached.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('localStorage.setItem'))
    expect(attached.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('token-value'))
    expect(owner.send).toHaveBeenLastCalledWith('dsh-desktop:chat-login-state', { kind: 'idle' })
  })

  it('reports a missing browser without starting it', async () => {
    browserLogin.find.mockReturnValue(undefined)
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    guests.acquireChat(owner, CONFIG)

    await guests.startChatBrowserLogin(owner)
    expect(browserLogin.collect).not.toHaveBeenCalled()
    expect(owner.send).toHaveBeenLastCalledWith('dsh-desktop:chat-login-state',
      { kind: 'failed', reason: 'browser-missing' })
  })

  it('reports a timeout from the controlled browser', async () => {
    browserLogin.collect.mockRejectedValue(new ChatLoginTimeoutError())
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const lease = guests.acquireChat(owner, CONFIG).lease
    attach(owner, lease)

    await guests.startChatBrowserLogin(owner)
    expect(owner.send).toHaveBeenLastCalledWith('dsh-desktop:chat-login-state', { kind: 'failed', reason: 'timeout' })
  })

  it('reports a profile that a running browser already holds', async () => {
    browserLogin.collect.mockRejectedValue(new ChatLoginBrowserInUseError())
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const lease = guests.acquireChat(owner, CONFIG).lease
    attach(owner, lease)

    await guests.startChatBrowserLogin(owner)
    expect(owner.send).toHaveBeenLastCalledWith('dsh-desktop:chat-login-state',
      { kind: 'failed', reason: 'browser-in-use' })
  })

  it('reports a transfer failure when the guest cannot store the sign-in', async () => {
    browserLogin.collect.mockResolvedValue({
      cookies: [],
      storage: { userToken: 'token-value' },
    })
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const lease = guests.acquireChat(owner, CONFIG).lease
    const attached = attach(owner, lease) as AttachedGuest
    attached.executeJavaScript = vi.fn(async () => { throw new Error('renderer gone') })

    await guests.startChatBrowserLogin(owner)
    expect(owner.send).toHaveBeenLastCalledWith('dsh-desktop:chat-login-state', { kind: 'failed', reason: 'transfer' })
  })
})
