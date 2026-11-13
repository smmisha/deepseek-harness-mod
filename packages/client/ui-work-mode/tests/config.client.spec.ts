/** Plugin configuration: the chat address, the origin allowlist, and provider hosts. */
import { describe, expect, it } from 'vitest'
import { resolveWorkModeConfig } from '../src/client/config.ts'

describe('resolveWorkModeConfig', () => {
  it('defaults to the DeepSeek chat, its origin, and the Google and Apple providers', () => {
    expect(resolveWorkModeConfig({})).toEqual({
      url: 'https://chat.deepseek.com/',
      allowedOrigins: ['https://chat.deepseek.com'],
      loginHosts: ['accounts.youtube.com', 'appleid.apple.com'],
      loginHostSuffixes: ['accounts.google.'],
    })
  })

  it('normalizes origins and provider patterns and drops duplicates', () => {
    const resolved = resolveWorkModeConfig({
      url: 'https://chat.deepseek.com/sign_in',
      allowedOrigins: ['https://chat.deepseek.com/', 'https://chat.deepseek.com', 'https://account.deepseek.com/login'],
      loginHosts: ['AppleID.Apple.com', 'appleid.apple.com'],
      loginHostSuffixes: ['accounts.google.', '.google.com', 'accounts.google.'],
    })
    expect(resolved.url).toBe('https://chat.deepseek.com/sign_in')
    expect(resolved.allowedOrigins).toEqual(['https://chat.deepseek.com', 'https://account.deepseek.com'])
    expect(resolved.loginHosts).toEqual(['appleid.apple.com'])
    expect(resolved.loginHostSuffixes).toEqual(['accounts.google.', '.google.com'])
  })

  it('keeps empty provider lists for a deployment that disables provider hops', () => {
    expect(resolveWorkModeConfig({ loginHosts: [], loginHostSuffixes: [] })).toMatchObject({
      loginHosts: [],
      loginHostSuffixes: [],
    })
  })

  it('refuses a plain-HTTP page', () => {
    expect(() => resolveWorkModeConfig({ url: 'http://chat.deepseek.com/' })).toThrow('HTTPS')
  })

  it('refuses credentials inside the page address', () => {
    expect(() => resolveWorkModeConfig({ url: 'https://user:pass@chat.deepseek.com/' })).toThrow('credentials')
  })

  it('refuses a non-HTTPS allowed origin', () => {
    expect(() => resolveWorkModeConfig({ allowedOrigins: ['http://chat.deepseek.com'] })).toThrow('HTTPS origin')
  })

  it('refuses an empty allowlist instead of embedding nothing', () => {
    expect(() => resolveWorkModeConfig({ allowedOrigins: [] })).toThrow('at least one allowed origin')
  })

  it('refuses provider patterns without a marking dot', () => {
    expect(() => resolveWorkModeConfig({ loginHosts: ['https://accounts.google.com'] })).toThrow('provider host')
    expect(() => resolveWorkModeConfig({ loginHostSuffixes: ['accounts.google.com'] })).toThrow('must be a host suffix')
  })

  it('refuses more provider entries than the contract supports', () => {
    expect(() => resolveWorkModeConfig({ loginHosts: Array.from({ length: 17 }, (_value, index) => `host${String(index)}.example`) }))
      .toThrow('at most 16 provider hosts')
    expect(() => resolveWorkModeConfig({ loginHostSuffixes: Array.from({ length: 17 }, (_value, index) => `.suffix${String(index)}.com`) }))
      .toThrow('at most 16 provider suffixes')
  })
})
