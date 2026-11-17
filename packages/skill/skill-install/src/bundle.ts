/**
 * Turn imported files into skill bundles, and write the install provenance into
 * the `SKILL.md` the skill will be read from.
 *
 * Frontmatter is parsed as YAML because a skill declares its name and
 * description there, and the install record belongs in the same `metadata`
 * object the filesystem provider already reads. Nothing else in the archive is
 * interpreted: no script is run, no postinstall exists, and every other file is
 * copied byte for byte.
 *
 * @module @deepseek-ai/dsh-skill-install/bundle
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import { group } from './match.ts'
import { SkillInstallError } from './errors.ts'
import { isScriptPath } from './github.ts'

/** One file of an imported bundle, before it is written. */
export interface BundleFile {
  /** Path relative to the bundle folder, with `/` separators. */
  readonly path: string
  /** File bytes exactly as imported. */
  readonly bytes: Uint8Array
}

/** One skill folder found in imported content. */
export interface SkillBundle {
  /** Folder inside the imported content, or an empty string for its root. */
  readonly folder: string
  /** Instruction file text, decoded as UTF-8. */
  readonly document: string
  /** Files the folder holds, relative to the folder, `SKILL.md` included. */
  readonly files: readonly BundleFile[]
}

/** What the installer records about one skill it writes. */
export interface InstallProvenance {
  /** Repository or archive the skill came from, rendered verbatim in the detail panel. */
  readonly origin: string
  /** Commit the files were read from, when the source pins one. */
  readonly commit?: string
  /** ISO-8601 instant the install completed. */
  readonly installedAt: string
}

/** A `SKILL.md` split into its frontmatter and body. */
interface SkillDocument {
  /** Parsed frontmatter object, when it parses to one. */
  readonly data: Readonly<Record<string, unknown>>
  /** Frontmatter text without its markers, or an empty string when absent. */
  readonly frontmatter: string
  /** Everything after the closing marker. */
  readonly body: string
}

/** The instruction file every skill folder carries. */
const DOCUMENT_NAME = /^skill\.md$/iu

/**
 * Group imported files by the folder that holds a `SKILL.md`.
 * @param files - files of an archive or dropped folder, with `/` separators.
 * @param maxBundles - most skill folders one import may carry.
 * @returns the bundles, sorted by folder.
 * @throws {SkillInstallError} `SKILL_INSTALL_INVALID_SKILL` when the content holds
 *   no `SKILL.md`, or more skill folders than the configured cap.
 */
export function selectBundles(files: readonly BundleFile[], maxBundles: number): readonly SkillBundle[] {
  const folders = new Map<string, BundleFile[]>()
  for (const file of files) {
    if (!DOCUMENT_NAME.test(file.path.slice(file.path.lastIndexOf('/') + 1))) continue
    const folder = file.path.slice(0, Math.max(0, file.path.lastIndexOf('/')))
    const members = folders.get(folder) ?? []
    members.push(file)
    folders.set(folder, members)
  }
  if (folders.size === 0) {
    throw new SkillInstallError('the content holds no SKILL.md, so it is not a skill', 'SKILL_INSTALL_INVALID_SKILL')
  }
  if (folders.size > maxBundles) {
    throw new SkillInstallError(
      `the content holds ${folders.size} skills, more than the configured ${maxBundles}`,
      'SKILL_INSTALL_INVALID_SKILL',
    )
  }
  const bundles: SkillBundle[] = []
  for (const [folder, documents] of folders) {
    const document = documents[0]
    /* v8 ignore next -- the map is built from one document per folder. */
    if (document === undefined) continue
    const prefix = folder.length === 0 ? '' : `${folder}/`
    const members: BundleFile[] = []
    for (const file of files) {
      if (!file.path.startsWith(prefix) || file.path.length === prefix.length) continue
      members.push({ path: file.path.slice(prefix.length), bytes: file.bytes })
    }
    bundles.push({ folder, document: decode(document.bytes, document.path), files: members })
  }
  return bundles.sort((left, right) => left.folder.localeCompare(right.folder))
}

/**
 * Choose the folder name a bundle installs under: the frontmatter name when it
 * is a valid skill name, otherwise a kebab-case name derived from the declared
 * name or the source folder.
 * @param document - instruction file text of the bundle.
 * @param folder - folder the bundle came from, used when the frontmatter names none.
 * @returns the install name.
 * @throws {SkillInstallError} `SKILL_INSTALL_INVALID_SKILL` when neither the
 *   frontmatter nor the folder yields a name the skill catalog accepts.
 */
