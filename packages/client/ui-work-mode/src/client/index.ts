/**
 * Work-mode plugin, browser half: the Chat/Harness switch, the embedded
 * DeepSeek chat guest, and the frame-chrome mapping between them.
 *
 * Chat shows the site inside a frame-wide layer and asks for minimal chrome;
 * Harness restores the full shell. The two tabs share no data.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopChatBridge } from '../types.ts'
import { applyWorkModeChrome } from './chrome.ts'
import { resolveWorkModeConfig } from './config.ts'
import { createChatGuest } from './desktop-chat.ts'
import { de, en, es, fr, ja, pt, ru, NS, zh, type WorkModeKey } from './locales.ts'
import { createWorkModeStore } from './store.ts'
import { WorkModeLayer, type WorkModeInjected } from './WorkModeLayer.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Chat/Harness switch and embedded-chat state copy. */
    workMode: WorkModeKey
  }
}

/** Deployment-chosen chat page and the origins that may stay embedded. */
export interface Config {
  /** HTTPS address of the chat that the Chat tab embeds. */
  url?: string
  /** HTTPS origins allowed to navigate inside the guest; every other page opens outside. */
  allowedOrigins?: string[]
  /** Exact provider hostnames the guest may visit while signing in. */
  loginHosts?: string[]
  /** Provider host patterns: `.suffix` matches subdomains, `prefix.` matches the regional hosts of one provider. */
  loginHostSuffixes?: string[]
}

/** Validated plugin configuration. */
export const Config: z<Config> = z.object({
  url: z.string().default('https://chat.deepseek.com/'),
  allowedOrigins: z.array(z.string()).default(['https://chat.deepseek.com']),
  loginHosts: z.array(z.string()).default(['accounts.youtube.com', 'appleid.apple.com']),
  loginHostSuffixes: z.array(z.string()).default(['accounts.google.']),
})

/** Services this plugin binds. */
export const inject = ['slots', 'locale', 'layout']

/** The desktop shell's chat bridge, absent in every other client. */
function desktopBridge(): DesktopChatBridge | undefined {
  const desktop = (globalThis as typeof globalThis & { dshDesktop?: { readonly chat?: DesktopChatBridge } }).dshDesktop
  return desktop?.chat
}

/**
 * Client plugin body: register the dictionaries, the persisted mode, the
 * chrome mapping, and the frame-wide working-mode surface.
 * @param ctx - client root context.
 * @param config - validated chat address and navigation allowlist.
 */
export function apply(ctx: ClientContext, config: Config = Config({})): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ru, ja, es, fr, de, pt }), 'ui-work-mode: dictionaries')
  const resolved = resolveWorkModeConfig(config)
  const handle = createWorkModeStore()
  const instance = handle.create()
  const store: typeof handle = { ...handle, create: () => instance }
  const face: WorkModeInjected = {
    config: resolved,
    bridge: desktopBridge(),
    setTopBand: (px) => { ctx.layout.setTopBand(px) },
    createGuest: createChatGuest,
  }
  ctx.effect(() => {
    const applyMode = (): void => { applyWorkModeChrome(ctx.layout, instance.getSnapshot().mode) }
    applyMode()
    const unsubscribe = instance.subscribe(applyMode)
    return () => {
      unsubscribe()
      // Unloading the plugin must not strand the frame in the chat chrome.
      ctx.layout.setChrome('full')
      ctx.layout.setFrameCovered(false)
    }
  }, 'ui-work-mode: frame chrome')
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'work-mode',
    locale: NS,
    store,
    inject: (): WorkModeInjected => face,
  }, WorkModeLayer))
}
