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
/** Exact provider hosts the guest may visit while signing in. */
const DEFAULT_LOGIN_HOSTS = ['accounts.youtube.com', 'appleid.apple.com']
/** Provider patterns: `accounts.google.` matches the regional hosts. */
const DEFAULT_LOGIN_SUFFIXES = ['accounts.google.']
/** Default deadline and poll interval of the external-browser fallback. */
const DEFAULT_BROWSER_LOGIN_TIMEOUT_MS = 300_000
const DEFAULT_BROWSER_LOGIN_POLL_MS = 2_000
/** Bounds that keep the fallback responsive without spinning. */
const BROWSER_LOGIN_TIMEOUT_MS = { min: 10_000, max: 1_800_000 } as const
const BROWSER_LOGIN_POLL_MS = { min: 250, max: 10_000 } as const
/** Upper bound on each configured provider list. */
const MAX_LOGIN_ENTRIES = 16
/** Lowercase host name, without scheme, path, port, or wildcard characters. */
const HOST_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/u

/** Normalize one exact provider host. */
function loginHost(value: string): string {
  const entry = value.trim().toLowerCase()
  if (!HOST_NAME.test(entry)) throw new Error(`ui-work-mode: "${value}" is not a provider host name`)
  return entry
}

/** Normalize one provider pattern; a dot marks the end that the pattern anchors. */
function loginSuffix(value: string): string {
  const entry = value.trim().toLowerCase()
  const body = entry.startsWith('.') ? entry.slice(1) : entry.endsWith('.') ? entry.slice(0, -1) : undefined
  if (body === undefined || !HOST_NAME.test(body)) {
    throw new Error(`ui-work-mode: "${value}" must be a host suffix starting with "." or a prefix ending with "."`)
  }
  return entry
}

/** Validate one fallback timing value. */
function timing(value: number | undefined, fallback: number, min: number, max: number, name: string): number {
  const milliseconds = value ?? fallback
  if (!Number.isInteger(milliseconds) || milliseconds < min || milliseconds > max) {
    throw new Error(`ui-work-mode: ${name} must be an integer between ${String(min)} and ${String(max)} milliseconds`)
  }
  return milliseconds
}

/**
 * Turn configuration into the enforced chat contract.
 * @param config - plugin configuration, defaults already applied.
 * @returns the HTTPS address, the de-duplicated origin allowlist, and the provider hosts.
 * @throws when the address, an origin, or a provider pattern is invalid.
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
  const loginHosts = [...new Set((config.loginHosts ?? DEFAULT_LOGIN_HOSTS).map(loginHost))]
  const loginHostSuffixes = [...new Set((config.loginHostSuffixes ?? DEFAULT_LOGIN_SUFFIXES).map(loginSuffix))]
  if (loginHosts.length > MAX_LOGIN_ENTRIES) throw new Error(`ui-work-mode: at most ${String(MAX_LOGIN_ENTRIES)} provider hosts are supported`)
  if (loginHostSuffixes.length > MAX_LOGIN_ENTRIES) throw new Error(`ui-work-mode: at most ${String(MAX_LOGIN_ENTRIES)} provider suffixes are supported`)
  const browserLoginTimeoutMs = timing(config.browserLoginTimeoutMs, DEFAULT_BROWSER_LOGIN_TIMEOUT_MS,
    BROWSER_LOGIN_TIMEOUT_MS.min, BROWSER_LOGIN_TIMEOUT_MS.max, 'browserLoginTimeoutMs')
  const browserLoginPollMs = timing(config.browserLoginPollMs, DEFAULT_BROWSER_LOGIN_POLL_MS,
    BROWSER_LOGIN_POLL_MS.min, BROWSER_LOGIN_POLL_MS.max, 'browserLoginPollMs')
  if (browserLoginPollMs >= browserLoginTimeoutMs) {
    throw new Error('ui-work-mode: browserLoginPollMs must be shorter than browserLoginTimeoutMs')
  }
  return {
    url: url.href,
    allowedOrigins: origins,
    loginHosts,
    loginHostSuffixes,
    browserLoginTimeoutMs,
    browserLoginPollMs,
  }
}
