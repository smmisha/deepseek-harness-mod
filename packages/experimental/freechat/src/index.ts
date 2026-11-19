/**
 * Free web chat bridge plugin. One mount starts the local OpenAI-compatible
 * proxy, the durable thread memory, the rotation planner, and the `mcpServers`
 * connector registry; the harness reaches the proxy through its own
 * OpenAI-compatible provider route, so the agent loop is untouched.
 *
 * @module @deepseek-ai/dsh-freechat
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FreeChatAdmin } from './admin.ts'
import { loadConnectorFile } from './connectors/registry.ts'
import { FreeChatKernel } from './kernel/kernel.ts'
import { ModelRegistry } from './kernel/model-registry.ts'
import { ThreadStore } from './kernel/thread-store.ts'
import { createFreeChatServer } from './server/openai-server.ts'
import { CdpGuestPort, DEFAULT_CDP_URL } from './transport/cdp.ts'
import { DEFAULT_GUEST_SELECTORS, ElectronGuestTransport } from './transport/electron-guest.ts'
import { LoopbackTransport } from './transport/loopback.ts'
import type { BridgeLogger, ContextPolicy, GuestPort, WebChatTransport } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Guest page port a desktop shell provides for the `electron-guest` transport. */
    freeChatGuestPort: GuestPort
  }
}

export * from './types.ts'
export { FreeChatAdmin } from './admin.ts'
export type { FreeChatAdminSources } from './admin.ts'
export type { KernelOptions, ThreadSnapshot } from './kernel/kernel.ts'
export type { ModelRegistryOptions } from './kernel/model-registry.ts'
export type { BridgeErrorCode } from './kernel/errors.ts'
export type { FreeChatServer, OpenAiServerOptions } from './server/openai-server.ts'
export type { LoopbackAnswer, LoopbackScript } from './transport/loopback.ts'
export type { GuestSelectors, GuestTransportOptions } from './transport/electron-guest.ts'
export type { CdpPortOptions } from './transport/cdp.ts'
export type { ConnectorParseResult, ConnectorProblem } from './connectors/registry.ts'

/** Plugin name the Loader row addresses. */
export const name = 'freechat'

/** No injected service is mandatory: the proxy owns its own resources. */
export const inject: string[] = []

/** How the bridge reaches the signed-in chat page. */
export interface TransportSection {
  /**
   * `electron-guest` drives the desktop guest page and requires the shell to
   * provide the `freeChatGuestPort` service; `loopback` is the scripted
   * transport used by tests and by a deployment that only exercises the proxy.
   */
  readonly kind: 'loopback' | 'electron-guest' | 'cdp'
  /** Poll interval while an answer streams. */
  readonly pollMs: number
  /** Consecutive unchanged polls that end an answer. */
  readonly idlePolls: number
  /** Budget for the guest composer to appear. */
  readonly readyTimeoutMs: number
  /** Budget for one answer to finish before the bridge fails visibly. */
  readonly answerTimeoutMs: number
}

/** Listening surface of the proxy. */
export interface ServerSection {
  /** Bind address; loopback keeps the proxy off the network. */
  readonly host: string
  /** Listen port; zero asks the operating system. */
  readonly port: number
  /** Bearer token every client must present; empty disables authentication. */
  readonly token: string
  /** Largest accepted request body in bytes. */
  readonly maxBodyBytes: number
}

/** Durable memory location. */
export interface StorageSection {
  /** Directory holding one JSONL file per thread plus `index.json`. */
  readonly directory: string
}

/** Remote model catalog. */
export interface RegistrySection {
  /** HTTPS document listing additional free routes; empty keeps the registry local. */
  readonly url: string
  /** Cache lifetime before the next list re-fetches. */
  readonly ttlMs: number
}

/** Browser connection the CDP transport uses. */
export interface CdpSection {
  /** Debugging port of the Chromium instance. */
  readonly port: number
  /** Chat page opened in the dedicated tab. */
  readonly url: string
}

/** Connector document location. */
export interface ConnectorsSection {
  /** `mcpServers` JSON file the hub reads and a management surface writes. */
  readonly file: string
}

