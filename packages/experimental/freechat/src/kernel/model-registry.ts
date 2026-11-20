/**
 * Model registry: the bridge's answer to "which web models may a caller ask
 * for". Built-in entries ship with the package; an optional remote JSON
 * document adds or overrides entries without a release, which is how newly
 * published free routes reach an installed bridge.
 */

import type { BridgeLogger, ModelDescriptor } from '../types.ts'

/** Routes the web chat exposes without a remote catalog; overridable by id. */
export const BUILTIN_MODELS: readonly ModelDescriptor[] = [
  { id: 'deepseek-web-chat', name: 'DeepSeek Web Chat', contextWindow: 128_000, maxOutputTokens: 8_192, reasoning: false },
  { id: 'deepseek-web-reasoner', name: 'DeepSeek Web Reasoner', contextWindow: 128_000, maxOutputTokens: 8_192, reasoning: true },
]

/** One remote catalog document this registry understands. */
interface RemoteCatalog {
  readonly models?: unknown
}

/**
 * Validate one remote entry. A remote document is a wire boundary, so every
 * field is checked instead of trusted; a malformed entry is dropped with a
 * diagnostic rather than taking the whole catalog down.
 * @param value - one parsed entry.
 * @returns the descriptor, or undefined when the entry is unusable.
 */
function parseDescriptor(value: unknown): ModelDescriptor | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const entry = value as Record<string, unknown>
  if (typeof entry.id !== 'string' || entry.id.length === 0) return undefined
  const contextWindow = typeof entry.contextWindow === 'number' && entry.contextWindow > 0
    ? Math.floor(entry.contextWindow)
    : 128_000
  const maxOutputTokens = typeof entry.maxOutputTokens === 'number' && entry.maxOutputTokens > 0
    ? Math.floor(entry.maxOutputTokens)
    : 8_192
  return {
    id: entry.id,
    name: typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : entry.id,
    contextWindow,
    maxOutputTokens,
    reasoning: entry.reasoning === true,
  }
}

/** Options the registry resolves once at mount. */
export interface ModelRegistryOptions {
  /** Remote catalog URL; omission keeps the registry local-only. */
  readonly url?: string | undefined
  /** Refresh interval after which the next list re-fetches. */
  readonly ttlMs: number
  /** Entries merged under and over the built-in list. */
  readonly overrides?: readonly ModelDescriptor[] | undefined
  /** Diagnostic sink. */
  readonly logger: BridgeLogger
  /** Clock used for cache staleness, injectable for tests. */
  readonly now?: (() => number) | undefined
}

/** Merge override entries over the built-in list by id. */
function mergeModels(base: readonly ModelDescriptor[], overrides: readonly ModelDescriptor[]): ModelDescriptor[] {
  const merged = new Map<string, ModelDescriptor>(base.map(model => [model.id, model]))
  for (const override of overrides) merged.set(override.id, override)
  return [...merged.values()]
}

/** Playable-route directory with an optional self-refreshing remote catalog. */
export class ModelRegistry {
  private readonly options: ModelRegistryOptions
  private models: readonly ModelDescriptor[]
  private fetchedAt = 0
  private refreshing: Promise<void> | undefined

  /**
   * @param options - catalog sources and diagnostics.
   */
  constructor(options: ModelRegistryOptions) {
    this.options = options
    this.models = mergeModels(BUILTIN_MODELS, options.overrides ?? [])
  }

  /** Every playable model, overrides applied. */
  list(): readonly ModelDescriptor[] {
    return this.models
  }

  /**
   * Resolve one requested model id.
   * @param id - requested id, absent when the caller did not name a model.
   * @returns the descriptor, or undefined when the route is not playable.
   */
  resolve(id: string | undefined): ModelDescriptor | undefined {
    // The built-in routes always remain, so an unnamed request takes the first one.
    if (id === undefined || id.length === 0) return this.models[0]
    return this.models.find(model => model.id === id)
  }

  /**
   * Refresh the remote catalog when the cache is stale, while keeping the last
   * good list on any failure. Concurrent callers share one fetch.
   */
  async ensureFresh(): Promise<void> {
    const url = this.options.url
    if (url === undefined || url.length === 0) return
    const now = (this.options.now ?? Date.now)()
    if (now - this.fetchedAt < this.options.ttlMs) return
    if (this.refreshing !== undefined) return this.refreshing
    this.refreshing = this.refresh(url).finally(() => {
      this.refreshing = undefined
    })
    return this.refreshing
  }

  private async refresh(url: string): Promise<void> {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const document: unknown = await response.json()
      const entries = isCatalog(document) ? document.models : undefined
      if (!Array.isArray(entries)) throw new Error('catalog document has no models array')
      const parsed = entries.map(parseDescriptor).filter((value): value is ModelDescriptor => value !== undefined)
      if (parsed.length === 0) throw new Error('catalog document lists no usable model')
      this.models = mergeModels(BUILTIN_MODELS, [...parsed, ...(this.options.overrides ?? [])])
      this.fetchedAt = (this.options.now ?? Date.now)()
      this.options.logger.info(`freechat: model registry refreshed with ${parsed.length} remote models`)
    } catch (error) {
      this.options.logger.warn(`freechat: model registry refresh failed (${error instanceof Error ? error.message : String(error)})`)
    }
  }
}

/** Narrow an unknown document to the catalog family. */
function isCatalog(value: unknown): value is RemoteCatalog {
  return typeof value === 'object' && value !== null
}
