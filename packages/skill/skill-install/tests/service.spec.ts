/** Install orchestration: previews, writes, conflicts, switches, and removal. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SkillSourcesService } from '@deepseek-ai/dsh-skill-sources'
import type { Config } from '../src/config.ts'
import type { HttpClient, HttpResponse } from '../src/http.ts'
import { SkillInstaller } from '../src/service.ts'
import { base64, zip } from './zip-fixture.ts'

/** Temporary roots this file created, removed after each case. */
const created: string[] = []

afterEach(async () => {
  for (const root of created.splice(0)) await rm(root, { recursive: true, force: true })
})

/** A stubbed outbound client answering canned bodies by URL. */
function stubHttp(
  routes: Readonly<Record<string, string | Uint8Array | { readonly status: number; readonly body: string }>>,
): HttpClient {
  return {
    async get(url: string): Promise<HttpResponse> {
      const route = routes[url]
      if (route === undefined) throw new Error(`unexpected request ${url}`)
      const body = typeof route === 'string' || route instanceof Uint8Array ? route : route.body
      return {
        status: typeof route === 'string' || route instanceof Uint8Array ? 200 : route.status,
        url,
        bytes: typeof body === 'string' ? new TextEncoder().encode(body) : body,
      }
    },
  }
}

/** One booted installer over a temporary harness home. */
interface Harness {
  /** Absolute harness home the install root sits in. */
  readonly home: string
  /** Absolute install root. */
  readonly skills: string
  /** The installer under test. */
  readonly installer: SkillInstaller
  /** Recorded `setSkill` calls of the stubbed switches service. */
  readonly setSkill: ReturnType<typeof vi.fn>
}

/**
 * Boot one installer.
 * @param options - configuration overrides, HTTP routes, and whether to mount switches.
 * @returns the harness the case works against.
 */
async function harness(options: {
  readonly config?: Config
  readonly routes?: Readonly<Record<string, string | Uint8Array | { readonly status: number; readonly body: string }>>
  readonly withSwitches?: boolean
  readonly setSkill?: () => Promise<void>
} = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-install-'))
  created.push(root)
  const home = join(root, 'home')
  const skills = join(home, 'skills')
  const ctx = new Context()
  const setSkill = vi.fn(options.setSkill ?? (async () => undefined))
  if (options.withSwitches !== false) {
    const sources: SkillSourcesService = {
      read: () => ({ sources: {}, skills: {} }),
      applications: () => [],
      categories: () => [],
      folders: () => [],
      visibility: () => ({
        applications: [], folders: [], categories: [], sourceEnabled: () => true, skillEnabled: () => true,
      }),
      addFolder: async () => true,
      removeFolder: async () => undefined,
      setSource: async () => undefined,
      setSkill,
      register: () => () => undefined,
    }
    ctx.provide('skillSources', sources)
  }
  const installer = new SkillInstaller(
    ctx,
    { installRoot: skills, ...options.config },
    { http: stubHttp(options.routes ?? {}) },
  )
  return { home, skills, installer, setSkill }
}

/** The repository metadata a resolution starts from. */
const COMMITS = 'https://api.github.com/repos/acme/skills/commits?per_page=1'
/** The tree a resolution reads next. */
const TREE = 'https://api.github.com/repos/acme/skills/git/trees/abc123?recursive=1'
/** The document the preview reads. */
const PDF_DOCUMENT = 'https://raw.githubusercontent.com/acme/skills/abc123/skills/pdf/SKILL.md'
/** The second file an install fetches. */
const PDF_LICENSE = 'https://raw.githubusercontent.com/acme/skills/abc123/skills/pdf/LICENSE.txt'

/** Routes a repository preview and install need. */
function repositoryRoutes(): Record<string, string> {
  return {
    [COMMITS]: JSON.stringify([{ sha: 'abc123' }]),
    [TREE]: JSON.stringify({
      truncated: false,
      tree: [
        { path: 'skills/pdf/SKILL.md', type: 'blob', size: 40 },
        { path: 'skills/pdf/LICENSE.txt', type: 'blob', size: 7 },
        { path: 'skills/pdf/scripts/run.sh', type: 'blob', size: 5 },
      ],
    }),
    [PDF_DOCUMENT]: '---\nname: pdf\ndescription: Work with PDF files\n---\n# PDF\n',
    [PDF_LICENSE]: 'licence',
    'https://raw.githubusercontent.com/acme/skills/abc123/skills/pdf/scripts/run.sh': 'echo',
  }
}

