/**
 * Composer stop controls: the default graceful stop plus a split-menu caret for
 * the immediate variant. The run keeps its `running` state until a graceful
 * request reaches its step boundary, so the main button renders the armed mode
 * while it waits.
 */

import { useState } from 'react'
import type { MouseEvent } from 'react'
import { IconChevronDownOutlineRegular, Menu, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionStopMode } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ComposerBarProps } from '../contract/slots.ts'
import css from './InputBar.module.css'

/** Locale lookup for the composer's own conversation namespace. */
type StopTranslate = ComposerBarProps['t']

/** Shared inputs for the composer stop controls. */
export interface StopControlProps {
  /** Locale lookup for the namespace-owned labels. */
  readonly t: StopTranslate
  /** Host-accepted stop mode still waiting for its boundary, if any. */
  readonly armed: SessionStopMode | undefined
  /** Whether the stop actions are unavailable (no live Session or denied access). */
  readonly disabled: boolean
  /** Effective fixed-shortcut key labels for the primary stop action. */
  readonly shortcutKeys?: readonly string[] | undefined
  /** Keep the draft editor focused across the pointer press. */
  readonly keepFocus: (event: MouseEvent<HTMLButtonElement>) => void
  /** Request one stop mode from the owning Conversation. */
  readonly onStop: (mode: SessionStopMode) => void
}

/** Solid square stop glyph shared by the composer stop controls. */
export function StopGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
      <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
    </svg>
  )
}

/** The busy arc shown while a stop request is waiting for its ending. */
function BusyGlyph() {
  return (
    <svg className={css.sendingSpinner} viewBox="0 0 16 16" width="16" height="16" aria-hidden>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" />
      <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/** Label for the main stop action in its current state. */
export function stopActionLabel(t: StopTranslate, armed: SessionStopMode | undefined): string {
  if (armed === 'immediate') return t('input.stop.armedImmediate')
  if (armed === 'graceful') return t('input.stop.armed')
  return t('input.stop.graceful')
}

/**
 * The stop-mode caret and menu: graceful (finish the current step) and
 * immediate (abort now). Rendered beside a primary stop button or on its own
 * next to the Send switch, so the immediate action stays reachable in place.
 * @param props - locale lookup, armed mode, availability, focus keeper, and stop request.
 * @returns the caret button with its portaled menu.
 */
export function StopOptionsMenu({ t, armed, disabled, keepFocus, onStop }: Omit<StopControlProps, 'shortcutKeys'>) {
  const [open, setOpen] = useState(false)
  const select = (mode: SessionStopMode): void => {
    setOpen(false)
    onStop(mode)
  }
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={[
        { id: 'graceful', label: t('input.stop.graceful'), disabled: armed === 'graceful' },
        { id: 'immediate', label: t('input.stop.immediate'), danger: true },
      ]}
      onSelect={(id) => { select(id === 'immediate' ? 'immediate' : 'graceful') }}
      side="top"
      align="end"
      portal
      autoFocus
      label={t('input.stop.options')}
      anchor={(
        <Tooltip label={t('input.stop.options')} side="top" delayMs={500} portal>
          <button
            type="button"
            className={css.stopCaret}
            aria-label={t('input.stop.options')}
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={disabled}
            onMouseDown={keepFocus}
            onClick={() => { setOpen(value => !value) }}
          >
            <IconChevronDownOutlineRegular size={10} />
          </button>
        </Tooltip>
      )}
    />
  )
}

/**
 * Split stop control for the standalone stop seat: the main button requests the
 * default graceful stop, and the caret exposes the immediate stop. While a stop
 * is armed the main button is disabled and shows the requested mode; the menu
 * remains available to escalate to the immediate stop.
 * @param props - locale lookup, armed mode, availability, shortcut keys, focus keeper, and stop request.
 * @returns the split stop button pair.
 */
export function StopControl({ t, armed, disabled, shortcutKeys, keepFocus, onStop }: StopControlProps) {
  const label = stopActionLabel(t, armed)
  const busy = armed !== undefined
  return (
    <span className={css.stopSplit}>
      <Tooltip label={label} shortcutKeys={shortcutKeys} side="top" delayMs={500} disabled={disabled} portal>
        <button
          type="button"
          className={css.primary}
          aria-label={label}
          aria-busy={busy ? true : undefined}
          data-stopping={busy ? '' : undefined}
          data-stop=""
          disabled={disabled || busy}
          onMouseDown={keepFocus}
          onClick={() => { onStop('graceful') }}
        >
          {busy ? <BusyGlyph /> : <StopGlyph />}
        </button>
      </Tooltip>
      <StopOptionsMenu t={t} armed={armed} disabled={disabled} keepFocus={keepFocus} onStop={onStop} />
    </span>
  )
}
