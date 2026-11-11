/**
 * Contract between the Web application document and the Desktop shell for the
 * embedded Chat tab. The shell issues the only partition the chat guest may
 * use, and enforces the navigation allowlist the plugin configuration carries.
 *
 * @module @deepseek-ai/dsh-client-ui-work-mode/types
 */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Main-issued identity of one chat guest attachment. */
export type DesktopChatLeaseId = Branded<'DesktopChatLeaseId'>

/** Approved persistent partition and lease for the chat guest. */
export interface DesktopChatReservation {
  /** Opaque attachment identity; the guest names itself `about:blank#<lease>`. */
  readonly lease: DesktopChatLeaseId
  /** Persistent Electron partition the shell assigned to the chat guest. */
  readonly partition: string
}

/** Site address and navigation allowlist the shell enforces for the chat guest. */
export interface DesktopChatConfig {
  /** Address the guest loads after the attachment is approved. */
  readonly url: string
  /** HTTPS origins that may stay inside the guest; every other page opens outside. */
  readonly allowedOrigins: readonly string[]
  /**
   * Exact provider hostnames the guest may navigate to while signing in, for
   * example `accounts.youtube.com` or `appleid.apple.com`.
   */
  readonly loginHosts: readonly string[]
  /**
   * Provider host patterns: a leading-dot suffix (`.google.com`) matches every
   * subdomain, and a trailing-dot prefix (`accounts.google.`) matches the
   * regional hosts of one provider.
   */
  readonly loginHostSuffixes: readonly string[]
}

/** Provider window state the Chat tab renders while Apple sign-in is open. */
export interface DesktopChatLoginState {
  /** True while a provider sign-in window is open for this guest. */
  readonly open: boolean
}

/** Main-process chat guest operations exposed to the application document. */
export interface DesktopChatBridge {
  /**
   * Reserve the chat guest's persistent partition for this window.
   * @param config - validated site address and navigation allowlist.
   * @returns the lease and partition the webview must present on attachment.
   */
  acquire(config: DesktopChatConfig): Promise<DesktopChatReservation>
  /**
   * Observe provider sign-in windows opened for the chat guest.
   * @param listener - receives the current window state; the returned callback unsubscribes.
   * @returns unsubscribe callback.
   */
  onLoginWindow(listener: (state: DesktopChatLoginState) => void): () => void
  /** Close the provider sign-in window this document still has open. */
  cancelLogin(): Promise<void>
}
