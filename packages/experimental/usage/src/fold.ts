/**
 * Fold raw Session events into billed calls. The rules match token-meter's
 * `tokenUsage` projection: each Assistant settlement contributes the last usage
 * sample of its attempt, a later sample of the same attempt replaces the
 * earlier one, and `llm/retry-started` opens a new attempt. The provider and
 * model are the ones the latest `request/context` named. Raw events are read,
 * not the conversation surface, so turns a rewind retracted still count.
 */
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { UsageTokens } from './types.ts'

/** One billed attempt. */
export interface UsageCall extends UsageTokens {
  /** `turn:step:attempt`, unique within one Session. */
  readonly key: string
  /** Settlement time in epoch milliseconds. */
  readonly time: number
  /** Provider route id. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
}

/** Fold state carried between incremental reads of one Session. */
export interface UsageFoldState {
  /** Provider of the latest request context. */
  readonly provider: string
  /** Model of the latest request context. */
  readonly model: string
  /** The attempt counter of the latest retried turn and step. */
  readonly retry: { readonly turn: number; readonly step: number; readonly count: number } | null
}

/** State before a Session's first event. */
export const INITIAL_FOLD: UsageFoldState = { provider: '', model: '', retry: null }

const count = (value: number | undefined): number => (Number.isSafeInteger(value) && value !== undefined && value > 0 ? value : 0)

/** The usage one settlement reports for its attempt, if any. */
function usageOf(event: SessionEvent): TokenUsage | undefined {
  if (event.type === 'assistant/message' && event.data.usage !== undefined) return event.data.usage
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
  // The last usage chunk of the stream, as dsh-llm's `lastAssistantStreamChunk` finds it; read here
  // so the package keeps dsh-llm a type-only dependency.
  for (const record of event.data.stream.toReversed()) {
    if (record.type === 'chunk' && record.chunk.type === 'usage') return record.chunk.usage
  }
  return undefined
}

/**
 * Fold events, oldest first, into one call per billed attempt.
 * @param events - consecutive raw events of one Session.
 * @param from - state left by the previous fold of the same Session.
 * @returns the calls keyed by attempt, and the state to resume from.
 */
export function foldUsage(events: readonly SessionEvent[], from: UsageFoldState = INITIAL_FOLD): {
  readonly calls: readonly UsageCall[]
  readonly state: UsageFoldState
} {
  let state = from
  const calls = new Map<string, UsageCall>()
  for (const event of events) {
    if (event.type === 'request/context') {
      state = { ...state, provider: event.data.provider, model: event.data.model }
      continue
    }
    if (event.type === 'llm/retry-started') {
      const { turn, step } = event.data
      const previous = state.retry
      const attempts = previous?.turn === turn && previous.step === step ? previous.count + 1 : 1
      state = { ...state, retry: { turn, step, count: attempts } }
      continue
    }
    const usage = usageOf(event)
    if (usage === undefined || (event.type !== 'assistant/message' && event.type !== 'assistant/attempt')) continue
    const { turn, step } = event.data
    const attempt = state.retry?.turn === turn && state.retry.step === step ? state.retry.count : 0
    const key = `${turn}:${step}:${attempt}`
    calls.set(key, {
      key,
      time: event.time,
      provider: state.provider,
      model: state.model,
      input: count(usage.inputTokens),
      cacheRead: count(usage.cacheReadTokens),
      cacheWrite: count(usage.cacheWriteTokens),
      output: count(usage.outputTokens),
    })
  }
  return { calls: [...calls.values()], state }
}

/**
 * Total tokens of one call or row, the unit limits count.
 * @param tokens - token buckets.
 * @returns prompt, cache, and completion tokens together.
 */
export function totalTokens(tokens: UsageTokens): number {
  return tokens.input + tokens.cacheRead + tokens.cacheWrite + tokens.output
}
