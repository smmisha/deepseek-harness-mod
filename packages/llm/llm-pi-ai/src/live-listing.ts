/**
 * Served-model listings for provider routes whose gateway publishes the models it
 * serves now. The installed pi-ai catalog is a release snapshot, so a route that
 * follows its listing offers what the gateway serves at the moment it is read.
 *
 * A listed id the catalog already knows keeps the catalog entry, with its endpoint,
 * pricing, and compatibility switches. A listed id the catalog does not know is
 * described from the listing: its endpoint, limits, modalities, and reasoning
 * efforts come from the listing, and its compatibility switches come from the
 * installed model that shares its family and endpoint, when one exists. A catalog
 * entry the listing no longer names leaves the route while the listing is in use.
 *
 * @module dsh-llm-pi-ai/live-listing
 */
import type { Api, Model, ModelCost, ModelThinkingLevel, ThinkingLevelMap } from '@earendil-works/pi-ai'
import { catalogModels } from './catalog.ts'

/** Where and how often one route's model listing is read. */
export interface ModelListingSpec {
  /** Absolute URL of the listing document; fetched without credentials. */
  readonly url: string
  /** Age after which a served listing refreshes in the background. */
  readonly maxAgeMs: number
  /** Limit on one listing request before the reading counts as failed. */
  readonly timeoutMs: number
}

/** The listing of a built-in route: its listing document and the endpoint base the route defaults to. */
export interface BuiltinModelListing {
  /** Listing document URL. */
  readonly url: string
  /** Endpoint base of the route's default configuration; a listing follows only that endpoint. */
  readonly base: string
}

/** Listings the built-in opencode routes publish, keyed by route key. */
export const BUILTIN_MODEL_LISTINGS: Readonly<Record<string, BuiltinModelListing>> = {
  'opencode': {
    url: 'https://opencode.ai/inference/v1/models',
    base: 'https://opencode.ai/inference/v1',
  },
  'opencode-go': {
    url: 'https://opencode.ai/inference/go/v1/models',
    base: 'https://opencode.ai/inference/go/v1',
  },
}

/**
 * The listing a route follows by default: the built-in listing of its provider,
 * when the route still uses that provider's default endpoint. A route pointed at
 * another endpoint has no default listing, because that endpoint's model set is
 * not the one the listing describes.
 * @param provider - route key.
 * @param baseURL - the route's configured endpoint, if any.
 * @returns the default listing URL, or undefined when the route follows none.
 */
export function defaultModelListingUrl(provider: string, baseURL: string | undefined): string | undefined {
  const listing = Object.hasOwn(BUILTIN_MODEL_LISTINGS, provider) ? BUILTIN_MODEL_LISTINGS[provider] : undefined
  if (listing === undefined) return undefined
  if (baseURL === undefined || trimTrailingSlashes(baseURL) === listing.base) return listing.url
  return undefined
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '')
}

/** Endpoint names a listing uses, mapped to the pi-ai wire protocol each one speaks. */
const LISTED_APIS: ReadonlyMap<string, Api> = new Map<string, Api>([
  ['chat-completions', 'openai-completions'],
  ['messages', 'anthropic-messages'],
  ['responses', 'openai-responses'],
  ['generate-content', 'google-generative-ai'],
])

/** Thinking levels a listing's effort names are matched against, in pi-ai's order. */
const THINKING_LEVELS: readonly ModelThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** A failed reading retries after this long, so an outage does not hold requests for the full listing age. */
const FAILED_LISTING_RETRY_MS = 60_000

/** One listing reading: the models it describes and one note per entry it could not serve. */
export interface ModelListingReading {
  /** Served models in listing order, keyed by id. */
  readonly models: ReadonlyMap<string, Model<Api>>
  /** Notes naming each entry that was skipped and why. */
  readonly skipped: readonly string[]
}

/**
 * Describe the models one listing document names for a route.
 * @param provider - route key; its installed catalog supplies the known ids and
 * every described model is served under it.
 * @param body - the parsed listing document.
 * @returns the served models and the entries skipped with their reasons.
 * @throws Error when the document is not a model list.
 */
export function readModelListing(provider: string, body: unknown): ModelListingReading {
  if (!isRecord(body) || !Array.isArray(body.data)) throw new Error('the listing is not a model list')
  const installed = catalogModels(provider)
  const installedList = [...installed.values()]
  const models = new Map<string, Model<Api>>()
  const skipped: string[] = []
  for (const entry of body.data) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id.length === 0) {
      skipped.push('an entry without a model id')
      continue
    }
    const known = installed.get(entry.id)
    if (known !== undefined) {
      models.set(entry.id, known)
      continue
    }
    const described = describeListed(provider, entry.id, entry, installedList)
    if (typeof described === 'string') skipped.push(`${entry.id}: ${described}`)
    else models.set(entry.id, described)
  }
  return { models, skipped }
}

