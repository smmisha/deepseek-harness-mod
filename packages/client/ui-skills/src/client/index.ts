/**
 * Skills tab, browser half: the `skills` tab on the Plugins page lists the
 * local skill sources and writes their switches through the settings namespace
 * of the same Host plugin entry that feeds the model catalog.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the `ctx.remote` Context merge and the `plugins.tab` declaration.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-skill-filesystem/remote'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { SkillsSection, type SkillsFace } from './SkillsSection.tsx'
import { de, en, es, fr, ja, pt, ru, zh, NS, type SkillsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Skills tab copy. */
    skills: SkillsLocaleKey
  }
}

/** Services the tab reads. */
export const inject = ['slots', 'locale', 'remote', 'remote.skillSources']

/**
 * Contribute the Skills tab to the Plugins page.
 * @param ctx - browser plugin context carrying the Remote namespaces.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-skills: dictionaries')
  const t = ctx.locale.bind(NS)
  const face: SkillsFace = {
    async load(cwd) {
      const response = await ctx.remote.skillSources.describe(cwd)
      if (!response.ok) throw new Error(response.error.message)
      return response.value
    },
    async setSource(id, enabled) {
      const response = await ctx.remote.skillSources.setSource(id, enabled)
      return response.ok ? undefined : response.error.message
    },
    async setSkill(source, name, enabled) {
      const response = await ctx.remote.skillSources.setSkill(source, name, enabled)
      return response.ok ? undefined : response.error.message
    },
  }
  ctx.slots.inject('plugins.tab', () => ctx.slots.register({
    name: 'plugins.tab',
    id: 'skills',
    label: () => t('title'),
    locale: NS,
    inject: () => face,
  }, SkillsSection))
}