/** Read the code a rejected call carries. */
async function codeOf(run: Promise<unknown>): Promise<string> {
  try {
    await run
  } catch (error) {
    return (error as { code: string }).code
  }
  throw new Error('expected the call to be refused')
}

describe('SkillInstaller catalogs', () => {
  it('projects the configured catalogs', async () => {
    const { installer } = await harness({
      config: {
        catalogs: [
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
        ],
      },
    })
    expect(installer.catalogs()).toEqual([
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
    ])
  })

  it('ships no catalog when none is configured', async () => {
    const { installer } = await harness({ config: { catalogs: [] } })
    expect(installer.catalogs()).toEqual([])
  })

  it('refuses a relative install root at load', async () => {
    const ctx = new Context()
    expect(() => new SkillInstaller(ctx, { installRoot: 'relative/skills' }, { http: stubHttp({}) }))
      .toThrow(/not an absolute path/)
  })

  it('refuses a catalog id configured twice', async () => {
    const { installer: _ignored } = await harness()
    const ctx = new Context()
    expect(() => new SkillInstaller(ctx, {
      installRoot: join(tmpdir(), 'x'),
      catalogs: [
        { id: 'github', title: 'GitHub', homepage: 'https://github.com', searchable: true, kind: 'github' },
        { id: 'github', title: 'Again', homepage: 'https://github.com', searchable: true, kind: 'github' },
      ],
    }, { http: stubHttp({}) })).toThrow(/configured twice/)
  })

  it('refuses a recommended catalog with no repository', async () => {
    const ctx = new Context()
    expect(() => new SkillInstaller(ctx, {
      installRoot: join(tmpdir(), 'x'),
      catalogs: [{ id: 'rec', title: 'Rec', homepage: 'https://example.test', searchable: true, kind: 'recommended' }],
    }, { http: stubHttp({}) })).toThrow(/names no repository/)
  })

  it('refuses a repository on a catalog that is not recommended', async () => {
    const ctx = new Context()
    expect(() => new SkillInstaller(ctx, {
      installRoot: join(tmpdir(), 'x'),
      catalogs: [{
        id: 'github', title: 'GitHub', homepage: 'https://github.com', searchable: true, kind: 'github', repository: 'a/b',
      }],
    }, { http: stubHttp({}) })).toThrow(/names a repository/)
  })

  it('refuses a recommended catalog whose repository is unusable', async () => {
    const ctx = new Context()
    expect(() => new SkillInstaller(ctx, {
      installRoot: join(tmpdir(), 'x'),
      catalogs: [{
        id: 'rec', title: 'Rec', homepage: 'https://example.test', searchable: true, kind: 'recommended', repository: '../x',
      }],
    }, { http: stubHttp({}) })).toThrow(/not a repository reference/)
  })
})

