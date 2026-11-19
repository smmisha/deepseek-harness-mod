/** Durable thread journal: safe ids, newest-record reads, defensive parsing, and the serialized index. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sanitizeThreadId, ThreadStore } from '../src/kernel/thread-store.ts'
import type { ThreadState } from '../src/types.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function root(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'freechat-store-'))
  roots.push(directory)
  return directory
}

function state(id: string, turns = 1): ThreadState {
  return {
    id, generation: 1, webSessionId: 'web', synced: [], tokens: 0, turns,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: `2026-01-01T00:00:0${turns}.000Z`,
  }
}

describe('sanitizeThreadId', () => {
  it('keeps safe characters with a digest and names keys with none', () => {
    expect(sanitizeThreadId('My Thread/..')).toMatch(/^my-thread-[0-9a-f]{12}$/u)
    expect(sanitizeThreadId('!!!')).toMatch(/^thread-[0-9a-f]{12}$/u)
  })
})

describe('ThreadStore', () => {
  it('reads the newest well-formed record and skips torn or foreign lines', async () => {
    const directory = await root()
    const store = new ThreadStore(directory)
    expect(await store.load('a')).toBeUndefined()
    await store.commit(state('a', 1), 'p1', 'a1')
    await store.commit(state('a', 2), 'p2', 'a2')
    expect((await store.load('a'))?.turns).toBe(2)
    const file = join(directory, 'threads', 'a.jsonl')
    const valid = await readFile(file, 'utf8')
    await writeFile(file, `${valid}{"torn"\n42\n{"type":"note","answer":"x","state":{}}\n{"type":"turn","answer":"x","state":null}\n{"type":"turn","answer":"x"}\n`)
    expect((await store.load('a'))?.turns).toBe(2)
    await writeFile(file, '{"torn"\n')
    expect(await store.load('a')).toBeUndefined()
  })

  it('keeps one index across commits and starts over from a foreign index document', async () => {
    const directory = await root()
    await writeFile(join(directory, 'index.json'), JSON.stringify({ threads: null }))
    const store = new ThreadStore(directory)
    expect(await store.list()).toEqual({})
    await store.commit(state('a'), 'p', 'a')
    await store.commit(state('b'), 'p', 'b')
    expect(Object.keys(await store.list())).toEqual(['a', 'b'])
    const index: unknown = JSON.parse(await readFile(join(directory, 'index.json'), 'utf8'))
    expect(index).toMatchObject({ threads: { b: { turns: 1 } } })
    for (const document of ['null', '{}', '[1]']) {
      const other = await root()
      await writeFile(join(other, 'index.json'), document)
      expect(await new ThreadStore(other).list()).toEqual({})
    }
  })

  it('reads an existing index and keeps writing after one index write fails', async () => {
    const directory = await root()
    await writeFile(join(directory, 'index.json'), JSON.stringify({ threads: { old: { generation: 3, turns: 4, updatedAt: 'x' } } }))
    expect(Object.keys(await new ThreadStore(directory).list())).toEqual(['old'])
    const blocked = await root()
    await mkdir(join(blocked, 'index.json'))
    const store = new ThreadStore(blocked)
    await expect(store.commit(state('a'), 'p', 'a')).rejects.toThrow()
    await rm(join(blocked, 'index.json'), { recursive: true })
    await store.commit(state('b'), 'p', 'b')
    expect(Object.keys(await store.list())).toEqual(['a', 'b'])
  })
})
