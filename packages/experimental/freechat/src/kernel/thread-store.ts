/**
 * Local durable memory for bridge threads. The free web chat keeps no history
 * the harness can rely on, so every committed turn is appended to a JSONL file
 * per thread and the last record is the thread's authoritative state.
 */

import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ThreadState } from '../types.ts'

/** One durable record of a committed turn. */
interface TurnRecord {
  readonly type: 'turn'
  readonly at: string
  readonly thread: string
  readonly prompt: string
  readonly answer: string
  readonly state: ThreadState
}

/** Index entry kept in `index.json`, small enough to rewrite on every commit. */
export interface IndexEntry {
  readonly generation: number
  readonly turns: number
  readonly updatedAt: string
}

/** Everything `index.json` holds. */
interface ThreadIndex {
  readonly threads: Record<string, IndexEntry>
}

/**
 * Derive a filesystem-safe thread id from a caller key. The caller controls
 * `user`, so the directory name must not be able to leave the storage root.
 * @param raw - caller-supplied conversation key.
 * @returns a lower-case id of safe characters with a digest suffix for uniqueness.
 */
export function sanitizeThreadId(raw: string): string {
  const readable = raw.toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 48)
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 12)
  return readable.length > 0 ? `${readable}-${digest}` : `thread-${digest}`
}

/**
 * Append-only thread store over a configured directory. Writers serialize
 * index updates through one promise chain; readers never block.
 */
export class ThreadStore {
  private readonly root: string
  private indexWrite: Promise<void> = Promise.resolve()
  private indexCache: ThreadIndex | undefined

  /**
   * @param directory - storage root; created on first write.
   */
  constructor(directory: string) {
    this.root = directory
  }

  private get threadsDirectory(): string {
    return join(this.root, 'threads')
  }

  private get indexFile(): string {
    return join(this.root, 'index.json')
  }

  private threadFile(id: string): string {
    return join(this.threadsDirectory, `${id}.jsonl`)
  }

  private async readIndex(): Promise<ThreadIndex> {
    if (this.indexCache !== undefined) return this.indexCache
    try {
      const parsed: unknown = JSON.parse(await readFile(this.indexFile, 'utf8'))
      this.indexCache = isThreadIndex(parsed) ? parsed : { threads: {} }
    } catch {
      // A missing or unreadable index is the first-run state; thread files remain authoritative.
      this.indexCache = { threads: {} }
    }
    return this.indexCache
  }

  /**
   * Read the last committed state of one thread.
   * @param id - sanitized thread id.
   * @returns the state, or undefined when the thread has no committed turn.
   */
  async load(id: string): Promise<ThreadState | undefined> {
    let content: string
    try {
      content = await readFile(this.threadFile(id), 'utf8')
    } catch {
      return undefined
    }
    // The newest well-formed record wins; a torn or hand-edited line is skipped.
    for (const line of content.split('\n').toReversed()) {
      const record = parseTurnRecord(line)
      if (record !== undefined) return record.state
    }
    return undefined
  }

  /**
   * Append one committed turn and refresh the index entry.
   * @param state - state committed by the turn.
   * @param prompt - prompt text delivered to the web chat.
   * @param answer - answer text the web chat produced.
   */
  async commit(state: ThreadState, prompt: string, answer: string): Promise<void> {
    await mkdir(this.threadsDirectory, { recursive: true })
    const record: TurnRecord = { type: 'turn', at: state.updatedAt, thread: state.id, prompt, answer, state }
    await appendFile(this.threadFile(state.id), `${JSON.stringify(record)}\n`, 'utf8')
    await this.updateIndex(state)
  }

  /** Persisted state of every thread this store has committed. */
  async list(): Promise<Record<string, IndexEntry>> {
    const index = await this.readIndex()
    return { ...index.threads }
  }

  private async updateIndex(state: ThreadState): Promise<void> {
    const run = async (): Promise<void> => {
      const index = await this.readIndex()
      const threads: Record<string, IndexEntry> = {
        ...index.threads,
        [state.id]: { generation: state.generation, turns: state.turns, updatedAt: state.updatedAt },
      }
      this.indexCache = { threads }
      await mkdir(dirname(this.indexFile), { recursive: true })
      await writeFile(this.indexFile, JSON.stringify(this.indexCache, null, 2), 'utf8')
    }
    this.indexWrite = this.indexWrite.then(run, run)
    await this.indexWrite
  }
}

/**
 * Defensive parse of one durable record. The file is a durable boundary, so a
 * hand-edited or truncated line is skipped instead of crashing the bridge.
 */
function parseTurnRecord(line: string): TurnRecord | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record = parsed as Partial<TurnRecord>
  if (record.type !== 'turn' || typeof record.answer !== 'string' || record.state === undefined) return undefined
  // The journal is read back from disk, so a hand-edited `null` state is possible despite the type.
  const state: unknown = record.state
  if (typeof state !== 'object' || state === null) return undefined
  return record as TurnRecord
}

/** Narrow an unknown index document to the shape this store owns. */
function isThreadIndex(value: unknown): value is ThreadIndex {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { threads?: unknown }
  return typeof candidate.threads === 'object' && candidate.threads !== null
}
