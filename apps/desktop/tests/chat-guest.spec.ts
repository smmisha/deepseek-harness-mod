/**
 * Chat guest policy: the persistent partition, the attachment check that keeps
 * the side-browser checks intact, the navigation allowlist, the clipboard
 * permission the site needs, and the sign-in actions the tab offers.
 */
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  sessions: [] as Array<Record<string, unknown>>,
  openExternal: vi.fn(async () => {}),
  packaged: false,
  warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
}))

vi.mock('electron', () => ({
  app: { get isPackaged() { return state.packaged }, getPath: vi.fn(() => 'C:\\temp\\userData') },
  session: {
    fromPartition: vi.fn((partition: string) => {
      const existing = state.sessions.find(value => value.partition === partition)
      if (existing !== undefined) return existing
      const created: Record<string, unknown> = {
        partition,
        permissionRequest: undefined,
        permissionCheck: undefined,
        devicePermission: undefined,
        displayMedia: undefined,
        download: undefined,
        beforeRequest: undefined,
        clearStorageData: vi.fn(async () => {}),
        setPermissionRequestHandler: vi.fn((handler: unknown) => { created.permissionRequest = handler }),
        setPermissionCheckHandler: vi.fn((handler: unknown) => { created.permissionCheck = handler }),
        setDevicePermissionHandler: vi.fn((handler: unknown) => { created.devicePermission = handler }),
        setDisplayMediaRequestHandler: vi.fn((handler: unknown) => { created.displayMedia = handler }),
        on: vi.fn((name: string, listener: unknown) => { if (name === 'will-download') created.download = listener }),
        webRequest: { onBeforeRequest: vi.fn((handler: unknown) => { created.beforeRequest = handler }) },
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
  windowOpen: ((details: { url: string; postBody?: unknown }) => WindowOpenResult) | undefined
  loadURL: ReturnType<typeof vi.fn>
  executeJavaScript: ReturnType<typeof vi.fn>
  reload: ReturnType<typeof vi.fn>
  getURL: () => string
  setURL: (url: string) => void
  close: () => void
  isDestroyed: () => boolean
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
    reload: vi.fn(() => { emitter.emit('did-stop-loading') }),
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
function attach(owner: Electron.WebContents, lease: string): AttachedGuest {
  const fake = guest()
  owner.emit('did-attach-webview', {}, fake)
  fake.setURL(`about:blank#${lease}`)
  fake.emit('dom-ready')
  return fake
}

const MESSAGES = () => ({ cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select all', undo: 'Undo', redo: 'Redo' }) as never

const CONFIG = {
  url: 'https://chat.deepseek.com/',
  allowedOrigins: ['https://chat.deepseek.com'],
  loginHosts: ['accounts.youtube.com', 'appleid.apple.com'],
  loginHostSuffixes: ['accounts.google.'],
}

const LOGIN_POLICY = { loginHosts: CONFIG.loginHosts, loginHostSuffixes: CONFIG.loginHostSuffixes }

/** One attached chat guest with its owner and the guests registry. */
function attachedChat(config: typeof CONFIG | Record<string, unknown> = CONFIG) {
  const owner = OWNER()
  const guests = new DesktopBrowserGuests(() => undefined)
  guests.bind(windowOf(owner), () => () => {}, MESSAGES)
  const lease = guests.acquireChat(owner, config).lease
  const attached = attach(owner, lease)
  return { owner, guests, lease, attached }
}

function chatSession(): Record<string, unknown> {
  return state.sessions.find(value => value.partition === CHAT_PARTITION)!
}

/** Ask one session's request guard about a URL and report its decision. */
function decidesCancellation(session: Record<string, unknown>, url: string): boolean {
  const request = session.beforeRequest as (details: { url: string }, callback: (value: { cancel: boolean }) => void) => void
  const callback = vi.fn()
  request({ url }, callback)
  return (callback.mock.calls[0]![0] as { cancel: boolean }).cancel
}

beforeEach(() => {
  state.sessions.length = 0
  state.openExternal.mockClear()
  state.warn.mockClear()
  state.packaged = false
})

describe('parseChatConfig', () => {
  it('accepts a credential-free HTTPS address and origins', () => {
    expect(parseChatConfig({ url: 'https://chat.deepseek.com/', allowedOrigins: ['https://chat.deepseek.com'] }))
      .toEqual({
        url: 'https://chat.deepseek.com/',
        allowedOrigins: ['https://chat.deepseek.com'],
        loginHosts: [],
        loginHostSuffixes: [],
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
    expect(() => parseChatConfig(null)).toThrow()
    expect(() => parseChatConfig({})).toThrow()
    expect(() => parseChatConfig({ url: 'https://chat.deepseek.com/', allowedOrigins: [7] })).toThrow()
  })

  it('refuses malformed provider entries', () => {
    expect(() => parseChatConfig({
      url: 'https://chat.deepseek.com/', allowedOrigins: ['https://chat.deepseek.com'], loginHosts: ['https://accounts.google.com'],
    })).toThrow()
    expect(() => parseChatConfig({
      url: 'https://chat.deepseek.com/', allowedOrigins: ['https://chat.deepseek.com'], loginHostSuffixes: ['accounts.google.com'],
    })).toThrow()
    expect(() => parseChatConfig({
      url: 'https://chat.deepseek.com/', allowedOrigins: ['https://chat.deepseek.com'], loginHosts: [7],
    })).toThrow()
    expect(() => parseChatConfig({
      url: 'https://chat.deepseek.com/', allowedOrigins: ['https://chat.deepseek.com'], loginHostSuffixes: [7],
    })).toThrow()
    expect(() => parseChatConfig({
      url: 'https://chat.deepseek.com/', allowedOrigins: ['https://chat.deepseek.com'],
      loginHosts: Array.from({ length: 17 }, (_value, index) => `host${String(index)}.example`),
    })).toThrow()
    expect(() => parseChatConfig({
      url: 'https://chat.deepseek.com/', allowedOrigins: ['https://chat.deepseek.com'],
      loginHostSuffixes: Array.from({ length: 17 }, (_value, index) => `.suffix${String(index)}.example`),
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

describe('chatLoginNavigationAllowed', () => {
  const policy = { loginHosts: ['accounts.youtube.com', 'appleid.apple.com'], loginHostSuffixes: ['accounts.google.'] }

  it('accepts provider hops and the Google regional chain', () => {
    expect(chatLoginNavigationAllowed('https://accounts.google.com/o/oauth2/v2/auth?client_id=x', policy)).toBe(true)
    expect(chatLoginNavigationAllowed('https://accounts.google.co.uk/', policy)).toBe(true)
    expect(chatLoginNavigationAllowed('https://accounts.youtube.com/accounts/CheckConnection', policy)).toBe(true)
    expect(chatLoginNavigationAllowed('https://appleid.apple.com/auth/authorize', policy)).toBe(true)
  })

  it('rejects the chat itself, lookalikes, plain HTTP, credentials, and unknown hosts', () => {
    expect(chatLoginNavigationAllowed('https://chat.deepseek.com/', policy)).toBe(false)
    expect(chatLoginNavigationAllowed('https://notaccounts.google.com/', policy)).toBe(false)
    expect(chatLoginNavigationAllowed('http://accounts.google.com/', policy)).toBe(false)
    expect(chatLoginNavigationAllowed('https://user:pass@accounts.google.com/', policy)).toBe(false)
    expect(chatLoginNavigationAllowed('https://example.com/', policy)).toBe(false)
    expect(chatLoginNavigationAllowed('javascript:alert(1)', policy)).toBe(false)
  })
})

describe('DesktopBrowserGuests chat kind', () => {
  it('issues the single persistent partition and reuses the lease', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    const first = guests.acquireChat(owner, CONFIG)
    expect(first.partition).toBe(CHAT_PARTITION)
    expect(CHAT_PARTITION.startsWith('persist:')).toBe(true)
    const second = guests.acquireChat(owner, CONFIG)
    expect(second.lease).toBe(first.lease)
  })

  it('retires a lease that attached but never produced a guest', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const first = guests.acquireChat(owner, CONFIG)
    // The renderer may crash between attaching the webview and `dom-ready`.
    owner.emit('will-attach-webview', { preventDefault: () => undefined }, {}, {
      src: `about:blank#${first.lease}`, partition: CHAT_PARTITION,
    })
    const second = guests.acquireChat(owner, CONFIG)
    expect(second.lease).not.toBe(first.lease)
    expect(second.partition).toBe(CHAT_PARTITION)
  })

  it('forces the hardened preferences and the chat throttling policy on attachment', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const lease = guests.acquireChat(owner, CONFIG).lease
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
    const chat = guests.acquireChat(owner, CONFIG)
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

  it('closes a guest whose bootstrap document names no live lease', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const fake = guest()
    owner.emit('did-attach-webview', {}, fake)
    fake.setURL('about:blank#not-a-lease')
    fake.emit('dom-ready')
    expect(fake.isDestroyed()).toBe(true)
  })

  it('issues a fresh lease once the previous guest is gone', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const first = guests.acquireChat(owner, CONFIG)
    attach(owner, first.lease)
    const second = guests.acquireChat(owner, CONFIG)
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
    guests.acquireChat(owner, CONFIG)
    const session = chatSession()
    const request = session.permissionRequest as (
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
    const broken = vi.fn()
    request({}, 'clipboard-sanitized-write', broken, { requestingUrl: 'not a url' })
    expect(broken).toHaveBeenCalledWith(false)

    const check = session.permissionCheck as (contents: unknown, permission: string, origin: string) => boolean
    expect(check({}, 'clipboard-sanitized-write', 'https://chat.deepseek.com')).toBe(true)
    expect(check({}, 'clipboard-sanitized-write', 'https://evil.example')).toBe(false)
  })

  it('denies device permissions, display capture, downloads, and app-host requests in the chat session', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => 'http://127.0.0.1:5440/')
    guests.acquireChat(owner, CONFIG)
    const session = chatSession()
    expect((session.devicePermission as () => boolean)()).toBe(false)
    const display = vi.fn()
    ;(session.displayMedia as (request: unknown, callback: (value: unknown) => void) => void)({}, display)
    expect(display).toHaveBeenCalledWith({})
    const download = { preventDefault: vi.fn() }
    ;(session.download as (event: { preventDefault: () => void }) => void)(download)
    expect(download.preventDefault).toHaveBeenCalled()

    expect(decidesCancellation(session, 'https://chat.deepseek.com/')).toBe(false)
    expect(decidesCancellation(session, 'https://u:p@chat.deepseek.com/')).toBe(true)
    expect(decidesCancellation(session, 'http://127.0.0.1:5440/login')).toBe(true)
    expect(decidesCancellation(session, 'file:///etc/passwd')).toBe(true)
    expect(decidesCancellation(session, 'about:blank')).toBe(false)
  })

  it('leaves the browser session denying every permission and every download', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    guests.acquire(owner, 'workspace-a')
    const browserSession = state.sessions.find(value => String(value.partition).startsWith('dsh-sidebar-browser-'))!
    const browserRequest = browserSession.permissionRequest as (
      contents: unknown, permission: string, callback: (allowed: boolean) => void,
    ) => void
    const browserDecision = vi.fn()
    browserRequest({}, 'clipboard-sanitized-write', browserDecision)
    expect(browserDecision).toHaveBeenCalledWith(false)
    expect((browserSession.permissionCheck as () => boolean)()).toBe(false)
    expect((browserSession.devicePermission as () => boolean)()).toBe(false)
    const download = { preventDefault: vi.fn() }
    ;(browserSession.download as (event: { preventDefault: () => void }) => void)(download)
    expect(download.preventDefault).toHaveBeenCalled()
    const request = browserSession.beforeRequest as (details: { url: string }, callback: (value: { cancel: boolean }) => void) => void
    const allowed = vi.fn()
    request({ url: 'https://example.com/' }, allowed)
    expect(allowed).toHaveBeenCalledWith({ cancel: false })
    const denied = vi.fn()
    request({ url: 'data:text/html,hi' }, denied)
    expect(denied).toHaveBeenCalledWith({ cancel: false })
    const blocked = vi.fn()
    request({ url: 'chrome://settings' }, blocked)
    expect(blocked).toHaveBeenCalledWith({ cancel: true })
  })

  it('refuses an empty workspace identity and releases only its own leases', async () => {
    const owner = OWNER()
    const other = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    expect(() => guests.acquire(owner, '')).toThrow()
    expect(() => guests.acquire(owner, 7)).toThrow()
    const lease = guests.acquire(owner, 'workspace-a').lease
    await expect(guests.release(other, lease)).rejects.toThrow('another window')
    await expect(guests.release(owner, 'unknown-lease')).resolves.toBeUndefined()
    await expect(guests.release(owner, 7)).rejects.toThrow('invalid guest lease')
  })

  it('sends allowed pages inside and other links to the system browser', () => {
    const { attached } = attachedChat()

    const inside = { isMainFrame: true, url: 'https://chat.deepseek.com/a', preventDefault: vi.fn() }
    attached.emit('will-frame-navigate', inside)
    expect(inside.preventDefault).not.toHaveBeenCalled()

    const subframe = { isMainFrame: false, url: 'https://example.com/frame', preventDefault: vi.fn() }
    attached.emit('will-frame-navigate', subframe)
    expect(subframe.preventDefault).not.toHaveBeenCalled()

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
    const { attached } = attachedChat()
    const blocked = { isMainFrame: true, url: 'https://example.com/x', preventDefault: vi.fn() }
    attached.emit('will-frame-navigate', blocked)
    expect(blocked.preventDefault).toHaveBeenCalled()
    expect(state.openExternal).toHaveBeenCalledWith('https://example.com/x')
    expect(state.warn).not.toHaveBeenCalled()
  })

  it('denies window-open requests before the guest attaches and with bodies', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const fake = guest()
    owner.emit('did-attach-webview', {}, fake)
    // Before `dom-ready` the guest holds no lease and cannot open anything.
    expect(fake.windowOpen?.({ url: 'https://appleid.apple.com/auth', postBody: undefined })).toEqual({ action: 'deny' })
    const window = Object.assign(new EventEmitter(), { destroy: vi.fn(), isDestroyed: () => false })
    fake.emit('did-create-window', window)
    expect(window.destroy).toHaveBeenCalled()

    const lease = guests.acquireChat(owner, CONFIG).lease
    const attached = attach(owner, lease)
    expect(attached.windowOpen?.({ url: 'https://appleid.apple.com/auth', postBody: 'x=1' })).toEqual({ action: 'deny' })
    expect(attached.windowOpen?.({ url: 'javascript:alert(1)', postBody: undefined })).toEqual({ action: 'deny' })
    expect(state.openExternal).not.toHaveBeenCalled()
  })

  it('opens the sidebar browser target through the document', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const browser = guests.acquire(owner, 'workspace-a')
    const fake = guest()
    owner.emit('did-attach-webview', {}, fake)
    fake.setURL(`about:blank#${browser.lease}`)
    fake.emit('dom-ready')
    expect(fake.windowOpen?.({ url: 'https://example.com/', postBody: undefined })).toEqual({ action: 'deny' })
    expect(owner.send).toHaveBeenCalledWith('dsh-desktop:browser-open-requested', {
      lease: browser.lease, url: 'https://example.com/',
    })
    expect(fake.windowOpen?.({ url: 'not a url', postBody: undefined })).toEqual({ action: 'deny' })
  })

})

describe('DesktopBrowserGuests chat sign-in', () => {
  it('lets the Google hops navigate the guest main frame, including redirects', () => {
    const { attached } = attachedChat()
    const navigate = { isMainFrame: true, url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x', preventDefault: vi.fn() }
    attached.emit('will-frame-navigate', navigate)
    expect(navigate.preventDefault).not.toHaveBeenCalled()
    expect(state.openExternal).not.toHaveBeenCalled()

    const redirect = { isMainFrame: true, url: 'https://accounts.youtube.com/accounts/CheckConnection', preventDefault: vi.fn() }
    attached.emit('will-redirect', redirect, redirect.url, false, true)
    expect(redirect.preventDefault).not.toHaveBeenCalled()

    const subframe = { isMainFrame: false, url: 'https://example.com/frame', preventDefault: vi.fn() }
    attached.emit('will-redirect', subframe, subframe.url, false, false)
    expect(subframe.preventDefault).not.toHaveBeenCalled()

    // A redirect target outside the allowlist is cancelled without opening a window.
    const blocked = { isMainFrame: true, url: 'https://example.com/article', preventDefault: vi.fn() }
    attached.emit('will-redirect', blocked, blocked.url, false, true)
    expect(blocked.preventDefault).toHaveBeenCalled()
    expect(state.openExternal).not.toHaveBeenCalled()
  })

  it('opens Apple sign-in as a child window on the chat partition with the opener kept', () => {
    const { attached } = attachedChat()
    const opened = attached.windowOpen?.({ url: 'https://appleid.apple.com/auth/authorize?client_id=x', postBody: undefined })
    expect(opened).toMatchObject({
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: { partition: CHAT_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
      },
    })
    expect(state.openExternal).not.toHaveBeenCalled()
  })

  it('tracks the provider window and denies its own popups', () => {
    const { attached } = attachedChat()
    const handlers: Record<string, (event?: unknown, url?: string) => void> = {}
    const webContents = {
      setWindowOpenHandler: vi.fn((handler: () => { action: 'deny' }) => { webContents.windowOpen = handler }),
      on: vi.fn((name: string, listener: (event?: unknown, url?: string) => void) => { handlers[name] = listener }),
      windowOpen: undefined as (() => { action: 'deny' }) | undefined,
    }
    const child = Object.assign(new EventEmitter(), { webContents, destroy: vi.fn(), isDestroyed: () => false })
    attached.emit('did-create-window', child)
    expect(webContents.windowOpen?.()).toEqual({ action: 'deny' })
    handlers['did-navigate']?.({}, 'https://appleid.apple.com/auth')
    handlers['did-navigate']?.({}, 'not a url')
    child.emit('closed')
    expect(child.destroy).not.toHaveBeenCalled()
  })

  it('closes the provider window when the guest is destroyed', () => {
    const { owner, guests, lease, attached } = attachedChat()
    const child = Object.assign(new EventEmitter(), {
      webContents: { setWindowOpenHandler: vi.fn(), on: vi.fn() },
      destroy: vi.fn(),
      isDestroyed: () => false,
    })
    attached.emit('did-create-window', child)
    attached.close()
    expect(child.destroy).toHaveBeenCalled()
    void guests.release(owner, lease)
  })

  it('reports Google refusing the embedded browser once per attempt', () => {
    const { owner, attached } = attachedChat()
    attached.emit('did-navigate', {}, 'https://accounts.google.com/v3/signin/rejected?continue=x')
    expect(owner.send).toHaveBeenCalledWith('dsh-desktop:chat-login-state', { kind: 'provider-rejected' })
    const reports = owner.send.mock.calls.filter(call => call[0] === 'dsh-desktop:chat-login-state'
      && (call[1] as { kind?: string }).kind === 'provider-rejected')
    expect(reports).toHaveLength(1)

    attached.emit('did-navigate', {}, 'https://accounts.google.com/v3/signin/rejected?continue=y')
    expect(owner.send.mock.calls.filter(call => call[0] === 'dsh-desktop:chat-login-state'
      && (call[1] as { kind?: string }).kind === 'provider-rejected')).toHaveLength(1)
  })

  it('reports the refusal a redirect or page load lands on', () => {
    const { owner, guests, lease } = (() => {
      const owner = OWNER()
      const guests = new DesktopBrowserGuests(() => undefined)
      guests.bind(windowOf(owner), () => () => {}, MESSAGES)
      const lease = guests.acquireChat(owner, CONFIG).lease
      const attached = attach(owner, lease)
      attached.setURL('https://accounts.google.com/v3/signin/rejected')
      attached.emit('did-finish-load')
      return { owner, guests, lease }
    })()
    expect(owner.send).toHaveBeenCalledWith('dsh-desktop:chat-login-state', { kind: 'provider-rejected' })
    void guests.release(owner, lease)
  })

  it('reads the provider page title and only logs the decision', async () => {
    const { owner, attached } = attachedChat()
    attached.executeJavaScript = vi.fn(async () => 'Не удалось войти в аккаунт')
    attached.setURL('https://accounts.google.com/v3/signin/denied')
    attached.emit('did-finish-load')
    await Promise.resolve()
    await Promise.resolve()
    expect(owner.send).toHaveBeenCalledWith('dsh-desktop:chat-login-state', { kind: 'provider-rejected' })
  })

  it('leaves a readable provider page alone', async () => {
    const { owner, attached } = attachedChat()
    attached.executeJavaScript = vi.fn(async () => 'Sign in - Google Accounts')
    attached.setURL('https://accounts.google.com/v3/signin/identifier')
    attached.emit('did-finish-load')
    await Promise.resolve()
    await Promise.resolve()
    expect(owner.send).not.toHaveBeenCalledWith('dsh-desktop:chat-login-state', { kind: 'provider-rejected' })

    attached.executeJavaScript = vi.fn(async () => undefined)
    attached.emit('did-finish-load')
    await Promise.resolve()
    await Promise.resolve()
    expect(owner.send).not.toHaveBeenCalledWith('dsh-desktop:chat-login-state', { kind: 'provider-rejected' })

    attached.executeJavaScript = vi.fn(async () => { throw new Error('renderer gone') })
    attached.emit('did-finish-load')
    await Promise.resolve()
    await Promise.resolve()
    expect(owner.send).not.toHaveBeenCalledWith('dsh-desktop:chat-login-state', { kind: 'provider-rejected' })
  })

  it('ignores page titles on hosts that are not the Google sign-in', async () => {
    const { owner, attached } = attachedChat()
    attached.executeJavaScript = vi.fn(async () => 'Не удалось войти')
    attached.setURL('https://chat.deepseek.com/sign_in')
    attached.emit('did-finish-load')
    await Promise.resolve()
    await Promise.resolve()
    expect(attached.executeJavaScript).not.toHaveBeenCalled()
    expect(owner.send).not.toHaveBeenCalledWith('dsh-desktop:chat-login-state', { kind: 'provider-rejected' })
  })

  it('returns to the configured sign-in page and drops the refusal card', async () => {
    const { owner, attached, guests } = attachedChat()
    attached.emit('did-navigate', {}, 'https://accounts.google.com/v3/signin/rejected')
    expect(owner.send).toHaveBeenCalledWith('dsh-desktop:chat-login-state', { kind: 'provider-rejected' })
    await guests.returnToSignIn(owner)
    expect(attached.loadURL).toHaveBeenCalledWith(CONFIG.url)
    expect(owner.send).toHaveBeenLastCalledWith('dsh-desktop:chat-login-state', { kind: 'idle' })
  })

  it('accepts the site aborting its own redirect while loading sign-in', async () => {
    const { owner, attached, guests } = attachedChat()
    attached.loadURL = vi.fn(async () => { throw Object.assign(new Error('ERR_ABORTED'), { code: 'ERR_ABORTED' }) })
    await expect(guests.returnToSignIn(owner)).resolves.toBeUndefined()
    attached.loadURL = vi.fn(async () => { throw new Error('page ERR_ABORTED') })
    await expect(guests.returnToSignIn(owner)).resolves.toBeUndefined()
  })

  it('reports a real sign-in load failure', async () => {
    const { owner, attached, guests } = attachedChat()
    attached.loadURL = vi.fn(async () => { throw new Error('offline') })
    await expect(guests.returnToSignIn(owner)).rejects.toThrow('offline')
    attached.loadURL = vi.fn(async () => { throw 'offline' })
    await expect(guests.returnToSignIn(owner)).rejects.toThrow()
  })

  it('refuses sign-in actions the document cannot own', async () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.acquireChat(owner, CONFIG)
    await expect(guests.returnToSignIn(owner)).rejects.toThrow('no attached chat guest')
    await expect(guests.clearChatData(owner)).resolves.toBeUndefined()
    expect(() => { guests.openInBrowser(owner) }).not.toThrow()

    const stranger = OWNER()
    expect(() => { guests.openInBrowser(stranger) }).toThrow('owns no chat guest')
    await expect(guests.clearChatData(stranger)).rejects.toThrow('owns no chat guest')
    await expect(guests.returnToSignIn(stranger)).rejects.toThrow('owns no chat guest')
  })

  it('opens the chat address in the system browser without returning data', () => {
    const { owner, guests } = attachedChat()
    guests.openInBrowser(owner)
    expect(state.openExternal).toHaveBeenCalledWith(CONFIG.url)
  })

  it('clears the chat partition and reloads the guest', async () => {
    const { owner, attached, guests } = attachedChat()
    attached.emit('did-navigate', {}, 'https://accounts.google.com/v3/signin/rejected')
    await guests.clearChatData(owner)
    const clear = chatSession().clearStorageData as ReturnType<typeof vi.fn>
    expect(clear).toHaveBeenCalledTimes(1)
    expect(attached.reload).toHaveBeenCalledTimes(1)
    expect(owner.send).toHaveBeenLastCalledWith('dsh-desktop:chat-login-state', { kind: 'idle' })
  })

  it('clears the partition even when the guest is already gone', async () => {
    const { owner, guests } = attachedChat()
    const clear = chatSession().clearStorageData as ReturnType<typeof vi.fn>
    await guests.clearChatData(owner)
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('opens the context menu for editable and selected content', () => {
    const { attached } = attachedChat()
    const editable = {
      isEditable: true, selectionText: '', x: 0, y: 0,
      editFlags: { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
    }
    attached.emit('context-menu', {}, editable)
    const selected = {
      isEditable: false, selectionText: 'word', editFlags: { canCopy: true },
    }
    attached.emit('context-menu', {}, selected)
    attached.emit('context-menu', {}, { isEditable: false, selectionText: '', editFlags: {} })
  })

  it('closes a guest whose renderer is gone', () => {
    const { attached } = attachedChat()
    attached.emit('render-process-gone')
    expect(attached.isDestroyed()).toBe(true)
  })
})

describe('DesktopBrowserGuests edge policies', () => {
  it('refuses malformed navigation input instead of trusting it', () => {
    expect(chatNavigationAllowed('not a url', ['https://chat.deepseek.com'])).toBe(false)
    expect(chatLoginNavigationAllowed('not a url', LOGIN_POLICY)).toBe(false)
    expect(chatLoginNavigationAllowed('https://mail.google.com/', { loginHosts: [], loginHostSuffixes: ['.google.com'] })).toBe(true)
    expect(chatLoginNavigationAllowed('https://example.com/', { loginHosts: [], loginHostSuffixes: ['.google.com'] })).toBe(false)
    expect(parseChatConfig({
      url: 'https://chat.deepseek.com/',
      allowedOrigins: ['https://chat.deepseek.com'],
      loginHostSuffixes: ['.google.com'],
    }).loginHostSuffixes).toEqual(['.google.com'])
  })

  it('keeps one workspace partition for repeated acquisitions', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    const first = guests.acquire(owner, 'workspace-a')
    const second = guests.acquire(owner, 'workspace-a')
    expect(second.partition).toBe(first.partition)
    expect(second.lease).not.toBe(first.lease)
    expect(state.sessions.filter(value => value.partition === first.partition)).toHaveLength(1)
  })

  it('hardens browser guest preferences without the chat throttling policy', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const reservation = guests.acquire(owner, 'workspace-a')
    const event = { preventDefault: vi.fn() }
    const preferences: Record<string, unknown> = { nodeIntegration: true, disablePopups: true }
    owner.emit('will-attach-webview', event, preferences, { src: `about:blank#${reservation.lease}`, partition: reservation.partition })
    expect(preferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, disablePopups: true })
    expect(preferences).not.toHaveProperty('backgroundThrottling')

    const repeated = { preventDefault: vi.fn() }
    owner.emit('will-attach-webview', repeated, {}, { src: `about:blank#${reservation.lease}`, partition: reservation.partition })
    expect(repeated.preventDefault).toHaveBeenCalled()

    const blankless = { preventDefault: vi.fn() }
    owner.emit('will-attach-webview', blankless, {}, { src: 'https://example.com/', partition: '' })
    expect(blankless.preventDefault).toHaveBeenCalled()
  })

  it('closes a bootstrap document whose address carries no lease', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const fake = guest()
    owner.emit('did-attach-webview', {}, fake)
    fake.setURL('https://example.com/')
    fake.emit('dom-ready')
    expect(fake.isDestroyed()).toBe(true)
  })

  it('ignores unreadable page addresses in the navigation log', () => {
    const { attached } = attachedChat()
    attached.setURL('')
    attached.emit('did-finish-load')
    attached.emit('did-navigate', {}, 'not a url')
    attached.emit('did-navigate', {}, 'https://google.com/signin/rejected')
  })

  it('blocks unreadable and non-web targets without a system browser', () => {
    const { owner, attached } = attachedChat()
    const unreadable = { isMainFrame: true, url: 'not a url', preventDefault: vi.fn() }
    attached.emit('will-frame-navigate', unreadable)
    expect(unreadable.preventDefault).toHaveBeenCalled()

    const local = { isMainFrame: true, url: 'file:///etc/passwd', preventDefault: vi.fn() }
    attached.emit('will-frame-navigate', local)
    expect(local.preventDefault).toHaveBeenCalled()
    expect(state.openExternal).not.toHaveBeenCalled()

    // An in-place navigation is not a document change, so the leases stay.
    owner.emit('did-start-navigation', {}, 'https://chat.deepseek.com/sign_in', true, true)
    expect(attached.isDestroyed()).toBe(false)
  })

  it('retires only the leases of the navigating document', () => {
    const { owner, attached, guests } = attachedChat()
    guests.acquireChat(OWNER(), CONFIG)
    owner.emit('did-start-navigation', {}, 'dsh-app://app/next', false, true)
    expect(attached.isDestroyed()).toBe(true)
  })

  it('guards navigations from a guest without a lease and from nested documents', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const lease = guests.acquireChat(owner, CONFIG).lease
    const fake = guest()
    owner.emit('did-attach-webview', {}, fake)

    const allowed = { isMainFrame: true, url: 'https://example.com/', preventDefault: vi.fn() }
    fake.emit('will-frame-navigate', allowed)
    expect(allowed.preventDefault).not.toHaveBeenCalled()

    const blocked = { isMainFrame: true, url: 'file:///etc/passwd', preventDefault: vi.fn() }
    fake.emit('will-frame-navigate', blocked)
    expect(blocked.preventDefault).toHaveBeenCalled()
    expect(state.openExternal).not.toHaveBeenCalled()

    const redirect = { isMainFrame: true, url: 'https://example.com/', preventDefault: vi.fn() }
    fake.emit('will-redirect', redirect, redirect.url, false, true)
    expect(redirect.preventDefault).not.toHaveBeenCalled()

    fake.setURL(`about:blank#${lease}`)
    fake.emit('dom-ready')
  })

  it('reports a refusal reached through a provider navigation or redirect', () => {
    const { owner, attached } = attachedChat()
    const navigate = { isMainFrame: true, url: 'https://accounts.google.com/v3/signin/rejected', preventDefault: vi.fn() }
    attached.emit('will-frame-navigate', navigate)
    expect(navigate.preventDefault).not.toHaveBeenCalled()
    expect(owner.send).toHaveBeenCalledWith('dsh-desktop:chat-login-state', { kind: 'provider-rejected' })

    const redirect = { isMainFrame: true, url: 'https://accounts.google.com/v3/signin/rejected', preventDefault: vi.fn() }
    attached.emit('will-redirect', redirect, redirect.url, false, true)
    expect(redirect.preventDefault).not.toHaveBeenCalled()
  })

  it('refuses nested webviews and HTTP authentication inside the guest', () => {
    const { attached } = attachedChat()
    const nested = { preventDefault: vi.fn() }
    attached.emit('will-attach-webview', nested)
    expect(nested.preventDefault).toHaveBeenCalled()

    const login = { preventDefault: vi.fn() }
    const callback = vi.fn()
    attached.emit('login', login, {}, {}, callback)
    expect(login.preventDefault).toHaveBeenCalled()
    expect(callback).toHaveBeenCalledWith()
  })

  it('retires every lease of the document on a new top-level navigation', () => {
    const { owner, attached } = attachedChat()
    owner.emit('did-start-navigation', {}, 'dsh-app://app/next', false, true)
    expect(attached.isDestroyed()).toBe(true)
  })

  it('publishes nothing to a destroyed document', async () => {
    const owner = OWNER()
    Object.assign(owner, { isDestroyed: () => true })
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.acquireChat(owner, CONFIG)
    await guests.clearChatData(owner)
    expect(owner.send).not.toHaveBeenCalled()
  })

  it('tracks several provider windows and closes only live ones', () => {
    const { attached } = attachedChat()
    const child = () => Object.assign(new EventEmitter(), {
      webContents: { setWindowOpenHandler: vi.fn(), on: vi.fn() },
      destroy: vi.fn(),
      isDestroyed: () => false,
    })
    const first = child()
    const second = child()
    const gone = Object.assign(child(), { isDestroyed: () => true })
    attached.emit('did-create-window', first)
    attached.emit('did-create-window', second)
    attached.emit('did-create-window', gone)

    first.emit('closed')
    expect(first.destroy).not.toHaveBeenCalled()

    attached.close()
    expect(second.destroy).toHaveBeenCalled()
    expect(gone.destroy).not.toHaveBeenCalled()
  })

  it('skips the drop of an already destroyed guest', () => {
    const { attached } = attachedChat()
    attached.close()
    attached.emit('render-process-gone')
    expect(attached.isDestroyed()).toBe(true)
  })

  it('blocks requests to the application host and its loopback aliases', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => 'http://app.local:5440/')
    guests.acquire(owner, 'workspace-a')
    const browserSession = state.sessions.find(value => String(value.partition).startsWith('dsh-sidebar-browser-'))!
    const display = vi.fn()
    ;(browserSession.displayMedia as (request: unknown, callback: (value: unknown) => void) => void)({}, display)
    expect(display).toHaveBeenCalledWith({})
    expect(decidesCancellation(browserSession, 'http://app.local:5440/x')).toBe(true)
    expect(decidesCancellation(browserSession, 'http://localhost:5440/x')).toBe(true)
    expect(decidesCancellation(browserSession, 'http://127.0.0.1:5440/x')).toBe(true)
    expect(decidesCancellation(browserSession, 'http://example.com:5440/x')).toBe(false)
    expect(decidesCancellation(browserSession, 'http://127.0.0.1:9999/x')).toBe(false)
  })
})
