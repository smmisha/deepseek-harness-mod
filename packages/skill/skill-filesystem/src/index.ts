/**
 * Local filesystem skill provider.
 *
 * This package is one implementation of the `ctx.skills` provider registry. It
 * discovers directory-bundle and flat Markdown skills from project, custom, and
 * user roots, parses YAML frontmatter, and loads bodies through `ctx.fs` when a
 * filesystem service is present.
 *
 * @module @deepseek-ai/dsh-skill-filesystem
 */

import { access, lstat, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { unwatchFile, watchFile, type Stats } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { SkillVisibility } from '@deepseek-ai/dsh-skill-sources'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { LocalSkillView, LocalSourceOptions, LocalSourceView } from './types.ts'
export type { LocalSkillView, LocalSourceOptions, LocalSourceView } from './types.ts'
import chokidar from 'chokidar'
import z from '@deepseek-ai/schemastery'
import { parse as parseYaml } from 'yaml'
import type { FileSystem, FsDirEntry, FsTarget } from '@deepseek-ai/dsh-fs'
import { canonicalizeWatchPath, resolveAgentsHome, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  BUNDLED_SKILL_RANK,
  isSkillName,
  type SkillCandidate,
  type SkillDefinition,
  type SkillInvocationPolicy,
  type SkillLookupOptions,
  type SkillProvider,
  type SkillProviderControl,
  type SkillProviderObservation,
  type SkillSource,
} from '@deepseek-ai/dsh-skill'

/** Visibility when no skill-sources service is mounted: no application folders, every source and skill on. */
const ALL_VISIBLE: SkillVisibility = {
  applications: [],
  sourceEnabled: () => true,
  skillEnabled: () => true,
}

const PROJECT_DSH_RANK = 100
const PROJECT_AGENTS_RANK = 200
const CUSTOM_RANK = 300
const USER_DSH_RANK = 400
const USER_AGENTS_RANK = 500
/** Skills from another application's folder never outrank the harness's own roots. */
const APPLICATION_RANK = 700
const DEFAULT_WATCH_STABILITY_THRESHOLD_MS = 200
const DEFAULT_WATCH_POLL_INTERVAL_MS = 100
const DEFAULT_WATCH_MAX_PROJECTS = 128

/** Plugin name used by the Loader row. */
export const name = 'skill-filesystem'

/** The registry receives this provider. */
export const inject = ['skills']

/** Local filesystem skill provider configuration. */
export interface Config {
  /** Unique provider name. Defaults to `filesystem`. */
  providerName?: string
  /** Whether project and user roots are included around custom roots. */
  includeDefaultRoots?: boolean
  /** DeepSeek Harness config root. Defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
  /** Shared agent config root. Defaults to `$DSH_AGENTS_HOME` or `~/.agents`. */
  agentsHome?: string
  /** Additional skill roots scanned after project roots and before user roots. */
  customSkillDirs?: string[]
  /** Whether host-local skill roots are watched for catalog changes. */
  watch?: boolean
  /** Whether Chokidar uses polling instead of native filesystem events. */
  watchUsePolling?: boolean
  /** Milliseconds a changed skill entry must remain stable before it is observed. */
  watchStabilityThresholdMs?: number
  /** Milliseconds between Chokidar stability or polling probes. */
  watchPollIntervalMs?: number
  /** Maximum distinct project roots whose skill directories remain watched. */
  watchMaxProjects?: number
  /** Whether watched symbolic links follow their target files. */
  watchFollowSymlinks?: boolean
  /** Bundled skill root; defaults to `$DSH_BUNDLED_SKILL_DIR` when default roots are included, otherwise mounts none. */
  bundledSkillDir?: string
}

export const Config = z.object({
  providerName: z.string().min(1).default('filesystem'),
  includeDefaultRoots: z.boolean().default(true),
  dshHome: z.string(),
  agentsHome: z.string(),
  customSkillDirs: z.array(z.string()).default([]),
  watch: z.boolean().default(true),
  watchUsePolling: z.boolean().default(false),
  watchStabilityThresholdMs: z.number().default(DEFAULT_WATCH_STABILITY_THRESHOLD_MS),
  watchPollIntervalMs: z.number().default(DEFAULT_WATCH_POLL_INTERVAL_MS),
  watchMaxProjects: z.number().default(DEFAULT_WATCH_MAX_PROJECTS),
  watchFollowSymlinks: z.boolean().default(true),
  bundledSkillDir: z.string(),
})

interface SkillRoot {
  path: string
  source: SkillSource
  rank: number
  skipSystem?: boolean
  projectRoot?: string
  trustedHost?: boolean
  /** Included for reporting only: the folder does not exist. */
  missing?: boolean
}

interface SkillRootEntry {
  name: string
  type: 'directory' | 'file' | 'other'
  path: string
}

interface SkillText {
  path: string
  content: string
}

interface ParsedSkill extends SkillText {
  name: string
  description: string
  whenToUse?: string
  invocation: SkillInvocationPolicy
  metadata?: Record<string, unknown>
}

interface LocalLocator {
  path: string
  directory: string
}

interface ResolvedWatchConfig {
  enabled: boolean
  usePolling: boolean
  stabilityThresholdMs: number
  pollIntervalMs: number
  maxProjects: number
  followSymlinks: boolean
}

/**
 * Host Remote namespace `skillSources`: the Skills tab reads the discovered
 * sources and their skills from here, and writes switches through the
 * `settings` namespace of this same plugin entry.
 */
export class SkillSourcesController extends TypertRemoteService {
  /** The registry supplies the winning-source map for shadowed rows. */
  static readonly inject = ['skills', 'skillSources']

  /**
   * @param ctx - Host context carrying `ctx.skills`.
   * @param provider - the live filesystem provider that feeds the catalog.
   */
  constructor(
    ctx: Context,
    private readonly access: () => {
      readonly provider: FileSystemSkillProvider
      readonly invalidate: () => void
    },
  ) {
    super(ctx, 'skillSourcesController', { namespace: 'skillSources' })
  }

  /**
   * Describe every local source and skill for the Skills tab.
   * @param cwd - working directory that selects the project roots, when known.
   * @returns source rows with availability, switches, and duplicate winners.
   */
  @Remote
  async describe(cwd: string | undefined): Promise<LocalSourceView[]> {
    const catalog = await this.ctx.skills.list(cwd === undefined ? {} : { cwd })
    const winners = new Map(catalog.map(skill => [skill.name, String(skill.source)]))
    return await this.access().provider.describeSources(cwd === undefined ? { winners } : { cwd, winners })
  }

  /**
   * Switch one source on or off; the per-skill switches are preserved.
   * @param source - source identity from the described rows.
   * @param enabled - the state to persist.
   */
  @Remote
  setSource(source: string, enabled: boolean): Promise<void> {
    return this.ctx.skillSources.setSource(source, enabled)
  }

  /**
   * Switch one skill on or off inside its source.
   * @param source - source identity from the described rows.
   * @param name - skill name.
   * @param enabled - the state to persist.
   */
  @Remote
  setSkill(source: string, name: string, enabled: boolean): Promise<void> {
    return this.ctx.skillSources.setSkill(source, name, enabled)
  }
}

/** Register the local filesystem skill provider on `ctx.skills`. */
export function apply(ctx: Context, config: Config = {}): void {
  let provider!: FileSystemSkillProvider
  /* v8 ignore next -- no-op until the registry constructs the provider in this same apply. */
  let invalidate = (): void => {}
  // The profile service owns the switches; this provider only merges its own
  // configuration under them and reports itself for invalidation.
  ctx.skills.registerProvider((control) => {
    provider = new FileSystemSkillProvider(ctx, control, config)
    invalidate = control.invalidate
    return provider
  })
  ctx.inject(['skillSources'], (scope) => {
    scope.effect(() => scope.skillSources.register(invalidate), 'skill-filesystem: source switches')
  })
  // A settings toggle reaches the next request without a restart: the provider
  // caches drop, and the catalog digest changes on the next model step.
  // The Skills tab reads this namespace; it reports discovery for the same
  // provider that feeds the model catalog. The Host gateway resolves the
  // service as a sibling, so the controller mounts at the root.
  ctx.effect(() => {
    const fiber = ctx.root.plugin(SkillSourcesController, () => ({ provider, invalidate }))
    return () => { void fiber.dispose() }
  }, 'skill-sources remote')
  ctx.effect(function* () {
    yield async () => { await provider.dispose() }
  }, 'skill-filesystem watcher')
  ctx.on('fs/observed', (target, _observation, actor) => {
    if (mutationToolName(actor) === undefined) return
    provider.observeHostMutation(target.displayPath)
  })
}

/**
 * Shorten a path for a row: the user's home becomes `~`, a project folder
 * becomes `.\`, and separators follow the platform.
 * @param path - absolute path the source or skill lives at.
 * @param cwd - project root of the describing session, when known.
 * @returns the shortened path with platform separators.
 */
function toDisplayPath(path: string, cwd: string | undefined): string {
  const home = homedir()
  const contains = (base: string): boolean => path === base || path.startsWith(`${base}${sep}`)
  const shorten = (base: string, prefix: string): string => {
    const rest = relative(base, path)
    return rest === '' ? prefix : `${prefix}${sep}${rest.split(/[\\/]/u).join(sep)}`
  }
  if (contains(home)) return shorten(home, '~')
  if (cwd !== undefined && cwd !== home && contains(cwd)) return shorten(cwd, '.')
  return path.split(/[\\/]/u).join(sep)
}

/** One discovered skill row before switches and duplicate winners are applied. */
interface DiscoveredCandidate {
  readonly name: string
  readonly path: string
  readonly displayPath: string
  readonly description: string
}

/** One frontmatter failure reported by discovery. */
interface InvalidCandidate {
  readonly path: string
  readonly displayPath: string
  readonly error: string
}

type DescribeCandidate = DiscoveredCandidate | InvalidCandidate

/**
 * Resolve the file a discovery candidate points at.
 * @param candidate - discovered skill summary with a concrete path or a locator.
 * @returns the SKILL.md or flat-file path.
 */
function candidatePath(candidate: { path?: string; locator: unknown }): string {
  /* v8 ignore next -- every filesystem discovery fills path; the locator fallback covers other providers. */
  return candidate.path ?? (candidate.locator as LocalLocator).path
}

/** Per-root discovery cache; a switch write re-resolves statuses without rescanning. */
interface DescribeCache {
  readonly key: string
  readonly at: number
  readonly rows: Map<string, readonly DescribeCandidate[]>
}

/** How long describe reuses discovery before a folder change can be observed. */
const DESCRIBE_CACHE_TTL_MS = 2000

/** Provider that maps local project/user skill roots into `ctx.skills`. */
export class FileSystemSkillProvider implements SkillProvider {
  readonly name: string
  private readonly includeDefaultRoots: boolean
  private readonly dshHome: string
  private readonly agentsHome: string
  private readonly customSkillDirs: string[]
  private readonly watchManager: SkillWatchManager
  private describeCache: DescribeCache | undefined
  private readonly bundledSkillDir: string | undefined
  private disposal: Promise<void> | undefined

  constructor(
    private readonly ctx: Context,
    control: SkillProviderControl,
    config: Config = {},
  ) {
    this.name = config.providerName ?? 'filesystem'
    this.includeDefaultRoots = config.includeDefaultRoots ?? true
    this.dshHome = resolveDshHome(config.dshHome)
    this.agentsHome = resolveAgentsHome(config.agentsHome)
    this.customSkillDirs = (config.customSkillDirs ?? []).map(root => resolve(root))
    this.watchManager = new SkillWatchManager(ctx, control.invalidate, resolveWatchConfig(config))
    control.signal.addEventListener('abort', () => { void this.dispose() }, { once: true })
    // The environment bundled root is a default root: an isolated provider
    // must see only its explicit roots, or every such provider would
    // re-discover the app's bundled skills under its own provider name.
    const bundledSkillDir = config.bundledSkillDir
      ?? (this.includeDefaultRoots ? process.env.DSH_BUNDLED_SKILL_DIR : undefined)
    this.bundledSkillDir = bundledSkillDir === undefined ? undefined : resolve(bundledSkillDir)
  }

  /** Switches and application folders owned by the profile service; without it every source and skill is visible. */
  private gate(): SkillVisibility {
    return this.ctx.get('skillSources')?.visibility() ?? ALL_VISIBLE
  }

  /**
   * Discover local skill summaries for a cwd-sensitive workspace.
   * @param options - lookup options; `cwd` selects the project roots to scan.
   * @returns candidates from readable roots with stable ranks. Failed roots are
   *   logged and omitted; root or watcher failures make the observation incomplete.
   */
  async list(options: SkillLookupOptions): Promise<SkillCandidate[] | SkillProviderObservation> {
    const gate = this.gate()
    // A switched-off source is neither scanned nor watched: it cannot contribute
    // a skill, so discovery and its watcher are pure cost.
    const roots = (await this.roots(options.cwd))
      .filter(root => gate.sourceEnabled(root.source))
    let complete = true
    try {
      await this.watchManager.observeRoots(roots)
    } catch (error) {
      if (this.disposal !== undefined) throw error
      complete = false
    }
    const candidates: SkillCandidate[] = []
    for (const root of roots) {
      options.signal?.throwIfAborted()
      try {
        const discovered = await discoverRoot(root, this.ctx, this.name)
        options.signal?.throwIfAborted()
        candidates.push(...discovered.filter(candidate => gate.skillEnabled(candidate.source, candidate.name)))
      } catch (error) {
        options.signal?.throwIfAborted()
        complete = false
        this.ctx.logger.warn(`skill root "${root.path}" skipped: ${errorMessage(error)}. Other roots remain available; check this directory's permissions and symlinks. Discovery retries on the next lookup.`)
      }
    }
    return complete ? candidates : { candidates, complete }
  }

  /**
   * Load a complete local skill body from the candidate's file locator.
   * @param candidate - the winning candidate returned by this provider.
   * @param options - lookup options whose signal cancels filesystem reads.
   * @returns the full local skill, or `undefined` if the file disappeared.
   */
  async get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    const gate = this.gate()
    /* v8 ignore next 2 -- list() already drops switched-off skills; this guard answers a direct get(). */
    if (!gate.skillEnabled(candidate.source, candidate.name)) return undefined
    const locator = candidate.locator as LocalLocator
    const parsed = await parseSkillFile(locator.path, this.ctx, options.signal, candidate.source === 'bundled')
    if (parsed === undefined) return undefined
    return {
      name: parsed.name,
      description: parsed.description,
      ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
      invocation: parsed.invocation,
      source: candidate.source,
      provider: this.name,
      resourceBase: { kind: 'directory', path: locator.directory },
      path: parsed.path,
      ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {},
      content: parsed.content,
    }
  }

  /**
   * Describe every local source and its skills for the Skills tab.
   * @param options - working directory and registry winners used to mark duplicates.
   * @returns one row per source, including a folder that disappeared.
   */
  async describeSources(options: LocalSourceOptions): Promise<LocalSourceView[]> {
    const gate = this.gate()
    const roots = await this.roots(options.cwd, true)
    const key = roots
      .map(root => `${root.source}\u0000${root.path}\u0000${root.missing === true ? 'missing' : 'present'}`)
      .join('\u0001')
    const now = Date.now()
    let cache = this.describeCache
    if (cache?.key !== key || now - cache.at > DESCRIBE_CACHE_TTL_MS) {
      cache = { key, at: now, rows: new Map() }
      this.describeCache = cache
    }
    const entries: { root: SkillRoot; candidates: readonly DescribeCandidate[] }[] = []
    for (const root of roots) {
      if (root.missing === true) {
        entries.push({ root, candidates: [] })
        continue
      }
      let candidates = cache.rows.get(root.path)
      if (candidates === undefined) {
        const diagnostics = new Map<string, string>()
        const discovered = await discoverRoot(root, this.ctx, this.name, (path, message) => { diagnostics.set(path, message) })
        const discoveredPaths = new Set(discovered.map(candidate => candidatePath(candidate)))
        candidates = [
          ...discovered.map((candidate): DiscoveredCandidate => ({
            name: candidate.name,
            path: candidatePath(candidate),
            displayPath: toDisplayPath(candidatePath(candidate), options.cwd),
            description: candidate.description,
          })),
          ...([...diagnostics] as [string, string][])
            .filter(([path]) => !discoveredPaths.has(path))
            .map(([path, error]): InvalidCandidate => ({ path, displayPath: toDisplayPath(path, options.cwd), error })),
        ]
        cache.rows.set(root.path, candidates)
      }
      entries.push({ root, candidates })
    }
    // Duplicate winners are resolved across every described source by rank, so a
    // preset-scoped provider still marks an override when the root catalog is empty.
    const bestRank = new Map<string, number>()
    const bestSource = new Map<string, string>()
    for (const { root, candidates } of entries) {
      if (root.missing === true) continue
      for (const candidate of candidates) {
        if ('error' in candidate) continue
        const current = bestRank.get(candidate.name)
        if (current === undefined || root.rank < current) {
          bestRank.set(candidate.name, root.rank)
          bestSource.set(candidate.name, root.source)
        }
      }
    }
    const views: LocalSourceView[] = []
    for (const { root, candidates } of entries) {
      const kind = gate.applications.some(application => application.id === root.source) ? 'application' : 'harness'
      const title = gate.applications.find(application => application.id === root.source)?.title ?? root.source
      const enabled = gate.sourceEnabled(root.source)
      const displayPath = toDisplayPath(root.path, options.cwd)
      if (root.missing === true) {
        views.push({ id: root.source, kind, title, path: root.path, displayPath, exists: false, enabled, skills: [] })
        continue
      }
      const skills: LocalSkillView[] = candidates.map((candidate) => {
        if ('error' in candidate) {
          return {
            path: candidate.path,
            displayPath: candidate.displayPath,
            status: 'invalid' as const,
            error: candidate.error,
          }
        }
        const localWinner = bestSource.get(candidate.name)
        const registryWinner = options.winners.get(candidate.name)
        const winner = localWinner !== undefined && localWinner !== root.source
          ? localWinner
          : registryWinner !== undefined && registryWinner !== root.source ? registryWinner : undefined
        return {
          name: candidate.name,
          path: candidate.path,
          displayPath: candidate.displayPath,
          description: candidate.description,
          status: gate.skillEnabled(root.source, candidate.name) ? 'available' as const : 'disabled' as const,
          ...(winner === undefined ? {} : { shadowedBy: winner }),
        }
      })
      skills.sort((left, right) => (left.name ?? left.path).localeCompare(right.name ?? right.path))
      views.push({ id: root.source, kind, title, path: root.path, displayPath, exists: true, enabled, skills })
    }
    return views
  }

  /**
   * Invalidate this provider synchronously after a first-party filesystem mutation.
   * @param path - host display path observed after a model-facing write or edit.
   */
  observeHostMutation(path: string): void {
    this.describeCache = undefined
    this.watchManager.observeHostMutation(path)
  }

  /**
   * Close every host watcher and contain late filesystem callbacks.
   * @returns a shared promise that settles when every watcher reaches quiescence.
   */
  dispose(): Promise<void> {
    this.disposal ??= this.watchManager.dispose()
    return this.disposal
  }

  private async roots(cwd: string | undefined, includeMissingApplications = false): Promise<SkillRoot[]> {
    const roots: SkillRoot[] = []
    if (this.includeDefaultRoots && cwd !== undefined) {
      const projectRoot = await findProjectRoot(resolve(cwd), optionalFileSystem(this.ctx))
      roots.push(
        { path: join(projectRoot, '.dsh/skills'), source: 'project-dsh', rank: PROJECT_DSH_RANK, projectRoot },
        { path: join(projectRoot, '.agents/skills'), source: 'project-agents', rank: PROJECT_AGENTS_RANK, projectRoot },
      )
    }
    roots.push(...this.customSkillDirs.map(path => ({ path, source: 'custom' as const, rank: CUSTOM_RANK })))
    if (this.includeDefaultRoots) {
      roots.push(
        { path: join(this.dshHome, 'skills'), source: 'user-dsh', rank: USER_DSH_RANK, skipSystem: true },
        { path: join(this.agentsHome, 'skills'), source: 'user-agents', rank: USER_AGENTS_RANK },
      )
    }
    if (this.bundledSkillDir !== undefined) {
      roots.push({ path: this.bundledSkillDir, source: 'bundled', rank: BUNDLED_SKILL_RANK, trustedHost: true })
    }
    for (const [index, application] of this.gate().applications.entries()) {
      // A folder the other application never created is not a source at all,
      // except when the Skills tab asks to show a previously enabled one.
      const resolvedDir = resolveApplicationDir(application.dir)
      const exists = await pathExists(resolvedDir, optionalFileSystem(this.ctx))
      if (!exists && !includeMissingApplications) continue
      roots.push({
        path: resolvedDir,
        source: application.id,
        rank: APPLICATION_RANK + index * 10,
        skipSystem: true,
        ...(!exists ? { missing: true } : {}),
      })
    }
    return roots
  }
}

