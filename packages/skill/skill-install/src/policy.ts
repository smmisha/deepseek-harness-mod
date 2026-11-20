/**
 * The installer's outbound network policy: which hosts may be contacted, how
 * long one request may take, how many redirects it may follow, and how many
 * bytes one response may carry. The policy is resolved from the plugin's
 * validated Config; every request passes {@link validateRequestUrl} first, and
 * every redirect hop is validated again.
 *
 * @module @deepseek-ai/dsh-skill-install/policy
 */

import { SkillInstallError } from './errors.ts'

/** Hosts the GitHub resolver needs and nothing else. */
export const DEFAULT_ALLOWED_HOSTS: readonly string[] = ['api.github.com', 'raw.githubusercontent.com']

/** Longest request URL the installer accepts, matching common proxy limits. */
export const MAX_URL_LENGTH = 2048

/** Resolved outbound network policy. */
export interface NetworkPolicy {
  /** Hostnames a request may target, exactly or through a `*.` suffix entry. */
  readonly allowedHosts: readonly string[]
  /** Milliseconds one request may take before it is aborted. */
  readonly timeoutMs: number
  /** Redirect hops one request may follow. */
  readonly maxRedirects: number
  /** Largest response body accepted, in bytes. */
  readonly maxResponseBytes: number
}

/**
 * Whether a hostname is covered by one allowlist entry.
 * @param hostname - lower-case hostname a request targets.
 * @param entry - allowlist entry: an exact host, or `*.` followed by a parent domain.
 * @returns true when the entry names the host or one of its subdomains.
 */
export function hostMatches(hostname: string, entry: string): boolean {
  const allowed = entry.trim().toLowerCase()
  if (allowed.startsWith('*.')) {
    const parent = allowed.slice(2)
    return parent.length > 0 && hostname.endsWith(`.${parent}`) && hostname.length > parent.length + 1
  }
  return hostname === allowed
}

/**
 * Whether a hostname is in the allowlist.
 * @param hostname - hostname a request targets.
 * @param allowedHosts - configured allowlist entries.
 * @returns true when some entry covers the hostname.
 */
export function isAllowedHost(hostname: string, allowedHosts: readonly string[]): boolean {
  const host = hostname.toLowerCase()
  return allowedHosts.some(entry => hostMatches(host, entry))
}

/**
 * Parse and validate one request URL against the network policy: bounded
 * length, HTTPS only, no embedded credentials, and an allowlisted host.
 * @param input - absolute URL a resolver wants to fetch.
 * @param policy - configured allowlist.
 * @returns the parsed URL.
 * @throws {SkillInstallError} `SKILL_INSTALL_SPEC_INVALID` for an unusable URL and
 *   `SKILL_INSTALL_HOST_BLOCKED` for a host outside the allowlist, so a
 *   misconfigured allowlist is reported as configuration rather than a network fault.
 */
export function validateRequestUrl(input: string, policy: Pick<NetworkPolicy, 'allowedHosts'>): URL {
  if (input.length > MAX_URL_LENGTH) {
    throw new SkillInstallError(`request URL exceeds ${MAX_URL_LENGTH} characters`, 'SKILL_INSTALL_SPEC_INVALID')
  }
  let url: URL
  try {
    url = new URL(input)
  } catch (error) {
    throw new SkillInstallError(`"${input}" is not an absolute URL`, 'SKILL_INSTALL_SPEC_INVALID', undefined, { cause: error })
  }
  if (url.protocol !== 'https:') {
    throw new SkillInstallError(`"${url.protocol}" is not an allowed scheme; only https is fetched`, 'SKILL_INSTALL_SPEC_INVALID')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new SkillInstallError('credentials in a request URL are not allowed', 'SKILL_INSTALL_SPEC_INVALID')
  }
  if (!isAllowedHost(url.hostname, policy.allowedHosts)) {
    throw new SkillInstallError(
      `${url.hostname} is not in the configured allowlist (${policy.allowedHosts.join(', ')})`,
      'SKILL_INSTALL_HOST_BLOCKED',
      url.hostname,
    )
  }
  return url
}
