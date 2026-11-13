/** Unit coverage for the profile-owned switches and the application list. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import SkillSources, { type Config, type SkillApplication } from '../src/index.ts'
import { bindVisibility, folderSourceId, sameFolder, skillEnabled, sourceEnabled } from '../src/visibility.ts'

const APPS: readonly SkillApplication[] = [
  { id: 'claude-code', dir: '~/.claude/skills', title: 'Claude Code' },
]

/** Boot the service with a settings stub that records writes. */
async function setup(config: {
  applications?: SkillApplication[]
  sources?: Record<string, { enabled: boolean }>
  skills?: Record<string, Record<string, boolean>>
  folders?: { dir: string }[]
} = {}): Promise<{ ctx: Context; update: ReturnType<typeof vi.fn> }> {
  const ctx = new Context()
  const update = vi.fn(async () => undefined)
  ctx.provide('settings', { update })
  await ctx.plugin(SkillSources, config)
  return { ctx, update }
}

/** Mutable state behind the volatile Config getters of one test service. */
interface LiveSwitches {
  sources: Record<string, { enabled?: boolean }>
  skills: Record<string, Record<string, boolean>>
  folders: { dir: string }[]
}

/** One settings patch, as the service writes it. */
interface SettingsPatch {
  readonly folders?: readonly { readonly dir: string }[]
  readonly sources?: Readonly<Record<string, { readonly enabled?: boolean }>>
  readonly skills?: Readonly<Record<string, Readonly<Record<string, boolean>>>>
}

/**
 * Settings stub whose patches land in the volatile Config getters, so the
 * service reads back the switch it wrote the way the real settings service feeds it.
 * @param initial - stored switches and folders the service starts from.
 * @returns the live state, the recording update stub, and the Config for one direct instance.
 */
function liveSettings(initial: LiveSwitches = { sources: {}, skills: {}, folders: [] }) {
  const live: LiveSwitches = {
    sources: { ...initial.sources },
    skills: { ...initial.skills },
    folders: initial.folders.map(folder => ({ dir: folder.dir })),
  }
  const update = vi.fn(async (_ns: string, patch: SettingsPatch) => {
    if (patch.folders !== undefined) live.folders = patch.folders.map(folder => ({ dir: folder.dir }))
    for (const [source, entry] of Object.entries(patch.sources ?? {})) {
      live.sources[source] = { ...(live.sources[source] ?? {}), ...entry }
    }
    for (const [source, names] of Object.entries(patch.skills ?? {})) {
      live.skills[source] = { ...(live.skills[source] ?? {}), ...names }
    }
  })
  const config: Config = {
    applications: [...APPS],
    folders: { get: () => live.folders },
    sources: { get: () => live.sources },
    skills: { get: () => live.skills },
  }
  return { live, update, config }
}

describe('skill-sources configuration', () => {
  it('ships the six application folders with their titles', () => {
    const resolved = SkillSources.Config({})
    expect(resolved.applications.map(application => application.id)).toEqual([
      'claude-code', 'codex', 'copilot', 'gemini-cli', 'antigravity', 'opencode',
    ])
    expect(resolved.applications.every(application => application.title.length > 0)).toBe(true)
  })
})