/** Expand a leading `~` in an application folder and make the path absolute. */
function resolveApplicationDir(dir: string): string {
  /* v8 ignore next 2 -- the shipped application folders use this expansion; unit fixtures pass absolute folders. */
  if (dir === '~') return homedir()
  if (dir.startsWith('~/') || dir.startsWith('~\\')) return resolve(homedir(), dir.slice(2))
  return resolve(dir)
}

type SkillWatchEvent = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir'

type RootWatchMode =
  | { kind: 'root'; anchor: string }
  | { kind: 'ancestor'; anchor: string; nextPath: string }

interface RootWatchState {
  root: SkillRoot
  owners: Set<string>
  watcher: WatchHandle | undefined
  opening: Promise<void> | undefined
  unhealthy: boolean
}

interface WatchHandle {
  mode: RootWatchMode
  close(): Promise<void> | void
}

/** Owns bounded host watchers while discovery and reads remain on the filesystem service. */
class SkillWatchManager {
  private readonly roots = new Map<string, RootWatchState>()
  private readonly projects = new Map<string, Set<string>>()
  private readonly lifecycle = new AbortController()
  private closing = false
  private invalidationQueued = false

  constructor(
    private readonly ctx: Context,
    private readonly invalidate: () => void,
    private readonly config: ResolvedWatchConfig,
  ) {}

