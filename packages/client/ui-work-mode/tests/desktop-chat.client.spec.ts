// @vitest-environment jsdom
/** The Electron `<webview>` guest lifecycle, without React. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createChatGuest, type ChatGuestState } from '../src/client/desktop-chat.ts'
import type { DesktopChatBridge, DesktopChatConfig } from '../src/types.ts'

/** A stand-in element that records events the way Electron's webview does. */
function fakeElement() {
  const element = Object.assign(document.createElement('div'), {
    loadURL: vi.fn(async () => undefined),
    removed: false,
  })
  const remove = element.remove.bind(element)
  element.remove = () => { element.removed = true; remove() }
  return element
}

const CONFIG = { url: 'https://chat.deepseek.com/' } as DesktopChatConfig
const restores: (() => void)[] = []

/** Install a stand-in for the element the production code creates. */
function installFakeElement(element: HTMLElement): void {
  // oxlint-disable-next-line typescript/no-deprecated -- restoring the DOM factory the mock replaced.
  const original = document.createElement.bind(document)
  Object.defineProperty(document, 'createElement', { configurable: true, value: () => element })
  restores.push(() => {
    Object.defineProperty(document, 'createElement', { configurable: true, value: original })
  })
}
const BRIDGE = { acquire: vi.fn(async () => ({ lease: 'lease-1', partition: 'persist:chat' })) } as unknown as DesktopChatBridge

afterEach(() => {
  for (const restore of restores.splice(0)) restore()
  vi.restoreAllMocks()
})

describe('createChatGuest', () => {
  it('configures the guest, reports loading, and reaches ready after the bootstrap', async () => {
    const element = fakeElement()
    installFakeElement(element)
    const states: ChatGuestState[] = []
    const handle = await createChatGuest({ bridge: BRIDGE, config: CONFIG, label: 'Chat', className: 'frame', onState: state => states.push(state) })
    expect(element.getAttribute('name')).toBe('lease-1')
    expect(element.getAttribute('partition')).toBe('persist:chat')
    expect(element.getAttribute('aria-label')).toBe('Chat')
    expect(element.getAttribute('data-work-mode-frame')).not.toBeNull()
    expect(element.getAttribute('src')).toBe('about:blank#lease-1')
    expect(states).toEqual([])

    element.dispatchEvent(new Event('dom-ready'))
    expect(element.loadURL).toHaveBeenCalledWith(CONFIG.url)
    element.dispatchEvent(new Event('did-stop-loading'))
    expect(states.at(-1)).toBe('ready')

    element.dispatchEvent(new Event('did-start-loading'))
    expect(states.at(-1)).toBe('loading')
    handle.reload()
    expect(element.loadURL).toHaveBeenCalledTimes(2)
    handle.dispose()
    expect(element.removed).toBe(true)
    element.dispatchEvent(new Event('crashed'))
    expect(states.at(-1)).toBe('loading')
  })

  it('reports a failed site load and ignores late lifecycle calls', async () => {
    const element = fakeElement()
    element.loadURL.mockRejectedValueOnce(new Error('offline'))
    installFakeElement(element)
    const states: ChatGuestState[] = []
    const handle = await createChatGuest({ bridge: BRIDGE, config: CONFIG, label: 'Chat', className: 'frame', onState: state => states.push(state) })
    element.dispatchEvent(new Event('dom-ready'))
    element.dispatchEvent(new Event('dom-ready'))
    await Promise.resolve()
    expect(states).toContain('failed')
    handle.dispose()
    handle.reload()
    expect(element.loadURL).toHaveBeenCalledTimes(1)
  })

  it('ignores lifecycle calls before the bootstrap and after disposal', async () => {
    const element = fakeElement()
    installFakeElement(element)
    const states: ChatGuestState[] = []
    const handle = await createChatGuest({ bridge: BRIDGE, config: CONFIG, label: 'Chat', className: 'frame', onState: state => states.push(state) })
    element.dispatchEvent(new Event('did-start-loading'))
    element.dispatchEvent(new Event('did-stop-loading'))
    expect(states).toEqual([])
    handle.dispose()
    element.dispatchEvent(new Event('dom-ready'))
    expect(element.loadURL).not.toHaveBeenCalled()
  })

  it('reports failures only for the main frame and ignores aborted loads', async () => {
    const element = fakeElement()
    installFakeElement(element)
    const states: ChatGuestState[] = []
    const handle = await createChatGuest({ bridge: BRIDGE, config: CONFIG, label: 'Chat', className: 'frame', onState: state => states.push(state) })
    element.dispatchEvent(new Event('dom-ready'))
    const failure = new Event('did-fail-load')
    Object.assign(failure, { isMainFrame: false, errorCode: -2 })
    element.dispatchEvent(failure)
    const aborted = new Event('did-fail-load')
    Object.assign(aborted, { isMainFrame: true, errorCode: -3 })
    element.dispatchEvent(aborted)
    expect(states).not.toContain('failed')
    const mainFrame = new Event('did-fail-load')
    Object.assign(mainFrame, { isMainFrame: true, errorCode: -105 })
    element.dispatchEvent(mainFrame)
    expect(states.at(-1)).toBe('failed')
    element.dispatchEvent(new Event('did-stop-loading'))
    expect(states.at(-1)).toBe('failed')
    for (const name of ['render-process-gone', 'crashed']) element.dispatchEvent(new Event(name))
    expect(states.at(-1)).toBe('crashed')
    handle.dispose()
  })
})