/** Plugin configuration; every section is optional and defaulted explicitly. */
export interface Config {
  /** Listening surface. */
  readonly server?: Partial<ServerSection> | undefined
  /** Web-chat transport selection. */
  readonly transport?: Partial<TransportSection> | undefined
  /** Rotation budgets. */
  readonly context?: Partial<ContextPolicy> | undefined
  /** Durable memory location. */
  readonly storage?: Partial<StorageSection> | undefined
  /** Remote model catalog. */
  readonly registry?: Partial<RegistrySection> | undefined
  /** Browser connection used by `transport.kind="cdp"`. */
  readonly cdp?: Partial<CdpSection> | undefined
  /** Connector document location. */
  readonly connectors?: Partial<ConnectorsSection> | undefined
}

/** Runtime schema for {@link Config}. */
export const Config = z.object({
  server: z.object({
    host: z.string().default('127.0.0.1'),
    port: z.natural().default(8788),
    token: z.string().default(''),
    maxBodyBytes: z.natural().default(8 * 1024 * 1024),
  }),
  transport: z.object({
    kind: z.union(['loopback', 'electron-guest', 'cdp']).default('loopback'),
    pollMs: z.natural().default(250),
    idlePolls: z.natural().default(3),
    readyTimeoutMs: z.natural().default(45_000),
    answerTimeoutMs: z.natural().default(180_000),
  }),
  context: z.object({
    maxMessages: z.natural().default(40),
    maxTokens: z.natural().default(100_000),
    replayTail: z.natural().default(12),
    maxCharsPerMessage: z.natural().default(12_000),
  }),
  storage: z.object({
    directory: z.string().default('.freechat'),
  }),
  registry: z.object({
    url: z.string().default(''),
    ttlMs: z.natural().default(6 * 60 * 60 * 1000),
  }),
  cdp: z.object({
    port: z.natural().default(9222),
    url: z.string().default(DEFAULT_CDP_URL),
  }),
  connectors: z.object({
    file: z.string().default('mcp.servers.json'),
  }),
})

/** Fully resolved mount options; every optional field has a stated value. */
export interface ResolvedOptions {
  /** Listening surface. */
  readonly server: ServerSection
  /** Web-chat transport selection. */
  readonly transport: TransportSection
  /** Rotation budgets. */
  readonly context: ContextPolicy
  /** Durable memory location. */
  readonly storage: StorageSection
  /** Remote model catalog. */
  readonly registry: RegistrySection
  /** Browser connection used by the CDP transport. */
  readonly cdp: CdpSection
  /** Connector document location. */
  readonly connectors: ConnectorsSection
}

/** Reject one count that cannot serve as a budget. */
function positive(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`freechat: ${field} must be a positive integer`)
  return value
}

/**
 * Resolve one plugin Config into mount options, refusing values that cannot be
 * served. Defaulting happens here, explicitly, instead of inside the runtime.
 * @param config - parsed plugin Config; sections may be absent.
 * @returns fully resolved options.
 * @throws Error naming the field that cannot be served.
 */
function resolveOptions(config: Config): ResolvedOptions {
  const server: ServerSection = {
    host: config.server?.host ?? '127.0.0.1',
    port: config.server?.port ?? 8788,
    token: config.server?.token ?? '',
    maxBodyBytes: positive(config.server?.maxBodyBytes ?? 8 * 1024 * 1024, 'server.maxBodyBytes'),
  }
  if (server.host.length === 0) throw new Error('freechat: server.host must not be empty')
  if (!Number.isInteger(server.port) || server.port < 0 || server.port > 65_535) {
    throw new Error('freechat: server.port must be an integer from 0 through 65535')
  }
  const context: ContextPolicy = {
    maxMessages: positive(config.context?.maxMessages ?? 40, 'context.maxMessages'),
    maxTokens: positive(config.context?.maxTokens ?? 100_000, 'context.maxTokens'),
    replayTail: positive(config.context?.replayTail ?? 12, 'context.replayTail'),
    maxCharsPerMessage: positive(config.context?.maxCharsPerMessage ?? 12_000, 'context.maxCharsPerMessage'),
  }
  if (context.replayTail > context.maxMessages) throw new Error('freechat: context.replayTail must not exceed context.maxMessages')
  const directory = config.storage?.directory ?? '.freechat'
  if (directory.length === 0) throw new Error('freechat: storage.directory must not be empty')
  return {
    server,
    transport: {
      kind: config.transport?.kind ?? 'loopback',
      pollMs: positive(config.transport?.pollMs ?? 250, 'transport.pollMs'),
      idlePolls: positive(config.transport?.idlePolls ?? 3, 'transport.idlePolls'),
      readyTimeoutMs: positive(config.transport?.readyTimeoutMs ?? 45_000, 'transport.readyTimeoutMs'),
      answerTimeoutMs: positive(config.transport?.answerTimeoutMs ?? 180_000, 'transport.answerTimeoutMs'),
    },
    context,
    storage: { directory },
    registry: {
      url: config.registry?.url ?? '',
      ttlMs: positive(config.registry?.ttlMs ?? 6 * 60 * 60 * 1000, 'registry.ttlMs'),
    },
    cdp: {
      port: config.cdp?.port ?? 9222,
      url: config.cdp?.url ?? DEFAULT_CDP_URL,
    },
    connectors: { file: config.connectors?.file ?? 'mcp.servers.json' },
  }
}

