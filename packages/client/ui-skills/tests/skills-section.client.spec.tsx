// @vitest-environment jsdom
/** Skills tab: source rows, switches, statuses, search, and pagination. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

describe('SkillsSection', () => {
  it('lists sources with kind, shortened path, counts, and the missing-folder state', async () => {
    render(<SkillsSection {...props()} />)
    await screen.findByText('Claude Code')
    expect(screen.getAllByText('Other application')).toHaveLength(2)
    expect(screen.getByText('~\\.claude\\skills')).toBeTruthy()
    expect(screen.getByText('2 of 4 enabled')).toBeTruthy()
    expect(screen.getByText('Folder not found')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Enable source Codex' })).toHaveProperty('disabled', true)
  })

  it('expands a source and reports duplicate, disabled, and frontmatter states', async () => {
    render(<SkillsSection {...props()} />)
    await screen.findByText('Claude Code')
    fireEvent.click(screen.getByRole('button', { name: 'Claude Code' }))
    expect(screen.getByText('Helps with apps')).toBeTruthy()
    expect(screen.getAllByText('Overridden by ~/.dsh folders')).toHaveLength(2)
    expect(screen.getByRole('switch', { name: 'Enable skill off-skill' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('Frontmatter error: missing YAML frontmatter')).toBeTruthy()
  })

  it('writes source and skill switches through the face', async () => {
    const setSource = vi.fn(async () => undefined)
    const setSkill = vi.fn(async () => undefined)
    render(<SkillsSection {...props({ setSource, setSkill })} />)
    await screen.findByText('Claude Code')
    fireEvent.click(screen.getByRole('switch', { name: 'Enable source Claude Code' }))
    await waitFor(() => { expect(setSource).toHaveBeenCalledWith('claude-code', false) })
    fireEvent.click(screen.getByRole('button', { name: 'Claude Code' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Enable skill app-skill' }))
    await waitFor(() => { expect(setSkill).toHaveBeenCalledWith('claude-code', 'app-skill', false) })
  })

  it('filters by name and description', async () => {
    render(<SkillsSection {...props()} />)
    await screen.findByText('Claude Code')
    fireEvent.click(screen.getByRole('button', { name: 'Claude Code' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search skills' }), { target: { value: 'helps' } })
    expect(screen.getByText('Helps with apps')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search skills' }), { target: { value: 'nothing-matches' } })
    expect(screen.getByText('No matching skills')).toBeTruthy()
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

  it('ignores sessions without a main-view retainer', async () => {
    const load = vi.fn(async () => SOURCES)
    render(<SkillsSection {...props({ load })} useSessions={selector => selector({
      byId: { idle: { retainedBy: {} } },
    })} />)
    await screen.findByText('Claude Code')
    expect(load).toHaveBeenCalledWith(undefined)
  })

  it('reports a non-Error rejection and collapses an expanded source', async () => {
    const load = vi.fn(async () => { throw 'plain text failure' })
    render(<SkillsSection {...props({ load })} />)
    await screen.findByText('Could not read skills: plain text failure')
    render(<SkillsSection {...props()} />)
    await screen.findByText('Claude Code')
    const disclosure = screen.getByRole('button', { name: 'Claude Code' })
    fireEvent.click(disclosure)
    expect(screen.getByText('Helps with apps')).toBeTruthy()
    fireEvent.click(disclosure)
    expect(screen.queryByText('Helps with apps')).toBeNull()
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
    fireEvent.click(screen.getByRole('button', { name: 'Additional folders' }))
    expect(screen.getByText('This source has no skills')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: 'Enable source Additional folders' }))
    await screen.findByText('Could not read skills: write refused')
    fireEvent.click(screen.getByRole('button', { name: '~/.agents folders' }))
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
    fireEvent.click(screen.getByRole('button', { name: '~/.dsh folders' }))
    expect(screen.getByText('Show more (1 left)')).toBeTruthy()
    expect(screen.queryByText('skill-50')).toBeNull()
    fireEvent.click(screen.getByText('Show more (1 left)'))
    expect(screen.getByText('skill-50')).toBeTruthy()
  })
})
