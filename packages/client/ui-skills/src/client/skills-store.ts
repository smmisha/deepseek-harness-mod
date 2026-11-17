/**
 * Interaction state the Skills tab keeps across remounts: the collapse state of
 * every source group and the skill whose detail panel is open. The tab itself
 * remounts whenever the reader leaves and returns to it, so this state is a
 * declared store rather than component state.
 */
import { defineStore } from '@deepseek-ai/dsh-client-store'

/** Group collapse and open detail panel. */
export interface SkillsStoreState {
  /** Source ids whose group the reader collapsed. */
  collapsed: readonly string[]
  /** Identity of the skill whose detail panel is open, or null when it is closed. */
  selected: string | null
}

/**
 * Create the Skills tab's interaction state.
 * @returns the registration-owned store handle.
 */
export function createSkillsStore() {
  return defineStore({
    init: (): SkillsStoreState => ({ collapsed: [], selected: null }),
    actions: {
      toggleGroup: (draft, id: string) => {
        draft.collapsed = draft.collapsed.includes(id)
          ? draft.collapsed.filter(entry => entry !== id)
          : [...draft.collapsed, id]
      },
      select: (draft, id: string | null) => {
        draft.selected = id
      },
    },
  })
}

/** The store handle the tab's registered component receives. */
export type SkillsStoreHandle = ReturnType<typeof createSkillsStore>
