/**
 * The installer service: resolve a catalog repository, preview what an import
 * would write, install it under the harness home's `skills` folder, and remove
 * an installed skill.
 *
 * Nothing is written before a preview is confirmed, and confirming writes into a
 * staging folder that is moved into place only after every file exists. An
 * installed skill is recorded switched off in `ctx.skillSources`, so it reaches
 * the model only after the reader turns it on.
 *
 * @module @deepseek-ai/dsh-skill-install/service
 */

import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill-sources'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { extractArchive } from './archive.ts'
import { declaredDescription, installName, selectBundles, withProvenance } from './bundle.ts'
import { ConfigSchema, type Config, type SkillCatalogConfig } from './config.ts'
import { SkillInstallError } from './errors.ts'
import { GitHubResolver, isScriptPath, type ResolvedRepository } from './github.ts'
import { createHttpClient, type HttpClient } from './http.ts'
import { group } from './match.ts'
import { relativePathProblem } from './relative-path.ts'
import { parseRepositorySpec } from './source-spec.ts'
import type {
  DroppedFile, InstallFileView, InstallPreview, InstallResult, InstallSource, InstalledSkill, PreviewSkill,
  RepositoryView, SkillCatalogView,
} from './types.ts'

/** Folder name inside the harness home that the filesystem provider scans as `user-dsh`. */
const HARNESS_SKILLS_DIR = 'skills'

/** Source id the filesystem provider reports for the harness home's skills folder. */
const HARNESS_SKILLS_SOURCE = 'user-dsh'

/** The manifest entry a skill is read from. */
const DOCUMENT_BASENAME = 'skill.md'

/** The service other Host packages and the Remote face consume. */
export interface SkillInstallService {
  /**
   * Catalogs configured for this deployment.
   * @returns the catalog rows, in configuration order.
   */
  catalogs(): readonly SkillCatalogView[]
  /**
   * Resolve a repository reference and list the skill folders it holds.
   * @param input - `owner/repo`, a GitHub URL, or an `npx skills add` command.
   * @returns the pinned commit and every folder holding a `SKILL.md`.
   * @throws {SkillInstallError} see {@link GitHubResolver.list}.
   */
  resolveRepository(input: string): Promise<RepositoryView>
  /**
   * Preview one skill folder of a repository.
   * @param input - repository reference.
   * @param folder - folder the previous resolution listed.
   * @returns the preview the reader confirms.
   * @throws {SkillInstallError} `SKILL_INSTALL_NOT_FOUND` when the folder is gone.
   */
  previewRepository(input: string, folder: string): Promise<InstallPreview>
  /**
   * Preview the skills one `.zip` archive holds.
   * @param fileName - name the reader's archive was chosen or dropped under.
   * @param content - base64 archive bytes.
   * @returns the preview the reader confirms.
   */
  previewArchive(fileName: string, content: string): Promise<InstallPreview>
  /**
   * Preview the skills one dropped folder holds.
   * @param folderName - name the folder was dropped under.
   * @param files - the folder's files, paths relative to the folder.
   * @returns the preview the reader confirms.
   */
  previewFolder(folderName: string, files: readonly DroppedFile[]): Promise<InstallPreview>
  /**
   * Write one confirmed preview.
   * @param previewId - id of the preview the reader confirmed.
   * @param name - new name for a single-skill import, or undefined to keep the preview's name.
   * @param replace - whether an existing folder of the same name is replaced.
   * @returns the skills written; each is recorded switched off.
   */
  install(previewId: string, name: string | undefined, replace: boolean): Promise<InstallResult>
  /**
   * Remove one skill this installer wrote.
   * @param name - installed skill name.
   */
  remove(name: string): Promise<void>
}

/** One file an install would write, with the bytes already in hand. */
interface PendingFile {
  readonly path: string
  readonly bytes: Uint8Array
}

