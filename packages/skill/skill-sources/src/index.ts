/**
 * Profile-owned skill source switches, the one application list every local
 * provider instance reads, and the category rules that group the Skills tab.
 *
 * The switches live in this plugin entry's volatile Config, so the profile
 * settings service owns them, they survive restarts, and each write invalidates
 * the providers that reported themselves. The application list and the category
 * rules live beside them: a provider never hard-codes which folders belong to
 * another app or which name tokens form a category.
 *
 * @module @deepseek-ai/dsh-skill-sources
 */
import { isAbsolute, parse, resolve } from 'node:path'
import { Service, type Context, type Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type { SkillSource } from '@deepseek-ai/dsh-skill'
import {
  bindVisibility, folderSourceId, sameFolder, type SkillApplication, type SkillFolder, type SkillVisibility,
  type SkillVisibilityState,
} from './visibility.ts'
import { assertCategoryRules, DEFAULT_SKILL_CATEGORIES, type SkillCategory } from './categories.ts'

export type { SkillApplication, SkillFolder, SkillFolderSource, SkillVisibility, SkillVisibilityState } from './visibility.ts'
export type { SkillCategory } from './categories.ts'

/** Profile entry id whose volatile Config holds the switches. */
const SETTINGS_NAMESPACE = 'skill-sources'

/** One source switch stored in this profile's settings. */
export interface SkillSourceSwitch {
  /** Whether the source contributes skills; absent keeps the source's own default. */
  readonly enabled?: boolean
}

/** Plugin configuration: the persisted switches, the application list, and the category rules. */
export interface Config {
  /** Other applications' skill folders; every one starts switched off. */
  applications?: SkillApplication[]
  /**
   * Category rules a local provider applies to the skills it describes. Omitted
   * ships the built-in categories; an empty list leaves only the categories
   * authors declare, so every other skill falls to the Skills tab's "Other" group.
   */
  categories?: SkillCategory[]
  /** Source switches keyed by source id; absent keeps the source's default. */
  sources?: Volatile<Record<string, SkillSourceSwitch>>
  /** Per-skill switches keyed by source id, then skill name; absent means enabled. */
  skills?: Volatile<Record<string, Record<string, boolean>>>
  /** Folders the reader added from the Skills tab, in the order they were added. */
  folders?: Volatile<SkillFolder[]>
}

/** Default applications, mapping the folders the common coding agents use. */
const DEFAULT_APPLICATIONS: readonly SkillApplication[] = [
  { id: 'claude-code', dir: '~/.claude/skills', title: 'Claude Code' },
  { id: 'codex', dir: '~/.codex/skills', title: 'Codex' },
  { id: 'copilot', dir: '~/.copilot/skills', title: 'GitHub Copilot' },
  { id: 'gemini-cli', dir: '~/.gemini/skills', title: 'Gemini CLI' },
  { id: 'antigravity', dir: '~/.gemini/config/skills', title: 'Google Antigravity' },
  { id: 'opencode', dir: '~/.config/opencode/skills', title: 'OpenCode' },
]

/** Validated plugin configuration; the Loader reads it from `SkillSources.Config`. */
const ConfigSchema = z.object({
  applications: z.array(z.object({
    id: z.string().min(1),
    dir: z.string().min(1),
    title: z.string().min(1),
  })).default(DEFAULT_APPLICATIONS.map(application => ({ ...application }))),
  categories: z.array(z.object({
    id: z.string().min(1).required().description('Stable category identity the Skills tab groups by.'),
    title: z.string().min(1).required()
      .description('Reader-facing category name, used when the client does not translate the id.'),
    prefixes: z.array(z.string().min(1)).default([]).description('Skill-name prefixes this category claims.'),
    namespaces: z.array(z.string().min(1)).default([]).description('Plugin namespaces this category claims.'),
  })).default(DEFAULT_SKILL_CATEGORIES.map(rule => ({
    ...rule,
    prefixes: [...rule.prefixes],
    namespaces: [...rule.namespaces],
  }))),
  sources: z.dict(z.object({
    enabled: z.boolean().description('Whether this source contributes skills; absent keeps the source default.'),
  })).default({}).volatile(),
  skills: z.dict(z.dict(z.boolean())).default({}).volatile(),
  folders: z.array(z.object({
    dir: z.string().min(1).description('Absolute folder scanned for skill bundles.'),
  })).default([]).volatile(),
})

/** State used when no provider configured anything. */
const EMPTY_STATE: SkillVisibilityState = { sources: {}, skills: {} }

/** Path root a persisted folder must have: a drive root (`C:\`) or the POSIX root. */
const LOCAL_FOLDER_ROOT = /^(?:[A-Za-z]:[\\/]|[\\/])$/u

/**
 * Refuse to persist a folder the provider must not scan. A path without a local root names a
 * network share or a Win32 device namespace (`\\server\share`, `\\?\C:\x`, `\\.\pipe\x`), which
 * would connect to a remote endpoint; a relative path would name a folder in the Host process's
 * working directory. The Skills tab validates the reader's raw input first; this guard keeps any
 * direct caller from writing the same value into the profile.
 * @param dir - folder a caller wants to append.
 * @throws {TypeError} when the folder is not a local absolute path.
 */
function assertPersistedFolderPath(dir: string): void {
  const root = parse(dir).root
  if (!isAbsolute(dir) || dir.startsWith('//') || !LOCAL_FOLDER_ROOT.test(root)) {
    throw new TypeError(`skill-sources: "${dir}" is not a local absolute folder path`)
  }
}

/** The one service a provider and the Skills tab both use. */
export interface SkillSourcesService {
  /**
   * Current switches.
   * @returns the source and per-skill switches as stored.
   */
  read(): SkillVisibilityState
  /**
   * Configured other-application folders.
   * @returns the application folders in configuration order.
   */
  applications(): readonly SkillApplication[]
  /**
   * Configured category rules.
   * @returns the rules in configuration order.
   */
  categories(): readonly SkillCategory[]
  /**
   * Folders the reader added.
   * @returns the added folders in the order they were added.
   */
  folders(): readonly SkillFolder[]
  /**
   * One read of the switches, applications, and added folders, answering which sources and skills are visible.
   * @returns the visibility view over the current configuration.
   */
  visibility(): SkillVisibility
  /**
   * Add one local absolute folder, switched off until the reader turns its source on; refuses any other path.
   * @param dir - local absolute folder to scan for skill bundles.
   * @returns false when the folder is already listed, true when it was added.
   */
  addFolder(dir: string): Promise<boolean>
  /**
   * Remove one added folder; its files and switches stay untouched.
   * @param dir - absolute folder as it was added.
   */
  removeFolder(dir: string): Promise<void>
  /**
   * Switch one source; the per-skill switches are preserved.
   * @param source - source to switch.
   * @param enabled - whether the source contributes skills.
   */
  setSource(source: SkillSource, enabled: boolean): Promise<void>
  /**
   * Switch one skill inside its source.
   * @param source - source that holds the skill.
   * @param name - skill name inside that source.
   * @param enabled - whether the skill is visible.
   */
  setSkill(source: SkillSource, name: string, enabled: boolean): Promise<void>
  /**
   * Register the invalidator of one provider instance.
   * @param invalidate - called after every write so the provider republishes its catalog.
   * @returns the disposer that unregisters the invalidator.
   */
  register(invalidate: () => void): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Profile-owned skill source switches and application list. */
    skillSources: SkillSourcesService
  }
}

