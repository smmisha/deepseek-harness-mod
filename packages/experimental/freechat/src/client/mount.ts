/**
 * Free web chat page, browser half: one card on the Plugins page that lists
 * the routes the bridge serves and every thread's web-session generation, and
 * resets one thread's live web conversation. Every read and reset goes through
 * the `freechatAdmin` Host Remote, so the proxy's bearer token stays on the Host.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-freechat/remote'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { FreeChatPage, type FreeChatPageInjected } from './FreeChatPage.tsx'
import { de, en, es, fr, ja, pt, ru, zh, type FreeChatLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Free web chat page copy. */
    'settings.freechat': FreeChatLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.freechat'

/** Required services (cordis fiber inject). */
export const inject = ['remote', 'slots', 'locale']

/**
 * Mount the administration Remote, then the Plugins page card that uses it.
 * @param ctx - the browser plugin context.
 * @param contribution - generated Remote descriptors supplied by the built entry.
 * @returns cleanup removing the card before the Remote contribution.
 */
export async function mountFreeChat(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  const transport = ctx.plugin(async (owner) => { await owner.remote.$mount(contribution) })
  const ui = ctx.inject(['remote.freechatAdmin', 'slots', 'locale'], (ctx) => {
    const t = ctx.locale.bind(NS)
    ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'freechat: dictionaries')
    const injected = (): FreeChatPageInjected => ({
      load: async () => {
        const result = await ctx.remote.freechatAdmin.state()
        if (!result.ok) throw result.error
        return result.value
      },
      reset: async (id) => {
        const result = await ctx.remote.freechatAdmin.resetThread(id)
        if (!result.ok) throw result.error
      },
    })
    ctx.slots.inject('plugins.item', () => ctx.slots.register({
      name: 'plugins.item', id: 'freechat', order: 60, label: () => t('title'), locale: NS, inject: injected,
    }, FreeChatPage))
  })
  const dispose = ctx.effect(function* () {
    yield transport.dispose
    yield ui.dispose
  }, 'freechat: page and Remote')
  try { await Promise.all([transport, ui]) } catch (error) { await dispose(); throw error }
  return dispose
}