export function installName(document: string, folder: string): string {
  const parsed = parseDocument(document)
  const declared = typeof parsed.data.name === 'string' ? parsed.data.name.trim() : ''
  if (isSkillName(declared)) return declared
  const fallback = declared.length > 0 ? declared : (folder.slice(folder.lastIndexOf('/') + 1) || 'skill')
  const slug = fallback.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
  if (!isSkillName(slug)) {
    throw new SkillInstallError(
      `"${fallback}" is not a usable skill name; install it under a kebab-case name instead`,
      'SKILL_INSTALL_INVALID_SKILL',
      fallback,
    )
  }
  return slug
}

/**
 * Read the description a bundle declares.
 * @param document - instruction file text.
 * @returns the description on one line, or undefined when it declares none.
 */
export function declaredDescription(document: string): string | undefined {
  const description = parseDocument(document).data.description
  if (typeof description !== 'string') return undefined
  const normalized = description.replace(/\s+/gu, ' ').trim()
  return normalized.length === 0 ? undefined : normalized
}

/**
 * Write the install record into one instruction file.
 * @param document - instruction file text as imported.
 * @param provenance - origin, commit, and install instant.
 * @returns the text to write, with `metadata.repository`, `metadata.commit`, and
 *   `metadata.installedAt` set and every other frontmatter entry preserved.
 * @throws {SkillInstallError} `SKILL_INSTALL_INVALID_SKILL` when the file carries
 *   no readable YAML frontmatter, so an unreadable skill is never installed.
 */
export function withProvenance(document: string, provenance: InstallProvenance): string {
  const parsed = parseDocument(document)
  const metadata = typeof parsed.data.metadata === 'object' && parsed.data.metadata !== null
    ? { ...parsed.data.metadata as Readonly<Record<string, unknown>> }
    : {}
  const merged = {
    ...parsed.data,
    metadata: {
      ...metadata,
      repository: provenance.origin,
      ...provenance.commit === undefined ? {} : { commit: provenance.commit },
      installedAt: provenance.installedAt,
    },
  }
  const text = stringifyYaml(merged).trimEnd()
  return `---\n${text}\n---\n${parsed.body.replace(/^\n+/u, '')}`
}

/**
 * Whether one file is a script an agent could run.
 * @param path - path relative to the bundle folder.
 * @returns true for a `scripts` or `bin` file, or an interpreter/executable extension.
 */
export function isScriptFile(path: string): boolean {
  return isScriptPath(path)
}

/**
 * Split one instruction file into frontmatter and body.
 * @param text - instruction file text.
 * @returns the parsed frontmatter and the body.
 * @throws {SkillInstallError} `SKILL_INSTALL_INVALID_SKILL` when the frontmatter
 *   is absent, unterminated, or not a YAML object.
 */
function parseDocument(text: string): SkillDocument {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u.exec(text)
  if (match === null) {
    throw new SkillInstallError('the SKILL.md has no YAML frontmatter', 'SKILL_INSTALL_INVALID_SKILL')
  }
  const frontmatter = group(match, 1)
  let data: unknown
  try {
    data = parseYaml(frontmatter) as unknown
  } catch (error) {
    throw new SkillInstallError('the SKILL.md frontmatter is not valid YAML', 'SKILL_INSTALL_INVALID_SKILL', undefined, { cause: error })
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new SkillInstallError('the SKILL.md frontmatter is not a mapping', 'SKILL_INSTALL_INVALID_SKILL')
  }
  return { data: data as Readonly<Record<string, unknown>>, frontmatter, body: text.slice(match[0].length) }
}

/**
 * Decode one imported file as UTF-8.
 * @param bytes - file bytes.
 * @param path - file path, quoted in the failure.
 * @returns the decoded text.
 * @throws {SkillInstallError} `SKILL_INSTALL_INVALID_SKILL` when the file is not UTF-8.
 */
function decode(bytes: Uint8Array, path: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw new SkillInstallError(`${path} is not UTF-8 text`, 'SKILL_INSTALL_INVALID_SKILL', path, { cause: error })
  }
}