/** Owns the switches and notifies every mounted local provider after a write. */
export default class SkillSources extends Service implements SkillSourcesService {
  static readonly Config = ConfigSchema

  /** The settings service owns the persisted switches. */
  static readonly inject = ['settings']

  private readonly invalidators = new Set<() => void>()

  /**
   * @param ctx - Host context with the settings service.
   * @param config - persisted switches, the application list, and the category rules.
   * @throws {TypeError} when the configured category rules are ambiguous.
   */
  constructor(private readonly ownerContext: Context, private readonly config: Config = {}) {
    super(ownerContext, 'skillSources')
    assertCategoryRules(this.categories())
  }

  /** Current switches from the live Config fields. */
  read(): SkillVisibilityState {
    return {
      sources: this.config.sources?.get() ?? EMPTY_STATE.sources,
      skills: this.config.skills?.get() ?? EMPTY_STATE.skills,
    }
  }

  /** Configured other-application folders. */
  applications(): readonly SkillApplication[] {
    return this.config.applications ?? []
  }

  /** Configured category rules. */
  categories(): readonly SkillCategory[] {
    return this.config.categories ?? []
  }

  /** Folders the reader added, from the live Config field. */
  folders(): readonly SkillFolder[] {
    return this.config.folders?.get() ?? []
  }

