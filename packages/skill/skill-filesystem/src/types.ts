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
  /** Own folders are harness sources, `folder` rows are folders the reader added, the rest belong to other applications. */
  readonly kind: 'harness' | 'application' | 'folder'
  /**
   * Configured application id for an `application` source, such as `claude-code`;
   * absent for harness folders and added folders. The Skills tab maps it to that
   * application's source mark and to its translated name.
   */
  readonly applicationId?: string
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

/**
 * Outcome of adding a folder from the Skills tab; every outcome other than `added` writes nothing.
 *
 * `relative` means the path is not absolute after `~` expansion. `invalid` means the path names a
 * network or device location (`\\server\share`, `\\?\C:\x`, `\\.\pipe\x`) or carries a parent
 * (`..`) segment, so the provider must not scan it.
 */
export type AddSkillFolderResult = 'added' | 'exists' | 'relative' | 'missing' | 'invalid'

/** One file inside a skill's folder, as the Skills tab's detail panel lists it. */
export interface LocalSkillFileView {
  /** Path relative to the skill's folder with `/` separators; a flat skill lists only its own file name. */
  readonly path: string
  /** Byte size, or 0 when the filesystem backend reports no size for the file. */
  readonly size: number
  /**
   * Whether the file is a script: an interpreter, shell, or executable extension, or any
   * file under a `scripts` or `bin` folder. The Skills tab only reports this; no script
   * from a skill is read or executed.
   */
  readonly isScript: boolean
}

/** Where an installed skill came from, as recorded by the installer that copied it. */
export interface LocalSkillProvenance {
  /** Repository the skill was copied from, rendered verbatim. */
  readonly url: string
  /** Commit the copy was taken from, when the installation pinned one. */
  readonly commit?: string
  /** ISO-8601 instant the installation completed. */
  readonly installedAt?: string
}

/** One discovered skill row for the Skills tab. */
export interface LocalSkillView {
  /** Parsed name; absent when the frontmatter could not be read. */
  readonly name?: string
  /** Instruction file path (the SKILL.md of a bundle, or the flat file). */
  readonly path: string
  /** Shortened path for the row; `path` carries the full value. */
  readonly displayPath?: string
  /** Parsed description with every whitespace run collapsed to one space, so a YAML block scalar renders as one paragraph. */
  readonly description?: string
  /** BCP-47 tag of the description's language, when the skill declares one; the tab sets `lang` from it and `dir="auto"` always. */
  readonly language?: string
  /** Files in the skill's folder; absent when the folder could not be listed. */
  readonly files?: readonly LocalSkillFileView[]
  /** Install provenance; absent unless an installer recorded where the skill came from. */
  readonly provenance?: LocalSkillProvenance
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