/** One skill a pending import would write. */
interface PendingSkill {
  readonly name: string
  readonly description?: string
  readonly document: string
  readonly files: readonly InstallFileView[]
  readonly hasScripts: boolean
  readonly payload:
    | { readonly kind: 'repository'; readonly repository: ResolvedRepository; readonly folder: string }
    | { readonly kind: 'content'; readonly files: readonly PendingFile[] }
}

/** One import waiting for confirmation. */
interface PendingImport {
  readonly source: InstallSource
  readonly skills: readonly PendingSkill[]
}

/** One preview waiting for confirmation, with the instant it stops being installable. */
interface PendingEntry {
  readonly at: number
  readonly value: PendingImport
}

/**
 * Resolve the folder installed skills are written to.
 * @param config - plugin configuration.
 * @returns the configured folder, or the harness home's `skills` folder.
 * @throws {Error} when the configured folder is not absolute, so the Loader
 *   fails at load instead of writing into the process working directory.
 */
function installRoot(config: Config): string {
  if (config.installRoot === undefined) return join(resolveDshHome(), HARNESS_SKILLS_DIR)
  if (!isAbsolute(config.installRoot)) {
    throw new Error(`skill-install: installRoot "${config.installRoot}" is not an absolute path`)
  }
  return resolve(config.installRoot)
}

/**
 * Validate the relationships a schema cannot state, so a broken catalog list
 * fails at load rather than at the reader's first click.
 * @param catalogs - configured catalogs.
 * @throws {Error} when ids repeat, or a recommended catalog names no repository.
 */
function assertCatalogs(catalogs: readonly SkillCatalogConfig[]): void {
  const seen = new Set<string>()
  for (const catalog of catalogs) {
    if (seen.has(catalog.id)) throw new Error(`skill-install: catalog id "${catalog.id}" is configured twice`)
    seen.add(catalog.id)
    if (catalog.kind === 'recommended' && catalog.repository === undefined) {
      throw new Error(`skill-install: recommended catalog "${catalog.id}" names no repository`)
    }
    if (catalog.kind !== 'recommended' && catalog.repository !== undefined) {
      throw new Error(`skill-install: catalog "${catalog.id}" is ${catalog.kind} but names a repository`)
    }
    if (catalog.repository !== undefined) parseRepositorySpec(catalog.repository)
  }
}

/**
 * Decode one instruction file.
 * @param bytes - file bytes.
 * @param target - file path, quoted when the bytes are not UTF-8.
 * @returns the decoded text.
 * @throws {SkillInstallError} `SKILL_INSTALL_INVALID_SKILL` when the file is not UTF-8.
 */
function decodeDocument(bytes: Uint8Array, target: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw new SkillInstallError(`${target} is not UTF-8 text`, 'SKILL_INSTALL_INVALID_SKILL', target, { cause: error })
  }
}

/**
 * Decode one uploaded body, bounded before it is inflated into memory.
 * @param content - base64 content the Skills tab sent.
 * @param cap - largest decoded size accepted, in bytes.
 * @param target - name the upload is quoted by.
 * @returns the decoded bytes.
 * @throws {SkillInstallError} `SKILL_INSTALL_UPLOAD_TOO_LARGE` past the cap, and
 *   `SKILL_INSTALL_INVALID_SKILL` for content that is not base64.
 */
export function decodeUpload(content: string, cap: number, target: string): Uint8Array {
  if (content.length > Math.ceil(cap / 3) * 4 + 4) {
    throw new SkillInstallError(`${target} is larger than the configured ${cap} bytes`, 'SKILL_INSTALL_UPLOAD_TOO_LARGE', target)
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(content) || content.length % 4 !== 0) {
    throw new SkillInstallError(`${target} did not arrive as base64`, 'SKILL_INSTALL_INVALID_SKILL', target)
  }
  const bytes = new Uint8Array(Buffer.from(content, 'base64'))
  if (bytes.byteLength > cap) {
    throw new SkillInstallError(`${target} is larger than the configured ${cap} bytes`, 'SKILL_INSTALL_UPLOAD_TOO_LARGE', target)
  }
  return bytes
}

