/**
 * Wire-to-domain message normalization: one deterministic text projection and
 * fingerprint per message, so the same caller history always produces the
 * same prefix diff and the same replayed text.
 */

import { createHash } from 'node:crypto'
import type { NormalizedMessage, WireContentPart, WireMessage } from '../types.ts'

/** Marker appended to one clamped message; the model reads it as an explicit omission. */
const TRUNCATION_MARKER = '\n…[truncated]'

/**
 * Flatten OpenAI message content to text. Multi-part arrays keep only text
 * parts: the web chat accepts typed text, and a non-text part is carried by its
 * `text` projection rather than by a transport-specific attachment grammar.
 * @param content - string, content-part array, or null.
 * @returns the message text.
 */
export function contentText(content: WireMessage['content']): string {
  if (content === null || content === undefined) return ''
  if (typeof content === 'string') return content
  return content
    .map((part: WireContentPart) => part.text ?? '')
    .filter(part => part.length > 0)
    .join('\n')
}

/**
 * Clamp one message before it enters prompt accounting, so a single large paste
 * cannot consume a web session on its own.
 * @param text - message text.
 * @param maxChars - positive character budget.
 * @returns the text unchanged, or its prefix plus an omission marker.
 */
export function clampText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}${TRUNCATION_MARKER}`
}

/**
 * Stable digest of one message's role and text. Wall-clock data never enters
 * the digest, so replaying the same history yields the same fingerprints.
 * @param role - message role.
 * @param text - normalized text.
 * @returns a short hexadecimal digest.
 */
export function fingerprint(role: string, text: string): string {
  return createHash('sha256').update(role).update('\u0000').update(text).digest('hex').slice(0, 24)
}

/**
 * Render one tool result the way the prompt-level protocol expects it. The tag
 * names the tool and the call id so the model can match a result to the call
 * it made, and the body stays verbatim.
 * @param callId - id of the call this result answers.
 * @param toolName - name declared by the offered schema, when the caller sent it.
 * @param text - result text.
 * @returns the model-facing tool-result block.
 */
export function renderToolResult(callId: string, toolName: string | undefined, text: string): string {
  const name = toolName === undefined || toolName.length === 0 ? 'unknown' : toolName
  return `<tool_result call_id="${callId}" name="${name}">\n${text}\n</tool_result>`
}

/**
 * Render one assistant tool call the way it is replayed into a rotated session,
 * so the model sees why the following result exists.
 * @param callId - id the call was issued with.
 * @param name - tool name.
 * @param args - raw JSON argument text.
 * @returns the model-facing tool-call block.
 */
export function renderToolCall(callId: string, name: string, args: string): string {
  return `<tool_call id="${callId}" name="${name}">${args}</tool_call>`
}

/**
 * Project one wire message onto the bridge's normalized form.
 * @param message - caller message.
 * @param maxChars - per-message clamp applied to the projected text.
 * @returns the normalized message.
 */
export function normalizeMessage(message: WireMessage, maxChars: number): NormalizedMessage {
  const body = clampText(contentText(message.content), maxChars)
  const text = message.role === 'tool'
    ? renderToolResult(message.tool_call_id ?? '', message.name, body)
    : message.role === 'assistant' && message.tool_calls !== undefined && message.tool_calls.length > 0
      ? [
        body,
        ...message.tool_calls.map(call => renderToolCall(call.id ?? '', call.function.name, call.function.arguments)),
      ].filter(part => part.length > 0).join('\n\n')
      : body
  return { role: message.role, text, fingerprint: fingerprint(message.role, text) }
}

/**
 * Project a whole caller history, dropping messages whose projection is empty
 * so a blank assistant turn cannot shift every following fingerprint.
 * @param messages - caller history.
 * @param maxChars - per-message clamp.
 * @returns normalized messages in caller order.
 */
export function normalizeHistory(messages: readonly WireMessage[], maxChars: number): NormalizedMessage[] {
  return messages
    .map(message => normalizeMessage(message, maxChars))
    .filter(message => message.text.length > 0)
}