  async observeRoots(roots: readonly SkillRoot[]): Promise<void> {
    if (this.closing) return
    const projectRoots = new Map<string, SkillRoot[]>()
    const pending: Promise<void>[] = []
    for (const root of roots) {
      if (root.projectRoot === undefined) {
        pending.push(this.retainRoot(root, `shared:${root.path}`))
        continue
      }
      const grouped = projectRoots.get(root.projectRoot) ?? []
      grouped.push(root)
      projectRoots.set(root.projectRoot, grouped)
    }
    for (const [projectRoot, grouped] of projectRoots) {
      const owner = `project:${projectRoot}`
      this.projects.delete(projectRoot)
      const paths = new Set(grouped.map(root => root.path))
      this.projects.set(projectRoot, paths)
      for (const root of grouped) pending.push(this.retainRoot(root, owner))
    }
    let evictedProject = false
    while (this.projects.size > this.config.maxProjects) {
      const oldest = this.projects.entries().next()
      /* v8 ignore next -- the loop condition proves one project exists. */
      if (oldest.done) break
      const [projectRoot, paths] = oldest.value
      this.projects.delete(projectRoot)
      const owner = `project:${projectRoot}`
      for (const path of paths) pending.push(this.releaseRoot(path, owner))
      evictedProject = true
    }
    await Promise.all(pending)
    if (evictedProject) this.invalidate()
  }