describe('visibility rules', () => {
  it('starts every configured application off and every harness source on', () => {
    expect(sourceEnabled({ sources: {}, skills: {} }, 'claude-code', APPS)).toBe(false)
    expect(sourceEnabled({ sources: {}, skills: {} }, 'user-dsh', APPS)).toBe(true)
  })

  it('lets an explicit switch win, and keeps a switched-off source hiding its skills', () => {
    const state = { sources: { 'claude-code': { enabled: true } }, skills: { 'claude-code': { 'x': false } } }
    expect(sourceEnabled(state, 'claude-code', APPS)).toBe(true)
    expect(skillEnabled(state, 'claude-code', 'x', APPS)).toBe(false)
    expect(skillEnabled(state, 'claude-code', 'y', APPS)).toBe(true)
    expect(skillEnabled({ ...state, sources: { 'claude-code': { enabled: false } } }, 'claude-code', 'y', APPS)).toBe(false)
  })

  it('compares folders by letter case only on Windows', () => {
    expect(sameFolder('/team/Skills', '/team/skills', 'win32')).toBe(true)
    expect(sameFolder('/team/Skills', '/team/skills', 'linux')).toBe(false)
    expect(sameFolder('/team/skills', '/team/skills/', 'linux')).toBe(true)
    expect(sameFolder('/team/a', '/team/b')).toBe(false)
  })

  it('binds added folders as sources whose switch comes from the stored state', () => {
    const visibility = bindVisibility({ sources: {}, skills: {} }, APPS, [{ dir: 'D:\\team' }])
    expect(visibility.folders).toEqual([{ id: folderSourceId('D:\\team'), dir: 'D:\\team' }])
    // A folder stored without a switch record keeps the non-application default it always had.
    expect(visibility.sourceEnabled(folderSourceId('D:\\team'))).toBe(true)
    // `addFolder` records the switch, so a folder added now starts off.
    const recorded = bindVisibility({
      sources: { [folderSourceId('D:\\team')]: { enabled: false } }, skills: {},
    }, APPS, [{ dir: 'D:\\team' }])
    expect(recorded.sourceEnabled(folderSourceId('D:\\team'))).toBe(false)
    const switchedOn = bindVisibility({
      sources: { [folderSourceId('D:\\team')]: { enabled: true } }, skills: {},
    }, APPS, [{ dir: 'D:\\team' }])
    expect(switchedOn.sourceEnabled(folderSourceId('D:\\team'))).toBe(true)
    expect(bindVisibility({ sources: {}, skills: {} }, APPS).folders).toEqual([])
  })

  it('treats an application added through configuration as off by default', () => {
    expect(sourceEnabled({ sources: {}, skills: {} }, 'my-editor', [{ id: 'my-editor', dir: '~/.editor', title: 'Editor' }]))
      .toBe(false)
  })
})

