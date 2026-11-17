// @vitest-environment jsdom
/**
 * Skills tab: catalog rows, the description block, groups and filters, the
 * detail panel, the add menu, and every load and write state.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { LocalSourceView } from '@deepseek-ai/dsh-skill-filesystem/types'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { SkillsSection, type AddFolderOutcome, type SkillsSectionProps } from '../src/client/SkillsSection.tsx'
import { createSkillsStore, type SkillsStoreHandle } from '../src/client/skills-store.ts'
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
  // An application the Host names by id only, and one it configured itself.
  {
    id: 'zebra', kind: 'application', title: 'Zebra', path: '~\\.zebra\\skills', displayPath: '~\\.zebra\\skills',
    exists: true, enabled: true, skills: [],
  },
  {
    id: 'nova', kind: 'application', applicationId: 'nova', title: 'Nova', path: '~\\.nova\\skills',
    displayPath: '~\\.nova\\skills', exists: true, enabled: true, skills: [],
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
}

/** Props of one tab instance over its own store. */
function catalogProps(overrides: FaceStub = {}, sources: readonly LocalSourceView[] = SOURCES): {
  readonly store: SkillsStoreHandle
  readonly props: () => SkillsSectionProps
} {
  const store = createSkillsStore()
  const instance = store.create()
  const props = (): SkillsSectionProps => ({
    t: translator(),
    useStore: bindSnapshotSelector(instance),
    actions: instance.actions,
    load: async () => sources,
    setSource: async () => undefined,
    setSkill: async () => undefined,
    addFolder: async () => 'added',
    removeFolder: async () => undefined,
    ...overrides,
  })
  return { store, props }
}

/** Mount the tab over one store instance, so remounts keep its state. */
function mount(overrides: FaceStub = {}, sources: readonly LocalSourceView[] = SOURCES): {
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
    expect(screen.getByText('~\\.claude\\skills\\broken\\SKILL.md')).toBeTruthy()
    expect(screen.queryByRole('switch', { name: /broken/u })).toBeNull()
    expect(screen.getByText('8 shown · 3 on')).toBeTruthy()
  })

  it('disables a skill switch when its source is off and a shadowed skill that lost the name', async () => {
    mount()
    await screen.findByText('app-skill')
    expect(skillSwitch('paused-skill', 'off')).toHaveProperty('disabled', true)
    // An overridden skill is on but the model sees another copy, so its switch is inert.
    expect(skillSwitch('dup-skill', 'on')).toHaveProperty('disabled', true)
  })

  it('groups carry their kind, folder, count, and the missing-folder state', async () => {
    mount()
    await screen.findByText('app-skill')
    const codex = screen.getByRole('button', { name: 'Codex' }).closest('section')
    if (codex === null) throw new Error('expected the Codex group')
    expect(within(codex).getByText('Folder not found')).toBeTruthy()
    expect(within(codex).getByText('~\\.codex\\skills')).toBeTruthy()
    expect(within(codex).getByRole('switch', { name: 'Source Codex: off' })).toHaveProperty('disabled', true)
    // An added folder is a line glyph, its own kind, and a remove control.
    expect(screen.getAllByText('Your folder').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Remove folder skills' })).toBeTruthy()
    // A source with no skills keeps its own explanation; a vanished folder is explained once, by its header.
    expect(within(codex).queryByText('This source has no skills')).toBeNull()
    expect(screen.getAllByText('This source has no skills').length).toBeGreaterThan(0)
    // A group with no title falls back to its folder.
    expect(screen.getByRole('button', { name: 'D:\\' })).toBeTruthy()
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

  it('marks applications the Host configured itself with their own initial', async () => {
    mount()
    await screen.findByText('app-skill')
    // Neither id maps to a shipped mark or a known monogram, so the first letter stands in.
    expect(screen.getByText('Z')).toBeTruthy()
    expect(screen.getByText('N')).toBeTruthy()
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
    await screen.findByText('~\\.dsh\\skills\\broken\\SKILL.md')
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

  it('offers the three ways to add from the menu and opens the catalog shell', async () => {
    const createWithAi = vi.fn()
    mount({ createWithAi })
    await screen.findByText('app-skill')
    const more = screen.getByRole('button', { name: 'Choose how to add' })
    fireEvent.click(more)
    expect(await screen.findByRole('menuitem', { name: /Add folder/u })).toBeTruthy()
    fireEvent.click(await screen.findByRole('menuitem', { name: /Browse catalog/u }))
    const catalog = await screen.findByRole('dialog', { name: 'Skills catalog' })
    expect(within(catalog).getByText(en.catalogPending)).toBeTruthy()
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
