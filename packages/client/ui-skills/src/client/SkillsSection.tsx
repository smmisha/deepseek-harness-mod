/**
 * Skills tab: local skill sources as groups, with each discovered skill as a
 * card beside its switch. A source switch hides all of its skills without
 * forgetting the per-skill switches, which the Host replays when the source
 * returns.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IconSkillOutlineRegular, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { LocalSkillView, LocalSourceView } from '@deepseek-ai/dsh-skill-filesystem/types'
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

/** The name a card shows: the parsed name, or the file path of a skill the parser rejected. */
function skillTitle(skill: LocalSkillView): string {
  return skill.name ?? skill.displayPath ?? skill.path
}

/** One skill as a card: its artwork, name, one-liner, file, warnings, and switch. */
function SkillCard({ skill, shadowedLabel, sourceEnabled, busy, t, onSetEnabled }: {
  readonly skill: LocalSkillView
  /** The source name a duplicate lost to, when the Host reported one. */
  readonly shadowedLabel: string | undefined
  /** Whether the owning source's switch is on. */
  readonly sourceEnabled: boolean
  /** Whether this card's write is in flight. */
  readonly busy: boolean
  readonly t: SkillsSectionProps['t']
  readonly onSetEnabled: (name: string, enabled: boolean) => void
}): ReactNode {
  const name = skill.name
  return (
    <li className={css.card}>
      <div className={css.cardHead}>
        <span className={css.cardIcon} aria-hidden="true"><IconSkillOutlineRegular size={24} /></span>
        <div className={css.cardMain}>
          <span className={css.cardTitle}>{skillTitle(skill)}</span>
          {skill.description === undefined ? null : <span className={css.cardDesc}>{skill.description}</span>}
          {name === undefined
            ? null
            : <code className={css.cardPath} title={t('pathTooltip', { path: skill.path })}>{skill.displayPath ?? skill.path}</code>}
        </div>
        {name === undefined
          ? null
          : (
            <span className={css.cardEnd}>
              <Switch
                checked={skill.status === 'available'}
                label={t('skillToggle', { name })}
                disabled={!sourceEnabled || busy}
                onChange={(next) => { onSetEnabled(name, next) }}
              />
            </span>
          )}
      </div>
      {shadowedLabel === undefined
        ? null
        : <p className={`${css.reason} ${css.reasonWarning}`}>{t('shadowedBy', { source: shadowedLabel })}</p>}
      {skill.status !== 'invalid'
        ? null
        : <p className={`${css.reason} ${css.reasonError}`}>{t('invalid', { error: skill.error ?? '' })}</p>}
    </li>
  )
}

/**
 * Render the Skills tab.
 * @param props - the `skills` locale seat and the injected Host face.
 * @returns the source groups with their search, cards, switches, and paging.
 */
export function SkillsSection({ t, useSessions, load, setSource, setSkill }: SkillsSectionProps): ReactNode {
  const [sources, setSources] = useState<readonly LocalSourceView[] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [writeFailure, setWriteFailure] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<readonly string[]>([])
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

  // A response for a previous working directory must never replace the current
  // one: the effect captures a request number and drops a result that is no
  // longer the latest request.
  const latestLoad = useRef(0)
  useEffect(() => {
    const request = latestLoad.current + 1
    latestLoad.current = request
    void (async () => {
      try {
        const next = await load(cwd)
        if (latestLoad.current !== request) return
        setSources(next)
        setFailure(null)
      } catch (error) {
        if (latestLoad.current !== request) return
        setFailure(error instanceof Error ? error.message : String(error))
      }
    })()
  }, [cwd])

  const withBusy = async (key: string, write: () => Promise<string | undefined>): Promise<void> => {
    setBusy(previous => [...previous, key])
    try {
      const error = await write()
      if (error !== undefined) {
        setWriteFailure(error)
        return
      }
      setWriteFailure(null)
      await refresh()
    } finally {
      setBusy(previous => previous.filter(entry => entry !== key))
    }
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

  const labelFor = (id: string): string => {
    const key = SOURCE_TITLES[id]
    if (key !== undefined) return t(key)
    return sources.find(source => source.id === id)?.title ?? id
  }

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
      {writeFailure !== null && <p className={css.error} role="alert">{t('writeFailed', { error: writeFailure })}</p>}
      {rows.length === 0 && <p className={css.message}>{t('noMatches')}</p>}
      {rows.map(({ source, skills }) => {
        const limit = limits[source.id] ?? PAGE_SIZE
        const enabledCount = source.enabled ? source.skills.filter(skill => skill.status === 'available').length : 0
        const title = labelFor(source.id)
        return (
          <section key={source.id} className={css.group} data-source={source.id}>
            <div className={css.groupHead}>
              <h3 className={css.groupTitle}>{title}</h3>
              <span className={css.chip}>{t(source.kind === 'application' ? 'application' : 'harness')}</span>
              <code className={css.path} title={t('pathTooltip', { path: source.path })}>{source.displayPath}</code>
              <span className={css.groupEnd}>
                {!source.exists && <span className={css.warning}>{t('notFound')}</span>}
                <span className={css.count}>{t('count', { enabled: String(enabledCount), total: String(source.skills.length) })}</span>
                <Switch
                  checked={source.enabled}
                  label={t('sourceToggle', { name: title })}
                  disabled={busy.includes(source.id) || !source.exists}
                  onChange={(next) => { void withBusy(source.id, () => setSource(source.id, next)) }}
                />
              </span>
            </div>
            {skills.length === 0
              ? <p className={css.message}>{t('empty')}</p>
              : (
                <ul className={css.cards}>
                  {skills.slice(0, limit).map((skill, index) => (
                    <SkillCard
                      key={`${skill.name ?? skill.path}-${String(index)}`}
                      skill={skill}
                      shadowedLabel={skill.shadowedBy === undefined ? undefined : labelFor(skill.shadowedBy)}
                      sourceEnabled={source.enabled}
                      busy={skill.name !== undefined && busy.includes(`${source.id}:${skill.name}`)}
                      t={t}
                      onSetEnabled={(name, enabled) => {
                        void withBusy(`${source.id}:${name}`, () => setSkill(source.id, name, enabled))
                      }}
                    />
                  ))}
                </ul>
              )}
            {skills.length > limit && (
              <button
                type="button"
                className={css.more}
                onClick={() => { setLimits(previous => ({ ...previous, [source.id]: limit + PAGE_SIZE })) }}
              >
                {t('showMore', { count: String(skills.length - limit) })}
              </button>
            )}
          </section>
        )
      })}
    </section>
  )
}