  /** One read of the switches, applications, added folders, and category rules bound to the visibility answers. */
  visibility(): SkillVisibility {
    return bindVisibility(this.read(), this.applications(), this.folders(), this.categories())
  }

  /**
   * Add one folder to the end of the list; a folder already listed under any letter case on Windows is kept once.
   * The new source is recorded switched off: its SKILL.md files reach the model only after the reader turns it on.
   * @param dir - absolute local folder; the Remote controller validates the reader's input before calling.
   * @returns false when the folder was already listed and nothing was written.
   * @throws {TypeError} when the folder is not a local absolute path, so nothing is written.
   */
  async addFolder(dir: string): Promise<boolean> {
    assertPersistedFolderPath(dir)
    const folder = resolve(dir)
    const current = this.folders()
    if (current.some(entry => sameFolder(entry.dir, folder))) return false
    // A folder the reader just added is untrusted input: its skills must not
    // become agent instructions before the reader switches the source on.
    await this.ownerContext.settings.update(SETTINGS_NAMESPACE, {
      folders: [...current, { dir: folder }],
      sources: { [folderSourceId(folder)]: { enabled: false } },
    }, undefined)
    this.invalidateAll()
    return true
  }

  /**
   * Remove one added folder; its files and any switches stored under its source stay untouched.
   * @param dir - folder as listed, compared the way `addFolder` compares it.
   */
  async removeFolder(dir: string): Promise<void> {
    const current = this.folders()
    const next = current.filter(entry => !sameFolder(entry.dir, dir))
    if (next.length === current.length) return
    await this.ownerContext.settings.update(SETTINGS_NAMESPACE, { folders: next }, undefined)
    this.invalidateAll()
  }

  /**
   * Switch one source on or off; the per-skill switches are preserved.
   * @param source - source identity from the described rows.
   * @param enabled - the state to persist.
   */
  async setSource(source: SkillSource, enabled: boolean): Promise<void> {
    await this.ownerContext.settings.update(SETTINGS_NAMESPACE, { sources: { [source]: { enabled } } }, undefined)
    this.invalidateAll()
  }

  /**
   * Switch one skill on or off inside its source.
   * @param source - source identity from the described rows.
   * @param name - skill name.
   * @param enabled - the state to persist.
   */
  async setSkill(source: SkillSource, name: string, enabled: boolean): Promise<void> {
    await this.ownerContext.settings.update(SETTINGS_NAMESPACE, { skills: { [source]: { [name]: enabled } } }, undefined)
    this.invalidateAll()
  }

  /**
   * Register the invalidator of one provider instance.
   * @param invalidate - drops that provider's cached catalog.
   * @returns disposer removing the registration.
   */
  register(invalidate: () => void): () => void {
    this.invalidators.add(invalidate)
    return () => { this.invalidators.delete(invalidate) }
  }

  private invalidateAll(): void {
    for (const invalidate of this.invalidators) {
      try {
        invalidate()
      } catch (error) {
        // One provider's failure must not leave the others on a stale catalog.
        this.ownerContext.logger.warn(error)
      }
    }
  }
}
