/** The repository text a reader may paste, and every form the parser refuses. */
import { describe, expect, it } from 'vitest'
import { parseRepositorySpec } from '../src/source-spec.ts'

/** The typed code raised for one input. */
function codeOf(input: string): string {
  try {
    parseRepositorySpec(input)
  } catch (error) {
    return (error as { code: string }).code
  }
  throw new Error(`expected "${input}" to be refused`)
}

describe('parseRepositorySpec', () => {
  it.each([
    ['anthropics/skills'],
    ['anthropics/skills/'],
    ['  anthropics/skills  '],
    ['anthropics/skills.git'],
    ['/anthropics/skills'],
  ])('reads the bare repository %s', (input) => {
    expect(parseRepositorySpec(input)).toEqual({ owner: 'anthropics', repo: 'skills' })
  })

  it.each([
    ['https://github.com/anthropics/skills'],
    ['http://github.com/anthropics/skills'],
    ['https://www.github.com/anthropics/skills'],
    ['https://github.com/anthropics/skills/'],
    ['https://github.com/anthropics/skills.git'],
    ['https://github.com/anthropics/skills/tree/main/skills/pdf'],
    ['https://github.com/anthropics/skills?tab=readme'],
  ])('reads the repository from %s', (input) => {
    expect(parseRepositorySpec(input)).toEqual({ owner: 'anthropics', repo: 'skills' })
  })

  it.each([
    ['npx skills add anthropics/skills'],
    ['npx skills add anthropics/skills --skill pdf'],
    ['$ npx skills add https://github.com/anthropics/skills'],
    ['pnpm dlx skills add anthropics/skills'],
    ['bunx skills add anthropics/skills'],
    ['npx --yes skills add anthropics/skills'],
  ])('reads the repository out of %s', (input) => {
    expect(parseRepositorySpec(input)).toEqual({ owner: 'anthropics', repo: 'skills' })
  })

  it('refuses empty text', () => {
    expect(codeOf('   ')).toBe('SKILL_INSTALL_SPEC_INVALID')
  })

  it('refuses a command that names no repository', () => {
    expect(codeOf('npx skills add')).toBe('SKILL_INSTALL_SPEC_INVALID')
    expect(codeOf('npx skills add --skill pdf')).toBe('SKILL_INSTALL_SPEC_INVALID')
    expect(codeOf('npx skills add   ')).toBe('SKILL_INSTALL_SPEC_INVALID')
    expect(codeOf('npx skills add --yes --force')).toBe('SKILL_INSTALL_SPEC_INVALID')
  })

  it('refuses a repository on another host', () => {
    expect(codeOf('https://gitlab.com/anthropics/skills')).toBe('SKILL_INSTALL_SPEC_INVALID')
    expect(codeOf('git@github.com:anthropics/skills.git')).toBe('SKILL_INSTALL_SPEC_INVALID')
  })

  it('refuses text that names no repository at all', () => {
    expect(codeOf('skills')).toBe('SKILL_INSTALL_SPEC_INVALID')
  })

  it('refuses a parent segment in either half', () => {
    expect(codeOf('.. /skills')).toBe('SKILL_INSTALL_SPEC_INVALID')
    expect(codeOf('../skills')).toBe('SKILL_INSTALL_SPEC_INVALID')
    expect(codeOf('owner/..')).toBe('SKILL_INSTALL_SPEC_INVALID')
    expect(codeOf('https://github.com/owner/..')).toBe('SKILL_INSTALL_SPEC_INVALID')
  })

  it('refuses characters a repository cannot carry', () => {
    expect(codeOf('owner/re po')).toBe('SKILL_INSTALL_SPEC_INVALID')
    expect(codeOf('owner/repo\$')).toBe('SKILL_INSTALL_SPEC_INVALID')
  })
})
