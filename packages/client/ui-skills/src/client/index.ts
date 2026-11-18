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
import type {} from '@deepseek-ai/dsh-skill-install/remote'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
// Type-only: the `ctx.uiWorkspace` merge used to open a chat and the Host folder chooser.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { SkillsSection, type SkillsFace } from './SkillsSection.tsx'
import type { FaceResult } from './skills-install.ts'
import { createSkillsStore } from './skills-store.ts'
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
  // Desktop exposes its own chooser through the preload; elsewhere the Host opens its OS chooser.
  const desktopPicker = (globalThis as typeof globalThis & {
    __DSH_DIRECTORY_PICKER__?: { pick: () => Promise<string | null> }
  }).__DSH_DIRECTORY_PICKER__
  const face = (): SkillsFace => {
    const workspace = ctx.get('uiWorkspace')
    const pickFolder = desktopPicker !== undefined ? () => desktopPicker.pick()
      : workspace === undefined ? undefined : () => workspace.pickDirectory()
    return {
      ...remoteFace,
      ...pickFolder === undefined ? {} : { pickFolder },
      ...workspace === undefined ? {} : {
        createWithAi: () => { workspace.startSession(undefined, { prompt: t('createPrompt'), whenDraftExists: 'replace' }) },
      },
    }
  }
  const remoteFace: SkillsFace = {
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
    async addFolder(path) {
      const response = await ctx.remote.skillSources.addFolder(path)
      return response.ok ? response.value : { error: response.error.message }
    },
    async removeFolder(path) {
      const response = await ctx.remote.skillSources.removeFolder(path)
      return response.ok ? undefined : response.error.message
    },
    async catalogs() {
      return settled(ctx.remote.skillInstall.catalogs())
    },
    async repository(input) {
      return settled(ctx.remote.skillInstall.repository(input))
    },
    async previewRepository(input, folder) {
      return settled(ctx.remote.skillInstall.previewRepository(input, folder))
    },
    async previewArchive(fileName, content) {
      return settled(ctx.remote.skillInstall.previewArchive(fileName, content))
    },
    async previewFolder(folderName, files) {
      return settled(ctx.remote.skillInstall.previewFolder(folderName, files))
    },
    async install(previewId, name, replace) {
      return settled(ctx.remote.skillInstall.installSkill(previewId, name, replace))
    },
    async removeInstalled(name) {
      const response = await ctx.remote.skillInstall.removeSkill(name)
      return response.ok ? undefined : response.error.message
    },
  }
  ctx.slots.inject('plugins.tab', () => {
    // One store instance for the tab's lifetime: group collapse and the open
    // detail panel survive leaving and returning to the tab.
    const handle = createSkillsStore(), instance = handle.create()
    const store: typeof handle = { ...handle, create: () => instance }
    return ctx.slots.register({
      name: 'plugins.tab',
      id: 'skills',
      label: () => t('title'),
      locale: NS,
      store,
      inject: face,
    }, SkillsSection)
  })
}

/**
 * Fold one Remote answer into the face's outcome, keeping the failure code the
 * dialog turns into a localized sentence.
 * @param response - the generated Remote call's promise.
 * @returns the value, or the code and diagnostic the Host reported.
 */
async function settled<Value>(response: Promise<{ readonly ok: true; readonly value: Value } | {
  readonly ok: false
  readonly error: { readonly code: string; readonly message: string }
}>): Promise<FaceResult<Value>> {
  const answer = await response
  if (answer.ok) return { ok: true, value: answer.value }
  return { ok: false, failure: { code: answer.error.code, message: answer.error.message } }
}