/** Host integrations a test replaces so no case reaches the network. */
export interface SkillInstallerInternals {
  /** Outbound client; defaults to one built from the configured network policy. */
  readonly http?: HttpClient
}

/** One configuration with every schema default applied, resolved once at construction. */
type ResolvedConfig = ReturnType<typeof ConfigSchema>

/**
 * Resolves, previews, installs, and removes skills.
 */
export class SkillInstaller implements SkillInstallService {
  /** Resolved configuration: the schema's defaults filled in once, at construction. */
  private readonly resolved: ResolvedConfig
  /** Absolute folder installed skills are written to. */
  private readonly root: string
  /** Reads repositories under the configured network policy. */
  private readonly gitHub: GitHubResolver
  /** Largest skill file one install accepts. */
  private readonly maxFileBytes: number
  /** Largest total skill size one install accepts. */
  private readonly maxTotalBytes: number
  /** Previews waiting for confirmation, oldest first. */
  private readonly pending = new Map<string, PendingEntry>()

  /**
   * @param ctx - Host context; `ctx.skillSources` records the switched-off state.
   * @param config - validated plugin configuration.
   * @param internals - Host integrations a test replaces.
   */
  constructor(private readonly ctx: Context, config: Config = {}, internals: SkillInstallerInternals = {}) {
    this.root = installRoot(config)
    const resolved: ResolvedConfig = ConfigSchema(config)
    this.resolved = resolved
    assertCatalogs(resolved.catalogs)
    this.maxFileBytes = resolved.maxResponseBytes
    this.maxTotalBytes = resolved.maxUncompressedBytes
    const http: HttpClient = internals.http ?? createHttpClient({
      allowedHosts: resolved.allowedHosts,
      timeoutMs: resolved.requestTimeoutMs,
      maxRedirects: resolved.maxRedirects,
      maxResponseBytes: this.maxFileBytes,
    })
    this.gitHub = new GitHubResolver(http, {
      maxMetadataBytes: this.maxFileBytes,
      maxDocumentBytes: this.maxFileBytes,
      maxFileBytes: this.maxFileBytes,
      maxFiles: resolved.maxFiles,
    })
  }

  /** Catalogs configured for this deployment, in configuration order. */
  catalogs(): readonly SkillCatalogView[] {
    return this.resolved.catalogs.map((catalog) => {
      // The profile document may omit a field the schema types as present.
      const repository = catalog.repository as string | undefined
      return {
        id: catalog.id,
        title: catalog.title,
        homepage: catalog.homepage,
        searchable: catalog.searchable,
        kind: catalog.kind,
        ...repository === undefined ? {} : { repository },
      }
    })
  }

  /** Resolve one repository reference and list its skill folders. */
  async resolveRepository(input: string): Promise<RepositoryView> {
    const listing = await this.gitHub.list(input)
    return {
      owner: listing.owner,
      repo: listing.repo,
      commit: listing.commit,
      skills: listing.skills.map(skill => ({
        folder: skill.folder,
        name: skill.name,
        hasScripts: skill.hasScripts,
        fileCount: skill.files.length,
      })),
    }
  }

