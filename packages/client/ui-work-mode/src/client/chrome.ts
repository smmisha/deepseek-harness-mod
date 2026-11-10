/** The one place a working mode becomes frame chrome. */
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'

/**
 * Apply one working mode to the frame.
 * @param layout - the layout service face the plugin injects.
 * @param mode - `chat` keeps the centre column alone; anything else is the full shell.
 */
export function applyWorkModeChrome(layout: Pick<ILayout, 'setChrome'>, mode: string): void {
  layout.setChrome(mode === 'chat' ? 'minimal' : 'full')
}
