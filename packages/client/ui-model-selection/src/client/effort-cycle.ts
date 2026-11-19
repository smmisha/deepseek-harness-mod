/** Reasoning-effort order shared by the effort list and the cycle shortcut. */
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelCatalogModel } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ModelDirectoryState } from './directory.ts'

/**
 * The effort values one model offers, in list order: the provider default first
 * when the model names none, then each declared level.
 * @param reasoning - the model's reasoning metadata.
 * @returns effort ids, where undefined keeps the provider default.
 */
export function effortOrder(reasoning: NonNullable<ModelCatalogModel['reasoning']>): readonly (string | undefined)[] {
  return [
    ...reasoning.defaultEffort === undefined ? [undefined] : [],
    ...reasoning.efforts.map(effort => effort.id),
  ]
}

/**
 * The selection that moves the current model to its next effort, wrapping after the last.
 * @param state - the Session's model directory snapshot.
 * @returns the next selection, or undefined when no current model offers more than one effort.
 */
export function nextEffortSelection(state: ModelDirectoryState): ModelSelection | undefined {
  const current = state.current
  if (current === null) return undefined
  const model = state.groups.find(group => group.id === current.provider)?.models.find(entry => entry.id === current.model)
  const reasoning = model?.reasoning
  if (reasoning === undefined) return undefined
  const order = effortOrder(reasoning)
  if (order.length < 2) return undefined
  const effective = current.reasoningEffort ?? reasoning.defaultEffort
  const next = order[(order.indexOf(effective) + 1) % order.length]
  return {
    provider: current.provider,
    model: current.model,
    ...next === undefined ? {} : { reasoningEffort: next },
  }
}
