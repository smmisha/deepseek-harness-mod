/** Plugin mount: resolved options, transport selection, the proxy lifetime, and connector diagnostics. */
import { createServer } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, Config, type Config as FreeChatConfig } from '../src/index.ts'
import type { GuestPort } from '../src/types.ts'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })))
})

async function root(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'freechat-plugin-'))
  roots.push(directory)
  return directory
}

function spied(ctx: Context) {
  return {
    info: vi.spyOn(ctx.logger, 'info').mockImplementation(() => undefined),
    warn: vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined),
    error: vi.spyOn(ctx.logger, 'error').mockImplementation(() => undefined),
  }
}

async function mount(config: FreeChatConfig, setup: (ctx: Context) => void = () => undefined) {
  const ctx = new Context()
  const logs = spied(ctx)
  setup(ctx)
  const fiber = ctx.plugin({ name: 'freechat-test', apply }, config)
  return { ctx, logs, fiber }
}

describe('freechat plugin', () => {
  it('defaults every section through its schema', () => {
    expect(Config({})).toMatchObject({
      server: { host: '127.0.0.1', port: 8788, token: '' },
      transport: { kind: 'loopback' },
      storage: { directory: '.freechat' },
      connectors: { file: 'mcp.servers.json' },
    })
  })

  it('serves the proxy, reports connector problems, and releases the port on unload', async () => {
    const directory = await root()
    const file = join(directory, 'mcp.servers.json')
    await writeFile(file, JSON.stringify({ mcpServers: { ok: { command: 'npx' }, broken: {} } }))
    const { ctx, logs, fiber } = await mount({
      server: { port: 0 }, storage: { directory }, connectors: { file },
      registry: { url: '' }, cdp: {}, context: {},
    })
    await fiber.await()
    await vi.waitFor(() => { expect(logs.info).toHaveBeenCalledWith(expect.stringContaining('OpenAI-compatible proxy listening on http://127.0.0.1:')) })
    const listening = String(logs.info.mock.calls.find(([message]) => String(message).includes('listening'))?.[0])
    const origin = listening.slice(listening.indexOf('http://'))
    await vi.waitFor(() => { expect(logs.info).toHaveBeenCalledWith('freechat: 1 connector(s) loaded from ' + file) })
    expect(logs.warn).toHaveBeenCalledWith('freechat: connector "broken" rejected: broken declares neither a command nor a url')
    const answer = await fetch(`${origin}/v1/chat/completions`, {
      method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    })
    const body = (await answer.json()) as { choices: { message: { content: string } }[] }
    expect(body.choices[0]?.message.content).toContain('loopback transport has no web account')
    const admin = ctx.get('freechatAdmin')
    expect((await admin?.state())?.models.map(model => model.id)).toContain('deepseek-web-chat')
    expect((await admin?.state())?.threads).toHaveLength(1)
    expect(await admin?.resetThread('default')).toEqual({ closedSession: true })
    await fiber.dispose()
    await expect(fetch(`${origin}/healthz`)).rejects.toThrow()
  })

  it('logs a proxy that cannot bind and a connector file that holds none', async () => {
    const blocker = createServer()
    await new Promise<void>((resolve) => { blocker.listen(0, '127.0.0.1', resolve) })
    const address = blocker.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    const directory = await root()
    const { logs, fiber } = await mount({ server: { port }, storage: { directory }, connectors: { file: join(directory, 'none.json') } })
    await fiber.await()
    await vi.waitFor(() => { expect(logs.error).toHaveBeenCalledWith('freechat: could not start the proxy', expect.any(Error)) })
    expect(logs.info).not.toHaveBeenCalledWith(expect.stringContaining('connector(s) loaded'))
    await fiber.dispose()
    await new Promise<void>((resolve) => { blocker.close(() => { resolve() }) })
  })

  it('selects the CDP transport and the desktop guest transport when the shell provides its port', async () => {
    const directory = await root()
    const cdp = await mount({ server: { port: 0 }, storage: { directory }, transport: { kind: 'cdp' }, connectors: { file: join(directory, 'x') } })
    await cdp.fiber.await()
    await cdp.fiber.dispose()
    const port: GuestPort = { evaluate: () => Promise.reject(new Error('unused')) }
    const guest = await mount(
      { server: { port: 0 }, storage: { directory }, transport: { kind: 'electron-guest' }, connectors: { file: join(directory, 'x') } },
      (ctx) => { ctx.provide('freeChatGuestPort', port) },
    )
    await guest.fiber.await()
    await guest.fiber.dispose()
  })

  it('refuses options it cannot serve', async () => {
    const cases: Array<[FreeChatConfig, string]> = [
      [{ server: { maxBodyBytes: 0 } }, 'server.maxBodyBytes must be a positive integer'],
      [{ server: { host: '' } }, 'server.host must not be empty'],
      [{ server: { port: 70_000 } }, 'server.port must be an integer from 0 through 65535'],
      [{ server: { port: 1.5 } }, 'server.port must be an integer from 0 through 65535'],
      [{ context: { replayTail: 50, maxMessages: 10 } }, 'context.replayTail must not exceed context.maxMessages'],
      [{ storage: { directory: '' } }, 'storage.directory must not be empty'],
      [{ transport: { kind: 'electron-guest' } }, 'requires the desktop shell to provide the "freeChatGuestPort" service'],
    ]
    for (const [config, message] of cases) {
      const { fiber } = await mount(config)
      await expect(fiber.await()).rejects.toThrow(message)
    }
  })
})
