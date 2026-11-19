/**
 * `mcpServers` connector document: validation, normalization into the flat
 * entry form the harness MCP manager consumes, and the `+ Custom` write path a
 * management surface uses to add a connector the presets do not cover.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ConnectorDocument, ManagedConnector, McpServerConfig } from '../types.ts'

/** Entry name the connector document accepts; matches the MCP server-name convention. */
const CONNECTOR_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u
/** Startup budget applied to a connector that does not state its own. */
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000

/** One rejected entry with the reason a management surface shows verbatim. */
export interface ConnectorProblem {
  /** Entry name, or the index when the name itself is unusable. */
  readonly name: string
  /** Actionable refusal. */
  readonly reason: string
}

/** The parse result: usable connectors and every refusal. */
export interface ConnectorParseResult {
  /** Normalized connectors keyed by name. */
  readonly connectors: Record<string, ManagedConnector>
  /** Rejected entries; a document with problems is still partially usable. */
  readonly problems: readonly ConnectorProblem[]
}

/** Read a non-empty string from an unknown record. */
function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Read a string map; a non-string value is refused instead of stringified. */
function stringMap(value: unknown, field: string, name: string): Record<string, string> {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object') throw new Error(`${name}.${field} must be an object of strings`)
  const entries: Record<string, string> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item !== 'string') throw new Error(`${name}.${field}.${key} must be a string`)
    entries[key] = item
  }
  return entries
}

/** Read a string list; a non-string item is refused. */
function stringList(value: unknown, field: string, name: string): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${name}.${field} must be an array of strings`)
  return value.map((item, index) => {
    if (typeof item !== 'string') throw new Error(`${name}.${field}[${index}] must be a string`)
    return item
  })
}

/**
 * Normalize one `mcpServers` entry into the flat managed form. A `command`
 * selects stdio and a `url` selects streamable HTTP; the legacy `sse` type is
 * accepted as streamable HTTP because the harness client speaks the current
 * transport.
 * @param name - entry name from the document.
 * @param config - entry body.
 * @returns the managed connector.
 * @throws Error naming the field that cannot be served.
 */
export function normalizeConnector(name: string, config: McpServerConfig): ManagedConnector {
  const declaredType = config.type
  const command = stringField(config.command)
  const url = stringField(config.url)
  const transport = declaredType === 'stdio' || (command !== undefined && url === undefined)
    ? 'stdio'
    : declaredType === 'sse' || declaredType === 'streamable-http' || url !== undefined
      ? 'streamable-http'
      : undefined
  if (transport === undefined) throw new Error(`${name} declares neither a command nor a url`)
  if (transport === 'stdio' && command === undefined) throw new Error(`${name} is stdio but has no command`)
  if (transport === 'streamable-http' && url === undefined) throw new Error(`${name} is remote but has no url`)
  return {
    transport,
    command: command ?? '',
    args: stringList(config.args, 'args', name),
    env: stringMap(config.env, 'env', name),
    cwd: stringField(config.cwd) ?? '',
    url: url ?? '',
    headers: stringMap(config.headers, 'headers', name),
    enabled: config.enabled !== false,
    startupTimeoutMs: DEFAULT_STARTUP_TIMEOUT_MS,
  }
}

/**
 * Parse a whole connector document. A malformed entry is reported and skipped,
 * so one broken connector never disables the rest of the hub.
 * @param value - parsed JSON document.
 * @returns usable connectors and every refusal.
 */
export function parseConnectorDocument(value: unknown): ConnectorParseResult {
  const connectors: Record<string, ManagedConnector> = {}
  const problems: ConnectorProblem[] = []
  if (typeof value !== 'object' || value === null) {
    return { connectors, problems: [{ name: '', reason: 'connector document must be a JSON object' }] }
  }
  const servers = (value as { mcpServers?: unknown }).mcpServers
  if (typeof servers !== 'object' || servers === null) {
    return { connectors, problems: [{ name: '', reason: 'connector document has no mcpServers object' }] }
  }
  for (const [name, entry] of Object.entries(servers as Record<string, unknown>)) {
    if (!CONNECTOR_NAME.test(name)) {
      problems.push({ name, reason: 'connector name must start with a letter or digit and contain only letters, digits, ".", "_" or "-"' })
      continue
    }
    if (typeof entry !== 'object' || entry === null) {
      problems.push({ name, reason: 'connector entry must be an object' })
      continue
    }
    try {
      connectors[name] = normalizeConnector(name, entry)
    } catch (error) {
      /* v8 ignore next -- normalizeConnector throws only Error instances */
      problems.push({ name, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  return { connectors, problems }
}

/**
 * Read and parse a connector file.
 * @param file - absolute or workspace-relative path.
 * @returns the parse result; a missing file yields no connectors and one problem.
 */
export async function loadConnectorFile(file: string): Promise<ConnectorParseResult> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return { connectors: {}, problems: [{ name: '', reason: `connector file was not found: ${file}` }] }
  }
  try {
    return parseConnectorDocument(JSON.parse(text))
  } catch (error) {
    /* v8 ignore next -- JSON.parse throws only SyntaxError instances */
    return { connectors: {}, problems: [{ name: '', reason: `connector file is not valid JSON: ${error instanceof Error ? error.message : String(error)}` }] }
  }
}

/**
 * Write one connector document back to disk, creating its directory.
 * @param file - destination path.
 * @param connectors - names and their `mcpServers` entry bodies.
 */
export async function saveConnectorFile(file: string, connectors: Readonly<Record<string, McpServerConfig>>): Promise<void> {
  const document: ConnectorDocument = { mcpServers: connectors }
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(document, null, 2), 'utf8')
}

/**
 * Add or replace one custom connector in a document.
 * @param connectors - current entries.
 * @param name - connector name.
 * @param config - entry body.
 * @returns the next document entries, leaving the input untouched.
 */
export function addCustomConnector(
  connectors: Readonly<Record<string, McpServerConfig>>,
  name: string,
  config: McpServerConfig,
): Record<string, McpServerConfig> {
  if (!CONNECTOR_NAME.test(name)) throw new Error('connector name must start with a letter or digit and contain only letters, digits, ".", "_" or "-"')
  return { ...connectors, [name]: config }
}
