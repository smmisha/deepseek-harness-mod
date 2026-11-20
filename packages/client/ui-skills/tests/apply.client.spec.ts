// @vitest-environment jsdom
/** The browser half: dictionaries, Remote face, folder chooser, AI chat, and the `plugins.tab` declaration. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import * as nodeHalf from '../src/index.ts'

/** Rows the fake Host namespace answers with. */
const ROWS = [{ id: 'user-dsh', kind: 'harness', title: 'user-dsh', path: '~\\.dsh\\skills', displayPath: '~\\.dsh\\skills', exists: true, enabled: true, skills: [] }]

type Refusal = { ok: false; error: { code: string; message: string } }

type RemoteResults = {
  describe: { ok: true; value: typeof ROWS } | Refusal
  catalogs: { ok: true; value: readonly unknown[] } | Refusal
  repository: { ok: true; value: unknown } | Refusal
  previewRepository: { ok: true; value: unknown } | Refusal
  previewArchive: { ok: true; value: unknown } | Refusal
  previewFolder: { ok: true; value: unknown } | Refusal
  install: { ok: true; value: unknown } | Refusal
  remove: { ok: true } | Refusal
  setSource: { ok: true } | Refusal
  setSkill: { ok: true } | Refusal
  addFolder: { ok: true; value: string } | Refusal
  removeFolder: { ok: true } | Refusal
}

/** The face the tab receives, as far as these tests call it. */
type Face = {
  load: (cwd?: string) => Promise<unknown>
  catalogs: () => Promise<unknown>
  repository: (input: string) => Promise<unknown>
  previewRepository: (input: string, folder: string) => Promise<unknown>
  previewArchive: (fileName: string, content: string) => Promise<unknown>
  previewFolder: (folderName: string, files: readonly { path: string; content: string }[]) => Promise<unknown>
  installSkill: (previewId: string, name: string | undefined, replace: boolean) => Promise<unknown>
  removeInstalled: (name: string) => Promise<string | undefined>
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
  catalogs: { ok: true, value: [] },
  repository: { ok: true, value: { owner: 'a', repo: 'b', commit: 'c', skills: [] } },
  previewRepository: { ok: true, value: { id: 'p' } },
  previewArchive: { ok: true, value: { id: 'p' } },
  previewFolder: { ok: true, value: { id: 'p' } },
  install: { ok: true, value: { installed: [] } },
  remove: { ok: true },
}

const REFUSED: RemoteResults = {
  describe: { ok: false, error: { code: 'gateway/internal', message: 'describe refused' } },
  setSource: { ok: false, error: { code: 'gateway/internal', message: 'source refused' } },
  setSkill: { ok: false, error: { code: 'gateway/internal', message: 'skill refused' } },
  addFolder: { ok: false, error: { code: 'gateway/internal', message: 'folder refused' } },
  removeFolder: { ok: false, error: { code: 'gateway/internal', message: 'removal refused' } },
  catalogs: { ok: false, error: { code: 'skill-install/unavailable', message: 'catalogs refused' } },
  repository: { ok: false, error: { code: 'skill-install/not-found', message: 'repository refused' } },
  previewRepository: { ok: false, error: { code: 'skill-install/network', message: 'preview refused' } },
  previewArchive: { ok: false, error: { code: 'skill-install/archive-invalid', message: 'archive refused' } },
  previewFolder: { ok: false, error: { code: 'skill-install/invalid-skill', message: 'folder import refused' } },
  install: { ok: false, error: { code: 'skill-install/io-failed', message: 'install refused' } },
  remove: { ok: false, error: { code: 'skill-install/not-installed', message: 'remove refused' } },
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
  const skillInstall = {
    catalogs: vi.fn(async () => results.catalogs),
    repository: vi.fn(async () => results.repository),
    previewRepository: vi.fn(async () => results.previewRepository),
    previewArchive: vi.fn(async () => results.previewArchive),
    previewFolder: vi.fn(async () => results.previewFolder),
    installSkill: vi.fn(async () => results.install),
    removeSkill: vi.fn(async () => results.remove),
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
  const ctx = { effect, locale, remote: { skillSources, skillInstall }, slots, get }
  apply(ctx as never)
  const declaration = (register.mock.calls[0] as [Record<string, unknown>, unknown])[0]
  const face = (): Face => (declaration.inject as () => Face)()
  return { register, effect, locale, skillSources, skillInstall, declaration, face }
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

  it('forwards the install face to the install namespace', async () => {
    const { skillInstall, face } = makeContext(OK)
    const current = face()
    await expect(current.catalogs()).resolves.toEqual({ ok: true, value: [] })
    await expect(current.repository('a/b')).resolves.toEqual({
      ok: true,
      value: { owner: 'a', repo: 'b', commit: 'c', skills: [] },
    })
    await expect(current.previewRepository('a/b', 'skills/pdf')).resolves.toEqual({ ok: true, value: { id: 'p' } })
    await expect(current.previewArchive('pack.zip', 'emlw')).resolves.toEqual({ ok: true, value: { id: 'p' } })
    await expect(current.previewFolder('pdf', [{ path: 'SKILL.md', content: 'eA==' }]))
      .resolves.toEqual({ ok: true, value: { id: 'p' } })
    await expect(current.installSkill('p', 'pdf-copy', false)).resolves.toEqual({ ok: true, value: { installed: [] } })
    await expect(current.removeInstalled('pdf')).resolves.toBeUndefined()
    expect(skillInstall.previewRepository).toHaveBeenCalledWith('a/b', 'skills/pdf')
    expect(skillInstall.previewArchive).toHaveBeenCalledWith('pack.zip', 'emlw')
    expect(skillInstall.installSkill).toHaveBeenCalledWith('p', 'pdf-copy', false)
    expect(skillInstall.removeSkill).toHaveBeenCalledWith('pdf')
  })

  it('keeps the install failure code for the dialog to localize', async () => {
    const current = makeContext(REFUSED).face()
    await expect(current.catalogs()).resolves.toEqual({
      ok: false, failure: { code: 'skill-install/unavailable', message: 'catalogs refused' },
    })
    await expect(current.repository('a/b')).resolves.toHaveProperty('failure.code', 'skill-install/not-found')
    await expect(current.previewRepository('a/b', 'f')).resolves.toHaveProperty('failure.code', 'skill-install/network')
    await expect(current.previewArchive('p.zip', 'x')).resolves.toHaveProperty('failure.code', 'skill-install/archive-invalid')
    await expect(current.previewFolder('f', [])).resolves.toHaveProperty('failure.code', 'skill-install/invalid-skill')
    await expect(current.installSkill('p', undefined, false)).resolves.toHaveProperty('failure.code', 'skill-install/io-failed')
    await expect(current.removeInstalled('pdf')).resolves.toBe('remove refused')
  })

  it('declares one store instance so the tab keeps its group and panel state', () => {
    const { declaration } = makeContext(OK)
    const store = declaration.store as { create: () => unknown }
    expect(store).toBeDefined()
    // Every render gets the same instance, which survives leaving the tab.
    expect(store.create()).toBe(store.create())
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
