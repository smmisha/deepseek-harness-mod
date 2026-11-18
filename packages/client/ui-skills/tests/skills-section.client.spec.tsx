// @vitest-environment jsdom
/**
 * Skills tab: catalog tiles, the description block, both grouping modes with
 * their groups and filters, the detail panel, the add menu, and every load and
 * write state.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { LocalSkillView, LocalSourceView } from '@deepseek-ai/dsh-skill-filesystem/types'
import type { InstallPreview } from '@deepseek-ai/dsh-skill-install/types'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { SkillsSection, type AddFolderOutcome, type SkillsSectionProps } from '../src/client/SkillsSection.tsx'
import { SkillDetail } from '../src/client/SkillDetail.tsx'
import type { SkillsTranslate } from '../src/client/skills-catalog.ts'
import type { InstallFace } from '../src/client/skills-install.ts'
import { createSkillsStore, type SkillsGrouping, type SkillsStoreHandle } from '../src/client/skills-store.ts'
import { en, type SkillsLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

/** The tab copies a path through the host clipboard API, which jsdom omits. */
function stubClipboard(): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => { await Promise.resolve() } },
  })
}

/** A byte size as the panel prints it, in the reader's locale. */
function unitText(value: number, unit: 'byte' | 'kilobyte' | 'megabyte'): string {
  return new Intl.NumberFormat(undefined, { style: 'unit', unit, maximumFractionDigits: 1 }).format(value)
}

/** The `skills` locale seat over the English dictionary. */
type Translate = (key: string, params?: Record<string, unknown>) => string

function translator(): Translate {
  return ((key: string, params?: Record<string, unknown>): string =>
    Object.entries(params ?? {}).reduce<string>((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), en[key as SkillsLocaleKey]))
}

const SOURCES: readonly LocalSourceView[] = [
  {
    id: 'claude-code',
    kind: 'application',
    applicationId: 'claude-code',
    title: 'Claude Code',
    path: '~\\.claude\\skills',
    displayPath: '~\\.claude\\skills',
    exists: true,
    enabled: true,
    skills: [
      {
        name: 'app-skill',
        path: '~\\.claude\\skills\\app-skill\\SKILL.md',
        displayPath: '~\\.claude\\skills\\app-skill\\SKILL.md',
        description: 'Helps with apps and other long descriptions that keep going past the second line',
        language: 'en-GB',
        status: 'available',
        files: [
          { path: 'SKILL.md', size: 2048, isScript: false },
          { path: 'scripts/audit.sh', size: 1536000, isScript: true },
        ],
        provenance: { url: 'https://github.com/anthropics/skills', commit: '2c5958e', installedAt: '2026-11-12T09:30:00Z' },
      },
      {
        name: 'dup-skill',
        path: '~\\.claude\\skills\\dup-skill\\SKILL.md',
        displayPath: '~\\.claude\\skills\\dup-skill\\SKILL.md',
        description: 'Loses the duplicate to the harness',
        status: 'available',
        shadowedBy: 'user-dsh',
      },
      {
        name: 'off-skill',
        path: '~\\.claude\\skills\\off-skill\\SKILL.md',
        displayPath: '~\\.claude\\skills\\off-skill\\SKILL.md',
        status: 'disabled',
      },
      {
        path: '~\\.claude\\skills\\broken\\SKILL.md',
        displayPath: '~\\.claude\\skills\\broken\\SKILL.md',
        status: 'invalid',
        files: [],
      },
      {
        path: '~\\.claude\\skills\\bad\\SKILL.md',
        displayPath: '~\\.claude\\skills\\bad\\SKILL.md',
        status: 'invalid',
        error: 'missing YAML frontmatter',
      },
    ],
  },
  {
    id: 'user-dsh', kind: 'harness', title: 'user-dsh', path: '~\\.dsh\\skills', displayPath: '~\\.dsh\\skills',
    exists: true, enabled: true, skills: [],
  },
  {
    id: 'codex', kind: 'application', applicationId: 'codex', title: 'Codex', path: '~\\.codex\\skills',
    displayPath: '~\\.codex\\skills', exists: false, enabled: false, skills: [],
  },
  {
    id: 'paused', kind: 'harness', title: 'Paused source', path: '~\\.paused\\skills', displayPath: '~\\.paused\\skills',
    exists: true, enabled: false,
    skills: [{ name: 'paused-skill', path: '~\\.paused\\skills\\paused-skill\\SKILL.md', status: 'available' }],
  },
  {
    id: 'folder:D:\\team\\skills', kind: 'folder', title: 'skills', path: 'D:\\team\\skills', displayPath: 'D:\\team\\skills',
    exists: true, enabled: true,
    skills: [{
      name: 'team-skill',
      path: 'D:\\team\\skills\\team-skill\\SKILL.md',
      displayPath: 'D:\\team\\skills\\team-skill\\SKILL.md',
      description: 'Team skill',
      status: 'available',
      files: [{ path: 'SKILL.md', size: 512, isScript: false }],
      provenance: { url: 'anthropics/skills' },
    },
    {
      name: 'plain-team-skill',
      path: 'D:\\team\\skills\\plain\\SKILL.md',
      displayPath: 'D:\\team\\skills\\plain\\SKILL.md',
      status: 'available',
    }],
  },
  {
    id: 'folder:D:\\', kind: 'folder', title: '', path: 'D:\\', displayPath: 'D:\\', exists: true, enabled: true, skills: [],
  },
  {
    id: 'folder:D:\\gone', kind: 'folder', title: 'gone', path: 'D:\\gone', displayPath: 'D:\\gone',
    exists: false, enabled: true, skills: [],
  },
  // An application the Host names by id only, and one it configured itself.
  {
    id: 'zebra', kind: 'application', title: 'Zebra', path: '~\\.zebra\\skills', displayPath: '~\\.zebra\\skills',
    exists: true, enabled: true, skills: [],
  },
  {
    id: 'nova', kind: 'application', applicationId: 'nova', title: 'Nova', path: '~\\.nova\\skills',
    displayPath: '~\\.nova\\skills', exists: true, enabled: true,
    skills: [{ name: 'nova-skill', path: '~\\.nova\\skills\\nova-skill\\SKILL.md', status: 'available' }],
  },
]

/**
 * Inventory for the category board: one harness source and one added folder,
 * with built-in category ids, a rule id this package does not know, and skills
 * no category claims. `beta-off` is a skill switched off inside a switched-on
 * source.
 */
const CATEGORY_SOURCES: readonly LocalSourceView[] = [
  {
    id: 'alpha', kind: 'harness', title: 'Alpha', path: '~\\alpha', displayPath: '~\\alpha', exists: true, enabled: true,
    skills: [
      {
        name: 'alpha-video-one', path: '~\\alpha\\alpha-video-one\\SKILL.md', description: 'First video skill',
        status: 'available', category: 'video', categoryTitle: 'Video and animation',
      },
      {
        name: 'alpha-video-two', path: '~\\alpha\\alpha-video-two\\SKILL.md', description: 'Second video skill',
        status: 'available', category: 'video', categoryTitle: 'Video and animation',
      },
      {
        name: 'alpha-design', path: '~\\alpha\\alpha-design\\SKILL.md', description: 'Design work',
        status: 'available', category: 'design', categoryTitle: 'Design and Figma',
      },
    ],
  },
  {
    id: 'folder:D:\\beta', kind: 'folder', title: 'beta', path: 'D:\\beta', displayPath: 'D:\\beta',
    exists: true, enabled: true,
    skills: [
      {
        name: 'beta-video', path: 'D:\\beta\\beta-video\\SKILL.md', description: 'Third video skill',
        status: 'available', category: 'video', categoryTitle: 'Video and animation',
      },
      {
        name: 'beta-plugin', path: 'D:\\beta\\beta-plugin\\SKILL.md', description: 'Plugin skill',
        status: 'available', category: 'plugin-ckm', categoryTitle: 'ckm',
      },
      {
        name: 'beta-raw', path: 'D:\\beta\\beta-raw\\SKILL.md', description: 'Rule this tab does not know',
        status: 'available', category: 'rawword',
      },
      { name: 'beta-off', path: 'D:\\beta\\beta-off\\SKILL.md', description: 'Switched off', status: 'disabled' },
    ],
  },
  {
    id: 'folder:D:\\empty', kind: 'folder', title: 'empty', path: 'D:\\empty', displayPath: 'D:\\empty',
    exists: true, enabled: true, skills: [],
  },
]

