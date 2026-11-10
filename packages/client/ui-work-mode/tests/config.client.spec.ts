/** Plugin configuration: the chat address and the enforced navigation allowlist. */
import { describe, expect, it } from 'vitest'
import { resolveWorkModeConfig } from '../src/client/config.ts'

describe('resolveWorkModeConfig', () => {
  it('defaults to the DeepSeek chat and its own origin', () => {
    expect(resolveWorkModeConfig({})).toEqual({
      url: 'https://chat.deepseek.com/',
      allowedOrigins: ['https://chat.deepseek.com'],
    })
  })

  it('normalizes origins and drops duplicates', () => {
    const resolved = resolveWorkModeConfig({
      url: 'https://chat.deepseek.com/sign_in',
      allowedOrigins: ['https://chat.deepseek.com/', 'https://chat.deepseek.com', 'https://account.deepseek.com/login'],
    })
    expect(resolved.url).toBe('https://chat.deepseek.com/sign_in')
    expect(resolved.allowedOrigins).toEqual(['https://chat.deepseek.com', 'https://account.deepseek.com'])
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
})
