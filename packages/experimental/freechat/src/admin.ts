/**
 * Free web chat administration as a Host Remote: the browser reads the routes
 * and thread rows and resets one thread through the authenticated Host
 * connection instead of calling the proxy's loopback admin routes, so the
 * proxy's bearer token never leaves the Host.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { FreeChatState, FreeChatThreadRow, ModelDescriptor } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    freechatAdmin: FreeChatAdmin
  }
}

/** The kernel and registry faces the administration reads. */
export interface FreeChatAdminSources {
  /** Current routes. */
  readonly models: () => readonly ModelDescriptor[]
  /** Current thread rows. */
  readonly threads: () => Promise<readonly FreeChatThreadRow[]>
  /** Close one thread's live web conversation; true when one was open. */
  readonly resetThread: (id: string) => Promise<boolean>
}

/** Host Remote behind the free web chat administration page. */
export class FreeChatAdmin extends TypertRemoteService {
  /**
   * @param ctx - the bridge's plugin context.
   * @param sources - kernel and registry reads the page needs.
   */
  constructor(ctx: Context, private readonly sources: FreeChatAdminSources) {
    super(ctx, 'freechatAdmin')
  }

  /**
   * Read the routes and thread rows.
   * @returns the playable routes and the known threads.
   */
  @Remote
  async state(): Promise<FreeChatState> {
    const models = this.sources.models().map(({ id, name, contextWindow, maxOutputTokens, reasoning }) => (
      { id, name, contextWindow, maxOutputTokens, reasoning }
    ))
    const threads = (await this.sources.threads()).map(({ id, generation, turns, updatedAt, live }) => (
      { id, generation, turns, updatedAt, live }
    ))
    return { models, threads }
  }

  /**
   * Drop one thread's live web conversation; its local memory stays.
   * @param id - sanitized thread id from {@link FreeChatState.threads}.
   * @returns whether a live conversation was closed.
   */
  @Remote
  async resetThread(id: string): Promise<{ closedSession: boolean }> {
    return { closedSession: await this.sources.resetThread(id) }
  }
}