/**
 * Describe one listed id the installed catalog does not know.
 * @param provider - route key the model is served under.
 * @param id - listed model id.
 * @param entry - the listing entry.
 * @param installed - the installed models of the route, for compatibility inheritance.
 * @returns the model, or the reason it cannot be served.
 */
function describeListed(
  provider: string,
  id: string,
  entry: Record<string, unknown>,
  installed: readonly Model<Api>[],
): Model<Api> | string {
  const apis = isRecord(entry.api) ? entry.api : {}
  const listed = typeof entry.recommended_api === 'string' ? entry.recommended_api : Object.keys(apis)[0]
  if (listed === undefined) return 'names no endpoint'
  const api = LISTED_APIS.get(listed)
  if (api === undefined) return `endpoint "${listed}" is not one this build serves`
  const endpoint = apis[listed]
  const listedBase = isRecord(endpoint) && typeof endpoint.base_url === 'string' ? endpoint.base_url : undefined
  if (listedBase === undefined) return `endpoint "${listed}" names no base_url`
  const baseUrl = api === 'anthropic-messages' ? anthropicBaseOf(listedBase) : listedBase
  const limit = isRecord(entry.limit) ? entry.limit : {}
  const contextWindow = positiveInteger(limit.context)
  const maxTokens = positiveInteger(limit.output)
  if (contextWindow === undefined || maxTokens === undefined) {
    return 'limit.context and limit.output must be positive integers'
  }
  const capabilities = isRecord(entry.capabilities) ? entry.capabilities : {}
  const reasoning = isRecord(capabilities.reasoning) ? capabilities.reasoning : undefined
  const supportsReasoning = reasoning?.supported === true
  const efforts = Array.isArray(reasoning?.effort) ? reasoning.effort.filter(isString) : undefined
  const sibling = installed.find(model => model.api === api && familyStem(model.id) === familyStem(id))
  return {
    id,
    name: typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : id,
    api,
    provider,
    baseUrl,
    reasoning: supportsReasoning,
    ...supportsReasoning && efforts !== undefined ? { thinkingLevelMap: thinkingLevelMapOf(efforts) } : {},
    input: inputModalitiesOf(entry.modalities),
    cost: costOf(entry.cost),
    contextWindow,
    maxTokens,
    ...sibling?.compat === undefined ? {} : { compat: sibling.compat },
  }
}

/**
 * The base the Anthropic SDK extends with `/v1/messages`. A listing that publishes
 * the version segment inside the base would send `/v1/v1/messages`, which the
 * gateway does not serve.
 * @param listed - the base URL the listing names.
 * @returns the base without a trailing `/v1` segment.
 */
function anthropicBaseOf(listed: string): string {
  return trimTrailingSlashes(listed).replace(/\/v1$/, '')
}

/**
 * The model's thinking-level spellings: a listed effort keeps its own name, and
 * `off` maps to the listed `none` when the model offers one.
 * @param efforts - the effort names the listing declares.
 * @returns the level map pi-ai reads.
 */
function thinkingLevelMapOf(efforts: readonly string[]): ThinkingLevelMap {
  const map: ThinkingLevelMap = {}
  for (const level of THINKING_LEVELS) {
    const spelling = level === 'off' ? 'none' : level
    map[level] = efforts.includes(spelling) ? spelling : null
  }
  return map
}

/**
 * Input modalities a listing declares. Text is always accepted; an image media
 * type adds image input, and other media types are not modeled by this package.
 * @param modalities - the listing's modalities object.
 * @returns the request modalities.
 */
function inputModalitiesOf(modalities: unknown): Model<Api>['input'] {
  const declared = isRecord(modalities) && Array.isArray(modalities.input) ? modalities.input.filter(isString) : []
  const input: Model<Api>['input'] = declared.some(type => type.startsWith('image/')) ? ['text', 'image'] : ['text']
  return input
}

/**
 * Prices a listing declares, per million tokens. Context-tier overrides are not
 * modeled, so the base price applies at every size.
 * @param cost - the listing's cost object.
 * @returns the cost rates; an absent rate reads as zero.
 */
