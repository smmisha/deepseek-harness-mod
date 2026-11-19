/** Free web chat administration Remote: projected route and thread rows, and thread reset. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { FreeChatAdmin } from '../src/admin.ts'

describe('FreeChatAdmin', () => {
  it('projects only the page fields of routes and threads, and resets one thread', async () => {
    const resetThread = vi.fn((id: string) => Promise.resolve(id === 'open'))
    const admin = new FreeChatAdmin(new Context(), {
      models: () => [{ id: 'free', name: 'Free', contextWindow: 128000, maxOutputTokens: 8192, reasoning: true, extra: 1 } as never],
      threads: () => Promise.resolve([{ id: 'a', generation: 2, turns: 3, updatedAt: undefined, live: false, extra: 1 } as never]),
      resetThread,
    })
    expect(await admin.state()).toEqual({
      models: [{ id: 'free', name: 'Free', contextWindow: 128000, maxOutputTokens: 8192, reasoning: true }],
      threads: [{ id: 'a', generation: 2, turns: 3, updatedAt: undefined, live: false }],
    })
    expect(await admin.resetThread('open')).toEqual({ closedSession: true })
    expect(await admin.resetThread('closed')).toEqual({ closedSession: false })
    expect(resetThread.mock.calls).toEqual([['open'], ['closed']])
  })
})
