/**
 * Read a `.zip` archive into the files an install may write, without trusting
 * anything the archive says about itself.
 *
 * The central directory is parsed here rather than by the decompressor, so the
 * entry count, the entry names, the declared sizes, and the Unix mode of every
 * entry are known before one byte is inflated. Names carrying a parent segment,
 * an absolute path, a drive letter, or a backslash are refused (zip-slip), Unix
 * symbolic links and device entries are refused, and the declared total size is
 * capped. Only then are the accepted entries inflated, and each one must match
 * the size the directory declared.
 *
 * @module @deepseek-ai/dsh-skill-install/archive
 */

import { unzipSync } from 'fflate'
import { SkillInstallError } from './errors.ts'
import { relativePathProblem } from './relative-path.ts'

/** Extraction limits, resolved from the plugin Config. */
export interface ArchiveLimits {
  /** Most entries one archive may declare. */
  readonly maxEntries: number
  /** Most bytes one archive may declare as its total uncompressed size. */
  readonly maxUncompressedBytes: number
}

/** One accepted archive file. */
export interface ArchiveFile {
  /** Path inside the archive, with `/` separators and no parent segment. */
  readonly path: string
  /** File bytes. */
  readonly bytes: Uint8Array
}

/** End-of-central-directory signature. */
const EOCD_SIGNATURE = 0x06054b50
/** Central-directory file header signature. */
const DIRECTORY_SIGNATURE = 0x02014b50
/** Longest comment an end record may be followed by. */
const MAX_COMMENT_BYTES = 65_535
/** Stored and deflated are the only methods the installer accepts. */
const STORED = 0
const DEFLATED = 8
/** Flag bit 0 marks an encrypted entry. */
const ENCRYPTED_FLAG = 0x0001
/** Host operating system 3 is Unix; its external attributes carry a mode. */
const UNIX_HOST = 3
/** Unix file-type mask and the symbolic-link type. */
const UNIX_TYPE_MASK = 0o170000
const UNIX_SYMLINK = 0o120000

/** One entry as the central directory describes it. */
interface DirectoryEntry {
  readonly name: string
  readonly flags: number
  readonly compression: number
  readonly compressedSize: number
  readonly uncompressedSize: number
  readonly externalAttributes: number
  readonly hostSystem: number
}

/**
 * Extract one archive under the configured limits.
 * @param bytes - archive bytes as the reader supplied them.
 * @param limits - entry count and uncompressed size caps.
 * @returns the accepted files, sorted by path.
 * @throws {SkillInstallError} `SKILL_INSTALL_ARCHIVE_INVALID` for a corrupt archive,
 *   an unsafe entry path, a link, an unsupported compression method, an encrypted
 *   entry, too many entries, a total size over the cap, or a size that disagrees
 *   with the directory, so nothing is written from an archive that fails a rule.
 */
export function extractArchive(bytes: Uint8Array, limits: ArchiveLimits): readonly ArchiveFile[] {
  const entries = readDirectory(bytes)
  if (entries.length > limits.maxEntries) {
    throw invalid(`the archive declares ${entries.length} entries, more than the configured ${limits.maxEntries}`)
  }
  const accepted: DirectoryEntry[] = []
  const seen = new Set<string>()
  let declaredTotal = 0
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue
    assertSafePath(entry.name)
    if (seen.has(entry.name)) throw invalid(`the archive holds "${entry.name}" twice`)
    seen.add(entry.name)
    assertPlainFile(entry)
    if (entry.compression !== STORED && entry.compression !== DEFLATED) {
      throw invalid(`"${entry.name}" uses compression method ${entry.compression}, which is not supported`)
    }
    declaredTotal += entry.uncompressedSize
    if (declaredTotal > limits.maxUncompressedBytes) {
      throw invalid(`the archive expands to more than the configured ${limits.maxUncompressedBytes} bytes`)
    }
    accepted.push(entry)
  }
  if (accepted.length === 0) throw invalid('the archive holds no file')
  const wanted = new Set(accepted.map(entry => entry.name))
  let inflated: Record<string, Uint8Array>
  try {
    inflated = unzipSync(bytes, { filter: file => wanted.has(file.name) })
  } catch (error) {
    throw invalid('the archive is corrupt', error)
  }
  const files: ArchiveFile[] = []
  for (const entry of accepted) {
    const content = inflated[entry.name]
    /* v8 ignore next 2 -- the decompressor names every accepted entry as the directory listed it. */
    if (content === undefined) throw invalid(`the archive is corrupt: "${entry.name}" did not expand`)
    if (content.byteLength !== entry.uncompressedSize) {
      throw invalid(`"${entry.name}" declares ${entry.uncompressedSize} bytes but expands to ${content.byteLength}`)
    }
    files.push({ path: entry.name, bytes: content })
  }
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

