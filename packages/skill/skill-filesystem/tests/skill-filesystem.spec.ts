import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { FileSystem, FsError, FsVersion, type FsDirEntry, type FsEditOutcome, type FsEditRequest, type FsInfo, type FsPathInfo, type FsTarget, type FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import * as SkillFileSystem from '../src/index.ts'
import SkillSources, { type SkillSourcesService } from '@deepseek-ai/dsh-skill-sources'

/** Every temp dir created by this file, removed after each test. */
const tempDirs: string[] = []
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempDir(name: string): Promise<string> {
  const dir = await import('node:fs/promises').then(fs => fs.mkdtemp(join(tmpdir(), `dsh-${name}-`)))
  tempDirs.push(dir)
  return await realpath(dir)
}

async function writeSkill(root: string, name: string, description: string, body = 'Use the skill.'): Promise<void> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`)
}

async function writeFlatSkill(root: string, name: string, description: string, body = 'Flat body.'): Promise<void> {
  await mkdir(root, { recursive: true })
  await writeFile(join(root, `${name}.md`), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`)
}

class TestFileSystem extends FileSystem {
  override async patchText(): Promise<never> { throw new FsError('patch unsupported by test provider', 'FS_IO_ERROR') }
  override async deleteFile(): Promise<never> { throw new FsError('delete unsupported by test provider', 'FS_IO_ERROR') }
  override async moveFile(): Promise<never> { throw new FsError('move unsupported by test provider', 'FS_IO_ERROR') }

  override watch(): never { throw new Error('Fixture does not support watching') }
  listDirCalls = 0
  failResolvePaths = new Set<string>()
  failStatPaths = new Set<string>()
  failListDirPaths = new Set<string>()
  errorResolvePaths = new Set<string>()
  errorStatPaths = new Set<string>()
  errorReadPaths = new Set<string>()
  missingReadPaths = new Set<string>()
  statOverrides = new Map<string, FsInfo | undefined>()
  statSignals: Array<AbortSignal | undefined> = []
  readTextSignals: Array<AbortSignal | undefined> = []
  readTextOverride?: (target: FsTarget, signal?: AbortSignal) => Promise<string>

  override async resolve(path: string): Promise<FsTarget> {
    if (this.failResolvePaths.has(path)) throw new FsError('resolve failed', 'FS_NOT_FOUND')
    if (this.errorResolvePaths.has(path)) throw new Error('resolve temporarily failed')
    return { targetKey: path as never, displayPath: path }
  }

  override processPath(target: FsTarget): string { return String(target.targetKey) }

  override fileUrl(target: FsTarget): string { return `file://${target.targetKey}` }

  override contains(parent: FsTarget, child: FsTarget): boolean {
    return child.targetKey === parent.targetKey || String(child.targetKey).startsWith(`${parent.targetKey}/`)
  }

  override async stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined> {
    this.statSignals.push(signal)
    if (this.failStatPaths.has(target.displayPath)) throw new FsError('stat failed', 'FS_NOT_FOUND')
    if (this.errorStatPaths.has(target.displayPath)) throw new Error('stat temporarily failed')
    if (this.statOverrides.has(target.displayPath)) return this.statOverrides.get(target.displayPath)
    try {
      const fs = await import('node:fs/promises')
      const info = await fs.stat(target.displayPath)
      return {
        version: FsVersion(String(info.mtimeMs)),
        type: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other',
        size: info.size,
      }
    } catch {
      return undefined
    }
  }

  override async lstat(path: string): Promise<FsPathInfo | undefined> {
    try {
      const fs = await import('node:fs/promises')
      const info = await fs.lstat(path)
      return {
        version: FsVersion(String(info.mtimeMs)),
        type: info.isSymbolicLink() ? 'symlink' : info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other',
        size: info.size,
      }
    } catch {
      return undefined
    }
  }

  override async readText(target: FsTarget, signal?: AbortSignal): Promise<string> {
    this.readTextSignals.push(signal)
    if (this.readTextOverride !== undefined) return await this.readTextOverride(target, signal)
    if (this.missingReadPaths.has(target.displayPath)) throw new FsError('read failed', 'FS_NOT_FOUND')
    if (this.errorReadPaths.has(target.displayPath)) throw new Error('read temporarily failed')
    const text = await readFile(target.displayPath, 'utf8')
    if (text.includes('\uFFFD')) throw new FsError('not text', 'FS_NOT_TEXT')
    return text
  }

  override async streamText(_target: FsTarget): Promise<AsyncIterable<string>> {
    throw new Error('not needed in skill tests')
  }

  override async readBytes(_target: FsTarget, _signal: AbortSignal | undefined, _maxBytes: number): Promise<Uint8Array> {
    throw new Error('not needed in skill tests')
  }

  override async readByteRange(_target: FsTarget, _range: { offset: number; length: number }, _signal?: AbortSignal): Promise<Uint8Array> {
    throw new Error('not needed in skill tests')
  }

  override async listDir(target: FsTarget): Promise<FsDirEntry[]> {
    this.listDirCalls += 1
    if (this.failListDirPaths.has(target.displayPath)) throw new Error('list temporarily failed')
    const entries = await readdir(target.displayPath, { withFileTypes: true, encoding: 'utf8' })
    const result: FsDirEntry[] = []
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const childPath = join(target.displayPath, entry.name)
      let type: FsInfo['type'] = 'other'
      let size: number | undefined
      try {
        const info = await stat(childPath)
        type = info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other'
        size = info.isFile() ? info.size : undefined
      } catch {
        type = 'other'
      }
      result.push({
        name: entry.name,
        type,
        target: { targetKey: childPath as never, displayPath: childPath },
        version: FsVersion('test'),
        ...(size !== undefined ? { size } : {}),
      })
    }
    return result
  }

  override async writeText(target: FsTarget, content: string): Promise<FsWriteOutcome> {
    await mkdir(dirname(target.displayPath), { recursive: true })
    await writeFile(target.displayPath, content)
    return { operation: 'create', version: FsVersion('test'), before: null, after: content }
  }

  override async editText(_target: FsTarget, _request: FsEditRequest): Promise<FsEditOutcome> {
    throw new Error('not needed in skill tests')
  }
}

type SwitchConfig = {
  applications?: { id: string; dir: string; title: string }[]
  sources?: Record<string, { enabled: boolean }>
  skills?: Record<string, Record<string, boolean>>
}

async function setupLocal(
  home: string,
  config: Partial<SkillFileSystem.Config> = {},
  switches: SwitchConfig = {},
): Promise<Context> {
  const ctx = new Context()
  ctx.provide('settings', { update: async () => undefined })
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillSources, switches)
  await ctx.plugin(SkillFileSystem, {
    dshHome: join(home, '.dsh'),
    agentsHome: join(home, '.agents'),
    watch: false,
    ...config,
  })
  return ctx
}

/** Describe the mounted provider the way the Skills tab does. */
async function describeSources(ctx: Context, cwd?: string): Promise<SkillFileSystem.LocalSourceView[]> {
  const controller = ctx.root.get('skillSourcesController') as
    { describe(directory: string | undefined): Promise<SkillFileSystem.LocalSourceView[]> } | undefined
  if (controller === undefined) throw new Error('skillSourcesController is not mounted')
  return await controller.describe(cwd)
}

