/**
 * Path rules for content the installer received over the wire. An imported file
 * path is relative to the folder that will hold it, uses `/` separators, and
 * must never name a parent, an absolute location, or a device.
 *
 * @module @deepseek-ai/dsh-skill-install/relative-path
 */

/**
 * Describe what is wrong with one imported file path.
 * @param path - path as the archive or drop supplied it.
 * @returns the problem, or undefined when the path is a safe relative path.
 */
export function relativePathProblem(path: string): string | undefined {
  if (path.length === 0) return 'the path is empty'
  if (path.includes('\0')) return 'the path carries a null byte'
  if (path.startsWith('/')) return 'the path is absolute'
  if (/^[A-Za-z]:/u.test(path)) return 'the path starts with a drive letter'
  if (path.includes('\\')) return 'the path uses a backslash separator'
  const segments = path.split('/')
  if (segments.some(segment => segment.length === 0)) return 'the path has an empty segment'
  if (segments.some(segment => segment === '.' || segment === '..')) return 'the path escapes the folder it would be written to'
  return undefined
}
