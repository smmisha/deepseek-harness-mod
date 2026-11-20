/** Model registry: built-in routes, overrides, and the validated, cached remote catalog. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_MODELS, ModelRegistry } from '../src/kernel/model-registry.ts'
import type { BridgeLogger } from '../src/types.ts'

afterEach(() => { vi.unstubAllGlobals() })

function logger() {
  return {
    info: vi.fn<(message: string) => void>(),
    warn: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string, error?: unknown) => void>(),
  } satisfies BridgeLogger
}

function serve(...answers: Array<{ ok?: boolean; status?: number; body?: unknown } | Error | string>) {
  const fetch = vi.fn(() => {
    const answer = answers.shift()
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the registry must report a non-Error rejection too
    if (answer instanceof Error || typeof answer === 'string') return Promise.reject(answer)
    return Promise.resolve({ ok: answer?.ok ?? true, status: answer?.status ?? 200, json: () => Promise.resolve(answer?.body) })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('ModelRegistry', () => {
  it('resolves the default and named built-in routes, applying overrides by id', () => {
    const registry = new ModelRegistry({ ttlMs: 1, logger: logger(), overrides: [{ ...BUILTIN_MODELS[0]!, name: 'Renamed' }] })
    expect(registry.resolve(undefined)?.name).toBe('Renamed')
    expect(registry.resolve('')?.id).toBe('deepseek-web-chat')
    expect(registry.resolve('deepseek-web-reasoner')?.reasoning).toBe(true)
    expect(registry.resolve('missing')).toBeUndefined()
    expect(new ModelRegistry({ ttlMs: 1, logger: logger() }).list()).toEqual(BUILTIN_MODELS)
  })

  it('stays local without a catalog URL', async () => {
    const fetch = serve()
    await new ModelRegistry({ ttlMs: 1, logger: logger(), url: '' }).ensureFresh()
    await new ModelRegistry({ ttlMs: 1, logger: logger() }).ensureFresh()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('merges validated remote entries, shares one fetch, and caches until the entry expires', async () => {
    let now = 1_000
    const log = logger()
    const fetch = serve({ body: { models: [
      { id: 'remote', name: 'Remote', contextWindow: 64_000.7, maxOutputTokens: 4_096.2, reasoning: true },
      { id: 'bare' },
      { id: 'bad-numbers', name: '', contextWindow: -1, maxOutputTokens: '9' },
      { id: '' }, 'text', null,
    ] } }, { body: { models: [{ id: 'later' }] } })
    const registry = new ModelRegistry({ ttlMs: 500, logger: log, url: 'https://catalog.test/models.json', now: () => now })
    await Promise.all([registry.ensureFresh(), registry.ensureFresh()])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(registry.resolve('remote')).toEqual({ id: 'remote', name: 'Remote', contextWindow: 64_000, maxOutputTokens: 4_096, reasoning: true })
    expect(registry.resolve('bare')).toEqual({ id: 'bare', name: 'bare', contextWindow: 128_000, maxOutputTokens: 8_192, reasoning: false })
    expect(registry.resolve('bad-numbers')).toMatchObject({ name: 'bad-numbers', contextWindow: 128_000, maxOutputTokens: 8_192 })
    expect(log.info).toHaveBeenCalledWith('freechat: model registry refreshed with 3 remote models')
    now += 100
    await registry.ensureFresh()
    expect(fetch).toHaveBeenCalledTimes(1)
    now += 1_000
    await registry.ensureFresh()
    expect(registry.resolve('later')).toBeDefined()
  })

  it('keeps the last good list on every kind of failure', async () => {
    const log = logger()
    serve({ body: { models: [{ id: 'kept' }] } }, { ok: false, status: 503 }, { body: null }, { body: { models: 'x' } }, { body: { models: [{ id: '' }] } }, new Error('offline'), 'refused')
    const registry = new ModelRegistry({ ttlMs: 0, logger: log, url: 'https://catalog.test/models.json' })
    for (let attempt = 0; attempt < 7; attempt += 1) await registry.ensureFresh()
    expect(registry.list().map(model => model.id)).toEqual([...BUILTIN_MODELS.map(model => model.id), 'kept'])
    expect(log.warn.mock.calls.map(([message]) => message)).toEqual([
      'freechat: model registry refresh failed (HTTP 503)',
      'freechat: model registry refresh failed (catalog document has no models array)',
      'freechat: model registry refresh failed (catalog document has no models array)',
      'freechat: model registry refresh failed (catalog document lists no usable model)',
      'freechat: model registry refresh failed (offline)',
      'freechat: model registry refresh failed (refused)',
    ])
  })
})
