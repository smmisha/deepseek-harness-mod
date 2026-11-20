// @vitest-environment jsdom
/** Bundle configuration mirrored into Settings sections the profile names. */
import { Context } from '@deepseek-ai/cordis'
import { cleanup, render, screen } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** Slot ledger notifications are microtask-batched. */
const settle = (): Promise<void> => new Promise((resolve) => { queueMicrotask(resolve) })
import {
  BUNDLE_SECTION_ORDER, bundleSection, bundleSectionRules, mountBundleSections, PLUGIN_MANAGER_NAMESPACE,
  type PluginManagerSettings,
} from '../src/client/bundle-sections.tsx'

afterEach(cleanup)

function RemoteOptions(props: Record<string, unknown>) {
  return <p>{`options ${String(props.view)} ${String(props.signIn)}`}</p>
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry)
  const form = stubConfigForm<PluginManagerSettings>()
  const get = vi.fn(() => form.scope)
  ctx.provide('configForms', { get })
  ctx.slots.register({ name: 'root', children: {
    'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
    'settings.section': { kind: 'list', scope: 'root' },
  } } as never, () => null)
  const bundle = (key: string, extra: Record<string, unknown> = {}) => ctx.slots.register({
    name: 'plugins.bundle.config', key, locale: 'remote', inject: () => ({ signIn: 'ready' }), ...extra,
  } as never, RemoteOptions as never)
  const sections = (): readonly StoredEntry[] => ctx.slots.entries('settings.section')
  return { ctx, form, get, bundle, sections }
}

describe('bundleSectionRules', () => {
  it('keeps well-formed rules, the first per package', () => {
    expect(bundleSectionRules(undefined)).toEqual([])
    expect(bundleSectionRules([
      null, 'remote', { package: '', label: 'Empty' }, { package: 'a', label: '' }, { package: 'a', label: 3 },
      { package: 'remote', label: 'Remote' }, { package: 'remote', label: 'Again' },
    ])).toEqual([{ package: 'remote', label: 'Remote' }])
  })
})

describe('mountBundleSections', () => {
  it('mirrors a named bundle entry into Settings while both the rule and the entry exist', async () => {
    const b = await bench()
    const unmount = mountBundleSections(b.ctx)
    expect(b.get).toHaveBeenCalledWith(PLUGIN_MANAGER_NAMESPACE)
    expect(b.sections()).toEqual([])
    b.form.publish({ value: { settingsSections: [{ package: 'other', label: 'Other' }, { package: 'remote', label: 'Remote' }] } })
    expect(b.sections()).toEqual([])
    const offBundle = b.bundle('remote')
    await settle()
    const [section] = b.sections()
    expect(section?.options).toMatchObject({ id: 'bundle:remote', label: 'Remote', order: BUNDLE_SECTION_ORDER + 1 })
    expect(section?.locale).toBe('remote')
    expect(section?.inject?.()).toEqual({ signIn: 'ready' })
    b.form.publish({ value: { settingsSections: [{ package: 'remote', label: 'Remote access' }] } })
    expect(b.sections().map(entry => entry.options)).toMatchObject([{ id: 'bundle:remote', label: 'Remote access', order: BUNDLE_SECTION_ORDER }])
    const before = b.sections()[0]
    b.form.publish({ value: { settingsSections: [{ package: 'remote', label: 'Remote access' }] } })
    expect(b.sections()[0]).toBe(before)
    offBundle()
    await settle()
    expect(b.sections()).toEqual([])
    b.bundle('remote')
    await settle()
    expect(b.sections()).toHaveLength(1)
    unmount()
    expect(b.sections()).toEqual([])
  })

  it('leaves out entries it cannot mirror and passes no face when the entry injects none', async () => {
    const b = await bench()
    b.form.publish({ value: { settingsSections: [{ package: 'stored', label: 'Stored' }, { package: 'plain', label: 'Plain' }] } })
    b.bundle('stored', { store: { create: () => ({}) } })
    b.bundle('plain', { inject: undefined })
    const unmount = mountBundleSections(b.ctx)
    expect(b.sections().map(entry => entry.options.id)).toEqual(['bundle:plain'])
    expect(b.sections()[0]?.inject?.()).toEqual({})
    unmount()
  })
})

describe('bundleSection', () => {
  it('heads the bundle body with the section title and asks for its page view', () => {
    const Section = bundleSection('Remote', 'remote', RemoteOptions)
    render(<Section signIn="ready" />)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Remote')
    expect(screen.getByText('options page ready')).toBeDefined()
    expect(document.querySelector('[data-bundle-section="remote"]')).not.toBeNull()
  })
})