/**
 * Read the central directory of one archive.
 * @param bytes - archive bytes.
 * @returns every declared entry, in directory order.
 * @throws {SkillInstallError} `SKILL_INSTALL_ARCHIVE_INVALID` when the end record or
 *   directory is missing, corrupt, or uses the ZIP64 extension this reader refuses.
 */
function readDirectory(bytes: Uint8Array): readonly DirectoryEntry[] {
  const eocd = findEndRecord(bytes)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint16(eocd + 10, true)
  const directorySize = view.getUint32(eocd + 12, true)
  const directoryOffset = view.getUint32(eocd + 16, true)
  if (count === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff) {
    throw invalid('ZIP64 archives are not supported')
  }
  if (directoryOffset + directorySize > bytes.byteLength) {
    throw invalid('the central directory runs past the end of the archive')
  }
  const entries: DirectoryEntry[] = []
  let offset = directoryOffset
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== DIRECTORY_SIGNATURE) {
      throw invalid('the central directory is corrupt')
    }
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const nameStart = offset + 46
    if (nameStart + nameLength > bytes.byteLength) throw invalid('the central directory is corrupt')
    entries.push({
      name: new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength)),
      hostSystem: view.getUint8(offset + 5),
      flags: view.getUint16(offset + 8, true),
      compression: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      uncompressedSize: view.getUint32(offset + 24, true),
      externalAttributes: view.getUint32(offset + 38, true),
    })
    offset = nameStart + nameLength + extraLength + commentLength
  }
  return entries
}

/**
 * Locate the end-of-central-directory record, which an archive comment may follow.
 * @param bytes - archive bytes.
 * @returns the record's byte offset.
 * @throws {SkillInstallError} `SKILL_INSTALL_ARCHIVE_INVALID` when no record exists.
 */
function findEndRecord(bytes: Uint8Array): number {
  if (bytes.byteLength < 22) throw invalid('the file is too small to be a zip archive')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const lowest = Math.max(0, bytes.byteLength - 22 - MAX_COMMENT_BYTES)
  for (let offset = bytes.byteLength - 22; offset >= lowest; offset--) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset
  }
  throw invalid('the file is not a zip archive')
}

/**
 * Refuse an entry name that could escape the target folder or name another device.
 * @param name - entry name from the central directory.
 * @throws {SkillInstallError} `SKILL_INSTALL_ARCHIVE_INVALID` for an absolute path,
 *   a drive letter, a backslash, an empty segment, or a parent segment.
 */
function assertSafePath(name: string): void {
  const problem = relativePathProblem(name)
  if (problem !== undefined) throw invalid(`"${name}": ${problem}`)
}

/**
 * Refuse a Unix link, device, or encrypted entry.
 * @param entry - one central-directory entry.
 * @throws {SkillInstallError} `SKILL_INSTALL_ARCHIVE_INVALID` for a symbolic link,
 *   any other special entry, or an encrypted file.
 */
function assertPlainFile(entry: DirectoryEntry): void {
  if ((entry.flags & ENCRYPTED_FLAG) !== 0) throw invalid(`"${entry.name}" is encrypted`)
  if (entry.hostSystem !== UNIX_HOST) return
  const type = (entry.externalAttributes >>> 16) & UNIX_TYPE_MASK
  if (type === UNIX_SYMLINK) throw invalid(`"${entry.name}" is a symbolic link`)
  // A recorded type of 0 means the archiver left the mode unset; any other type
  // that is not a regular file is a device, FIFO, or socket.
  if (type !== 0 && type !== 0o100000) throw invalid(`"${entry.name}" is not a regular file`)
}

/**
 * Refuse one archive.
 * @param reason - what is wrong with it.
 * @param cause - underlying failure, when one caused the refusal.
 * @returns the typed failure to throw.
 */
function invalid(reason: string, cause?: unknown): SkillInstallError {
  const options = cause === undefined ? undefined : { cause }
  return new SkillInstallError(`the archive cannot be imported: ${reason}`, 'SKILL_INSTALL_ARCHIVE_INVALID', undefined, options)
}
