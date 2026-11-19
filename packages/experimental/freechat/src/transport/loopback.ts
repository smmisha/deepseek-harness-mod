/**
 * Deterministic in-memory transport. It is the default in tests and the
 * default `loopback` transport kind, so the proxy, the rotation planner, and
 * the stream encoder can be exercised without a signed-in browser.
 */

import type { WebChatSession, WebChatTransport } from '../types.ts'

/** One answer, either already whole or split into streaming chunks. */
export type LoopbackAnswer = string | readonly string[]

/**
 * Produces the answer for one prompt.
 * @param prompt - prompt delivered to the scripted conversation.
 * @param sessionIndex - zero-based index of the conversation that received it.
 * @returns the answer text, whole or chunked.
 */
export type LoopbackScript = (prompt: string, sessionIndex: number) => LoopbackAnswer

/** One scripted conversation, keeping its prompts for assertions. */
export class LoopbackSession implements WebChatSession {
  readonly id: string
  readonly prompts: string[] = []
  closed = false

  /**
   * @param index - zero-based conversation number, used for the id.
   * @param script - answer producer.
   * @param chunkDelayMs - delay between yielded chunks.
   */
  constructor(
    private readonly index: number,
    private readonly script: LoopbackScript,
    private readonly chunkDelayMs: number,
  ) {
    this.id = `loopback-${index}`
  }

  async *send(prompt: string, signal?: AbortSignal): AsyncIterable<string> {
    this.prompts.push(prompt)
    if (this.closed) throw new Error('freechat: loopback session is closed')
    const answer = this.script(prompt, this.index)
    const chunks = typeof answer === 'string' ? [answer] : answer
    for (const chunk of chunks) {
      if (signal?.aborted === true) throw new Error('freechat: generation aborted')
      if (this.chunkDelayMs > 0) await new Promise(resolve => setTimeout(resolve, this.chunkDelayMs))
      yield chunk
    }
  }

  close(): Promise<void> {
    this.closed = true
    return Promise.resolve()
  }
}

/** Scripted transport that records every conversation it opened. */
export class LoopbackTransport implements WebChatTransport {
  readonly sessions: LoopbackSession[] = []

  /**
   * @param script - answer producer, called once per delivered prompt.
   * @param chunkDelayMs - delay between chunks, so streaming assertions can observe frames.
   */
  constructor(private readonly script: LoopbackScript, private readonly chunkDelayMs = 0) {}

  open(): Promise<WebChatSession> {
    const session = new LoopbackSession(this.sessions.length, this.script, this.chunkDelayMs)
    this.sessions.push(session)
    return Promise.resolve(session)
  }
}
