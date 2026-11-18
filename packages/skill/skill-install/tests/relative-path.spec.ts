/** The relative-path rules every imported file path passes. */
import { describe, expect, it } from 'vitest'
import { relativePathProblem } from '../src/relative-path.ts'

describe('relativePathProblem', () => {
  it.each([
    ['SKILL.md', undefined],
    ['nested/reference.md', undefined],
    ['', 'the path is empty'],
    ['a\0b', 'the path carries a null byte'],
    ['/etc/passwd', 'the path is absolute'],
    ['C:/windows', 'the path starts with a drive letter'],
    ['a\\b', 'the path uses a backslash separator'],
    ['a//b', 'the path has an empty segment'],
    ['../escape', 'the path escapes the folder it would be written to'],
    ['./same', 'the path escapes the folder it would be written to'],
  ])('classifies %s', (path, expected) => {
    expect(relativePathProblem(path)).toBe(expected)
  })
})
