/**
 * Folder-path admission for the local skill provider, kept out of the plugin entry so the entry
 * exports only its plugin surface; the provider and this package's tests import it here.
 */
import { isAbsolute } from 'node:path'

/** Why a folder path is refused; `invalid` covers network, device, and parent-segment spellings. */
type FolderPathProblem = 'relative' | 'invalid'

/**
 * Classify a folder path before the provider opens it. Two leading separators reject the Win32
 * UNC and device namespaces (`\\server\share`, `\\?\C:\x`, `\\.\pipe\x`) on every platform:
 * scanning them would connect to an attacker-named SMB endpoint and register a remote tree as
 * skills. A parent segment is refused too, so the recorded folder is the one the reader saw.
 * @param path - folder path after `~` expansion.
 * @returns the refusal reason, or `undefined` when the folder may be scanned.
 */
export function folderPathProblem(path: string): FolderPathProblem | undefined {
  if (path.length === 0) return 'relative'
  if (/^[\\/]{2}/u.test(path)) return 'invalid'
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/u.test(path)) return 'invalid'
  return isAbsolute(path) ? undefined : 'relative'
}

/**
 * Refuse a folder the Skills provider must not scan: a network share or device namespace, a
 * relative path, or a path carrying a parent (`..`) segment. The two leading separators that
 * spell a Win32 device prefix are rejected on every platform, so the check holds where the Host
 * is not Windows but the reader pastes a Windows path.
 * @param path - absolute folder path, after `~` expansion.
 * @throws {TypeError} when the path is not a local absolute folder path.
 */
export function assertFolderPathAcceptable(path: string): void {
  const problem = folderPathProblem(path)
  if (problem === undefined) return
  const reason = problem === 'relative'
    ? 'is not an absolute folder path'
    : 'names a network or device location, or contains a parent segment'
  throw new TypeError(`skill-filesystem: "${path}" ${reason}`)
}