  observeHostMutation(path: string): void {
    if (this.closing) return
    const normalized = resolve(path)
    if (![...this.roots.values()].some(state => isPotentialSkillPath(state.root, normalized))) return
    this.invalidate()
  }

  async dispose(): Promise<void> {
    this.closing = true
    this.lifecycle.abort(new Error('skill-filesystem watcher disposed'))
    const states = [...this.roots.values()]
    this.roots.clear()
    this.projects.clear()
    await Promise.all(states.map(async (state) => {
      await settleWatcherOpening(state.opening)
      const watcher = state.watcher
      state.watcher = undefined
      if (watcher !== undefined) await this.closeWatcher(watcher)
    }))
  }

  private async retainRoot(root: SkillRoot, owner: string): Promise<void> {
    let state = this.roots.get(root.path)
    if (state === undefined) {
      state = { root, owners: new Set(), watcher: undefined, opening: undefined, unhealthy: true }
      this.roots.set(root.path, state)
    }
    state.owners.add(owner)
    if (this.config.enabled) await this.ensureWatcher(state)
  }

  private async releaseRoot(path: string, owner: string): Promise<void> {
    const state = this.roots.get(path)
    /* v8 ignore next -- Concurrent cwd observations can evict the same shared root before this release settles. */
    if (state === undefined) return
    state.owners.delete(owner)
    if (state.owners.size > 0) return
    this.roots.delete(path)
    await settleWatcherOpening(state.opening)
    const watcher = state.watcher
    state.watcher = undefined
    if (watcher !== undefined) await this.closeWatcher(watcher)
  }