  /** Preview one skill folder of a repository. */
  async previewRepository(input: string, folder: string): Promise<InstallPreview> {
    const listing = await this.gitHub.list(input)
    const skill = listing.skills.find(candidate => candidate.folder === folder)
    if (skill === undefined) {
      throw new SkillInstallError(
        `${listing.owner}/${listing.repo} holds no skill folder "${folder}"`,
        'SKILL_INSTALL_NOT_FOUND',
        folder,
      )
    }
    const documentPath = skill.files.find(file => file.path.toLowerCase() === DOCUMENT_BASENAME)?.path
    /* v8 ignore next -- skillFolders only lists folders that hold a SKILL.md. */
    if (documentPath === undefined) {
      throw new SkillInstallError(`${folder} holds no SKILL.md`, 'SKILL_INSTALL_INVALID_SKILL', folder)
    }
    const repository = { owner: listing.owner, repo: listing.repo, commit: listing.commit }
    const bytes = await this.gitHub.file(repository, joinPath(folder, documentPath), this.maxFileBytes)
    const original = decodeDocument(bytes, joinPath(folder, documentPath))
    return this.remember([this.pendingSkill(original, skill.folder, {
      kind: 'repository',
      repository,
      folder: skill.folder,
    }, {
      origin: `https://github.com/${listing.owner}/${listing.repo}`,
      commit: listing.commit,
      installedAt: new Date().toISOString(),
    }, skill.files.map(file => ({ path: file.path, size: file.size })))], {
      kind: 'repository',
      owner: listing.owner,
      repo: listing.repo,
      folder: skill.folder,
      commit: listing.commit,
    })
  }

  /** Preview the skills one archive holds. */
  async previewArchive(fileName: string, content: string): Promise<InstallPreview> {
    const bytes = decodeUpload(content, this.resolved.maxUploadBytes, fileName)
    const files = extractArchive(bytes, {
      maxEntries: this.resolved.maxArchiveEntries,
      maxUncompressedBytes: this.resolved.maxUncompressedBytes,
    })
    return this.previewContent(fileName, files, { kind: 'archive', fileName })
  }

  /** Preview the skills one dropped folder holds. */
  async previewFolder(folderName: string, files: readonly DroppedFile[]): Promise<InstallPreview> {
    const cap = this.resolved.maxUploadBytes
    const pending: PendingFile[] = []
    let total = 0
    for (const file of files) {
      const problem = relativePathProblem(file.path)
      if (problem !== undefined) {
        throw new SkillInstallError(`${file.path}: ${problem}`, 'SKILL_INSTALL_INVALID_SKILL', file.path)
      }
      const bytes = decodeUpload(file.content, cap, file.path)
      total += bytes.byteLength
      if (total > this.resolved.maxUncompressedBytes) {
        throw new SkillInstallError(`${folderName} is larger than the configured import cap`, 'SKILL_INSTALL_UPLOAD_TOO_LARGE', folderName)
      }
      pending.push({ path: file.path, bytes })
    }
    return this.previewContent(folderName, pending, { kind: 'folder', folderName })
  }

  /** Write one confirmed preview. */
  async install(previewId: string, name: string | undefined, replace: boolean): Promise<InstallResult> {
    const pending = this.takePending(previewId)
    const switches = this.skillSources()
    if (name !== undefined && pending.skills.length > 1) {
      throw new SkillInstallError('a name applies to an import of one skill', 'SKILL_INSTALL_INVALID_SKILL', name)
    }
    if (name !== undefined && !isSkillName(name)) {
      throw new SkillInstallError(`"${name}" is not a kebab-case skill name`, 'SKILL_INSTALL_INVALID_SKILL', name)
    }
    const installed: InstalledSkill[] = []
    for (const skill of pending.skills) {
      const finalName = name ?? skill.name
      const target = join(this.root, finalName)
      const existing = await entryExists(target)
      if (existing && !replace) {
        throw new SkillInstallError(
          `a skill named "${finalName}" is already installed at ${target}`,
          'SKILL_INSTALL_CONFLICT',
          finalName,
        )
      }
      const staging = join(dirname(this.root), `.skill-install-${randomUUID()}`)
      try {
        await mkdir(this.root, { recursive: true })
        await mkdir(staging, { recursive: true })
        await this.writeFiles(staging, skill)
        // The switch is recorded before the folder appears, so the skill can never
        // be visible for the moment between the move and the write.
        await switches.setSkill(HARNESS_SKILLS_SOURCE, finalName, false)
        await this.moveIntoPlace(staging, target, existing)
      } catch (error) {
        await rm(staging, { recursive: true, force: true })
        if (error instanceof SkillInstallError) throw error
        throw new SkillInstallError(`could not write ${target}`, 'SKILL_INSTALL_IO_FAILED', finalName, { cause: error })
      }
      installed.push({ name: finalName, path: target, replaced: existing })
    }
    return { installed }
  }

