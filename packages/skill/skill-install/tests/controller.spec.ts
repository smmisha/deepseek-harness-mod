/** The Remote face: what each call answers and how failures are translated. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { SkillSourcesService } from '@deepseek-ai/dsh-skill-sources'
import SkillInstallController from '../src/index.ts'
import type { HttpClient, HttpResponse } from '../src/http.ts'
import { base64, zip } from './zip-fixture.ts'

/** Temporary roots this file created, removed after each case. */
const created: string[] = []

afterEach(async () => {
  for (const root of created.splice(0)) await rm(root, { recursive: true, force: true })
})

/** A stubbed outbound client answering canned bodies by URL. */
function stubHttp(routes: Readonly<Record<string, string>>): HttpClient {
  return {
    async get(url: string): Promise<HttpResponse> {
      const body = routes[url]
      if (body === undefined) throw new Error(`unexpected request ${url}`)
      return { status: 200, url, bytes: new TextEncoder().encode(body) }
    },
  }
}

/** One booted controller over a temporary harness home. */
async function harness(routes: Readonly<Record<string, string>> = {}): Promise<SkillInstallController> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-install-controller-'))
  created.push(root)
  const ctx = new Context()
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
    setSkill: async () => undefined,
    register: () => () => undefined,
  }
  ctx.provide('skillSources', sources)
  return new SkillInstallController(ctx, { installRoot: join(root, 'skills') }, { http: stubHttp(routes) })
}

/** The failure one rejected call carries. */
async function failureOf(run: Promise<unknown>): Promise<RemoteError> {
  try {
    await run
  } catch (error) {
    return error as RemoteError
  }
  throw new Error('expected the call to be refused')
}

/** Routes a repository preview and install need. */
function repositoryRoutes(): Record<string, string> {
  return {
    'https://api.github.com/repos/acme/skills/commits?per_page=1': JSON.stringify([{ sha: 'abc123' }]),
    'https://api.github.com/repos/acme/skills/git/trees/abc123?recursive=1': JSON.stringify({
      truncated: false,
      tree: [{ path: 'skills/pdf/SKILL.md', type: 'blob', size: 40 }],
    }),
    'https://raw.githubusercontent.com/acme/skills/abc123/skills/pdf/SKILL.md': '---\nname: pdf\ndescription: Files\n---\n',
  }
}

describe('SkillInstallController', () => {
  it('answers the configured catalogs', async () => {
    const controller = await harness()
    expect((await controller.catalogs()).map(catalog => catalog.id)).toEqual([
      'github', 'anthropics', 'skills.sh', 'skillsmp', 'skills-hub',
    ])
  })

  it('resolves a repository', async () => {
    const controller = await harness(repositoryRoutes())
    expect(await controller.repository('acme/skills')).toMatchObject({ owner: 'acme', repo: 'skills', commit: 'abc123' })
  })

  it('previews, installs, and removes a repository skill', async () => {
    const controller = await harness(repositoryRoutes())
    const preview = await controller.previewRepository('acme/skills', 'skills/pdf')
    expect(preview.skills[0]?.name).toBe('pdf')
    const result = await controller.install(preview.id, undefined, false)
    expect(result.installed.map(skill => skill.name)).toEqual(['pdf'])
    await controller.remove('pdf')
  })

  it('previews an archive and installs it', async () => {
    const controller = await harness()
    const preview = await controller.previewArchive('pack.zip', base64(zip([
      { name: 'pdf/SKILL.md', data: '---\nname: pdf\n---\n' },
    ])))
    expect(preview.source).toEqual({ kind: 'archive', fileName: 'pack.zip' })
    expect((await controller.install(preview.id, 'pdf-copy', false)).installed[0]?.name).toBe('pdf-copy')
  })

  it('previews a dropped folder', async () => {
    const controller = await harness()
    const preview = await controller.previewFolder('pdf', [
      { path: 'SKILL.md', content: base64(new TextEncoder().encode('---\nname: pdf\n---\n')) },
    ])
    expect(preview.skills[0]?.name).toBe('pdf')
  })

  it('translates a typed failure into the namespace code and details', async () => {
    const controller = await harness()
    const failure = await failureOf(controller.repository('not a repository'))
    expect(failure.code).toBe('skill-install/spec-invalid')
    expect(failure.details).toEqual({ target: 'not a repository' })
  })

  it('carries the folder as the failure target', async () => {
    const controller = await harness(repositoryRoutes())
    const failure = await failureOf(controller.previewRepository('acme/skills', 'skills/gone'))
    expect([failure.code, failure.details]).toEqual(['skill-install/not-found', { target: 'skills/gone' }])
  })

  it('translates a conflict', async () => {
    const controller = await harness(repositoryRoutes())
    const first = await controller.previewRepository('acme/skills', 'skills/pdf')
    await controller.install(first.id, undefined, false)
    const second = await controller.previewRepository('acme/skills', 'skills/pdf')
    expect((await failureOf(controller.install(second.id, undefined, false))).code).toBe('skill-install/conflict')
  })

  it('translates a refused removal', async () => {
    const controller = await harness()
    expect((await failureOf(controller.remove('missing'))).code).toBe('skill-install/not-installed')
  })

  it('translates a refused archive', async () => {
    const controller = await harness()
    expect((await failureOf(controller.previewArchive('bad.zip', base64(zip([
      { name: '../SKILL.md', data: '---\nname: x\n---\n' },
    ]))))).code).toBe('skill-install/archive-invalid')
  })

  it('passes a foreign failure through unchanged', async () => {
    const controller = await harness()
    const error = await failureOf(controller.repository('acme/skills'))
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(RemoteError)
    expect((error as Error).message).toContain('unexpected request')
  })
})
