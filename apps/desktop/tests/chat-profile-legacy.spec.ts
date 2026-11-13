/** The one-time removal of the retired controlled-browser profile. */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { removeLegacyChatBrowserProfile } from '../src/chat-profile-legacy.ts'

const roots: string[] = []

function userData(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-chat-profile-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('removeLegacyChatBrowserProfile', () => {
  it('removes the leftover profile directory and its contents', () => {
    const root = userData()
    const profile = join(root, 'chat-login-browser')
    mkdirSync(join(profile, 'Default', 'Local Storage'), { recursive: true })
    writeFileSync(join(profile, 'DevToolsActivePort'), '9222')
    const log = vi.fn()

    removeLegacyChatBrowserProfile(root, log)

    expect(existsSync(profile)).toBe(false)
    expect(log).toHaveBeenCalledWith('legacy chat profile removed')
  })

  it('does nothing when no leftover profile exists', () => {
    const root = userData()
    const log = vi.fn()

    removeLegacyChatBrowserProfile(root, log)

    expect(log).not.toHaveBeenCalled()
  })

  it('logs a removal failure and leaves startup running', () => {
    const root = userData()
    const leftover = join(root, 'chat-login-browser')
    writeFileSync(leftover, 'not a directory')
    const log = vi.fn()

    expect(() => { removeLegacyChatBrowserProfile(root, log) }).not.toThrow()

    expect(log).toHaveBeenCalledWith('legacy chat profile removal failed')
    expect(existsSync(leftover)).toBe(true)
  })
})
