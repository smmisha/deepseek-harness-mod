/** The allowlist and URL rules every outbound request passes. */
import { describe, expect, it } from 'vitest'
import { hostMatches, isAllowedHost, validateRequestUrl } from '../src/policy.ts'

/** The typed code raised for one URL. */
function codeOf(url: string, allowedHosts: readonly string[] = ['api.github.com']): string {
  try {
    validateRequestUrl(url, { allowedHosts })
  } catch (error) {
    return (error as { code: string }).code
  }
  throw new Error(`expected "${url}" to be refused`)
}

describe('hostMatches', () => {
  it('matches an exact host without letter case', () => {
    expect(hostMatches('api.github.com', 'api.github.com')).toBe(true)
    expect(hostMatches('api.github.com', 'API.GitHub.com')).toBe(true)
    expect(hostMatches('api.github.com', ' github.com ')).toBe(false)
  })

  it('matches subdomains of a wildcard entry', () => {
    expect(hostMatches('raw.githubusercontent.com', '*.githubusercontent.com')).toBe(true)
    expect(hostMatches('a.b.githubusercontent.com', '*.githubusercontent.com')).toBe(true)
    expect(hostMatches('githubusercontent.com', '*.githubusercontent.com')).toBe(false)
    expect(hostMatches('evilgithubusercontent.com', '*.githubusercontent.com')).toBe(false)
    expect(hostMatches('anything', '*.')).toBe(false)
  })
})

describe('isAllowedHost', () => {
  it('accepts a host one entry covers', () => {
    expect(isAllowedHost('Raw.GitHubUserContent.com', ['api.github.com', '*.githubusercontent.com'])).toBe(true)
    expect(isAllowedHost('evil.example', ['api.github.com', '*.githubusercontent.com'])).toBe(false)
  })
})

describe('validateRequestUrl', () => {
  it('accepts an allowlisted https URL', () => {
    expect(validateRequestUrl('https://api.github.com/repos/a/b', { allowedHosts: ['api.github.com'] }).hostname)
      .toBe('api.github.com')
  })

  it('refuses http', () => {
    expect(codeOf('http://api.github.com/repos/a/b')).toBe('SKILL_INSTALL_SPEC_INVALID')
  })

  it('refuses another scheme', () => {
    expect(codeOf('file:///etc/passwd')).toBe('SKILL_INSTALL_SPEC_INVALID')
  })

  it('refuses embedded credentials', () => {
    expect(codeOf('https://user:secret@api.github.com/x')).toBe('SKILL_INSTALL_SPEC_INVALID')
  })

  it('refuses a malformed URL', () => {
    expect(codeOf('not a url')).toBe('SKILL_INSTALL_SPEC_INVALID')
  })

  it('refuses a URL past the length cap', () => {
    expect(codeOf(`https://api.github.com/${'a'.repeat(2100)}`)).toBe('SKILL_INSTALL_SPEC_INVALID')
  })

  it('refuses a host outside the allowlist', () => {
    expect(codeOf('https://evil.example/x')).toBe('SKILL_INSTALL_HOST_BLOCKED')
  })
})
