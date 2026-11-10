/**
 * Composition proof for the web profile: the application list lives only in the
 * top-level `skill-sources` row, and every mounted provider instance sees it.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { parse } from 'yaml'
import { afterEach, describe, expect, it } from 'vitest'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SkillSources from '../src/index.ts'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
/** The subset of a described row this composition test reads. */
interface DescribedSource {
  id: string
  kind: 'harness' | 'application'
  title: string
  enabled: boolean
}

const BUNDLE_ROOT = join(import.meta.dirname, '..', '..', '..', 'bundle')
const BASE_PATCH = join(BUNDLE_ROOT, 'base', 'cordis.patch.yml')
const WEB_PATCH = join(BUNDLE_ROOT, 'web-app', 'cordis.patch.yml')
const PRESETS = join(BUNDLE_ROOT, 'web-app', 'presets')

/** Loader rows of one patch file, flattened out of its insert lists. */
function rows(file: string): Record<string, unknown>[] {
  const document = parse(readFileSync(file, 'utf8')) as unknown
  const result: Record<string, unknown>[] = []
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { for (const entry of value) walk(entry); return }
    if (typeof value !== 'object' || value === null) return
    const record = value as Record<string, unknown>
    if (typeof record.name === 'string') result.push(record)
    for (const child of Object.values(record)) walk(child)
  }
  walk(document)
  return result
}

function presetFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? presetFiles(path) : path.endsWith('.yml') ? [path] : []
  })
}

afterEach(() => {})

describe('web profile composition', () => {
  it('keeps the application list in one row and off the filesystem rows', () => {
    const base = rows(BASE_PATCH)
    const sourcesRow = base.find(row => row.name === '@deepseek-ai/dsh-skill-sources')
    expect(sourcesRow).toBeDefined()
    expect(base.filter(row => row.name === '@deepseek-ai/dsh-skill-filesystem')).toHaveLength(1)
    for (const row of base.filter(row => row.name === '@deepseek-ai/dsh-skill-filesystem')) {
      const config = row.config as Record<string, unknown> | undefined
      expect(config?.applications).toBeUndefined()
    }
    const web = rows(WEB_PATCH)
    const disabledFilesystem = web.filter(row => row.name === '@deepseek-ai/dsh-skill-filesystem')
    expect(disabledFilesystem.every(row => row.disabled === true)).toBe(true)
    for (const file of presetFiles(PRESETS)) {
      for (const row of rows(file)) {
        if (row.name !== '@deepseek-ai/dsh-skill-filesystem') continue
        const config = row.config as Record<string, unknown> | undefined
        expect(config?.applications).toBeUndefined()
      }
    }
  })

  it('reaches every mounted provider instance with the six configured applications', async () => {
    const ctx = new Context()
    ctx.provide('settings', { update: async () => undefined })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillSources)
    // Two preset scopes mount their own provider instance; both must see the list.
    await ctx.plugin(SkillFileSystem, { providerName: 'preset-a', dshHome: join(import.meta.dirname, 'missing'), watch: false })
    await ctx.plugin(SkillFileSystem, { providerName: 'preset-b', dshHome: join(import.meta.dirname, 'missing'), watch: false })

    const controller = ctx.get('skillSourcesController') as
      { describe(cwd: string | undefined): Promise<DescribedSource[]> } | undefined
    expect(controller).toBeDefined()
    const views = await controller!.describe(undefined)
    const applications = views.filter(view => view.kind === 'application')
    expect(applications.map(view => view.id).sort()).toEqual([
      'antigravity', 'claude-code', 'codex', 'copilot', 'gemini-cli', 'opencode',
    ])
    expect(applications.every(view => !view.enabled)).toBe(true)
    expect(applications.find(view => view.id === 'claude-code')?.title).toBe('Claude Code')
  })
})
