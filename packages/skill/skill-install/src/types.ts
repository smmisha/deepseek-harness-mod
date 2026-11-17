/**
 * Wire vocabulary of the `skillInstall` Remote namespace: the catalog rows the
 * Skills tab lists, the repository resolution, the preview a reader confirms,
 * and the install outcome.
 *
 * Every failure the Host reports carries a stable code from
 * {@link SkillInstallRemoteCode}; the Skills tab maps it to one localized
 * sentence and one next action.
 *
 * @module @deepseek-ai/dsh-skill-install/types
 */

/** How one configured catalog can be used. */
export type SkillCatalogKind =
  /** A GitHub repository the reader names, resolved through the GitHub API. */
  | 'github'
  /** A page the tab opens in the browser; the Host never fetches it. */
  | 'link'
  /** A fixed GitHub repository whose folders the tab offers as a curated list. */
  | 'recommended'

/** One catalog row the Skills tab shows. */
export interface SkillCatalogView {
  /** Stable catalog id, also the key of its configured entry. */
  readonly id: string
  /** Reader-facing title as configured; the tab localizes a known id and falls back to this. */
  readonly title: string
  /** HTTPS page the tab opens in the browser. The Host never contacts it. */
  readonly homepage: string
  /** Whether the Host can enumerate skills for this catalog. */
  readonly searchable: boolean
  /** How this catalog is served. */
  readonly kind: SkillCatalogKind
  /** Repository a `recommended` catalog lists, as `owner/repo`. */
  readonly repository?: string
}

/** One skill folder found in a resolved GitHub repository. */
export interface RepoSkillView {
  /** Folder inside the repository, with `/` separators. */
  readonly folder: string
  /** Folder basename, shown before the skill's frontmatter is read. */
  readonly name: string
  /** Whether the folder ships a file an agent could run. */
  readonly hasScripts: boolean
  /** Files in the folder, as the tree reported them. */
  readonly fileCount: number
}

/** Result of resolving the reader's repository input. */
export interface RepositoryView {
  /** Repository owner, verbatim from the resolved repository. */
  readonly owner: string
  /** Repository name. */
  readonly repo: string
  /** Commit the folder list was read from; every later read pins this commit. */
  readonly commit: string
  /** Folders that contain a `SKILL.md`, sorted by folder. */
  readonly skills: readonly RepoSkillView[]
}

/** Where a previewed install would take its bytes from. */
export type InstallSource =
  | {
    /** A GitHub repository folder, pinned to the commit the preview listed. */
    readonly kind: 'repository'
    readonly owner: string
    readonly repo: string
    readonly folder: string
    readonly commit: string
  }
  /** A `.zip` archive the reader imported. */
  | { readonly kind: 'archive'; readonly fileName: string }
  /** A folder the reader dropped onto the tab. */
  | { readonly kind: 'folder'; readonly folderName: string }

/** One file an install writes. */
export interface InstallFileView {
  /** Path inside the skill folder, with `/` separators. */
  readonly path: string
  /** Byte size of the content that would be written. */
  readonly size: number
  /** Whether the file is a script the agent could run. */
  readonly isScript: boolean
}

/** One skill one preview would install. */
export interface PreviewSkill {
  /** Skill name the install would use. */
  readonly name: string
  /** Parsed description, when the `SKILL.md` declares one. */
  readonly description?: string
  /** The `SKILL.md` text exactly as it would be written, provenance included. */
  readonly document: string
  /** Files the install would write, the `SKILL.md` included. */
  readonly files: readonly InstallFileView[]
  /** Whether any written file is a script; installing never runs one. */
  readonly hasScripts: boolean
  /** Absolute folder the install would write. */
  readonly target: string
  /** Whether something already occupies `target`, so the reader must choose. */
  readonly conflict: boolean
}

/** Everything the confirmation step shows before anything is written. */
export interface InstallPreview {
  /** Opaque id the confirmation sends back; it expires with the configured lifetime. */
  readonly id: string
  /** Where the bytes come from, listed once for the whole import. */
  readonly source: InstallSource
  /** Skills the import would install: one for a folder or repository skill, several for an archive. */
  readonly skills: readonly PreviewSkill[]
}

/** One file the tab uploads when the reader drops a folder. */
export interface DroppedFile {
  /** Path inside the dropped folder, with `/` separators; carries no parent segment. */
  readonly path: string
  /** Base64 content of the file. */
  readonly content: string
}

/** One skill an install wrote. */
export interface InstalledSkill {
  /** Name the skill was installed under. */
  readonly name: string
  /** Absolute folder of the installed skill. */
  readonly path: string
  /** Whether an existing skill folder was replaced. */
  readonly replaced: boolean
}

/** What one confirmed install wrote. */
export interface InstallResult {
  /** Skills written, in preview order. */
  readonly installed: readonly InstalledSkill[]
}

/**
 * Stable `skill-install/*` Remote failure codes. Each names one condition the
 * Skills tab turns into a sentence with a next action.
 */
export type SkillInstallRemoteCode =
  /** The profile settings service that stores skill switches is not mounted. */
  | 'skill-install/unavailable'
  /** The typed text is not an `owner/repo`, a repository URL, or an `npx skills add` command. */
  | 'skill-install/spec-invalid'
  /** The repository, folder, or skill does not exist. */
  | 'skill-install/not-found'
  /** GitHub refused the request because the unauthenticated rate limit is spent. */
  | 'skill-install/rate-limited'
  /** A request could not be completed: refused network, timeout, oversized body, redirect. */
  | 'skill-install/network'
  /** The resolved host is not in the configured allowlist. */
  | 'skill-install/host-blocked'
  /** The repository tree came back truncated, so its skills cannot be listed completely. */
  | 'skill-install/tree-too-large'
  /** The archive is not a usable zip: unsafe entry, link, too many entries, too large, corrupt. */
  | 'skill-install/archive-invalid'
  /** The content holds no readable `SKILL.md` or an unusable skill name. */
  | 'skill-install/invalid-skill'
  /** The target name is taken and the confirmation carries no replacement choice. */
  | 'skill-install/conflict'
  /** The preview id is unknown or expired. */
  | 'skill-install/preview-expired'
  /** The upload the tab sent is larger than the configured cap. */
  | 'skill-install/upload-too-large'
  /** Removal was refused: the folder was not written by this installer. */
  | 'skill-install/not-installed'
  /** Writing or removing the skill folder failed. */
  | 'skill-install/io-failed'

/** Details every `skill-install/*` failure may carry. */
export interface SkillInstallFailureDetails {
  /** Repository, folder, or skill name the failure is about. */
  readonly target?: string
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'skill-install/unavailable': SkillInstallFailureDetails
    'skill-install/spec-invalid': SkillInstallFailureDetails
    'skill-install/not-found': SkillInstallFailureDetails
    'skill-install/rate-limited': SkillInstallFailureDetails
    'skill-install/network': SkillInstallFailureDetails
    'skill-install/host-blocked': SkillInstallFailureDetails
    'skill-install/tree-too-large': SkillInstallFailureDetails
    'skill-install/archive-invalid': SkillInstallFailureDetails
    'skill-install/invalid-skill': SkillInstallFailureDetails
    'skill-install/conflict': SkillInstallFailureDetails
    'skill-install/preview-expired': SkillInstallFailureDetails
    'skill-install/upload-too-large': SkillInstallFailureDetails
    'skill-install/not-installed': SkillInstallFailureDetails
    'skill-install/io-failed': SkillInstallFailureDetails
  }
}
