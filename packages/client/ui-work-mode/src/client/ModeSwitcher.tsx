/**
 * Chat | Harness switch as two flat icon buttons on the window's top strip:
 * a speech bubble for the embedded chat site and the DeepSeek whale for the
 * harness. The selected mode carries the primary ink and a quiet fill; the
 * other stays muted, so the switch reads as part of the title bar rather
 * than a raised control.
 */
import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Tooltip, WhaleMark } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkMode } from './store.ts'
import css from './ModeSwitcher.module.css'

/** Props of the presentational switch; the surrounding occupant owns the store. */
export type ModeSwitcherProps = PropsLocale<'workMode'> & {
  /** The mode currently shown. */
  readonly mode: WorkMode
  /** Switch to the chosen mode. */
  readonly onSelect: (mode: WorkMode) => void
}

/**
 * The library has only a new-chat bubble with a plus, which names another action;
 * this is the same bubble outline and stroke without the plus.
 */
function ChatBubbleIcon(): ReactNode {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" strokeWidth={1} aria-hidden="true">
      <path
        d="M2.37091 11.2501C1.58745 9.89288 1.32067 8.29835 1.61969 6.76006C1.91872 5.22177 2.76342 3.8433 3.99826 2.87846C5.2331 1.91362 6.77494 1.42737 8.33988 1.50925C9.90482 1.59113 11.3875 2.23562 12.5149 3.32406C13.6425 4.41269 14.3387 5.87206 14.4754 7.4334C14.612 8.99474 14.18 10.5529 13.2587 11.8209C12.3375 13.0888 10.9891 13.9813 9.46194 14.3337C8.18691 14.628 6.85895 14.5294 5.64989 14.0605C5.1712 13.8748 4.76962 13.4932 4.26534 13.3967C3.67413 13.2835 2.95257 13.5598 2.03794 14.3337"
        stroke="currentColor"
      />
    </svg>
  )
}

/** The two modes in display order. */
const MODES: readonly WorkMode[] = ['chat', 'harness']

/**
 * Render the Chat/Harness icon switch.
 * @param props - selected mode, the owner's callback, and the `workMode` locale seat.
 * @returns A radio group of two icon buttons, each named and described by its tooltip.
 */
export function ModeSwitcher({ mode, onSelect, t }: ModeSwitcherProps): ReactNode {
  const buttons = useRef<Partial<Record<WorkMode, HTMLButtonElement | null>>>({})
  const labels: Readonly<Record<WorkMode, string>> = { chat: t('mode.chat'), harness: t('mode.harness') }

  // Arrow, Home and End keys move and select together, as a radio group does.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = MODES.indexOf(mode)
    let next: WorkMode | undefined
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = MODES[(index + 1) % MODES.length]
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = MODES[(index + MODES.length - 1) % MODES.length]
    else if (event.key === 'Home') next = MODES[0]
    else if (event.key === 'End') next = MODES[MODES.length - 1]
    if (next === undefined) return
    event.preventDefault()
    onSelect(next)
    buttons.current[next]?.focus()
  }

  return (
    <div role="radiogroup" aria-label={t('mode.label')} className={css.switcher} onKeyDown={onKeyDown}>
      {MODES.map(value => (
        <Tooltip key={value} label={labels[value]} side="bottom" delayMs={400} focusDelayMs={400} portal>
          <button
            ref={(element) => { buttons.current[value] = element }}
            type="button"
            role="radio"
            aria-checked={value === mode}
            aria-label={labels[value]}
            tabIndex={value === mode ? 0 : -1}
            className={css.option}
            data-mode-option={value}
            onClick={() => { if (value !== mode) onSelect(value) }}
          >
            {value === 'chat' ? <ChatBubbleIcon /> : <WhaleMark size={16} />}
          </button>
        </Tooltip>
      ))}
    </div>
  )
}
