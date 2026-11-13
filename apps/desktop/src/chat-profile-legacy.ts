/**
 * One-time removal of the profile directory an earlier release created for its
 * controlled-browser sign-in. Nothing in the current shell writes there, so a
 * leftover copy is dead application data.
 */
import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import { removeOwnedDirectory } from './owned-directory.ts'

/** Directory under userData that no current release writes. */
const LEGACY_PROFILE_DIRECTORY = 'chat-login-browser'

/**
 * Remove the leftover profile directory once at application start.
 * @param userData - Electron userData directory.
 * @param log - diagnostic sink; records only the step name and the failure kind.
 */
export function removeLegacyChatBrowserProfile(userData: string, log: (line: string) => void): void {
  const directory = join(userData, LEGACY_PROFILE_DIRECTORY)
  if (lstatSync(directory, { throwIfNoEntry: false }) === undefined) return
  try {
    removeOwnedDirectory(directory)
    log('legacy chat profile removed')
  } catch {
    // A locked or unreadable leftover must never block startup.
    log('legacy chat profile removal failed')
  }
}
