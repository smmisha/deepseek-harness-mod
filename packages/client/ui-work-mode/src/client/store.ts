/**
 * Selected working mode, persisted across launches. The framework store engine
 * owns the write-through; this module exports only the factory, so a plugin
 * reload cannot reuse a module-global handle.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** The two top-level working modes of the Web client. */
export type WorkMode = 'chat' | 'harness'

/** Selected working mode. */
interface WorkModeState {
  /** `harness` on first run; the last chosen mode after that. */
  mode: WorkMode
}

/** Writes the selection; the persistence key writes through on every change. */
type WorkModeActions = {
  setMode: (draft: WorkModeState, mode: WorkMode) => void
}

/**
 * Declare the working-mode store.
 * @returns the store handle persisted under `dsh.work-mode.v1`.
 */
export function createWorkModeStore(): EngineStoreHandle<WorkModeState, WorkModeActions> {
  return defineStore({
    init: (): WorkModeState => ({ mode: 'harness' }),
    persist: 'dsh.work-mode.v1',
    actions: {
      setMode: (draft, mode) => {
        draft.mode = mode
      },
    },
  })
}
