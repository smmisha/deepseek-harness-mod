/**
 * Settings sections for bundle configuration. The profile names bundles whose
 * `plugins.bundle.config` entry should also open as its own Settings section
 * (`settingsSections` in the `ui-plugin-manager` configuration). The section
 * mirrors that entry into `settings.section`: the same component, injected
 * face, and dictionary namespace, under a section title, so the settings shell
 * renders it like any other section. A named bundle's section exists only
 * while its entry is registered; the entry still renders on the bundle's page
 * in Plugins as well.
 */
import { createElement, type ComponentType, type ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { LocaleNamespaceMap, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import css from './BundleSettingsSection.module.css'

/** The `ui-plugin-manager` configuration namespace the browser reads. */
export const PLUGIN_MANAGER_NAMESPACE = 'ui-plugin-manager'

/** First Settings order a bundle section takes; later rules follow one by one. */
export const BUNDLE_SECTION_ORDER = 50

/** One bundle whose configuration also opens from Settings. */
export interface BundleSectionRule {
  /** npm package name the bundle's `plugins.bundle.config` entry is keyed by. */
  readonly package: string
  /** Settings navigation label and section title. */
  readonly label: string
}

/** The part of the `ui-plugin-manager` configuration this module reads. */
export interface PluginManagerSettings {
  readonly settingsSections?: readonly BundleSectionRule[]
}

type EntryComponent = ComponentType<Record<string, unknown>>

/**
 * Wrap one bundle's configuration component as a Settings section body.
 * @param title - section title.
 * @param packageName - bundle package name, marked on the section.
 * @param Body - the bundle's own configuration component.
 * @returns the section component.
 */
export function bundleSection(title: string, packageName: string, Body: EntryComponent) {
  return function BundleSettingsSection(props: Record<string, unknown>): ReactNode {
    return (
      <div className={css.section} data-bundle-section={packageName}>
        <h2 className={css.heading}>{title}</h2>
        {createElement(Body, { ...props, view: 'page' })}
      </div>
    )
  }
}

/**
 * Keep only well-formed rules, first occurrence per package; the settings wire may carry anything.
 * @param value - the configured `settingsSections` value.
 * @returns rules with a non-empty package and label.
 */
export function bundleSectionRules(value: unknown): readonly BundleSectionRule[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const rules: BundleSectionRule[] = []
  for (const item of value as readonly unknown[]) {
    if (typeof item !== 'object' || item === null) continue
    const { package: name, label } = item as Record<string, unknown>
    if (typeof name !== 'string' || name.length === 0 || typeof label !== 'string' || label.length === 0 || seen.has(name)) continue
    seen.add(name)
    rules.push({ package: name, label })
  }
  return rules
}

/** The entry a section can mirror: a component over its injected face, with no store seat to resolve. */
function mirrorable(entry: StoredEntry): entry is StoredEntry & { component: EntryComponent } {
  return typeof entry.component === 'function' && entry.store === undefined
}

/**
 * Register one Settings section per configured bundle whose configuration entry is present,
 * following both the configuration and the entry ledger.
 * @param ctx - the plugin manager's browser context.
 * @returns disposer withdrawing every section and both subscriptions.
 */
export function mountBundleSections(ctx: ClientContext): () => void {
  const form = ctx.configForms.get<PluginManagerSettings>(PLUGIN_MANAGER_NAMESPACE)
  const mounted = new Map<string, { source: StoredEntry; label: string; order: number; dispose: () => void }>()
  const reconcile = (): void => {
    const sources = new Map(ctx.slots.entries('plugins.bundle.config').filter(mirrorable).map(entry => [entry.options.key, entry]))
    const wanted = new Map(bundleSectionRules(form.getSnapshot().value?.settingsSections).flatMap((rule, index) => {
      const source = sources.get(rule.package)
      return source === undefined ? [] : [[rule.package, { source, label: rule.label, order: BUNDLE_SECTION_ORDER + index }] as const]
    }))
    for (const [name, section] of mounted) {
      const next = wanted.get(name)
      if (next?.source === section.source && next.label === section.label && next.order === section.order) continue
      section.dispose()
      mounted.delete(name)
    }
    for (const [name, { source, label, order }] of wanted) {
      if (mounted.has(name)) continue
      const sourceInject = source.inject
      const dispose = ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: `bundle:${name}`,
        order,
        label,
        locale: source.locale as keyof LocaleNamespaceMap | undefined,
        inject: () => sourceInject?.() ?? {},
      }, bundleSection(label, name, source.component)))
      mounted.set(name, { source, label, order, dispose })
    }
  }
  const offForm = form.subscribe(reconcile)
  const offLedger = ctx.slots.subscribe('plugins.bundle.config', reconcile)
  reconcile()
  return () => {
    offForm()
    offLedger()
    for (const section of mounted.values()) section.dispose()
    mounted.clear()
  }
}