  /** Remove one skill this installer wrote. */
  async remove(name: string): Promise<void> {
    if (!isSkillName(name)) {
      throw new SkillInstallError(`"${name}" is not an installed skill name`, 'SKILL_INSTALL_NOT_INSTALLED', name)
    }
    const target = join(this.root, name)
    const provenance = await this.installedOrigin(target, name)
    if (provenance === undefined) {
      throw new SkillInstallError(
        `${name} was not installed by this app, so its files are left alone`,
        'SKILL_INSTALL_NOT_INSTALLED',
        name,
      )
    }
    try {
      await rm(target, { recursive: true, force: false })
    } catch (error) {
      /* v8 ignore start -- only a platform or permission fault makes this removal fail. */
      throw new SkillInstallError(`could not remove ${target}`, 'SKILL_INSTALL_IO_FAILED', name, { cause: error })
      /* v8 ignore stop */
    }
  }

  /**
   * The profile settings service that stores the skill switches.
   * @returns the mounted service.
   * @throws {SkillInstallError} `SKILL_INSTALL_UNAVAILABLE` when no profile is
   *   mounted, because an installed skill could not then stay switched off.
   */
  private skillSources() {
    const service = this.ctx.get('skillSources')
    if (service === undefined) {
      throw new SkillInstallError(
        'the profile settings service is not mounted, so an installed skill could not stay switched off',
        'SKILL_INSTALL_UNAVAILABLE',
      )
    }
    return service
  }

  /**
   * Build the preview of the bundles in one imported content set.
   * @param label - file or folder name the import came from.
   * @param files - imported files with `/` paths.
   * @param source - how the bytes arrived.
   * @returns the preview the reader confirms.
   */
  private async previewContent(label: string, files: readonly PendingFile[], source: InstallSource): Promise<InstallPreview> {
    const bundles = selectBundles(files, this.resolved.maxBundles)
    const installedAt = new Date().toISOString()
    const skills = bundles.map(bundle => this.pendingSkill(
      bundle.document,
      bundle.folder,
      { kind: 'content', files: bundle.files },
      { origin: label, installedAt },
      bundle.files.map(file => ({ path: file.path, size: file.bytes.byteLength })),
    ))
    return await this.remember(skills, source)
  }

  /**
   * Describe one skill an import would write.
   * @param original - instruction file text as imported.
   * @param folder - folder the bundle came from.
   * @param payload - how the install obtains its bytes.
   * @param provenance - origin, commit, and install instant.
   * @param listing - every file the install would write, the document included.
   * @returns the pending skill.
   */
  private pendingSkill(
    original: string,
    folder: string,
    payload: PendingSkill['payload'],
    provenance: { readonly origin: string; readonly commit?: string; readonly installedAt: string },
    listing: readonly { readonly path: string; readonly size: number }[],
  ): PendingSkill {
    const name = installName(original, folder)
    const description = declaredDescription(original)
    const document = withProvenance(original, provenance)
    const files: InstallFileView[] = listing.map(file => ({
      path: file.path,
      size: file.path.toLowerCase() === DOCUMENT_BASENAME ? Buffer.byteLength(document) : file.size,
      isScript: isScriptPath(file.path),
    }))
    return {
      name,
      ...description === undefined ? {} : { description },
      document,
      files: files.sort((left, right) => left.path.localeCompare(right.path)),
      hasScripts: files.some(file => file.isScript),
      payload,
    }
  }

