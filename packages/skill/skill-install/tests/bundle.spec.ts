/** Bundle selection, skill names, and the provenance the installer writes. */
import { describe, expect, it } from 'vitest'
import {
  declaredDescription, installName, isScriptFile, selectBundles, withProvenance, type BundleFile,
} from '../src/bundle.ts'

/** Encode one bundle file. */
function file(path: string, content: string | Uint8Array): BundleFile {
  return { path, bytes: typeof content === 'string' ? new TextEncoder().encode(content) : content }
}

/** A minimal valid instruction file. */
function document(name: string, extra = ''): string {
  return `---\nname: ${name}\ndescription: A skill\n${extra}---\n# Body\n`
}

describe('selectBundles', () => {
  it('groups files by their SKILL.md folder', () => {
    const bundles = selectBundles([
      file('pdf/SKILL.md', document('pdf')),
      file('pdf/LICENSE.txt', 'licence'),
      file('docx/SKILL.md', document('docx')),
    ], 5)
    expect(bundles.map(bundle => [bundle.folder, bundle.files.map(member => member.path)])).toEqual([
      ['docx', ['SKILL.md']],
      ['pdf', ['SKILL.md', 'LICENSE.txt']],
    ])
  })

  it('accepts a lower-case document name and a root bundle', () => {
    const bundles = selectBundles([file('skill.md', document('root'))], 5)
    expect(bundles.map(bundle => bundle.folder)).toEqual([''])
  })

  it('refuses content with no SKILL.md', () => {
    expect(() => selectBundles([file('README.md', 'text')], 5))
      .toThrow(expect.objectContaining({ code: 'SKILL_INSTALL_INVALID_SKILL' }))
  })

  it('refuses more skills than the cap', () => {
    expect(() => selectBundles([file('a/SKILL.md', document('a')), file('b/SKILL.md', document('b'))], 1))
      .toThrow(expect.objectContaining({ code: 'SKILL_INSTALL_INVALID_SKILL' }))
  })

  it('refuses an instruction file that is not UTF-8', () => {
    expect(() => selectBundles([file('a/SKILL.md', new Uint8Array([0xff, 0xfe]))], 5))
      .toThrow(expect.objectContaining({ code: 'SKILL_INSTALL_INVALID_SKILL' }))
  })
})

describe('installName', () => {
  it('keeps a kebab-case frontmatter name', () => {
    expect(installName(document('pdf-tools'), 'whatever')).toBe('pdf-tools')
  })

  it('slugs the declared name when it is not kebab-case', () => {
    expect(installName(document('PDF Tools!'), 'whatever')).toBe('pdf-tools')
  })

  it('falls back to the source folder', () => {
    expect(installName('---\ndescription: no name\n---\n', 'skills/Some Skill')).toBe('some-skill')
  })

  it('falls back to the last folder segment', () => {
    expect(installName('---\ndescription: no name\n---\n', 'Deep.Dive')).toBe('deep-dive')
  })

  it('refuses a name that yields nothing usable', () => {
    expect(() => installName(document('--'), '***'))
      .toThrow(expect.objectContaining({ code: 'SKILL_INSTALL_INVALID_SKILL' }))
  })

  it('uses a generic folder name when the folder has none', () => {
    expect(installName('---\ndescription: x\n---\n', '')).toBe('skill')
  })
})

describe('declaredDescription', () => {
  it('collapses every whitespace run to one space', () => {
    expect(declaredDescription('---\nname: a\ndescription: |\n  one\n  two\n---\n')).toBe('one two')
  })

  it('returns undefined for a missing or empty description', () => {
    expect(declaredDescription('---\nname: a\n---\n')).toBeUndefined()
    expect(declaredDescription('---\nname: a\ndescription: "   "\n---\n')).toBeUndefined()
  })

  it('refuses a document with no frontmatter', () => {
    expect(() => declaredDescription('# no frontmatter\n'))
      .toThrow(expect.objectContaining({ code: 'SKILL_INSTALL_INVALID_SKILL' }))
  })

  it('refuses frontmatter that is not YAML', () => {
    expect(() => declaredDescription('---\nname: [unclosed\n---\n'))
      .toThrow(expect.objectContaining({ code: 'SKILL_INSTALL_INVALID_SKILL' }))
  })

  it('refuses frontmatter that is not a mapping', () => {
    expect(() => declaredDescription('---\n- one\n- two\n---\n'))
      .toThrow(expect.objectContaining({ code: 'SKILL_INSTALL_INVALID_SKILL' }))
  })

  it('refuses frontmatter that never closes', () => {
    expect(() => declaredDescription('---\nname: a\n# no end marker\n'))
      .toThrow(expect.objectContaining({ code: 'SKILL_INSTALL_INVALID_SKILL' }))
  })
})

describe('withProvenance', () => {
  it('records the origin, commit, and install instant', () => {
    const written = withProvenance(document('pdf'), {
      origin: 'https://github.com/anthropics/skills',
      commit: 'abc123',
      installedAt: '2026-11-17T10:00:00.000Z',
    })
    expect(written).toMatch(/^---\n/)
    expect(written).toContain('repository: https://github.com/anthropics/skills')
    expect(written).toContain('commit: abc123')
    expect(written).toContain('installedAt: 2026-11-17T10:00:00.000Z')
    expect(written).toMatch(/# Body\n$/)
  })

  it('keeps other frontmatter keys and existing metadata', () => {
    const written = withProvenance(document('pdf', 'license: Apache-2.0\nmetadata:\n  language: de\n'), {
      origin: 'some.zip',
      installedAt: '2026-11-17T10:00:00.000Z',
    })
    expect(written).toContain('license: Apache-2.0')
    expect(written).toContain('language: de')
    expect(written).toContain('repository: some.zip')
    expect(written).not.toContain('commit:')
  })

  it('replaces metadata that is not an object', () => {
    const written = withProvenance('---\nname: a\nmetadata: text\n---\nbody\n', {
      origin: 'some.zip',
      installedAt: '2026-11-17T10:00:00.000Z',
    })
    expect(written).toContain('repository: some.zip')
  })

  it('refuses a document with no frontmatter', () => {
    expect(() => withProvenance('# no frontmatter\n', { origin: 'x', installedAt: 'now' }))
      .toThrow(expect.objectContaining({ code: 'SKILL_INSTALL_INVALID_SKILL' }))
  })
})

describe('isScriptFile', () => {
  it('recognizes a script path', () => {
    expect(isScriptFile('scripts/run.sh')).toBe(true)
    expect(isScriptFile('SKILL.md')).toBe(false)
  })
})
