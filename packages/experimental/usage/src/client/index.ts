/** Bind the generated usage Remote to the source-tested browser lifecycle. */
import type { Context } from '@deepseek-ai/cordis'
import remote from '@deepseek-ai/dsh-usage/remote'
import { mountUsage } from './mount.ts'

export { inject } from './mount.ts'
export type { UsagePageInjected, UsagePageProps, UsageToastInjected, UsageToastProps } from './UsagePage.tsx'

/**
 * Mount the Usage section, its notice, and the usage Remote.
 * @param ctx - the browser plugin context.
 * @returns cleanup for both contributions.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountUsage(ctx, remote)
}
