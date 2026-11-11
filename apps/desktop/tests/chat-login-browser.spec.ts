/**
 * External-browser fallback: the site's own user-token envelope decides when the
 * attempt is complete, and the payload carries exactly the cookies and storage
 * entries the chat needs.
 */
import { describe, expect, it } from 'vitest'
import {
  ChatLoginTimeoutError,
  awaitChatLogin,
  deepseekCookies,
  findChatBrowser,
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

/** Let pending microtasks and timers settle. */
async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

/** A session whose token answers follow a fixed timeline. */
function fakeSession(answers: readonly boolean[], closed = false): ChatLoginSession {
  let index = 0
  return {
    get closed() { return closed },
    async hasUserToken() {
      return answers[Math.min(index++, answers.length - 1)] ?? false
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
    const session = fakeSession([false, true])
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
    expect(settled).toBe(true)
    await expect(promise).resolves.toBe(true)
  })

  it('returns false when the reader closes the browser process', async () => {
    await expect(awaitChatLogin(fakeSession([false], true), {
      timeoutMs: 60_000, pollMs: 1_000, now: () => 0, sleep: async () => {},
    })).resolves.toBe(false)
  })

  it('throws the timeout error when no token ever appears', async () => {
    let now = 0
    await expect(awaitChatLogin(fakeSession([false]), {
      timeoutMs: 3_000,
      pollMs: 1_000,
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds },
    })).rejects.toBeInstanceOf(ChatLoginTimeoutError)
  })

  it('returns false when the attempt was cancelled', async () => {
    await expect(awaitChatLogin(fakeSession([false]), {
      timeoutMs: 60_000, pollMs: 1_000, now: () => 0, sleep: async () => {}, isCancelled: () => true,
    })).resolves.toBe(false)
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

describe('findChatBrowser', () => {
  it('reports no browser when the platform paths do not exist', () => {
    expect(findChatBrowser({}, 'linux')).toBeUndefined()
  })
})