  /**
   * Keep one preview installable, evicting expired entries and the oldest
   * preview once the configured count is reached.
   * @param skills - skills the import would write.
   * @param source - how the bytes arrived.
   * @returns the wire preview, with each target's current conflict state.
   */
  private async remember(skills: readonly PendingSkill[], source: InstallSource): Promise<InstallPreview> {
    const now = Date.now()
    const lifetime = this.resolved.previewTtlMs
    for (const [id, entry] of this.pending) {
      if (now - entry.at > lifetime) this.pending.delete(id)
    }
    while (this.pending.size >= this.resolved.maxPreviews) {
      const oldest = this.pending.keys().next()
      /* v8 ignore next -- the loop condition proves one preview is pending. */
      if (oldest.done === true) break
      this.pending.delete(oldest.value)
    }
    const id = randomUUID()
    this.pending.set(id, { at: now, value: { source, skills } })
    const previews: PreviewSkill[] = []
    for (const skill of skills) {
      previews.push({
        name: skill.name,
        ...skill.description === undefined ? {} : { description: skill.description },
        document: skill.document,
        files: skill.files,
        hasScripts: skill.hasScripts,
        target: join(this.root, skill.name),
        conflict: await entryExists(join(this.root, skill.name)),
      })
    }
    return { id, source, skills: previews }
  }

  /**
   * Take one preview out of the pending set.
   * @param id - id the confirmation sent back.
   * @returns the import to write.
   * @throws {SkillInstallError} `SKILL_INSTALL_PREVIEW_EXPIRED` when the id is
   *   unknown, already used, or older than the configured lifetime.
   */
  private takePending(id: string): PendingImport {
    const entry = this.pending.get(id)
    this.pending.delete(id)
    if (entry === undefined || Date.now() - entry.at > this.resolved.previewTtlMs) {
      throw new SkillInstallError('the preview expired; preview the skill again', 'SKILL_INSTALL_PREVIEW_EXPIRED')
    }
    return entry.value
  }

