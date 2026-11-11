/**
 * The frame-wide working-mode surface: the Chat tab's embedded site fills the
 * working area, the capsule rides the window's top strip, and the harness
 * columns stay mounted behind the hidden page.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { WhaleMark } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopChatBridge, DesktopChatConfig } from '../types.ts'
import type { ChatGuestHandle, ChatGuestOptions, ChatGuestState } from './desktop-chat.ts'
import { ModeSwitcher } from './ModeSwitcher.tsx'
import type { WorkMode } from './store.ts'
import type { createWorkModeStore } from './store.ts'
import css from './WorkModeLayer.module.css'

/** Height of the frame strip the capsule rides on where no caption band exists. */
const MODE_BAND_HEIGHT = 40

/** Injected guest face: the configured site and the attachment factory. */
export interface WorkModeInjected {
  /** Site address and navigation allowlist the shell enforces. */
  readonly config: DesktopChatConfig
  /** Desktop guest operations; absent outside the desktop shell. */
  readonly bridge: DesktopChatBridge | undefined
  /** Reserve the frame strip above every column, or clear it. */
  readonly setTopBand: (px: number | null) => void
  /** Build one attached guest; tests substitute a fake. */
  readonly createGuest: (options: ChatGuestOptions) => Promise<ChatGuestHandle>
}

/** Full props of the `shell.overlay` occupant. */
export type WorkModeLayerProps =
  PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createWorkModeStore>>
  & PropsLocale<'workMode'>
  & InjectFace<WorkModeInjected>

/** The localized seat both branches read. */
type ModeLayerCopy = Pick<WorkModeLayerProps, 't'>

/** Hand a URL to the system browser (Desktop routes `window.open` externally). */
function openExternally(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** The Web build's chat tab: the site refuses embedding, so offer the site itself. */
function WebChatFallback({ config, t }: ModeLayerCopy & { readonly config: DesktopChatConfig }): ReactNode {
  return (
    <div className={css.centered}>
      <span className={css.mark}><WhaleMark size={28} /></span>
      <p className={css.title}>{t('chat.webTitle')}</p>
      <p className={css.body}>{t('chat.webBody')}</p>
      <div className={css.actions}>
        <button
          type="button"
          className={clsx(css.action, css.actionPrimary)}
          onClick={() => { openExternally(config.url) }}
        >
          {t('chat.webAction')}
        </button>
      </div>
    </div>
  )
}

/**
 * Render the working-mode surface and its capsule.
 * @param props - store selection, injected guest face, and the `workMode` locale seat.
 * @returns The lazy guest page, its failure card, and the always-visible switch.
 */
export function WorkModeLayer({ useStore, actions, t, config, bridge, setTopBand, createGuest }: WorkModeLayerProps): ReactNode {
  const stored = useStore(state => state.mode)
  const mode: WorkMode = stored === 'chat' ? 'chat' : 'harness'
  const chat = mode === 'chat'
  // The site loads on the first Chat visit, not at application start.
  const [started, setStarted] = useState(chat)
  const [guestState, setGuestState] = useState<ChatGuestState>('loading')
  const [loginOpen, setLoginOpen] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const host = useRef<HTMLDivElement | null>(null)
  const guest = useRef<ChatGuestHandle | null>(null)
  const label = useRef(t('chat.frameLabel'))
  label.current = t('chat.frameLabel')

  useEffect(() => {
    if (chat && !started) setStarted(true)
  }, [chat, started])

  // Without a native caption band the strip reserves its own row through the
  // frame's top padding, so the capsule never sits over conversation content.
  useEffect(() => {
    // The frame reserves its own strip through the layout interface; the
    // Windows caption band already covers it, so nothing is reserved there.
    if (document.documentElement.hasAttribute('data-windows-titlebar')) {
      setTopBand(null)
      return () => { setTopBand(null) }
    }
    setTopBand(MODE_BAND_HEIGHT)
    return () => { setTopBand(null) }
  }, [setTopBand])

  useEffect(() => {
    if (bridge === undefined) return
    return bridge.onLoginWindow((state) => { setLoginOpen(state.open) })
  }, [bridge])

  useEffect(() => {
    if (bridge === undefined || !started) return
    let cancelled = false
    let handle: ChatGuestHandle | undefined
    setGuestState('loading')
    void createGuest({
      bridge,
      config,
      label: label.current,
      className: css.frame as string,
      onState: (next) => { if (!cancelled) setGuestState(next) },
    }).then((created) => {
      if (cancelled) { created.dispose(); return }
      handle = created
      guest.current = created
      host.current?.append(created.element)
    }).catch(() => { if (!cancelled) setGuestState('failed') })
    return () => {
      cancelled = true
      if (guest.current === handle) guest.current = null
      handle?.dispose()
    }
  }, [attempt, bridge, config, createGuest, started])

  const failed = guestState === 'failed' || guestState === 'crashed'
  const retry = (): void => {
    if (guestState === 'crashed' || guest.current === null) {
      // A gone renderer, or a lease that was never granted, needs a fresh guest.
      setAttempt(value => value + 1)
      return
    }
    // A failed load retries inside the same guest, keeping its lease.
    guest.current.reload()
  }

  return (
    <div className={css.root} data-mode={mode} data-work-mode-layer="">
      <div
        className={css.page}
        aria-hidden={chat ? undefined : true}
        {...(!chat ? { inert: '' } : {})}
      >
        {bridge === undefined
          ? <WebChatFallback config={config} t={t} />
          : started && (
            <>
              <div className={css.guest} ref={host} data-hidden={failed ? '' : undefined} data-work-mode-host="" />
              {loginOpen && (
                <div className={css.card} data-work-mode-login="">
                  <p className={css.body}>{t('chat.loginPending')}</p>
                  <div className={css.actions}>
                    <button
                      type="button"
                      className={css.action}
                      onClick={() => { void bridge.cancelLogin() }}
                    >
                      {t('chat.loginCancel')}
                    </button>
                  </div>
                </div>
              )}
              {failed && (
                <div className={css.card} data-work-mode-error="">
                  <p className={css.title}>{t('chat.errorTitle')}</p>
                  <p className={css.body}>{t('chat.errorBody')}</p>
                  <div className={css.actions}>
                    <button
                      type="button"
                      className={clsx(css.action, css.actionPrimary)}
                      onClick={retry}
                    >
                      {t('chat.retry')}
                    </button>
                    <button
                      type="button"
                      className={css.action}
                      onClick={() => { openExternally(config.url) }}
                    >
                      {t('chat.openInBrowser')}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
      </div>
      <div className={css.bar} data-work-mode-bar="">
        <ModeSwitcher mode={mode} onSelect={(next) => { actions.setMode(next) }} t={t} />
      </div>
    </div>
  )
}