  private ensureWatcher(state: RootWatchState): Promise<void> {
    /* v8 ignore next -- A scheduled rewatch can reach this guard only when teardown wins its await. */
    if (this.closing || !this.config.enabled) return Promise.resolve()
    if (state.opening !== undefined) return state.opening
    const opening = this.ensureCurrentWatcher(state)
    state.opening = opening
    void opening.then(
      () => {
        state.opening = undefined
      },
      () => {
        state.opening = undefined
      },
    )
    return opening
  }

  private async ensureCurrentWatcher(state: RootWatchState): Promise<void> {
    const watcher = state.watcher
    if (watcher !== undefined && !state.unhealthy) {
      const current = await resolveRootWatchMode(state.root.path, this.config.followSymlinks)
      // A child unlink can publish an empty catalog before root unlinkDir arrives.
      // Discovery therefore revalidates the retained handle independently.
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- watcher callbacks can mark unhealthy while the probe awaits
      if (!state.unhealthy && sameWatchMode(watcher.mode, current)) return
    }
    await this.replaceWatcher(state)
  }

  private async replaceWatcher(state: RootWatchState): Promise<void> {
    const previous = state.watcher
    state.watcher = undefined
    if (previous !== undefined) await this.closeWatcher(previous)
    /* v8 ignore next -- Teardown can win while an unhealthy watcher is still closing. */
    if (this.closing || state.owners.size === 0) return
    try {
      const watcher = await this.openStableWatcher(state)
      /* v8 ignore next -- The loop returns no handle only when teardown wins between awaited probes. */
      if (watcher === undefined) return
      /* v8 ignore start -- Post-open teardown is timing-dependent; the disposal race has an explicit integration test. */
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- teardown can race awaited watcher startup
      if (this.closing || state.owners.size === 0) {
        await this.closeWatcher(watcher)
        return
      }
      /* v8 ignore stop */
      state.watcher = watcher
      state.unhealthy = false
    } catch (error) {
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- teardown can race awaited watcher startup
      if (!this.closing) {
        state.unhealthy = true
        this.ctx.logger.warn(`skill-filesystem: failed to watch ${state.root.path}: ${errorMessage(error)}`)
      }
      throw error
    }
  }

  // TODO(file-watch-service): Extract Chokidar and missing-root observation below into a Cordis
  // service; keep skill filtering and invalidation here.
  private async openStableWatcher(state: RootWatchState): Promise<WatchHandle | undefined> {
    while (!this.closing && state.owners.size > 0) {
      const mode = await resolveRootWatchMode(state.root.path, this.config.followSymlinks)
      const watcher = mode.kind === 'ancestor'
        ? this.openAncestorWatcher(state, mode)
        : await this.openRootWatcher(state, mode)
      const current = await resolveRootWatchMode(state.root.path, this.config.followSymlinks)
      /* v8 ignore else -- A host path transition between the two probes is timing-dependent. */
      if (sameWatchMode(mode, current)) return watcher
      /* v8 ignore next -- Covered by the same host path transition guard. */
      await this.closeWatcher(watcher)
    }
    /* v8 ignore next -- The loop exits only when teardown wins between awaited probes. */
    return undefined
  }

  private openAncestorWatcher(state: RootWatchState, mode: Extract<RootWatchMode, { kind: 'ancestor' }>): WatchHandle {
    const listener = (_current: Stats, _previous: Stats): void => {
      void this.handleAncestorWatchEvent(state, mode)
    }
    watchFile(mode.nextPath, {
      persistent: false,
      interval: this.config.pollIntervalMs,
    }, listener)
    return {
      mode,
      close() {
        unwatchFile(mode.nextPath, listener)
      },
    }
  }

  private async handleAncestorWatchEvent(
    state: RootWatchState,
    mode: Extract<RootWatchMode, { kind: 'ancestor' }>,
  ): Promise<void> {
    let current: RootWatchMode
    try {
      current = await resolveRootWatchMode(state.root.path, this.config.followSymlinks)
    } catch (error) {
      /* v8 ignore start -- Non-absence stat failures need a platform permission or I/O fault. */
      if (!this.closing && state.owners.size > 0) this.handleWatcherError(state, error)
      return
      /* v8 ignore stop */
    }
    if (this.closing || state.owners.size === 0 || sameWatchMode(mode, current)) return
    this.queueInvalidation()
    state.unhealthy = true
    this.scheduleRewatch(state)
  }