function costOf(cost: unknown): ModelCost {
  const text = isRecord(cost) && isRecord(cost.text) ? cost.text : {}
  const input = isRecord(text.input) ? text.input : {}
  const output = isRecord(text.output) ? text.output : {}
  const cache = isRecord(input.cache) ? input.cache : {}
  return {
    input: nonNegativeNumber(input.price),
    output: nonNegativeNumber(output.price),
    cacheRead: nonNegativeNumber(cache.read),
    cacheWrite: nonNegativeNumber(cache.write),
  }
}

/**
 * The family a model id belongs to: its leading letters, so `deepseek-v4.1-flash`
 * and `deepseek-v4-pro` share `deepseek`.
 * @param id - model id.
 * @returns the lowercase family stem.
 */
function familyStem(id: string): string {
  return /^[a-z]+/i.exec(id)?.[0].toLowerCase() ?? id.toLowerCase()
}

/** Validated listing cache for one plugin instance: one entry per route, shared by every profile resolution. */
interface RouteListing {
  models?: ReadonlyMap<string, Model<Api>> | undefined
  loadedAt?: number | undefined
  attemptedAt?: number | undefined
  failure?: string | undefined
  skippedKey?: string | undefined
  inFlight?: Promise<void> | undefined
}

/** Options of a {@link ModelListingCache}. */
export interface ModelListingCacheOptions {
  /** Fetch implementation; defaults to the global fetch. */
  readonly fetch?: typeof globalThis.fetch
  /** Clock in milliseconds; defaults to `Date.now`. */
  readonly now?: () => number
  /** Called once per distinct failure of a route's listing. */
  readonly onFailure?: (provider: string, detail: string) => void
  /** Called when a reading skips entries, once per distinct set of notes. */
  readonly onSkipped?: (provider: string, notes: readonly string[]) => void
}

/**
 * Served-model listings read once per route and shared by every profile resolution.
 * A route whose listing has loaded keeps serving it through later failures, so an
 * outage at the gateway does not remove the models an earlier reading described.
 */
export class ModelListingCache {
  private readonly routes = new Map<string, RouteListing>()
  private revision = 0

  constructor(private readonly options: ModelListingCacheOptions = {}) {}

  /** Advances whenever a served listing changes, so memoized profile resolution keys on it. */
  get version(): number {
    return this.revision
  }

  /**
   * The models a route's last good listing served.
   * @param provider - route key.
   * @returns the served models keyed by id, or undefined before a listing loaded.
   */
  liveModels(provider: string): ReadonlyMap<string, Model<Api>> | undefined {
    return this.routes.get(provider)?.models
  }

  /**
   * Make a route's listing as current as a request may wait for. The first reading
   * is awaited; a later one refreshes in the background while the last good
   * listing keeps serving.
   * @param provider - route key.
   * @param spec - where and how often the route's listing is read.
   * @returns resolves when a listing is available or the reading has failed; never rejects.
   */
  ensure(provider: string, spec: ModelListingSpec): Promise<void> {
    const route = this.routeOf(provider)
    if (route.inFlight === undefined && this.due(route, spec)) {
      route.inFlight = this.load(provider, route, spec).finally(() => { route.inFlight = undefined })
    }
    if (route.models !== undefined) return Promise.resolve()
    return route.inFlight ?? Promise.resolve()
  }

  private routeOf(provider: string): RouteListing {
    const existing = this.routes.get(provider)
    if (existing !== undefined) return existing
    const created: RouteListing = {}
    this.routes.set(provider, created)
    return created
  }

  private due(route: RouteListing, spec: ModelListingSpec): boolean {
    if (route.attemptedAt === undefined) return true
    const interval = route.failure === undefined ? spec.maxAgeMs : Math.min(spec.maxAgeMs, FAILED_LISTING_RETRY_MS)
    return this.now() - route.attemptedAt >= interval
  }

  private async load(provider: string, route: RouteListing, spec: ModelListingSpec): Promise<void> {
    route.attemptedAt = this.now()
    try {
      const fetchListing = this.options.fetch ?? globalThis.fetch
      const response = await fetchListing(spec.url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(spec.timeoutMs),
      })
      if (!response.ok) throw new Error(`the listing answered HTTP ${response.status}`)
      const body: unknown = await response.json()
      const reading = readModelListing(provider, body)
      if (reading.models.size === 0) throw new Error('the listing names no model this build can serve')
      route.models = reading.models
      route.loadedAt = this.now()
      route.failure = undefined
      this.revision += 1
      const skippedKey = reading.skipped.join('\n')
      if (reading.skipped.length > 0 && skippedKey !== route.skippedKey) {
        this.options.onSkipped?.(provider, reading.skipped)
      }
      route.skippedKey = skippedKey
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      if (route.failure !== detail) this.options.onFailure?.(provider, detail)
      route.failure = detail
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}
