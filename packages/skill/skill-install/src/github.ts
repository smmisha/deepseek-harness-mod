/**
 * Turn the reader's repository text into the skill folders it holds, and fetch
 * the bytes an install needs.
 *
 * Every request goes through the installer's {@link HttpClient}, so the
 * allowlist, timeout, redirect, and size rules hold here too. Nothing is
 * downloaded until the reader confirms a preview.
 *
 * @module @deepseek-ai/dsh-skill-install/github
 */

import { SkillInstallError } from './errors.ts'
import type { HttpClient } from './http.ts'
import { parseRepositorySpec, type RepositorySpec } from './source-spec.ts'

/** Per-repository read limits, resolved from the plugin Config. */
export interface GitHubLimits {
  /** Largest metadata or listing body accepted, in bytes. */
  readonly maxMetadataBytes: number
  /** Largest `SKILL.md` accepted, in bytes. */
  readonly maxDocumentBytes: number
  /** Largest skill file accepted, in bytes. */
  readonly maxFileBytes: number
  /** Most files one skill folder may hold. */
  readonly maxFiles: number
}

/** One repository resolved to an immutable commit. */
export interface ResolvedRepository {
  /** Repository owner. */
  readonly owner: string
  /** Repository name. */
  readonly repo: string
  /** Commit the listing was read from; every later read pins this exact commit. */
  readonly commit: string
}

/** One blob in a repository tree, with the size GitHub reported. */
export interface TreeBlob {
  /** Path inside the repository, with `/` separators. */
  readonly path: string
  /** Byte size, or 0 when the tree omitted it. */
  readonly size: number
}

/** One skill folder found in a resolved tree. */
export interface SkillFolder {
  /** Folder inside the repository, with `/` separators. */
  readonly folder: string
  /** Folder basename, used as the skill name before its frontmatter is read. */
  readonly name: string
  /** Files the folder holds, relative to the folder. */
  readonly files: readonly TreeBlob[]
  /** Whether any file is one an agent could run. */
  readonly hasScripts: boolean
}

/** A resolved repository and the skill folders it holds. */
export interface TreeListing extends ResolvedRepository {
  /** Folders with a `SKILL.md`, sorted by folder. */
  readonly skills: readonly SkillFolder[]
}

/** Extensions whose files an agent may run instead of reading them. */
const SCRIPT_EXTENSIONS = new Set([
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd', 'py', 'rb', 'pl', 'php', 'js', 'mjs', 'cjs', 'ts', 'lua', 'exe',
  'com', 'jar',
])

/** GitHub's REST media type for the JSON representation. */
const GITHUB_ACCEPT = 'application/vnd.github+json'

/**
 * Whether one repository-relative path is a script an agent could run.
 * @param path - path with `/` separators.
 * @returns true for a `scripts` or `bin` file, or an interpreter/executable extension.
 */
export function isScriptPath(path: string): boolean {
  const segments = path.split('/')
  if (segments.slice(0, -1).some(segment => segment === 'scripts' || segment === 'bin')) return true
  const dot = path.lastIndexOf('.')
  return dot >= 0 && SCRIPT_EXTENSIONS.has(path.slice(dot + 1).toLowerCase())
}

/**
 * Group one repository tree into the folders that hold a `SKILL.md`.
 * @param blobs - every blob in the tree, with repository-relative paths.
 * @param maxFiles - most files one skill folder may hold; a larger folder is refused.
 * @returns the skill folders, sorted by folder.
 * @throws {SkillInstallError} `SKILL_INSTALL_INVALID_SKILL` when a folder holds more
 *   files than the configured cap, so one oversized folder cannot flood an install.
 */
