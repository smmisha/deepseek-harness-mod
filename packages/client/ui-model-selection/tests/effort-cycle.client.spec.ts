/** The effort order shared by the level list and the cycle shortcut. */
import { describe, expect, it } from 'vitest'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { effortOrder, nextEffortSelection } from '../src/client/effort-cycle.ts'

const levels = [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }]

function directory(
  reasoning: ModelDirectoryState['groups'][number]['models'][number]['reasoning'],
  current: ModelDirectoryState['current'] = { provider: 'p', model: 'm' },
): ModelDirectoryState {
  return {
    current,
    routable: true,
    groups: [{ id: 'p', name: 'P', models: [{ id: 'm', name: 'M', ...reasoning === undefined ? {} : { reasoning } }] }],
    failures: [],
    status: 'ready',
    pending: null,
    error: null,
  }
}

describe('effort order', () => {
  it('leads with the provider default only when the model names no default', () => {
    expect(effortOrder({ efforts: levels, defaultEffort: 'high' })).toEqual(['off', 'high'])
    expect(effortOrder({ efforts: levels })).toEqual([undefined, 'off', 'high'])
  })
})

describe('next effort selection', () => {
  it('steps from the effective level and wraps after the last', () => {
    expect(nextEffortSelection(directory({ efforts: levels, defaultEffort: 'high' })))
      .toEqual({ provider: 'p', model: 'm', reasoningEffort: 'off' })
    expect(nextEffortSelection(directory({ efforts: levels, defaultEffort: 'high' }, { provider: 'p', model: 'm', reasoningEffort: 'off' })))
      .toEqual({ provider: 'p', model: 'm', reasoningEffort: 'high' })
  })

  it('returns to the provider default by omitting the effort', () => {
    expect(nextEffortSelection(directory({ efforts: levels }, { provider: 'p', model: 'm', reasoningEffort: 'high' })))
      .toEqual({ provider: 'p', model: 'm' })
  })

  it('starts from the first level when the saved effort is no longer offered', () => {
    expect(nextEffortSelection(directory({ efforts: levels, defaultEffort: 'high' }, { provider: 'p', model: 'm', reasoningEffort: 'medium' })))
      .toEqual({ provider: 'p', model: 'm', reasoningEffort: 'off' })
  })

  it('offers nothing without a current model, an exact catalog entry, or a second level', () => {
    expect(nextEffortSelection(directory({ efforts: levels }, null))).toBeUndefined()
    expect(nextEffortSelection(directory({ efforts: levels }, { provider: 'p', model: 'gone' }))).toBeUndefined()
    expect(nextEffortSelection(directory({ efforts: levels }, { provider: 'gone', model: 'm' }))).toBeUndefined()
    expect(nextEffortSelection(directory(undefined))).toBeUndefined()
    expect(nextEffortSelection(directory({ efforts: [levels[1]!], defaultEffort: 'high' }))).toBeUndefined()
  })
})
