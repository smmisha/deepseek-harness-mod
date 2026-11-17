/** Reading one capture group of a matched pattern. */
import { describe, expect, it } from 'vitest'
import { group } from '../src/match.ts'

describe('group', () => {
  it('reads a participating group', () => {
    expect(group(/^(a)(b)$/u.exec('ab') as RegExpExecArray, 2)).toBe('b')
  })

  it('reads an empty string for a group the pattern left out', () => {
    expect(group(/^(a)$/u.exec('a') as RegExpExecArray, 3)).toBe('')
  })
})
