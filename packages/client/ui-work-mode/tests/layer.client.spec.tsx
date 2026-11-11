// @vitest-environment jsdom
/** The working-mode surface: lazy guest, hidden-but-alive page, and failure recovery. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { allowAllAccess, contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
import type { DesktopChatBridge, DesktopChatConfig, DesktopChatLoginPhase, DesktopChatReservation } from '../src/types.ts'
import type { ChatGuestHandle, ChatGuestOptions } from '../src/client/desktop-chat.ts'
import { WorkModeLayer, type WorkModeLayerProps } from '../src/client/WorkModeLayer.tsx'
import { en } from '../src/client/locales.ts'
import type { WorkMode } from '../src/client/store.ts'

afterEach(cleanup)

const CONFIG: DesktopChatConfig = {
  url: 'https://chat.deepseek.com/',
  allowedOrigins: ['https://chat.deepseek.com'],
  loginHosts: [],
  loginHostSuffixes: [],
  browserLoginTimeoutMs: 300_000,
  browserLoginPollMs: 2_000,
}
const t = ((key: keyof typeof en) => en[key]) as WorkModeLayerProps['t']

function unusedHook(): never {
  throw new Error('the working-mode surface reads no standard hook')
}

/** A guest factory that keeps its options so a test can drive the presentation. */
type GuestSpy = ChatGuestHandle & { reload: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }

function guests() {
  const calls: ChatGuestOptions[] = []
  const handles: GuestSpy[] = []
  const createGuest = vi.fn(async (options: ChatGuestOptions): Promise<ChatGuestHandle> => {
    calls.push(options)
    const element = document.createElement('div')
    element.dataset.testid = 'guest'
    const handle = { element, reload: vi.fn(), dispose: vi.fn(() => { element.remove() }) }
    handles.push(handle)
    return handle
  })
  return { createGuest, calls, handles }
}

const bridge = (): DesktopChatBridge => ({
  acquire: vi.fn(async () => ({
    lease: 'chat-lease' as DesktopChatReservation['lease'],
    partition: 'persist:dsh-chat',
  })),
  onLoginState: () => () => {},
  startBrowserLogin: vi.fn(async () => {}),
  cancelLogin: vi.fn(async () => {}),
})

function props(
  mode: WorkMode,
  options: {
    bridge?: DesktopChatBridge
    createGuest?: (options: ChatGuestOptions) => Promise<ChatGuestHandle>
    setMode?: (mode: WorkMode) => void
    setTopBand?: (px: number | null) => void
  } = {},
): WorkModeLayerProps {
  return {
    useStore: selector => selector({ mode }),
    actions: { setMode: options.setMode ?? (() => {}) },
    setTopBand: options.setTopBand ?? (() => {}),
    usePanelInfo: unusedHook,
    useSessions: unusedHook,
    useSessionStatus: unusedHook,
    useSessionRetainInfo: unusedHook,
    useWorkspaces: unusedHook,
    useResource: unusedHook,
    ...allowAllAccess,
    useContextMenu: contextMenuHook(),
    t,
    config: CONFIG,
    bridge: options.bridge,
    createGuest: options.createGuest ?? guests().createGuest,
  }
}