  private async openRootWatcher(state: RootWatchState, mode: Extract<RootWatchMode, { kind: 'root' }>): Promise<WatchHandle> {
    const watcher = chokidar.watch(mode.anchor, {
      // Chokidar owns late native fs.watch errors only for persistent watchers;
      // this provider's effect explicitly closes every handle at teardown.
      persistent: true,
      ignoreInitial: true,
      depth: 1,
      followSymlinks: this.config.followSymlinks,
      atomic: true,
      awaitWriteFinish: {
        stabilityThreshold: this.config.stabilityThresholdMs,
        pollInterval: this.config.pollIntervalMs,
      },
      usePolling: this.config.usePolling,
      interval: this.config.pollIntervalMs,
    })
    let ready = false
    const readiness = Promise.withResolvers<undefined>()
    const signal = this.lifecycle.signal
    const onError = (error: unknown): void => {
      if (!ready) {
        readiness.reject(error)
        return
      }
      this.handleWatcherError(state, error)
    }
    const handle: WatchHandle = {
      mode,
      close: () => {
        // `close()` drops every listener but leaves a scheduled write-settle
        // poll; its straggler stats a file this teardown is deleting, which
        // Windows reports as EPERM, and an 'error' emission with no listener
        // is rethrown as an uncaught exception. Re-attach across the close.
        const closing = watcher.close()
        watcher.on('error', onError)
        return closing
      },
    }
    if (signal.aborted) {
      await this.closeWatcher(handle)
      signal.throwIfAborted()
    }
    const onAbort = (): void => { readiness.reject(signal.reason) }
    signal.addEventListener('abort', onAbort, { once: true })
    watcher.on('error', onError)
    watcher.once('ready', () => {
      ready = true
      readiness.resolve(undefined)
    })
    for (const event of ['add', 'addDir', 'change', 'unlink', 'unlinkDir'] as const) {
      watcher.on(event, (path) => { this.handleWatchEvent(state, mode, event, path) })
    }
    try {
      await readiness.promise
    } catch (error) {
      await this.closeWatcher(handle)
      throw error
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
    return handle
  }

  private handleWatchEvent(
    state: RootWatchState,
    mode: Extract<RootWatchMode, { kind: 'root' }>,
    event: SkillWatchEvent,
    path: string,
  ): void {
    const target = resolve(path)
    if (this.closing || !isRelevantWatchEvent({ ...state.root, path: mode.anchor }, event, target)) return
    this.queueInvalidation()
    if (target === mode.anchor && event === 'unlinkDir') {
      state.unhealthy = true
      this.scheduleRewatch(state)
    }
  }

  private handleWatcherError(state: RootWatchState, error: unknown): void {
    if (this.closing) return
    this.ctx.logger.warn(`skill-filesystem: watcher for ${state.root.path} failed: ${errorMessage(error)}`)
    state.unhealthy = true
    this.queueInvalidation()
    this.scheduleRewatch(state)
  }

  private scheduleRewatch(state: RootWatchState): void {
    const currentOpening = state.opening ?? Promise.resolve()
    void (async () => {
      await settleWatcherOpening(currentOpening)
      try {
        await this.ensureWatcher(state)
      } catch {
        // Watch startup logged the retry failure; the next incomplete discovery retries it again.
        return
      }
      this.queueInvalidation()
    })()
  }

  private queueInvalidation(): void {
    if (this.closing || this.invalidationQueued) return
    this.invalidationQueued = true
    queueMicrotask(() => {
      this.invalidationQueued = false
      /* v8 ignore next -- Effect teardown can win this queued microtask before provider disposal emits. */
      if (this.closing) return
      this.invalidate()
    })
  }

  private async closeWatcher(watcher: WatchHandle): Promise<void> {
    try {
      await watcher.close()
    } catch (error) {
      this.ctx.logger.warn(`skill-filesystem: failed to close watcher: ${errorMessage(error)}`)
    }
  }
}

async function settleWatcherOpening(opening: Promise<void> | undefined): Promise<void> {
  if (opening === undefined) return
  try {
    await opening
  } catch {
    // Watch startup already logged the underlying failure; teardown only contains it.
  }
}

function resolveWatchConfig(config: Config): ResolvedWatchConfig {
  const stabilityThresholdMs = config.watchStabilityThresholdMs ?? DEFAULT_WATCH_STABILITY_THRESHOLD_MS
  const pollIntervalMs = config.watchPollIntervalMs ?? DEFAULT_WATCH_POLL_INTERVAL_MS
  const maxProjects = config.watchMaxProjects ?? DEFAULT_WATCH_MAX_PROJECTS
  assertPositiveInteger('watchStabilityThresholdMs', stabilityThresholdMs)
  assertPositiveInteger('watchPollIntervalMs', pollIntervalMs)
  assertPositiveInteger('watchMaxProjects', maxProjects)
  return {
    enabled: config.watch ?? true,
    usePolling: config.watchUsePolling ?? false,
    stabilityThresholdMs,
    pollIntervalMs,
    maxProjects,
    followSymlinks: config.watchFollowSymlinks ?? true,
  }
}

async function resolveRootWatchMode(root: string, followSymlinks: boolean): Promise<RootWatchMode> {
  let candidate = root
  while (true) {
    try {
      const info = await stat(candidate)
      if (info.isDirectory()) {
        const preserveRootLink = candidate === root
          && !followSymlinks
          && (await lstat(candidate)).isSymbolicLink()
        const anchor = preserveRootLink ? resolve(candidate) : await canonicalizeWatchPath(candidate)
        if (candidate === root) return { kind: 'root', anchor }
        const firstSegment = relative(candidate, root).split(sep)[0]
        /* v8 ignore next -- candidate is a strict ancestor of root. */
        if (firstSegment === undefined || firstSegment.length === 0) return { kind: 'root', anchor }
        return { kind: 'ancestor', anchor, nextPath: join(anchor, firstSegment) }
      }
    } catch (error) {
      /* v8 ignore next -- Non-absence stat failures are platform/permission-specific and propagate as incomplete discovery. */
      if (!isAbsentPathError(error)) throw error
    }
    const parent = dirname(candidate)
    /* v8 ignore next -- Traversal reaches the existing filesystem root before this fallback. */
    if (parent === candidate) return { kind: 'ancestor', anchor: candidate, nextPath: root }
    candidate = parent
  }
}

function sameWatchMode(left: RootWatchMode, right: RootWatchMode): boolean {
  return left.kind === right.kind
    && left.anchor === right.anchor
    && (left.kind === 'root' || (right.kind === 'ancestor' && left.nextPath === right.nextPath))
}

function isRelevantWatchEvent(
  root: SkillRoot,
  event: SkillWatchEvent,
  path: string,
): boolean {
  const segments = containedSegments(root.path, path)
  if (segments === undefined) return false
  if (segments.length === 0) return event === 'addDir' || event === 'unlinkDir'
  if (root.skipSystem === true && segments[0] === '.system') return false
  if (segments.length === 1) {
    if (event === 'addDir' || event === 'unlinkDir') return true
    return segments[0]?.endsWith('.md') === true
  }
  return segments.length === 2
    && segments[1] === 'SKILL.md'
    && event !== 'addDir'
    && event !== 'unlinkDir'
}

function isPotentialSkillPath(root: SkillRoot, path: string): boolean {
  const segments = containedSegments(root.path, path)
  if (segments === undefined || segments.length === 0 || segments.length > 2) return false
  if (root.skipSystem === true && segments[0] === '.system') return false
  return segments.length === 1
    ? segments[0]?.endsWith('.md') === true
    : segments[1] === 'SKILL.md'
}

function containedSegments(root: string, path: string): string[] | undefined {
  const child = relative(root, path)
  if (child.length === 0) return []
  if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) return undefined
  return child.split(sep)
}

