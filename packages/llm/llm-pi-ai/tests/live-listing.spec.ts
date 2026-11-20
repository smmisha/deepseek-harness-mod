import { describe, expect, it, vi } from 'vitest'
import { catalogModels } from '../src/catalog.ts'
import { resolveProfiles } from '../src/config.ts'
import { PiAiAdapter } from '../src/adapter.ts'
import { ModelListingCache, readModelListing } from '../src/live-listing.ts'
import type { ModelListingSpec } from '../src/live-listing.ts'
import { memoryAuth } from './auth-double.ts'

/** A listing document with the given entries, shaped like the gateway's `GET /models`. */
function listing(data: unknown[]): { object: 'list'; data: unknown[] } {
  return { object: 'list', data }
}

/** One listed chat model that the installed catalog does not know, overridable per field. */
function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'deepseek-v5-preview',
    object: 'model',
    name: 'DeepSeek V5 Preview',
    recommended_api: 'chat-completions',
    api: { 'chat-completions': { base_url: 'https://gateway.example.test/openai/v1' } },
    modalities: { input: ['text', 'image/png'], output: ['text'] },
    capabilities: { reasoning: { supported: true, effort: ['low', 'high', 'max'] } },
    limit: { context: 500_000, output: 64_000 },
    cost: { text: { input: { price: 0.5, cache: { read: 0.05 } }, output: { price: 2 } } },
    ...overrides,
  }
}

