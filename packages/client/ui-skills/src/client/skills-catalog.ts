/**
 * Catalog vocabulary shared by the Skills tab's list and its detail panel: what
 * a row's state means, how a skill is identified, and the size and date formats
 * the panel prints.
 */
import type { LocalSkillView } from '@deepseek-ai/dsh-skill-filesystem/types'
import type { SkillsLocaleKey } from './locales.ts'

/** Translate one `skills` dictionary key. */
export type SkillsTranslate = (key: SkillsLocaleKey, params?: Record<string, unknown>) => string

/** What the row's state column says. */
export type SkillState = 'enabled' | 'disabled' | 'overridden' | 'error'

/** State filter value: one row state, or every state. */
export type SkillStateFilter = SkillState | 'any'

/** State of one skill, given whether its source is switched on. */
export function skillState(skill: LocalSkillView, sourceEnabled: boolean): SkillState {
  if (skill.status === 'invalid') return 'error'
  // A switched-off source hides every skill in it, so the row reports the reason it cannot apply.
  if (!sourceEnabled || skill.status === 'disabled') return 'disabled'
  return skill.shadowedBy === undefined ? 'enabled' : 'overridden'
}

/** Locale key of one row state. */
export const SKILL_STATE_KEYS: Readonly<Record<SkillState, SkillsLocaleKey>> = {
  enabled: 'stateEnabled',
  disabled: 'stateDisabled',
  overridden: 'stateOverridden',
  error: 'stateError',
}

/** State dot one row state draws. */
export function skillStateDot(state: SkillState): 'done' | 'idle' | 'warning' | 'error' {
  switch (state) {
    case 'enabled': return 'done'
    case 'disabled': return 'idle'
    case 'overridden': return 'warning'
    case 'error': return 'error'
  }
}

/** Identity of one skill inside its source, from the name or path that addresses it. */
export function skillIdentity(sourceId: string, address: string): string {
  return `${sourceId}\u0000${address}`
}

/** Identity of one skill inside its source: the selection and busy key. */
export function skillKey(sourceId: string, skill: LocalSkillView): string {
  return skillIdentity(sourceId, skill.name ?? skill.path)
}

/**
 * Name a tile shows: the parsed name, or — for a skill the parser rejected — the
 * folder that holds it, which reads as a name where the whole path does not.
 * @param skill - one discovered skill row.
 * @returns the name to render.
 */
export function skillTitle(skill: LocalSkillView): string {
  if (skill.name !== undefined) return skill.name
  const value = skill.displayPath ?? skill.path
  const segments = value.split(/[\\/]/u).filter(segment => segment.length > 0)
  const last = segments[segments.length - 1]
  if (last === undefined) return value
  const parent = segments.length > 1 ? segments[segments.length - 2] : undefined
  return parent !== undefined && /^SKILL\.md$/iu.test(last) ? parent : last
}

/**
 * Byte size for the detail panel's file list.
 * @param size - byte count reported by the Host.
 * @returns the size with a localized unit.
 */
export function formatSize(size: number): string {
  const format = (value: number, unit: 'byte' | 'kilobyte' | 'megabyte'): string =>
    new Intl.NumberFormat(undefined, { style: 'unit', unit, maximumFractionDigits: 1 }).format(value)
  if (size < 1024) return format(size, 'byte')
  if (size < 1024 * 1024) return format(Math.round(size / 100) / 10, 'kilobyte')
  return format(Math.round(size / 1024 / 100) / 10, 'megabyte')
}

/**
 * Calendar date of an installation record.
 * @param value - ISO-8601 instant the Host reported.
 * @returns the date in the reader's locale.
 */
export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}
