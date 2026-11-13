// @vitest-environment jsdom
/** The browser half: dictionaries, Remote face, folder chooser, AI chat, and the `plugins.tab` declaration. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import * as nodeHalf from '../src/index.ts'

/** Rows the fake Host namespace answers with. */
const ROWS = [{ id: 'user-dsh', kind: 'harness', title: 'user-dsh', path: '~\\.dsh\\skills', displayPath: '~\\.dsh\\skills', exists: true, enabled: true, skills: [] }]

type Refusal = { ok: false; error: { message: string } }

type RemoteResults = {
  describe: { ok: true; value: typeof ROWS } | Refusal
  setSource: { ok: true } | Refusal
  setSkill: { ok: true } | Refusal
  addFolder: { ok: true; value: string } | Refusal
  removeFolder: { ok: true } | Refusal
}

/** The face the tab receives, as far as these tests call it. */
type Face = {
  load: (cwd?: string) => Promise<unknown>
  setSource: (id: string, enabled: boolean) => Promise<string | undefined>
  setSkill: (source: string, name: string, enabled: boolean) => Promise<string | undefined>
  addFolder: (path: string) => Promise<unknown>
  removeFolder: (path: string) => Promise<string | undefined>
  pickFolder?: () => Promise<string | null>
  createWithAi?: () => void
}

const OK: RemoteResults = {
  describe: { ok: true, value: ROWS },
  setSource: { ok: true },
  setSkill: { ok: true },
  addFolder: { ok: true, value: 'added' },
  removeFolder: { ok: true },
}

const REFUSED: RemoteResults = {
  describe: { ok: false, error: { message: 'describe refused' } },
  setSource: { ok: false, error: { message: 'source refused' } },
  setSkill: { ok: false, error: { message: 'skill refused' } },
  addFolder: { ok: false, error: { message: 'folder refused' } },
  removeFolder: { ok: false, error: { message: 'removal refused' } },
}

/** A workspace view that records the chats and chooser calls it receives. */
function makeWorkspace() {
  return {
    startSession: vi.fn(),
    pickDirectory: vi.fn(async () => 'D:\\from-host'),
  }
}

/** Build a fake browser context that records the slot contribution. */
function makeContext(results: RemoteResults, workspace?: ReturnType<typeof makeWorkspace>) {
  const register = vi.fn()
  const effect = vi.fn((callback: () => unknown) => callback())
  const locale = {
    register: vi.fn(),
    bind: vi.fn(() => (key: string) => key),
  }
  const skillSources = {
    describe: vi.fn(async () => results.describe),
    setSource: vi.fn(async () => results.setSource),
    setSkill: vi.fn(async () => results.setSkill),
    addFolder: vi.fn(async () => results.addFolder),
    removeFolder: vi.fn(async () => results.removeFolder),
  }
  const slots = {
    inject: vi.fn((_name: string, contribute: () => unknown) => contribute()),
    register,
  }
  const get = vi.fn((name: string) => name === 'uiWorkspace' ? workspace : undefined)
  const ctx = { effect, locale, remote: { skillSources }, slots, get }
  apply(ctx as never)
  const declaration = (register.mock.calls[0] as [Record<string, unknown>, unknown])[0]
  const face = (): Face => (declaration.inject as () => Face)()
  return { register, effect, locale, skillSources, declaration, face }
}

afterEach(() => {
  delete (globalThis as { __DSH_DIRECTORY_PICKER__?: unknown }).__DSH_DIRECTORY_PICKER__
})

describe('ui-skills browser half', () => {
  it('declares the tab and forwards the face to the Host namespace', async () => {
    const { register, effect, locale, skillSources, declaration, face } = makeContext(OK)
    expect(effect).toHaveBeenCalledTimes(1)
    expect(locale.register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledTimes(1)
    expect(register.mock.calls[0]?.[1]).toBeDefined()
    expect(declaration.name).toBe('plugins.tab')
    expect(declaration.id).toBe('skills')
    expect(declaration.locale).toBe('skills')
    expect((declaration.label as () => string)()).toBe('title')
    const current = face()
    await expect(current.load('C:\\work')).resolves.toEqual(ROWS)
    expect(skillSources.describe).toHaveBeenCalledWith('C:\\work')
    await expect(current.setSource('user-dsh', false)).resolves.toBeUndefined()
    await expect(current.setSkill('user-dsh', 'review', false)).resolves.toBeUndefined()
    await expect(current.addFolder('D:\\skills')).resolves.toBe('added')
    expect(skillSources.addFolder).toHaveBeenCalledWith('D:\\skills')
    await expect(current.removeFolder('D:\\skills')).resolves.toBeUndefined()
    expect(skillSources.removeFolder).toHaveBeenCalledWith('D:\\skills')
  })

  it('turns refused writes and failed reads into messages', async () => {
    const current = makeContext(REFUSED).face()
    await expect(current.load()).rejects.toThrow('describe refused')
    await expect(current.setSource('user-dsh', false)).resolves.toBe('source refused')
    await expect(current.setSkill('user-dsh', 'review', false)).resolves.toBe('skill refused')
    await expect(current.addFolder('D:\\skills')).resolves.toEqual({ error: 'folder refused' })
    await expect(current.removeFolder('D:\\skills')).resolves.toBe('removal refused')
  })

  it('offers neither the chooser nor AI creation without a workspace view', () => {
    const current = makeContext(OK).face()
    expect(current.pickFolder).toBeUndefined()
    expect(current.createWithAi).toBeUndefined()
  })

  it('picks through the Host and opens a chat whose draft asks for a skill', async () => {
    const workspace = makeWorkspace()
    const current = makeContext(OK, workspace).face()
    await expect(current.pickFolder?.()).resolves.toBe('D:\\from-host')
    current.createWithAi?.()
    expect(workspace.startSession).toHaveBeenCalledWith(undefined, { prompt: 'createPrompt', whenDraftExists: 'replace' })
  })

  it('prefers the Desktop chooser when the preload exposes one', async () => {
    const pick = vi.fn(async () => 'D:\\from-desktop')
    ;(globalThis as { __DSH_DIRECTORY_PICKER__?: unknown }).__DSH_DIRECTORY_PICKER__ = { pick }
    const workspace = makeWorkspace()
    const current = makeContext(OK, workspace).face()
    await expect(current.pickFolder?.()).resolves.toBe('D:\\from-desktop')
    expect(workspace.pickDirectory).not.toHaveBeenCalled()
  })

  it('keeps an empty node half callable', () => {
    expect(() => { nodeHalf.apply() }).not.toThrow()
  })
})
