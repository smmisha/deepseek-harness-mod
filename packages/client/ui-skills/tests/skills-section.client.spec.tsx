// @vitest-environment jsdom
/** Skills tab: source groups, skill cards, switches, statuses, search, and pagination. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { LocalSourceView } from '@deepseek-ai/dsh-skill-filesystem/types'
import { SkillsSection, type SkillsSectionProps } from '../src/client/SkillsSection.tsx'
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
}

function props(overrides: FaceStub = {}): SkillsSectionProps {
  return {
    t: translator(),
    load: async () => SOURCES,
    setSource: async () => undefined,
    setSkill: async () => undefined,
    ...overrides,
  } as SkillsSectionProps
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