function mutationToolName(actor: object | undefined): 'edit' | 'write' | undefined {
  if (actor === undefined || !('name' in actor)) return undefined
  const value = actor.name
  return value === 'edit' || value === 'write' ? value : undefined
}

function assertPositiveInteger(field: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`skill-filesystem: ${field} must be a positive integer`)
  }
}

function isAbsentPathError(error: unknown): boolean {
  return hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'ENOTDIR')
}

function isAbsentSkillPathError(error: unknown): boolean {
  return isAbsentPathError(error)
    || hasErrorCode(error, 'FS_NOT_FOUND')
    || hasErrorCode(error, 'FS_NOT_DIRECTORY')
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

async function discoverRoot(
  root: SkillRoot, ctx: Context, provider: string, report?: (path: string, message: string) => void,
): Promise<SkillCandidate[]> {
  const skills: SkillCandidate[] = []
  const entries = await listSkillRootEntries(root, ctx)
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (root.skipSystem && entry.name === '.system') continue
    const locator = entry.type === 'directory'
      ? { path: join(entry.path, 'SKILL.md'), directory: entry.path }
      : entry.type === 'file' && entry.name.endsWith('.md')
        ? { path: entry.path, directory: root.path }
        : undefined
    if (locator === undefined) continue
    const parsed = await parseSkillFile(
      locator.path, ctx, undefined, root.trustedHost === true,
      report === undefined ? undefined : (message: string) => { report(locator.path, message) },
    )
    if (parsed === undefined) continue
    skills.push({
      name: parsed.name,
      description: parsed.description,
      ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
      invocation: parsed.invocation,
      provider,
      source: root.source,
      rank: root.rank,
      locator,
      resourceBase: { kind: 'directory', path: locator.directory },
      path: parsed.path,
      ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {},
    })
  }
  return skills
}

async function listSkillRootEntries(root: SkillRoot, ctx: Context): Promise<SkillRootEntry[]> {
  const fs = optionalFileSystem(ctx)
  if (fs !== undefined && root.trustedHost !== true) return await listSkillRootEntriesFromFileSystem(root, fs)
  return await listSkillRootEntriesFromNode(root, ctx)
}

async function listSkillRootEntriesFromFileSystem(root: SkillRoot, fs: FileSystem): Promise<SkillRootEntry[]> {
  try {
    return (await fsListDir(fs, root.path)).map(entryFromFs)
  } catch (error) {
    if (isAbsentSkillPathError(error)) return []
    throw error
  }
}

async function fsListDir(fs: FileSystem, path: string): Promise<FsDirEntry[]> {
  const target = await fs.resolve(path)
  return await fs.listDir(target)
}

function entryFromFs(entry: FsDirEntry): SkillRootEntry {
  return { name: entry.name, type: entry.type, path: entry.target.displayPath }
}

async function listSkillRootEntriesFromNode(root: SkillRoot, ctx: Context): Promise<SkillRootEntry[]> {
  let entries
  try {
    entries = await readdir(root.path, { withFileTypes: true, encoding: 'utf8' })
  } catch (error) {
    /* v8 ignore else -- Native non-absence directory failures are provider-dependent; the ctx.fs path pins incomplete discovery. */
    if (isAbsentSkillPathError(error)) return []
    /* v8 ignore next -- Same native error branch as above. */
    throw error
  }

  const result: SkillRootEntry[] = []
  for (const entry of entries) {
    const path = join(root.path, entry.name)
    const type = await nodeEntryKind(path, entry, ctx)
    /* v8 ignore next -- special files that are neither directories nor regular files exist only on POSIX hosts. */
    result.push({ name: entry.name, type: type ?? 'other', path })
  }
  return result
}

async function parseSkillFile(
  path: string, ctx: Context, signal?: AbortSignal, trustedHost = false,
  report?: (message: string) => void,
): Promise<ParsedSkill | undefined> {
  const raw = await readSkillText(ctx, path, signal, trustedHost)
  signal?.throwIfAborted()
  if (raw === undefined) {
    return undefined
  }
  let parsed
  try {
    parsed = parseFrontmatter(raw.content)
  } catch (error) {
    const message = `invalid YAML frontmatter: ${errorMessage(error)}`
    ctx.logger.warn(`skill file ${path} ignored: ${message}`)
    report?.(message)
    return undefined
  }
  if (!parsed) {
    const message = 'missing YAML frontmatter'
    ctx.logger.warn(`skill file ${path} ignored: ${message}`)
    report?.(message)
    return undefined
  }
  const name = stringField(parsed.data, 'name')
  const description = stringField(parsed.data, 'description')
  if (name === undefined || description === undefined) {
    const message = 'frontmatter requires name and description'
    ctx.logger.warn(`skill file ${path} ignored: ${message}`)
    report?.(message)
    return undefined
  }
  if (!isSkillName(name)) {
    const message = `invalid skill name "${name}"`
    ctx.logger.warn(`skill file ${path} ignored: ${message}`)
    report?.(message)
    return undefined
  }
  let invocation
  try {
    invocation = parseInvocationPolicy(parsed.data)
  } catch (error) {
    const message = `invalid invocation frontmatter: ${errorMessage(error)}`
    ctx.logger.warn(`skill file ${path} ignored: ${message}`)
    report?.(message)
    return undefined
  }
  return {
    name,
    description,
    ...optionalString(parsed.data, 'whenToUse'),
    invocation,
    ...optionalMetadata(parsed.data),
    path: raw.path,
    content: parsed.body.trim(),
  }
}

function optionalFileSystem(ctx: Context): FileSystem | undefined {
  return ctx.get('fs')
}

