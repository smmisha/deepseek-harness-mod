/**
 * Wire vocabulary of the `skillSources` Remote namespace: the Skills tab reads
 * these rows and writes switches through the settings namespace.
 *
 * @module @deepseek-ai/dsh-skill-filesystem/types
 */

/** One local source row for the Skills tab. */
export interface LocalSourceView {
  /** Source identity, also the settings key. */
  readonly id: string
  /** Reader-facing name; localized sources carry their own title from the service. */
  readonly title: string
  /** Own folders are harness sources; the rest belong to other applications. */
  readonly kind: 'harness' | 'application'
  /** Absolute folder the source scans. */
  readonly path: string
  /** Shortened path for the row; `path` carries the full value. */
  readonly displayPath: string
  /** False when the folder disappeared after the source was recorded. */
  readonly exists: boolean
  /** Whether the source's skills reach the model catalog. */
  readonly enabled: boolean
  /** Discovered skills, sorted by name. */
  readonly skills: readonly LocalSkillView[]
}

/** One discovered skill row for the Skills tab. */
export interface LocalSkillView {
  /** Parsed name; absent when the frontmatter could not be read. */
  readonly name?: string
  /** Instruction file path (the SKILL.md of a bundle, or the flat file). */
  readonly path: string
  /** Shortened path for the row; `path` carries the full value. */
  readonly displayPath?: string
  /** Parsed description. */
  readonly description?: string
  /** Row state the tab renders; the shadowed marker is separate. */
  readonly status: 'available' | 'disabled' | 'invalid'
  /** Frontmatter failure text for `invalid` rows. */
  readonly error?: string
  /** Source that wins the duplicate for `shadowed` rows. */
  readonly shadowedBy?: string
}

/** Lookup options for the provider's source inventory. */
export interface LocalSourceOptions {
  /** Working directory that selects the project roots. */
  readonly cwd?: string
  /** Registry winners by skill name, used to mark overridden duplicates. */
  readonly winners: ReadonlyMap<string, string>
}
