/** The working-mode store: harness first, and the last choice otherwise. */
import { describe, expect, it } from 'vitest'
import { createWorkModeStore } from '../src/client/store.ts'

describe('createWorkModeStore', () => {
  it('starts in Harness and follows the chosen mode', () => {
    const { store, actions } = createWorkModeStore().create()
    expect(store.getSnapshot()).toEqual({ mode: 'harness' })
    actions.setMode('chat')
    expect(store.getSnapshot()).toEqual({ mode: 'chat' })
    actions.setMode('harness')
    expect(store.getSnapshot()).toEqual({ mode: 'harness' })
  })
})
