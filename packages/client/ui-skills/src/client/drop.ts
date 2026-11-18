/**
 * Reading what the reader dropped onto the Skills tab: one `.zip` archive, or a
 * folder of skill files. The browser supplies the bytes; the Host validates and
 * installs them, so this module only enumerates, caps, and encodes.
 */

/** One file the tab uploads, path relative to the dropped folder. */
export interface DroppedFileView {
  /** Path inside the dropped folder, with `/` separators. */
  readonly path: string
  /** Base64 content. */
  readonly content: string
}

/** One entry of a dropped directory, as the browser reports it. */
export interface DropEntry {
  /** Whether the entry is a file. */
  readonly isFile: boolean
  /** Whether the entry is a directory. */
  readonly isDirectory: boolean
  /** Entry name. */
  readonly name: string
  /**
   * Read the file this entry names.
   * @param success - receives the file.
   * @param failure - receives the browser's error.
   */
  file?(success: (file: File) => void, failure: (error: unknown) => void): void
  /**
   * Open the entry for listing.
   * @returns the directory reader.
   */
  createReader?(): DropReader
}

/** One directory reader, as the browser hands it over. */
export interface DropReader {
  /**
   * Read the next batch of entries.
   * @param success - receives the batch; an empty batch ends the listing.
   * @param failure - receives the browser's error.
   */
  readEntries(success: (entries: DropEntry[]) => void, failure: (error: unknown) => void): void
}

/** One item of a drop, as the browser reports it. */
export interface DropItem {
  /**
   * The filesystem entry behind this item.
   * @returns the entry, or null when the item has none.
   */
  webkitGetAsEntry?(): DropEntry | null
}

/** One file of a drop, with the relative path a folder drop reports when it has one. */
export interface DropFile {
  /** File name. */
  readonly name: string
  /** Byte size. */
  readonly size: number
  /**
   * Read the file bytes.
   * @returns the file content.
   */
  arrayBuffer(): Promise<ArrayBuffer>
  /** Path relative to the dropped folder; a browser may report none. */
  readonly webkitRelativePath?: string | undefined
}

/** The data transfer of one drop, structurally typed so a test can supply one. */
export interface DropTransfer {
  /** Items the drop carries. */
  readonly items?: ArrayLike<DropItem> | undefined
  /** Files the drop carries. */
  readonly files?: ArrayLike<DropFile> | undefined
}

/** What one drop turned into: an archive, or the files of a folder. */
export type DroppedImport =
  | { readonly kind: 'archive'; readonly fileName: string; readonly content: string }
  | { readonly kind: 'folder'; readonly folderName: string; readonly files: readonly DroppedFileView[] }

/** Why a drop produced nothing to install. */
export type DropProblem =
  /** Nothing readable was dropped. */
  | 'empty'
  /** The drop exceeds the byte cap the Host accepts. */
  | 'too-large'
  /** The drop holds more files than the Host accepts. */
  | 'too-many'

/** One drop's outcome. */
export type DropOutcome =
  | { readonly kind: 'ok'; readonly value: DroppedImport }
  | { readonly kind: 'problem'; readonly problem: DropProblem }

/** Largest upload this tab sends, mirroring the Host's default cap. */
export const MAX_UPLOAD_BYTES = 16 * 1024 * 1024

/** Most files one dropped folder may carry, mirroring the Host's default cap. */
export const MAX_DROPPED_FILES = 200

/** Most directory levels a dropped folder may nest. */
const MAX_DEPTH = 4

/**
 * Whether a file name is a zip archive the tab imports.
 * @param name - file name from the drop.
 * @returns true for a `.zip` name in any letter case.
 */
export function isArchiveName(name: string): boolean {
  return /\.zip$/iu.test(name)
}

/**
 * Read one drop into the import the Host can preview.
 * @param transfer - the browser data transfer of the drop.
 * @returns the import, or the reason nothing usable was dropped.
 */
export async function readDrop(transfer: DropTransfer): Promise<DropOutcome> {
  const items = Array.from(transfer.items ?? [])
  for (const item of items) {
    const entry = item.webkitGetAsEntry?.()
    if (entry?.isDirectory === true) return await readDirectory(entry)
    if (entry?.isFile === true && isArchiveName(entry.name)) return await readArchive(await readEntryFile(entry))
  }
  const files = Array.from(transfer.files ?? [])
  const archive = files.find(file => isArchiveName(file.name))
  if (archive !== undefined) return await readArchive(archive)
  return files.length === 0 ? { kind: 'problem', problem: 'empty' } : await readFolderFiles(files)
}

