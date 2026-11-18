/** The outbound client: redirects, byte caps, timeouts, and transport failures. */
import { describe, expect, it, vi } from 'vitest'
import { createHttpClient, type FetchLike, type ResponseLike } from '../src/http.ts'

/** Policy the client is built from in these cases. */
const POLICY = {
  allowedHosts: ['api.github.com'],
  timeoutMs: 50,
  maxRedirects: 2,
  maxResponseBytes: 16,
}

/** One response a stub returns. */
function response(
  status: number,
  body: string | Uint8Array | null = null,
  headers: Record<string, string> = {},
): ResponseLike {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
  return {
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    body: bytes === null
      ? null
      : new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
      }),
  }
}

/** A body stream that fails after it starts. */
function brokenStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error('socket reset'))
    },
  })
}

/** Run one request and return the typed code it failed with. */
async function failure(transport: FetchLike, url = 'https://api.github.com/x', maxBytes?: number): Promise<string> {
  try {
    await createHttpClient(POLICY, transport).get(url, maxBytes === undefined ? {} : { maxBytes })
  } catch (error) {
    return (error as { code: string }).code
  }
  throw new Error('expected the request to fail')
}

describe('createHttpClient', () => {
  it('returns the status, final URL, and bytes', async () => {
    let sent: { readonly headers: Readonly<Record<string, string>>; readonly redirect: string } | undefined
    const transport: FetchLike = async (_url, init) => {
      sent = init
      return response(200, 'body')
    }
    const result = await createHttpClient(POLICY, transport).get('https://api.github.com/x', { accept: 'application/json' })
    expect([result.status, result.url, new TextDecoder().decode(result.bytes)]).toEqual([200, 'https://api.github.com/x', 'body'])
    expect(sent?.redirect).toBe('manual')
    expect(sent?.headers).toEqual({ accept: 'application/json', 'user-agent': 'deepseek-harness-skill-install' })
  })

  it('sends no accept header when none is asked for', async () => {
    let sent: Readonly<Record<string, string>> = {}
    const transport: FetchLike = async (_url, init) => {
      sent = init.headers
      return response(200, 'x')
    }
    await createHttpClient(POLICY, transport).get('https://api.github.com/x')
    expect(sent).toEqual({ 'user-agent': 'deepseek-harness-skill-install' })
  })

  it('follows an allowlisted redirect', async () => {
    const transport = vi.fn(async (url: string) => url === 'https://api.github.com/x'
      ? response(302, null, { location: '/y' })
      : response(200, 'final'))
    const result = await createHttpClient(POLICY, transport).get('https://api.github.com/x')
    expect([result.status, result.url]).toEqual([200, 'https://api.github.com/y'])
  })

  it('refuses a redirect past the hop cap', async () => {
    const transport = async () => response(307, null, { location: '/again' })
    expect(await failure(transport)).toBe('SKILL_INSTALL_NETWORK')
  })

  it('refuses a redirect to a host outside the allowlist', async () => {
    const transport = async () => response(301, null, { location: 'https://evil.example/x' })
    expect(await failure(transport)).toBe('SKILL_INSTALL_HOST_BLOCKED')
  })

  it('refuses a redirect to plain http', async () => {
    const transport = async () => response(301, null, { location: 'http://api.github.com/x' })
    expect(await failure(transport)).toBe('SKILL_INSTALL_SPEC_INVALID')
  })

  it('refuses a redirect with no Location header', async () => {
    const transport = async () => response(302)
    expect(await failure(transport)).toBe('SKILL_INSTALL_NETWORK')
  })

  it('refuses a body larger than the content length promises to fit', async () => {
    const transport = async () => response(200, '0123456789abcdefg', { 'content-length': '17' })
    expect(await failure(transport)).toBe('SKILL_INSTALL_NETWORK')
  })

  it('refuses a stream that grows past the cap', async () => {
    const transport = async () => response(200, '0123456789abcdefg')
    expect(await failure(transport)).toBe('SKILL_INSTALL_NETWORK')
  })

  it('accepts a body exactly at the cap', async () => {
    const transport = async () => response(200, '0123456789abcdef')
    const result = await createHttpClient(POLICY, transport).get('https://api.github.com/x')
    expect(result.bytes.byteLength).toBe(16)
  })

  it('returns no bytes for a response with no body', async () => {
    const transport = async () => response(204)
    expect((await createHttpClient(POLICY, transport).get('https://api.github.com/x')).bytes.byteLength).toBe(0)
  })

  it('reports a transport rejection as a network failure', async () => {
    const transport = async () => { throw new Error('getaddrinfo ENOTFOUND') }
    expect(await failure(transport)).toBe('SKILL_INSTALL_NETWORK')
  })

  it('reports a rejection that is not an Error as a network failure', async () => {
    const transport = async (): Promise<ResponseLike> => { throw 'refused' }
    expect(await failure(transport)).toBe('SKILL_INSTALL_NETWORK')
  })

  it('reports a reader failure as a network failure', async () => {
    const transport = async (): Promise<ResponseLike> => ({ status: 200, headers: { get: () => null }, body: brokenStream() })
    expect(await failure(transport)).toBe('SKILL_INSTALL_NETWORK')
  })

  it('refuses a per-request cap above the policy cap', async () => {
    expect(await failure(async () => response(200, 'x'), 'https://api.github.com/x', 64)).toBe('SKILL_INSTALL_NETWORK')
  })

  it('aborts a response the deadline outlives', async () => {
    const transport: FetchLike = async (_url, init) => {
      await new Promise<never>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => { reject(init.signal.reason as Error) })
      })
      throw new Error('unreachable')
    }
    expect(await failure(transport)).toBe('SKILL_INSTALL_NETWORK')
  })
})