export function skillFolders(blobs: readonly TreeBlob[], maxFiles: number): readonly SkillFolder[] {
  const documents = blobs.filter(blob => /(?:^|\/)skill\.md$/iu.test(blob.path))
  const folders: SkillFolder[] = []
  for (const document of documents) {
    const folder = document.path.slice(0, Math.max(0, document.path.lastIndexOf('/')))
    const prefix = folder.length === 0 ? '' : `${folder}/`
    const files = blobs
      .filter(blob => blob.path.startsWith(prefix) && blob.path.length > prefix.length)
      // A root bundle owns only the files beside its document; a deeper folder's
      // files belong to that folder's own bundle.
      .filter(blob => folder.length > 0 || !blob.path.includes('/'))
      .map(blob => ({ path: blob.path.slice(prefix.length), size: blob.size }))
    if (files.length > maxFiles) {
      throw new SkillInstallError(
        `${folder.length === 0 ? 'the repository root' : folder} holds ${files.length} files, more than the configured ${maxFiles}`,
        'SKILL_INSTALL_INVALID_SKILL',
        folder,
      )
    }
    folders.push({
      folder,
      name: folder.length === 0 ? '' : folder.slice(folder.lastIndexOf('/') + 1),
      files,
      hasScripts: files.some(file => isScriptPath(file.path)),
    })
  }
  return folders.sort((left, right) => left.folder.localeCompare(right.folder))
}

/** Reads one repository through the GitHub REST and raw hosts. */
export class GitHubResolver {
  /**
   * @param http - the installer's outbound client.
   * @param limits - per-repository read limits.
   */
  constructor(private readonly http: HttpClient, private readonly limits: GitHubLimits) {}

  /**
   * Resolve one repository reference and list the skill folders it holds.
   * @param input - `owner/repo`, a GitHub URL, or an `npx skills add` command.
   * @returns the pinned commit and every folder holding a `SKILL.md`.
   * @throws {SkillInstallError} `SKILL_INSTALL_SPEC_INVALID` for unusable text,
   *   `SKILL_INSTALL_NOT_FOUND` for a missing repository, `SKILL_INSTALL_RATE_LIMITED`
   *   when GitHub's unauthenticated quota is spent, `SKILL_INSTALL_TREE_TOO_LARGE`
   *   for a truncated tree, and `SKILL_INSTALL_NETWORK` for any transport failure.
   */
  async list(input: string): Promise<TreeListing> {
    const spec = parseRepositorySpec(input)
    const commit = await this.latestCommit(spec)
    const response = await this.get(
      `https://api.github.com/repos/${spec.owner}/${spec.repo}/git/trees/${commit}?recursive=1`,
      GITHUB_ACCEPT, this.limits.maxMetadataBytes, `${spec.owner}/${spec.repo}`,
    )
    const body = jsonRecord(response, `${spec.owner}/${spec.repo}`)
    if (body.truncated === true) {
      throw new SkillInstallError(
        `${spec.owner}/${spec.repo} has a tree GitHub truncated, so its skills cannot be listed`,
        'SKILL_INSTALL_TREE_TOO_LARGE',
        `${spec.owner}/${spec.repo}`,
      )
    }
    const entries = body.tree
    if (!Array.isArray(entries)) {
      throw new SkillInstallError(`GitHub returned no tree for ${spec.owner}/${spec.repo}`, 'SKILL_INSTALL_NETWORK')
    }
    const blobs: TreeBlob[] = []
    for (const entry of entries) {
      const node = record(entry)
      if (node === undefined || node.type !== 'blob' || typeof node.path !== 'string') continue
      blobs.push({ path: node.path, size: typeof node.size === 'number' ? node.size : 0 })
    }
    return { ...spec, commit, skills: skillFolders(blobs, this.limits.maxFiles) }
  }