/** Stub face over the fixture inventory. */
type FaceStub = {
  load?: (cwd?: string) => Promise<readonly LocalSourceView[]>
  setSource?: (id: string, enabled: boolean) => Promise<string | undefined>
  setSkill?: (source: string, name: string, enabled: boolean) => Promise<string | undefined>
  addFolder?: (path: string) => Promise<AddFolderOutcome>
  removeFolder?: (path: string) => Promise<string | undefined>
  pickFolder?: () => Promise<string | null>
  createWithAi?: () => void
  catalogs?: InstallFace['catalogs']
  repository?: InstallFace['repository']
  previewRepository?: InstallFace['previewRepository']
  previewArchive?: InstallFace['previewArchive']
  previewFolder?: InstallFace['previewFolder']
  installSkill?: InstallFace['installSkill']
  removeInstalled?: InstallFace['removeInstalled']
}

/** The install surface every stub face carries; a case overrides what it exercises. */
function installStubs(): InstallFace {
  return {
    catalogs: async () => ({ ok: true, value: [] }),
    repository: async () => ({
      ok: true,
      value: { owner: 'acme', repo: 'skills', commit: 'abc', skills: [] },
    }),
    previewRepository: async () => ({ ok: false, failure: { code: 'skill-install/not-found', message: 'gone' } }),
    previewArchive: async () => ({ ok: false, failure: { code: 'skill-install/archive-invalid', message: 'refused' } }),
    previewFolder: async () => ({ ok: false, failure: { code: 'skill-install/invalid-skill', message: 'refused' } }),
    installSkill: async () => ({ ok: true, value: { installed: [] } }),
    removeInstalled: async () => undefined,
  }
}

/** Props of one tab instance over its own store. */
function catalogProps(overrides: FaceStub = {}, sources: readonly LocalSourceView[] = SOURCES, grouping?: SkillsGrouping): {
  readonly store: SkillsStoreHandle
  readonly props: () => SkillsSectionProps
} {
  const store = createSkillsStore()
  const instance = store.create()
  if (grouping !== undefined) instance.actions.setGrouping(grouping)
  const props = (): SkillsSectionProps => ({
    t: translator(),
    useStore: bindSnapshotSelector(instance),
    actions: instance.actions,
    load: async () => sources,
    setSource: async () => undefined,
    setSkill: async () => undefined,
    addFolder: async () => 'added',
    removeFolder: async () => undefined,
    ...installStubs(),
    ...overrides,
  })
  return { store, props }
}

/**
 * Mount the tab over one store instance, so remounts keep its state. Source mode
 * is the pre-category layout most specs describe; a spec that covers the
 * category board passes `'categories'` or mounts through {@link mountDefault}.
 */
function mount(overrides: FaceStub = {}, sources: readonly LocalSourceView[] = SOURCES, grouping: SkillsGrouping = 'sources'): {
  readonly store: SkillsStoreHandle
  readonly props: () => SkillsSectionProps
  readonly view: ReturnType<typeof render>
} {
  const mounted = catalogProps(overrides, sources, grouping)
  return { ...mounted, view: render(<SkillsSection {...mounted.props()} />) }
}

/** Mount without presetting the store, so the tab's own default grouping applies. */
function mountDefault(overrides: FaceStub = {}, sources: readonly LocalSourceView[] = CATEGORY_SOURCES): {
  readonly store: SkillsStoreHandle
  readonly props: () => SkillsSectionProps
  readonly view: ReturnType<typeof render>
} {
  const mounted = catalogProps(overrides, sources)
  return { ...mounted, view: render(<SkillsSection {...mounted.props()} />) }
}

/** Sessions state whose single retained main-view Session lives in `cwd`. */
function sessionsAt(cwd: string): NonNullable<SkillsSectionProps['useSessions']> {
  return selector => selector({ byId: { current: { retainedBy: { mainView: 1 }, cwd } } })
}

/** The switch of one skill row, by the name and state it states. */
function skillSwitch(name: string, state: 'on' | 'off'): HTMLElement {
  return screen.getByRole('switch', { name: `Skill ${name}: ${state}` })
}

