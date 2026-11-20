/** Connector document: validation, normalization, the file round trip, and custom entries. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  addCustomConnector, loadConnectorFile, normalizeConnector, parseConnectorDocument, saveConnectorFile,
} from '../src/connectors/registry.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('normalizeConnector', () => {
  it('selects stdio for a command and streamable HTTP for a url, defaulting the rest', () => {
    expect(normalizeConnector('fs', { command: 'npx', args: ['-y', 'server'], env: { A: '1' }, cwd: '/w', enabled: false })).toEqual({
      transport: 'stdio', command: 'npx', args: ['-y', 'server'], env: { A: '1' }, cwd: '/w',
      url: '', headers: {}, enabled: false, startupTimeoutMs: 30_000,
    })
    expect(normalizeConnector('web', { url: 'https://mcp.test', headers: { auth: 'x' } })).toMatchObject({
      transport: 'streamable-http', command: '', args: [], env: {}, cwd: '', url: 'https://mcp.test', headers: { auth: 'x' }, enabled: true,
    })
    expect(normalizeConnector('legacy', { type: 'sse', url: 'https://mcp.test' }).transport).toBe('streamable-http')
    expect(normalizeConnector('declared', { type: 'streamable-http', url: 'https://mcp.test' }).transport).toBe('streamable-http')
    expect(normalizeConnector('both', { command: 'a', url: 'https://mcp.test' }).transport).toBe('streamable-http')
    expect(normalizeConnector('typed', { type: 'stdio', command: 'a', args: null as never, env: null as never }).args).toEqual([])
  })

  it('names the field a connector cannot be served without', () => {
    expect(() => normalizeConnector('x', {})).toThrow('x declares neither a command nor a url')
    expect(() => normalizeConnector('x', { type: 'stdio' })).toThrow('x is stdio but has no command')
    expect(() => normalizeConnector('x', { type: 'sse' })).toThrow('x is remote but has no url')
    expect(() => normalizeConnector('x', { command: 'a', args: 'b' as never })).toThrow('x.args must be an array of strings')
    expect(() => normalizeConnector('x', { command: 'a', args: [1] as never })).toThrow('x.args[0] must be a string')
    expect(() => normalizeConnector('x', { command: 'a', env: 'b' as never })).toThrow('x.env must be an object of strings')
    expect(() => normalizeConnector('x', { command: 'a', env: { A: 1 } as never })).toThrow('x.env.A must be a string')
  })
})

describe('parseConnectorDocument', () => {
  it('keeps usable entries and reports every refusal', () => {
    expect(parseConnectorDocument(null).problems).toEqual([{ name: '', reason: 'connector document must be a JSON object' }])
    expect(parseConnectorDocument({}).problems[0]?.reason).toBe('connector document has no mcpServers object')
    const result = parseConnectorDocument({ mcpServers: { ok: { command: 'a' }, '-bad': {}, flat: 'x', broken: {} } })
    expect(Object.keys(result.connectors)).toEqual(['ok'])
    expect(result.problems.map(problem => problem.name)).toEqual(['-bad', 'flat', 'broken'])
  })
})

describe('connector files', () => {
  it('round-trips a document and reports a missing or unparsable file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'freechat-connectors-'))
    roots.push(root)
    const file = join(root, 'nested', 'mcp.servers.json')
    expect((await loadConnectorFile(file)).problems[0]?.reason).toContain('connector file was not found')
    const entries = addCustomConnector({}, 'fs', { command: 'npx' })
    await saveConnectorFile(file, entries)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ mcpServers: { fs: { command: 'npx' } } })
    expect(Object.keys((await loadConnectorFile(file)).connectors)).toEqual(['fs'])
    await writeFile(file, '{')
    expect((await loadConnectorFile(file)).problems[0]?.reason).toContain('connector file is not valid JSON')
  })

  it('refuses a custom connector name outside the convention and leaves the input untouched', () => {
    const current = { a: { command: 'x' } }
    expect(addCustomConnector(current, 'b', { url: 'https://mcp.test' })).toEqual({ a: { command: 'x' }, b: { url: 'https://mcp.test' } })
    expect(current).toEqual({ a: { command: 'x' } })
    expect(() => addCustomConnector(current, '.hidden', {})).toThrow('connector name must start with a letter or digit')
  })
})
