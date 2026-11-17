// @vitest-environment jsdom
/**
 * Reading a drop: one `.zip`, a folder from the file picker, and the dropped
 * directory tree, with the caps that keep one drop bounded.
 */
import { describe, expect, it } from 'vitest'
import {
  isArchiveName, MAX_DROPPED_FILES, MAX_UPLOAD_BYTES, readArchive, readDrop,
  type DropEntry, type DropTransfer,
} from '../src/client/drop.ts'

/** One file the tests hand a browser-shaped drop. */
function file(name: string, content = 'x', relativePath?: string): File {
  const created = new File([content], name)
  if (relativePath !== undefined) {
    Object.defineProperty(created, 'webkitRelativePath', { value: relativePath })
  }
  return created
}

/** One directory entry over a fixed list of entries. */
function directory(name: string, entries: readonly DropEntry[]): DropEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({
      readEntries: (success) => {
        // A browser reports an empty batch once the listing is finished.
        success(entries[0] === undefined ? [] : [...entries])
        entries = []
      },
    }),
  }
}

/** One file entry over a fixed file. */
function fileEntry(entry: File): DropEntry {
  return { isFile: true, isDirectory: false, name: entry.name, file: (success) => { success(entry) } }
}

/** One drop carrying items whose entries answer as given. */
function transfer(entries: readonly (DropEntry | null)[], files: readonly File[] = []): DropTransfer {
  return { items: entries.map(entry => ({ webkitGetAsEntry: () => entry })), files }
}

describe('isArchiveName', () => {
  it('accepts a zip in any letter case', () => {
    expect(isArchiveName('pack.zip')).toBe(true)
    expect(isArchiveName('PACK.ZIP')).toBe(true)
    expect(isArchiveName('pack.tar')).toBe(false)
  })
})

describe('readDrop', () => {
  it('reads one dropped archive', async () => {
    const outcome = await readDrop(transfer([fileEntry(file('pack.zip', 'zip'))]))
    expect(outcome).toEqual({ kind: 'ok', value: { kind: 'archive', fileName: 'pack.zip', content: btoa('zip') } })
  })

  it('reads a dropped directory into its files', async () => {
    const root = directory('pdf', [fileEntry(file('SKILL.md', 'body')), directory('scripts', [fileEntry(file('run.sh', 'echo'))])])
    const outcome = await readDrop(transfer([root]))
    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok' || outcome.value.kind !== 'folder') throw new Error('expected a folder import')
    expect(outcome.value.folderName).toBe('pdf')
    expect(outcome.value.files.map(entry => entry.path)).toEqual(['SKILL.md', 'scripts/run.sh'])
  })

  it('refuses a directory that holds no file', async () => {
    expect(await readDrop(transfer([directory('pdf', [])]))).toEqual({ kind: 'problem', problem: 'empty' })
  })

  it('refuses a directory past the byte cap', async () => {
    const root = directory('pdf', [fileEntry(file('big.md', 'x'.repeat(MAX_UPLOAD_BYTES + 1)))])
    expect(await readDrop(transfer([root]))).toEqual({ kind: 'problem', problem: 'too-large' })
  })

  it('reads loose files that belong to one folder', async () => {
    const outcome = await readDrop({
      files: [file('SKILL.md', 'a', 'pdf/SKILL.md'), file('notes.md', 'b', 'pdf/notes.md')],
    })
    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok' || outcome.value.kind !== 'folder') throw new Error('expected a folder import')
    expect(outcome.value.folderName).toBe('pdf')
    expect(outcome.value.files.map(entry => entry.path)).toEqual(['SKILL.md', 'notes.md'])
  })

  it('refuses an empty drop', async () => {
    expect(await readDrop({})).toEqual({ kind: 'problem', problem: 'empty' })
  })

  it('falls back to the dropped files when an item holds no archive', async () => {
    const outcome = await readDrop(transfer([fileEntry(file('notes.txt'))]))
    expect(outcome).toEqual({ kind: 'problem', problem: 'empty' })
  })

  it('names a loose drop without a folder after the skill', async () => {
    const outcome = await readDrop({ files: [file('SKILL.md')] })
    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok' || outcome.value.kind !== 'folder') throw new Error('expected a folder import')
    expect(outcome.value.folderName).toBe('skill')
    expect(outcome.value.files.map(entry => entry.path)).toEqual(['SKILL.md'])
  })

  it('refuses a loose drop holding more files than the cap', async () => {
    const files = Array.from({ length: MAX_DROPPED_FILES + 1 }, (_, index) => file(`f${index}.md`))
    expect(await readDrop({ files })).toEqual({ kind: 'problem', problem: 'too-many' })
  })

  it('skips an entry that is neither a file nor a directory', async () => {
    const root = directory('pdf', [
      { isFile: false, isDirectory: false, name: 'odd' },
      fileEntry(file('SKILL.md')),
    ])
    const outcome = await readDrop(transfer([root]))
    expect(outcome.kind).toBe('ok')
  })

  it('reports a directory the browser failed to list', async () => {
    const broken: DropEntry = {
      isFile: false,
      isDirectory: true,
      name: 'pdf',
      createReader: () => ({ readEntries: (_success, failure) => { failure(new Error('denied')) } }),
    }
    await expect(readDrop(transfer([broken]))).rejects.toThrow('denied')
  })

  it('refuses a directory without a reader', async () => {
    const outcome = await readDrop(transfer([{ isFile: false, isDirectory: true, name: 'pdf' }]))
    expect(outcome).toEqual({ kind: 'problem', problem: 'empty' })
  })

  it('skips a nested directory without a reader', async () => {
    const root = directory('pdf', [
      fileEntry(file('SKILL.md', 'body')),
      { isFile: false, isDirectory: true, name: 'nested' },
    ])
    const outcome = await readDrop(transfer([root]))
    expect(outcome.kind).toBe('ok')
  })

  it('refuses a directory nested past the depth cap', async () => {
    let nested: DropEntry = directory('deep', [fileEntry(file('a.md'))])
    for (let level = 0; level < 6; level++) nested = directory('deep', [nested])
    expect(await readDrop(transfer([nested]))).toEqual({ kind: 'problem', problem: 'too-many' })
  })

  it('refuses a directory holding more files than the cap', async () => {
    const crowded = directory('pdf', Array.from({ length: MAX_DROPPED_FILES + 1 }, (_, index) => fileEntry(file(`f${index}.md`))))
    expect(await readDrop(transfer([crowded]))).toEqual({ kind: 'problem', problem: 'too-many' })
  })

  it('refuses files past the byte cap', async () => {
    const oversized = file('big.md', 'x'.repeat(MAX_UPLOAD_BYTES + 1))
    expect(await readDrop({ files: [oversized] })).toEqual({ kind: 'problem', problem: 'too-large' })
  })

  it('refuses an archive past the byte cap', async () => {
    const oversized = file('big.zip', 'x'.repeat(MAX_UPLOAD_BYTES + 1))
    expect(await readDrop({ files: [oversized] })).toEqual({ kind: 'problem', problem: 'too-large' })
  })
})

describe('readArchive', () => {
  it('reads one chosen archive', async () => {
    expect(await readArchive(file('pack.zip', 'zip')))
      .toEqual({ kind: 'ok', value: { kind: 'archive', fileName: 'pack.zip', content: btoa('zip') } })
  })

  it('refuses a chosen archive past the byte cap', async () => {
    expect(await readArchive(file('pack.zip', 'x'.repeat(MAX_UPLOAD_BYTES + 1))))
      .toEqual({ kind: 'problem', problem: 'too-large' })
  })
})
