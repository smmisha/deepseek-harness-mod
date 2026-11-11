/**
 * External-browser fallback: the site's own user-token envelope decides when the
 * attempt is complete, and the payload carries exactly the cookies and storage
 * entries the chat needs.
 */
import { describe, expect, it } from 'vitest'
import {
  ChatLoginBrowserError,
  ChatLoginTimeoutError,
  ChatLoginWindowOpenError,
  awaitChatLogin,
  deepseekCookies,
  retryDevToolsConnection,
  selectChatTargets,
  toCookieDetails,
  userTokenValue,
  type ChatLoginSession,
} from '../src/chat-login-browser.ts'

const COOKIE = {
  name: 'ds_session_id',
  value: 'abc',
  domain: '.deepseek.com',
  path: '/',
  secure: true,
  httpOnly: true,
} as const

/** Let pending microtasks settle. */
async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

/** Sentinel that makes the next token read throw. */
const THROW = Symbol('throw')

/** A session whose token answers follow a fixed timeline. */
function fakeSession(answers: readonly (string | null | typeof THROW)[], closed = false): ChatLoginSession {
  let index = 0
  return {
    get closed() { return closed },
    async readToken() {
      const answer = answers[Math.min(index++, answers.length - 1)] ?? null
      if (answer === THROW) throw new Error('execution context destroyed')
      return answer
    },
    async readPayload() {
      return { cookies: [COOKIE], storage: { userToken: 'token' } }
    },
    close() {},
  }
}

describe('userTokenValue', () => {
  it('reads the non-empty value out of the site envelope', () => {
    expect(userTokenValue(JSON.stringify({ __version: '1', value: 'token' }))).toBe('token')
  })

  it('treats a missing, signed-out, or malformed envelope as signed out', () => {
    expect(userTokenValue(null)).toBeNull()
    expect(userTokenValue(JSON.stringify({ __version: '1', value: null }))).toBeNull()
    expect(userTokenValue(JSON.stringify({ __version: '1', value: '' }))).toBeNull()
    expect(userTokenValue('{not-json}')).toBeNull()
    expect(userTokenValue('null')).toBeNull()
  })
})

describe('awaitChatLogin', () => {
  it('does not finish while the site has no user token', async () => {
    let release: (() => void) | undefined
    let now = 0
    const session = fakeSession([null, 'token', 'token'])
    const promise = awaitChatLogin(session, {
      timeoutMs: 60_000,
      pollMs: 1_000,
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds
        await new Promise<void>((resolve) => { release = resolve })
      },
    })
    let settled = false
    void promise.then(() => { settled = true })
    await flush()
    expect(settled).toBe(false)
    release?.()
    await flush()
    release?.()
    await flush()
    expect(settled).toBe(true)
    await expect(promise).resolves.toBe(true)
  })

  it('treats an evaluate failure during navigation as not signed in yet', async () => {
    await expect(awaitChatLogin(fakeSession([THROW, THROW, 'token', 'token']), {
      timeoutMs: 60_000, pollMs: 1_000, now: () => 0, sleep: async () => {},
    })).resolves.toBe(true)
  })

  it('waits for two identical token readings', async () => {
    const answers = ['first', 'second', 'second']
    await expect(awaitChatLogin(fakeSession(answers), {
      timeoutMs: 60_000, pollMs: 1_000, now: () => 0, sleep: async () => {},
    })).resolves.toBe(true)
  })

  it('returns false when the reader closes the browser process', async () => {
    await expect(awaitChatLogin(fakeSession([null], true), {
      timeoutMs: 60_000, pollMs: 1_000, now: () => 0, sleep: async () => {},
    })).resolves.toBe(false)
  })

  it('throws the timeout error when no token ever appears', async () => {
    let now = 0
    await expect(awaitChatLogin(fakeSession([null]), {
      timeoutMs: 3_000,
      pollMs: 1_000,
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds },
    })).rejects.toBeInstanceOf(ChatLoginTimeoutError)
  })

  it('returns false when the attempt was cancelled', async () => {
    await expect(awaitChatLogin(fakeSession([null]), {
      timeoutMs: 60_000, pollMs: 1_000, now: () => 0, sleep: async () => {}, isCancelled: () => true,
    })).resolves.toBe(false)
  })
})

describe('selectChatTargets', () => {
  it('finds the sign-in page in another tab', () => {
    expect(selectChatTargets([
      { type: 'page', targetId: 'a', url: 'https://accounts.google.com/signin' },
      { type: 'page', targetId: 'b', url: 'https://chat.deepseek.com/sign_in' },
      { type: 'page', targetId: 'c', url: 'https://chat.deepseek.com/' },
      { type: 'service_worker', targetId: 'd', url: 'https://chat.deepseek.com/sw.js' },
      { type: 'page', targetId: 'e', url: 'https://chat.deepseek.com.evil.example/' },
    ])).toEqual(['b', 'c'])
  })
})

describe('retryDevToolsConnection', () => {
  it('re-reads the port file after a stale endpoint', async () => {
    const ports: (number | undefined)[] = [9222, undefined, 9223]
    let index = 0
    const attempts: number[] = []
    const connected = await retryDevToolsConnection({
      deadline: Date.now() + 5_000,
      readPort: () => ports[Math.min(index++, ports.length - 1)],
      connect: async (port) => {
        attempts.push(port)
        if (port === 9222) throw new ChatLoginBrowserError('stale endpoint')
        return 'connected'
      },
      reset: () => {},
      sleep: async () => {},
    })
    expect(connected).toBe('connected')
    expect(attempts).toEqual([9222, 9223])
  })

  it('reports a leftover sign-in window when the browser exited without a port', async () => {
    await expect(retryDevToolsConnection({
      deadline: Date.now() + 5_000,
      readPort: () => undefined,
      connect: async () => 'never',
      exited: () => true,
      sleep: async () => {},
    })).rejects.toBeInstanceOf(ChatLoginWindowOpenError)
  })
})

describe('deepseekCookies', () => {
  it('keeps cookies for the DeepSeek domains and drops the rest', () => {
    expect(deepseekCookies([
      COOKIE,
      { ...COOKIE, name: 'provider', domain: '.google.com' },
      { ...COOKIE, name: 'chat', domain: 'chat.deepseek.com' },
    ]).map(cookie => cookie.name)).toEqual(['ds_session_id', 'chat'])
  })
})

describe('toCookieDetails', () => {
  it('builds an HTTPS url from the cookie domain and path and carries the flags', () => {
    expect(toCookieDetails({ ...COOKIE, sameSite: 'Lax', expirationDate: 1_900_000_000 })).toEqual({
      url: 'https://deepseek.com/',
      name: 'ds_session_id',
      value: 'abc',
      domain: '.deepseek.com',
      path: '/',
      secure: true,
      httpOnly: true,
      expirationDate: 1_900_000_000,
      sameSite: 'lax',
    })
  })

  it('maps every provider spelling of SameSite', () => {
    expect(toCookieDetails({ ...COOKIE, sameSite: 'None' }).sameSite).toBe('no_restriction')
    expect(toCookieDetails({ ...COOKIE, sameSite: 'Strict' }).sameSite).toBe('strict')
    expect(toCookieDetails(COOKIE).sameSite).toBe('unspecified')
  })

  it('drops the Domain attribute for host-only cookies', () => {
    const details = toCookieDetails({ ...COOKIE, name: '__Host-ds_session', domain: 'chat.deepseek.com' })
    expect(details.domain).toBeUndefined()
    expect(details.url).toBe('https://chat.deepseek.com/')
  })
})