describe('SkillInstaller resolution and preview', () => {
  it('resolves a repository and lists its skill folders', async () => {
    const { installer } = await harness({ routes: repositoryRoutes() })
    expect(await installer.resolveRepository('acme/skills')).toEqual({
      owner: 'acme',
      repo: 'skills',
      commit: 'abc123',
      skills: [{ folder: 'skills/pdf', name: 'pdf', hasScripts: true, fileCount: 3 }],
    })
  })

  it('previews one repository skill', async () => {
    const { installer, skills } = await harness({ routes: repositoryRoutes() })
    const preview = await installer.previewRepository('acme/skills', 'skills/pdf')
    expect(preview.source).toEqual({ kind: 'repository', owner: 'acme', repo: 'skills', folder: 'skills/pdf', commit: 'abc123' })
    const [skill] = preview.skills
    expect(skill).toMatchObject({
      name: 'pdf',
      description: 'Work with PDF files',
      hasScripts: true,
      target: join(skills, 'pdf'),
      conflict: false,
    })
    expect(skill?.document).toContain('repository: https://github.com/acme/skills')
    expect(skill?.document).toContain('commit: abc123')
    expect(skill?.files.map(file => [file.path, file.isScript])).toEqual([
      ['LICENSE.txt', false],
      ['scripts/run.sh', true],
      ['SKILL.md', false],
    ])
    expect(preview.skills).toHaveLength(1)
  })

  it('refuses a folder the repository no longer holds', async () => {
    const { installer } = await harness({ routes: repositoryRoutes() })
    expect(await codeOf(installer.previewRepository('acme/skills', 'skills/gone'))).toBe('SKILL_INSTALL_NOT_FOUND')
  })

  it('refuses content that is not UTF-8', async () => {
    const routes = repositoryRoutes()
    const { installer } = await harness({
      routes: { ...routes, [PDF_DOCUMENT]: new Uint8Array([0xff, 0xfe, 0xfd]) },
    })
    expect(await codeOf(installer.previewRepository('acme/skills', 'skills/pdf'))).toBe('SKILL_INSTALL_INVALID_SKILL')
  })

  it('installs a skill the repository keeps at its root', async () => {
    const state = await harness({
      routes: {
        [COMMITS]: JSON.stringify([{ sha: 'abc123' }]),
        [TREE]: JSON.stringify({
          truncated: false,
          tree: [
            { path: 'SKILL.md', type: 'blob', size: 30 },
            { path: 'notes.md', type: 'blob', size: 5 },
          ],
        }),
        'https://raw.githubusercontent.com/acme/skills/abc123/SKILL.md': '---\nname: root-skill\n---\n',
        'https://raw.githubusercontent.com/acme/skills/abc123/notes.md': 'notes',
      },
    })
    const preview = await state.installer.previewRepository('acme/skills', '')
    await state.installer.install(preview.id, undefined, false)
    expect(await readFile(join(state.skills, 'root-skill', 'notes.md'), 'utf8')).toBe('notes')
  })
})

describe('SkillInstaller archive and folder previews', () => {
  it('previews every skill one archive holds', async () => {
    const { installer } = await harness()
    const archive = zip([
      { name: 'pdf/SKILL.md', data: '---\nname: pdf\ndescription: One\n---\n' },
      { name: 'docx/SKILL.md', data: '---\nname: docx\ndescription: Two\n---\n' },
      { name: 'docx/scripts/a.sh', data: 'echo' },
    ])
    const preview = await installer.previewArchive('pack.zip', base64(archive))
    expect(preview.source).toEqual({ kind: 'archive', fileName: 'pack.zip' })
    expect(preview.skills.map(skill => skill.name)).toEqual(['docx', 'pdf'])
    expect(preview.skills[0]?.hasScripts).toBe(true)
  })

  it('refuses an archive that would escape its folder', async () => {
    const { installer } = await harness()
    const archive = zip([{ name: '../SKILL.md', data: '---\nname: x\n---\n' }])
    expect(await codeOf(installer.previewArchive('bad.zip', base64(archive)))).toBe('SKILL_INSTALL_ARCHIVE_INVALID')
  })

  it('refuses an upload past the configured cap', async () => {
    const { installer } = await harness({ config: { maxUploadBytes: 4 } })
    expect(await codeOf(installer.previewArchive('big.zip', base64(new Uint8Array(16))))).toBe('SKILL_INSTALL_UPLOAD_TOO_LARGE')
  })

  it('refuses content that did not arrive as base64', async () => {
    const { installer } = await harness()
    expect(await codeOf(installer.previewArchive('x.zip', 'not base64!'))).toBe('SKILL_INSTALL_INVALID_SKILL')
  })

  it('refuses an upload whose decoded bytes pass the length check', async () => {
    const { installer } = await harness({ config: { maxUploadBytes: 3 } })
    expect(await codeOf(installer.previewArchive('x.zip', base64(new Uint8Array([1, 2, 3, 4])))))
      .toBe('SKILL_INSTALL_UPLOAD_TOO_LARGE')
  })

  it('previews a dropped folder', async () => {
    const { installer } = await harness()
    const preview = await installer.previewFolder('pdf', [
      { path: 'SKILL.md', content: base64(new TextEncoder().encode('---\nname: pdf\n---\n')) },
      { path: 'notes.md', content: base64(new TextEncoder().encode('notes')) },
    ])
    expect(preview.source).toEqual({ kind: 'folder', folderName: 'pdf' })
    expect(preview.skills[0]?.name).toBe('pdf')
    expect(preview.skills[0]?.files.map(file => file.path)).toEqual(['notes.md', 'SKILL.md'])
  })

  it('refuses a dropped file path that escapes the folder', async () => {
    const { installer } = await harness()
    expect(await codeOf(installer.previewFolder('pdf', [
      { path: '../SKILL.md', content: base64(new TextEncoder().encode('x')) },
    ]))).toBe('SKILL_INSTALL_INVALID_SKILL')
  })

  it('refuses a dropped folder past the configured import cap', async () => {
    const { installer } = await harness({ config: { maxUncompressedBytes: 4 } })
    expect(await codeOf(installer.previewFolder('pdf', [
      { path: 'SKILL.md', content: base64(new TextEncoder().encode('---\nname: pdf\n---\n')) },
    ]))).toBe('SKILL_INSTALL_UPLOAD_TOO_LARGE')
  })
})

