/** Usage plugin mount: the ledger file location, the Session query reads, and the balance key. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, Config, type UsageService } from '../src/index.ts'

const roots: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

interface KeySources {
  /** What the credential store holds; absent mounts no store. */
  readonly store?: { readonly value: string } | undefined | 'none'
  /** Launch-environment values; absent mounts no launch environment. */
  readonly launch?: Readonly<Record<string, string>>
}

async function mount(config: Record<string, unknown>, profileDir?: string, failing = false, keys: KeySources = { store: undefined }) {
  const ctx = new Context()
  const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
  const configure = vi.fn(() => () => undefined)
  ctx.provide('settings', { configure })
  const resolve = vi.fn((_ref: string) => Promise.resolve(keys.store === 'none' ? undefined : keys.store))
  if (keys.store !== 'none') ctx.provide('credentials', { resolve })
  const launch = keys.launch
  if (launch !== undefined) ctx.provide('launchEnvironment', { get: (name: string) => (name in launch ? { source: 'process', value: launch[name] } : undefined) })
  if (profileDir !== undefined) ctx.provide('profileContext', { dir: profileDir })
  ctx.provide('sessionQuery', {
    listSessions: () => Promise.resolve([{ header: { id: 's1' }, live: false }]),
    readSession: () => failing ? Promise.reject(new Error('locked log')) : Promise.resolve({
      inheritedEventCount: 0,
      events: [
        { seq: 0, time: Date.now(), type: 'request/context', data: { provider: 'p', model: 'm' } },
        { seq: 1, time: Date.now(), type: 'assistant/attempt', data: { turn: 1, step: 1, stream: [
          { type: 'chunk', time: 0, chunk: { type: 'usage', usage: { inputTokens: 3, outputTokens: 1 } } },
          { type: 'text-chunks', time0: 0, index: 0, dt: [0], texts: ['ok'] },
          { type: 'chunk', time: 0, chunk: { type: 'finish', reason: 'stop' } },
        ] } },
      ],
    }),
  })
  const fiber = ctx.plugin({ name: 'usage-test', inject: ['sessionQuery'], apply }, Config(config))
  await fiber.await()
  return { ctx, configure, warn, resolve, service: ctx.get('usage') as UsageService }
}

describe('usage plugin', () => {
  it('keeps the ledger in the profile directory, serves the view, and hides the automatic settings page', async () => {
    const root = await mkdtemp(join(tmpdir(), 'usage-plugin-'))
    roots.push(root)
    const { service, configure } = await mount({}, root)
    expect(configure).toHaveBeenCalledWith({ auto: false }, expect.anything())
    const view = await service.view(0)
    expect(view.windows).toEqual([{ provider: 'p', fiveHours: 4, week: 4, month: 4 }])
    expect(JSON.parse(await readFile(join(root, 'usage-ledger.json'), 'utf8'))).toMatchObject({ version: 1 })
    expect(await service.balance()).toEqual({ status: 'unconfigured' })
  })

  it('logs a Session the query service cannot read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'usage-plugin-'))
    roots.push(root)
    const { service, warn } = await mount({}, root, true)
    expect((await service.view(0)).windows).toEqual([])
    expect(warn).toHaveBeenCalledWith('usage: could not read Session s1 (locked log)')
  })

  it('writes an absolute ledger path as given and falls back to the working directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'usage-plugin-'))
    roots.push(root)
    const file = join(root, 'custom.json')
    const { service } = await mount({ ledgerFile: file })
    await service.view(0)
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ version: 1 })
    const spy = vi.spyOn(process, 'cwd').mockReturnValue(root)
    const relative = await mount({ ledgerFile: 'relative.json' })
    await relative.service.view(0)
    spy.mockRestore()
    expect(JSON.parse(await readFile(join(root, 'relative.json'), 'utf8'))).toMatchObject({ version: 1 })
  })

  it('reads the DeepSeek key from the store, then the launch environment, then the process', async () => {
    const authorizations: string[] = []
    vi.stubGlobal('fetch', vi.fn((_url: URL, init: RequestInit) => {
      authorizations.push(new Headers(init.headers).get('authorization') ?? '')
      return Promise.resolve(new Response(JSON.stringify({ is_available: true, balance_infos: [] })))
    }))
    const stored = await mount({}, undefined, false, { store: { value: ' sk-store ' } })
    expect((await stored.service.balance()).status).toBe('available')
    expect(stored.resolve).toHaveBeenCalledWith('DEEPSEEK_API_KEY')
    const launched = await mount({}, undefined, false, { store: 'none', launch: { DEEPSEEK_API_KEY: 'sk-launch' } })
    expect((await launched.service.balance()).status).toBe('available')
    vi.stubEnv('USAGE_TEST_KEY', 'sk-process')
    const ambient = await mount({ deepseek: { apiKeyEnv: 'USAGE_TEST_KEY' } }, undefined, false, { store: 'none' })
    expect((await ambient.service.balance()).status).toBe('available')
    // A mounted launch environment is authoritative, as for the DeepSeek route: the process is not consulted.
    const snapshot = await mount({ deepseek: { apiKeyEnv: 'USAGE_TEST_KEY' } }, undefined, false, { store: 'none', launch: {} })
    expect(await snapshot.service.balance()).toEqual({ status: 'unconfigured' })
    vi.unstubAllEnvs()
    expect(authorizations).toEqual(['Bearer sk-store', 'Bearer sk-launch', 'Bearer sk-process'])
    const blank = await mount({}, undefined, false, { store: { value: '   ' } })
    expect(await blank.service.balance()).toEqual({ status: 'unconfigured' })
    const none = await mount({ deepseek: { apiKeyEnv: 'USAGE_TEST_UNSET' } }, undefined, false, { store: 'none' })
    expect(await none.service.balance()).toEqual({ status: 'unconfigured' })
  })

  it('defaults the DeepSeek source and an empty budget list', () => {
    expect(Config({})).toMatchObject({ ledgerFile: 'usage-ledger.json', deepseek: { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: 'https://api.deepseek.com' }, limits: {} })
  })
})
