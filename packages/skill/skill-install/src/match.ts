/**
 * Reading one capture group of a matched regular expression. A group a pattern
 * did not match reads as an empty string, so callers never handle `undefined`
 * for a value their own pattern requires.
 *
 * @module @deepseek-ai/dsh-skill-install/match
 */

/**
 * Text of one capture group.
 * @param match - result of a successful `RegExp.exec`.
 * @param index - group number to read.
 * @returns the group's text, or an empty string when the group did not participate.
 */
export function group(match: RegExpExecArray, index: number): string {
  return match[index] ?? ''
}
