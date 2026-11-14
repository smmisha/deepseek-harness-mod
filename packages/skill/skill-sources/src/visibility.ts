/**
 * Visibility rules for local skill sources: which sources and skills reach the
 * model catalog and the user's `/` commands.
 *
 * Internal to `@deepseek-ai/dsh-skill-sources`; other packages read the rules
 * through `ctx.skillSources.visibility()`.
 *
 * @module
 */
import { resolve } from 'node:path'

/** Folders of another application whose skills may be shown. */
export interface SkillApplication {
  /** Source identity reported for its skills. */
  readonly id: string
  /** Folder scanned for skill bundles; `~` expands to the user's home. */
  readonly dir: string
  /** Reader-facing name, shown by the Skills tab. */
  readonly title: string
}

/**
 * A folder the reader added from the Skills tab. `addFolder` records its source
 * switched off, so its skills wait for the reader's switch; a folder stored
 * before that record existed keeps the non-application default and stays on.
 */
export interface SkillFolder {
  /** Absolute folder scanned for skill bundles. */
  readonly dir: string
}

/** One added folder as a source: the identity its switches use and its folder. */
export interface SkillFolderSource {
  /** Source identity, `folder:` followed by the folder. */
  readonly id: string
  /** Absolute folder scanned for skill bundles. */
  readonly dir: string
}

/**
 * Whether two folder paths name one folder; Windows paths compare without letter case.
 * @param left - one folder path.
 * @param right - the other folder path.
 * @param platform - host platform whose path rules apply.
 * @returns true when both resolve to the same folder.
 */
export function sameFolder(left: string, right: string, platform: NodeJS.Platform = process.platform): boolean {
  const a = resolve(left)
  const b = resolve(right)
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/**
 * Name the source an added folder reports.
 * @param dir - absolute folder.
 * @returns the source identity its switches are stored under.
 */
export function folderSourceId(dir: string): string {
  return `folder:${dir}`
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
  /** Folders the reader added, in the order they were added. */
  readonly folders: readonly SkillFolderSource[]
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
 * Bind one read of the switches, applications, and added folders to the visibility rules.
 * @param state - persisted switches.
 * @param applications - configured other-application folders.
 * @param folders - folders the reader added; their switches come from `state`, so a folder
 *   `addFolder` stored stays off until the reader turns it on.
 * @returns the bound visibility answers.
 */
export function bindVisibility(
  state: SkillVisibilityState, applications: readonly SkillApplication[], folders: readonly SkillFolder[] = [],
): SkillVisibility {
  return {
    applications,
    folders: folders.map(folder => ({ id: folderSourceId(folder.dir), dir: folder.dir })),
    sourceEnabled: source => sourceEnabled(state, source, applications),
    skillEnabled: (source, name) => skillEnabled(state, source, name, applications),
  }
}