  /**
   * Write one pending skill's files into its staging folder.
   * @param staging - absolute staging folder the move will publish.
   * @param skill - pending skill to write.
   */
  private async writeFiles(staging: string, skill: PendingSkill): Promise<void> {
    let total = 0
    const writes: { path: string; bytes: Uint8Array }[] = []
    if (skill.payload.kind === 'content') {
      for (const file of skill.payload.files) {
        const bytes = this.contentBytes(file, skill.document)
        total = this.withinTotal(total, bytes, skill)
        writes.push({ path: file.path, bytes })
      }
    } else {
      for (const file of skill.files) {
        const bytes = file.path.toLowerCase() === DOCUMENT_BASENAME
          ? new TextEncoder().encode(skill.document)
          : await this.gitHub.file(
            skill.payload.repository, joinPath(skill.payload.folder, file.path), this.maxFileBytes,
          )
        total = this.withinTotal(total, bytes, skill)
        writes.push({ path: file.path, bytes })
      }
    }
    for (const write of writes) {
      const problem = relativePathProblem(write.path)
      /* v8 ignore next -- every writer validates its paths before this point. */
      if (problem !== undefined) {
        throw new SkillInstallError(`${write.path}: ${problem}`, 'SKILL_INSTALL_INVALID_SKILL', write.path)
      }
      const destination = resolve(staging, ...write.path.split('/'))
      /* v8 ignore next -- a safe relative path always resolves inside the staging folder. */
      if (destination !== join(staging, ...write.path.split('/')) || !destination.startsWith(staging + sep)) {
        throw new SkillInstallError(`${write.path} escapes the skill folder`, 'SKILL_INSTALL_INVALID_SKILL', write.path)
      }
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, write.bytes, { flag: 'wx' })
    }
  }

  /**
   * Bytes one imported file is written as: the instruction file takes the
   * provenance-carrying document, every other file its imported bytes.
   * @param file - file of the imported bundle.
   * @param document - instruction file text with the install record.
   * @returns the bytes to write.
   */
  private contentBytes(file: PendingFile, document: string): Uint8Array {
    return file.path.toLowerCase() === DOCUMENT_BASENAME ? new TextEncoder().encode(document) : file.bytes
  }

  /**
   * Add one file to the running total and refuse a skill past the size cap.
   * @param total - bytes accepted so far.
   * @param bytes - bytes of the next file.
   * @param skill - skill being written, quoted in the failure.
   * @returns the new total.
   * @throws {SkillInstallError} `SKILL_INSTALL_IO_FAILED` when the complete skill
   *   would exceed the configured cap.
   */
  private withinTotal(total: number, bytes: Uint8Array, skill: PendingSkill): number {
    const next = total + bytes.byteLength
    if (next > this.maxTotalBytes) {
      throw new SkillInstallError(
        `${skill.name} is larger than the configured ${this.maxTotalBytes} bytes`,
        'SKILL_INSTALL_IO_FAILED',
        skill.name,
      )
    }
    return next
  }

  /**
   * Publish one staged skill folder, replacing the existing one only when the
   * reader chose to replace it.
   * @param staging - staged folder holding the complete skill.
   * @param target - folder the skill is published as.
   * @param existing - whether something already occupies `target`.
   */
  private async moveIntoPlace(staging: string, target: string, existing: boolean): Promise<void> {
    const backup = `${staging}-replaced`
    try {
      if (existing) await rename(target, backup)
      await rename(staging, target)
    } catch (error) {
      /* v8 ignore start -- only a platform or permission fault makes a publish fail here. */
      // The old folder is restored so a failed publish leaves the skill as it was.
      if (existing) await rename(backup, target).catch(() => undefined)
      await rm(staging, { recursive: true, force: true })
      throw new SkillInstallError(`could not write ${target}`, 'SKILL_INSTALL_IO_FAILED', target, { cause: error })
      /* v8 ignore stop */
    }
    await rm(backup, { recursive: true, force: true })
  }

  /**
   * Read the install record of one folder.
   * @param target - absolute folder to read.
   * @param name - skill name, quoted in failures.
   * @returns the recorded origin, or undefined when the folder is absent or was
   *   not written by this installer.
   */
  private async installedOrigin(target: string, name: string): Promise<string | undefined> {
    let document: string
    try {
      document = new TextDecoder().decode(await readFile(join(target, 'SKILL.md')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw new SkillInstallError(`could not read ${target}`, 'SKILL_INSTALL_IO_FAILED', name, { cause: error })
    }
    return recordedOrigin(document)
  }
}

/**
 * Read the install record from one instruction file.
 * @param document - `SKILL.md` text.
 * @returns the recorded repository, or undefined when the file carries none.
 */
function recordedOrigin(document: string): string | undefined {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u.exec(document)
  if (match === null) return undefined
  const url = /^\s+repository:\s*(.+)$/mu.exec(group(match, 1))
  return url?.[1]?.trim().replace(/^["']|["']$/gu, '') || undefined
}

/**
 * Join one repository-relative path with `/` separators.
 * @param folder - folder inside the repository.
 * @param path - path inside the folder.
 * @returns the repository-relative path.
 */
function joinPath(folder: string, path: string): string {
  return folder.length === 0 ? path : `${folder}/${path}`
}

/**
 * Whether one path exists.
 * @param path - absolute path to test.
 * @returns true when something occupies the path.
 */
async function entryExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    /* v8 ignore start -- a stat failure other than absence needs a permission fault; a path below a file reads as absence on Windows. */
    throw new SkillInstallError(`could not inspect ${path}`, 'SKILL_INSTALL_IO_FAILED', path, { cause: error })
    /* v8 ignore stop */
  }
}
