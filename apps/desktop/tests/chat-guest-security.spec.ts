/**
 * Chat guest security invariants: the shell keeps no reach into the reader's
 * sign-in. The test reads the chat-guest sources and fails when any of them
 * gains debugging ports, cookie access, storage access, user-agent spoofing,
 * process termination, or a child process.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO = fileURLToPath(new URL('../../..', import.meta.url))

/** Desktop files that operate the chat guest. */
const DESKTOP_CHAT_GUEST_FILES = [
  'apps/desktop/src/browser-guests.ts',
  'apps/desktop/src/chat-login-log.ts',
  'apps/desktop/src/chat-profile-legacy.ts',
]

/** Every Client file of the Chat tab plugin. */
const WORK_MODE_SOURCES = 'packages/client/ui-work-mode/src'

/** Forbidden capabilities, each with the reason it must not appear. */
const BANNED = [
  { name: 'remote debugging', pattern: /remote-debugging/iu },
  { name: 'cookie export', pattern: /Storage\.getCookies/u },
  { name: 'cookie writes', pattern: /cookies\.set/u },
  { name: 'cookie reads', pattern: /cookies\.get/u },
  { name: 'web storage', pattern: /localStorage/u },
  { name: 'process termination', pattern: /taskkill|pkill/iu },
  { name: 'user-agent spoofing', pattern: /setUserAgent/u },
  { name: 'child processes', pattern: /child_process/u },
] as const

/** Recursively list the plugin's TypeScript sources. */
function pluginSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return pluginSources(path)
    return /\.tsx?$/u.test(entry.name) ? [path] : []
  })
}

const SOURCES = new Map<string, string>([
  ...DESKTOP_CHAT_GUEST_FILES.map(file => [file, readFileSync(join(REPO, file), 'utf8')] as const),
  ...pluginSources(join(REPO, WORK_MODE_SOURCES))
    .map(file => [relative(REPO, file).replaceAll('\\', '/'), readFileSync(file, 'utf8')] as const),
])

describe('chat guest security invariants', () => {
  it('reads the chat-guest sources of both application surfaces', () => {
    expect([...SOURCES.keys()]).toEqual(expect.arrayContaining(DESKTOP_CHAT_GUEST_FILES))
    expect([...SOURCES.keys()].some(file => file.startsWith(WORK_MODE_SOURCES))).toBe(true)
  })

  it.each(BANNED)('keeps $name out of the chat guest', ({ pattern }) => {
    const offending = [...SOURCES].flatMap(([file, source]) => (pattern.test(source) ? [file] : []))
    expect(offending).toEqual([])
  })
})