describe('SkillSources service', () => {
  it('exposes the configured applications and defaults', async () => {
    const { ctx } = await setup()
    expect(ctx.skillSources.applications()).toHaveLength(6)
    expect(ctx.skillSources.read()).toEqual({ sources: {}, skills: {} })
  })

  it('writes switches through the settings service and invalidates registered providers', async () => {
    const { ctx, update } = await setup()
    const invalidate = vi.fn()
    const dispose = ctx.skillSources.register(invalidate)
    await ctx.skillSources.setSource('claude-code', true)
    expect(update).toHaveBeenCalledWith('skill-sources', { sources: { 'claude-code': { enabled: true } } }, undefined)
    await ctx.skillSources.setSkill('claude-code', 'review', false)
    expect(update).toHaveBeenCalledWith('skill-sources', { skills: { 'claude-code': { review: false } } }, undefined)
    expect(invalidate).toHaveBeenCalledTimes(2)
    dispose()
    await ctx.skillSources.setSource('claude-code', false)
    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it('keeps invalidating the other providers when one invalidator throws', async () => {
    const { ctx } = await setup()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const failure = new Error('stale cache')
    const healthy = vi.fn()
    ctx.skillSources.register(() => { throw failure })
    ctx.skillSources.register(healthy)
    await ctx.skillSources.setSource('claude-code', true)
    expect(healthy).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(failure)
  })

  it('falls back to no applications and empty switches when built without configuration', () => {
    const ctx = new Context()
    ctx.provide('settings', { update: async () => undefined })
    const service = new SkillSources(ctx, {})
    expect(service.applications()).toEqual([])
    expect(service.folders()).toEqual([])
    expect(service.read()).toEqual({ sources: {}, skills: {} })
  })

  it('reads the switches the profile stores', async () => {
    const { ctx } = await setup({
      applications: [...APPS],
      sources: { 'claude-code': { enabled: true } },
      skills: { 'claude-code': { review: false } },
    })
    expect(ctx.skillSources.read()).toEqual({ sources: { 'claude-code': { enabled: true } }, skills: { 'claude-code': { review: false } } })
  })

  it('adds a folder once, removes it, and invalidates providers after each write', async () => {
    const team = resolve('team-skills')
    const { ctx, update } = await setup({ folders: [{ dir: team }] })
    const invalidate = vi.fn()
    ctx.skillSources.register(invalidate)
    expect(ctx.skillSources.folders()).toEqual([{ dir: team }])
    expect(ctx.skillSources.visibility().folders).toEqual([{ id: folderSourceId(team), dir: team }])
    // The settings stub does not feed writes back, so each call sees the configured list.
    await expect(ctx.skillSources.addFolder(team)).resolves.toBe(false)
    const extra = resolve('extra-skills')
    await expect(ctx.skillSources.addFolder(extra)).resolves.toBe(true)
    expect(update).toHaveBeenLastCalledWith('skill-sources', {
      folders: [{ dir: team }, { dir: extra }],
      sources: { [folderSourceId(extra)]: { enabled: false } },
    }, undefined)
    await ctx.skillSources.removeFolder(extra)
    expect(update).toHaveBeenCalledTimes(1)
    await ctx.skillSources.removeFolder(team)
    expect(update).toHaveBeenLastCalledWith('skill-sources', { folders: [] }, undefined)
    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it('answers visibility from one read of the switches and applications', async () => {
    const { ctx } = await setup({
      applications: [...APPS],
      sources: { 'claude-code': { enabled: true } },
      skills: { 'claude-code': { review: false } },
    })
    const visibility = ctx.skillSources.visibility()
    expect(visibility.applications).toEqual(APPS)
    expect(visibility.sourceEnabled('claude-code')).toBe(true)
    expect(visibility.skillEnabled('claude-code', 'review')).toBe(false)
    expect(visibility.skillEnabled('claude-code', 'other')).toBe(true)
    expect(visibility.sourceEnabled('user-dsh')).toBe(true)
  })

  it('adds a folder switched off so its skills wait for the reader', async () => {
    const { update, config } = liveSettings()
    const ctx = new Context()
    ctx.provide('settings', { update })
    const service = new SkillSources(ctx, config)
    const team = resolve('untrusted-skills')
    const source = folderSourceId(team)

    await expect(service.addFolder(team)).resolves.toBe(true)
    expect(update).toHaveBeenCalledWith('skill-sources', {
      folders: [{ dir: team }],
      sources: { [source]: { enabled: false } },
    }, undefined)
    const visibility = service.visibility()
    expect(visibility.folders).toEqual([{ id: source, dir: team }])
    expect(visibility.sourceEnabled(source)).toBe(false)
    expect(visibility.skillEnabled(source, 'injected')).toBe(false)

    // The reader's own switch is the only way the folder reaches the model catalog.
    await service.setSource(source, true)
    expect(service.visibility().sourceEnabled(source)).toBe(true)
  })

  it('keeps the switches of the folders already listed', async () => {
    const kept = resolve('kept-skills')
    const added = resolve('added-skills')
    const { live, update, config } = liveSettings({
      sources: { [folderSourceId(kept)]: { enabled: true } }, skills: {}, folders: [{ dir: kept }],
    })
    const ctx = new Context()
    ctx.provide('settings', { update })
    const service = new SkillSources(ctx, config)

    await expect(service.addFolder(added)).resolves.toBe(true)
    expect(live.sources).toEqual({
      [folderSourceId(kept)]: { enabled: true },
      [folderSourceId(added)]: { enabled: false },
    })
    expect(service.visibility().sourceEnabled(folderSourceId(kept))).toBe(true)
    expect(service.visibility().sourceEnabled(folderSourceId(added))).toBe(false)
  })
})
