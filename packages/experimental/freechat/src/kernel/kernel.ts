/**
 * Turn kernel. One call takes an OpenAI-compatible request, decides whether the
 * live web session can take the delta or must be replaced, drives the
 * transport under a per-thread lock, converts the prompt-level tool protocol
 * back into structured calls, and commits the turn to local memory.
 */

import type {
  BridgeLogger,
  ChatCompletionRequest,
  ContextPolicy,
  KernelChunk,
  ModelDescriptor,
  NormalizedMessage,
  ThreadState,
  WebChatSession,
  WebChatTransport,
  WireMessage,
} from '../types.ts'
import { composeSystemPrompt } from '../tools/tool-catalog.ts'
import { ToolCallStreamParser, type ParserFrame } from '../tools/tool-parser.ts'
import { commitThreadState, estimateTokens, planSync, totalTokens } from './context-window.ts'
import { BridgeError } from './errors.ts'
import { contentText, normalizeHistory } from './messages.ts'
import type { ModelRegistry } from './model-registry.ts'
import { SessionLock } from './session-lock.ts'
import type { ThreadStore } from './thread-store.ts'
import { sanitizeThreadId } from './thread-store.ts'

/** One management row for the thread list a settings surface renders. */
export interface ThreadSnapshot {
  /** Sanitized local thread id. */
  readonly id: string
  /** Web-session generation the thread is on. */
  readonly generation: number
  /** Completed bridge turns on the current generation. */
  readonly turns: number
  /** ISO timestamp of the last committed turn, absent before the first commit. */
  readonly updatedAt: string | undefined
  /** Whether a live web conversation is bound to this thread right now. */
  readonly live: boolean
}

/** Answer text and tool-call count accumulated across one turn's frames. */
interface TurnTally {
  answer: string
  toolCalls: number
}

/**
 * Re-emit one parser frame as kernel chunks, tallying the answer and the calls.
 * @param frame - text and complete calls the parser released.
 * @param tally - the turn's running answer and call count.
 * @yields a text chunk when the frame carries text, then one chunk per call.
 */
function* frameChunks(frame: ParserFrame, tally: TurnTally): Generator<KernelChunk> {
  if (frame.text.length > 0) {
    tally.answer += frame.text
    yield { type: 'text', text: frame.text }
  }
  for (const call of frame.calls) {
    tally.toolCalls += 1
    yield { type: 'tool-call', id: call.id, name: call.name, arguments: call.arguments }
  }
}

/** One live conversation bound to a thread generation. */
interface LiveSession {
  readonly generation: number
  readonly session: WebChatSession
}

/** Collaborators the kernel resolves once at mount. */
export interface KernelOptions {
  /** Opens web-chat conversations. */
  readonly transport: WebChatTransport
  /** Playable model directory. */
  readonly registry: ModelRegistry
  /** Durable local thread memory. */
  readonly store: ThreadStore
  /** Rotation budgets. */
  readonly policy: ContextPolicy
  /** Diagnostic sink. */
  readonly logger: BridgeLogger
  /** Clock used for commit timestamps, injectable for tests. */
  readonly now?: (() => Date) | undefined
}

/**
 * The bridge's turn executor. It owns the live-session map, the per-thread
 * lock, and the persisted thread state; transports own nothing but one page.
 */
export class FreeChatKernel {
  private readonly options: KernelOptions
  private readonly lock = new SessionLock()
  private readonly live = new Map<string, LiveSession>()
  private closed = false

  /**
   * @param options - transport, registry, store, budgets, diagnostics.
   */
  constructor(options: KernelOptions) {
    this.options = options
  }

  /**
   * Execute one bridged turn and stream its frames.
   * @param request - OpenAI-compatible chat-completions request.
   * @param signal - cancellation of the upstream generation.
   * @returns text frames, tool-call frames, and one terminal finish frame.
   */
  async *complete(request: ChatCompletionRequest, signal?: AbortSignal): AsyncGenerator<KernelChunk> {
    if (this.closed) throw new BridgeError('freechat bridge is shutting down', 'UNAVAILABLE', 503)
    if (request.messages.length === 0) throw new BridgeError('messages must not be empty', 'INVALID_REQUEST', 400)
    await this.options.registry.ensureFresh()
    this.resolveModel(request.model)
    const threadId = sanitizeThreadId(request.user ?? 'default')
    const incoming = this.normalize(request)
    const release = await this.lock.acquire(threadId)
    const tally: TurnTally = { answer: '', toolCalls: 0 }
    try {
      const state = await this.options.store.load(threadId)
      const live = this.live.get(threadId)
      const plan = planSync(state, incoming, this.options.policy, live !== undefined)
      // planSync reuses only a live session, so a reuse plan always has one.
      const rotated = plan.kind === 'rotate' || live === undefined
      const session = rotated ? await this.rotate(threadId, live, state, signal) : live.session
      const prompted = plan.outgoing.map(message => message.text).join('\n\n')
      const parser = new ToolCallStreamParser()
      for await (const chunk of session.send(prompted, signal)) yield* frameChunks(parser.push(chunk), tally)
      yield* frameChunks(parser.finish(), tally)
      await this.commit(threadId, state, incoming, session.id, rotated, prompted, tally.answer)
      yield {
        type: 'finish',
        reason: tally.toolCalls > 0 ? 'tool_calls' : 'stop',
        usage: {
          prompt_tokens: totalTokens(incoming),
          completion_tokens: estimateTokens(tally.answer),
          total_tokens: totalTokens(incoming) + estimateTokens(tally.answer),
        },
      }
    } catch (error) {
      this.live.delete(threadId)
      this.options.logger.error(`freechat: turn failed for thread ${threadId}`, error)
      if (error instanceof BridgeError) throw error
      if (signal?.aborted === true) throw new BridgeError('generation aborted', 'UNAVAILABLE', 499)
      throw new BridgeError(
        `web chat transport failed: ${error instanceof Error ? error.message : String(error)}`,
        'TRANSPORT_FAILED',
        502,
      )
    } finally {
      release()
    }
  }

