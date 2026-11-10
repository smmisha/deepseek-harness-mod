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
}

/** Main-process chat guest operations exposed to the application document. */
export interface DesktopChatBridge {
  /**
   * Reserve the chat guest's persistent partition for this window.
   * @param config - validated site address and navigation allowlist.
   * @returns the lease and partition the webview must present on attachment.
   */
  acquire(config: DesktopChatConfig): Promise<DesktopChatReservation>
}
