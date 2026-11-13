/**
 * Profile-owned skill source switches and the one application list every local
 * provider instance reads.
 *
 * The switches live in this plugin entry's volatile Config, so the profile
 * settings service owns them, they survive restarts, and each write invalidates
 * the providers that reported themselves. The application list lives beside
 * them: a provider never hard-codes which folders belong to another app.
 *
 * @module @deepseek-ai/dsh-skill-sources
 */
import { Service, type Context, type Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type { SkillSource } from '@deepseek-ai/dsh-skill'
import { bindVisibility, type SkillApplication, type SkillVisibility, type SkillVisibilityState } from './visibility.ts'

export type { SkillApplication, SkillVisibility, SkillVisibilityState } from './visibility.ts'

/** Profile entry id whose volatile Config holds the switches. */
const SETTINGS_NAMESPACE = 'skill-sources'

/** One source switch stored in this profile's settings. */
export interface SkillSourceSwitch {
  /** Whether the source contributes skills; absent keeps the source's own default. */
  readonly enabled?: boolean
}

/** Plugin configuration: the persisted switches and the application list. */
export interface Config {
  /** Other applications' skill folders; every one starts switched off. */
  applications?: SkillApplication[]
  /** Source switches keyed by source id; absent keeps the source's default. */
  sources?: Volatile<Record<string, SkillSourceSwitch>>
  /** Per-skill switches keyed by source id, then skill name; absent means enabled. */
  skills?: Volatile<Record<string, Record<string, boolean>>>
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
  sources: z.dict(z.object({
    enabled: z.boolean().description('Whether this source contributes skills; absent keeps the source default.'),
  })).default({}).volatile(),
  skills: z.dict(z.dict(z.boolean())).default({}).volatile(),
})

/** State used when no provider configured anything. */
const EMPTY_STATE: SkillVisibilityState = { sources: {}, skills: {} }

/** The one service a provider and the Skills tab both use. */
export interface SkillSourcesService {
  /** Current switches. */
  read(): SkillVisibilityState
  /** Configured other-application folders. */
  applications(): readonly SkillApplication[]
  /** One read of the switches and applications, answering which sources and skills are visible. */
  visibility(): SkillVisibility
  /** Switch one source; the per-skill switches are preserved. */
  setSource(source: SkillSource, enabled: boolean): Promise<void>
  /** Switch one skill inside its source. */
  setSkill(source: SkillSource, name: string, enabled: boolean): Promise<void>
  /** Register the invalidator of one provider instance; returns its disposer. */
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
   * @param config - persisted switches and the application list.
   */
  constructor(private readonly ownerContext: Context, private readonly config: Config = {}) {
    super(ownerContext, 'skillSources')
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

  /** One read of the switches and applications bound to the visibility rules. */
  visibility(): SkillVisibility {
    return bindVisibility(this.read(), this.applications())
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