  /**
   * Drop the live conversation of one thread without touching its durable history.
   * The next turn rotates, because a fresh web session cannot continue an old one.
   * @param key - caller conversation key, or the sanitized thread id.
   * @returns whether a live session was closed.
   */
  async resetThread(key: string): Promise<boolean> {
    const id = sanitizeThreadId(key)
    const live = this.live.get(id)
    this.live.delete(id)
    if (live === undefined) return false
    await live.session.close()
    return true
  }

  /**
   * Management rows for every known thread: persisted index entries plus live
   * conversations that have not committed a turn yet.
   * @returns one row per thread, most recent activity first.
   */
  async snapshots(): Promise<ThreadSnapshot[]> {
    const index = await this.options.store.list()
    const rows = new Map<string, ThreadSnapshot>()
    for (const [id, entry] of Object.entries(index)) {
      rows.set(id, {
        id,
        generation: entry.generation,
        turns: entry.turns,
        updatedAt: entry.updatedAt,
        live: this.live.has(id),
      })
    }
    for (const [id, conversation] of this.live) {
      const existing = rows.get(id)
      rows.set(id, {
        id,
        generation: existing?.generation ?? conversation.generation,
        turns: existing?.turns ?? 0,
        updatedAt: existing?.updatedAt,
        live: true,
      })
    }
    const activity = (row: ThreadSnapshot): string => row.updatedAt ?? ''
    return [...rows.values()].sort((left, right) => activity(right).localeCompare(activity(left)))
  }

  /** Close every live conversation; the plugin's disposer awaits this. */
  async dispose(): Promise<void> {
    this.closed = true
    const sessions = [...this.live.values()]
    this.live.clear()
    await Promise.allSettled(sessions.map(entry => entry.session.close()))
  }

  /** Resolve the requested route, refusing a model the web account cannot play. */
  private resolveModel(requested: string | undefined): ModelDescriptor {
    const model = this.options.registry.resolve(requested)
    if (model === undefined) {
      throw new BridgeError(
        // An absent id resolves to the default route, so only a named id can be unknown.
        `unknown model "${String(requested)}"; ask GET /v1/models for the playable routes`,
        'MODEL_NOT_FOUND',
        400,
      )
    }
    return model
  }

  /** Replace the live session with a fresh web conversation. */
  private async rotate(
    threadId: string,
    live: LiveSession | undefined,
    state: ThreadState | undefined,
    signal?: AbortSignal,
  ): Promise<WebChatSession> {
    this.live.delete(threadId)
    if (live !== undefined) await live.session.close()
    const session = await this.options.transport.open(signal)
    this.live.set(threadId, { generation: (state?.generation ?? 0) + 1, session })
    return session
  }

  /** Commit one successful turn; a storage failure drops the live session so the next turn restores. */
  private async commit(
    threadId: string,
    state: ThreadState | undefined,
    incoming: readonly NormalizedMessage[],
    webSessionId: string,
    rotated: boolean,
    prompt: string,
    answer: string,
  ): Promise<void> {
    const now = (this.options.now?.() ?? new Date()).toISOString()
    const committed = commitThreadState(state, incoming, this.options.policy, webSessionId, rotated, now)
    try {
      await this.options.store.commit({ ...committed, id: threadId }, prompt, answer)
    } catch (error) {
      this.options.logger.error(`freechat: could not persist thread ${threadId}`, error)
      this.live.delete(threadId)
    }
  }

  /** Flatten the caller history, composing the tool protocol into the system contract. */
  private normalize(request: ChatCompletionRequest): NormalizedMessage[] {
    const systemText = request.messages
      .filter(message => message.role === 'system')
      .map(message => contentText(message.content))
      .filter(text => text.length > 0)
      .join('\n\n')
    const composed = composeSystemPrompt(systemText, request.tools ?? [])
    const messages: WireMessage[] = composed.length > 0 ? [{ role: 'system', content: composed }] : []
    for (const message of request.messages) {
      if (message.role !== 'system') messages.push(message)
    }
    return normalizeHistory(messages, this.options.policy.maxCharsPerMessage)
  }
}
