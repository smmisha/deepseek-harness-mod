/**
 * Usage, browser half: one Settings section with the balance, the budgets and
 * the statistics, and one global notice when a budget threshold is crossed.
 * Usage is read through the `usage` Host Remote; budgets are written through
 * the `usage` settings form. An open app re-reads usage periodically so the
 * notice appears without the section open.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-usage/remote'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { CHECK_INTERVAL_MS, UsageController, type UsageSettings } from './usage-controller.ts'
import { UsagePage, UsageToast, type UsagePageInjected, type UsageToastInjected } from './UsagePage.tsx'
import { de, en, es, fr, ja, pt, ru, zh, type UsageLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Usage section and budget notice copy. */
    'settings.usage': UsageLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.usage'

/** Settings section id and settings form namespace. */
export const SECTION_ID = 'usage'

/** Required services (cordis fiber inject). */
export const inject = ['remote', 'slots', 'locale', 'configForms']

/**
 * Mount the usage Remote, then the section and the notice that use it.
 * @param ctx - the browser plugin context.
 * @param contribution - generated Remote descriptors supplied by the built entry.
 * @returns cleanup removing the UI before the Remote contribution.
 */
export async function mountUsage(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  const transport = ctx.plugin(async (owner) => { await owner.remote.$mount(contribution) })
  const ui = ctx.inject(['remote.usage', 'slots', 'locale', 'configForms'], (ctx) => {
    const t = ctx.locale.bind(NS)
    ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'usage: dictionaries')
    const form = ctx.configForms.get<UsageSettings>(SECTION_ID)
    const controller = new UsageController(ctx.remote.usage, form)
    const check = (): void => { void controller.refresh() }
    ctx.effect(() => {
      check()
      const timer = setInterval(check, CHECK_INTERVAL_MS)
      return () => {
        clearInterval(timer)
        controller.dispose()
      }
    }, 'usage: periodic check')
    const page: UsagePageInjected = {
      hooks: { usagePage: controller.page, usageLimits: controller.limits, usageSettings: form },
      refresh: () => controller.refresh(),
      setPeriod: period => controller.setPeriod(period),
      setLimit: (provider, window, amount) => { controller.setLimit(provider, window, amount) },
    }
    const toast: UsageToastInjected = { hooks: { usageNotice: controller.notice }, dismiss: () => { controller.dismissNotice() } }
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section', id: SECTION_ID, order: 30, label: () => t('nav'), locale: NS, inject: () => page,
    }, UsagePage))
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay', id: 'usage.notice', locale: NS, inject: () => toast,
    }, UsageToast))
  })
  const dispose = ctx.effect(function* () {
    yield transport.dispose
    yield ui.dispose
  }, 'usage: section and Remote')
  try { await Promise.all([transport, ui]) } catch (error) { await dispose(); throw error }
  return dispose
}