async function readSkillText(ctx: Context, path: string, signal?: AbortSignal, trustedHost = false): Promise<SkillText | undefined> {
  signal?.throwIfAborted()
  const fs = optionalFileSystem(ctx)
  if (fs !== undefined && !trustedHost) {
    return await readSkillTextFromFileSystem(ctx, fs, path, signal)
  }
  try {
    const resolvedPath = await realpath(path)
    return { path: resolvedPath, content: await readFile(resolvedPath, { encoding: 'utf8', signal }) }
  } catch (error) {
    signal?.throwIfAborted()
    if (isAbsentSkillPathError(error)) return undefined
    throw error
  }
}

async function readSkillTextFromFileSystem(
  ctx: Context, fs: FileSystem, path: string, signal?: AbortSignal,
): Promise<SkillText | undefined> {
  // A missing or temporarily inaccessible skill file is not fatal to discovery.
  signal?.throwIfAborted()
  let target
  try {
    target = await fs.resolve(path)
  } catch (error) {
    if (isAbsentSkillPathError(error)) return undefined
    throw error
  }
  signal?.throwIfAborted()
  let info
  try {
    info = await fs.stat(target, signal)
  } catch (error) {
    signal?.throwIfAborted()
    if (isAbsentSkillPathError(error)) return undefined
    throw error
  }
  if (info === undefined || info.type !== 'file') return undefined
  try {
    return { path: fs.processPath(target), content: await fs.readText(target, signal) }
  } catch (error) {
    signal?.throwIfAborted()
    if (isAbsentSkillPathError(error)) return undefined
    if (!hasErrorCode(error, 'FS_NOT_TEXT')) throw error
    ctx.logger.warn(`skill file ${path} ignored: ${fsReadErrorMessage(target, error)}`)
    return undefined
  }
}

function fsReadErrorMessage(target: FsTarget, error: unknown): string {
  return `failed to read text file at ${target.displayPath}: ${errorMessage(error)}`
}

async function nodeEntryKind(fullPath: string, entry: { isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }, ctx: Context): Promise<'directory' | 'file' | undefined> {
  if (entry.isDirectory()) return 'directory'
  /* v8 ignore next -- entry-kind probe follows a symlink first, which Windows fixtures cannot create. */
  if (entry.isFile()) return 'file'
  /* v8 ignore next -- Non-file directory entries such as FIFOs are platform-specific and intentionally skipped. */
  if (!entry.isSymbolicLink()) return undefined
  /* v8 ignore next 10 -- symlink fixtures require POSIX privileges; Windows runs them as skipped. */
  try {
    const info = await stat(fullPath)
    if (info.isDirectory()) return 'directory'
    /* v8 ignore else -- the special-file symlink branch relies on POSIX /dev/null. */
    if (info.isFile()) return 'file'
    /* v8 ignore next -- The special-file symlink fixture relies on POSIX /dev/null. */
    return undefined
  } catch (error) {
    ctx.logger.warn(`skill entry ${fullPath} ignored: failed to follow symbolic link: ${errorMessage(error)}`)
    return undefined
  }
}

function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } | undefined {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  const firstLine = raw.slice(0, firstLineEnd).replace(/\r$/, '')
  if (firstLine !== '---') return undefined
  const start = firstLineEnd + 1
  const closing = findClosingFrontmatter(raw, start)
  if (closing === undefined) return undefined
  const yaml = raw.slice(start, closing.start)
  const parsed: unknown = parseYaml(yaml)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  return { data: parsed as Record<string, unknown>, body: raw.slice(closing.bodyStart) }
}

function findClosingFrontmatter(raw: string, start: number): { start: number; bodyStart: number } | undefined {
  let lineStart = start
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    const line = raw.slice(lineStart, lineEnd).replace(/\r$/, '')
    if (line === '---') {
      return { start: lineStart, bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1 }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
}

async function findProjectRoot(cwd: string, fs: FileSystem | undefined): Promise<string> {
  let current = cwd
  while (true) {
    if (await pathExists(join(current, '.git'), fs)) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) return cwd
    current = parent
  }
}

async function pathExists(path: string, fs: FileSystem | undefined): Promise<boolean> {
  if (fs !== undefined) {
    return await pathExistsInFileSystem(path, fs)
  }
  return await pathExistsInNode(path)
}

async function pathExistsInFileSystem(path: string, fs: FileSystem): Promise<boolean> {
  let target
  try {
    target = await fs.resolve(path)
  } catch {
    // A backend may reject or hide this candidate; continue walking upward.
    return false
  }
  try {
    return await fs.stat(target) !== undefined
  } catch {
    // Transient stat failures make only this git-root candidate unusable.
    return false
  }
}

async function pathExistsInNode(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    // Missing host paths are expected while walking toward the filesystem root.
    return false
  }
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalString(data: Record<string, unknown>, key: string): { [K in typeof key]?: string } {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? { [key]: value } : {}
}

function parseInvocationPolicy(data: Record<string, unknown>): SkillInvocationPolicy {
  rejectLegacyInvocationKey(data, 'disableModelInvocation', 'disable-model-invocation')
  rejectLegacyInvocationKey(data, 'modelInvocable', 'disable-model-invocation')
  rejectLegacyInvocationKey(data, 'userInvocable', 'user-invocable')
  const disableModelInvocation = frontmatterBoolean(data, 'disable-model-invocation')
  const userInvocable = frontmatterBoolean(data, 'user-invocable')
  return {
    modelInvocable: disableModelInvocation !== true,
    userInvocable: userInvocable !== false,
  }
}

function rejectLegacyInvocationKey(data: Record<string, unknown>, legacy: string, canonical: string): void {
  if (Object.hasOwn(data, legacy)) {
    throw new Error(`frontmatter field "${legacy}" is unsupported; use "${canonical}"`)
  }
}

function frontmatterBoolean(data: Record<string, unknown>, key: string): boolean | undefined {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    switch (value.toLowerCase()) {
      case 'true':
      case 'yes':
      case 'on':
        return true
      case 'false':
      case 'no':
      case 'off':
        return false
    }
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`)
}

function optionalMetadata(data: Record<string, unknown>): { metadata?: Record<string, unknown> } {
  const value = data.metadata
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return { metadata: value as Record<string, unknown> }
  }
  return {}
}

function errorMessage(error: unknown): string {
  return String(error)
}
