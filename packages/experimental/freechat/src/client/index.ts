/** Bind the generated free web chat Remote to the source-tested browser lifecycle. */
import type { Context } from '@deepseek-ai/cordis'
import remote from '@deepseek-ai/dsh-freechat/remote'
import { mountFreeChat } from './mount.ts'

export { inject } from './mount.ts'
export type { FreeChatPageInjected, FreeChatPageProps } from './FreeChatPage.tsx'

/**
 * Mount the free web chat page and its administration Remote.
 * @param ctx - the browser plugin context.
 * @returns cleanup for both contributions.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountFreeChat(ctx, remote)
}
