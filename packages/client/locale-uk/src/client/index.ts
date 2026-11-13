/**
 * Ukrainian language pack, browser half: registers the `uk` language and one
 * Ukrainian dictionary per shipped web-UI namespace. Lookup falls back to
 * English per key, so a namespace without a translation keeps the English
 * copy. The shipped locale plugin owns the language selector; this pack only
 * adds an entry to it when mounted.
 *
 * @module @deepseek-ai/dsh-client-locale-uk/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { UK_DICTIONARIES } from './dictionaries.ts'

/** Required service: the shared locale registry. */
export const inject = ['locale']

/**
 * Register the Ukrainian language and every translated namespace.
 * @param ctx - client root context carrying the locale service.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.locale.addLanguage({ id: 'uk', label: 'Українська', fallback: 'en' }),
    'ui-locale-uk: language',
  )
  for (const [namespace, dictionary] of Object.entries(UK_DICTIONARIES)) {
    ctx.effect(
      () => ctx.locale.register(namespace, 'uk', dictionary),
      `ui-locale-uk: ${namespace} dictionary`,
    )
  }
}
