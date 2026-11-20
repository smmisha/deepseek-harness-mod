// @vitest-environment jsdom
/**
 * The install dialog: the catalog list, a resolved repository, the preview, the
 * confirmation, and the conflict choices a taken name offers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { InstallPreview, RepositoryView, SkillCatalogView } from '@deepseek-ai/dsh-skill-install/types'
import { CatalogDialog } from '../src/client/CatalogDialog.tsx'
import { en, type SkillsLocaleKey } from '../src/client/locales.ts'
import type { FaceResult, InstallFace } from '../src/client/skills-install.ts'
import type { SkillsTranslate } from '../src/client/skills-catalog.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** The `skills` locale seat over the English dictionary. */
const t: SkillsTranslate = (key: SkillsLocaleKey, params?: Record<string, unknown>): string =>
  Object.entries(params ?? {}).reduce<string>((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), en[key])

/** Catalan-free catalog rows the dialog lists. */
const CATALOGS: readonly SkillCatalogView[] = [
  { id: 'github', title: 'GitHub', homepage: 'https://github.com', searchable: true, kind: 'github' },
  {
    id: 'anthropics',
    title: 'Anthropic skills',
    homepage: 'https://github.com/anthropics/skills',
    searchable: true,
    kind: 'recommended',
    repository: 'anthropics/skills',
  },
  { id: 'skills.sh', title: 'skills.sh', homepage: 'https://www.skills.sh', searchable: false, kind: 'link' },
]

/** One resolved repository holding a single skill folder. */
const VIEW: RepositoryView = {
  owner: 'anthropics',
  repo: 'skills',
  commit: 'abc123',
  skills: [{ folder: 'skills/pdf', name: 'pdf', hasScripts: true, fileCount: 3 }],
}

/** One preview of a repository skill. */
function preview(conflict = false): InstallPreview {
  return {
    id: 'preview-1',
    source: { kind: 'repository', owner: 'anthropics', repo: 'skills', folder: 'skills/pdf', commit: 'abc123' },
    skills: [{
      name: 'pdf',
      description: 'Work with PDF files',
      document: '---\nname: pdf\n---\n# PDF\n',
      files: [
        { path: 'SKILL.md', size: 30, isScript: false },
        { path: 'scripts/run.sh', size: 10, isScript: true },
      ],
      hasScripts: true,
      target: 'C:\\Users\\me\\.dsh\\skills\\pdf',
      conflict,
    }],
  }
}

/** A face stub whose every call records and answers what the case needs. */
function face(overrides: Partial<InstallFace> = {}): InstallFace {
  return {
    catalogs: async () => ({ ok: true, value: CATALOGS }),
    repository: async () => ({ ok: true, value: VIEW }),
    previewRepository: async () => ({ ok: true, value: preview() }),
    previewArchive: async () => ({ ok: true, value: preview() }),
    previewFolder: async () => ({ ok: true, value: preview() }),
    installSkill: async () => ({ ok: true, value: { installed: [{ name: 'pdf', path: 'C:\\skills\\pdf', replaced: false }] } }),
    removeInstalled: async () => undefined,
    ...overrides,
  }
}

/** Render the dialog over one face. */
function mount(options: {
  readonly face?: InstallFace
  readonly preview?: InstallPreview
  readonly busy?: boolean
  readonly failure?: string
  readonly onInstalled?: (names: readonly string[]) => void
  readonly onClose?: () => void
} = {}): { readonly onInstalled: (names: readonly string[]) => void; readonly onClose: () => void } {
  const onInstalled = vi.fn(options.onInstalled ?? (() => undefined))
  const onClose = vi.fn(options.onClose ?? (() => undefined))
  render(
    <CatalogDialog t={t} open face={options.face ?? face()} initialPreview={options.preview}
      initialBusy={options.busy} initialFailure={options.failure}
      onInstalled={onInstalled} onClose={onClose} />,
  )
  return { onInstalled, onClose }
}

/** Answer of a failed call. */
function failed(code: string, message = 'refused'): FaceResult<never> {
  return { ok: false, failure: { code, message } }
}

