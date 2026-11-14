// @vitest-environment jsdom
/** Skills tab: source groups, skill cards, switches, statuses, search, and pagination. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { LocalSourceView } from '@deepseek-ai/dsh-skill-filesystem/types'
import { SkillsSection, type AddFolderOutcome, type SkillsSectionProps } from '../src/client/SkillsSection.tsx'
import { en, type SkillsLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

/** The `skills` locale seat over the English dictionary. */
type Translate = (key: string, params?: Record<string, string>) => string

function translator(): Translate {
  return ((key: string, params?: Record<string, string>): string =>
    Object.entries(params ?? {}).reduce<string>((text, [name, value]) => text.replaceAll(`{${name}}`, value), en[key as SkillsLocaleKey]))
}

const SOURCES: readonly LocalSourceView[] = [
  {
    id: 'claude-code',
    kind: 'application',
    path: '~\\.claude\\skills',
    displayPath: '~\\.claude\\skills',
    title: 'Claude Code',
    exists: true,
    enabled: true,
    skills: [
      {
        name: 'app-skill',
        path: '~\\.claude\\skills\\app-skill\\SKILL.md',
        displayPath: '~\\.claude\\skills\\app-skill\\SKILL.md',
        description: 'Helps with apps',
        status: 'available',
      },
      {
        name: 'dup-skill',
        path: '~\\.claude\\skills\\dup-skill\\SKILL.md',
        displayPath: '~\\.claude\\skills\\dup-skill\\SKILL.md',
        status: 'available',
        shadowedBy: 'user-dsh',
      },
      {
        name: 'off-skill',
        path: '~\\.claude\\skills\\off-skill\\SKILL.md',
        displayPath: '~\\.claude\\skills\\off-skill\\SKILL.md',
        status: 'disabled',
        shadowedBy: 'user-dsh',
      },
      { path: '~\\.claude\\skills\\broken\\SKILL.md', displayPath: '~\\.claude\\skills\\broken\\SKILL.md', status: 'invalid', error: 'missing YAML frontmatter' },
    ],
  },
  { id: 'user-dsh', kind: 'harness', title: 'user-dsh', path: '~\\.dsh\\skills', displayPath: '~\\.dsh\\skills', exists: true, enabled: true, skills: [] },
  { id: 'codex', kind: 'application', title: 'Codex', path: '~\\.codex\\skills', displayPath: '~\\.codex\\skills', exists: false, enabled: false, skills: [] },
  {
    id: 'paused',
    kind: 'harness',
    title: 'Paused source',
    path: '~\\.paused\\skills',
    displayPath: '~\\.paused\\skills',
    exists: true,
    enabled: false,
    skills: [{ name: 'paused-skill', path: '~\\.paused\\skills\\paused-skill\\SKILL.md', status: 'available' }],
  },
]

/** Stub face over the fixture inventory. */
type FaceStub = {
  load?: () => Promise<readonly LocalSourceView[]>
  setSource?: (id: string, enabled: boolean) => Promise<string | undefined>
  setSkill?: (source: string, name: string, enabled: boolean) => Promise<string | undefined>
  addFolder?: (path: string) => Promise<AddFolderOutcome>
  removeFolder?: (path: string) => Promise<string | undefined>
  pickFolder?: () => Promise<string | null>
  createWithAi?: () => void
}

function props(overrides: FaceStub = {}): SkillsSectionProps {
  return {
    t: translator(),
    load: async () => SOURCES,
    setSource: async () => undefined,
    setSkill: async () => undefined,
    addFolder: async () => 'added',
    removeFolder: async () => undefined,
    ...overrides,
  } as SkillsSectionProps
}

/** An added folder as the Host describes it. */
const ADDED: LocalSourceView = {
  id: 'folder:D:\\team\\skills',
  kind: 'folder',
  title: 'skills',
  path: 'D:\\team\\skills',
  displayPath: 'D:\\team\\skills',
  exists: true,
  enabled: true,
  skills: [{ name: 'team-skill', path: 'D:\\team\\skills\\team-skill\\SKILL.md', status: 'available' }],
}

/** Open the Add folder dialog through the split button's primary half. */
async function openFolderDialog(): Promise<HTMLInputElement> {
  await screen.findByText('Claude Code')
  fireEvent.click(screen.getByRole('button', { name: 'Add skills' }))
  return await screen.findByLabelText('Folder path') as HTMLInputElement
}

