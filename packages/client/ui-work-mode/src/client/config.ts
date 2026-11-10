/**
 * Plugin configuration: the chat address and the origins the shell may keep
 * embedded. Validation happens at load so a misconfigured profile fails loud
 * instead of silently rendering an embeddable-looking empty tab.
 */
import type { DesktopChatConfig } from '../types.ts'
import type { Config } from './index.ts'

/** Address the Chat tab loads when the profile configures nothing. */
const DEFAULT_URL = 'https://chat.deepseek.com/'
/** Origin allowed to navigate inside the guest when the profile configures nothing. */
const DEFAULT_ORIGIN = 'https://chat.deepseek.com'

/**
 * Turn configuration into the enforced chat contract.
 * @param config - plugin configuration, defaults already applied.
 * @returns the HTTPS address and the de-duplicated origin allowlist.
 * @throws when the address or an allowed origin is not a credential-free HTTPS URL.
 */
export function resolveWorkModeConfig(config: Config): DesktopChatConfig {
  const url = new URL(config.url ?? DEFAULT_URL)
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new Error('ui-work-mode: the chat URL must be an HTTPS address without credentials')
  }
  const origins = [...new Set((config.allowedOrigins ?? [DEFAULT_ORIGIN]).map((value) => {
    const origin = new URL(value)
    if (origin.protocol !== 'https:' || origin.username !== '' || origin.password !== '') {
      throw new Error(`ui-work-mode: "${value}" is not a credential-free HTTPS origin`)
    }
    return origin.origin
  }))]
  if (origins.length === 0) throw new Error('ui-work-mode: at least one allowed origin is required')
  return { url: url.href, allowedOrigins: origins }
}
