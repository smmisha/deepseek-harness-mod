/**
 * Skills tab: local skill sources with their discovered skills. Each row owns a
 * switch; a source switch hides all of its skills without forgetting the
 * per-skill switches, which the Host replays when the source returns.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { LocalSourceView } from '@deepseek-ai/dsh-skill-filesystem/types'
import type { SkillsLocaleKey } from './locales.ts'
import css from './SkillsSection.module.css'

/** Data and writes the tab reads from its Host namespace. */
export interface SkillsFace {
  /** Current source inventory with parsed skills and switch states. */
  load: (cwd?: string) => Promise<readonly LocalSourceView[]>
  /** Switch one source; resolves to a failure message when the write was refused. */
  setSource: (id: string, enabled: boolean) => Promise<string | undefined>
  /** Switch one skill; resolves to a failure message when the write was refused. */
  setSkill: (source: string, name: string, enabled: boolean) => Promise<string | undefined>
}

/** Full props of the `plugins.tab` occupant. */
/** One row of the framework session-list snapshot, as far as the tab reads it. */
interface SessionListLike {
  readonly byId: Readonly<Record<string, {
    readonly retainedBy: Readonly<Record<string, number>>
    readonly cwd?: string
  }>>
}

/** Props of the tab, including the session-list hook that locates the open project. */
export type SkillsSectionProps = PropsLocale<'skills'> & InjectFace<SkillsFace> & {
  /** Framework session-list hook; the open session keeps the project folder. */
  readonly useSessions?: (
    selector: (state: SessionListLike) => string | undefined,
  ) => string | undefined
}

/** Skills rendered per source before the "show more" control appears. */
const PAGE_SIZE = 50

/** Locale keys naming the harness's own sources. */
const SOURCE_TITLES: Readonly<Record<string, SkillsLocaleKey>> = {
  'project-dsh': 'sourceProjectDsh',
  'project-agents': 'sourceProjectAgents',
  'user-dsh': 'sourceUserDsh',
  'user-agents': 'sourceUserAgents',
  custom: 'sourceCustom',
  bundled: 'sourceBundled',
}

/**
 * Render the Skills tab.
 * @param props - the `skills` locale seat and the injected Host face.
 * @returns the source list with search, switches, and per-source skill lists.
 */