/** Windows without Developer Mode refuses symlink creation, so those fixtures cannot run here. */
const symlinksAvailable = await probeSymlinks()

async function probeSymlinks(): Promise<boolean> {
  const dir = await tempDir('symlink-probe')
  try {
    await symlink(join(dir, 'target'), join(dir, 'link'))
    return true
  } catch {
    return false
  }
}

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5000
  while (true) {
    const value = await read()
    if (accept(value)) return value
    if (Date.now() >= deadline) throw new Error('timed out waiting for watcher state')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

describe('dsh-skill-filesystem plugin exports', () => {
  it('declares stable plugin metadata', () => {
    expect(SkillFileSystem.name).toBe('skill-filesystem')
    expect(SkillFileSystem.inject).toEqual(['skills'])
  })
})

describe('FileSystemSkillProvider', () => {
  it('keeps another application folder switched off until the source is enabled', async () => {
    const home = await tempDir('application-roots')
    const project = await tempDir('application-roots-project')
    const appRoot = join(home, '.claude', 'skills')
    await writeSkill(appRoot, 'shared-skill', 'From another application')
    await writeSkill(appRoot, 'app-only-skill', 'Available only through the other application')
    await writeSkill(join(home, '.dsh', 'skills'), 'shared-skill', 'From the harness')
    const applications = [
      { id: 'claude-code', dir: appRoot, title: 'Claude Code' },
      { id: 'codex', dir: join(home, '.codex', 'skills'), title: 'Codex' },
    ]

    const off = await setupLocal(home, {}, { applications })
    const hidden = await off.skills.list({ cwd: project })
    expect(hidden.find(skill => skill.name === 'shared-skill')?.source).toBe('user-dsh')
    expect(hidden.find(skill => skill.name === 'app-only-skill')).toBeUndefined()

    const on = await setupLocal(home, {}, {
      applications,
      sources: { 'claude-code': { enabled: true } },
    })
    const listed = await on.skills.list({ cwd: project })
    expect(listed.find(skill => skill.name === 'shared-skill')?.source).toBe('user-dsh')
    expect(listed.find(skill => skill.name === 'app-only-skill')?.source).toBe('claude-code')
  })

  it('describes titles, the disabled state, and the separate shadowed marker', async () => {
    const home = await tempDir('describe-sources')
    const project = await tempDir('describe-sources-project')
    const appRoot = join(home, '.claude', 'skills')
    await writeSkill(appRoot, 'shared-skill', 'From another application')
    await writeSkill(appRoot, 'hidden-skill', 'Switched off inside an enabled source')
    await writeSkill(join(home, '.dsh', 'skills'), 'shared-skill', 'From the harness')
    await mkdir(join(appRoot, 'zzz-broken'), { recursive: true })
    await writeFile(join(appRoot, 'zzz-broken', 'SKILL.md'), 'no frontmatter here')
    await mkdir(join(appRoot, 'aaa-broken'), { recursive: true })
    await writeFile(join(appRoot, 'aaa-broken', 'SKILL.md'), 'still no frontmatter')

    const ctx = await setupLocal(home, {}, {
      applications: [{ id: 'claude-code', dir: appRoot, title: 'Claude Code' }],
      sources: { 'claude-code': { enabled: true } },
      skills: { 'claude-code': { 'hidden-skill': false } },
    })
    const views = await describeSources(ctx, project)
    const application = views.find(view => view.id === 'claude-code')
    const harness = views.find(view => view.id === 'user-dsh')

    expect(harness?.skills.find(skill => skill.name === 'shared-skill')?.shadowedBy).toBeUndefined()
    expect(application?.kind).toBe('application')
    expect(application?.title).toBe('Claude Code')
    expect(application?.enabled).toBe(true)
    expect(application?.skills.find(skill => skill.name === 'shared-skill')).toMatchObject({
      status: 'available',
      shadowedBy: 'user-dsh',
    })
    expect(application?.skills.find(skill => skill.name === 'hidden-skill')).toMatchObject({ status: 'disabled' })
    const brokenPaths = (application?.skills ?? []).filter(skill => skill.status === 'invalid').map(skill => skill.path)
    expect(brokenPaths).toHaveLength(2)
    expect(new Set(brokenPaths).size).toBe(brokenPaths.length)
  })

  it('controller writes switches, hides a switched-off skill from get, and describes missing applications', async () => {
    const home = await tempDir('switches-and-missing')
    const project = await tempDir('switches-and-missing-project')
    const appRoot = join(home, '.claude', 'skills')
    await writeSkill(appRoot, 'shared-skill', 'From another application')
    await writeSkill(appRoot, 'claude-only', 'Only in Claude')
    await writeSkill(join(home, '.dsh', 'skills'), 'shared-skill', 'From the harness')
    const updates: unknown[] = []
    const ctx = new Context()
    ctx.provide('settings', { update: async (...args: unknown[]) => { updates.push(args) } })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillSources, {
      applications: [
        { id: 'claude-code', dir: appRoot, title: 'Claude Code' },
        { id: 'codex', dir: join(home, '.codex', 'skills'), title: 'Codex' },
      ],
      sources: { 'claude-code': { enabled: true } },
      skills: { 'claude-code': { 'claude-only': false } },
    })
    await ctx.plugin(SkillFileSystem, { dshHome: join(home, '.dsh'), agentsHome: join(home, '.agents'), watch: false, customSkillDirs: [join(project, 'extra')] })
    const controller = ctx.root.get('skillSourcesController') as {
      setSource(source: string, enabled: boolean): Promise<void>
      setSkill(source: string, name: string, enabled: boolean): Promise<void>
    }
    await controller.setSource('codex', true)
    await controller.setSkill('codex', 'x', false)
    expect(updates).toHaveLength(2)
    expect(await ctx.skills.get('claude-only', { cwd: project })).toBeUndefined()
    const views = await describeSources(ctx, project)
    expect(views.find(view => view.id === 'codex')).toMatchObject({ exists: false, enabled: false })
    const cached = await describeSources(ctx, project)
    expect(cached).toHaveLength(views.length)
    const withoutCwd = await describeSources(ctx)
    expect(withoutCwd.length).toBeGreaterThan(0)
  })

  it('scans added folders, lists a missing one for removal, and validates folders the tab adds', async () => {
    const home = await tempDir('added-folders')
    const project = await tempDir('added-folders-project')
    const team = await tempDir('added-folders-team')
    const gone = join(home, 'gone-skills')
    await writeSkill(team, 'team-skill', 'From an added folder')
    const updates: unknown[] = []
    const ctx = new Context()
    ctx.provide('settings', { update: async (...args: unknown[]) => { updates.push(args) } })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillSources, { applications: [], folders: [{ dir: team }, { dir: gone }] })
    await ctx.plugin(SkillFileSystem, { dshHome: join(home, '.dsh'), agentsHome: join(home, '.agents'), watch: false })
    // A folder stored without a switch record keeps the non-application
    // default, so its skill reaches the catalog as it always did.
    expect(await ctx.skills.get('team-skill', { cwd: project })).toBeDefined()
    const views = await describeSources(ctx, project)
    expect(views.find(view => view.id === `folder:${team}`)).toMatchObject({
      kind: 'folder', title: basename(team), exists: true, enabled: true,
    })
    expect(views.find(view => view.id === `folder:${gone}`)).toMatchObject({ kind: 'folder', exists: false, skills: [] })

    const controller = ctx.root.get('skillSourcesController') as {
      addFolder(dir: unknown): Promise<string>
      removeFolder(dir: string): Promise<void>
    }
    expect(await controller.addFolder('relative/skills')).toBe('relative')
    expect(await controller.addFolder(42)).toBe('relative')
    expect(await controller.addFolder(join(home, 'nowhere'))).toBe('missing')
    expect(await controller.addFolder(`  ${team}  `)).toBe('exists')
    const extra = await tempDir('added-folders-extra')
    expect(await controller.addFolder(extra)).toBe('added')
    await controller.removeFolder(team)
    expect(updates).toEqual([
      ['skill-sources', {
        folders: [{ dir: team }, { dir: gone }, { dir: extra }],
        // The tab's new folder is written switched off until the reader turns it on.
        sources: { [`folder:${extra}`]: { enabled: false } },
      }, undefined],
      ['skill-sources', { folders: [{ dir: gone }] }, undefined],
    ])
  })

  it('expands a home-relative folder the tab adds', async () => {
    const home = await tempDir('added-folders-tilde')
    const ctx = await setupLocal(home)
    const controller = ctx.root.get('skillSourcesController') as { addFolder(dir: string): Promise<string> }
    // `~` alone is the Host user's home, which exists; `~name` is not a home reference.
    expect(await controller.addFolder('~')).toBe('added')
    expect(await controller.addFolder('~nobody/skills')).toBe('relative')
  })

  it.skipIf(process.platform === 'win32')('shortens roots outside the home folder and a folder equal to home', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'dsh-fs-'))
    tempDirs.push(outside)
    await writeSkill(join(outside, '.dsh', 'skills'), 'out-skill', 'Outside the home folder')
    const ctx = await setupLocal(outside, { customSkillDirs: [homedir()] })
    const views = await describeSources(ctx, outside)
    expect(views.find(view => view.id === 'project-dsh')?.displayPath.startsWith('.')).toBe(true)
    expect(views.find(view => view.id === 'custom')?.displayPath).toBe('~')
  })

  it('marks an overridden application skill by rank without a registry catalog', async () => {
    const home = await tempDir('shadow-rank')
    const project = await tempDir('shadow-rank-project')
    const claude = join(home, '.claude', 'skills')
    const codex = join(home, '.codex', 'skills')
    await writeSkill(claude, 'dup-skill', 'Claude copy')
    await writeSkill(claude, 'unique-skill', 'Only in Claude')
    await writeSkill(codex, 'dup-skill', 'Codex copy')
    const applications = [
      { id: 'claude-code', dir: claude, title: 'Claude Code' },
      { id: 'codex', dir: codex, title: 'Codex' },
    ]
    const fakeSources: SkillSourcesService = {
      read: () => ({
        sources: { 'claude-code': { enabled: true }, codex: { enabled: true } },
        skills: {},
      }),
      applications: () => applications,
      folders: () => [],
      visibility: () => ({ applications, folders: [], sourceEnabled: () => true, skillEnabled: () => true }),
      addFolder: async () => true,
      removeFolder: async () => undefined,
      setSource: async () => undefined,
      setSkill: async () => undefined,
      register: () => () => {},
    }
    const ctx = new Context()
    ctx.provide('skillSources', fakeSources)
    const provider = new SkillFileSystem.FileSystemSkillProvider(ctx, {
      invalidate: () => {},
      signal: new AbortController().signal,
    }, { dshHome: join(home, '.dsh'), agentsHome: join(home, '.agents'), watch: false })
    const views = await provider.describeSources({ cwd: project, winners: new Map() })
    const codexRow = views.find(view => view.id === 'codex')?.skills.find(skill => skill.name === 'dup-skill')
    const claudeRow = views.find(view => view.id === 'claude-code')?.skills.find(skill => skill.name === 'dup-skill')
    expect(codexRow?.shadowedBy).toBe('claude-code')
    expect(claudeRow?.shadowedBy).toBeUndefined()
    const withRegistry = await provider.describeSources({
      cwd: project,
      winners: new Map([['dup-skill', 'runtime'], ['unique-skill', 'runtime']]),
    })
    const claudeDup = withRegistry.find(view => view.id === 'claude-code')?.skills.find(skill => skill.name === 'dup-skill')
    const codexDup = withRegistry.find(view => view.id === 'codex')?.skills.find(skill => skill.name === 'dup-skill')
    expect(claudeDup?.shadowedBy).toBe('runtime')
    expect(codexDup?.shadowedBy).toBe('claude-code')
  })

  it('shortens home and project roots and keeps other absolute roots', async () => {
    const homeChild = await mkdtemp(join(homedir(), 'dsh-home-'))
    tempDirs.push(homeChild)
    await writeSkill(homeChild, 'home-skill', 'Under home')
    const outside = await mkdtemp(process.platform === 'win32' ? 'C:\\temp\\dsh-outside-' : join(tmpdir(), 'dsh-outside-'))
    tempDirs.push(outside)
    const outsideExtra = await mkdtemp(process.platform === 'win32' ? 'C:\\temp\\dsh-extra-' : join(tmpdir(), 'dsh-extra-'))
    tempDirs.push(outsideExtra)
    const extra = join(outsideExtra, 'extra')
    await writeSkill(extra, 'outside-skill', 'Outside home')
    const ctx = await setupLocal(outside, { customSkillDirs: [homeChild, extra] })
    const views = await describeSources(ctx, outside)
    expect(views.find(view => view.path === homeChild)?.displayPath.startsWith('~')).toBe(true)
    expect(views.find(view => view.path === extra)?.displayPath).toBe(extra)
    const sameCwd = await setupLocal(outside, { customSkillDirs: [outside] })
    expect((await describeSources(sameCwd, outside)).find(view => view.path === outside)?.displayPath).toBe('.')
  })

  it('expands a leading tilde in a configured application folder', async () => {
    const fixture = await mkdtemp(join(homedir(), 'dsh-app-'))
    tempDirs.push(fixture)
    await writeSkill(fixture, 'tilde-skill', 'Expanded home folder')
    const ctx = await setupLocal(await tempDir('tilde-home'), {}, {
      applications: [{ id: 'claude-code', dir: `~/${basename(fixture)}`, title: 'Claude Code' }],
      sources: { 'claude-code': { enabled: true } },
    })
    const view = (await describeSources(ctx)).find(entry => entry.id === 'claude-code')
    expect(view?.path).toBe(fixture)
    expect(view?.exists).toBe(true)
  })

  it('discovers project, custom, user, and agents skill roots in priority order', async () => {
    const home = await tempDir('skill-home')
    const project = await tempDir('skill-project')
    const custom = await tempDir('skill-custom')
    await mkdir(join(project, '.git'), { recursive: true })

    await writeSkill(join(home, '.agents/skills'), 'same', 'user agents skill')
    await writeSkill(join(home, '.dsh/skills'), 'same', 'user dsh skill')
    await writeSkill(custom, 'same', 'custom skill')
    await writeSkill(join(project, '.agents/skills'), 'same', 'project agents skill')
    await writeSkill(join(project, '.dsh/skills'), 'same', 'project dsh skill')
    await writeSkill(custom, 'custom-only', 'custom only')
    await writeSkill(join(home, '.dsh/skills/.system'), 'hidden-system', 'hidden system')

    const bundled = await tempDir('skill-bundled')
    await writeSkill(bundled, 'bundled-only', 'bundled skill')
    await writeSkill(bundled, 'same', 'bundled skill')
    const ctx = await setupLocal(home, { customSkillDirs: [custom], bundledSkillDir: bundled })

    const skills = await ctx.skills.list({ cwd: join(project, 'src') })
    expect(skills.map(skill => skill.name)).toEqual([
      'bundled-only',
      'custom-only',
      'same',
    ])
    expect(skills.find(skill => skill.name === 'custom-only')?.description).toBe('custom only')
    expect(skills.find(skill => skill.name === 'same')?.description).toBe('project dsh skill')
    expect(skills.find(skill => skill.name === 'same')?.source).toBe('project-dsh')
    expect(skills.find(skill => skill.name === 'hidden-system')).toBeUndefined()
    expect(skills.find(skill => skill.name === 'bundled-only')).toMatchObject({ source: 'bundled' })
    expect((await ctx.skills.get('bundled-only'))?.content).toBe('Use the skill.')

    const noGit = await tempDir('skill-no-git')
    await writeSkill(join(noGit, '.dsh/skills'), 'fallback-root', 'Fallback root')
    expect((await ctx.skills.list({ cwd: noGit })).map(skill => skill.name)).toContain('fallback-root')
  })

  it('lets project skills override runtime while runtime overrides custom and user skills', async () => {
    const home = await tempDir('skill-runtime-priority')
    const project = await tempDir('skill-runtime-project')
    const custom = await tempDir('skill-runtime-custom')
    await mkdir(join(project, '.git'), { recursive: true })

    await writeSkill(join(project, '.dsh/skills'), 'project-name', 'Project wins')
    await writeSkill(custom, 'runtime-name', 'Custom loses')
    await writeSkill(join(home, '.dsh/skills'), 'runtime-name', 'User loses')

    const ctx = await setupLocal(home, { customSkillDirs: [custom] })
    ctx.skills.register({
      name: 'project-name',
      description: 'Runtime loses to project',
      content: 'Runtime body.',
      source: 'runtime',
    })
    ctx.skills.register({
      name: 'runtime-name',
      description: 'Runtime wins',
      content: 'Runtime body.',
      source: 'runtime',
    })

    expect((await ctx.skills.get('project-name', { cwd: project }))?.description).toBe('Project wins')
    expect((await ctx.skills.get('runtime-name', { cwd: project }))?.description).toBe('Runtime wins')
  })

  it('parses flat skills and filters invalid skills from the invocation-neutral listing', async () => {
    const home = await tempDir('skill-flat')
    const root = join(home, '.dsh/skills')
    await writeFlatSkill(root, 'flat-skill', 'flat description', 'Flat instructions.')
    await writeFile(join(root, 'rich-skill.md'), [
      '---',
      'name: rich-skill',
      'description: rich description',
      'whenToUse: For richer local parsing',
      'disable-model-invocation: off',
      'user-invocable: YES',
      'metadata:',
      '  owner: tests',
      '---',
      '',
      'Rich body.',
    ].join('\n'))
    await writeFile(join(root, 'bad.md'), '---\nname: Bad_Name\ndescription: bad\n---\n\nbad')
    await writeFile(join(root, 'missing-description.md'), '---\nname: missing-description\n---\n\nbad')
    await writeFile(join(root, 'no-frontmatter.md'), 'No frontmatter.')
    await writeFile(join(root, 'plain-markdown.md'), '# Notes\nNot a skill.')
    await writeFile(join(root, 'open-frontmatter.md'), '---\nname: open-frontmatter')
    await writeFile(join(root, 'non-object.md'), '---\n[]\n---\n\nbad')
    await writeFile(join(root, 'no-trailing-body.md'), '---\nname: no-trailing-body\ndescription: No trailing body\n---')
    await writeFile(join(root, 'notes.txt'), 'ignored')
    await mkdir(join(root, 'not-a-skill'), { recursive: true })
    await writeSkill(root, 'user-only-skill', 'user-only description', 'User-only.')
    await writeFile(join(root, 'user-only-skill/SKILL.md'), '---\nname: user-only-skill\ndescription: user-only description\ndisable-model-invocation: true\n---\n\nUser-only.\n')
    await writeSkill(root, 'model-only-skill', 'model-only description', 'Model-only.')
    await writeFile(join(root, 'model-only-skill/SKILL.md'), '---\nname: model-only-skill\ndescription: model-only description\nuser-invocable: false\n---\n\nModel-only.\n')

    const ctx = await setupLocal(home)
    const listedBeforeDelete = await ctx.skills.list()
    const flatSummary = listedBeforeDelete.find(skill => skill.name === 'flat-skill')
    if (flatSummary === undefined) throw new Error('expected flat-skill')
    await rm(join(root, 'flat-skill.md'))

    expect(listedBeforeDelete.map(skill => skill.name)).toEqual([
      'flat-skill',
      'model-only-skill',
      'no-trailing-body',
      'rich-skill',
      'user-only-skill',
    ])
    expect(flatSummary.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    expect(await ctx.skills.get('flat-skill')).toBeUndefined()
    expect(await ctx.skills.get('no-trailing-body')).toMatchObject({
      invocation: { modelInvocable: true, userInvocable: true },
    })
    expect(await ctx.skills.get('user-only-skill')).toMatchObject({
      invocation: { modelInvocable: false, userInvocable: true },
      content: 'User-only.',
    })
    expect(await ctx.skills.get('model-only-skill')).toMatchObject({
      invocation: { modelInvocable: true, userInvocable: false },
      content: 'Model-only.',
    })
    expect(await ctx.skills.get('rich-skill')).toMatchObject({
      whenToUse: 'For richer local parsing',
      invocation: { modelInvocable: true, userInvocable: true },
      metadata: { owner: 'tests' },
    })
    expect(await ctx.skills.get('Bad_Name')).toBeUndefined()
  })

  it('accepts the documented boolean spellings for invocation frontmatter', async () => {
    const home = await tempDir('skill-invocation-booleans')
    const root = join(home, '.dsh/skills')
    await mkdir(root, { recursive: true })
    const truthy = ['true', 'TRUE', '"true"', 'yes', 'ON', '1', '"1"']
    const falsy = ['false', 'FALSE', '"false"', 'no', 'OFF', '0', '"0"']
    for (const [index, value] of truthy.entries()) {
      await writeFile(join(root, `truthy-${index}.md`), [
        '---',
        `name: truthy-${index}`,
        `description: Truthy ${index}`,
        `disable-model-invocation: ${value}`,
        '---',
        '',
        'Truthy.',
      ].join('\n'))
    }
    for (const [index, value] of falsy.entries()) {
      await writeFile(join(root, `falsy-${index}.md`), [
        '---',
        `name: falsy-${index}`,
        `description: Falsy ${index}`,
        `user-invocable: ${value}`,
        '---',
        '',
        'Falsy.',
      ].join('\n'))
    }

    const ctx = await setupLocal(home)

    for (const [index] of truthy.entries()) {
      expect((await ctx.skills.get(`truthy-${index}`))?.invocation).toEqual({
        modelInvocable: false,
        userInvocable: true,
      })
    }
    for (const [index] of falsy.entries()) {
      expect((await ctx.skills.get(`falsy-${index}`))?.invocation).toEqual({
        modelInvocable: true,
        userInvocable: false,
      })
    }
  })

  it('rejects legacy and invalid invocation frontmatter without hiding valid siblings', async () => {
    const home = await tempDir('skill-invalid-invocation')
    const root = join(home, '.dsh/skills')
    await writeSkill(root, 'good-skill', 'Good skill')
    const invalid = [
      ['legacy-model', 'disableModelInvocation: true'],
      ['legacy-positive-model', 'modelInvocable: false'],
      ['legacy-user', 'userInvocable: false'],
      ['bad-string', 'disable-model-invocation: maybe'],
      ['bad-value', 'user-invocable: null'],
    ] as const
    for (const [name, field] of invalid) {
      await writeFile(join(root, `${name}.md`), `---\nname: ${name}\ndescription: ${name}\n${field}\n---\n\nBad.\n`)
    }

    const ctx = await setupLocal(home)

    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['good-skill'])
  })

  it('supports CRLF frontmatter and ignores delimiter-looking text inside YAML values', async () => {
    const home = await tempDir('skill-frontmatter-crlf')
    const root = join(home, '.dsh/skills')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'crlf-skill.md'), [
      '---',
      'name: crlf-skill',
      'description: CRLF skill',
      'metadata:',
      '  marker: "----"',
      '---',
      '',
      'CRLF body.',
    ].join('\r\n'))
    await writeFile(join(root, 'block-skill.md'), [
      '---',
      'name: block-skill',
      'description: |',
      '  Includes a ---- marker that is not a delimiter.',
      '---',
      '',
      'Block body.',
    ].join('\n'))

    const ctx = await setupLocal(home)

    expect((await ctx.skills.get('crlf-skill'))?.content).toBe('CRLF body.')
    expect((await ctx.skills.get('crlf-skill'))?.metadata).toEqual({ marker: '----' })
    expect((await ctx.skills.get('block-skill'))?.description).toBe('Includes a ---- marker that is not a delimiter.\n')
    expect((await ctx.skills.get('block-skill'))?.content).toBe('Block body.')
  })

  it('skips invalid YAML skill files without hiding valid siblings', async () => {
    const home = await tempDir('skill-invalid-yaml')
    const root = join(home, '.dsh/skills')
    await writeSkill(root, 'good-skill', 'Good skill')
    await writeFile(join(root, 'bad-yaml.md'), '---\nname: bad-yaml\ndescription: [unclosed\n---\n\nBad body.\n')

    const ctx = await setupLocal(home)

    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['good-skill'])
  })

  it.skipIf(!symlinksAvailable).each([false, true])('publishes regular-file paths for linked skills while retaining their resource roots (filesystem service: %s)', async (withFileSystem) => {
    const home = await tempDir('skill-symlink-home')
    const external = await tempDir('skill-symlink-external')
    await writeSkill(external, 'linked-dir', 'Linked directory')
    await writeFlatSkill(external, 'linked-flat', 'Linked flat')
    await mkdir(join(home, '.dsh/skills'), { recursive: true })
    await symlink(join(external, 'linked-dir'), join(home, '.dsh/skills/linked-dir'))
    await symlink(join(external, 'linked-flat.md'), join(home, '.dsh/skills/linked-flat.md'))
    await symlink(join(external, 'missing'), join(home, '.dsh/skills/broken-link'))
    await symlink('/dev/null', join(home, '.dsh/skills/device-link'))

    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    if (withFileSystem) {
      await ctx.plugin(class extends TestFileSystem {
        override async resolve(path: string): Promise<FsTarget> {
          return { targetKey: await realpath(path) as never, displayPath: path }
        }
      })
    }
    const fiber = ctx.plugin(SkillFileSystem, { dshHome: join(home, '.dsh'), agentsHome: join(home, '.agents'), watch: false })
    await fiber

    try {
      const catalog = await ctx.skills.list()
      expect(catalog.map(skill => skill.name)).toEqual(['linked-dir', 'linked-flat'])
      for (const name of ['linked-dir', 'linked-flat']) {
        const path = name === 'linked-dir' ? join(external, name, 'SKILL.md') : join(external, `${name}.md`)
        expect(catalog.find(skill => skill.name === name)?.path).toBe(path)
        const loaded = await ctx.skills.get(name)
        expect(loaded?.path).toBe(path)
        expect(loaded?.resourceBase).toEqual({ kind: 'directory', path: name === 'linked-dir' ? join(home, '.dsh/skills', name) : join(home, '.dsh/skills') })
        expect((await lstat(path)).isFile()).toBe(true)
      }
      await writeFile(join(external, 'replacement.md'), '---\nname: linked-flat\ndescription: Replacement\n---\n\nReplacement body.\n')
      await rm(join(home, '.dsh/skills/linked-flat.md'))
      await symlink(join(external, 'replacement.md'), join(home, '.dsh/skills/linked-flat.md'))
      expect((await ctx.skills.get('linked-flat'))?.content).toBe('Replacement body.')
    } finally {
      await fiber.dispose()
    }
  })

  it('uses the filesystem service for discovery, reads, and project-root lookup', async () => {
    const home = await tempDir('skill-read-fs')
    const project = await tempDir('skill-project-root-backend')
    const nestedCwd = join(project, 'packages/app')
    const root = join(home, '.dsh/skills')
    await mkdir(nestedCwd, { recursive: true })
    await writeFlatSkill(root, 'text-skill', 'Text skill', 'Text body.')
    await writeFlatSkill(root, 'resolve-fail', 'Resolve fail', 'Resolve body.')
    await writeFlatSkill(root, 'stat-fail', 'Stat fail', 'Stat body.')
    await mkdir(join(root, 'empty-dir'), { recursive: true })
    await mkdir(join(root, 'directory-skill/SKILL.md'), { recursive: true })
    await writeFile(join(root, 'binary-skill.md'), Buffer.concat([
      Buffer.from('---\nname: binary-skill\ndescription: Binary skill\n---\n\n'),
      Buffer.from([0xff]),
      Buffer.from('\n'),
    ]))
    await writeSkill(join(project, '.agents/skills'), 'backend-root', 'Backend root skill')

    const ctx = new Context()
    await ctx.plugin(TestFileSystem)
    const fs = ctx.fs as TestFileSystem
    fs.failResolvePaths.add(join(root, 'resolve-fail.md'))
    fs.failStatPaths.add(join(root, 'stat-fail.md'))
    fs.failResolvePaths.add(join(nestedCwd, '.git'))
    fs.failStatPaths.add(join(project, 'packages/.git'))
    fs.statOverrides.set(join(project, '.git'), {
      version: FsVersion('virtual-git'),
      type: 'directory',
      size: 0,
    })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, { dshHome: join(home, '.dsh'), agentsHome: join(home, '.agents'), watch: false })

    expect((await ctx.skills.list({ cwd: nestedCwd })).map(skill => [skill.name, skill.source])).toEqual([
      ['backend-root', 'project-agents'],
      ['text-skill', 'user-dsh'],
    ])
    expect(fs.listDirCalls).toBeGreaterThan(0)
    expect(await ctx.skills.get('binary-skill')).toBeUndefined()

    const bundled = await tempDir('skill-backend-bundled')
    await writeSkill(bundled, 'bundled-host', 'Bundled host skill')
    const bundledCtx = new Context()
    await bundledCtx.plugin(TestFileSystem)
    const bundledFs = bundledCtx.fs as TestFileSystem
    bundledFs.failResolvePaths.add(bundled)
    await bundledCtx.plugin(SkillRegistry)
    await bundledCtx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      bundledSkillDir: bundled,
    })
    expect((await bundledCtx.skills.get('bundled-host'))?.source).toBe('bundled')
  })

  it.each(['resolve', 'list', 'read'] as const)('isolates a root %s failure and retries without losing readable roots', async (operation) => {
    const home = await tempDir('skill-root-isolation')
    const before = join(home, 'before')
    const broken = join(home, 'broken')
    const after = join(home, 'after')
    await writeSkill(before, 'before-skill', 'Readable earlier root')
    await writeSkill(broken, 'a-readable-sibling', 'Readable sibling in the failed root')
    await writeSkill(broken, 'recovered-skill', 'Recoverable root')
    await writeSkill(after, 'after-skill', 'Readable later root')
    await writeSkill(after, 'before-skill', 'Lower-priority duplicate')
    const ctx = new Context()
    const fsFiber = await ctx.plugin(TestFileSystem)
    onTestFinished(() => fsFiber.dispose())
    const registryFiber = await ctx.plugin(SkillRegistry)
    onTestFinished(() => registryFiber.dispose())
    const providerFiber = await ctx.plugin(SkillFileSystem, {
      includeDefaultRoots: false,
      customSkillDirs: [before, broken, after],
      watch: false,
    })
    onTestFinished(() => providerFiber.dispose())
    const warnings = vi.spyOn(ctx.logger, 'warn')
    onTestFinished(() => { warnings.mockRestore() })
    const fs = ctx.fs as TestFileSystem
    const failures = operation === 'resolve' ? fs.errorResolvePaths
      : operation === 'list' ? fs.failListDirPaths : fs.errorReadPaths
    failures.add(operation === 'read' ? join(broken, 'recovered-skill/SKILL.md') : broken)

    expect(await ctx.skills.snapshot()).toMatchObject({
      complete: false,
      skills: [{ name: 'after-skill' }, { name: 'before-skill', description: 'Readable earlier root' }],
    })
    expect((await ctx.skills.get('after-skill'))?.content).toBe('Use the skill.')
    expect(warnings).toHaveBeenCalledWith(expect.stringContaining(broken))
    failures.clear()
    expect(await ctx.skills.snapshot()).toMatchObject({
      complete: true,
      skills: [{ name: 'a-readable-sibling' }, { name: 'after-skill' }, { name: 'before-skill' }, { name: 'recovered-skill' }],
    })
  })

  it('selects a readable same-name skill while the preferred root fails and restores priority on recovery', async () => {
    const home = await tempDir('skill-root-fallback')
    const preferred = join(home, 'preferred')
    const fallback = join(home, 'fallback')
    await writeSkill(preferred, 'shared-skill', 'Preferred description', 'Preferred body.')
    await writeSkill(fallback, 'shared-skill', 'Fallback description', 'Fallback body.')
    const ctx = new Context()
    const fsFiber = await ctx.plugin(TestFileSystem)
    onTestFinished(() => fsFiber.dispose())
    const registryFiber = await ctx.plugin(SkillRegistry)
    onTestFinished(() => registryFiber.dispose())
    const providerFiber = await ctx.plugin(SkillFileSystem, {
      includeDefaultRoots: false, customSkillDirs: [preferred, fallback], watch: false,
    })
    onTestFinished(() => providerFiber.dispose())
    const fs = ctx.fs as TestFileSystem
    fs.failListDirPaths.add(preferred)

    expect(await ctx.skills.snapshot()).toMatchObject({
      complete: false, skills: [{ name: 'shared-skill', description: 'Fallback description' }],
    })
    expect((await ctx.skills.get('shared-skill'))?.content).toBe('Fallback body.')

    fs.failListDirPaths.clear()
    expect(await ctx.skills.snapshot()).toMatchObject({
      complete: true, skills: [{ name: 'shared-skill', description: 'Preferred description' }],
    })
    expect((await ctx.skills.get('shared-skill'))?.content).toBe('Preferred body.')
  })

  it('reports transient root reads as incomplete without caching an empty catalog', async () => {
    const home = await tempDir('skill-transient-root')
    const root = join(home, '.agents/skills')
    await writeSkill(root, 'stable-skill', 'Stable skill')
    const ctx = new Context()
    await ctx.plugin(TestFileSystem)
    const fs = ctx.fs as TestFileSystem
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: false,
    })

    expect(await ctx.skills.snapshot()).toMatchObject({
      skills: [{ name: 'stable-skill' }],
      complete: true,
    })
    fs.failListDirPaths.add(root)
    const path = join(root, 'stable-skill/SKILL.md')
    ctx.emit(
      'fs/observed',
      { targetKey: path as never, displayPath: path },
      { kind: 'present', version: FsVersion('failed-read') },
      { name: 'edit' },
    )
    expect(await ctx.skills.snapshot()).toEqual({ skills: [], complete: false })

    fs.failListDirPaths.clear()
    expect(await ctx.skills.snapshot()).toMatchObject({
      skills: [{ name: 'stable-skill' }],
      complete: true,
    })
  })

  it.each([false, true])('does not turn cancellation into a skipped root (read rejects: %s)', async (rejectRead) => {
    const home = await tempDir('skill-discovery-abort')
    const root = join(home, 'skills')
    await writeSkill(root, 'abortable-skill', 'Abortable skill')
    const ctx = new Context()
    const fsFiber = await ctx.plugin(TestFileSystem)
    onTestFinished(() => fsFiber.dispose())
    const provider = new SkillFileSystem.FileSystemSkillProvider(ctx, {
      signal: new AbortController().signal, invalidate: () => {},
    }, {
      includeDefaultRoots: false, customSkillDirs: [root, join(home, 'later')], watch: false,
    })
    onTestFinished(() => provider.dispose())
    const warnings = vi.spyOn(ctx.logger, 'warn')
    onTestFinished(() => { warnings.mockRestore() })
    const fs = ctx.fs as TestFileSystem
    const controller = new AbortController()
    const reason = new Error('discovery cancelled')
    fs.readTextOverride = async (target) => {
      const text = await readFile(target.displayPath, 'utf8')
      controller.abort(reason)
      if (rejectRead) throw reason
      return text
    }
    await expect(provider.list({ signal: controller.signal })).rejects.toBe(reason)
    expect(fs.listDirCalls).toBe(1)
    expect(warnings).not.toHaveBeenCalled()
  })

  it('distinguishes transient filesystem entry failures from confirmed disappearance', async () => {
    const home = await tempDir('skill-transient-entry')
    const root = join(home, '.agents/skills')
    const path = join(root, 'stable-skill/SKILL.md')
    await writeSkill(root, 'stable-skill', 'Stable skill')
    const ctx = new Context()
    await ctx.plugin(TestFileSystem)
    const fs = ctx.fs as TestFileSystem
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: false,
    })
    const invalidate = (): void => {
      ctx.emit(
        'fs/observed',
        { targetKey: path as never, displayPath: path },
        { kind: 'present', version: FsVersion('entry-failure') },
        { name: 'write' },
      )
    }

    expect((await ctx.skills.snapshot()).complete).toBe(true)
    for (const failures of [fs.errorResolvePaths, fs.errorStatPaths, fs.errorReadPaths]) {
      failures.add(path)
      invalidate()
      expect((await ctx.skills.snapshot()).complete).toBe(false)
      failures.clear()
    }

    fs.missingReadPaths.add(path)
    invalidate()
    expect(await ctx.skills.snapshot()).toEqual({ skills: [], complete: true })
    fs.missingReadPaths.clear()
    invalidate()
    expect(await ctx.skills.snapshot()).toMatchObject({
      skills: [{ name: 'stable-skill' }],
      complete: true,
    })
  })

  it('marks an unexpected native skill-file read failure incomplete', async () => {
    const home = await tempDir('skill-native-read-failure')
    const root = join(home, '.agents/skills')
    await mkdir(join(root, 'broken-skill/SKILL.md'), { recursive: true })
    await writeSkill(join(home, '.dsh/skills'), 'healthy-skill', 'Healthy native root')
    const ctx = await setupLocal(home)

    expect(await ctx.skills.snapshot()).toMatchObject({ skills: [{ name: 'healthy-skill' }], complete: false })
  })

  it('forwards cancellation to filesystem reads while loading a skill', async () => {
    const home = await tempDir('skill-read-abort')
    await writeSkill(join(home, '.dsh/skills'), 'abortable-skill', 'Abortable skill')

    const ctx = new Context()
    await ctx.plugin(TestFileSystem)
    const fs = ctx.fs as TestFileSystem
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, { dshHome: join(home, '.dsh'), agentsHome: join(home, '.agents'), watch: false })
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['abortable-skill'])

    fs.statSignals = []
    fs.readTextSignals = []
    const started = Promise.withResolvers<undefined>()
    fs.readTextOverride = async (_target, signal) => {
      if (signal === undefined) throw new Error('expected the skill lookup signal')
      started.resolve(undefined)
      return await new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const abortReason: unknown = signal.reason
          reject(abortReason instanceof Error ? abortReason : new Error(String(abortReason)))
        }, { once: true })
      })
    }
    const controller = new AbortController()
    const reason = new Error('turn cancelled')
    const loading = ctx.skills.get('abortable-skill', { signal: controller.signal })
    await started.promise
    controller.abort(reason)

    await expect(loading).rejects.toBe(reason)
    expect(fs.statSignals).toEqual([controller.signal])
    expect(fs.readTextSignals).toEqual([controller.signal])
  })

  it('refreshes additions, metadata changes, deletions, and a recreated missing root', { timeout: 20000 }, async () => {
    const home = await tempDir('skill-watch-home')
    const agentsRoot = join(home, '.agents/skills')
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const fiber = await ctx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: true,
      watchStabilityThresholdMs: 20,
      watchPollIntervalMs: 10,
    })
    try {
      expect(await ctx.skills.list()).toEqual([])

      await writeSkill(agentsRoot, 'watched-skill', 'First description', 'First body.')
      const added = await waitFor(
        async () => await ctx.skills.list(),
        skills => skills.some(skill => skill.name === 'watched-skill'),
      )
      expect(added.find(skill => skill.name === 'watched-skill')?.description).toBe('First description')

      await writeSkill(agentsRoot, 'watched-skill', 'Second description', 'Second body.')
      const changed = await waitFor(
        async () => await ctx.skills.list(),
        skills => skills.find(skill => skill.name === 'watched-skill')?.description === 'Second description',
      )
      expect(changed).toHaveLength(1)
      expect((await ctx.skills.get('watched-skill'))?.content).toBe('Second body.')

      await writeFlatSkill(agentsRoot, 'flat-added', 'Flat added')
      expect(await waitFor(
        async () => (await ctx.skills.list()).map(skill => skill.name),
        names => names.includes('flat-added'),
      )).toEqual(['flat-added', 'watched-skill'])

      await rename(join(agentsRoot, 'watched-skill'), join(agentsRoot, 'renamed-skill'))
      await writeSkill(agentsRoot, 'renamed-skill', 'Renamed skill')
      expect(await waitFor(
        async () => (await ctx.skills.list()).map(skill => skill.name),
        names => names.includes('renamed-skill') && !names.includes('watched-skill'),
      )).toEqual(['flat-added', 'renamed-skill'])

      await rm(join(agentsRoot, 'renamed-skill'), { recursive: true })
      expect(await waitFor(
        async () => (await ctx.skills.list()).map(skill => skill.name),
        names => !names.includes('renamed-skill'),
      )).toEqual(['flat-added'])

      await rm(join(home, '.agents'), { recursive: true })
      expect(await waitFor(
        async () => await ctx.skills.list(),
        skills => skills.length === 0,
      )).toEqual([])

      await writeSkill(agentsRoot, 'recreated-skill', 'Recreated')
      expect(await waitFor(
        async () => (await ctx.skills.list()).map(skill => skill.name),
        names => names.includes('recreated-skill'),
      )).toEqual(['recreated-skill'])
    } finally {
      await fiber.dispose()
    }

  })

  it('uses fs/observed as a synchronous first-party invalidation path without a watcher', async () => {
    const home = await tempDir('skill-observed-home')
    const root = join(home, '.agents/skills')
    const ctx = await setupLocal(home)
    expect(await ctx.skills.list()).toEqual([])
    let invalidations = 0
    ctx.on('skills/change', () => { invalidations += 1 })

    await writeSkill(root, 'observed-skill', 'Observed skill')
    const path = join(root, 'observed-skill/SKILL.md')
    const emitObserved = (displayPath: string, actor?: object): void => {
      ctx.emit(
        'fs/observed',
        { targetKey: displayPath as never, displayPath },
        { kind: 'present', version: FsVersion('observed') },
        actor,
      )
    }
    emitObserved(path)
    emitObserved(path, {})
    emitObserved(path, { name: 'read' })
    emitObserved(join(home, 'outside.md'), { name: 'write' })
    emitObserved(root, { name: 'write' })
    emitObserved(join(root, 'observed-skill/references/notes.md'), { name: 'write' })
    emitObserved(join(home, '.dsh/skills/.system/SKILL.md'), { name: 'write' })
    emitObserved(join(root, 'flat-skill.md'), { name: 'write' })
    ctx.emit(
      'fs/observed',
      { targetKey: path as never, displayPath: path },
      { kind: 'present', version: FsVersion('observed') },
      { name: 'edit' },
    )

    expect(invalidations).toBe(2)
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['observed-skill'])
  })

  it('bounds project watchers and re-observes an evicted project on its next lookup', async () => {
    const home = await tempDir('skill-watch-lru-home')
    const first = await tempDir('skill-watch-lru-first')
    const second = await tempDir('skill-watch-lru-second')
    await mkdir(join(first, '.git'), { recursive: true })
    await mkdir(join(second, '.git'), { recursive: true })
    await writeSkill(join(first, '.agents/skills'), 'first-project', 'First project')
    await writeSkill(join(second, '.agents/skills'), 'second-project', 'Second project')
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const fiber = await ctx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      customSkillDirs: [join(first, '.agents/skills')],
      watch: true,
      watchMaxProjects: 1,
      watchStabilityThresholdMs: 20,
      watchPollIntervalMs: 10,
    })
    try {
      expect((await ctx.skills.list({ cwd: first })).map(skill => skill.name)).toContain('first-project')
      expect((await ctx.skills.list({ cwd: second })).map(skill => skill.name)).toContain('second-project')
      await writeSkill(join(first, '.agents/skills'), 'first-project', 'First project refreshed')

      expect((await ctx.skills.list({ cwd: first })).find(skill => skill.name === 'first-project')?.description)
        .toBe('First project refreshed')
    } finally {
      await fiber.dispose()
    }

    const noWatch = new Context()
    await noWatch.plugin(SkillRegistry)
    await noWatch.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: false,
      watchMaxProjects: 1,
    })
    await noWatch.skills.list({ cwd: first })
    await noWatch.skills.list({ cwd: second })
  })

  it('contains repeated disposal and late first-party observations', async () => {
    const home = await tempDir('skill-watch-dispose')
    const nonDirectoryRoot = join(home, 'not-a-directory')
    await writeFile(nonDirectoryRoot, 'not a skill root')
    await writeSkill(join(home, '.agents/skills'), 'disposed-skill', 'Disposed skill')
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    let provider!: SkillFileSystem.FileSystemSkillProvider
    const disposeProvider = ctx.skills.registerProvider((control) => {
      provider = new SkillFileSystem.FileSystemSkillProvider(ctx, control, {
        dshHome: join(home, '.dsh'),
        agentsHome: join(home, '.agents'),
        customSkillDirs: [nonDirectoryRoot],
        watch: true,
        watchStabilityThresholdMs: 20,
        watchPollIntervalMs: 10,
      })
      return provider
    })
    const beforeDisposal = await provider.list({})
    expect((Array.isArray(beforeDisposal) ? beforeDisposal : beforeDisposal.candidates).map(skill => skill.name))
      .toEqual(['disposed-skill'])

    await provider.dispose()
    await provider.dispose()
    provider.observeHostMutation(join(home, '.agents/skills/disposed-skill/SKILL.md'))

    const afterDisposal = await provider.list({})
    expect((Array.isArray(afterDisposal) ? afterDisposal : afterDisposal.candidates).map(skill => skill.name))
      .toEqual(['disposed-skill'])
    disposeProvider()
  })

  it.skipIf(!symlinksAvailable)('refreshes frontmatter through a followed skill symlink', { timeout: 10000 }, async () => {
    const home = await tempDir('skill-watch-symlink-home')
    const external = await tempDir('skill-watch-symlink-external')
    const root = join(home, '.dsh/skills')
    await writeSkill(external, 'linked-skill', 'First linked description')
    await mkdir(root, { recursive: true })
    await symlink(join(external, 'linked-skill'), join(root, 'linked-skill'))
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const fiber = await ctx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: true,
      watchFollowSymlinks: true,
      watchStabilityThresholdMs: 20,
      watchPollIntervalMs: 10,
    })
    try {
      expect((await ctx.skills.list())[0]?.description).toBe('First linked description')
      await writeSkill(external, 'linked-skill', 'Second linked description')
      const refreshed = await waitFor(
        async () => await ctx.skills.list(),
        skills => skills[0]?.description === 'Second linked description',
      )
      expect(refreshed[0]?.name).toBe('linked-skill')
    } finally {
      await fiber.dispose()
    }
  })

  it('validates watcher tunables at plugin load', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)

    await expect(ctx.plugin(SkillFileSystem, { watchMaxProjects: 0 })).rejects.toThrow('watchMaxProjects')
    await expect(ctx.plugin(SkillFileSystem, { watchPollIntervalMs: 1.5 })).rejects.toThrow('watchPollIntervalMs')
    await expect(ctx.plugin(SkillFileSystem, { watchStabilityThresholdMs: 0 })).rejects.toThrow('watchStabilityThresholdMs')
  })

  it('uses default home root resolution without exposing builtin skills', async () => {
    const previousDshHome = process.env.DSH_HOME
    const previousAgentsHome = process.env.DSH_AGENTS_HOME
    const previousBundledSkillDir = process.env.DSH_BUNDLED_SKILL_DIR
    const envHome = await tempDir('skill-env-home')
    try {
      process.env.DSH_HOME = join(envHome, '.dsh')
      process.env.DSH_AGENTS_HOME = join(envHome, '.agents')
      const bundled = join(envHome, 'bundled-skills')
      process.env.DSH_BUNDLED_SKILL_DIR = bundled
      await writeSkill(join(envHome, '.dsh/skills'), 'env-skill', 'Env skill')
      await writeSkill(bundled, 'env-bundled-skill', 'Env bundled skill')
      const ctx = new Context()
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(SkillFileSystem, { watch: false })
      expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['env-bundled-skill', 'env-skill'])

      // Isolated providers see only their explicit roots: the environment
      // bundled root is a default root, so includeDefaultRoots: false must
      // drop it — isolated providers never re-claim the app's builtins.
      const isolated = new Context()
      await isolated.plugin(SkillRegistry)
      const customOnly = join(envHome, 'custom-only')
      await writeSkill(customOnly, 'custom-isolated-skill', 'Custom isolated skill')
      await isolated.plugin(SkillFileSystem, {
        providerName: 'isolated',
        includeDefaultRoots: false,
        customSkillDirs: [customOnly],
        watch: false,
      })
      expect((await isolated.skills.list()).map(skill => skill.name)).toEqual(['custom-isolated-skill'])
      await isolated.fiber.dispose()

      process.env.DSH_HOME = join(envHome, 'empty-dsh')
      delete process.env.DSH_BUNDLED_SKILL_DIR
      process.env.DSH_AGENTS_HOME = join(envHome, 'empty-agents')
      const empty = new Context()
      await empty.plugin(SkillRegistry)
      SkillFileSystem.apply(empty, { watch: false })
      expect(await empty.skills.list()).toEqual([])

      delete process.env.DSH_AGENTS_HOME
      expect(new SkillFileSystem.FileSystemSkillProvider(empty, {
        signal: new AbortController().signal,
        invalidate() {},
      }, { dshHome: join(envHome, 'empty-dsh') }).name).toBe('filesystem')
    } finally {
      if (previousDshHome === undefined) {
        delete process.env.DSH_HOME
      } else {
        process.env.DSH_HOME = previousDshHome
      }
      if (previousAgentsHome === undefined) {
        delete process.env.DSH_AGENTS_HOME
      } else {
        process.env.DSH_AGENTS_HOME = previousAgentsHome
      }
      if (previousBundledSkillDir === undefined) {
        delete process.env.DSH_BUNDLED_SKILL_DIR
      } else {
        process.env.DSH_BUNDLED_SKILL_DIR = previousBundledSkillDir
      }
    }
  })
})
