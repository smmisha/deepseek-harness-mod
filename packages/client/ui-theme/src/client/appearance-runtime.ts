/**
 * Palette, accent, and motion preferences: live immediately, reconciled with
 * accepted Host settings, and presented as one theme token layer plus one
 * root attribute.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  appearanceTokens, DEFAULT_MOTION, DEFAULT_PALETTE, isAccentColor, MOTION_ATTRIBUTE, MOTION_LEVELS, PALETTES,
  type MotionLevel, type PaletteId,
} from '../appearance.ts'
import type { ThemeSettings } from '../theme-settings.ts'

/** Token layer identity the appearance preferences own. */
export const APPEARANCE_LAYER = 'ui-theme:appearance'

/** The theme face the runtime layers its tokens through. */
export interface AppearanceThemeFace {
  overrideTokens(source: string, tokens: Readonly<Record<string, { readonly light: string; readonly dark: string }>>): () => void
}

/** Live appearance preferences shared by the settings rows and the presenters. */
export class AppearanceRuntime {
  private readonly unsubscribe: () => void
  /** Selected palette. */
  readonly palette = createSnapshotStore<PaletteId>(DEFAULT_PALETTE)
  /** Chosen accent color, or null for the palette's or the built-in accent. */
  readonly accent = createSnapshotStore<string | null>(null)
  /** Interface motion level. */
  readonly motion = createSnapshotStore<MotionLevel>(DEFAULT_MOTION)

  /** @param host - theme settings scope persisted through the Host. */
  constructor(private readonly host: ConfigForm<ThemeSettings>) {
    const adopt = (): void => {
      const accepted = host.getSnapshot().value
      if (accepted === undefined) return
      // The settings wire may come from a Host without these fields; unknown values keep the defaults.
      const palette: unknown = accepted.palette
      const motion: unknown = accepted.motion
      this.palette.set(PALETTES.find(id => id === palette) ?? DEFAULT_PALETTE)
      this.accent.set(isAccentColor(accepted.accent) ? accepted.accent : null)
      this.motion.set(MOTION_LEVELS.find(level => level === motion) ?? DEFAULT_MOTION)
    }
    this.unsubscribe = host.subscribe(adopt)
    adopt()
  }

  /** Release the accepted-value subscription. */
  dispose(): void { this.unsubscribe() }

  /**
   * Publish a palette immediately and queue its Host write.
   * @param palette - palette selected by the user.
   */
  setPalette(palette: PaletteId): void {
    if (palette === this.palette.getSnapshot()) return
    this.palette.set(palette)
    void this.host.set('palette', palette)
  }

  /**
   * Publish an accent immediately and queue its Host write.
   * @param accent - lowercase `#rrggbb` color, or null for the default accent.
   * @throws Error when the color is not lowercase `#rrggbb`.
   */
  setAccent(accent: string | null): void {
    if (accent !== null && !isAccentColor(accent)) throw new Error(`accent ${JSON.stringify(accent)} is not a lowercase #rrggbb color`)
    if (accent === this.accent.getSnapshot()) return
    this.accent.set(accent)
    void this.host.set('accent', accent ?? '')
  }

  /**
   * Publish a motion level immediately and queue its Host write.
   * @param motion - motion level selected by the user.
   */
  setMotion(motion: MotionLevel): void {
    if (motion === this.motion.getSnapshot()) return
    this.motion.set(motion)
    void this.host.set('motion', motion)
  }

  /**
   * Keep one theme token layer in step with the palette and the accent.
   * @param theme - theme registry face.
   * @returns release the subscriptions and remove the layer.
   */
  layer(theme: AppearanceThemeFace): () => void {
    let release: () => void = () => {}
    const apply = (): void => {
      const tokens = appearanceTokens(this.palette.getSnapshot(), this.accent.getSnapshot())
      const previous = release
      release = Object.keys(tokens).length === 0 ? () => {} : theme.overrideTokens(APPEARANCE_LAYER, tokens)
      // A replacement layer under the same source already superseded the old one; an emptied one must go.
      if (Object.keys(tokens).length === 0) previous()
    }
    const offPalette = this.palette.subscribe(apply)
    const offAccent = this.accent.subscribe(apply)
    apply()
    return () => {
      offPalette()
      offAccent()
      release()
    }
  }

  /**
   * Keep the motion attribute on one root element in step with the preference.
   * @param root - element whose subtree animates, normally `document.documentElement`.
   * @returns release the subscription and remove the attribute.
   */
  presentMotion(root: HTMLElement): () => void {
    const apply = (): void => {
      const motion = this.motion.getSnapshot()
      if (motion === 'full') root.removeAttribute(MOTION_ATTRIBUTE)
      else root.setAttribute(MOTION_ATTRIBUTE, motion)
    }
    const off = this.motion.subscribe(apply)
    apply()
    return () => {
      off()
      root.removeAttribute(MOTION_ATTRIBUTE)
    }
  }
}
