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

const reservation = async (): Promise<DesktopChatReservation> => ({
  lease: 'chat-lease' as DesktopChatReservation['lease'],
  partition: 'persist:dsh-chat',
})

function bridge(overrides: Partial<DesktopChatBridge> = {}): DesktopChatBridge {
  return {
    acquire: vi.fn(async () => reservation()),
    onLoginState: () => () => {},
    returnToSignIn: vi.fn(),
    openInBrowser: vi.fn(),
    clearData: vi.fn(),
    ...overrides,
  }
}

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
    const acquire = vi.fn(async () => reservation())
    const shell = bridge({ acquire })
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

  it('shows the provider refusal card and drives both ways out', async () => {
    let listener: ((state: DesktopChatLoginPhase) => void) | undefined
    const returnToSignIn = vi.fn()
    const openInBrowser = vi.fn()
    const shell = bridge({
      onLoginState: (next) => { listener = next; return () => {} },
      returnToSignIn,
      openInBrowser,
    })
    const factory = guests()
    render(<WorkModeLayer {...props('chat', { bridge: shell, createGuest: factory.createGuest })} />)
    await waitFor(() => { expect(factory.calls).toHaveLength(1) })

    act(() => { listener?.({ kind: 'provider-rejected' }) })
    expect(screen.getByText(en['chat.providerRejectedTitle'])).toBeTruthy()
    expect(screen.getByText(en['chat.providerRejectedBody'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en['chat.providerRejectedReturn'] }))
    expect(returnToSignIn).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: en['chat.openChatInBrowser'] }))
    expect(openInBrowser).toHaveBeenCalledTimes(1)

    act(() => { listener?.({ kind: 'idle' }) })
    expect(screen.queryByText(en['chat.providerRejectedTitle'])).toBeNull()
  })

  it('clears the chat data only after the reader confirms', async () => {
    const clearData = vi.fn()
    const factory = guests()
    render(<WorkModeLayer {...props('chat', { bridge: bridge({ clearData }), createGuest: factory.createGuest })} />)
    await waitFor(() => { expect(factory.calls).toHaveLength(1) })

    fireEvent.click(screen.getByRole('button', { name: en['chat.clearData'] }))
    expect(screen.getByText(en['chat.clearDataTitle'])).toBeTruthy()
    expect(clearData).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: en['chat.clearDataCancel'] }))
    expect(clearData).not.toHaveBeenCalled()
    expect(screen.queryByText(en['chat.clearDataTitle'])).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en['chat.clearData'] }))
    fireEvent.click(screen.getByRole('button', { name: en['chat.clearDataConfirm'] }))
    expect(clearData).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(en['chat.clearDataTitle'])).toBeNull()
  })

  it('offers no chat-data action without the Desktop bridge', () => {
    render(<WorkModeLayer {...props('chat')} />)
    expect(screen.queryByRole('button', { name: en['chat.clearData'] })).toBeNull()
  })

  it('switches modes through the capsule', () => {
    const setMode = vi.fn()
    render(<WorkModeLayer {...props('harness', { setMode })} />)
    fireEvent.click(screen.getByRole('radio', { name: en['mode.chat'] }))
    expect(setMode).toHaveBeenCalledWith('chat')
  })
})
