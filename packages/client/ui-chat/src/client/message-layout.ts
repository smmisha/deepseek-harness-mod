/** User-message layout and bubble width, live immediately and reconciled with accepted Host settings. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_BUBBLE_WIDTH, DEFAULT_MESSAGE_LAYOUT, type BubbleWidth, type ChatSettings, type MessageLayout,
} from '../chat-settings.ts'

/**
 * Share of the conversation column one bubble may take, with the cap that keeps
 * it off the opposite edge on narrow columns. `standard` is the designed
 * 525px-on-748px share (≈0.702) and its 82% cap.
 */
export const BUBBLE_WIDTH_SHARES: Readonly<Record<BubbleWidth, { readonly share: number; readonly cap: string }>> = {
  narrow: { share: 0.6, cap: '72%' },
  standard: { share: 0.702, cap: '82%' },
  wide: { share: 0.85, cap: '92%' },
  full: { share: 1, cap: '100%' },
}

/** Body attribute naming the active user-message layout. */
export const MESSAGE_LAYOUT_ATTRIBUTE = 'data-dsh-message-layout'

/** Body variables carrying the bubble width preset. */
export const BUBBLE_WIDTH_VARIABLES = {
  share: '--dsh-chat-bubble-share',
  cap: '--dsh-chat-bubble-cap',
} as const

/** Shared live preferences for the settings rows and the transcript. */
export class MessageLayoutPolicy {
  private readonly unsubscribe: () => void
  /** Current layout, reconciled with accepted Host settings when available. */
  readonly layout = createSnapshotStore<MessageLayout>(DEFAULT_MESSAGE_LAYOUT)
  /** Current bubble width preset, reconciled with accepted Host settings when available. */
  readonly width = createSnapshotStore<BubbleWidth>(DEFAULT_BUBBLE_WIDTH)

  /** @param host - Chat settings scope persisted through the Host. */
  constructor(private readonly host: ConfigForm<ChatSettings>) {
    const adopt = (): void => {
      const accepted = host.getSnapshot().value
      if (accepted?.messageLayout !== undefined) this.layout.set(accepted.messageLayout)
      if (accepted?.bubbleWidth !== undefined) this.width.set(accepted.bubbleWidth)
    }
    this.unsubscribe = host.subscribe(adopt)
    adopt()
  }

  /** Release the accepted-value subscription. */
  dispose(): void { this.unsubscribe() }

  /**
   * Publish a layout immediately and queue its Host write.
   * @param layout - user-message presentation selected by the user.
   */
  setLayout(layout: MessageLayout): void {
    if (layout === this.layout.getSnapshot()) return
    this.layout.set(layout)
    void this.host.set('messageLayout', layout)
  }

  /**
   * Publish a bubble width immediately and queue its Host write.
   * @param width - bubble width preset selected by the user.
   */
  setWidth(width: BubbleWidth): void {
    if (width === this.width.getSnapshot()) return
    this.width.set(width)
    void this.host.set('bubbleWidth', width)
  }

  /**
   * Keep one element's layout attribute and width variables in step with the preferences.
   * @param target - element whose subtree renders user messages, normally `document.body`.
   * @returns release the subscriptions and remove the attribute and variables.
   */
  present(target: HTMLElement): () => void {
    const apply = (): void => {
      target.setAttribute(MESSAGE_LAYOUT_ATTRIBUTE, this.layout.getSnapshot())
      const { share, cap } = BUBBLE_WIDTH_SHARES[this.width.getSnapshot()]
      target.style.setProperty(BUBBLE_WIDTH_VARIABLES.share, String(share))
      target.style.setProperty(BUBBLE_WIDTH_VARIABLES.cap, cap)
    }
    const offLayout = this.layout.subscribe(apply)
    const offWidth = this.width.subscribe(apply)
    apply()
    return () => {
      offLayout()
      offWidth()
      target.removeAttribute(MESSAGE_LAYOUT_ATTRIBUTE)
      target.style.removeProperty(BUBBLE_WIDTH_VARIABLES.share)
      target.style.removeProperty(BUBBLE_WIDTH_VARIABLES.cap)
    }
  }
}
