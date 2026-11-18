/**
 * The installer's one outbound HTTP path. Every request is validated against
 * the configured allowlist before it is sent, follows redirects manually so
 * each hop is validated the same way, is bounded by the configured timeout, and
 * is read under a byte cap.
 *
 * The transport is `fetch`, handed in so a Host test supplies a stub and no test
 * touches the network.
 *
 * @module @deepseek-ai/dsh-skill-install/http
 */

import { SkillInstallError } from './errors.ts'
import { validateRequestUrl, type NetworkPolicy } from './policy.ts'

/** User agent every request carries; sites use it to identify the client. */
const USER_AGENT = 'deepseek-harness-skill-install'

/** One response body stream, as `fetch` hands it over. */
export type ResponseBody = ReadableStream<Uint8Array> | null

/** The part of a `fetch` response the installer reads. */
export interface ResponseLike {
  readonly status: number
  readonly headers: { get(name: string): string | null }
  readonly body: ResponseBody
}

/** The part of `fetch` the installer calls; a Host test supplies a stub. */
export type FetchLike = (
  input: string,
  init: {
    readonly headers: Readonly<Record<string, string>>
    readonly redirect: 'manual'
    readonly signal: AbortSignal
  },
) => Promise<ResponseLike>

/** One accepted response: its status and the bytes it carried. */
export interface HttpResponse {
  /** HTTP status the final hop returned. */
  readonly status: number
  /** Final URL that answered, after any redirects. */
  readonly url: string
  /** Body bytes, at most the cap the caller allowed. */
  readonly bytes: Uint8Array
}

/** Per-request options. */
export interface HttpRequestOptions {
  /** `Accept` header, so GitHub can serve the JSON or raw representation a resolver wants. */
  readonly accept?: string
  /** Body byte cap for this request, at most the policy's cap. */
  readonly maxBytes?: number
}

/** The one outbound client the resolvers use. */
export interface HttpClient {
  /**
   * Fetch one URL under the network policy.
   * @param url - absolute HTTPS URL on an allowlisted host.
   * @param options - accept header and body cap for this request.
   * @returns the final status, URL, and bytes.
   * @throws {SkillInstallError} `SKILL_INSTALL_HOST_BLOCKED` for a host outside the
   *   allowlist, and `SKILL_INSTALL_NETWORK` for a refused, failed, timed-out, or
   *   oversized request.
   */
  get(url: string, options?: HttpRequestOptions): Promise<HttpResponse>
}

/** Redirect statuses that carry a `Location`. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/**
 * Create the outbound client for one resolved network policy.
 * @param policy - allowlist, timeout, redirect, and size caps.
 * @param fetchImpl - transport; defaults to the process `fetch`.
 * @returns the client every resolver in this package shares.
 */
export function createHttpClient(policy: NetworkPolicy, fetchImpl: FetchLike = globalThis.fetch): HttpClient {
  return {
    async get(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
      const cap = options.maxBytes ?? policy.maxResponseBytes
      if (cap > policy.maxResponseBytes) {
        throw new SkillInstallError(
          `request cap ${cap} exceeds the configured response cap ${policy.maxResponseBytes}`,
          'SKILL_INSTALL_NETWORK',
        )
      }
      let current = validateRequestUrl(url, policy)
      for (let hop = 0; ; hop++) {
        // One deadline per hop: a slow answer is aborted rather than retried.
        const signal = AbortSignal.timeout(policy.timeoutMs)
        let response: ResponseLike
        try {
          response = await fetchImpl(current.toString(), {
            headers: { 'user-agent': USER_AGENT, ...options.accept === undefined ? {} : { accept: options.accept } },
            redirect: 'manual',
            signal,
          })
        } catch (error) {
          throw networkFailure(current.hostname, error)
        }
        if (REDIRECT_STATUSES.has(response.status)) {
          await cancelBody(response)
          const location = response.headers.get('location')
          if (location === null) {
            throw new SkillInstallError(
              `${current.toString()} answered ${response.status} with no Location header`,
              'SKILL_INSTALL_NETWORK',
              current.hostname,
            )
          }
          if (hop >= policy.maxRedirects) {
            throw new SkillInstallError(
              `${current.toString()} exceeded the configured ${policy.maxRedirects} redirects`,
              'SKILL_INSTALL_NETWORK',
              current.hostname,
            )
          }
          // Each hop is validated like a first request: a redirect must not reach a
          // host, scheme, or credential the allowlist refuses.
          current = validateRequestUrl(new URL(location, current).toString(), policy)
          continue
        }
        const bytes = await readCapped(response, cap, current.hostname)
        return { status: response.status, url: current.toString(), bytes }
      }
    },
  }
}

/**
 * Turn any transport failure into the installer's network code, preserving the cause.
 * @param host - hostname the request targeted.
 * @param error - value `fetch` rejected with.
 * @returns the typed failure to throw.
 */
function networkFailure(host: string, error: unknown): SkillInstallError {
  return new SkillInstallError(`request to ${host} failed: ${describe(error)}`, 'SKILL_INSTALL_NETWORK', host, { cause: error })
}

/**
 * Describe a foreign failure without leaking a stack into user-facing text.
 * @param error - value a transport or stream rejected with.
 * @returns the message of an Error, or the string form of any other value.
 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Release a response body that will not be read.
 * @param response - response whose body is dropped.
 */
async function cancelBody(response: ResponseLike): Promise<void> {
  await response.body?.cancel()
}

/**
 * Read one response body up to the cap.
 * @param response - response to read.
 * @param cap - largest body accepted, in bytes.
 * @param host - hostname the request targeted, for the failure text.
 * @returns the collected bytes.
 * @throws {SkillInstallError} `SKILL_INSTALL_NETWORK` when the declared or streamed
 *   body exceeds the cap, so a server that under-reports is still bounded.
 */
async function readCapped(response: ResponseLike, cap: number, host: string): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > cap) {
    await cancelBody(response)
    throw new SkillInstallError(`${host} answered with more than ${cap} bytes`, 'SKILL_INSTALL_NETWORK', host)
  }
  /* v8 ignore next -- a fetch response with no body carries no bytes; the guard keeps the read total. */
  if (response.body === null) return new Uint8Array(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > cap) {
        throw new SkillInstallError(`${host} answered with more than ${cap} bytes`, 'SKILL_INSTALL_NETWORK', host)
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof SkillInstallError) throw error
    throw networkFailure(host, error)
  } finally {
    /* v8 ignore next 3 -- cancelling an already finished reader settles without rejecting. */
    await reader.cancel().catch(() => {
      // Best-effort cleanup; the bytes needed by a successful read are already collected.
    })
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}
