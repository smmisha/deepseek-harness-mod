/**
 * DeepSeek account balance through the official `GET /user/balance`. The key
 * is the one the DeepSeek API route uses and never leaves the Host. A short
 * cache keeps the page from calling the API on every open.
 */
import type { UsageBalance, UsageBalanceEntry } from './types.ts'

/** How long one answer is reused. */
export const BALANCE_CACHE_MS = 60_000

/** Budget for one balance request. */
export const BALANCE_TIMEOUT_MS = 10_000

/** Where the balance comes from. */
export interface BalanceOptions {
  /** API origin, `https://api.deepseek.com` unless configured. */
  readonly baseURL: string
  /** The DeepSeek API key, or undefined when none is configured. */
  readonly apiKey: () => Promise<string | undefined>
  /** Clock, injectable for tests. */
  readonly now?: (() => number) | undefined
}

/** Read one balance entry the API returned; amounts stay strings, as reported. */
function entryOf(value: unknown): UsageBalanceEntry | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const entry = value as Record<string, unknown>
  const { currency, total_balance: total, granted_balance: granted, topped_up_balance: toppedUp } = entry
  if (typeof currency !== 'string' || typeof total !== 'string' || typeof granted !== 'string' || typeof toppedUp !== 'string') return undefined
  return { currency, total, granted, toppedUp }
}

/** Cached DeepSeek balance reader. */
export class DeepSeekBalance {
  private cached: { readonly at: number; readonly value: UsageBalance } | undefined

  /** @param options - API origin, key source, and clock. */
  constructor(private readonly options: BalanceOptions) {}

  /**
   * Read the balance, reusing an answer younger than {@link BALANCE_CACHE_MS}.
   * @returns the balance, `unconfigured` without a key, or `failed` with the reason.
   */
  async read(): Promise<UsageBalance> {
    const now = (this.options.now ?? Date.now)()
    if (this.cached !== undefined && now - this.cached.at < BALANCE_CACHE_MS) return this.cached.value
    const value = await this.request()
    this.cached = { at: now, value }
    return value
  }

  private async request(): Promise<UsageBalance> {
    let key: string | undefined
    try {
      key = await this.options.apiKey()
    } catch (error) {
      return { status: 'failed', reason: error instanceof Error ? error.message : String(error) }
    }
    if (key === undefined) return { status: 'unconfigured' }
    try {
      const response = await fetch(new URL('/user/balance', this.options.baseURL), {
        headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
        signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS),
      })
      if (!response.ok) return { status: 'failed', reason: `HTTP ${response.status}` }
      const body: unknown = await response.json()
      const document = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
      const infos = Array.isArray(document.balance_infos) ? document.balance_infos as unknown[] : undefined
      if (infos === undefined || typeof document.is_available !== 'boolean') return { status: 'failed', reason: 'unexpected balance response' }
      const entries = infos.map(entryOf).filter((entry): entry is UsageBalanceEntry => entry !== undefined)
      return { status: 'available', sufficient: document.is_available, entries }
    } catch (error) {
      return { status: 'failed', reason: error instanceof Error ? error.message : String(error) }
    }
  }
}