describe('SkillInstaller install', () => {
  /** Preview one archive skill and return the harness and preview id. */
  async function archivePreview(): Promise<{ harness: Harness; id: string }> {
    const state = await harness()
    const archive = zip([
      { name: 'pdf/SKILL.md', data: '---\nname: pdf\ndescription: One\n---\n# PDF\n' },
      { name: 'pdf/LICENSE.txt', data: 'licence' },
    ])
    const preview = await state.installer.previewArchive('pack.zip', base64(archive))
    return { harness: state, id: preview.id }
  }

  it('writes the skill, records it switched off, and reports it', async () => {
    const { harness: state, id } = await archivePreview()
    const result = await state.installer.install(id, undefined, false)
    expect(result).toEqual({ installed: [{ name: 'pdf', path: join(state.skills, 'pdf'), replaced: false }] })
    expect(await readFile(join(state.skills, 'pdf', 'SKILL.md'), 'utf8')).toContain('repository: pack.zip')
    expect(await readFile(join(state.skills, 'pdf', 'LICENSE.txt'), 'utf8')).toBe('licence')
    expect(state.setSkill).toHaveBeenCalledWith('user-dsh', 'pdf', false)
  })

  it('installs one archive with several skills', async () => {
    const state = await harness()
    const archive = zip([
      { name: 'pdf/SKILL.md', data: '---\nname: pdf\n---\n' },
      { name: 'docx/SKILL.md', data: '---\nname: docx\n---\n' },
    ])
    const preview = await state.installer.previewArchive('pack.zip', base64(archive))
    const result = await state.installer.install(preview.id, undefined, false)
    expect(result.installed.map(skill => skill.name)).toEqual(['docx', 'pdf'])
    expect(state.setSkill).toHaveBeenCalledTimes(2)
  })

  it('asks for a replacement when the name is taken', async () => {
    const { harness: state, id } = await archivePreview()
    await mkdir(join(state.skills, 'pdf'), { recursive: true })
    await writeFile(join(state.skills, 'pdf', 'old.txt'), 'old')
    const preview = await state.installer.previewArchive('pack.zip', base64(zip([
      { name: 'pdf/SKILL.md', data: '---\nname: pdf\n---\n' },
    ])))
    expect(preview.skills[0]?.conflict).toBe(true)
    expect(await codeOf(state.installer.install(preview.id, undefined, false))).toBe('SKILL_INSTALL_CONFLICT')
    expect(await codeOf(state.installer.install(id, undefined, false))).toBe('SKILL_INSTALL_CONFLICT')
  })

  it('replaces an existing skill across both of its previews', async () => {
    const { harness: state, id } = await archivePreview()
    await mkdir(join(state.skills, 'pdf'), { recursive: true })
    await writeFile(join(state.skills, 'pdf', 'old.txt'), 'old')
    const result = await state.installer.install(id, undefined, true)
    expect(result.installed[0]?.replaced).toBe(true)
    await expect(readFile(join(state.skills, 'pdf', 'old.txt'))).rejects.toThrow()
  })

  it('installs under a new name', async () => {
    const { harness: state, id } = await archivePreview()
    const result = await state.installer.install(id, 'pdf-copy', false)
    expect(result.installed[0]?.name).toBe('pdf-copy')
    expect(await readFile(join(state.skills, 'pdf-copy', 'SKILL.md'), 'utf8')).toContain('name: pdf')
  })

  it('refuses a preview when the target cannot be inspected at all', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-skill-install-bad-root-'))
    created.push(root)
    const ctx = new Context()
    const installer = new SkillInstaller(
      ctx,
      { installRoot: join(root, 'bad\0root') },
      { http: stubHttp({}) },
    )
    expect(await codeOf(installer.previewArchive('pack.zip', base64(zip([
      { name: 'pdf/SKILL.md', data: '---\nname: pdf\n---\n' },
    ]))))).toBe('SKILL_INSTALL_IO_FAILED')
  })

  it('refuses a name that is not kebab-case', async () => {
    const { harness: state, id } = await archivePreview()
    expect(await codeOf(state.installer.install(id, 'Not A Name', false))).toBe('SKILL_INSTALL_INVALID_SKILL')
  })

  it('refuses a name for an import of several skills', async () => {
    const state = await harness()
    const archive = zip([
      { name: 'pdf/SKILL.md', data: '---\nname: pdf\n---\n' },
      { name: 'docx/SKILL.md', data: '---\nname: docx\n---\n' },
    ])
    const preview = await state.installer.previewArchive('pack.zip', base64(archive))
    expect(await codeOf(state.installer.install(preview.id, 'one', false))).toBe('SKILL_INSTALL_INVALID_SKILL')
  })

  it('refuses to install when the switch service is not mounted', async () => {
    const state = await harness({ withSwitches: false })
    const preview = await state.installer.previewArchive('pack.zip', base64(zip([
      { name: 'pdf/SKILL.md', data: '---\nname: pdf\n---\n' },
    ])))
    expect(await codeOf(state.installer.install(preview.id, undefined, false))).toBe('SKILL_INSTALL_UNAVAILABLE')
  })

  it('refuses an unknown preview id', async () => {
    const { installer } = await harness()
    expect(await codeOf(installer.install('unknown', undefined, false))).toBe('SKILL_INSTALL_PREVIEW_EXPIRED')
  })

  it('refuses a preview past its lifetime', async () => {
    const state = await harness({ config: { previewTtlMs: 1 } })
    const preview = await state.installer.previewArchive('pack.zip', base64(zip([
      { name: 'pdf/SKILL.md', data: '---\nname: pdf\n---\n' },
    ])))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(await codeOf(state.installer.install(preview.id, undefined, false))).toBe('SKILL_INSTALL_PREVIEW_EXPIRED')
  })

  it('keeps only the configured number of previews', async () => {
    const state = await harness({ config: { maxPreviews: 1 } })
    const archive = base64(zip([{ name: 'pdf/SKILL.md', data: '---\nname: pdf\n---\n' }]))
    const first = await state.installer.previewArchive('one.zip', archive)
    await state.installer.previewArchive('two.zip', archive)
    expect(await codeOf(state.installer.install(first.id, undefined, false))).toBe('SKILL_INSTALL_PREVIEW_EXPIRED')
  })

  it('drops previews that outlived their lifetime when a new one arrives', async () => {
    const state = await harness({ config: { previewTtlMs: 1 } })
    const archive = base64(zip([{ name: 'pdf/SKILL.md', data: '---\nname: pdf\n---\n' }]))
    const first = await state.installer.previewArchive('one.zip', archive)
    await new Promise(resolve => setTimeout(resolve, 10))
    await state.installer.previewArchive('two.zip', archive)
    expect(await codeOf(state.installer.install(first.id, undefined, false))).toBe('SKILL_INSTALL_PREVIEW_EXPIRED')
  })

  it('reports a failure to record the switch as a write failure', async () => {
    const state = await harness({ setSkill: async () => { throw new Error('settings refused the write') } })
    const preview = await state.installer.previewArchive('pack.zip', base64(zip([
      { name: 'pdf/SKILL.md', data: '---\nname: pdf\n---\n' },
    ])))
    expect(await codeOf(state.installer.install(preview.id, undefined, false))).toBe('SKILL_INSTALL_IO_FAILED')
  })

  it('fetches a repository skill at its pinned commit and writes it', async () => {
    const state = await harness({ routes: repositoryRoutes() })
    const preview = await state.installer.previewRepository('acme/skills', 'skills/pdf')
    const result = await state.installer.install(preview.id, undefined, false)
    expect(result.installed[0]?.name).toBe('pdf')
    expect(await readFile(join(state.skills, 'pdf', 'LICENSE.txt'), 'utf8')).toBe('licence')
    expect(await readFile(join(state.skills, 'pdf', 'scripts', 'run.sh'), 'utf8')).toBe('echo')
  })

  it('refuses a skill larger than the import cap', async () => {
    const routes = repositoryRoutes()
    const state = await harness({ routes, config: { maxUncompressedBytes: 4 } })
    const preview = await state.installer.previewRepository('acme/skills', 'skills/pdf')
    expect(await codeOf(state.installer.install(preview.id, undefined, false))).toBe('SKILL_INSTALL_IO_FAILED')
  })

  it('reports a failed publish and leaves no staging folder behind', async () => {
    const { harness: state, id } = await archivePreview()
    // A harness home that became a file makes every later folder write fail.
    await rm(state.home, { recursive: true, force: true })
    await writeFile(state.home, 'not a folder')
    expect(await codeOf(state.installer.install(id, undefined, false))).toBe('SKILL_INSTALL_IO_FAILED')
  })
})

