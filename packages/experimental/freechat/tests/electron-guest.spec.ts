import { describe, expect, it } from 'vitest'
import { DEFAULT_GUEST_SELECTORS, ElectronGuestTransport } from '../src/transport/electron-guest.ts'
import type { GuestPort } from '../src/types.ts'

/** Snapshot the fake page reports on one poll. */
interface Step {
  readonly streaming: boolean
  readonly text: string
  /** Rendered assistant nodes, counting the two nodes the site uses per answer. */
  readonly count: number
}

/** Port that replays a fixed sequence of rendered answers. */
function portWith(steps: readonly Step[]): GuestPort {
  let step = 0
  return {
    async evaluate<T>(script: string): Promise<T> {
      if (script.includes('const messages')) {
        const current = steps[Math.min(step, steps.length - 1)]!
        step += 1
        return { streaming: current.streaming, text: current.text, count: current.count } as T
      }
      if (script.includes('const value')) return { ok: true } as T
      if (script.includes('composer')) return true as T
      return { ok: true } as T
    },
  }
}

/** Collect one answer from the transport. */
async function collect(steps: readonly Step[]): Promise<string> {
  const transport = new ElectronGuestTransport({
    port: portWith(steps),
    selectors: DEFAULT_GUEST_SELECTORS,
    pollMs: 1,
    idlePolls: 2,
    readyTimeoutMs: 100,
    answerTimeoutMs: 5_000,
  })
  const session = await transport.open()
  let answer = ''
  for await (const chunk of session.send('prompt')) answer += chunk
  await session.close()
  return answer
}

describe('ElectronGuestTransport', () => {
  it('reads a new answer instead of replaying the previous one', async () => {
    const answer = await collect([
      { streaming: true, text: 'OLD', count: 2 },
      { streaming: true, text: '', count: 4 },
      { streaming: true, text: 'NEW', count: 4 },
      { streaming: false, text: 'NEW', count: 4 },
      { streaming: false, text: 'NEW', count: 4 },
    ])
    expect(answer).toBe('NEW')
  })

  it('waits through a cleared message list for the next answer', async () => {
    const answer = await collect([
      { streaming: true, text: 'OLD', count: 2 },
      { streaming: true, text: '', count: 2 },
      { streaming: false, text: '', count: 2 },
      { streaming: true, text: 'NEW', count: 4 },
      { streaming: false, text: 'NEW', count: 4 },
      { streaming: false, text: 'NEW', count: 4 },
    ])
    expect(answer).toBe('NEW')
  })

  it('streams an answer that grows from an empty composer', async () => {
    const answer = await collect([
      { streaming: true, text: '', count: 0 },
      { streaming: true, text: 'HEL', count: 2 },
      { streaming: true, text: 'HELLO', count: 2 },
      { streaming: false, text: 'HELLO', count: 2 },
      { streaming: false, text: 'HELLO', count: 2 },
    ])
    expect(answer).toBe('HELLO')
  })
})

/** Port whose new-chat, composer, and submit answers a test chooses. */
function scriptedPort(options: { newChat?: boolean; composer?: readonly boolean[]; submitted?: boolean } = {}): GuestPort {
  const composer = [...(options.composer ?? [true])]
  return {
    evaluate<T>(script: string): Promise<T> {
      if (script.includes('const messages')) return Promise.resolve({ streaming: true, text: 'same', count: 2 } as T)
      if (script.includes('const value')) return Promise.resolve({ ok: options.submitted ?? true } as T)
      if (script.includes('!== null') && !script.includes('const button')) {
        return Promise.resolve((composer.length > 1 ? composer.shift() : composer[0]) as T)
      }
      return Promise.resolve({ ok: options.newChat ?? true } as T)
    },
  }
}

function transportOf(port: GuestPort, overrides: Partial<{ readyTimeoutMs: number; answerTimeoutMs: number }> = {}) {
  return new ElectronGuestTransport({ port, pollMs: 1, idlePolls: 2, readyTimeoutMs: 1_000, answerTimeoutMs: 5_000, ...overrides })
}

async function drain(stream: AsyncIterable<string>): Promise<void> {
  for await (const chunk of stream) void chunk
}

describe('ElectronGuestTransport failures', () => {
  it('refuses an aborted open and waits for the composer when the site has no new-chat control', async () => {
    const aborted = new AbortController()
    aborted.abort()
    await expect(transportOf(scriptedPort()).open(aborted.signal)).rejects.toThrow('guest open aborted')
    const session = await transportOf(scriptedPort({ newChat: false, composer: [false, true] })).open()
    expect(session.id).toBe('guest-1')
    await expect(transportOf(scriptedPort({ newChat: false, composer: [false] }), { readyTimeoutMs: 150 }).open())
      .rejects.toThrow('never rendered a composer')
  })

  it('refuses a closed session, a rejected prompt, an aborted generation, and a stalled answer', async () => {
    const closed = await transportOf(scriptedPort()).open()
    await closed.close()
    await expect(drain(closed.send('x'))).rejects.toThrow('guest session is closed')
    await expect(drain((await transportOf(scriptedPort({ submitted: false })).open()).send('x'))).rejects.toThrow('refused the prompt')
    const aborted = new AbortController()
    aborted.abort()
    await expect(drain((await transportOf(scriptedPort()).open()).send('x', aborted.signal))).rejects.toThrow('generation aborted')
    await expect(drain((await transportOf(scriptedPort(), { answerTimeoutMs: 20 }).open()).send('x'))).rejects.toThrow('answer timed out')
  })
})
