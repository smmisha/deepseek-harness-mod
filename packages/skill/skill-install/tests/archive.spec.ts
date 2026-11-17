/** Archive extraction: what it accepts and every rule it refuses. */
import { describe, expect, it } from 'vitest'
import { extractArchive } from '../src/archive.ts'
import { zip } from './zip-fixture.ts'

/** Limits wide enough for the accepted cases. */
const LIMITS = { maxEntries: 10, maxUncompressedBytes: 4096 }

/** Read the typed code of a refused extraction. */
function codeOf(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    return (error as { code: string }).code
  }
  throw new Error('expected the extraction to be refused')
}

describe('extractArchive', () => {
  it('returns every stored file with its path', () => {
    const archive = zip([
      { name: 'skill/SKILL.md', data: '# Skill' },
      { name: 'skill/scripts/run.sh', data: 'echo hi' },
      { name: 'skill/nested/reference.md', data: 'text' },
    ])
    expect(extractArchive(archive, LIMITS).map(file => [file.path, new TextDecoder().decode(file.bytes)])).toEqual([
      ['skill/nested/reference.md', 'text'],
      ['skill/scripts/run.sh', 'echo hi'],
      ['skill/SKILL.md', '# Skill'],
    ])
  })

  it('skips directory entries', () => {
    const archive = zip([{ name: 'skill/' }, { name: 'skill/SKILL.md', data: 'x' }])
    expect(extractArchive(archive, LIMITS).map(file => file.path)).toEqual(['skill/SKILL.md'])
  })

  it('refuses an entry with a parent segment', () => {
    expect(codeOf(() => extractArchive(zip([{ name: '../evil', data: 'x' }]), LIMITS))).toBe('SKILL_INSTALL_ARCHIVE_INVALID')
  })

  it('refuses an absolute entry', () => {
    expect(codeOf(() => extractArchive(zip([{ name: '/etc/passwd', data: 'x' }]), LIMITS))).toBe('SKILL_INSTALL_ARCHIVE_INVALID')
  })

  it('refuses a drive-letter entry', () => {
    expect(codeOf(() => extractArchive(zip([{ name: 'C:/evil', data: 'x' }]), LIMITS))).toBe('SKILL_INSTALL_ARCHIVE_INVALID')
  })

  it('refuses a backslash separator', () => {
    expect(codeOf(() => extractArchive(zip([{ name: 'a\\b', data: 'x' }]), LIMITS))).toBe('SKILL_INSTALL_ARCHIVE_INVALID')
  })

  it('refuses an empty path segment', () => {
    expect(codeOf(() => extractArchive(zip([{ name: 'a//b', data: 'x' }]), LIMITS))).toBe('SKILL_INSTALL_ARCHIVE_INVALID')
  })

  it('refuses an entry with no usable name', () => {
    expect(codeOf(() => extractArchive(zip([{ name: '', data: 'x' }]), LIMITS))).toBe('SKILL_INSTALL_ARCHIVE_INVALID')
  })

  it('refuses the same entry name twice', () => {
    expect(codeOf(() => extractArchive(zip([{ name: 'a', data: 'x' }, { name: 'a', data: 'y' }]), LIMITS)))
      .toBe('SKILL_INSTALL_ARCHIVE_INVALID')
  })

  it('refuses an entry whose recorded name runs past the archive', () => {
    const archive = zip([{ name: 'a', data: 'x' }])
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
    const directoryOffset = view.getUint32(archive.byteLength - 22 + 16, true)
    view.setUint16(directoryOffset + 28, 60_000, true)
    expect(codeOf(() => extractArchive(archive, LIMITS))).toBe('SKILL_INSTALL_ARCHIVE_INVALID')
  })

  it('accepts an entry an MS-DOS host wrote, whose attributes carry no type', () => {
    const archive = zip([{ name: 'plain', data: 'x', os: 0 }])
    expect(extractArchive(archive, LIMITS).map(file => file.path)).toEqual(['plain'])
  })

  it('refuses a symbolic link', () => {
    const archive = zip([{ name: 'link', mode: 0o120777 }])
    expect(codeOf(() => extractArchive(archive, LIMITS))).toBe('SKILL_INSTALL_ARCHIVE_INVALID')
  })

  it('refuses a device entry', () => {
    const archive = zip([{ name: 'device', mode: 0o020644 }])
    expect(codeOf(() => extractArchive(archive, LIMITS))).toBe('SKILL_INSTALL_ARCHIVE_INVALID')
  })

  it('accepts an entry whose mode records no file type', () => {
    const archive = zip([{ name: 'plain', data: 'x', mode: 0 }])
    expect(extractArchive(archive, LIMITS).map(file => file.path)).toEqual(['plain'])
  })

  it('refuses an encrypted entry', () => {
    const archive = zip([{ name: 'secret', data: 'x', flags: 1 }])
    expect(codeOf(() => extractArchive(archive, LIMITS))).toBe('SKILL_INSTALL_ARCHIVE_INVALID')
  })

  it('refuses an unsupported compression method', () => {
    const archive = zip([{ name: 'compressed', data: '', method: 12 }])
    expect(codeOf(() => extractArchive(archive, LIMITS))).toBe('SKILL_INSTALL_ARCHIVE_INVALID')
  })

  it('refuses more entries than the cap', () => {
    const archive = zip([{ name: 'a', data: 'x' }, { name: 'b', data: 'y' }])
    expect(codeOf(() => extractArchive(archive, { maxEntries: 1, maxUncompressedBytes: 4096 }))).toBe('SKILL_INSTALL_ARCHIVE_INVALID')
  })

  it('refuses a declared total larger than the cap', () => {
    const archive = zip([{ name: 'a', data: '0123456789' }])
    expect(codeOf(() => extractArchive(archive, { maxEntries: 10, maxUncompressedBytes: 4 }))).toBe('SKILL_INSTALL_ARCHIVE_INVALID')
  })

  it('refuses a size that disagrees with the expanded bytes', () => {
    const archive = zip([{ name: 'a', data: '0123456789', declaredSize: 4 }])
    expect(codeOf(() => extractArchive(archive, LIMITS))).toBe('SKILL_INSTALL_ARCHIVE_INVALID')
  })

  it('refuses an archive with no file', () => {
    expect(codeOf(() => extractArchive(zip([]), LIMITS))).toBe('SKILL_INSTALL_ARCHIVE_INVALID')
  })

  it('refuses an entry whose compressed bytes are corrupt', () => {
    const archive = zip([{ name: 'a', data: 'not deflate at all', method: 8 }])
    expect(codeOf(() => extractArchive(archive, LIMITS))).toBe('SKILL_INSTALL_ARCHIVE_INVALID')
  })

  it('refuses bytes with no end record at all', () => {
    expect(codeOf(() => extractArchive(new Uint8Array(64), LIMITS))).toBe('SKILL_INSTALL_ARCHIVE_INVALID')
  })

  it('refuses bytes that are not a zip archive', () => {
    expect(codeOf(() => extractArchive(new TextEncoder().encode('not a zip at all'), LIMITS))).toBe('SKILL_INSTALL_ARCHIVE_INVALID')
  })

  it('refuses a file too small to hold an end record', () => {
    expect(codeOf(() => extractArchive(new Uint8Array(4), LIMITS))).toBe('SKILL_INSTALL_ARCHIVE_INVALID')
  })

  it('refuses a ZIP64 end record it cannot read', () => {
    const archive = zip([{ name: 'a', data: 'x' }], { declaredCount: 0xffff })
    expect(codeOf(() => extractArchive(archive, LIMITS))).toBe('SKILL_INSTALL_ARCHIVE_INVALID')
  })

  it('refuses a central directory that runs past the end of the archive', () => {
    const archive = zip([{ name: 'a', data: 'x' }])
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
    view.setUint32(archive.byteLength - 22 + 12, 0x7ffffff, true)
    expect(codeOf(() => extractArchive(archive, LIMITS))).toBe('SKILL_INSTALL_ARCHIVE_INVALID')
  })

  it('refuses a corrupt central directory entry', () => {
    const archive = zip([{ name: 'a', data: 'x' }])
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
    const directoryOffset = view.getUint32(archive.byteLength - 22 + 16, true)
    view.setUint32(directoryOffset, 0x02015050, true)
    expect(codeOf(() => extractArchive(archive, LIMITS))).toBe('SKILL_INSTALL_ARCHIVE_INVALID')
  })

  it('finds the end record past an archive comment', () => {
    const archive = zip([{ name: 'a', data: 'x' }])
    const withComment = new Uint8Array(archive.byteLength + 3)
    withComment.set(archive)
    withComment.set(new TextEncoder().encode('hi!'), archive.byteLength)
    const view = new DataView(withComment.buffer)
    view.setUint16(archive.byteLength - 2, 3, true)
    expect(extractArchive(withComment, LIMITS).map(file => file.path)).toEqual(['a'])
  })
})
