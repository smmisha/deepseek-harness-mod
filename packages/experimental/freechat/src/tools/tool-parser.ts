/**
 * Streaming reader for the prompt-level tool protocol. It splits an upstream
 * answer into visible text and complete tool calls while tolerating chunk
 * boundaries that cut a tag in half, which is what makes SSE delivery possible.
 */

import { randomUUID } from 'node:crypto'
import type { ParsedToolCall } from '../types.ts'

/** Opening token; the parser holds back any suffix that could still become one. */
const OPEN_TAG = '<tool_call'
/** Closing token of one call block. */
const CLOSE_TAG = '</tool_call>'
/** Upper bound on text buffered while a call block stays unclosed. */
const MAX_PENDING_CHARS = 1_000_000

/** One parser output frame. */
export interface ParserFrame {
  /** Visible answer text that is safe to stream now. */
  readonly text: string
  /** Calls completed by this frame. */
  readonly calls: readonly ParsedToolCall[]
}

/** The empty frame every path starts from. */
const EMPTY_FRAME: ParserFrame = { text: '', calls: [] }

/**
 * Length of the longest suffix of `buffer` that is a proper prefix of the open
 * token. Everything before that offset can stream as visible text.
 * @param buffer - buffered tail.
 * @returns the offset of the first byte that must wait.
 */
function safeBoundary(buffer: string): number {
  for (let length = OPEN_TAG.length - 1; length > 0; length -= 1) {
    if (buffer.endsWith(OPEN_TAG.slice(0, length))) return buffer.length - length
  }
  return buffer.length
}

/**
 * Read one attribute from a call block's opening tag.
 * @param attributes - text between the tag name and `>`.
 * @param key - attribute name the parser accepts.
 * @returns the attribute value, or undefined when it is absent.
 */
function attributeValue(attributes: string, key: string): string | undefined {
  const match = new RegExp(`${key}\\s*=\\s*"([^"]*)"`, 'u').exec(attributes)
  return match?.[1]
}

/**
 * Turn one complete block into a call.
 * @param block - text from the opening token through the closing token.
 * @returns the parsed call, or undefined when the block does not declare a name.
 */
function parseCallBlock(block: string): ParsedToolCall | undefined {
  // A complete block ends with the closing tag, so its first `>` always exists.
  const openEnd = block.indexOf('>')
  const name = attributeValue(block.slice(OPEN_TAG.length, openEnd), 'name')
  if (name === undefined || name.length === 0) return undefined
  const id = attributeValue(block.slice(OPEN_TAG.length, openEnd), 'id') ?? `call_${randomUUID().slice(0, 8)}`
  const body = block.slice(openEnd + 1, block.length - CLOSE_TAG.length).trim()
  return { id, name, arguments: body.length === 0 ? '{}' : body }
}

/**
 * Incremental parser for one upstream answer.
 *
 * Feed every transport chunk to {@link push} and flush with {@link finish}.
 * Text that cannot yet be classified stays buffered, so no partial tag ever
 * reaches the caller as visible content.
 */
export class ToolCallStreamParser {
  private buffer = ''

  /**
   * Consume one upstream chunk.
   * @param chunk - raw answer text.
   * @returns visible text and completed calls that this chunk finished.
   */
  push(chunk: string): ParserFrame {
    this.buffer += chunk
    if (this.buffer.length > MAX_PENDING_CHARS) {
      const overflow = this.buffer
      this.buffer = ''
      return { text: overflow, calls: [] }
    }
    return this.drain(false)
  }

  /**
   * Flush the parser at end of stream. An unclosed block is emitted as visible
   * text so a truncated answer is never silently dropped.
   * @returns the remaining text and calls.
   */
  finish(): ParserFrame {
    return this.drain(true)
  }

  private drain(final: boolean): ParserFrame {
    let text = ''
    const calls: ParsedToolCall[] = []
    for (;;) {
      const open = this.buffer.indexOf(OPEN_TAG)
      if (open === -1) {
        const boundary = final ? this.buffer.length : safeBoundary(this.buffer)
        text += this.buffer.slice(0, boundary)
        this.buffer = this.buffer.slice(boundary)
        break
      }
      text += this.buffer.slice(0, open)
      this.buffer = this.buffer.slice(open)
      const close = this.buffer.indexOf(CLOSE_TAG)
      if (close === -1) {
        if (!final) break
        text += this.buffer
        this.buffer = ''
        break
      }
      const block = this.buffer.slice(0, close + CLOSE_TAG.length)
      this.buffer = this.buffer.slice(close + CLOSE_TAG.length)
      const call = parseCallBlock(block)
      if (call === undefined) text += block
      else calls.push(call)
    }
    if (text.length === 0 && calls.length === 0) return EMPTY_FRAME
    return { text, calls }
  }
}

/**
 * Parse every call from a complete answer, for non-streaming callers.
 * @param answer - full answer text.
 * @returns the parsed calls in emission order.
 */
export function parseToolCalls(answer: string): ParsedToolCall[] {
  const parser = new ToolCallStreamParser()
  const first = parser.push(answer)
  const last = parser.finish()
  return [...first.calls, ...last.calls]
}
