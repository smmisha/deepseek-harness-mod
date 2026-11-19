/** General Settings rows for the user-message layout and the bubble width. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { useSyncExternalStore } from 'react'
import type { BubbleWidth, MessageLayout } from '../../chat-settings.ts'
import type { ChatKey } from '../locale.ts'
import { PreferenceRow } from './PreferenceRow.tsx'

/** Registration-side face shared by both rows. */
export interface MessageLayoutRowsInjected {
  /** Live user-message layout. */
  layout: ObservableSnapshot<MessageLayout>
  /** Live bubble width preset. */
  width: ObservableSnapshot<BubbleWidth>
  /** Change the user-message layout. */
  setLayout: (layout: MessageLayout) => void
  /** Change the bubble width preset. */
  setWidth: (width: BubbleWidth) => void
}

/** Full Settings-row props. */
export type MessageLayoutRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'chat'>
  & InjectFace<MessageLayoutRowsInjected>

const LAYOUTS: readonly { id: MessageLayout; label: ChatKey }[] = [
  { id: 'bubble', label: 'settings.messageLayout.bubble' },
  { id: 'flat', label: 'settings.messageLayout.flat' },
]

const WIDTHS: readonly { id: BubbleWidth; label: ChatKey }[] = [
  { id: 'narrow', label: 'settings.bubbleWidth.narrow' },
  { id: 'standard', label: 'settings.bubbleWidth.standard' },
  { id: 'wide', label: 'settings.bubbleWidth.wide' },
  { id: 'full', label: 'settings.bubbleWidth.full' },
]

const LAYOUT_LABELS = Object.fromEntries(LAYOUTS.map(option => [option.id, option.label])) as Record<MessageLayout, ChatKey>
const WIDTH_LABELS = Object.fromEntries(WIDTHS.map(option => [option.id, option.label])) as Record<BubbleWidth, ChatKey>

function useValue<T>(source: ObservableSnapshot<T>): T {
  return useSyncExternalStore(listener => source.subscribe(listener), () => source.getSnapshot())
}

/**
 * Render the user-message layout selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function MessageLayoutRow({ layout, setLayout, t }: MessageLayoutRowProps) {
  const value = useValue(layout)
  return (
    <PreferenceRow
      title={t('settings.messageLayout.title')}
      description={t('settings.messageLayout.description')}
      value={value}
      selectedLabel={t(LAYOUT_LABELS[value])}
      options={LAYOUTS.map(option => ({ id: option.id, label: t(option.label) }))}
      onSelect={(id) => { setLayout(id as MessageLayout) }}
    />
  )
}

/**
 * Render the bubble width selector; flat messages take the full column, so it applies to bubbles only.
 * @param props - composed Settings slot props.
 * @returns the preference row, or nothing while messages are flat.
 */
export function BubbleWidthRow({ layout, width, setWidth, t }: MessageLayoutRowProps) {
  const value = useValue(width)
  const currentLayout = useValue(layout)
  if (currentLayout === 'flat') return null
  return (
    <PreferenceRow
      title={t('settings.bubbleWidth.title')}
      description={t('settings.bubbleWidth.description')}
      value={value}
      selectedLabel={t(WIDTH_LABELS[value])}
      options={WIDTHS.map(option => ({ id: option.id, label: t(option.label) }))}
      onSelect={(id) => { setWidth(id as BubbleWidth) }}
    />
  )
}