/** Sessions state whose single retained main-view Session lives in `cwd`. */
function sessionsAt(cwd: string): NonNullable<SkillsSectionProps['useSessions']> {
  return selector => selector({ byId: { current: { retainedBy: { mainView: 1 }, cwd } } })
}

describe('SkillsSection', () => {
  it('groups sources with kind, folder, counts, and the missing-folder state', async () => {
    render(<SkillsSection {...props()} />)
    await screen.findByText('Claude Code')
    expect(screen.getAllByText('Other application')).toHaveLength(2)
    expect(screen.getByText('~\\.claude\\skills')).toBeTruthy()
    expect(screen.getByText('2 of 4 enabled')).toBeTruthy()
    expect(screen.getByText('0 of 1 enabled')).toBeTruthy()
    expect(screen.getByText('Folder not found')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Enable source Codex' })).toHaveProperty('disabled', true)
  })

  it('renders every skill as a card with its description, file, and discovery state', async () => {
    render(<SkillsSection {...props()} />)
    await screen.findByText('Helps with apps')
    expect(screen.getByText('~\\.claude\\skills\\app-skill\\SKILL.md')).toBeTruthy()
    expect(screen.getAllByText('Overridden by ~/.dsh folders')).toHaveLength(2)
    expect(screen.getByRole('switch', { name: 'Enable skill off-skill' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('Frontmatter error: missing YAML frontmatter')).toBeTruthy()
    // A rejected row has no parsed name: its path stands in the title and no switch can address it.
    expect(screen.getByText('~\\.claude\\skills\\broken\\SKILL.md')).toBeTruthy()
    expect(screen.queryByRole('switch', { name: 'Enable skill broken' })).toBeNull()
    // A source that is off disables its skills' switches.
    expect(screen.getByRole('switch', { name: 'Enable skill paused-skill' })).toHaveProperty('disabled', true)
  })

  it('writes source and skill switches through the face', async () => {
    const setSource = vi.fn(async () => undefined)
    const setSkill = vi.fn(async () => undefined)
    render(<SkillsSection {...props({ setSource, setSkill })} />)
    await screen.findByText('Claude Code')
    fireEvent.click(screen.getByRole('switch', { name: 'Enable source Claude Code' }))
    await waitFor(() => { expect(setSource).toHaveBeenCalledWith('claude-code', false) })
    fireEvent.click(screen.getByRole('switch', { name: 'Enable skill app-skill' }))
    await waitFor(() => { expect(setSkill).toHaveBeenCalledWith('claude-code', 'app-skill', false) })
  })

  it('holds a switch disabled while its write is in flight', async () => {
    let releaseSkill: ((error: string | undefined) => void) | undefined
    let releaseSource: ((error: string | undefined) => void) | undefined
    const setSkill = vi.fn(() => new Promise<string | undefined>((resolve) => { releaseSkill = resolve }))
    const setSource = vi.fn(() => new Promise<string | undefined>((resolve) => { releaseSource = resolve }))
    render(<SkillsSection {...props({ setSource, setSkill })} />)
    await screen.findByText('Claude Code')
    const skillSwitch = screen.getByRole('switch', { name: 'Enable skill app-skill' })
    fireEvent.click(skillSwitch)
    await waitFor(() => { expect(skillSwitch).toHaveProperty('disabled', true) })
    releaseSkill?.(undefined)
    await waitFor(() => { expect(skillSwitch).toHaveProperty('disabled', false) })
    const sourceSwitch = screen.getByRole('switch', { name: 'Enable source Claude Code' })
    fireEvent.click(sourceSwitch)
    await waitFor(() => { expect(sourceSwitch).toHaveProperty('disabled', true) })
    releaseSource?.(undefined)
    await waitFor(() => { expect(sourceSwitch).toHaveProperty('disabled', false) })
  })

  it('filters by name and description', async () => {
    render(<SkillsSection {...props()} />)
    await screen.findByText('Claude Code')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search skills' }), { target: { value: 'helps' } })
    expect(screen.getByText('Helps with apps')).toBeTruthy()
    expect(screen.queryByText('Paused source')).toBeNull()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search skills' }), { target: { value: 'nothing-matches' } })
    expect(screen.getByText('No matching skills')).toBeTruthy()
  })

  it('reports a reload that fails after a successful write', async () => {
    const responses: (readonly LocalSourceView[] | Error | string)[] = [
      SOURCES, 'reload failed', new Error('second reload failed'),
    ]
    const load = vi.fn(async () => {
      const next = responses.shift()
      if (next instanceof Error) throw next
      if (typeof next === 'string') throw next
      return next ?? SOURCES
    })
    render(<SkillsSection {...props({ load })} />)
    await screen.findByText('Claude Code')
    fireEvent.click(screen.getByRole('switch', { name: 'Enable skill app-skill' }))
    await screen.findByText('Could not read skills: reload failed')
    fireEvent.click(screen.getByRole('switch', { name: 'Enable skill dup-skill' }))
    await screen.findByText('Could not read skills: second reload failed')
  })

  it('passes the active session folder to the loader and reports failed reads', async () => {
    const load = vi.fn(async () => SOURCES)
    const view = render(<SkillsSection {...props({ load })} useSessions={selector => selector({
      byId: { current: { retainedBy: { mainView: 1 }, cwd: 'C:\\work' } },
    })} />)
    await screen.findByText('Claude Code')
    expect(load).toHaveBeenCalledWith('C:\\work')
    view.unmount()
    render(<SkillsSection {...props({ load: async () => { throw new Error('host is gone') } })} />)
    await screen.findByText('Could not read skills: host is gone')
  })

  it('drops a load that lands after the working directory changed', async () => {
    const pending: ((value: readonly LocalSourceView[]) => void)[] = []
    const load = vi.fn(() => new Promise<readonly LocalSourceView[]>((resolve) => { pending.push(resolve) }))
    const view = render(<SkillsSection {...props({ load })} useSessions={sessionsAt('C:\\old')} />)
    await waitFor(() => { expect(pending).toHaveLength(1) })
    view.rerender(<SkillsSection {...props({ load })} useSessions={sessionsAt('C:\\new')} />)
    await waitFor(() => { expect(pending).toHaveLength(2) })
    const [oldLoad, newLoad] = pending
    if (oldLoad === undefined || newLoad === undefined) throw new Error('expected two loads')
    await act(async () => {
      newLoad(SOURCES)
      oldLoad([])
    })
    await screen.findByText('Claude Code')
    expect(load).toHaveBeenLastCalledWith('C:\\new')
  })

  it('ignores a rejection that lands after the working directory changed', async () => {
    const pending: { resolve: (value: readonly LocalSourceView[]) => void; reject: (error: unknown) => void }[] = []
    const load = vi.fn(() => new Promise<readonly LocalSourceView[]>((resolve, reject) => { pending.push({ resolve, reject }) }))
    const view = render(<SkillsSection {...props({ load })} useSessions={sessionsAt('C:\\old')} />)
    await waitFor(() => { expect(pending).toHaveLength(1) })
    view.rerender(<SkillsSection {...props({ load })} useSessions={sessionsAt('C:\\new')} />)
    await waitFor(() => { expect(pending).toHaveLength(2) })
    const [oldLoad, newLoad] = pending
    if (oldLoad === undefined || newLoad === undefined) throw new Error('expected two loads')
    await act(async () => {
      newLoad.resolve(SOURCES)
      oldLoad.reject(new Error('old failure'))
    })
    await screen.findByText('Claude Code')
    expect(screen.queryByText('Could not read skills: old failure')).toBeNull()
  })

  it('ignores sessions without a main-view retainer', async () => {
    const load = vi.fn(async () => SOURCES)
    render(<SkillsSection {...props({ load })} useSessions={selector => selector({
      byId: { idle: { retainedBy: {} } },
    })} />)
    await screen.findByText('Claude Code')
    expect(load).toHaveBeenCalledWith(undefined)
  })

  it('reports a non-Error rejection', async () => {
    const load = vi.fn(async () => { throw 'plain text failure' })
    render(<SkillsSection {...props({ load })} />)
    await screen.findByText('Could not read skills: plain text failure')
  })

  it('covers empty sources, refused writes, and missing optional fields', async () => {
    const empty: LocalSourceView = {
      id: 'custom',
      kind: 'harness',
      title: 'custom',
      path: '~\\.custom',
      displayPath: '~\\.custom',
      exists: true,
      enabled: true,
      skills: [],
    }
    const minimal: LocalSourceView = {
      id: 'user-agents',
      kind: 'harness',
      title: 'user-agents',
      path: '~\\.agents\\skills',
      displayPath: '~\\.agents\\skills',
      exists: true,
      enabled: true,
      skills: [
        { name: 'plain-skill', path: '~\\.agents\\skills\\plain\\SKILL.md', status: 'available', shadowedBy: 'unknown-source' },
        { path: '~\\.agents\\skills\\bad\\SKILL.md', status: 'invalid' },
      ],
    }
    const setSource = vi.fn(async () => 'write refused')
    render(<SkillsSection {...props({ load: async () => [empty, minimal], setSource })} />)
    await screen.findByText('Additional folders')
    expect(screen.getByText('This source has no skills')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: 'Enable source Additional folders' }))
    await screen.findByText('Could not save the switch: write refused')
    expect(screen.getByText('Overridden by unknown-source')).toBeTruthy()
    expect(screen.getByText('~\\.agents\\skills\\plain\\SKILL.md')).toBeTruthy()
    expect(screen.getByText(/^Frontmatter error:/)).toBeTruthy()
  })

  it('paginates long skill lists', async () => {
    const many: LocalSourceView = {
      id: 'user-dsh',
      kind: 'harness',
      title: 'user-dsh',
      path: '~\\.dsh\\skills',
      displayPath: '~\\.dsh\\skills',
      exists: true,
      enabled: true,
      skills: Array.from({ length: 51 }, (_value, index) => ({
        name: `skill-${String(index)}`,
        path: `~\\.dsh\\skills\\skill-${String(index)}\\SKILL.md`,
        displayPath: `~\\.dsh\\skills\\skill-${String(index)}\\SKILL.md`,
        status: 'available' as const,
      })),
    }
    render(<SkillsSection {...props({ load: async () => [many] })} />)
    await screen.findByText('~/.dsh folders')
    expect(screen.getByText('Show more (1 left)')).toBeTruthy()
    expect(screen.queryByText('skill-50')).toBeNull()
    fireEvent.click(screen.getByText('Show more (1 left)'))
    expect(screen.getByText('skill-50')).toBeTruthy()
  })
})

describe('SkillsSection: adding skills', () => {
  it('adds a typed folder, closes the dialog, and reloads the sources', async () => {
    const addFolder = vi.fn(async () => 'added' as const)
    const load = vi.fn(async () => SOURCES)
    render(<SkillsSection {...props({ addFolder, load })} />)
    const input = await openFolderDialog()
    expect(screen.getByRole('button', { name: 'Add' })).toHaveProperty('disabled', true)
    fireEvent.change(input, { target: { value: '  D:\\team\\skills  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => { expect(addFolder).toHaveBeenCalledWith('D:\\team\\skills') })
    await waitFor(() => { expect(screen.queryByLabelText('Folder path')).toBeNull() })
    expect(load).toHaveBeenCalledTimes(2)
    // The folder arrives switched off, so the tab names the switch that applies it.
    expect((await screen.findByRole('status')).textContent).toBe(en.folderAddedHint)
  })

  it('clears the added-folder notice once the reader switches a source', async () => {
    const addFolder = vi.fn(async () => 'added' as const)
    render(<SkillsSection {...props({ addFolder })} />)
    const input = await openFolderDialog()
    fireEvent.change(input, { target: { value: 'D:\\team\\skills' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await screen.findByRole('status')
    fireEvent.click(screen.getByRole('switch', { name: 'Enable source Claude Code' }))
    await waitFor(() => { expect(screen.queryByRole('status')).toBeNull() })
  })

  it('submits with Enter and explains every refusal in the dialog', async () => {
    const outcomes: AddFolderOutcome[] = ['exists', 'relative', 'missing', 'invalid', { error: 'host is gone' }]
    const addFolder = vi.fn(async () => outcomes.shift() ?? 'added')
    render(<SkillsSection {...props({ addFolder })} />)
    const input = await openFolderDialog()
    fireEvent.change(input, { target: { value: 'skills' } })
    const form = input.closest('form')
    if (form === null) throw new Error('expected the folder form')
    fireEvent.submit(form)
    await screen.findByText('This folder is already in the list')
    fireEvent.submit(form)
    await screen.findByText('Enter a full path, starting with a drive, / or ~')
    fireEvent.submit(form)
    await screen.findByText('No folder exists at this path')
    fireEvent.submit(form)
    await screen.findByText('Choose a local folder: network shares and device paths cannot be scanned')
    fireEvent.submit(form)
    await screen.findByText('Could not add the folder: host is gone')
    // Typing again clears the explanation.
    fireEvent.change(input, { target: { value: 'skills2' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('ignores an empty path and a second submit while the first is pending', async () => {
    let release: ((outcome: AddFolderOutcome) => void) | undefined
    const addFolder = vi.fn(() => new Promise<AddFolderOutcome>((resolve) => { release = resolve }))
    render(<SkillsSection {...props({ addFolder })} />)
    const input = await openFolderDialog()
    const form = input.closest('form')
    if (form === null) throw new Error('expected the folder form')
    fireEvent.submit(form)
    expect(addFolder).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'D:\\one' } })
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(addFolder).toHaveBeenCalledTimes(1)
    await act(async () => { release?.('exists') })
    await screen.findByText('This folder is already in the list')
  })

  it('fills the path from the folder chooser and reports a chooser failure', async () => {
    const picks: (string | null | Error)[] = ['D:\\picked', null, new Error('no display'), 'plain']
    const pickFolder = vi.fn(async () => {
      const next = picks.shift()
      if (next instanceof Error) throw next
      if (next === 'plain') throw 'chooser offline'
      return next ?? null
    })
    render(<SkillsSection {...props({ pickFolder })} />)
    const input = await openFolderDialog()
    const browse = screen.getByRole('button', { name: 'Browse…' })
    fireEvent.click(browse)
    await waitFor(() => { expect(input.value).toBe('D:\\picked') })
    fireEvent.click(browse)
    await waitFor(() => { expect(pickFolder).toHaveBeenCalledTimes(2) })
    expect(input.value).toBe('D:\\picked')
    fireEvent.click(browse)
    await screen.findByText('Could not open the folder chooser: no display')
    fireEvent.click(browse)
    await screen.findByText('Could not open the folder chooser: chooser offline')
  })

  it('offers no Browse button without a chooser and closes from the footer and the corner', async () => {
    render(<SkillsSection {...props()} />)
    await openFolderDialog()
    expect(screen.queryByRole('button', { name: 'Browse…' })).toBeNull()
    // The footer action and the dialog's corner close button share the Cancel label.
    const [corner, footer] = screen.getAllByRole('button', { name: 'Cancel' })
    if (corner === undefined || footer === undefined) throw new Error('expected two Cancel buttons')
    fireEvent.click(footer)
    await waitFor(() => { expect(screen.queryByLabelText('Folder path')).toBeNull() })
    await openFolderDialog()
    const [reopenedCorner] = screen.getAllByRole('button', { name: 'Cancel' })
    if (reopenedCorner === undefined) throw new Error('expected the corner close button')
    fireEvent.click(reopenedCorner)
    await waitFor(() => { expect(screen.queryByLabelText('Folder path')).toBeNull() })
  })

  it('offers both ways to add from the menu and starts the AI chat', async () => {
    const createWithAi = vi.fn()
    render(<SkillsSection {...props({ createWithAi })} />)
    await screen.findByText('Claude Code')
    const more = screen.getByRole('button', { name: 'Choose how to add' })
    fireEvent.keyDown(more, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /Create with AI/u }))
    expect(createWithAi).toHaveBeenCalledTimes(1)
    fireEvent.click(more)
    fireEvent.click(await screen.findByRole('menuitem', { name: /Add folder/u }))
    expect(await screen.findByLabelText('Folder path')).toBeTruthy()
  })

  it('keeps an already open menu on ArrowDown and disables AI creation without a workspace', async () => {
    render(<SkillsSection {...props()} />)
    await screen.findByText('Claude Code')
    const more = screen.getByRole('button', { name: 'Choose how to add' })
    fireEvent.click(more)
    fireEvent.keyDown(more, { key: 'ArrowDown' })
    fireEvent.keyDown(more, { key: 'Enter' })
    const item = await screen.findByRole('menuitem', { name: /Create with AI/u })
    expect(item.getAttribute('aria-disabled') === 'true' || (item as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('A new chat cannot open from this page')).toBeTruthy()
  })

  it('marks an added folder and removes it from the list', async () => {
    const removeFolder = vi.fn(async () => undefined)
    const untitled: LocalSourceView = { ...ADDED, id: 'folder:D:\\', title: '', path: 'D:\\', displayPath: 'D:\\', skills: [] }
    render(<SkillsSection {...props({ load: async () => [ADDED, untitled], removeFolder })} />)
    await screen.findByText('team-skill')
    expect(screen.getAllByText('Your folder')).toHaveLength(2)
    // A drive root has no last segment, so its path names the group.
    expect(screen.getByRole('heading', { name: 'D:\\' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove folder skills' }))
    await waitFor(() => { expect(removeFolder).toHaveBeenCalledWith('D:\\team\\skills') })
    expect(screen.queryByRole('button', { name: 'Remove folder Claude Code' })).toBeNull()
  })
})
