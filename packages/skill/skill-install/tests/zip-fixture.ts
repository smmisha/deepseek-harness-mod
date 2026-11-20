/** Build stored-entry ZIP archives for the extraction tests, with every header field settable. */

/** One entry of a fixture archive. */
export interface ZipFixtureEntry {
  /** Entry name exactly as the central directory records it. */
  readonly name: string
  /** File content; a string is encoded as UTF-8. */
  readonly data?: string | Uint8Array
  /** Unix mode recorded in the high half of the external attributes. */
  readonly mode?: number
  /** Host system recorded in the central directory; 3 is Unix. */
  readonly os?: number
  /** General-purpose flag bits. */
  readonly flags?: number
  /** Compression method recorded in both headers. */
  readonly method?: number
  /** Uncompressed size recorded in both headers, when it must disagree with the data. */
  readonly declaredSize?: number
  /** Name written in the local header only, when it must disagree with the directory. */
  readonly localName?: string
}

/** Count and sizes recorded in the end-of-central-directory record. */
export interface ZipFixtureOptions {
  /** Entry count to record, when it must not match the entries written. */
  readonly declaredCount?: number
}

/** CRC-32 table for the polynomial ZIP uses. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

/**
 * Compute the CRC-32 of one buffer.
 * @param bytes - bytes to checksum.
 * @returns the unsigned checksum.
 */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * Build one ZIP archive whose entries are stored uncompressed.
 * @param entries - entries to write, in order.
 * @param options - end-record fields to override.
 * @returns the archive bytes.
 */
export function zip(entries: readonly ZipFixtureEntry[], options: ZipFixtureOptions = {}): Uint8Array<ArrayBuffer> {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name)
    const localName = new TextEncoder().encode(entry.localName ?? entry.name)
    const data = typeof entry.data === 'string' ? new TextEncoder().encode(entry.data) : entry.data ?? new Uint8Array(0)
    const checksum = crc32(data)
    const uncompressed = entry.declaredSize ?? data.byteLength
    const method = entry.method ?? 0
    const local = new Uint8Array(30 + localName.byteLength + data.byteLength)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, entry.flags ?? 0, true)
    localView.setUint16(8, method, true)
    localView.setUint32(14, checksum, true)
    localView.setUint32(18, data.byteLength, true)
    localView.setUint32(22, uncompressed, true)
    localView.setUint16(26, localName.byteLength, true)
    local.set(localName, 30)
    local.set(data, 30 + localName.byteLength)
    locals.push(local)

    const central = new Uint8Array(46 + name.byteLength)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, ((entry.os ?? 3) << 8) | 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, entry.flags ?? 0, true)
    centralView.setUint16(10, method, true)
    centralView.setUint32(16, checksum, true)
    centralView.setUint32(20, data.byteLength, true)
    centralView.setUint32(24, uncompressed, true)
    centralView.setUint16(28, name.byteLength, true)
    centralView.setUint32(38, ((entry.mode ?? 0o100644) << 16) >>> 0, true)
    centralView.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)
    offset += local.byteLength
  }
  const centralSize = centrals.reduce((total, part) => total + part.byteLength, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, options.declaredCount ?? entries.length, true)
  endView.setUint16(10, options.declaredCount ?? entries.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)
  const parts = [...locals, ...centrals, end]
  const archive = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let position = 0
  for (const part of parts) {
    archive.set(part, position)
    position += part.byteLength
  }
  return archive
}

/**
 * Encode bytes as base64, the way the Skills tab uploads a file.
 * @param bytes - bytes to encode.
 * @returns the base64 text.
 */
export function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}
