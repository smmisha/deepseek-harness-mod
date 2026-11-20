// @vitest-environment jsdom
/** The install preview: one block per skill, its files, its document, and its source. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SkillPreview, sourceReference } from '../src/client/SkillPreview.tsx'
import { en, type SkillsLocaleKey } from '../src/client/locales.ts'
import type { SkillsTranslate } from '../src/client/skills-catalog.ts'

afterEach(cleanup)

/** The `skills` locale seat over the English dictionary. */
const t: SkillsTranslate = (key: SkillsLocaleKey): string => en[key]

describe('sourceReference', () => {
  it('renders each source kind', () => {
    expect(sourceReference({ kind: 'repository', owner: 'acme', repo: 'skills', folder: 'skills/pdf', commit: 'abc' }))
      .toBe('https://github.com/acme/skills/skills/pdf/')
    expect(sourceReference({ kind: 'repository', owner: 'acme', repo: 'skills', folder: '', commit: 'abc' }))
      .toBe('https://github.com/acme/skills/')
    expect(sourceReference({ kind: 'archive', fileName: 'pack.zip' })).toBe('pack.zip')
    expect(sourceReference({ kind: 'folder', folderName: 'pdf' })).toBe('pdf')
  })
})

describe('SkillPreview', () => {
  it('shows the source, files, and document of a skill that ships scripts', () => {
    render(
      <SkillPreview t={t} preview={{
        id: 'p',
        source: { kind: 'archive', fileName: 'pack.zip' },
        skills: [{
          name: 'pdf',
          description: 'Work with PDF files',
          document: '---\nname: pdf\n---\n',
          files: [{ path: 'scripts/run.sh', size: 10, isScript: true }],
          hasScripts: true,
          target: 'C:\\skills\\pdf',
          conflict: false,
        }],
      }} />,
    )
    expect(screen.getByText('pack.zip')).toBeTruthy()
    expect(screen.getByText('Work with PDF files')).toBeTruthy()
    expect(screen.getByText(en.repoScripts)).toBeTruthy()
    expect(screen.getByText(en.previewScripts)).toBeTruthy()
    expect(screen.getByText(/name: pdf/u)).toBeTruthy()
  })

  it('keeps a skill with no description and no scripts quiet', () => {
    render(
      <SkillPreview t={t} preview={{
        id: 'p',
        source: { kind: 'folder', folderName: 'pdf' },
        skills: [{
          name: 'pdf',
          document: '---\nname: pdf\n---\n',
          files: [{ path: 'SKILL.md', size: 10, isScript: false }],
          hasScripts: false,
          target: 'C:\\skills\\pdf',
          conflict: false,
        }],
      }} />,
    )
    expect(screen.queryByText(en.previewScripts)).toBeNull()
    expect(screen.queryByText(en.repoScripts)).toBeNull()
    expect(screen.getAllByText('pdf').length).toBeGreaterThan(0)
  })
})