/**
 * Read one archive file into an archive import.
 * @param file - the dropped or chosen archive.
 * @returns the import, or the reason it was refused.
 */
export async function readArchive(file: DropFile): Promise<DropOutcome> {
  if (file.size > MAX_UPLOAD_BYTES) return { kind: 'problem', problem: 'too-large' }
  return { kind: 'ok', value: { kind: 'archive', fileName: file.name, content: encode(await file.arrayBuffer()) } }
}

/**
 * Read loose files that belong to one dropped folder.
 * @param files - files the drop carried.
 * @returns the folder import, or the reason it was refused.
 */
async function readFolderFiles(files: readonly DropFile[]): Promise<DropOutcome> {
  if (files.length > MAX_DROPPED_FILES) return { kind: 'problem', problem: 'too-many' }
  let total = 0
  const dropped: DroppedFileView[] = []
  for (const file of files) {
    total += file.size
    if (total > MAX_UPLOAD_BYTES) return { kind: 'problem', problem: 'too-large' }
    dropped.push({ path: relativePath(file), content: encode(await file.arrayBuffer()) })
  }
  const folderName = files[0]?.webkitRelativePath?.split('/')[0] ?? 'skill'
  return { kind: 'ok', value: { kind: 'folder', folderName, files: dropped } }
}

/**
 * Walk one dropped directory into a folder import.
 * @param directory - directory entry the drop supplied.
 * @returns the folder import, or the reason it was refused.
 */
async function readDirectory(directory: DropEntry): Promise<DropOutcome> {
  const collected: { readonly path: string; readonly file: DropFile }[] = []
  const walk = async (entries: readonly DropEntry[], prefix: string, depth: number): Promise<DropProblem | undefined> => {
    if (depth > MAX_DEPTH) return 'too-many'
    for (const entry of entries) {
      const path = `${prefix}${entry.name}`
      if (entry.isFile) {
        if (collected.length >= MAX_DROPPED_FILES) return 'too-many'
        collected.push({ path, file: await readEntryFile(entry) })
        continue
      }
      if (entry.isDirectory) {
        const problem = await walk(await readEntries(entry), `${path}/`, depth + 1)
        if (problem !== undefined) return problem
      }
    }
    return undefined
  }
  const problem = await walk(await readEntries(directory), '', 0)
  if (problem !== undefined) return { kind: 'problem', problem }
  if (collected.length === 0) return { kind: 'problem', problem: 'empty' }
  let total = 0
  const files: DroppedFileView[] = []
  for (const item of collected) {
    total += item.file.size
    if (total > MAX_UPLOAD_BYTES) return { kind: 'problem', problem: 'too-large' }
    files.push({ path: item.path, content: encode(await item.file.arrayBuffer()) })
  }
  return { kind: 'ok', value: { kind: 'folder', folderName: directory.name, files } }
}

/**
 * Read every entry of one directory, including entries past the first batch.
 * @param directory - directory entry to list.
 * @returns the entries the browser reported, as one list; a directory with no
 *   reader lists nothing.
 */
async function readEntries(directory: DropEntry): Promise<readonly DropEntry[]> {
  const reader = directory.createReader?.()
  if (reader === undefined) return []
  const entries: DropEntry[] = []
  for (;;) {
    const batch = await new Promise<readonly DropEntry[]>((resolve, reject) => {
      reader.readEntries(
        (batchEntries) => { resolve(batchEntries) },
        (error) => { reject(error instanceof Error ? error : new Error(String(error))) },
      )
    })
    if (batch.length === 0) return entries
    entries.push(...batch)
  }
}

/**
 * Read one file entry's bytes.
 * @param entry - file entry the drop supplied.
 * @returns the file the browser holds for that entry.
 */
async function readEntryFile(entry: DropEntry): Promise<DropFile> {
  return await new Promise<DropFile>((resolve, reject) => {
    entry.file?.(resolve, reject)
  })
}

/**
 * Path of one loose file relative to the folder it was dropped with.
 * @param file - file the drop carried.
 * @returns the `webkitRelativePath`, or the file name when the browser reports none.
 */
function relativePath(file: DropFile): string {
  const path = file.webkitRelativePath ?? ''
  const parts = path.split('/').filter(part => part.length > 0)
  return parts.length > 1 ? parts.slice(1).join('/') : file.name
}

/**
 * Encode bytes as base64 for the Host call.
 * @param buffer - file bytes.
 * @returns the base64 text.
 */
function encode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  // Chunked, because one spread over a multi-megabyte array overflows the call stack.
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}
