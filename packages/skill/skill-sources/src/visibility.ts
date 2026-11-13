/**
 * Visibility rules for local skill sources: which sources and skills reach the
 * model catalog and the user's `/` commands.
 *
 * Internal to `@deepseek-ai/dsh-skill-sources`; other packages read the rules
 * through `ctx.skillSources.visibility()`.
 *
 * @module
 */

/** Folders of another application whose skills may be shown. */
export interface SkillApplication {
  /** Source identity reported for its skills. */
  readonly id: string
  /** Folder scanned for skill bundles; `~` expands to the user's home. */
  readonly dir: string
  /** Reader-facing name, shown by the Skills tab. */
  readonly title: string
}

/** Visibility state shared with local providers. */
export interface SkillVisibilityState {
  /** Source switches keyed by source id. */
  readonly sources: Readonly<Record<string, { readonly enabled?: boolean }>>
  /** Per-skill switches keyed by source id, then skill name. */
  readonly skills: Readonly<Record<string, Readonly<Record<string, boolean>>>>
}

/** One read of the switches and the application list, answering visibility questions. */
export interface SkillVisibility {
  /** Configured other-application folders at the time of the read. */
  readonly applications: readonly SkillApplication[]
  /**
   * Whether a source's skills reach the model catalog and the user's `/` commands.
   * @param source - discovery source identity.
   * @returns the explicit switch, or the source's default: configured applications start off.
   */
  sourceEnabled(source: string): boolean
  /**
   * Whether one skill is visible; a switched-off source hides every skill in it.
   * @param source - discovery source identity.
   * @param name - skill name.
   * @returns true when the source and the skill are both on.
   */
  skillEnabled(source: string, name: string): boolean
}

/**
 * Whether a source's skills are visible.
 * @param state - persisted switches.
 * @param source - discovery source identity.
 * @param applications - configured other-application folders; each starts off.
 * @returns the explicit switch, or the source's default.
 */
export function sourceEnabled(
  state: SkillVisibilityState, source: string, applications: readonly SkillApplication[],
): boolean {
  return state.sources[source]?.enabled ?? !applications.some(application => application.id === source)
}

/**
 * Whether one skill is visible; a switched-off source hides every skill in it.
 * @param state - persisted switches.
 * @param source - discovery source identity.
 * @param name - skill name.
 * @param applications - configured other-application folders; each starts off.
 * @returns true when the source and the skill are both on.
 */
export function skillEnabled(
  state: SkillVisibilityState, source: string, name: string, applications: readonly SkillApplication[],
): boolean {
  return sourceEnabled(state, source, applications) && (state.skills[source]?.[name] ?? true)
}

/**
 * Bind one read of the switches and applications to the visibility rules.
 * @param state - persisted switches.
 * @param applications - configured other-application folders.
 * @returns the bound visibility answers.
 */
export function bindVisibility(state: SkillVisibilityState, applications: readonly SkillApplication[]): SkillVisibility {
  return {
    applications,
    sourceEnabled: source => sourceEnabled(state, source, applications),
    skillEnabled: (source, name) => skillEnabled(state, source, name, applications),
  }
}