describe('WorkModeLayer', () => {
  it('offers the site itself where the client cannot embed it', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<WorkModeLayer {...props('chat')} />)
    expect(screen.getByText(en['chat.webTitle'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en['chat.webAction'] }))
    expect(open).toHaveBeenCalledWith(CONFIG.url, '_blank', 'noopener,noreferrer')
    open.mockRestore()
  })

  it('loads the site on the first Chat visit, not before', async () => {
    const factory = guests()
    const acquire = vi.fn(async () => ({
      lease: 'chat-lease' as DesktopChatReservation['lease'],
      partition: 'persist:dsh-chat',
    }))
    const shell: DesktopChatBridge = {
      acquire,
      onLoginState: () => () => {},
      startBrowserLogin: async () => {},
      cancelLogin: async () => {},
    }
    const view = render(<WorkModeLayer {...props('harness', { bridge: shell, createGuest: factory.createGuest })} />)
    expect(acquire).not.toHaveBeenCalled()
    view.rerender(<WorkModeLayer {...props('chat', { bridge: shell, createGuest: factory.createGuest })} />)
    await waitFor(() => { expect(factory.createGuest).toHaveBeenCalledTimes(1) })
    // Returning to Harness keeps the attached guest alive.
    view.rerender(<WorkModeLayer {...props('harness', { bridge: shell, createGuest: factory.createGuest })} />)
    expect(document.querySelector('[data-testid="guest"]')).not.toBeNull()
    expect(factory.createGuest).toHaveBeenCalledTimes(1)
  })

  it('hides the guest and paints the failure card above it', async () => {
    const factory = guests()
    const view = render(<WorkModeLayer {...props('chat', { bridge: bridge(), createGuest: factory.createGuest })} />)
    await waitFor(() => { expect(factory.calls).toHaveLength(1) })
    act(() => { factory.calls[0]?.onState('failed') })
    expect(screen.getByText(en['chat.errorTitle'])).toBeTruthy()
    expect(view.container.querySelector('[data-work-mode-host]')?.getAttribute('data-hidden')).toBe('')
  })

  it('retries a failed load inside the same guest', async () => {
    const factory = guests()
    render(<WorkModeLayer {...props('chat', { bridge: bridge(), createGuest: factory.createGuest })} />)
    await waitFor(() => { expect(factory.calls).toHaveLength(1) })
    act(() => { factory.calls[0]?.onState('failed') })
    fireEvent.click(screen.getByRole('button', { name: en['chat.retry'] }))
    expect(factory.handles[0]?.reload.mock.calls.length).toBe(1)
    expect(factory.createGuest).toHaveBeenCalledTimes(1)
  })

  it('rebuilds the guest after the page process is gone', async () => {
    const factory = guests()
    render(<WorkModeLayer {...props('chat', { bridge: bridge(), createGuest: factory.createGuest })} />)
    await waitFor(() => { expect(factory.calls).toHaveLength(1) })
    act(() => { factory.calls[0]?.onState('crashed') })
    fireEvent.click(screen.getByRole('button', { name: en['chat.retry'] }))
    await waitFor(() => { expect(factory.createGuest).toHaveBeenCalledTimes(2) })
    expect(factory.handles[0]?.dispose.mock.calls.length).toBe(1)
  })

  it('retries a failed lease by building a guest again', async () => {
    const factory = guests()
    const createGuest = vi.fn()
      .mockRejectedValueOnce(new Error('lease refused'))
      .mockImplementation(factory.createGuest)
    render(<WorkModeLayer {...props('chat', { bridge: bridge(), createGuest })} />)
    await waitFor(() => { expect(screen.getByText(en['chat.errorTitle'])).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: en['chat.retry'] }))
    await waitFor(() => { expect(createGuest).toHaveBeenCalledTimes(2) })
  })

  it('reserves its own band through the layout interface', () => {
    const setTopBand = vi.fn()
    const view = render(<WorkModeLayer {...props('harness', { setTopBand })} />)
    expect(setTopBand).toHaveBeenCalledWith(40)
    view.unmount()
    expect(setTopBand).toHaveBeenLastCalledWith(null)
  })

  it('ignores a late guest failure after unmount', async () => {
    let rejectLate: (error: Error) => void = () => {}
    const createGuest = vi.fn(() => new Promise<never>((_resolve, reject) => { rejectLate = reject }))
    const view = render(<WorkModeLayer {...props('chat', { bridge: bridge(), createGuest })} />)
    view.unmount()
    rejectLate(new Error('late refusal'))
    await Promise.resolve()
    await Promise.resolve()
    expect(screen.queryByText(en['chat.errorTitle'])).toBeNull()
  })

  it('drops guest state updates after unmount', () => {
    let captured: ((state: 'loading' | 'ready' | 'failed' | 'crashed') => void) | undefined
    const createGuest = vi.fn((options: ChatGuestOptions) => {
      captured = options.onState
      return new Promise<ChatGuestHandle>(() => {})
    })
    const view = render(<WorkModeLayer {...props('chat', { bridge: bridge(), createGuest })} />)
    view.unmount()
    captured?.('failed')
    expect(screen.queryByText(en['chat.errorTitle'])).toBeNull()
  })

  it('disposes a guest that arrives after unmount', async () => {
    let resolveLate: (handle: ChatGuestHandle) => void = () => {}
    const dispose = vi.fn()
    const createGuest = vi.fn(() => new Promise<ChatGuestHandle>((resolve) => {
      resolveLate = resolve
    }))
    const view = render(<WorkModeLayer {...props('chat', { bridge: bridge(), createGuest })} />)
    view.unmount()
    resolveLate({ element: document.createElement('div'), reload: () => {}, dispose })
    await Promise.resolve()
    await Promise.resolve()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('reserves nothing where the window has a caption row', () => {
    document.documentElement.setAttribute('data-windows-titlebar', '')
    const setTopBand = vi.fn()
    try {
      const view = render(<WorkModeLayer {...props('harness', { setTopBand })} />)
      expect(setTopBand).toHaveBeenCalledWith(null)
      view.unmount()
      expect(setTopBand).toHaveBeenLastCalledWith(null)
    } finally {
      document.documentElement.removeAttribute('data-windows-titlebar')
    }
  })

  it('offers the site itself when embedding is refused', async () => {
    const factory = guests()
    render(<WorkModeLayer {...props('chat', { bridge: bridge(), createGuest: factory.createGuest })} />)
    await waitFor(() => { expect(factory.calls).toHaveLength(1) })
    act(() => { factory.calls[0]?.onState('failed') })
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    fireEvent.click(screen.getByRole('button', { name: en['chat.openInBrowser'] }))
    expect(open).toHaveBeenCalledTimes(1)
    open.mockRestore()
  })

  it('renders provider window, browser, and failure states and drives their actions', async () => {
    let listener: ((state: DesktopChatLoginPhase) => void) | undefined
    const cancelLogin = vi.fn(async () => {})
    const startBrowserLogin = vi.fn(async () => {})
    const shell: DesktopChatBridge = {
      acquire: vi.fn(async () => ({
        lease: 'chat-lease' as DesktopChatReservation['lease'],
        partition: 'persist:dsh-chat',
      })),
      onLoginState: (next) => { listener = next; return () => {} },
      startBrowserLogin,
      cancelLogin,
    }
    const factory = guests()
    render(<WorkModeLayer {...props('chat', { bridge: shell, createGuest: factory.createGuest })} />)
    await waitFor(() => { expect(factory.calls).toHaveLength(1) })

    act(() => { listener?.({ kind: 'window' }) })
    expect(screen.getByText(en['chat.loginPending'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en['chat.loginCancel'] }))
    expect(cancelLogin).toHaveBeenCalledTimes(1)

    act(() => { listener?.({ kind: 'browser' }) })
    expect(screen.getByText(en['chat.browserWaiting'])).toBeTruthy()

    act(() => { listener?.({ kind: 'failed', reason: 'provider-rejected' }) })
    expect(screen.getByText(en['chat.providerRejected'])).toBeTruthy()
    const loginButtons = screen.getAllByRole('button', { name: en['chat.browserLogin'] })
    fireEvent.click(loginButtons[0]!)
    expect(startBrowserLogin).toHaveBeenCalledTimes(1)

    act(() => { listener?.({ kind: 'idle' }) })
    expect(screen.queryByText(en['chat.providerRejected'])).toBeNull()
  })

  it.each([
    ['browser-missing', 'chat.browserMissing'],
    ['timeout', 'chat.browserTimeout'],
    ['transfer', 'chat.browserFailed'],
  ] as const)('renders the %s fallback failure', async (reason, key) => {
    let listener: ((state: DesktopChatLoginPhase) => void) | undefined
    const shell: DesktopChatBridge = {
      acquire: vi.fn(async () => ({
        lease: 'chat-lease' as DesktopChatReservation['lease'],
        partition: 'persist:dsh-chat',
      })),
      onLoginState: (next) => { listener = next; return () => {} },
      startBrowserLogin: vi.fn(async () => {}),
      cancelLogin: vi.fn(async () => {}),
    }
    const factory = guests()
    render(<WorkModeLayer {...props('chat', { bridge: shell, createGuest: factory.createGuest })} />)
    await waitFor(() => { expect(factory.calls).toHaveLength(1) })
    act(() => { listener?.({ kind: 'failed', reason }) })
    expect(screen.getByText(en[key])).toBeTruthy()
  })

  it('starts the browser fallback from the Chat bar', async () => {
    const startBrowserLogin = vi.fn(async () => {})
    const shell: DesktopChatBridge = {
      acquire: vi.fn(async () => ({
        lease: 'chat-lease' as DesktopChatReservation['lease'],
        partition: 'persist:dsh-chat',
      })),
      onLoginState: () => () => {},
      startBrowserLogin,
      cancelLogin: vi.fn(async () => {}),
    }
    const factory = guests()
    render(<WorkModeLayer {...props('chat', { bridge: shell, createGuest: factory.createGuest })} />)
    await waitFor(() => { expect(factory.calls).toHaveLength(1) })
    fireEvent.click(screen.getByRole('button', { name: en['chat.browserLogin'] }))
    expect(startBrowserLogin).toHaveBeenCalledTimes(1)
  })

  it('switches modes through the capsule', () => {
    const setMode = vi.fn()
    render(<WorkModeLayer {...props('harness', { setMode })} />)
    fireEvent.click(screen.getByRole('tab', { name: en['mode.chat'] }))
    expect(setMode).toHaveBeenCalledWith('chat')
  })
})
