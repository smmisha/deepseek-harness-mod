/**
 * Chat sign-in browser helpers: provider cookies are filtered to the DeepSeek
 * chat and translated into the records the app's session accepts.
 */
import { describe, expect, it } from 'vitest'
import { deepseekCookies, findChatBrowser, toCookieDetails } from '../src/chat-login-browser.ts'

const COOKIE = {
  name: 'ds_session_id',
  value: 'abc',
  domain: '.deepseek.com',
  path: '/',
  secure: true,
  httpOnly: true,
} as const

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