  /**
   * Read one repository file at a pinned commit.
   * @param repository - owner, repository name, and commit.
   * @param path - repository-relative path with `/` separators.
   * @param maxBytes - largest file accepted, in bytes.
   * @returns the file bytes.
   * @throws {SkillInstallError} `SKILL_INSTALL_NOT_FOUND` for a missing file and
   *   `SKILL_INSTALL_NETWORK` for a transport failure or an oversized file.
   */
  async file(repository: ResolvedRepository, path: string, maxBytes: number): Promise<Uint8Array> {
    const encoded = path.split('/').map(encodeURIComponent).join('/')
    const owner = encodeURIComponent(repository.owner)
    const repo = encodeURIComponent(repository.repo)
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${repository.commit}/${encoded}`
    return (await this.http.get(url, { accept: 'text/plain', maxBytes })).bytes
  }

  /**
   * Read the latest commit on the repository's default branch.
   * @param spec - resolved owner and repository name.
   * @returns the commit SHA every later read pins.
   */
  private async latestCommit(spec: RepositorySpec): Promise<string> {
    const target = `${spec.owner}/${spec.repo}`
    const response = await this.get(
      `https://api.github.com/repos/${spec.owner}/${spec.repo}/commits?per_page=1`, GITHUB_ACCEPT,
      this.limits.maxMetadataBytes, target,
    )
    const body = jsonValue(response, target)
    const first: unknown = Array.isArray(body) ? body[0] : undefined
    const sha = record(first)?.sha
    if (typeof sha !== 'string' || sha.length === 0) {
      throw new SkillInstallError(`GitHub returned no commit for ${target}`, 'SKILL_INSTALL_NETWORK', target)
    }
    return sha
  }

  /**
   * Send one GitHub REST request.
   * @param url - absolute request URL on an allowlisted host.
   * @param accept - `Accept` header for the representation wanted.
   * @param maxBytes - largest body accepted, in bytes.
   * @param target - repository the request is about, quoted in failures.
   * @returns the response, whose body is returned for any status.
   */
  private async get(url: string, accept: string, maxBytes: number, target: string) {
    const response = await this.http.get(url, { accept, maxBytes })
    if (response.status === 404) {
      throw new SkillInstallError(`GitHub has no ${target}`, 'SKILL_INSTALL_NOT_FOUND', target)
    }
    if (response.status === 403 || response.status === 429) {
      throw new SkillInstallError(
        `GitHub refused ${target}: the unauthenticated rate limit is spent`,
        'SKILL_INSTALL_RATE_LIMITED',
        target,
      )
    }
    if (response.status < 200 || response.status > 299) {
      throw new SkillInstallError(`GitHub answered ${response.status} for ${target}`, 'SKILL_INSTALL_NETWORK', target)
    }
    return response
  }
}

/** One JSON object, as far as a resolver reads it. */
type JsonRecord = Readonly<Record<string, unknown>>

/**
 * Narrow a parsed JSON value to an object.
 * @param value - parsed value.
 * @returns the value as a record, or undefined for anything else.
 */
function record(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : undefined
}

/**
 * Decode one response body as JSON.
 * @param response - response to decode.
 * @param target - repository the request is about, quoted in failures.
 * @returns the parsed value.
 * @throws {SkillInstallError} `SKILL_INSTALL_NETWORK` when the body is not JSON.
 */
function jsonValue(response: { readonly bytes: Uint8Array }, target: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(response.bytes)) as unknown
  } catch (error) {
    throw new SkillInstallError(`GitHub returned a body that is not JSON for ${target}`, 'SKILL_INSTALL_NETWORK', target, { cause: error })
  }
}

/**
 * Decode one response body as a JSON object.
 * @param response - response to decode.
 * @param target - repository the request is about, quoted in failures.
 * @returns the parsed object.
 * @throws {SkillInstallError} `SKILL_INSTALL_NETWORK` when the body is not a JSON object.
 */
function jsonRecord(response: { readonly bytes: Uint8Array }, target: string): JsonRecord {
  const value = jsonValue(response, target)
  const body = record(value)
  if (body === undefined) {
    throw new SkillInstallError(`GitHub returned no JSON object for ${target}`, 'SKILL_INSTALL_NETWORK', target)
  }
  return body
}
