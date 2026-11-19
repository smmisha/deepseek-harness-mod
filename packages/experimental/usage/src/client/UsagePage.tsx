/**
 * Usage settings section: the DeepSeek account balance, one token budget card
 * per provider with a bar per rolling window, and the day-by-model statistics
 * table. Also the global notice shown when a budget threshold is crossed.
 */

import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import { Button, Input, SegmentedControl, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { UsageBalance, UsageLimit, UsageView, UsageWindow } from '../types.ts'
import {
  NEAR_SHARE, PERIODS, WINDOWS, dayRows,
  type UsageNotice, type UsagePageState, type UsagePeriod, type UsageSettings,
} from './usage-controller.ts'
import type { UsageLocaleKey } from './locales.ts'
import css from './UsagePage.module.css'

/** What the plugin injects into the section. */
export interface UsagePageInjected {
  readonly hooks: {
    readonly usagePage: ObservableSnapshot<UsagePageState>
    readonly usageLimits: ObservableSnapshot<readonly UsageLimit[]>
    readonly usageSettings: ConfigForm<UsageSettings>
  }
  readonly refresh: () => Promise<void>
  readonly setPeriod: (period: UsagePeriod) => Promise<void>
  readonly setLimit: (provider: string, window: UsageWindow, amount: number | undefined) => void
}

/** Props the settings shell binds for the section. */
export type UsagePageProps =
  & PropsRuntime<'settings.section'>
  & PropsLocale<'settings.usage'>
  & InjectFace<UsagePageInjected>

/** What the plugin injects into the notice. */
export interface UsageToastInjected {
  readonly hooks: { readonly usageNotice: ObservableSnapshot<UsageNotice | null> }
  readonly dismiss: () => void
}

/** Props the shell overlay binds for the notice. */
export type UsageToastProps = PropsLocale<'settings.usage'> & InjectFace<UsageToastInjected>

type Translate = (key: UsageLocaleKey, params?: Record<string, unknown>) => string

const count = (value: number): string => value.toLocaleString()

/**
 * Parse a budget field.
 * @param text - what the field holds.
 * @returns the amount, undefined for an empty field, or null when it is not a positive integer.
 */
export function parseBudget(text: string): number | undefined | null {
  const trimmed = text.trim().replace(/[\s,_]/gu, '')
  if (trimmed === '') return undefined
  if (!/^\d+$/u.test(trimmed)) return null
  const amount = Number(trimmed)
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null
}

function Balance({ balance, t }: { readonly balance: UsageBalance | undefined; readonly t: Translate }) {
  if (balance === undefined) return null
  return (
    <section className={css.card} aria-label={t('balanceTitle')}>
      <h4 className={css.cardTitle}>{t('balanceTitle')}</h4>
      {balance.status === 'unconfigured' ? <p className={css.muted}>{t('balanceUnconfigured')}</p> : null}
      {balance.status === 'failed' ? <p className={css.muted}>{t('balanceFailed', { message: balance.reason })}</p> : null}
      {balance.status === 'available'
        ? (
          <>
            {balance.entries.map(entry => (
              <div key={entry.currency} className={css.balanceRow}>
                <span className={css.amount}>{entry.total} {entry.currency}</span>
                <span className={css.muted}>{t('granted')} {entry.granted} · {t('toppedUp')} {entry.toppedUp}</span>
              </div>
            ))}
            {balance.sufficient ? null : <p className={css.over}>{t('balanceLow')}</p>}
          </>
        )
        : null}
    </section>
  )
}

function BudgetField({ provider, window, amount, writable, t, onCommit }: {
  readonly provider: string
  readonly window: UsageWindow
  readonly amount: number | undefined
  readonly writable: boolean
  readonly t: Translate
  readonly onCommit: (amount: number | undefined) => void
}) {
  const shown = amount === undefined ? '' : String(amount)
  const [draft, setDraft] = useState(shown)
  useEffect(() => { setDraft(shown) }, [shown])
  const commit = (): void => {
    const next = parseBudget(draft)
    if (next === null) { setDraft(shown); return }
    if (next !== amount) onCommit(next)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') commit()
    if (event.key === 'Escape') setDraft(shown)
  }
  return (
    <span className={css.budget}><Input inputMode="numeric" value={draft} placeholder={t('noBudget')} disabled={!writable}
      aria-label={t('budgetField', { provider, window: t(window) })}
      onChange={(event) => { setDraft(event.target.value) }} onBlur={commit} onKeyDown={onKeyDown} /></span>
  )
}

function ProviderBudgets({ provider, view, limit, writable, t, setLimit }: {
  readonly provider: string
  readonly view: UsageView
  readonly limit: UsageLimit | undefined
  readonly writable: boolean
  readonly t: Translate
  readonly setLimit: UsagePageInjected['setLimit']
}) {
  const totals = view.windows.find(row => row.provider === provider)
  return (
    <div className={css.provider}>
      <h5 className={css.providerName}>{provider}</h5>
      {WINDOWS.map((window) => {
        const used = totals?.[window] ?? 0
        const amount = limit?.[window]
        const share = amount === undefined ? 0 : Math.min(used / amount, 1)
        const tone = amount === undefined ? '' : used >= amount ? css.over : used >= amount * NEAR_SHARE ? css.near : ''
        return (
          <div key={window} className={css.windowRow}>
            <span className={css.windowName}>{t(window)}</span>
            <div className={css.track} role="progressbar" aria-label={t(window)} aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={Math.round(share * 100)}>
              <div className={`${css.fill} ${tone}`} style={{ width: `${share * 100}%` }} />
            </div>
            <span className={`${css.usedCopy} ${tone}`}>
              {amount === undefined ? count(used) : t('used', { used: count(used), limit: count(amount) })}
            </span>
            <BudgetField provider={provider} window={window} amount={amount} writable={writable} t={t}
              onCommit={(next) => { setLimit(provider, window, next) }} />
          </div>
        )
      })}
    </div>
  )
}

function Statistics({ view, period, t, setPeriod }: {
  readonly view: UsageView
  readonly period: UsagePeriod
  readonly t: Translate
  readonly setPeriod: UsagePageInjected['setPeriod']
}) {
  const periodId = useId()
  const rows = dayRows(view.rows)
  const withCacheWrite = rows.some(row => row.cacheWrite > 0)
  const sum = rows.reduce((acc, row) => ({
    input: acc.input + row.input, cacheRead: acc.cacheRead + row.cacheRead,
    cacheWrite: acc.cacheWrite + row.cacheWrite, output: acc.output + row.output, calls: acc.calls + row.calls,
  }), { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0 })
  return (
    <section className={css.card} aria-label={t('statsTitle')}>
      <div className={css.cardHead}>
        <h4 className={css.cardTitle}>{t('statsTitle')}</h4>
        <SegmentedControl id={periodId} label={t('period')} value={String(period)}
          options={PERIODS.map(days => ({ value: String(days), label: t(days === 7 ? 'days7' : 'days30') }))}
          onChange={(next) => { void setPeriod(next === '30' ? 30 : 7) }} />
      </div>
      <div role="tabpanel" id={`${periodId}-${period}-panel`} aria-label={t(period === 7 ? 'days7' : 'days30')}>
        {rows.length === 0
          ? <p className={css.muted}>{t('statsEmpty')}</p>
          : (
            <div className={css.tableWrap}>
              <table className={css.table}>
                <thead>
                  <tr>
                    <th scope="col">{t('day')}</th>
                    <th scope="col">{t('model')}</th>
                    <th scope="col">{t('input')}</th>
                    <th scope="col">{t('cacheRead')}</th>
                    {withCacheWrite ? <th scope="col">{t('cacheWrite')}</th> : null}
                    <th scope="col">{t('output')}</th>
                    <th scope="col">{t('calls')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={`${row.day}\n${row.provider}\n${row.model}`}>
                      <td>{row.day}</td>
                      <td><span className={css.model}>{row.model}</span><span className={css.provider}>{row.provider}</span></td>
                      <td>{count(row.input)}</td>
                      <td>{count(row.cacheRead)}</td>
                      {withCacheWrite ? <td>{count(row.cacheWrite)}</td> : null}
                      <td>{count(row.output)}</td>
                      <td>{count(row.calls)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={2}>{t('total')}</th>
                    <td>{count(sum.input)}</td>
                    <td>{count(sum.cacheRead)}</td>
                    {withCacheWrite ? <td>{count(sum.cacheWrite)}</td> : null}
                    <td>{count(sum.output)}</td>
                    <td>{count(sum.calls)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
      </div>
    </section>
  )
}

/**
 * Render the Usage settings section.
 * @param props - locale copy, the page stores, and the page actions.
 * @returns the section.
 */
export function UsagePage(props: UsagePageProps) {
  const { t, refresh, setPeriod, setLimit } = props
  const page = props.useUsagePage(value => value)
  const limits = props.useUsageLimits(value => value)
  const writable = props.useUsageSettings(value => value.writable)
  useEffect(() => { void refresh() }, [refresh])
  const view = page.view
  const providers = view === undefined
    ? []
    : [...new Set([...view.windows.map(row => row.provider), ...limits.map(limit => limit.provider)])].sort()
  return (
    <section className={css.section} aria-label={t('nav')}>
      <div className={css.toolbar}>
        <span className={css.muted}>
          {view === undefined ? null : t('scanned', { time: new Date(view.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}
        </span>
        <Button variant="outline" size="sm" onClick={() => { void refresh() }}>{t('refresh')}</Button>
      </div>
      {page.status === 'failed' ? <p className={css.over} role="alert">{t('failed', { message: page.failure })}</p> : null}
      {view === undefined
        ? (page.status === 'loading' ? <p className={css.muted} role="status">{t('loading')}</p> : null)
        : (
          <>
            <Balance balance={page.balance} t={t} />
            <section className={css.card} aria-label={t('limitsTitle')}>
              <h4 className={css.cardTitle}>{t('limitsTitle')}</h4>
              <p className={css.muted}>{t('limitsHint')}</p>
              {writable ? null : <p className={css.muted}>{t('readOnly')}</p>}
              {providers.length === 0 ? <p className={css.muted}>{t('limitsEmpty')}</p> : null}
              {providers.map(provider => (
                <ProviderBudgets key={provider} provider={provider} view={view} limit={limits.find(limit => limit.provider === provider)}
                  writable={writable} t={t} setLimit={setLimit} />
              ))}
            </section>
            <Statistics view={view} period={page.period} t={t} setPeriod={setPeriod} />
            <p className={css.muted}>{t('estimate')}</p>
          </>
        )}
    </section>
  )
}

/**
 * Render the newest budget notice, if any.
 * @param props - locale copy, the notice store, and its dismissal.
 * @returns the toast, or nothing.
 */
export function UsageToast(props: UsageToastProps) {
  const notice = props.useUsageNotice(value => value)
  if (notice === null) return null
  const params = { provider: notice.provider, window: props.t(notice.window) }
  return <Toast key={notice.seq} text={props.t(notice.level === 'over' ? 'noticeOver' : 'noticeNear', params)} onDone={props.dismiss} />
}