describe('SkillsSection rows', () => {
  it('renders each skill as catalog columns with its mark, source, state, and switch', async () => {
    mount()
    await screen.findByText('app-skill')

    // Application names come from the dictionary, not from the Host's raw title.
    expect(screen.getByRole('button', { name: 'Claude Code' })).toBeTruthy()
    expect(screen.getAllByText('Other application').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Helps with apps and other long descriptions that keep going past the second line')).toHaveLength(1)
    expect(screen.getAllByText('Enabled').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Off').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Overridden').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Error')).toHaveLength(2)
    // An overridden row says which source wins; the invalid rows explain themselves.
    expect(screen.getByText('Overridden by ~/.dsh folders')).toBeTruthy()
    expect(screen.getByText('Frontmatter cannot be read')).toBeTruthy()
    expect(screen.getByText('Frontmatter error: missing YAML frontmatter')).toBeTruthy()
    expect(skillSwitch('app-skill', 'on').getAttribute('aria-checked')).toBe('true')
    expect(skillSwitch('off-skill', 'off').getAttribute('aria-checked')).toBe('false')
    // A rejected row has no parsed name, so no switch can address it.
    // A rejected skill is named by the folder that holds it, not by its whole path.
    expect(screen.getAllByText('broken').length).toBeGreaterThan(0)
    expect(screen.queryByRole('switch', { name: /broken/u })).toBeNull()
    expect(screen.getByText('9 shown · 4 on')).toBeTruthy()
  })

  it('disables a skill switch when its source is off and a shadowed skill that lost the name', async () => {
    mount()
    await screen.findByText('app-skill')
    expect(skillSwitch('paused-skill', 'off')).toHaveProperty('disabled', true)
    // An overridden skill is on but the model sees another copy, so its switch is inert.
    expect(skillSwitch('dup-skill', 'on')).toHaveProperty('disabled', true)
  })

  it('catalogs only sources that offer a skill, and keeps an empty added folder removable', async () => {
    mount()
    await screen.findByText('app-skill')
    // A source with no skill is not a catalog entry: Codex and a configured
    // application with an empty folder are absent from the board.
    expect(screen.queryByRole('button', { name: 'Codex' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Zebra' })).toBeNull()
    expect(screen.queryByText('This source has no skills')).toBeNull()
    // A source that has skills keeps its kind, folder, count and source switch.
    const paused = screen.getByRole('button', { name: 'Paused source' }).closest('section')
    if (paused === null) throw new Error('expected the paused group')
    expect(within(paused).getByText('Harness folders')).toBeTruthy()
    expect(within(paused).getByText('~\\.paused\\skills')).toBeTruthy()
    expect(within(paused).getByRole('switch', { name: 'Source Paused source: off' })).toHaveProperty('disabled', false)
    // An added folder is a line glyph, its own kind, and a remove control.
    expect(screen.getAllByText('Your folder').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Remove folder skills' })).toBeTruthy()
    // The added folder that holds no skill is hidden from the board but still removable.
    expect(screen.getByText('Folders without skills')).toBeTruthy()
    expect(screen.getByText('D:\\')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove folder D:\\' })).toBeTruthy()
    // A folder that vanished while listed is explained here, once.
    expect(screen.getByText('Folder not found')).toBeTruthy()
  })

  it('expands and collapses a description in place', async () => {
    mount()
    await screen.findByText('app-skill')
    const toggle = screen.getAllByRole('button', { name: 'Show full description' })[0]
    if (toggle === undefined) throw new Error('expected a description toggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    const collapse = screen.getAllByRole('button', { name: 'Show less' })[0]
    if (collapse === undefined) throw new Error('expected the expanded toggle')
    expect(collapse.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(collapse)
    expect(screen.getAllByRole('button', { name: 'Show full description' }).length).toBeGreaterThan(0)
  })

  it('names a rejected skill by the folder that holds it', async () => {
    const rejected: LocalSourceView = {
      id: 'rejected', kind: 'harness', title: 'rejected', path: '~\\.dsh\\skills', displayPath: '~\\.dsh\\skills',
      exists: true, enabled: true,
      skills: [
        { path: '~\\.dsh\\skills\\bundled\\SKILL.md', displayPath: '~\\.dsh\\skills\\bundled\\SKILL.md', status: 'invalid', error: 'no frontmatter' },
        { path: 'D:\\skills\\flat-skill.md', displayPath: 'D:\\skills\\flat-skill.md', status: 'invalid', error: 'no frontmatter' },
        { path: 'single-step.md', status: 'invalid', error: 'no frontmatter' },
        { path: '\\\\', status: 'invalid', error: 'no frontmatter' },
      ],
    }
    mount({}, [rejected])
    // A bundle is named by its folder and a flat file by its file name.
    expect(await screen.findByText('bundled')).toBeTruthy()
    expect(screen.getByText('flat-skill.md')).toBeTruthy()
    expect(screen.getByText('single-step.md')).toBeTruthy()
  })

  it('draws one mark per source kind', async () => {
    const skill = (name: string): LocalSkillView => ({ name, path: `skills/${name}/SKILL.md`, status: 'available' })
    const byKind: LocalSourceView[] = [
      { id: 'zeta', kind: 'application', title: 'Zeta', path: '~\\.zeta\\skills', displayPath: '~\\.zeta\\skills', exists: true, enabled: true, skills: [skill('zeta-skill')] },
      { id: 'claude', kind: 'application', applicationId: 'claude-code', title: 'Claude', path: '~\\.claude\\skills', displayPath: '~\\.claude\\skills', exists: true, enabled: true, skills: [skill('claude-skill')] },
      { id: 'harness', kind: 'harness', title: 'harness', path: '~\\.dsh\\skills', displayPath: '~\\.dsh\\skills', exists: true, enabled: true, skills: [skill('harness-skill')] },
      { id: 'folder:skills', kind: 'folder', title: 'skills', path: 'D:\\skills', displayPath: 'D:\\skills', exists: true, enabled: true, skills: [skill('folder-skill')] },
    ]
    const { view } = mount({}, byKind)
    await screen.findByText('zeta-skill')
    // An application without a configured id falls back to the first letter of its id,
    // a configured one to its known monogram, harness folders to the home glyph.
    const glyphs = [...view.container.querySelectorAll('[class*="monogram"]')].map(node => node.textContent)
    expect(glyphs).toEqual(expect.arrayContaining(['Z', 'C', '~']))
    // An added folder draws the neutral line glyph instead of a letter.
    expect(view.container.querySelectorAll('[class*="line"]').length).toBeGreaterThan(0)
  })

  it('removes an added folder that holds no skill from the quiet line', async () => {
    const removed: string[] = []
    mount({ removeFolder: async (path) => { removed.push(path) } })
    await screen.findByText('app-skill')
    const remove = screen.getByRole('button', { name: 'Remove folder D:\\' })
    fireEvent.click(remove)
    await vi.waitFor(() => { expect(removed).toEqual(['D:\\']) })
  })

  it('disables that removal while its write is in flight', async () => {
    let settle: (() => void) | undefined
    mount({ removeFolder: () => new Promise<string | undefined>((resolve) => { settle = () => { resolve(undefined) } }) })
    await screen.findByText('app-skill')
    fireEvent.click(screen.getByRole('button', { name: 'Remove folder D:\\' }))
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove folder D:\\' })).toHaveProperty('disabled', true)
    })
    settle?.()
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove folder D:\\' })).toHaveProperty('disabled', false)
    })
  })

  it('paginates a long source', async () => {
    const many: LocalSourceView = {
      id: 'user-dsh', kind: 'harness', title: 'user-dsh', path: '~\\.dsh\\skills', displayPath: '~\\.dsh\\skills',
      exists: true, enabled: true,
      skills: Array.from({ length: 51 }, (_value, index) => ({
        name: `skill-${String(index)}`,
        path: `~\\.dsh\\skills\\skill-${String(index)}\\SKILL.md`,
        status: 'available' as const,
      })),
    }
    mount({}, [many])
    await screen.findByText('skill-0')
    expect(screen.queryByText('skill-50')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show more (1 left)' }))
    expect(screen.getByText('skill-50')).toBeTruthy()
  })
})

describe('SkillsSection groups and filters', () => {
  it('collapses a group and remembers it across remounts', async () => {
    const { props, view } = mount()
    await screen.findByText('app-skill')
    fireEvent.click(screen.getByRole('button', { name: 'Claude Code' }))
    await waitFor(() => { expect(screen.queryByText('app-skill')).toBeNull() })
    expect(screen.getByRole('button', { name: 'Claude Code' }).getAttribute('aria-expanded')).toBe('false')

    view.unmount()
    render(<SkillsSection {...props()} />)
    await screen.findByRole('button', { name: 'Claude Code' })
    expect(screen.queryByText('app-skill')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Claude Code' }))
    expect(await screen.findByText('app-skill')).toBeTruthy()
  })

  it('filters by source and by state, and clears both', async () => {
    mount()
    await screen.findByText('app-skill')
    fireEvent.click(screen.getByRole('button', { name: 'Filter by source' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Codex' }))
    await waitFor(() => { expect(screen.queryByText('app-skill')).toBeNull() })
    expect(screen.getByRole('button', { name: 'Filter by source' }).textContent).toContain('Codex')

    fireEvent.click(screen.getByRole('button', { name: 'Filter by state' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Enabled' }))
    // Codex exists nowhere and has no skills, so nothing matches both filters.
    expect(await screen.findByText('No skills match these filters')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(await screen.findByText('app-skill')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Filter by state' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Overridden' }))
    expect(await screen.findByText('dup-skill')).toBeTruthy()
    expect(screen.queryByText('app-skill')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Filter by state' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Any state' }))
    expect(await screen.findByText('app-skill')).toBeTruthy()
  })

  it('searches by name and description and offers a reset', async () => {
    mount()
    await screen.findByText('app-skill')
    const search = screen.getByRole('searchbox', { name: 'Search skills' })
    fireEvent.change(search, { target: { value: 'team' } })
    expect(screen.getByText('team-skill')).toBeTruthy()
    expect(screen.queryByText('app-skill')).toBeNull()
    fireEvent.change(search, { target: { value: 'helps' } })
    expect(screen.getByText('app-skill')).toBeTruthy()
    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(await screen.findByText('No matching skills')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(await screen.findByText('app-skill')).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: 'Search skills' })).toHaveProperty('value', '')
  })
})

describe('SkillsSection category grouping', () => {
  it('is the default view: largest category first, Other last, and no source controls', async () => {
    const { view } = mountDefault()
    await screen.findByText('alpha-video-one')

    // The grouping switch names both modes and marks the one on screen.
    expect(screen.getByRole('tab', { name: 'Categories' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Sources' }).getAttribute('aria-selected')).toBe('false')

    // A category is not a folder: the unmatched tile sits in Other, the last group.
    const titles = [...view.container.querySelectorAll('section[data-category] > div > button[aria-expanded]')]
      .map(node => node.textContent)
    expect(titles).toEqual(['Video and animation', 'Design and Figma', 'ckm', 'rawword', 'Other'])
    const videoSection = screen.getByRole('button', { name: 'Video and animation' }).closest('section')
    if (videoSection === null) throw new Error('expected the video section')
    // The header carries the count; each tile still names the source it came from.
    expect(within(videoSection).getByText('3')).toBeTruthy()
    expect(within(videoSection).getAllByText('Alpha')).toHaveLength(2)
    expect(within(videoSection).getAllByText('beta')).toHaveLength(1)
    // No source switch and no folder control appear in this mode.
    expect(screen.queryByRole('switch', { name: /^Source /u })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Remove folder /u })).toBeNull()
    // A folder that holds no skill stays reachable in source mode only.
    expect(screen.queryByText('Folders without skills')).toBeNull()
    expect(screen.getByText('7 shown · 6 on')).toBeTruthy()
  })

  it('remembers the chosen grouping across remounts', async () => {
    const { props, view } = mountDefault()
    await screen.findByText('alpha-video-one')
    fireEvent.click(screen.getByRole('tab', { name: 'Sources' }))
    expect(await screen.findByRole('switch', { name: 'Source Alpha: on' })).toBeTruthy()

    view.unmount()
    render(<SkillsSection {...props()} />)
    await screen.findByText('alpha-video-one')
    // Source mode came back, with the switch and folder controls it owns.
    expect(screen.getByRole('switch', { name: 'Source Alpha: on' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove folder beta' })).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Categories' }))
    await waitFor(() => { expect(screen.queryByRole('switch', { name: /^Source /u })).toBeNull() })
    expect(screen.getByRole('tab', { name: 'Categories' }).getAttribute('aria-selected')).toBe('true')
  })

  it('keeps the source and state filters and the search working', async () => {
    mount({}, CATEGORY_SOURCES, 'categories')
    await screen.findByText('alpha-video-one')
    fireEvent.click(screen.getByRole('button', { name: 'Filter by source' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'beta' }))
    await waitFor(() => { expect(screen.queryByText('alpha-video-one')).toBeNull() })
    expect(screen.getByText('beta-video')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Filter by state' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Off' }))
    expect(await screen.findByText('beta-off')).toBeTruthy()
    expect(screen.queryByText('beta-video')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Filter by state' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Any state' }))
    fireEvent.click(screen.getByRole('button', { name: 'Filter by source' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'All sources' }))
    expect(await screen.findByText('alpha-video-one')).toBeTruthy()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search skills' }), { target: { value: 'design' } })
    expect(await screen.findByText('alpha-design')).toBeTruthy()
    expect(screen.queryByText('alpha-video-one')).toBeNull()
  })

  it('shows the category beside the source in the detail panel', async () => {
    mount({}, CATEGORY_SOURCES, 'categories')
    await screen.findByText('alpha-video-one')
    fireEvent.click(screen.getByRole('button', { name: 'alpha-video-one' }))
    const panel = await screen.findByRole('complementary', { name: 'alpha-video-one' })
    expect(within(panel).getByText('Alpha')).toBeTruthy()
    expect(within(panel).getByText('Video and animation')).toBeTruthy()
  })

  it('collapses a category section and remembers it across remounts', async () => {
    const { props, view } = mount({}, CATEGORY_SOURCES, 'categories')
    await screen.findByText('alpha-video-one')
    fireEvent.click(screen.getByRole('button', { name: 'Video and animation' }))
    await waitFor(() => { expect(screen.queryByText('alpha-video-one')).toBeNull() })

    view.unmount()
    render(<SkillsSection {...props()} />)
    await screen.findByRole('button', { name: 'Video and animation' })
    expect(screen.queryByText('alpha-video-one')).toBeNull()
  })

  it('pages a category the same way a source pages', async () => {
    const many: LocalSourceView = {
      id: 'alpha', kind: 'harness', title: 'Alpha', path: '~\\alpha', displayPath: '~\\alpha', exists: true, enabled: true,
      skills: Array.from({ length: 51 }, (_value, index) => ({
        name: `skill-${String(index)}`,
        path: `~\\alpha\\skill-${String(index)}\\SKILL.md`,
        status: 'available' as const,
        category: 'video',
        categoryTitle: 'Video and animation',
      })),
    }
    mount({}, [many], 'categories')
    await screen.findByText('skill-0')
    expect(screen.queryByText('skill-50')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show more (1 left)' }))
    expect(screen.getByText('skill-50')).toBeTruthy()
  })
})

describe('SkillsSection detail panel', () => {
  it('opens the full record beside the list and closes from the same row', async () => {
    mount()
    await screen.findByText('app-skill')
    fireEvent.click(screen.getByRole('button', { name: 'app-skill' }))
    const panel = await screen.findByRole('complementary', { name: 'app-skill' })
    expect(within(panel).getByText('Claude Code')).toBeTruthy()
    expect(within(panel).getByText(/en-GB/u)).toBeTruthy()
    expect(within(panel).getByText('~\\.claude\\skills\\app-skill\\SKILL.md')).toBeTruthy()
    expect(within(panel).getByText('SKILL.md')).toBeTruthy()
    expect(within(panel).getByText(unitText(2, 'kilobyte'))).toBeTruthy()
    expect(within(panel).getByText(unitText(1.5, 'megabyte'))).toBeTruthy()
    expect(within(panel).getAllByText('scripts/audit.sh').length).toBeGreaterThan(0)
    expect(within(panel).getByText('Scripts: 1')).toBeTruthy()
    expect(within(panel).getByText('https://github.com/anthropics/skills')).toBeTruthy()
    expect(within(panel).getByText('2c5958e')).toBeTruthy()
    expect(within(panel).getByText(/Installed/u)).toBeTruthy()
    expect(within(panel).getByRole('button', { name: 'Copy path' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'app-skill' }))
    await waitFor(() => { expect(screen.queryByRole('complementary')).toBeNull() })
  })

  it('omits the language tag, file list, and origin it does not have', async () => {
    const sparse: LocalSourceView = {
      id: 'user-dsh', kind: 'harness', title: 'user-dsh', path: '~\\.dsh\\skills', displayPath: '~\\.dsh\\skills',
      exists: true, enabled: true,
      skills: [{
        name: 'plain-skill',
        path: '~\\.dsh\\skills\\plain\\SKILL.md',
        status: 'available',
        files: [{ path: 'SKILL.md', size: 512, isScript: false }],
        provenance: { url: 'owner/repo', installedAt: '2026-11-12T09:30:00Z' },
      }],
    }
    mount({}, [sparse])
    await screen.findByText('plain-skill')
    fireEvent.click(screen.getByRole('button', { name: 'plain-skill' }))
    const panel = await screen.findByRole('complementary', { name: 'plain-skill' })
    expect(within(panel).getByText('from SKILL.md')).toBeTruthy()
    expect(within(panel).getByText('No description')).toBeTruthy()
    expect(within(panel).queryByText('Scripts: 0')).toBeNull()
    expect(within(panel).queryByText(/ · /u)).toBeNull()
    expect(within(panel).getByText('owner/repo')).toBeTruthy()
    expect(within(panel).getByText(/Installed/u)).toBeTruthy()
  })

  it('shows no file or origin section for a skill the Host described without them', async () => {
    const bare: LocalSourceView = {
      id: 'user-dsh', kind: 'harness', title: 'user-dsh', path: '~\\.dsh\\skills', displayPath: '~\\.dsh\\skills',
      exists: true, enabled: true,
      skills: [{ name: 'bare-skill', path: '~\\.dsh\\skills\\bare\\SKILL.md', status: 'available', files: [] }],
    }
    mount({}, [bare])
    await screen.findByText('bare-skill')
    stubClipboard()
    fireEvent.click(screen.getByRole('button', { name: 'bare-skill' }))
    const panel = await screen.findByRole('complementary', { name: 'bare-skill' })
    expect(within(panel).queryByText('Files')).toBeNull()
    expect(within(panel).queryByText('Where it came from')).toBeNull()
    // Copying names the result once the host accepted the write.
    fireEvent.click(within(panel).getByRole('button', { name: 'Copy path' }))
    expect(await within(panel).findByRole('button', { name: 'Copied' })).toBeTruthy()
  })

  it('shows the record of a skill with no files and an origin that names no commit', async () => {
    mount()
    await screen.findByText('plain-team-skill')
    fireEvent.click(screen.getByRole('button', { name: 'plain-team-skill' }))
    const panel = await screen.findByRole('complementary', { name: 'plain-team-skill' })
    expect(within(panel).getByText('No description')).toBeTruthy()
    expect(within(panel).getByText('from SKILL.md')).toBeTruthy()
    expect(within(panel).queryByText('Files')).toBeNull()
    // The team skill has an origin without a commit, and no install date.
    fireEvent.click(screen.getByRole('button', { name: 'team-skill' }))
    const origin = await screen.findByRole('complementary', { name: 'team-skill' })
    expect(within(origin).getByText('anthropics/skills')).toBeTruthy()
    expect(within(origin).queryByText(/Installed/u)).toBeNull()
  })

  it('explains a skill whose frontmatter could not be read', async () => {
    const broken: LocalSourceView = {
      id: 'user-dsh', kind: 'harness', title: 'user-dsh', path: '~\\.dsh\\skills', displayPath: '~\\.dsh\\skills',
      exists: true, enabled: true,
      skills: [{ path: '~\\.dsh\\skills\\broken\\SKILL.md', status: 'invalid', error: 'missing YAML frontmatter' }],
    }
    mount({}, [broken])
    await screen.findByText('broken')
    // A rejected row has no name to open the panel with; its note carries the reason.
    expect(screen.getByText('Frontmatter error: missing YAML frontmatter')).toBeTruthy()
  })
})

describe('SkillsSection adding skills', () => {
  it('adds a typed folder, closes the dialog, and announces the new source', async () => {
    const addFolder = vi.fn(async () => 'added' as const)
    const { props } = mount({ addFolder })
    await screen.findByText('app-skill')
    fireEvent.click(screen.getByRole('button', { name: 'Add skills' }))
    const input = await screen.findByLabelText('Folder path')
    // The dialog marks its first control for the modal layer instead of stealing focus itself.
    expect(input.getAttribute('data-modal-autofocus')).toBe('true')
    expect(screen.getByRole('button', { name: 'Add' })).toHaveProperty('disabled', true)
    fireEvent.change(input, { target: { value: '  D:\\team\\skills  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => { expect(addFolder).toHaveBeenCalledWith('D:\\team\\skills') })
    await waitFor(() => { expect(screen.queryByLabelText('Folder path')).toBeNull() })
    expect((await screen.findByRole('status')).textContent).toBe(en.folderAddedHint)
    expect(props().load).toBeDefined()
  })

  it('submits with Enter and explains every refusal in place', async () => {
    const outcomes: AddFolderOutcome[] = ['exists', 'relative', 'missing', 'invalid', { error: 'host is gone' }]
    const addFolder = vi.fn(async () => outcomes.shift() ?? 'added')
    mount({ addFolder })
    await screen.findByText('app-skill')
    fireEvent.click(screen.getByRole('button', { name: 'Add skills' }))
    const input = await screen.findByLabelText('Folder path')
    fireEvent.change(input, { target: { value: 'skills' } })
    const form = input.closest('form')
    if (form === null) throw new Error('expected the folder form')
    fireEvent.submit(form)
    await screen.findByText('This folder is already in the list')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe('skills-folder-error')
    fireEvent.submit(form)
    await screen.findByText('Enter a full path, starting with a drive, / or ~')
    fireEvent.submit(form)
    await screen.findByText('No folder exists at this path')
    fireEvent.submit(form)
    await screen.findByText('Choose a local folder: network shares and device paths cannot be scanned')
    fireEvent.submit(form)
    await screen.findByText('Could not add the folder: host is gone')
    fireEvent.change(input, { target: { value: 'skills2' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('ignores an empty path, a second submit, and every close path while the write is in flight', async () => {
    let release: ((outcome: AddFolderOutcome) => void) | undefined
    const addFolder = vi.fn(() => new Promise<AddFolderOutcome>((resolve) => { release = resolve }))
    mount({ addFolder })
    await screen.findByText('app-skill')
    fireEvent.click(screen.getByRole('button', { name: 'Add skills' }))
    const input = await screen.findByLabelText('Folder path')
    const form = input.closest('form')
    if (form === null) throw new Error('expected the folder form')
    fireEvent.submit(form)
    expect(addFolder).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'D:\\one' } })
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(addFolder).toHaveBeenCalledTimes(1)
    // The write cannot be cancelled: the footer and the corner both wait for it.
    const [corner, footer] = screen.getAllByRole('button', { name: 'Cancel' })
    if (corner === undefined || footer === undefined) throw new Error('expected two Cancel buttons')
    expect(footer).toHaveProperty('disabled', true)
    fireEvent.click(corner)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByLabelText('Folder path')).not.toBeNull()
    await act(async () => { release?.('exists') })
    await screen.findByText('This folder is already in the list')
    fireEvent.click(footer)
    await waitFor(() => { expect(screen.queryByLabelText('Folder path')).toBeNull() })
  })

  it('fills the path from the chooser and reports a chooser failure', async () => {
    const picks: (string | null | Error)[] = ['D:\\picked', null, new Error('no display'), 'plain']
    const pickFolder = vi.fn(async () => {
      const next = picks.shift()
      if (next instanceof Error) throw next
      if (next === 'plain') throw 'chooser offline'
      return next ?? null
    })
    mount({ pickFolder })
    await screen.findByText('app-skill')
    fireEvent.click(screen.getByRole('button', { name: 'Add skills' }))
    const input = await screen.findByLabelText('Folder path')
    const browse = screen.getByRole('button', { name: 'Browse…' })
    fireEvent.click(browse)
    await waitFor(() => { expect((input as HTMLInputElement).value).toBe('D:\\picked') })
    fireEvent.click(browse)
    await waitFor(() => { expect(pickFolder).toHaveBeenCalledTimes(2) })
    expect((input as HTMLInputElement).value).toBe('D:\\picked')
    fireEvent.click(browse)
    await screen.findByText('Could not open the folder chooser: no display')
    fireEvent.click(browse)
    await screen.findByText('Could not open the folder chooser: chooser offline')
  })

  it('offers every way to add from the menu and opens the catalog', async () => {
    const createWithAi = vi.fn()
    mount({ createWithAi, catalogs: async () => ({ ok: true, value: [] }) })
    await screen.findByText('app-skill')
    const more = screen.getByRole('button', { name: 'Choose how to add' })
    fireEvent.click(more)
    expect(await screen.findByRole('menuitem', { name: /Add folder/u })).toBeTruthy()
    expect(await screen.findByRole('menuitem', { name: /Import archive/u })).toBeTruthy()
    fireEvent.click(await screen.findByRole('menuitem', { name: /Browse catalog/u }))
    const catalog = await screen.findByRole('dialog', { name: 'Skills catalog' })
    expect(within(catalog).getByText(en.catalogDescription)).toBeTruthy()
    const cancels = within(catalog).getAllByRole('button', { name: 'Cancel' })
    fireEvent.click(cancels[cancels.length - 1] as HTMLElement)
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Skills catalog' })).toBeNull() })

    fireEvent.click(more)
    fireEvent.click(await screen.findByRole('menuitem', { name: /Create with AI/u }))
    expect(createWithAi).toHaveBeenCalledTimes(1)
  })

  it('opens the add menu from the keyboard and adds a folder from it', async () => {
    mount()
    await screen.findByText('app-skill')
    const more = screen.getByRole('button', { name: 'Choose how to add' })
    // Other keys reach the page; only ArrowDown on the closed chevron opens the menu.
    fireEvent.keyDown(more, { key: 'ArrowUp' })
    expect(screen.queryByRole('menuitem')).toBeNull()
    fireEvent.keyDown(more, { key: 'ArrowDown' })
    fireEvent.keyDown(more, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /Add folder/u }))
    expect(await screen.findByLabelText('Folder path')).toBeTruthy()
    // The chevron toggles an open menu closed.
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByLabelText('Folder path')).toBeNull() })
    fireEvent.click(more)
    fireEvent.click(more)
    await waitFor(() => { expect(screen.queryByRole('menuitem')).toBeNull() })
  })

  it('ignores sessions without a main-view retainer', async () => {
    const load = vi.fn(async () => SOURCES)
    const { props } = catalogProps({ load })
    render(<SkillsSection {...props()} useSessions={selector => selector({ byId: { idle: { retainedBy: {} } } })} />)
    await screen.findByText('app-skill')
    expect(load).toHaveBeenCalledWith(undefined)
  })

  it('keeps AI creation unavailable without a workspace view', async () => {
    mount()
    await screen.findByText('app-skill')
    fireEvent.click(screen.getByRole('button', { name: 'Choose how to add' }))
    const item = await screen.findByRole('menuitem', { name: /Create with AI/u })
    expect(item.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText('A new chat cannot open from this page')).toBeTruthy()
  })

  it('removes an added folder', async () => {
    const removeFolder = vi.fn(async () => undefined)
    mount({ removeFolder })
    await screen.findByText('team-skill')
    fireEvent.click(screen.getByRole('button', { name: 'Remove folder skills' }))
    await waitFor(() => { expect(removeFolder).toHaveBeenCalledWith('D:\\team\\skills') })
  })
})

describe('SkillsSection empty state', () => {
  it('explains what a skill is and offers exactly three ways to add one', async () => {
    mount({}, [])
    await screen.findByText(en.emptyTitle)
    expect(screen.getByText(en.emptyBody)).toBeTruthy()
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Add folder' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Browse catalog' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create with AI' })).toHaveProperty('disabled', true)
    // The quiet row names what the tab reads and shows one mark per source.
    expect(screen.getByText(en.readsFrom)).toBeTruthy()
    expect(screen.getByText('C')).toBeTruthy()
    expect(screen.getByText('~')).toBeTruthy()
    expect(screen.getAllByText('G')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }))
    expect(await screen.findByLabelText('Folder path')).toBeTruthy()
    const folderCancels = screen.getAllByRole('button', { name: 'Cancel' })
    fireEvent.click(folderCancels[folderCancels.length - 1] as HTMLElement)
    await waitFor(() => { expect(screen.queryByLabelText('Folder path')).toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: 'Browse catalog' }))
    expect(await screen.findByRole('dialog', { name: 'Skills catalog' })).toBeTruthy()
  })

  it('starts the AI chat from the empty state when a workspace view exists', async () => {
    const createWithAi = vi.fn()
    mount({ createWithAi }, [])
    fireEvent.click(await screen.findByRole('button', { name: 'Create with AI' }))
    expect(createWithAi).toHaveBeenCalledTimes(1)
  })
})

describe('SkillsSection load and write states', () => {
  it('shows a skeleton of the catalog grid while the sources load', async () => {
    const pending: ((value: readonly LocalSourceView[]) => void)[] = []
    mount({ load: () => new Promise<readonly LocalSourceView[]>((resolve) => { pending.push(resolve) }) })
    expect(await screen.findByRole('status')).toHaveProperty('textContent', en.loading)
    expect(screen.getByRole('searchbox')).toBeTruthy()
    await act(async () => { pending[0]?.(SOURCES) })
    expect(await screen.findByText('app-skill')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('reports a failed first load in place and retries it', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('host is gone'))
      .mockRejectedValueOnce('plain text failure')
      .mockResolvedValue(SOURCES)
    mount({ load })
    expect(await screen.findByText('Could not read skills: host is gone')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Could not read skills: plain text failure')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('app-skill')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the described rows and says they are stale when a reload fails', async () => {
    const load = vi.fn()
      .mockResolvedValueOnce(SOURCES)
      .mockRejectedValueOnce(new Error('reload failed'))
    mount({ load, setSkill: async () => undefined })
    await screen.findByText('app-skill')
    fireEvent.click(skillSwitch('app-skill', 'on'))
    expect(await screen.findByText('Could not read skills: reload failed. This list may be out of date')).toBeTruthy()
    // The stale catalog stays usable.
    expect(screen.getByText('off-skill')).toBeTruthy()
  })

  it('names the switch a refused write could not save', async () => {
    mount({ setSource: async () => 'write refused' })
    await screen.findByText('app-skill')
    fireEvent.click(screen.getByRole('switch', { name: 'Source Claude Code: on' }))
    expect(await screen.findByText('Could not save Claude Code: write refused')).toBeTruthy()
  })

  it('holds a source and its skills while its write is in flight', async () => {
    let release: ((error: string | undefined) => void) | undefined
    const setSource = vi.fn(() => new Promise<string | undefined>((resolve) => { release = resolve }))
    mount({ setSource })
    await screen.findByText('app-skill')
    const sourceSwitch = screen.getByRole('switch', { name: 'Source Claude Code: on' })
    fireEvent.click(sourceSwitch)
    await waitFor(() => { expect(sourceSwitch).toHaveProperty('disabled', true) })
    // One source write locks every switch below it.
    expect(skillSwitch('app-skill', 'on')).toHaveProperty('disabled', true)
    await act(async () => { release?.(undefined) })
    await waitFor(() => { expect(sourceSwitch).toHaveProperty('disabled', false) })
  })

  it('holds a skill switch while its own write is in flight', async () => {
    let release: ((error: string | undefined) => void) | undefined
    const setSkill = vi.fn(() => new Promise<string | undefined>((resolve) => { release = resolve }))
    mount({ setSkill })
    await screen.findByText('app-skill')
    const skill = skillSwitch('app-skill', 'on')
    fireEvent.click(skill)
    await waitFor(() => { expect(skill).toHaveProperty('disabled', true) })
    await act(async () => { release?.(undefined) })
    await waitFor(() => { expect(skill).toHaveProperty('disabled', false) })
    expect(setSkill).toHaveBeenCalledWith('claude-code', 'app-skill', false)
  })

  it('reads the open session folder and drops a load the folder change superseded', async () => {
    const load = vi.fn(async () => SOURCES)
    const { props } = catalogProps({ load })
    const first = render(<SkillsSection {...props()} useSessions={sessionsAt('C:\\work')} />)
    await screen.findByText('app-skill')
    expect(load).toHaveBeenLastCalledWith('C:\\work')
    first.unmount()

    const pending: { resolve: (value: readonly LocalSourceView[]) => void; reject: (error: unknown) => void }[] = []
    const slowLoad = vi.fn(() => new Promise<readonly LocalSourceView[]>((resolve, reject) => { pending.push({ resolve, reject }) }))
    const view = render(<SkillsSection {...props()} load={slowLoad} useSessions={sessionsAt('C:\\old')} />)
    await waitFor(() => { expect(pending).toHaveLength(1) })
    view.rerender(<SkillsSection {...props()} load={slowLoad} useSessions={sessionsAt('C:\\new')} />)
    await waitFor(() => { expect(pending).toHaveLength(2) })
    const [oldLoad, newLoad] = pending
    if (oldLoad === undefined || newLoad === undefined) throw new Error('expected two loads')
    await act(async () => {
      newLoad.resolve(SOURCES)
      // A superseded response is dropped whether it succeeded or failed.
      oldLoad.resolve([])
      oldLoad.reject(new Error('old failure'))
    })
    await screen.findByText('app-skill')
    expect(screen.queryByText('Could not read skills: old failure')).toBeNull()
  })

  it('drops a rejection the folder change superseded', async () => {
    const pending: { resolve: (value: readonly LocalSourceView[]) => void; reject: (error: unknown) => void }[] = []
    const load = vi.fn(() => new Promise<readonly LocalSourceView[]>((resolve, reject) => { pending.push({ resolve, reject }) }))
    const { props } = catalogProps()
    const view = render(<SkillsSection {...props()} load={load} useSessions={sessionsAt('C:\\old')} />)
    await waitFor(() => { expect(pending).toHaveLength(1) })
    view.rerender(<SkillsSection {...props()} load={load} useSessions={sessionsAt('C:\\new')} />)
    await waitFor(() => { expect(pending).toHaveLength(2) })
    const [oldLoad, newLoad] = pending
    if (oldLoad === undefined || newLoad === undefined) throw new Error('expected two loads')
    await act(async () => {
      newLoad.resolve(SOURCES)
      oldLoad.reject(new Error('old failure'))
    })
    await screen.findByText('app-skill')
    expect(screen.queryByText('Could not read skills: old failure')).toBeNull()
  })

  it('opens no panel while a preselected skill is not described yet', async () => {
    const store = createSkillsStore()
    const instance = store.create()
    instance.actions.select('claude-code\u0000app-skill')
    const props: SkillsSectionProps = {
      t: translator(),
      useStore: bindSnapshotSelector(instance),
      actions: instance.actions,
      load: () => new Promise<readonly LocalSourceView[]>(() => {}),
      setSource: async () => undefined,
      setSkill: async () => undefined,
      addFolder: async () => 'added',
      removeFolder: async () => undefined,
      ...installStubs(),
    }
    render(<SkillsSection {...props} />)
    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('opens no panel for a remembered skill the reload no longer describes', async () => {
    const store = createSkillsStore()
    const instance = store.create()
    instance.actions.select('gone\u0000nowhere')
    const props: SkillsSectionProps = {
      t: translator(),
      useStore: bindSnapshotSelector(instance),
      actions: instance.actions,
      load: async () => SOURCES,
      setSource: async () => undefined,
      setSkill: async () => undefined,
      addFolder: async () => 'added',
      removeFolder: async () => undefined,
      ...installStubs(),
    }
    render(<SkillsSection {...props} />)
    expect(await screen.findByText('app-skill')).toBeTruthy()
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('falls back to a source id when a reload drops the filtered source', async () => {
    const alpha: LocalSourceView = {
      id: 'alpha', kind: 'harness', title: 'Alpha', path: '~\\alpha', displayPath: '~\\alpha', exists: true, enabled: true,
      skills: [{ name: 'alpha-skill', path: '~\\alpha\\alpha-skill\\SKILL.md', status: 'available' }],
    }
    const beta: LocalSourceView = {
      id: 'beta', kind: 'harness', title: 'Beta', path: '~\\beta', displayPath: '~\\beta', exists: true, enabled: true,
      skills: [{ name: 'beta-skill', path: '~\\beta\\beta-skill\\SKILL.md', status: 'available' }],
    }
    let described: readonly LocalSourceView[] = [alpha, beta]
    mount({ load: async () => described }, [alpha, beta])
    await screen.findByText('alpha-skill')
    fireEvent.click(screen.getByRole('button', { name: 'Filter by source' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Alpha' }))
    await waitFor(() => { expect(screen.queryByText('beta-skill')).toBeNull() })
    // The next reload describes only the other source, so the filter names the id it still holds.
    described = [beta]
    fireEvent.click(skillSwitch('alpha-skill', 'on'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Filter by source' }).textContent).toContain('alpha')
    })
  })
})

describe('SkillsSection toolbar', () => {
  it('refreshes the inventory and holds the action while the reload runs', async () => {
    const pending: ((value: readonly LocalSourceView[]) => void)[] = []
    const load = vi.fn()
      .mockResolvedValueOnce(SOURCES)
      .mockImplementationOnce(() => new Promise<readonly LocalSourceView[]>((resolve) => { pending.push(resolve) }))
    mount({ load })
    await screen.findByText('app-skill')
    const control = screen.getByRole('button', { name: 'Refresh' })
    expect(control).toHaveProperty('disabled', false)
    expect(control.getAttribute('aria-busy')).toBe('false')

    fireEvent.click(control)
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(2) })
    // A reload in flight says so and cannot be started twice.
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Refresh' }).getAttribute('aria-busy')).toBe('true')

    await act(async () => { pending[0]?.(SOURCES) })
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Refresh' })).toHaveProperty('disabled', false) })
    expect(screen.getByRole('button', { name: 'Refresh' }).getAttribute('aria-busy')).toBe('false')
  })

  it('keeps the refresh action inert until the first inventory answers', async () => {
    const pending: ((value: readonly LocalSourceView[]) => void)[] = []
    mount({ load: () => new Promise<readonly LocalSourceView[]>((resolve) => { pending.push(resolve) }) })
    expect(await screen.findByRole('button', { name: 'Refresh' })).toHaveProperty('disabled', true)

    await act(async () => { pending[0]?.(SOURCES) })
    await screen.findByText('app-skill')
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveProperty('disabled', false)
  })

  it('groups from the compact menu, naming the mode in effect', async () => {
    mountDefault()
    await screen.findByText('alpha-video-one')
    const control = screen.getByRole('button', { name: 'Choose grouping, current Categories' })
    expect(control.getAttribute('aria-haspopup')).toBe('menu')
    expect(control.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(control)
    expect(await screen.findByRole('menuitem', { name: 'Categories' })).toBeTruthy()
    // The open menu marks the mode the board is in and leaves the other unmarked.
    expect(screen.getByRole('menuitem', { name: 'Categories' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('menuitem', { name: 'Sources' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('button', { name: 'Choose grouping, current Categories' }).getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(screen.getByRole('menuitem', { name: 'Sources' }))
    expect(await screen.findByRole('switch', { name: 'Source Alpha: on' })).toBeTruthy()
    // The switch retires each mode it leaves, and its name states the new one.
    expect(screen.queryByRole('menuitem')).toBeNull()
    expect(screen.getByRole('button', { name: 'Choose grouping, current Sources' })).toBeTruthy()
  })
})

describe('SkillsSection importing and removing', () => {
  /** One confirmed preview of a repository skill. */
  const PREVIEW: InstallPreview = {
    id: 'preview-1',
    source: { kind: 'archive', fileName: 'pack.zip' },
    skills: [{
      name: 'pdf',
      description: 'Work with PDF files',
      document: '---\nname: pdf\n---\n',
      files: [{ path: 'SKILL.md', size: 20, isScript: false }],
      hasScripts: false,
      target: 'C:\\skills\\pdf',
      conflict: false,
    }],
  }

  /** The section element the drop handlers sit on. */
  async function tabSection(): Promise<HTMLElement> {
    const search = await screen.findByRole('searchbox')
    const section = search.closest('section')
    if (section === null) throw new Error('the tab section is missing')
    return section
  }

  it('previews a dropped archive before installing it', async () => {
    const previewArchive = vi.fn(async () => ({ ok: true as const, value: PREVIEW }))
    mount({ previewArchive })
    const section = await tabSection()
    fireEvent.dragOver(section)
    expect(screen.getByText(en.dropHint)).toBeTruthy()
    fireEvent.dragLeave(section)
    expect(screen.queryByText(en.dropHint)).toBeNull()
    fireEvent.drop(section, { dataTransfer: { files: [new File(['zip'], 'pack.zip')] } })
    await waitFor(() => { expect(previewArchive).toHaveBeenCalledWith('pack.zip', expect.any(String)) })
    expect(await screen.findByRole('dialog', { name: en.catalogTitle })).toBeTruthy()
  })

  it('states why a drop carried nothing to install', async () => {
    mount()
    fireEvent.drop(await tabSection(), { dataTransfer: {} })
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining(en.dropEmpty))
  })


  it('names a drop past the byte cap', async () => {
    mount()
    const big = new File([new Uint8Array(16 * 1024 * 1024 + 1)], 'big.zip')
    fireEvent.drop(await tabSection(), { dataTransfer: { files: [big] } })
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining(en.dropTooLarge))
  })

  it('names a drop past the file cap', async () => {
    mount()
    const many = Array.from({ length: 201 }, (_, index) => new File(['x'], `f${index}.md`))
    fireEvent.drop(await tabSection(), { dataTransfer: { files: many } })
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining(en.dropTooMany))
  })

  it('reads an archive chosen from the add menu', async () => {
    const previewArchive = vi.fn(async () => ({ ok: true as const, value: PREVIEW }))
    mount({ previewArchive })
    await screen.findByText('app-skill')
    fireEvent.click(screen.getByRole('button', { name: 'Choose how to add' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Import archive/u }))
    fireEvent.change(screen.getByLabelText(en.chooseArchive), {
      target: { files: [new File(['zip'], 'pack.zip')] },
    })
    await waitFor(() => { expect(previewArchive).toHaveBeenCalledWith('pack.zip', expect.any(String)) })
  })

  it('installs the preview the tab read and says so', async () => {
    const previewArchive = vi.fn(async () => ({ ok: true as const, value: PREVIEW }))
    const installSkill = vi.fn(async () => ({
      ok: true as const,
      value: { installed: [{ name: 'pdf', path: 'C:\\skills\\pdf', replaced: false }] },
    }))
    mount({ previewArchive, installSkill })
    fireEvent.drop(await tabSection(), { dataTransfer: { files: [new File(['zip'], 'pack.zip')] } })
    const dialog = await screen.findByRole('dialog', { name: en.catalogTitle })
    fireEvent.click(within(dialog).getByRole('button', { name: en.install }))
    await waitFor(() => { expect(installSkill).toHaveBeenCalledWith('preview-1', undefined, false) })
  })

  it('removes an installed skill after confirmation', async () => {
    const removeInstalled = vi.fn(async () => undefined)
    mount({ removeInstalled })
    fireEvent.click(await screen.findByRole('button', { name: 'app-skill' }))
    fireEvent.click(await screen.findByRole('button', { name: en.removeSkill }))
    const dialog = await screen.findByRole('dialog', { name: en.removeTitle.replace('{name}', 'app-skill') })
    fireEvent.click(within(dialog).getByRole('button', { name: en.remove }))
    await waitFor(() => { expect(removeInstalled).toHaveBeenCalledWith('app-skill') })
    expect(await screen.findByText(en.removedNotice.replace('{name}', 'app-skill'))).toBeTruthy()
  })

  it('names a skill the Host refused to remove', async () => {
    mount({ removeInstalled: async () => 'denied' })
    fireEvent.click(await screen.findByRole('button', { name: 'app-skill' }))
    fireEvent.click(await screen.findByRole('button', { name: en.removeSkill }))
    const dialog = await screen.findByRole('dialog', { name: en.removeTitle.replace('{name}', 'app-skill') })
    fireEvent.click(within(dialog).getByRole('button', { name: en.remove }))
    expect(await screen.findByText(en.writeFailed.replace('{name}', 'app-skill').replace('{error}', 'denied')))
      .toBeTruthy()
  })

  it('cancels a removal without touching the skill', async () => {
    const removeInstalled = vi.fn(async () => undefined)
    mount({ removeInstalled })
    fireEvent.click(await screen.findByRole('button', { name: 'app-skill' }))
    fireEvent.click(await screen.findByRole('button', { name: en.removeSkill }))
    const dialog = await screen.findByRole('dialog', { name: en.removeTitle.replace('{name}', 'app-skill') })
    const cancels = within(dialog).getAllByRole('button', { name: 'Cancel' })
    fireEvent.click(cancels[cancels.length - 1] as HTMLElement)
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(removeInstalled).not.toHaveBeenCalled()
  })


  it('imports a dropped folder of files', async () => {
    const previewFolder = vi.fn(async () => ({ ok: true as const, value: PREVIEW }))
    mount({ previewFolder })
    fireEvent.drop(await tabSection(), {
      dataTransfer: { files: [new File(['body'], 'SKILL.md')] },
    })
    await waitFor(() => {
      expect(previewFolder).toHaveBeenCalledWith('skill', [expect.objectContaining({ path: 'SKILL.md' })])
    })
  })

  it('states why an import preview was refused', async () => {
    mount({
      previewArchive: async () => ({ ok: false, failure: { code: 'skill-install/archive-invalid', message: 'bad' } }),
    })
    fireEvent.drop(await tabSection(), { dataTransfer: { files: [new File(['zip'], 'pack.zip')] } })
    expect(await screen.findByRole('alert')).toHaveProperty('textContent',
      expect.stringContaining(en.installArchiveInvalid))
  })

  it('ignores an empty archive choice', async () => {
    const previewArchive = vi.fn(async () => ({ ok: true as const, value: PREVIEW }))
    mount({ previewArchive })
    await screen.findByText('app-skill')
    fireEvent.change(screen.getByLabelText(en.chooseArchive), { target: { files: [] } })
    await waitFor(() => { expect(previewArchive).not.toHaveBeenCalled() })
  })

  it('closes the removal dialog from its close control', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'app-skill' }))
    fireEvent.click(await screen.findByRole('button', { name: en.removeSkill }))
    const dialog = await screen.findByRole('dialog', { name: en.removeTitle.replace('{name}', 'app-skill') })
    const cancels = within(dialog).getAllByRole('button', { name: 'Cancel' })
    fireEvent.click(cancels[0] as HTMLElement)
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('keeps the removal action out of a panel rendered without one', () => {
    const skill = SOURCES[0]?.skills[0]
    if (skill === undefined) throw new Error('the fixture skill is missing')
    render(<SkillDetail t={translator() as SkillsTranslate} sourceTitle="Claude Code" skill={skill} state="enabled" />)
    expect(screen.queryByRole('button', { name: en.removeSkill })).toBeNull()
  })

  it('offers no removal for a skill this app did not install', async () => {
    mount({}, [{
      id: 'user-dsh',
      kind: 'harness',
      title: 'user-dsh',
      path: '~\\.dsh\\skills',
      displayPath: '~\\.dsh\\skills',
      exists: true,
      enabled: true,
      skills: [{ name: 'local-skill', path: '~\\.dsh\\skills\\local-skill\\SKILL.md', status: 'available' }],
    }])
    fireEvent.click(await screen.findByRole('button', { name: 'local-skill' }))
    expect(screen.queryByRole('button', { name: en.removeSkill })).toBeNull()
  })
})