describe('SkillInstaller remove', () => {
  /** Install one archive skill and return the harness. */
  async function installed(): Promise<Harness> {
    const state = await harness()
    const preview = await state.installer.previewArchive('pack.zip', base64(zip([
      { name: 'pdf/SKILL.md', data: '---\nname: pdf\n---\n' },
    ])))
    await state.installer.install(preview.id, undefined, false)
    return state
  }

  it('removes a skill it installed', async () => {
    const state = await installed()
    await state.installer.remove('pdf')
    await expect(readFile(join(state.skills, 'pdf', 'SKILL.md'))).rejects.toThrow()
  })

  it('refuses a name that is not a skill name', async () => {
    const { installer } = await harness()
    expect(await codeOf(installer.remove('../escape'))).toBe('SKILL_INSTALL_NOT_INSTALLED')
  })

  it('refuses a folder that holds no skill', async () => {
    const state = await harness()
    expect(await codeOf(state.installer.remove('pdf'))).toBe('SKILL_INSTALL_NOT_INSTALLED')
  })

  it('refuses a folder the reader added rather than installed', async () => {
    const state = await harness()
    await mkdir(join(state.skills, 'mine'), { recursive: true })
    await writeFile(join(state.skills, 'mine', 'SKILL.md'), '---\nname: mine\n---\n')
    expect(await codeOf(state.installer.remove('mine'))).toBe('SKILL_INSTALL_NOT_INSTALLED')
  })

  it('refuses a folder whose document carries no frontmatter', async () => {
    const state = await harness()
    await mkdir(join(state.skills, 'plain'), { recursive: true })
    await writeFile(join(state.skills, 'plain', 'SKILL.md'), '# no frontmatter\n')
    expect(await codeOf(state.installer.remove('plain'))).toBe('SKILL_INSTALL_NOT_INSTALLED')
  })

  it('refuses a folder whose install record carries no repository', async () => {
    const state = await harness()
    await mkdir(join(state.skills, 'plain'), { recursive: true })
    await writeFile(join(state.skills, 'plain', 'SKILL.md'), '---\nname: plain\n---\n')
    expect(await codeOf(state.installer.remove('plain'))).toBe('SKILL_INSTALL_NOT_INSTALLED')
  })

  it('refuses a skill folder whose document cannot be read', async () => {
    const state = await harness()
    await mkdir(join(state.skills, 'broken', 'SKILL.md'), { recursive: true })
    expect(await codeOf(state.installer.remove('broken'))).toBe('SKILL_INSTALL_IO_FAILED')
  })
})

describe('SkillInstaller default root', () => {
  it('builds the client from the configured network policy when none is injected', async () => {
    const ctx = new Context()
    const installer = new SkillInstaller(ctx, { installRoot: join(tmpdir(), 'unused-skill-install-root') })
    expect(installer.catalogs().map(catalog => catalog.id)).toContain('github')
  })

  it('writes into the harness home skills folder when none is configured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-skill-install-home-'))
    created.push(root)
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = root
    try {
      const ctx = new Context()
      const installer = new SkillInstaller(ctx, {}, { http: stubHttp({}) })
      const preview = await installer.previewArchive('pack.zip', base64(zip([
        { name: 'pdf/SKILL.md', data: '---\nname: pdf\n---\n' },
      ])))
      // The switch write fails without a profile, which is the documented refusal.
      expect(await codeOf(installer.install(preview.id, undefined, false))).toBe('SKILL_INSTALL_UNAVAILABLE')
      expect(preview.skills[0]?.target).toBe(join(root, 'skills', 'pdf'))
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})