/** The URL a fetch call was made with, whichever shape the caller passed. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const SPEC: ModelListingSpec = { url: 'https://gateway.example.test/models', maxAgeMs: 600_000, timeoutMs: 5_000 }

describe('served-model listing reading', () => {
  it('keeps the installed entry of a model the catalog already knows', () => {
    const reading = readModelListing('opencode', listing([{ id: 'deepseek-v4-pro' }]))
    expect(reading.models.get('deepseek-v4-pro')).toBe(catalogModels('opencode').get('deepseek-v4-pro'))
  })

  it('describes an unknown model from the listing itself', () => {
    const model = readModelListing('opencode', listing([entry()])).models.get('deepseek-v5-preview')
    expect(model).toMatchObject({
      id: 'deepseek-v5-preview',
      name: 'DeepSeek V5 Preview',
      provider: 'opencode',
      api: 'openai-completions',
      baseUrl: 'https://gateway.example.test/openai/v1',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 500_000,
      maxTokens: 64_000,
      cost: { input: 0.5, output: 2, cacheRead: 0.05, cacheWrite: 0 },
      thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max' },
    })
  })

  it('strips the version segment from an Anthropic base the SDK extends with /v1/messages', () => {
    const model = readModelListing('opencode', listing([entry({
      id: 'anthropic-only',
      recommended_api: 'messages',
      api: { messages: { base_url: 'https://gateway.example.test/anthropic/v1' } },
    })])).models.get('anthropic-only')
    expect(model).toMatchObject({ api: 'anthropic-messages', baseUrl: 'https://gateway.example.test/anthropic' })
  })

  it('inherits compatibility switches from the installed model of the same family and endpoint', () => {
    const sibling = [...catalogModels('opencode').values()].find(model => model.api === 'openai-completions' && model.id.startsWith('deepseek'))
    expect(sibling).toBeDefined()
    const model = readModelListing('opencode', listing([entry()])).models.get('deepseek-v5-preview')
    expect(model?.compat).toEqual(sibling?.compat)
  })

  it('omits installed models the listing no longer names', () => {
    const reading = readModelListing('opencode', listing([entry()]))
    expect(reading.models.has('deepseek-v4-flash')).toBe(false)
  })

  it('skips an entry whose endpoint this build does not serve, and says why', () => {
    const reading = readModelListing('opencode', listing([entry({ id: 'bedrock-only', recommended_api: 'bedrock-converse' })]))
    expect(reading.models.has('bedrock-only')).toBe(false)
    expect(reading.skipped).toEqual(['bedrock-only: endpoint "bedrock-converse" is not one this build serves'])
  })

  it('skips an entry without positive limits', () => {
    const reading = readModelListing('opencode', listing([entry({ id: 'no-limits', limit: { context: 1000 } })]))
    expect(reading.models.has('no-limits')).toBe(false)
    expect(reading.skipped).toEqual(['no-limits: limit.context and limit.output must be positive integers'])
  })

  it('rejects a document that is not a model list', () => {
    expect(() => readModelListing('opencode', { data: 'nope' })).toThrow('the listing is not a model list')
  })
})

describe('served-model listing cache', () => {
  it('awaits the first reading, then serves it without another request while fresh', async () => {
    let now = 0
    const requests: { url: string; accept: string | null }[] = []
    const cache = new ModelListingCache({
      fetch: (url, init) => {
        requests.push({ url: urlOf(url), accept: new Headers(init?.headers).get('accept') })
        return Promise.resolve(jsonResponse(listing([entry()])))
      },
      now: () => now,
    })
    expect(cache.version).toBe(0)
    await cache.ensure('opencode', SPEC)
    expect(cache.liveModels('opencode')?.has('deepseek-v5-preview')).toBe(true)
    expect(cache.version).toBe(1)
    await cache.ensure('opencode', SPEC)
    expect(requests).toEqual([{ url: SPEC.url, accept: 'application/json' }])
    now = SPEC.maxAgeMs - 1
    await cache.ensure('opencode', SPEC)
    expect(requests).toHaveLength(1)
  })

  it('serves the last good listing while a stale one refreshes in the background', async () => {
    let now = 0
    let calls = 0
    const cache = new ModelListingCache({
      fetch: () => {
        calls += 1
        return Promise.resolve(jsonResponse(listing([entry({ id: calls === 1 ? 'first-model' : 'second-model' })])))
      },
      now: () => now,
    })
    await cache.ensure('opencode', SPEC)
    now = SPEC.maxAgeMs
    await cache.ensure('opencode', SPEC)
    expect(cache.liveModels('opencode')?.has('first-model')).toBe(true)
    await vi.waitFor(() => { expect(cache.liveModels('opencode')?.has('second-model')).toBe(true) })
    expect(cache.version).toBe(2)
  })

  it('reports a failure, resolves without models, and retries after the failure interval', async () => {
    let now = 0
    const failures: string[] = []
    const replies = [jsonResponse({}, 500), jsonResponse(listing([entry()]))]
    const cache = new ModelListingCache({
      fetch: () => Promise.resolve(replies.shift() ?? jsonResponse(listing([entry()]))),
      now: () => now,
      onFailure: (provider, detail) => { failures.push(`${provider}: ${detail}`) },
    })
    await expect(cache.ensure('opencode', SPEC)).resolves.toBeUndefined()
    expect(cache.liveModels('opencode')).toBeUndefined()
    expect(failures).toEqual(['opencode: the listing answered HTTP 500'])
    now = 30_000
    await cache.ensure('opencode', SPEC)
    expect(cache.liveModels('opencode')).toBeUndefined()
    now = 61_000
    await cache.ensure('opencode', SPEC)
    expect(cache.liveModels('opencode')?.has('deepseek-v5-preview')).toBe(true)
    expect(failures).toHaveLength(1)
  })

  it('keeps the last good listing through a later failure', async () => {
    let now = 0
    const failures: string[] = []
    const replies = [jsonResponse(listing([entry()])), jsonResponse({}, 503)]
    const cache = new ModelListingCache({
      fetch: () => Promise.resolve(replies.shift() ?? jsonResponse({}, 503)),
      now: () => now,
      onFailure: (_provider, detail) => { failures.push(detail) },
    })
    await cache.ensure('opencode', SPEC)
    now = SPEC.maxAgeMs
    await cache.ensure('opencode', SPEC)
    await vi.waitFor(() => { expect(failures).toEqual(['the listing answered HTTP 503']) })
    expect(cache.liveModels('opencode')?.has('deepseek-v5-preview')).toBe(true)
  })

  it('treats a listing that names no servable model as a failure', async () => {
    const failures: string[] = []
    const cache = new ModelListingCache({
      fetch: () => Promise.resolve(jsonResponse(listing([entry({ recommended_api: 'bedrock-converse' })]))),
      onFailure: (_provider, detail) => { failures.push(detail) },
    })
    await cache.ensure('opencode', SPEC)
    expect(cache.liveModels('opencode')).toBeUndefined()
    expect(failures).toEqual(['the listing names no model this build can serve'])
  })
})

describe('listing resolution in profiles', () => {
  it('follows the built-in listing of an opencode route on its default endpoint', () => {
    const profile = resolveProfiles({ opencode: {} }).get('opencode')
    expect(profile?.modelListing).toEqual({
      url: 'https://opencode.ai/inference/v1/models',
      maxAgeMs: 600_000,
      timeoutMs: 10_000,
    })
  })

  it('follows no listing when the route is switched off, names its own models, or moves endpoint', () => {
    expect(resolveProfiles({ opencode: { followModelListing: false } }).get('opencode')?.modelListing).toBeUndefined()
    expect(resolveProfiles({ opencode: { models: [{ id: 'deepseek-v4-pro' }] } }).get('opencode')?.modelListing).toBeUndefined()
    expect(resolveProfiles({ opencode: { baseURL: 'https://gateway.example.test/v1' } }).get('opencode')?.modelListing).toBeUndefined()
  })

  it('follows a listing URL the route names, even on a moved endpoint', () => {
    const profile = resolveProfiles({
      opencode: { baseURL: 'https://gateway.example.test/v1', modelListingUrl: 'https://gateway.example.test/v1/models' },
    }).get('opencode')
    expect(profile?.modelListing?.url).toBe('https://gateway.example.test/v1/models')
  })

  it('refuses a listing URL that is not absolute http(s)', () => {
    expect(() => resolveProfiles({ opencode: { modelListingUrl: 'opencode.ai/models' } })).toThrow('absolute http(s) URL')
  })
})

describe('adapter with a served listing', () => {
  it('offers the listed models and describes an unknown one for requests', async () => {
    const cache = new ModelListingCache({
      fetch: () => Promise.resolve(jsonResponse(listing([entry({ id: 'deepseek-v4-pro' }), entry()]))),
      now: () => 0,
    })
    const adapter = new PiAiAdapter({
      profiles: () => resolveProfiles({ opencode: {} }, 'deferred', provider => cache.liveModels(provider)),
      resolveApiKey: () => Promise.resolve(undefined),
      auth: memoryAuth(),
      modelListings: cache,
    })
    const ids = (await adapter.listModels('opencode')).map(model => model.id)
    expect(ids).toEqual(['deepseek-v4-pro', 'deepseek-v5-preview'])
    const resolved = await adapter.resolveModel('opencode', 'deepseek-v5-preview')
    expect(resolved.context).toEqual({ contextWindow: 500_000 })
  })
})
