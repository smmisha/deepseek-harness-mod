/**
 * Stateless context substitution: decide, for every caller history, whether the
 * live web session can take the delta or must be replaced. Pure functions only —
 * the caller owns transports, locks, and persistence.
 */

import type { ContextPolicy, NormalizedMessage, OutgoingMessage, RotationReason, SyncPlan, ThreadState } from '../types.ts'
import { renderToolResult } from './messages.ts'

/** Heuristic characters per token for English and code. Documented, not measured. */
const CHARS_PER_TOKEN = 4

/** Prompt sent when the caller repeats history the live session already holds unchanged. */
const CONTINUE_PROMPT = 'Continue from your last message.'

/** Prompt clause that explains why the following transcript is replayed. */
const ROTATION_NOTICE = 'The earlier conversation was reset. The transcript below is the authoritative history; treat it as already spoken.'

/**
 * Estimate the token cost of one text with the bridge's documented heuristic.
 * Rotation budgets compare estimates, so a stable heuristic is what matters, not
 * accuracy against any particular tokenizer.
 * @param text - text to size.
 * @returns a non-negative estimated token count.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * Length of the longest common prefix of two fingerprint sequences.
 * @param left - already-delivered fingerprints.
 * @param right - caller fingerprints.
 * @returns the index of the first difference.
 */
export function commonPrefixLength(left: readonly string[], right: readonly string[]): number {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left[index] === right[index]) index += 1
  return index
}

/**
 * Sum one message list into the accounting unit the policy caps.
 * @param messages - normalized messages.
 * @returns the estimated token total.
 */
export function totalTokens(messages: readonly NormalizedMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateTokens(message.text), 0)
}

/** Join one delta into the single web-chat prompt a send consumes. */
function joinPrompt(messages: readonly NormalizedMessage[]): string {
  return messages.map(message => message.text).join('\n\n')
}

/**
 * Render the replacement-session preamble: the caller's system contract, a
 * compacted digest of everything older than the replay tail, and the newest
 * messages verbatim. One prompt, so one web-chat message carries the whole
 * restoration.
 * @param incoming - full caller history.
 * @param policy - replay tail length.
 * @returns the restored-context prompt.
 */
export function buildRotationPrompt(incoming: readonly NormalizedMessage[], policy: ContextPolicy): string {
  const system = incoming.filter(message => message.role === 'system')
  const conversation = incoming.filter(message => message.role !== 'system')
  const keep = Math.max(1, Math.min(policy.replayTail, conversation.length))
  const older = conversation.slice(0, Math.max(0, conversation.length - keep))
  const recent = conversation.slice(conversation.length - keep)
  const digest = older
    .map((message) => {
      const newline = message.text.indexOf('\n')
      const firstLine = newline < 0 ? message.text : message.text.slice(0, newline)
      const head = firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine
      return `- ${message.role}: ${head}`
    })
    .join('\n')
  const sections: string[] = [ROTATION_NOTICE]
  if (system.length > 0) {
    sections.push(`<instructions>\n${system.map(message => message.text).join('\n\n')}\n</instructions>`)
  }
  if (digest.length > 0) {
    sections.push(`<earlier_conversation>\n${digest}\n</earlier_conversation>`)
  }
  sections.push(`<recent_conversation>\n${recent.map(message => message.text).join('\n\n')}\n</recent_conversation>`)
  return sections.join('\n\n')
}

/** Build the rotation plan for a history that no live session can continue. */
function rotate(reason: RotationReason, incoming: readonly NormalizedMessage[], policy: ContextPolicy): SyncPlan {
  return { kind: 'rotate', reason, outgoing: [{ text: buildRotationPrompt(incoming, policy) }] satisfies OutgoingMessage[] }
}

/**
 * Decide how one caller history reaches the web chat.
 *
 * A live session continues when the caller history extends exactly the history
 * already delivered; anything else — compaction, an edited message, a switched
 * conversation — is divergence and rotates. The plan never mutates the state it
 * reads, so a failed send leaves the previous generation intact.
 * @param state - current thread state, absent on the first turn.
 * @param incoming - normalized caller history.
 * @param policy - message and token budgets.
 * @param liveSession - whether a web session for this thread is still open; a
 *   durable state without one cannot be continued and must rotate.
 * @returns the plan the kernel executes.
 */
export function planSync(
  state: ThreadState | undefined,
  incoming: readonly NormalizedMessage[],
  policy: ContextPolicy,
  liveSession = true,
): SyncPlan {
  if (state === undefined) {
    // Nothing has been spoken yet, so there is no history to restore. Sending the
    // messages themselves keeps the first web-chat turn readable; the XML
    // restoration envelope is only meaningful once a conversation exists.
    return { kind: 'rotate', reason: 'first-turn', outgoing: incoming.map(message => ({ text: message.text })) }
  }
  if (!liveSession) return rotate('diverged', incoming, policy)
  const shared = commonPrefixLength(state.synced, incoming.map(message => message.fingerprint))
  if (shared < state.synced.length) return rotate('diverged', incoming, policy)
  const delta = incoming.slice(shared)
  if (delta.length === 0) {
    return { kind: 'reuse', outgoing: [{ text: CONTINUE_PROMPT }] }
  }
  const nextTokens = state.tokens + totalTokens(delta)
  if (state.synced.length + delta.length > policy.maxMessages) return rotate('message-limit', incoming, policy)
  if (nextTokens > policy.maxTokens) return rotate('overflow', incoming, policy)
  // An assistant message in the delta is the web chat's own previous answer
  // echoed back by the caller; typing it again would read as a duplicate turn.
  const outgoing = delta.filter(message => message.role !== 'assistant')
  if (outgoing.length === 0) return { kind: 'reuse', outgoing: [{ text: CONTINUE_PROMPT }] }
  return { kind: 'reuse', outgoing: [{ text: joinPrompt(outgoing) }] }
}

/**
 * Produce the state a successful turn commits.
 * @param previous - state before the turn, absent on the first turn.
 * @param incoming - caller history sent to the web chat.
 * @param policy - message and token budgets.
 * @param webSessionId - session that served the turn.
 * @param rotated - whether the plan replaced the session.
 * @param now - ISO timestamp of the commit.
 * @returns the committed thread state.
 */
export function commitThreadState(
  previous: ThreadState | undefined,
  incoming: readonly NormalizedMessage[],
  policy: ContextPolicy,
  webSessionId: string,
  rotated: boolean,
  now: string,
): ThreadState {
  const tokens = Math.min(totalTokens(incoming), policy.maxTokens)
  return {
    id: previous?.id ?? 'thread',
    generation: rotated ? (previous?.generation ?? 0) + 1 : (previous?.generation ?? 1),
    webSessionId,
    synced: incoming.map(message => message.fingerprint),
    tokens,
    turns: (previous?.turns ?? 0) + 1,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  }
}

/**
 * Render one tool result into the text a follow-up prompt carries. Exposed here
 * because both the planner and the kernel render results through one function.
 * @param callId - id of the answered call.
 * @param toolName - tool name, when known.
 * @param text - result text.
 * @returns the model-facing block.
 */
export function toolResultPrompt(callId: string, toolName: string | undefined, text: string): string {
  return renderToolResult(callId, toolName, text)
}
