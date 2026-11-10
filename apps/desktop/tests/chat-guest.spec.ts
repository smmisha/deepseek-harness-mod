/**
 * Chat guest policy: the persistent partition, the attachment check that keeps
 * the side-browser checks intact, the navigation allowlist, and the clipboard
 * permission the site needs.
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
  app: { get isPackaged() { return state.packaged } },
  session: {
    fromPartition: vi.fn((partition: string) => {
      const existing = state.sessions.find(value => value.partition === partition)
      if (existing !== undefined) return existing
      const created: Record<string, unknown> = {
        partition,
        requestHandler: undefined,
        checkHandler: undefined,
        userAgent: undefined,
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

const { CHAT_PARTITION, DesktopBrowserGuests, chatLoginAllowed, chatNavigationAllowed, parseChatConfig } = await import('../src/browser-guests.ts')

const OWNER = (): Electron.WebContents & EventEmitter => {
  const owner = new EventEmitter() as Electron.WebContents & EventEmitter
  Object.assign(owner, { id: 7, send: vi.fn(), isDestroyed: () => false })
  return owner
}

type WindowOpenResult = { action: 'deny' } | { action: 'allow'; overrideBrowserWindowOptions?: unknown }
type AttachedGuest = EventEmitter & { windowOpen?: (details: { url: string; postBody?: unknown }) => WindowOpenResult }

/** Minimal guest double with the events the policy attaches to. */
function guest() {
  const emitter = new EventEmitter()
  let url = ''
  let closed = false
  const self = Object.assign(emitter, {
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
})

describe('parseChatConfig', () => {
  it('accepts a credential-free HTTPS address and origins', () => {
    expect(parseChatConfig({ url: 'https://chat.deepseek.com/', allowedOrigins: ['https://chat.deepseek.com'] }))
      .toEqual({ url: 'https://chat.deepseek.com/', allowedOrigins: ['https://chat.deepseek.com'] })
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

  it('sends allowed pages inside, other links to the system browser, and logs the block in development', () => {
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
    expect(state.warn).toHaveBeenCalledWith(expect.stringContaining('blocked navigation'))

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

describe('chatLoginAllowed', () => {
  it('accepts the site sign-in providers over credential-free HTTPS', () => {
    expect(chatLoginAllowed('https://accounts.google.com/o/oauth2/v2/auth?client_id=x')).toBe(true)
    expect(chatLoginAllowed('https://appleid.apple.com/auth/authorize?client_id=x')).toBe(true)
    expect(chatLoginAllowed('https://www.google.com/accounts?x=1')).toBe(true)
  })

  it('rejects the site itself, plain HTTP, credentials, and other hosts', () => {
    expect(chatLoginAllowed('https://chat.deepseek.com/')).toBe(false)
    expect(chatLoginAllowed('http://accounts.google.com/')).toBe(false)
    expect(chatLoginAllowed('https://user:pass@accounts.google.com/')).toBe(false)
    expect(chatLoginAllowed('https://example.com/')).toBe(false)
    expect(chatLoginAllowed('javascript:alert(1)')).toBe(false)
  })
})

describe('DesktopBrowserGuests chat sign-in windows', () => {
  const CONFIG = { url: 'https://chat.deepseek.com/', allowedOrigins: ['https://chat.deepseek.com'] }

  it('gives the chat session a desktop Chrome user agent', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.acquireChat(owner, CONFIG)
    const chatSession = state.sessions.find(value => value.partition === CHAT_PARTITION)!
    expect(chatSession.userAgent).toEqual(expect.stringContaining('Chrome/'))
    expect(chatSession.userAgent).not.toEqual(expect.stringContaining('Electron/'))
  })

  it('opens a sign-in provider in an embedded window on the chat partition', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const lease = guests.acquireChat(owner, CONFIG).lease
    const attached = attach(owner, lease) as AttachedGuest

    const opened = attached.windowOpen?.({ url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x' })
    expect(opened).toMatchObject({
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: { partition: CHAT_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
      },
    })
    expect(state.openExternal).not.toHaveBeenCalled()
  })

  it('applies the same user agent to a created sign-in window and denies its own popups', () => {
    const owner = OWNER()
    const guests = new DesktopBrowserGuests(() => undefined)
    guests.bind(windowOf(owner), () => () => {}, MESSAGES)
    const lease = guests.acquireChat(owner, CONFIG).lease
    const attached = attach(owner, lease)

    const webContents = {
      setUserAgent: vi.fn(),
      setWindowOpenHandler: vi.fn((handler: unknown) => { webContents.windowOpen = handler }),
      windowOpen: undefined as unknown,
    }
    const child = Object.assign(new EventEmitter(), {
      webContents,
      destroy: vi.fn(),
      isDestroyed: () => false,
    })
    attached.emit('did-create-window', child)

    expect(webContents.setUserAgent).toHaveBeenCalledWith(expect.stringContaining('Chrome/'))
    const handler = webContents.setWindowOpenHandler.mock.calls[0]![0] as () => WindowOpenResult
    expect(handler()).toEqual({ action: 'deny' })
  })
})
