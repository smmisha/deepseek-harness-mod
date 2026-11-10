// @vitest-environment jsdom
/** The browser half: dictionaries, Remote face, and the `plugins.tab` declaration. */
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import * as nodeHalf from '../src/index.ts'

/** Rows the fake Host namespace answers with. */
const ROWS = [{ id: 'user-dsh', kind: 'harness', title: 'user-dsh', path: '~\\.dsh\\skills', displayPath: '~\\.dsh\\skills', exists: true, enabled: true, skills: [] }]

type RemoteResults = {
  describe: { ok: true; value: typeof ROWS } | { ok: false; error: { message: string } }
  setSource: { ok: true } | { ok: false; error: { message: string } }
  setSkill: { ok: true } | { ok: false; error: { message: string } }
}

/** Build a fake browser context that records the slot contribution. */
function makeContext(results: RemoteResults) {
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
  }
  const slots = {
    inject: vi.fn((_name: string, contribute: () => unknown) => contribute()),
    register,
  }
  const ctx = { effect, locale, remote: { skillSources }, slots }
  apply(ctx as never)
  return { register, effect, locale, skillSources, slots }
}

describe('ui-skills browser half', () => {
  it('declares the tab and forwards the face to the Host namespace', async () => {
    const { register, effect, locale, skillSources } = makeContext({
      describe: { ok: true, value: ROWS },
      setSource: { ok: true },
      setSkill: { ok: true },
    })
    expect(effect).toHaveBeenCalledTimes(1)
    expect(locale.register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledTimes(1)
    const [declaration, component] = register.mock.calls[0] as [Record<string, unknown>, unknown]
    expect(component).toBeDefined()
    expect(declaration.name).toBe('plugins.tab')
    expect(declaration.id).toBe('skills')
    expect(declaration.locale).toBe('skills')
    expect((declaration.label as () => string)()).toBe('title')
    const face = (declaration.inject as () => {
      load: (cwd?: string) => Promise<unknown>
      setSource: (id: string, enabled: boolean) => Promise<string | undefined>
      setSkill: (source: string, name: string, enabled: boolean) => Promise<string | undefined>
    })()
    await expect(face.load('C:\\work')).resolves.toEqual(ROWS)
    expect(skillSources.describe).toHaveBeenCalledWith('C:\\work')
    await expect(face.setSource('user-dsh', false)).resolves.toBeUndefined()
    await expect(face.setSkill('user-dsh', 'review', false)).resolves.toBeUndefined()
  })

  it('turns refused writes and failed reads into messages', async () => {
    makeContext({
      describe: { ok: false, error: { message: 'describe refused' } },
      setSource: { ok: false, error: { message: 'source refused' } },
      setSkill: { ok: false, error: { message: 'skill refused' } },
    })
    const declaration = (makeContext({
      describe: { ok: false, error: { message: 'describe refused' } },
      setSource: { ok: false, error: { message: 'source refused' } },
      setSkill: { ok: false, error: { message: 'skill refused' } },
    }).register.mock.calls[0] as [Record<string, unknown>, unknown])[0]
    const face = (declaration.inject as () => {
      load: (cwd?: string) => Promise<unknown>
      setSource: (id: string, enabled: boolean) => Promise<string | undefined>
      setSkill: (source: string, name: string, enabled: boolean) => Promise<string | undefined>
    })()
    await expect(face.load()).rejects.toThrow('describe refused')
    await expect(face.setSource('user-dsh', false)).resolves.toBe('source refused')
    await expect(face.setSkill('user-dsh', 'review', false)).resolves.toBe('skill refused')
  })

  it('keeps an empty node half callable', () => {
    expect(() => { nodeHalf.apply() }).not.toThrow()
  })
})
