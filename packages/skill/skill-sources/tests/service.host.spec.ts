/** Unit coverage for the profile-owned switches and the application list. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import SkillSources, { Config, skillEnabled, sourceEnabled, type SkillApplication } from '../src/index.ts'

const APPS: readonly SkillApplication[] = [
  { id: 'claude-code', dir: '~/.claude/skills', title: 'Claude Code' },
]

/** Boot the service with a settings stub that records writes. */
async function setup(config: {
  applications?: SkillApplication[]
  sources?: Record<string, { enabled: boolean }>
  skills?: Record<string, Record<string, boolean>>
} = {}): Promise<{ ctx: Context; update: ReturnType<typeof vi.fn> }> {
  const ctx = new Context()
  const update = vi.fn(async () => undefined)
  ctx.provide('settings', { update })
  await ctx.plugin(SkillSources, config)
  return { ctx, update }
}

describe('skill-sources configuration', () => {
  it('ships the six application folders with their titles', () => {
    const resolved = Config({})
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

  it('falls back to no applications and empty switches when built without configuration', () => {
    const ctx = new Context()
    ctx.provide('settings', { update: async () => undefined })
    const service = new SkillSources(ctx, {})
    expect(service.applications()).toEqual([])
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
})
