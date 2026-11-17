/**
 * Interaction state the Skills tab keeps across remounts: how the board groups
 * its sections, the collapse state of every section, and the skill whose detail
 * panel is open. The tab itself remounts whenever the reader leaves and returns
 * to it, so this state is a declared store rather than component state.
 */
import { defineStore } from '@deepseek-ai/dsh-client-store'

/** How the catalog board groups its skills. */
export type SkillsGrouping = 'categories' | 'sources'

/** Grouping, section collapse, and open detail panel. */
export interface SkillsStoreState {
  /** Source ids whose group the reader collapsed, or category section keys in category mode. */
  collapsed: readonly string[]
  /** Identity of the skill whose detail panel is open, or null when it is closed. */
  selected: string | null
  /** How the board groups its sections; categories are the default view. */
  grouping: SkillsGrouping
}

/**
 * Create the Skills tab's interaction state.
 * @returns the registration-owned store handle.
 */
export function createSkillsStore() {
  return defineStore({
    init: (): SkillsStoreState => ({ collapsed: [], selected: null, grouping: 'categories' }),
    actions: {
      toggleGroup: (draft, id: string) => {
        draft.collapsed = draft.collapsed.includes(id)
          ? draft.collapsed.filter(entry => entry !== id)
          : [...draft.collapsed, id]
      },
      select: (draft, id: string | null) => {
        draft.selected = id
      },
      setGrouping: (draft, grouping: SkillsGrouping) => {
        draft.grouping = grouping
      },
    },
  })
}

/** The store handle the tab's registered component receives. */
export type SkillsStoreHandle = ReturnType<typeof createSkillsStore>