describe('CatalogDialog catalogs', () => {
  it('lists every catalog and opens a link-only one in the browser', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    mount()
    expect(await screen.findByText('GitHub')).toBeTruthy()
    expect(screen.getByText('Anthropic skills')).toBeTruthy()
    expect(screen.getByText(en.catalogRecommended)).toBeTruthy()
    expect(screen.getByText(en.catalogLinkOnly)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.catalogOpenBrowser }))
    expect(open).toHaveBeenCalledWith('https://www.skills.sh', '_blank', 'noopener,noreferrer')
  })

  it('reports a catalog list the Host refused', async () => {
    mount({ face: face({ catalogs: async () => failed('skill-install/unavailable') }) })
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining(en.installUnavailable))
  })

  it('reports a repository the Host refused', async () => {
    mount({ face: face({ repository: async () => failed('skill-install/not-found') }) })
    fireEvent.change(await screen.findByLabelText(en.repoLabel), { target: { value: 'a/b' } })
    fireEvent.click(screen.getByRole('button', { name: en.repoResolve }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining(en.installNotFound))
    expect(screen.getByLabelText(en.repoLabel)).toBeTruthy()
  })

  it('reports a preview the Host refused', async () => {
    mount({ face: face({ previewRepository: async () => failed('skill-install/tree-too-large') }) })
    fireEvent.change(await screen.findByLabelText(en.repoLabel), { target: { value: 'a/b' } })
    fireEvent.click(screen.getByRole('button', { name: en.repoResolve }))
    fireEvent.click(await screen.findByRole('button', { name: en.previewTitle }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining(en.installTreeTooLarge))
  })

  it('offers no repository row for a recommended catalog that carries none', async () => {
    mount({
      face: face({
        catalogs: async () => ({
          ok: true,
          value: [{ id: 'rec', title: 'Rec', homepage: 'https://example.test', searchable: true, kind: 'recommended' }],
        }),
      }),
    })
    expect(await screen.findByText('Rec')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /example\.test/u })).toBeNull()
  })

  it('marks a repository skill that ships no scripts', async () => {
    mount({
      face: face({
        repository: async () => ({
          ok: true,
          value: { ...VIEW, skills: [{ folder: 'skills/plain', name: 'plain', hasScripts: false, fileCount: 1 }] },
        }),
      }),
    })
    fireEvent.change(await screen.findByLabelText(en.repoLabel), { target: { value: 'a/b' } })
    fireEvent.click(screen.getByRole('button', { name: en.repoResolve }))
    expect(await screen.findByText('plain')).toBeTruthy()
    expect(screen.queryByText(en.repoScripts)).toBeNull()
  })

  it('resolves a repository and previews one of its folders', async () => {
    const repository = vi.fn(async (_input: string) => ({ ok: true as const, value: VIEW }))
    const previewRepository = vi.fn(async () => ({ ok: true as const, value: preview() }))
    mount({ face: face({ repository, previewRepository }) })
    fireEvent.change(await screen.findByLabelText(en.repoLabel), { target: { value: 'anthropics/skills' } })
    fireEvent.click(screen.getByRole('button', { name: en.repoResolve }))
    expect(await screen.findByText('pdf')).toBeTruthy()
    expect(screen.getByText(en.repoScripts)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.previewTitle }))
    expect((await screen.findAllByText('SKILL.md')).length).toBeGreaterThan(0)
    expect(repository).toHaveBeenCalledWith('anthropics/skills')
    expect(previewRepository).toHaveBeenCalledWith('anthropics/skills', 'skills/pdf')
  })

  it('resolves the recommended catalog from its own row', async () => {
    const repository = vi.fn(async (_input: string) => ({ ok: true as const, value: VIEW }))
    mount({ face: face({ repository }) })
    fireEvent.click(await screen.findByRole('button', { name: 'anthropics/skills' }))
    expect(await screen.findByText('pdf')).toBeTruthy()
    expect(repository).toHaveBeenCalledWith('anthropics/skills')
  })

  it('says a repository holds no skill folder', async () => {
    mount({
      face: face({ repository: async () => ({ ok: true, value: { ...VIEW, skills: [] } }) }),
    })
    fireEvent.change(await screen.findByLabelText(en.repoLabel), { target: { value: 'a/b' } })
    fireEvent.click(screen.getByRole('button', { name: en.repoResolve }))
    expect(await screen.findByText(en.repoEmpty)).toBeTruthy()
  })

  it('returns from the repository list to the catalogs', async () => {
    mount()
    fireEvent.change(await screen.findByLabelText(en.repoLabel), { target: { value: 'a/b' } })
    fireEvent.click(screen.getByRole('button', { name: en.repoResolve }))
    await screen.findByText('pdf')
    fireEvent.click(screen.getByRole('button', { name: en.back }))
    expect(await screen.findByLabelText(en.repoLabel)).toBeTruthy()
  })
})

