/**
 * Free web chat card on the Plugins page: its one-liner in the list, and on its
 * own page the routes the bridge serves and one row per thread with its
 * web-session generation. The page reads the bridge on open and after every reset.
 */

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { FreeChatLocaleKey } from './locales.ts'
import css from './FreeChatPage.module.css'

/** One route as the page shows it. */
export interface FreeChatPageModel {
  readonly id: string
  readonly name: string
  readonly contextWindow: number
  readonly maxOutputTokens: number
}

/** One thread as the page shows it. */
export interface FreeChatPageThread {
  readonly id: string
  readonly generation: number
  readonly turns: number
  readonly updatedAt?: string | undefined
  readonly live: boolean
}

/** Routes and threads the bridge reports. */
export interface FreeChatPageState {
  readonly models: readonly FreeChatPageModel[]
  readonly threads: readonly FreeChatPageThread[]
}

/** Actions the plugin injects into the page. */
export interface FreeChatPageInjected {
  /** Read routes and thread rows through the Host. */
  readonly load: () => Promise<FreeChatPageState>
  /** Drop one thread's live web conversation. */
  readonly reset: (id: string) => Promise<void>
}

/** Props the Plugins page binds for the card. */
export type FreeChatPageProps =
  & PropsRuntime<'plugins.item'>
  & PropsLocale<'settings.freechat'>
  & InjectFace<FreeChatPageInjected>

type Translate = (key: FreeChatLocaleKey) => string

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function ThreadRow({ row, busy, t, onReset }: {
  readonly row: FreeChatPageThread
  readonly busy: string | null
  readonly t: Translate
  readonly onReset: (id: string) => void
}) {
  const updated = row.updatedAt === undefined ? '' : ` · ${t('updated')} ${row.updatedAt.slice(0, 16).replace('T', ' ')}`
  return (
    <li className={css.row}>
      <div className={css.rowMain}>
        <code className={css.rowId}>{row.id}</code>
        <span className={css.rowMeta}>
          {t('generation')} {row.generation} · {t('turns')} {row.turns} · {row.live ? t('live') : t('idle')}{updated}
        </span>
      </div>
      <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => { onReset(row.id) }}>
        {busy === row.id ? t('resetting') : t('reset')}
      </Button>
    </li>
  )
}

/** The page body: routes, threads, and the reset control. */
function FreeChatBody({ load, reset, t }: FreeChatPageInjected & { readonly t: Translate }) {
  const [state, setState] = useState<FreeChatPageState | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setState(await load())
      setFailure(null)
    } catch (error) {
      setFailure(messageOf(error))
    }
  }, [load])

  useEffect(() => { void refresh() }, [refresh])

  const onReset = useCallback((id: string) => {
    setBusy(id)
    void reset(id)
      .then(refresh, (error: unknown) => { setFailure(messageOf(error)) })
      .finally(() => { setBusy(null) })
  }, [refresh, reset])

  return (
    <div className={css.page}>
      <div className={css.toolbar}>
        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => { void refresh() }}>{t('refresh')}</Button>
      </div>
      {failure === null ? null : <p className={css.failure} role="alert">{t('failed').replace('{message}', failure)}</p>}
      {state === null
        ? (failure === null ? <p className={css.muted} role="status">{t('loading')}</p> : null)
        : (
          <>
            <section className={css.section}>
              <h4 className={css.sectionTitle}>{t('models')}</h4>
              <ul className={css.rows}>
                {state.models.map(model => (
                  <li key={model.id} className={css.row}>
                    <div className={css.rowMain}>
                      <code className={css.rowId}>{model.id}</code>
                      <span className={css.rowMeta}>
                        {model.name} · {model.contextWindow.toLocaleString()} / {model.maxOutputTokens.toLocaleString()}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
            <section className={css.section}>
              <h4 className={css.sectionTitle}>{t('threads')}</h4>
              <p className={css.muted}>{t('threadHint')}</p>
              {state.threads.length === 0
                ? <p className={css.muted}>{t('empty')}</p>
                : (
                  <ul className={css.rows}>
                    {state.threads.map(row => <ThreadRow key={row.id} row={row} busy={busy} t={t} onReset={onReset} />)}
                  </ul>
                )}
            </section>
          </>
        )}
    </div>
  )
}

/**
 * Render the card's one-liner, or its page, as the Plugins page asks.
 * @param props - the view asked for, locale copy, and the injected bridge actions.
 * @returns the one-liner, or the page body.
 */
export function FreeChatPage(props: FreeChatPageProps) {
  const { t } = props
  if (props.view === 'summary') return t('summary')
  return <FreeChatBody load={props.load} reset={props.reset} t={t} />
}
