/**
 * The embedded chat guest's Electron `<webview>` lifecycle, without React: the
 * element is created from a main-approved lease, kept in the DOM by its host,
 * and reports failures instead of rendering a blank screen.
 */
import type { DesktopChatBridge, DesktopChatConfig } from '../types.ts'

/** The subset of the Electron `<webview>` tag this module drives. */
interface WebviewElement extends HTMLElement {
  loadURL(url: string): Promise<void>
}

/** Guest presentation state the host renders. */
export type ChatGuestState = 'loading' | 'ready' | 'failed' | 'crashed'

/** Inputs for one guest attachment. */
export interface ChatGuestOptions {
  /** Main-process lease operations. */
  readonly bridge: DesktopChatBridge
  /** Site address and navigation allowlist the shell enforces. */
  readonly config: DesktopChatConfig
  /** Localized accessible name of the embedded document. */
  readonly label: string
  /** Extra class for layout placement. */
  readonly className: string
  /** Presentation updates; never called after `dispose`. */
  readonly onState: (state: ChatGuestState) => void
}

/** One attached guest element and its release. */
export interface ChatGuestHandle {
  /** The configured `<webview>` element; the host appends it once. */
  readonly element: HTMLElement
  /** Load the configured address again in the same guest. */
  reload(): void
  /** Destroy the guest; the page is not restored by a later attachment. */
  dispose(): void
}

/** Electron's cancellation code for a superseded load. */
const ERR_ABORTED = -3

/**
 * Reserve the chat partition and build the attached guest element.
 * @param options - bridge, site config, label, class, and state observer.
 * @returns the configured element after the lease is approved.
 * @throws when the shell refuses the request; the host renders its failure state.
 */
export async function createChatGuest({ bridge, config, label, className, onState }: ChatGuestOptions): Promise<ChatGuestHandle> {
  const reservation = await bridge.acquire(config)
  const element = document.createElement('webview') as WebviewElement
  let disposed = false
  let committed = false
  let state: ChatGuestState = 'loading'
  const report = (next: ChatGuestState): void => {
    if (disposed || state === next) return
    state = next
    onState(next)
  }
  const load = (): void => {
    report('loading')
    void element.loadURL(config.url).catch(() => { report('failed') })
  }
  // The first document is the lease-bearing bootstrap; the shell approves the
  // attachment from it before the site load starts.
  element.className = className
  element.setAttribute('name', reservation.lease)
  element.setAttribute('partition', reservation.partition)
  element.setAttribute('allowpopups', '')
  element.setAttribute('aria-label', label)
  element.setAttribute('data-work-mode-frame', '')
  element.setAttribute('src', `about:blank#${reservation.lease}`)
  element.addEventListener('dom-ready', () => {
    if (disposed) return
    committed = true
    load()
  }, { once: true })
  element.addEventListener('did-start-loading', () => {
    // A new navigation clears the failure the previous one reported.
    if (committed) report('loading')
  })
  element.addEventListener('did-fail-load', (event) => {
    const detail = event as Event & { readonly isMainFrame?: boolean; readonly errorCode?: number }
    if (detail.isMainFrame === false || detail.errorCode === ERR_ABORTED) return
    report('failed')
  })
  element.addEventListener('did-stop-loading', () => {
    // A failure keeps its state until the next load starts.
    if (state === 'failed') return
    if (committed) report('ready')
  })
  for (const name of ['render-process-gone', 'crashed']) {
    element.addEventListener(name, () => { report('crashed') })
  }
  report('loading')
  return {
    element,
    reload: () => { if (!disposed) load() },
    dispose: () => {
      disposed = true
      element.remove()
    },
  }
}