export function SkillsSection({ t, useSessions, load, setSource, setSkill }: SkillsSectionProps): ReactNode {
  const [sources, setSources] = useState<readonly LocalSourceView[] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<readonly string[]>([])
  const [expanded, setExpanded] = useState<readonly string[]>([])
  const [limits, setLimits] = useState<Readonly<Record<string, number>>>({})

  const cwd = useSessions?.(state => Object.values(state.byId)
    .find(summary => (summary.retainedBy.mainView ?? 0) > 0)?.cwd)
  const refresh = async (): Promise<void> => {
    try {
      setSources(await load(cwd))
      setFailure(null)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    }
  }

  useEffect(() => { void refresh() }, [cwd])

  const withBusy = async (key: string, write: () => Promise<string | undefined>): Promise<void> => {
    setBusy(previous => [...previous, key])
    try {
      const error = await write()
      if (error !== undefined) setFailure(error)
      else await refresh()
    } finally {
      setBusy(previous => previous.filter(entry => entry !== key))
    }
  }

  const toggle = (key: string, value: boolean): void => {
    setExpanded(previous => value ? [...previous, key] : previous.filter(entry => entry !== key))
  }

  const labelFor = (id: string): string => {
    const key = SOURCE_TITLES[id]
    if (key !== undefined) return t(key)
    return sources?.find(source => source.id === id)?.title ?? id
  }

  const needle = query.trim().toLowerCase()
  const rows = useMemo(() => (sources ?? []).map(source => ({
    source,
    skills: source.skills.filter(skill => needle.length === 0
      || (skill.name ?? '').toLowerCase().includes(needle)
      || (skill.description ?? '').toLowerCase().includes(needle)),
  })).filter(row => needle.length === 0 || row.skills.length > 0), [sources, needle])

  if (failure !== null && sources === null) return <p className={css.message}>{t('failed', { error: failure })}</p>
  if (sources === null) return <p className={css.message}>{t('loading')}</p>

  return (
    <section className={css.tab}>
      <div className={css.toolbar}>
        <input
          type="search"
          className={css.search}
          value={query}
          placeholder={t('searchPlaceholder')}
          aria-label={t('search')}
          onChange={(event) => { setQuery(event.target.value) }}
        />
      </div>
      {failure !== null && <p className={css.error} role="alert">{t('failed', { error: failure })}</p>}
      {rows.length === 0 && <p className={css.message}>{t('noMatches')}</p>}
      <ul className={css.sources}>
        {rows.map(({ source, skills }) => {
          const open = expanded.includes(source.id)
          const limit = limits[source.id] ?? PAGE_SIZE
          const enabledCount = source.enabled ? source.skills.filter(skill => skill.status === 'available').length : 0
          const title = labelFor(source.id)
          return (
            <li key={source.id} className={css.source} data-source={source.id}>
              <div className={css.sourceRow}>
                <button
                  type="button"
                  className={css.disclosure}
                  aria-expanded={open}
                  aria-label={title}
                  onClick={() => { toggle(source.id, !open) }}
                >
                  <span className={open ? css.chevronOpen : css.chevron} aria-hidden="true">›</span>
                </button>
                <span className={css.sourceName}>{title}</span>
                <span className={css.chip}>{t(source.kind === 'application' ? 'application' : 'harness')}</span>
                <code className={css.path} title={t('pathTooltip', { path: source.path })}>{source.displayPath}</code>
                <span className={css.count}>{t('count', { enabled: String(enabledCount), total: String(source.skills.length) })}</span>
                {!source.exists && <span className={css.warning}>{t('notFound')}</span>}
                <Switch
                  checked={source.enabled}
                  label={t('sourceToggle', { name: title })}
                  disabled={busy.includes(source.id) || !source.exists}
                  onChange={(next) => { void withBusy(source.id, () => setSource(source.id, next)) }}
                />
              </div>
              {open && (
                <ul className={css.skills}>
                  {skills.length === 0 && <li className={css.message}>{t('empty')}</li>}
                  {skills.slice(0, limit).map((skill, index) => (
                    <li key={`${skill.name ?? skill.path}-${String(index)}`} className={css.skill}>
                      {skill.name !== undefined && <span className={css.skillName}>{skill.name}</span>}
                      {skill.description !== undefined && <span className={css.description}>{skill.description}</span>}
                      <code className={css.path} title={t('pathTooltip', { path: skill.path })}>{skill.displayPath ?? skill.path}</code>
                      {skill.shadowedBy !== undefined && (
                        <span className={css.warning}>{t('shadowedBy', { source: labelFor(skill.shadowedBy) })}</span>
                      )}
                      {skill.status === 'invalid' && (
                        <span className={css.warning}>{t('invalid', { error: skill.error ?? '' })}</span>
                      )}
                      {skill.name !== undefined && (
                        <Switch
                          checked={skill.status === 'available'}
                          label={t('skillToggle', { name: skill.name })}
                          disabled={!source.enabled || busy.includes(`${source.id}:${skill.name}`)}
                          onChange={(next) => { void withBusy(`${source.id}:${skill.name}`, () => setSkill(source.id, skill.name as string, next)) }}
                        />
                      )}
                    </li>
                  ))}
                  {skills.length > limit && (
                    <li className={css.message}>
                      <button
                        type="button"
                        className={css.more}
                        onClick={() => { setLimits(previous => ({ ...previous, [source.id]: limit + PAGE_SIZE })) }}
                      >
                        {t('showMore', { count: String(skills.length - limit) })}
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