describe('CatalogDialog install', () => {
  it('installs after confirmation and reports the written names', async () => {
    const installSkill = vi.fn(async () => ({
      ok: true as const,
      value: { installed: [{ name: 'pdf', path: 'C:\\skills\\pdf', replaced: false }] },
    }))
    const onInstalled = vi.fn()
    mount({ face: face({ installSkill }), preview: preview(), onInstalled })
    expect(await screen.findByText('Work with PDF files')).toBeTruthy()
    expect(screen.getByText(en.previewScripts)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.install }))
    await waitFor(() => { expect(installSkill).toHaveBeenCalledWith('preview-1', undefined, false) })
    expect(onInstalled).toHaveBeenCalledWith(['pdf'])
    expect(await screen.findByText(en.installedNotice.replace('{names}', 'pdf'))).toBeTruthy()
  })

  it('reports a refused install in place', async () => {
    mount({ face: face({ installSkill: async () => failed('skill-install/network') }), preview: preview() })
    fireEvent.click(await screen.findByRole('button', { name: en.install }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining(en.installNetwork))
  })

  it('shows an unknown failure code with its own diagnostic', async () => {
    mount({ face: face({ installSkill: async () => failed('skill-install/unknown', 'boom') }), preview: preview() })
    fireEvent.click(await screen.findByRole('button', { name: en.install }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('boom'))
  })

  it('shows the failure a drop reported before the dialog opened', async () => {
    mount({ failure: en.dropTooLarge })
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining(en.dropTooLarge))
  })

  it('closes from the installed step', async () => {
    const onClose = vi.fn()
    mount({ face: face(), preview: preview(), onClose })
    fireEvent.click(await screen.findByRole('button', { name: en.install }))
    fireEvent.click(await screen.findByRole('button', { name: en.done }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('CatalogDialog conflict', () => {
  it('asks before replacing a taken name', async () => {
    const installSkill = vi.fn(async () => ({
      ok: true as const,
      value: { installed: [{ name: 'pdf', path: 'C:\\skills\\pdf', replaced: true }] },
    }))
    mount({ face: face({ installSkill }), preview: preview(true) })
    expect(await screen.findByRole('dialog', { name: en.conflictTitle.replace('{name}', 'pdf') })).toBeTruthy()
    expect(screen.getByText(en.conflictBody)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.conflictReplace }))
    await waitFor(() => { expect(installSkill).toHaveBeenCalledWith('preview-1', undefined, true) })
  })

  it('installs a taken name under a new one', async () => {
    const installSkill = vi.fn(async () => ({
      ok: true as const,
      value: { installed: [{ name: 'pdf-copy', path: 'C:\\skills\\pdf-copy', replaced: false }] },
    }))
    mount({ face: face({ installSkill }), preview: preview(true) })
    const field = await screen.findByPlaceholderText(en.conflictNamePlaceholder)
    expect(screen.getByRole('button', { name: en.conflictRename })).toHaveProperty('disabled', true)
    fireEvent.change(field, { target: { value: ' pdf-copy ' } })
    fireEvent.click(screen.getByRole('button', { name: en.conflictRename }))
    await waitFor(() => { expect(installSkill).toHaveBeenCalledWith('preview-1', 'pdf-copy', false) })
  })
})

describe('CatalogDialog opening state', () => {
  it('keeps the confirmation disabled while the tab reads a drop', async () => {
    mount({ busy: true, preview: preview() })
    const install = await screen.findByRole('button', { name: en.installing })
    expect(install).toHaveProperty('disabled', true)
  })

  it('closes from the catalog step', async () => {
    const onClose = vi.fn()
    mount({ onClose })
    fireEvent.click(await screen.findByRole('button', { name: en.close }))
    expect(onClose).toHaveBeenCalled()
    expect(within(document.body).queryByText(en.catalogDescription)).toBeTruthy()
  })
})