/** Adapt the Cordis logger to the bridge's narrow logging seam. */
function loggerOf(ctx: Context): BridgeLogger {
  return {
    info: (message) => {
      ctx.logger.info(message)
    },
    warn: (message) => {
      ctx.logger.warn(message)
    },
    error: (message, error) => {
      ctx.logger.error(message, error)
    },
  }
}

/**
 * Select the transport named by configuration.
 * @param ctx - plugin context, for the desktop-provided guest port.
 * @param options - resolved mount options.
 * @returns the transport the kernel drives.
 * @throws Error when the selected transport has no provider available.
 */
function createTransport(ctx: Context, options: ResolvedOptions): WebChatTransport {
  if (options.transport.kind === 'loopback') {
    return new LoopbackTransport(() => 'freechat: loopback transport has no web account; configure transport.kind="electron-guest".')
  }
  if (options.transport.kind === 'cdp') {
    return new ElectronGuestTransport({
      port: new CdpGuestPort({ port: options.cdp.port, url: options.cdp.url }),
      selectors: DEFAULT_GUEST_SELECTORS,
      pollMs: options.transport.pollMs,
      idlePolls: options.transport.idlePolls,
      readyTimeoutMs: options.transport.readyTimeoutMs,
      answerTimeoutMs: options.transport.answerTimeoutMs,
    })
  }
  const port = ctx.get('freeChatGuestPort', false)
  if (port === undefined) {
    throw new Error('freechat: transport.kind="electron-guest" requires the desktop shell to provide the "freeChatGuestPort" service')
  }
  return new ElectronGuestTransport({
    port,
    selectors: DEFAULT_GUEST_SELECTORS,
    pollMs: options.transport.pollMs,
    idlePolls: options.transport.idlePolls,
    readyTimeoutMs: options.transport.readyTimeoutMs,
    answerTimeoutMs: options.transport.answerTimeoutMs,
  })
}

/**
 * Mount the bridge on one Cordis context. The proxy, the kernel, and its live
 * sessions are owned by the returned effect, so unloading the plugin closes
 * every conversation and releases the port.
 * @param ctx - plugin context.
 * @param config - parsed plugin Config.
 */
export function apply(ctx: Context, config: Config): void {
  const options = resolveOptions(config)
  const logger = loggerOf(ctx)
  const registry = new ModelRegistry({
    url: options.registry.url,
    ttlMs: options.registry.ttlMs,
    logger,
  })
  const store = new ThreadStore(options.storage.directory)
  const kernel = new FreeChatKernel({
    transport: createTransport(ctx, options),
    registry,
    store,
    policy: options.context,
    logger,
  })
  const server = createFreeChatServer({
    kernel,
    registry,
    logger,
    host: options.server.host,
    port: options.server.port,
    token: options.server.token,
    maxBodyBytes: options.server.maxBodyBytes,
  })
  new FreeChatAdmin(ctx, {
    models: () => registry.list(),
    threads: () => kernel.snapshots(),
    resetThread: id => kernel.resetThread(id),
  })
  ctx.effect(() => {
    void server.listen()
      .then((origin) => { logger.info(`freechat: OpenAI-compatible proxy listening on ${origin}`) })
      .catch((error: unknown) => { logger.error('freechat: could not start the proxy', error) })
    void loadConnectorFile(options.connectors.file).then((result) => {
      for (const problem of result.problems) logger.warn(`freechat: connector "${problem.name}" rejected: ${problem.reason}`)
      const count = Object.keys(result.connectors).length
      if (count > 0) logger.info(`freechat: ${count} connector(s) loaded from ${options.connectors.file}`)
    })
    return async () => {
      await server.close()
      await kernel.dispose()
    }
  }, 'freechat.mount()')
}
