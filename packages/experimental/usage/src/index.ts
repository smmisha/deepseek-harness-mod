/**
 * Usage, Host half: a ledger of every billed model call read from the Session
 * logs, the DeepSeek account balance, and the token budgets the Usage page
 * edits. The browser reaches both through the `usage` Remote; budgets are
 * plain configuration the page writes through the settings service.
 */
import { isAbsolute, join } from 'node:path'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-session-query'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-launch-environment'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { DeepSeekBalance } from './balance.ts'
import { UsageLedger, type LedgerSource } from './ledger.ts'
import type { UsageBalance, UsageBudget, UsageView } from './types.ts'

export type * from './types.ts'
export type { UsageCall, UsageFoldState } from './fold.ts'
export type { LedgerLogger, LedgerSessionRecord, LedgerSource, UsageLedger } from './ledger.ts'
export type { BalanceOptions, DeepSeekBalance } from './balance.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    usage: UsageService
  }
}

/** Plugin name the Loader row addresses. */
export const name = 'usage'

/** The ledger reads Session logs through the query service. */
export const inject = ['sessionQuery']

/** Where the DeepSeek balance comes from. */
export interface DeepSeekSection {
  /** Credential the DeepSeek API route reads its key from. */
  readonly apiKeyEnv: string
  /** API origin. */
  readonly baseURL: string
}

/** Plugin configuration. */
export interface Config {
  /** Ledger file; a relative path resolves against the profile directory. */
  readonly ledgerFile: string
  /** DeepSeek balance source. */
  readonly deepseek: DeepSeekSection
  /** Token budgets keyed by provider route id, edited live on the Usage page. */
  readonly limits: Volatile<Record<string, UsageBudget>>
}

/** Runtime schema for {@link Config}. */
export const Config = z.object({
  ledgerFile: z.string().default('usage-ledger.json'),
  deepseek: z.object({
    apiKeyEnv: z.string().default('DEEPSEEK_API_KEY'),
    baseURL: z.string().default('https://api.deepseek.com'),
  }),
  // A dict, not an array: Settings edits only volatile fields, and the volatile array default does not survive.
  limits: z.dict(z.object({
    fiveHours: z.natural().min(1),
    week: z.natural().min(1),
    month: z.natural().min(1),
  })).default({}).volatile(),
})

/** Host Remote behind the Usage page. */
export class UsageService extends TypertRemoteService {
  /**
   * @param ctx - the plugin context.
   * @param ledger - call store read from the Session logs.
   * @param balanceSource - DeepSeek balance reader.
   */
  constructor(ctx: Context, private readonly ledger: UsageLedger, private readonly balanceSource: DeepSeekBalance) {
    super(ctx, 'usage')
  }

  /**
   * Read new Session events and sum the calls.
   * @param since - earliest call time the rows include, in epoch milliseconds.
   * @returns quarter-hour rows since then and rolling-window totals ending now.
   */
  @Remote
  async view(since: number): Promise<UsageView> {
    await this.ledger.refresh()
    return this.ledger.view(since)
  }

  /**
   * Read the DeepSeek account balance.
   * @returns the balance, or why it cannot be shown.
   */
  @Remote
  async balance(): Promise<UsageBalance> {
    return this.balanceSource.read()
  }
}

/**
 * Read the DeepSeek API key the way the DeepSeek route does: the credential
 * store when one is mounted, otherwise the launch environment.
 * @param ctx - plugin context.
 * @param name - credential reference name.
 * @returns the non-empty key, or undefined when none is configured.
 */
async function resolveApiKey(ctx: Context, name: string): Promise<string | undefined> {
  const credentials = ctx.get('credentials')
  // The store validates the reference name and rejects a malformed one.
  const launch = ctx.get('launchEnvironment')
  const value = credentials !== undefined
    ? (await credentials.resolve(name as CredentialRef))?.value
    : launch !== undefined ? launch.get(name)?.value : process.env[name]
  const key = value?.trim()
  return key === undefined || key.length === 0 ? undefined : key
}

/**
 * Mount the ledger and the balance reader behind the `usage` Remote.
 * @param ctx - plugin context.
 * @param config - parsed plugin Config.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  const directory = ctx.get('profileContext', false)?.dir ?? process.cwd()
  const file = isAbsolute(config.ledgerFile) ? config.ledgerFile : join(directory, config.ledgerFile)
  const source: LedgerSource = {
    listSessions: async () => (await ctx.sessionQuery.listSessions()).map(record => ({ id: record.header.id, live: record.live })),
    readSession: id => ctx.sessionQuery.readSession(id),
  }
  const ledger = new UsageLedger(source, file, { warn: (message) => { ctx.logger.warn(message) } })
  const balance = new DeepSeekBalance({
    baseURL: config.deepseek.baseURL,
    apiKey: () => resolveApiKey(ctx, config.deepseek.apiKeyEnv),
  })
  new UsageService(ctx, ledger, balance)
}
