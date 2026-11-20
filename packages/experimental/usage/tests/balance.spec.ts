/** DeepSeek balance: the request, the parsed entries, the cache, and every unavailable state. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BALANCE_CACHE_MS, DeepSeekBalance } from '../src/balance.ts'

afterEach(() => { vi.unstubAllGlobals() })

function serve(answer: { ok?: boolean; status?: number; body?: unknown } | Error) {
  const fetch = vi.fn<(url: URL, init: RequestInit) => Promise<unknown>>(() => (answer instanceof Error
    ? Promise.reject(answer)
    : Promise.resolve({ ok: answer.ok ?? true, status: answer.status ?? 200, json: () => Promise.resolve(answer.body) })))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const reader = (apiKey: () => Promise<string | undefined>, now = () => 0) =>
  new DeepSeekBalance({ baseURL: 'https://api.deepseek.test', apiKey, now })

describe('DeepSeekBalance', () => {
  it('reads every currency with the key and reuses the answer until it expires', async () => {
    const fetch = serve({ body: {
      is_available: true,
      balance_infos: [
        { currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' },
        { currency: 'USD', total_balance: 1 }, null,
      ],
    } })
    let now = 0
    const balance = reader(() => Promise.resolve('sk-test'), () => now)
    expect(await balance.read()).toEqual({ status: 'available', sufficient: true, entries: [{ currency: 'CNY', total: '110.00', granted: '10.00', toppedUp: '100.00' }] })
    const [url, init] = fetch.mock.calls[0]!
    expect(String(url)).toBe('https://api.deepseek.test/user/balance')
    expect(init.headers).toMatchObject({ authorization: 'Bearer sk-test' })
    now = BALANCE_CACHE_MS - 1
    await balance.read()
    expect(fetch).toHaveBeenCalledTimes(1)
    now = BALANCE_CACHE_MS
    await balance.read()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('reports a missing key, a failing key store, an HTTP error, an unexpected body, and a network failure', async () => {
    serve({ body: {} })
    expect(await reader(() => Promise.resolve(undefined)).read()).toEqual({ status: 'unconfigured' })
    expect(await reader(() => Promise.reject(new Error('locked'))).read()).toEqual({ status: 'failed', reason: 'locked' })
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the non-Error rejection IS the scenario under test
    expect(await reader(() => Promise.reject('denied')).read()).toEqual({ status: 'failed', reason: 'denied' })
    serve({ ok: false, status: 401 })
    expect(await reader(() => Promise.resolve('k')).read()).toEqual({ status: 'failed', reason: 'HTTP 401' })
    for (const body of [null, { balance_infos: [] }, { is_available: true }]) {
      serve({ body })
      expect(await reader(() => Promise.resolve('k')).read()).toEqual({ status: 'failed', reason: 'unexpected balance response' })
    }
    serve(new Error('offline'))
    expect(await reader(() => Promise.resolve('k')).read()).toEqual({ status: 'failed', reason: 'offline' })
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the non-Error rejection IS the scenario under test
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject('reset')))
    expect(await reader(() => Promise.resolve('k')).read()).toEqual({ status: 'failed', reason: 'reset' })
  })

  it('uses the real clock when none is injected', async () => {
    serve({ body: { is_available: false, balance_infos: [] } })
    expect(await new DeepSeekBalance({ baseURL: 'https://api.deepseek.test', apiKey: () => Promise.resolve('k') }).read())
      .toEqual({ status: 'available', sufficient: false, entries: [] })
  })
})
