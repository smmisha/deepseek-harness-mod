/** Public Usage records: the Remote boundary between the Host ledger and the Usage page. */

/** Tokens one model spent, split the way providers bill them. */
export interface UsageTokens {
  /** Uncached prompt tokens. */
  readonly input: number
  /** Prompt tokens served from the provider cache. */
  readonly cacheRead: number
  /** Prompt tokens written to the provider cache. */
  readonly cacheWrite: number
  /** Completion tokens. */
  readonly output: number
}

/** Calls of one provider route and model inside one quarter hour. */
export interface UsageSlotRow extends UsageTokens {
  /** Start of the quarter hour in Unix epoch milliseconds (UTC). */
  readonly slot: number
  /** Provider route id the calls went to. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
  /** Billed attempts in the slot. */
  readonly calls: number
}

/** Rolling window lengths a limit can bound. */
export type UsageWindow = 'fiveHours' | 'week' | 'month'

/** Token budget per rolling window, as configured under the provider id; an absent window is unbounded. */
export interface UsageBudget {
  /** Tokens allowed in any rolling five hours. */
  readonly fiveHours?: number | undefined
  /** Tokens allowed in any rolling seven days. */
  readonly week?: number | undefined
  /** Tokens allowed in any rolling thirty days. */
  readonly month?: number | undefined
}

/** One provider's token budget per rolling window; an absent window is unbounded. */
export interface UsageLimit {
  /** Provider route id the budget applies to. */
  readonly provider: string
  /** Tokens allowed in any rolling five hours. */
  readonly fiveHours?: number | undefined
  /** Tokens allowed in any rolling seven days. */
  readonly week?: number | undefined
  /** Tokens allowed in any rolling thirty days. */
  readonly month?: number | undefined
}

/** Tokens one provider spent in each rolling window ending now. */
export interface UsageWindowTotals {
  /** Provider route id. */
  readonly provider: string
  /** Tokens in the last five hours. */
  readonly fiveHours: number
  /** Tokens in the last seven days. */
  readonly week: number
  /** Tokens in the last thirty days. */
  readonly month: number
}

/** What the Usage page shows at one moment. */
export interface UsageView {
  /** Quarter-hour rows since the requested start, oldest first. */
  readonly rows: readonly UsageSlotRow[]
  /** Rolling-window totals of every provider seen in the logs. */
  readonly windows: readonly UsageWindowTotals[]
  /** When the ledger last finished reading the session logs, in epoch milliseconds. */
  readonly scannedAt: number
}

/** One currency of the DeepSeek account balance, amounts as the API reports them. */
export interface UsageBalanceEntry {
  /** `CNY` or `USD`. */
  readonly currency: string
  /** Total available balance. */
  readonly total: string
  /** Unexpired granted balance. */
  readonly granted: string
  /** Topped-up balance. */
  readonly toppedUp: string
}

/** The DeepSeek account balance, or why it cannot be shown. */
export type UsageBalance =
  | { readonly status: 'available'; readonly sufficient: boolean; readonly entries: readonly UsageBalanceEntry[] }
  | { readonly status: 'unconfigured' }
  | { readonly status: 'failed'; readonly reason: string }
