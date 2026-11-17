/**
 * Skills tab: the local skill catalog. A source is a group whose header carries
 * the source mark, name, kind, folder, count, and the switch that owns every
 * skill below; each skill is one row of the catalog columns — mark, name and
 * source, description, state, and the quiet switch. Selecting a row opens its
 * detail panel beside the list.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Button, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconFolderOpenOutlineRegular,
  IconNewChatOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular, IconSearchOutlineRegular,
  IconTrashOutlineRegular, IconWarningTriangleOutlineRegular, Input, Menu, MenuItemButton, Modal, StateDot, Switch,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { AddSkillFolderResult, LocalSkillView, LocalSourceView } from '@deepseek-ai/dsh-skill-filesystem/types'
import { DETAIL_PANEL_ID, SkillDetail } from './SkillDetail.tsx'
import { applicationMarkSpec, SourceMark, sourceMarkSpec } from './SourceMark.tsx'
import type { SkillsLocaleKey } from './locales.ts'
import type { SkillsStoreHandle } from './skills-store.ts'
import {
  SKILL_STATE_KEYS, skillIdentity, skillKey, skillState, skillStateDot, skillTitle, type SkillState,
  type SkillStateFilter, type SkillsTranslate,
} from './skills-catalog.ts'
import css from './SkillsSection.module.css'

/** Outcome of adding a folder: the Host's answer, or a failure message when the call itself failed. */
export type AddFolderOutcome = AddSkillFolderResult | { readonly error: string }

/** Data and writes the tab reads from its Host namespace. */
export interface SkillsFace {
  /** Current source inventory with parsed skills and switch states. */
  load: (cwd?: string) => Promise<readonly LocalSourceView[]>
  /** Switch one source; resolves to a failure message when the write was refused. */
  setSource: (id: string, enabled: boolean) => Promise<string | undefined>
  /** Switch one skill; resolves to a failure message when the write was refused. */
  setSkill: (source: string, name: string, enabled: boolean) => Promise<string | undefined>
  /** Add a folder of skill bundles on the Host. */
  addFolder: (path: string) => Promise<AddFolderOutcome>
  /** Remove an added folder; resolves to a failure message when the write was refused. */
  removeFolder: (path: string) => Promise<string | undefined>
  /** Open the system folder chooser; absent where no chooser can open, null when cancelled. */
  pickFolder?: () => Promise<string | null>
  /** Open a new chat whose draft asks the agent to write a skill; absent without a workspace view. */
  createWithAi?: () => void
}

/** Locale keys for the Host answers that refuse a folder. */
const ADD_REFUSALS: Readonly<Record<Exclude<AddSkillFolderResult, 'added'>, SkillsLocaleKey>> = {
  exists: 'folderExists',
  relative: 'folderRelative',
  missing: 'folderMissing',
  invalid: 'folderInvalid',
}

/** Locale keys naming the harness's own sources. */
const SOURCE_TITLES: Readonly<Record<string, SkillsLocaleKey>> = {
  'project-dsh': 'sourceProjectDsh',
  'project-agents': 'sourceProjectAgents',
  'user-dsh': 'sourceUserDsh',
  'user-agents': 'sourceUserAgents',
  custom: 'sourceCustom',
  bundled: 'sourceBundled',
}

/** Locale keys of the other applications the Host scans by default. */
const APPLICATION_TITLES: Readonly<Record<string, SkillsLocaleKey>> = {
  'claude-code': 'appClaudeCode',
  codex: 'appCodex',
  copilot: 'appCopilot',
  'gemini-cli': 'appGeminiCli',
  antigravity: 'appAntigravity',
  opencode: 'appOpenCode',
}

/** Applications whose marks the empty state shows, in the Host's default application order. */
const APPLICATION_MARKS: readonly string[] = ['claude-code', 'codex', 'copilot', 'gemini-cli', 'antigravity', 'opencode']

/** Locale keys for the label that says who owns a source. */
const SOURCE_KINDS: Readonly<Record<LocalSourceView['kind'], SkillsLocaleKey>> = {
  harness: 'harness',
  application: 'application',
  folder: 'folder',
}

/** State filter options, in the order the menu lists them, with the label of each. */
const STATE_FILTERS: readonly { readonly value: SkillStateFilter; readonly key: SkillsLocaleKey }[] = [
  { value: 'any', key: 'anyState' },
  { value: 'enabled', key: 'stateEnabled' },
  { value: 'disabled', key: 'stateDisabled' },
  { value: 'overridden', key: 'stateOverridden' },
  { value: 'error', key: 'stateError' },
]

/** Locale key of each state filter value. */
const STATE_FILTER_KEYS: Readonly<Record<SkillStateFilter, SkillsLocaleKey>> = {
  any: 'anyState',
  enabled: 'stateEnabled',
  disabled: 'stateDisabled',
  overridden: 'stateOverridden',
  error: 'stateError',
}

/** Skills rendered per source before the "show more" control appears. */
const PAGE_SIZE = 50

/** One discovered source with the skills the current search and filters keep. */
interface CatalogGroup {
  readonly source: LocalSourceView
  readonly skills: readonly LocalSkillView[]
}

/** Props of the tab, including the session-list hook that locates the open project. */
export type SkillsSectionProps = PropsLocale<'skills'> & PropsStore<SkillsStoreHandle> & InjectFace<SkillsFace> & {
  /** Framework session-list hook; the open session keeps the project folder. */
  readonly useSessions?: (
    selector: (state: SessionListLike) => string | undefined,
  ) => string | undefined
}

/** One row of the framework session-list snapshot, as far as the tab reads it. */
interface SessionListLike {
  readonly byId: Readonly<Record<string, {
    readonly retainedBy: Readonly<Record<string, number>>
    readonly cwd?: string
  }>>
}

/** A write the tab is waiting on, named so a refusal can say what was refused. */
interface WriteFailure {
  readonly name: string
  readonly error: string
}

/** The split add button: its primary half adds a folder, and its menu offers every way to add skills. */
function AddSkillsMenu({ t, onAddFolder, onBrowseCatalog, createWithAi }: {
  readonly t: SkillsTranslate
  readonly onAddFolder: () => void
  readonly onBrowseCatalog: () => void
  readonly createWithAi: (() => void) | undefined
}): ReactNode {
  const [open, setOpen] = useState(false)
  const dismiss = (): void => { setOpen(false) }
  return (
    <span className={css.addGroup} role="group" aria-label={t('addSkills')}>
      <Button variant="primary" size="sm" className={css.addPrimary} icon={<IconPlusOutlineRegular size={13} />}
        aria-label={t('addSkills')} onClick={() => { dismiss(); onAddFolder() }}>
        <span className={css.addLabel}>{t('addSkills')}</span>
      </Button>
      {/* The split add button mirrors the plugin manager's; sharing it is a separate change. */}
      {/* jscpd:ignore-start */}
      <Menu open={open} onClose={dismiss} align="end" portal autoFocus listClassName={css.addMenu}
        anchor={(
          <Button variant="primary" size="sm" className={css.addMore}
            aria-label={t('chooseAddMethod')} aria-haspopup="menu" aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}
            onKeyDown={(event) => {
              if (!open && event.key === 'ArrowDown') { event.preventDefault(); setOpen(true) }
            }}>
            <IconChevronDownOutlineRegular size={12} aria-hidden="true" />
          </Button>
        )}>
        {/* jscpd:ignore-end */}
        <MenuItemButton icon={<IconFolderOpenOutlineRegular size={16} />} onSelect={() => { dismiss(); onAddFolder() }}>
          <span className={css.addMenuItem}>
            <span>{t('addFolder')}</span>
            <span className={css.addMenuDescription}>{t('addFolderDescription')}</span>
          </span>
        </MenuItemButton>
        <MenuItemButton icon={<IconNewChatOutlineRegular size={16} />} onSelect={() => { dismiss(); onBrowseCatalog() }}>
          <span className={css.addMenuItem}>
            <span>{t('browseCatalog')}</span>
            <span className={css.addMenuDescription}>{t('catalogPending')}</span>
          </span>
        </MenuItemButton>
        <MenuItemButton icon={<IconNewChatOutlineRegular size={16} />} disabled={createWithAi === undefined}
          disabledReason={createWithAi === undefined ? t('createWithAiUnavailable') : undefined}
          onSelect={() => { dismiss(); createWithAi?.() }}>
          <span className={css.addMenuItem}>
            <span>{t('createWithAi')}</span>
            <span className={css.addMenuDescription}>{t('createWithAiDescription')}</span>
          </span>
        </MenuItemButton>
      </Menu>
    </span>
  )
}

/** The dialog that takes a folder path, typed or picked, and adds it as a source. */
function AddFolderDialog({ t, open, onClose, onAdded, addFolder, pickFolder }: {
  readonly t: SkillsTranslate
  readonly open: boolean
  readonly onClose: () => void
  readonly onAdded: () => void
  readonly addFolder: SkillsFace['addFolder']
  readonly pickFolder: SkillsFace['pickFolder']
}): ReactNode {
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    if (!open) return
    setPath('')
    setError(null)
    setPending(false)
  }, [open])

  const browse = async (pick: () => Promise<string | null>): Promise<void> => {
    try {
      const picked = await pick()
      if (picked !== null) { setPath(picked); setError(null) }
    } catch (failure) {
      setError(t('pickFailed', { error: failure instanceof Error ? failure.message : String(failure) }))
    }
  }

  const submit = async (): Promise<void> => {
    const value = path.trim()
    if (value.length === 0 || pending) return
    setPending(true)
    try {
      const outcome = await addFolder(value)
      if (outcome === 'added') { onAdded(); return }
      setError(typeof outcome === 'string' ? t(ADD_REFUSALS[outcome]) : t('addFailed', { error: outcome.error }))
    } finally {
      setPending(false)
    }
  }

  // A write already in flight cannot be cancelled: dismissing the dialog would
  // hide the folder it adds, so every close path waits for the answer.
  const close = (): void => { if (!pending) onClose() }

  return (
    <Modal open={open} onClose={close} title={t('folderDialogTitle')} description={t('folderDialogDescription')}
      closeLabel={t('cancel')} className={css.folderDialog as string}
      footer={(
        <>
          <Button variant="outline" size="sm" disabled={pending} onClick={close}>{t('cancel')}</Button>
          <Button variant="primary" size="sm" disabled={path.trim().length === 0 || pending} aria-busy={pending}
            onClick={() => { void submit() }}>
            {t('add')}
          </Button>
        </>
      )}>
      <form className={css.folderForm} onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <label className={css.folderLabel} htmlFor="skills-folder-path">{t('folderPathLabel')}</label>
        <div className={css.folderRow}>
          {/* The modal layer captures the invoking control before it moves focus; React's
              autoFocus runs first and would lose that return target. */}
          <Input id="skills-folder-path" data-modal-autofocus className={css.folderInput as string} value={path}
            spellCheck={false} placeholder={t('folderPathPlaceholder')} aria-invalid={error !== null}
            {...error === null ? {} : { 'aria-describedby': 'skills-folder-error' }}
            onChange={(event) => { setPath(event.target.value); setError(null) }} />
          {pickFolder === undefined
            ? null
            : (
              <Button variant="outline" size="sm" className={css.folderBrowse} icon={<IconFolderOpenOutlineRegular size={13} />}
                onClick={() => { void browse(pickFolder) }}>
                {t('browse')}
              </Button>
            )}
        </div>
        {error === null ? null : <p id="skills-folder-error" className={css.alert} role="alert">{error}</p>}
      </form>
    </Modal>
  )
}

/**
 * The catalog dialog shell. Browsing and installing arrive with Stage 4's
 * installer, so this dialog only states that and can be dismissed.
 */
function CatalogDialog({ t, open, onClose }: {
  readonly t: SkillsTranslate
  readonly open: boolean
  readonly onClose: () => void
}): ReactNode {
  return (
    <Modal open={open} onClose={onClose} title={t('catalogTitle')} closeLabel={t('cancel')}
      footer={<Button variant="outline" size="sm" onClick={onClose}>{t('cancel')}</Button>}>
      {/* TODO(stage-4): replace this notice with catalog search, preview, and install. */}
      <p className={css.status} role="status">{t('catalogPending')}</p>
    </Modal>
  )
}

/** One mutually exclusive choice in a filter menu. */
interface FilterOption {
  readonly value: string
  readonly label: string
  readonly current: boolean
}

/** One filter the toolbar shows as a menu of mutually exclusive choices. */
function FilterMenu({ label, current, options, onSelect }: {
  readonly label: string
  readonly current: string
  readonly options: readonly FilterOption[]
  readonly onSelect: (value: string) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const dismiss = (): void => { setOpen(false) }
  return (
    <Menu open={open} onClose={dismiss} align="start" portal listClassName={css.filterMenu}
      anchor={(
        <Button variant="outline" size="sm" className={css.filterButton} aria-label={label}
          aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
          <span className={css.filterLabel}>{current}</span>
          <IconChevronDownOutlineRegular size={12} aria-hidden="true" />
        </Button>
      )}>
      {options.map(option => (
        <MenuItemButton key={option.value} current={option.current}
          onSelect={() => { dismiss(); onSelect(option.value) }}>
          {option.label}
        </MenuItemButton>
      ))}
    </Menu>
  )
}

/** Props of one catalog row. */
interface SkillRowProps {
  readonly t: SkillsTranslate
  readonly source: LocalSourceView
  readonly sourceTitle: string
  /** Localized name of the source that won the duplicate, or empty for a row that lost nothing. */
  readonly shadowedTitle: string
  readonly skill: LocalSkillView
  readonly state: SkillState
  readonly selected: boolean
  readonly busy: boolean
  readonly expanded: boolean
  readonly onSelect: () => void
  readonly onToggleEnabled: (name: string, enabled: boolean) => void
  readonly onToggleDescription: () => void
}

/** One row of the catalog: mark, name and source, description, state, and its switch. */
function SkillRow({
  t, source, sourceTitle, shadowedTitle, skill, state, selected, busy, expanded, onSelect, onToggleEnabled,
  onToggleDescription,
}: SkillRowProps): ReactNode {
  const name = skill.name
  const mark = sourceMarkSpec(source)
  const note = state === 'overridden'
    ? t('shadowedBy', { source: shadowedTitle })
    : state === 'error' ? (skill.error === undefined ? t('invalidNoReason') : t('invalid', { error: skill.error })) : null
  return (
    <li className={css.row} data-state={state} data-selected={selected}>
      <span className={css.rowMark}><SourceMark spec={mark} /></span>
      <div className={css.ident}>
        {name === undefined
          ? <span className={css.identNameStatic}>{skillTitle(skill)}</span>
          : (
            <button type="button" className={css.identName} aria-expanded={selected}
              {...selected ? { 'aria-controls': DETAIL_PANEL_ID } : {}}
              onClick={onSelect}>
              {name}
            </button>
          )}
        <span className={css.identOrigin}>{sourceTitle}</span>
      </div>
      <div className={css.desc}>
        {skill.description === undefined ? null : (
          <p className={css.descText} data-expanded={expanded} dir="auto" lang={skill.language}>{skill.description}</p>
        )}
        {skill.description === undefined
          ? null
          : (
            <button type="button" className={css.descMore} aria-expanded={expanded} onClick={onToggleDescription}>
              {expanded ? t('showLessDescription') : t('showFullDescription')}
            </button>
          )}
      </div>
      <span className={css.state} data-state={state}>
        <StateDot state={skillStateDot(state)} />
        {t(SKILL_STATE_KEYS[state])}
      </span>
      <span className={css.rowEnd}>
        {name === undefined
          ? null
          : (
            <Switch checked={skill.status === 'available' && source.enabled}
              disabled={busy || state === 'overridden' || !source.enabled}
              label={t('skillSwitch', {
                name,
                state: t(skill.status === 'available' && source.enabled ? 'switchOn' : 'switchOff'),
              })}
              title={note ?? undefined} onChange={(next) => { onToggleEnabled(name, next) }} />
          )}
      </span>
      {note === null ? null : <p className={css.rowNote} data-tone={state}>{note}</p>}
    </li>
  )
}

/** Props of one source group. */
interface GroupProps {
  readonly t: SkillsTranslate
  readonly group: CatalogGroup
  readonly title: string
  /** Localized name of any described source, for a duplicate's winner. */
  readonly labelFor: (sourceId: string) => string
  readonly collapsed: boolean
  readonly busy: readonly string[]
  readonly selected: string | null
  readonly expanded: readonly string[]
  readonly limit: number
  readonly onToggleGroup: () => void
  readonly onSelectSkill: (key: string) => void
  readonly onToggleDescription: (key: string) => void
  readonly onToggleSkill: (name: string, enabled: boolean) => void
  readonly onToggleSource: (enabled: boolean) => void
  readonly onRemoveFolder: () => void
  readonly onShowMore: () => void
}

/** One source group: a disclosure header that owns the source, and its skill rows. */
function Group({
  t, group, title, labelFor, collapsed, busy, selected, expanded, limit, onToggleGroup, onSelectSkill,
  onToggleDescription, onToggleSkill, onToggleSource, onRemoveFolder, onShowMore,
}: GroupProps): ReactNode {
  const { source, skills } = group
  const listId = `skills-group-${source.id}`
  const sourceBusy = busy.includes(source.id)
  return (
    <section className={css.group} data-source={source.id}>
      <div className={css.groupHead}>
        <button type="button" className={css.groupToggle} aria-expanded={!collapsed} aria-controls={listId}
          onClick={onToggleGroup}>
          {collapsed
            ? <IconChevronRightOutlineRegular size={14} aria-hidden="true" className={css.disclosure} />
            : <IconChevronDownOutlineRegular size={14} aria-hidden="true" className={css.disclosure} />}
          <SourceMark spec={sourceMarkSpec(source)} />
          <span className={css.groupName}>{title}</span>
        </button>
        <span className={css.groupKind}>{t(SOURCE_KINDS[source.kind])}</span>
        <code className={css.groupPath} title={t('pathTooltip', { path: source.path })}>{source.displayPath}</code>
        <span className={css.groupEnd}>
          {source.exists ? null : <span className={css.warning}>{t('notFound')}</span>}
          <span className={css.count}>{source.skills.length}</span>
          {source.kind === 'folder'
            ? (
              <Tooltip label={t('removeFolderHint')} side="bottom" delayMs={500} focusDelayMs={500} portal>
                <Button variant="ghost" size="sm" className={css.removeButton}
                  aria-label={t('removeFolder', { name: title })} disabled={sourceBusy}
                  icon={<IconTrashOutlineRegular size={14} />} onClick={onRemoveFolder} />
              </Tooltip>
            )
            : null}
          <Switch checked={source.enabled} disabled={sourceBusy || !source.exists}
            label={t('sourceSwitch', { name: title, state: t(source.enabled ? 'switchOn' : 'switchOff') })}
            onChange={onToggleSource} />
        </span>
      </div>
      <div className={css.groupRule} aria-hidden="true" />
      {collapsed
        ? null
        : (
          <ul id={listId} className={css.rows}>
            {skills.length === 0
              ? <li className={css.groupEmpty}>{t('emptySource')}</li>
              : skills.slice(0, limit).map((skill) => {
                const key = skillKey(source.id, skill)
                return (
                  <SkillRow
                    key={key}
                    t={t}
                    source={source}
                    sourceTitle={title}
                    shadowedTitle={skill.shadowedBy === undefined ? '' : labelFor(skill.shadowedBy)}
                    skill={skill}
                    state={skillState(skill, source.enabled)}
                    selected={key === selected}
                    busy={sourceBusy || busy.includes(key)}
                    expanded={expanded.includes(key)}
                    onSelect={() => { onSelectSkill(key) }}
                    onToggleDescription={() => { onToggleDescription(key) }}
                    onToggleEnabled={(name, enabled) => { onToggleSkill(name, enabled) }} />
                )
              })}
          </ul>
        )}
      {collapsed || skills.length <= limit
        ? null
        : (
          <button type="button" className={css.more} onClick={onShowMore}>
            {t('showMore', { count: String(skills.length - limit) })}
          </button>
        )}
    </section>
  )
}

/** The grid-shaped placeholder the tab shows while the Host describes its sources. */
function Skeleton({ t }: { readonly t: SkillsTranslate }): ReactNode {
  return (
    <div className={css.skeleton} aria-busy="true">
      <span className={css.visuallyHidden} role="status">{t('loading')}</span>
      {[0, 1, 2].map(index => (
        <div key={index} className={css.skeletonRow} aria-hidden="true">
          <span className={`${css.skeletonBlock} ${css.skeletonMark}`} />
          <span>
            <span className={`${css.skeletonBlock} ${css.skeletonLine} ${css.skeletonName}`} />
            <span className={`${css.skeletonBlock} ${css.skeletonLine} ${css.skeletonOrigin}`} />
          </span>
          <span>
            <span className={`${css.skeletonBlock} ${css.skeletonLine}`} />
            <span className={`${css.skeletonBlock} ${css.skeletonLine} ${css.skeletonShortLine}`} />
          </span>
          <span className={`${css.skeletonBlock} ${css.skeletonLine}`} />
          <span className={`${css.skeletonBlock} ${css.skeletonSwitch}`} />
        </div>
      ))}
    </div>
  )
}

/** The empty inventory: what a skill is, the three ways to add one, and the sources it reads. */
function EmptyState({ t, createWithAi, onAddFolder, onBrowseCatalog }: {
  readonly t: SkillsTranslate
  readonly createWithAi: (() => void) | undefined
  readonly onAddFolder: () => void
  readonly onBrowseCatalog: () => void
}): ReactNode {
  return (
    <div className={css.empty}>
      <h2 className={css.emptyTitle}>{t('emptyTitle')}</h2>
      <p className={css.emptyBody}>{t('emptyBody')}</p>
      <div className={css.emptyActions}>
        <Button variant="primary" size="sm" icon={<IconPlusOutlineRegular size={13} />} onClick={onAddFolder}>
          {t('addFolder')}
        </Button>
        <Button variant="outline" size="sm" icon={<IconFolderOpenOutlineRegular size={13} />} onClick={onBrowseCatalog}>
          {t('browseCatalog')}
        </Button>
        <Button variant="ghost" size="sm" icon={<IconNewChatOutlineRegular size={13} />}
          disabled={createWithAi === undefined}
          title={createWithAi === undefined ? t('createWithAiUnavailable') : undefined}
          onClick={createWithAi}>
          {t('createWithAi')}
        </Button>
      </div>
      <div className={css.emptySources}>
        <span>{t('readsFrom')}</span>
        <span className={css.emptyMarks} aria-hidden="true">
          {APPLICATION_MARKS.map(id => <SourceMark key={id} spec={applicationMarkSpec(id)} small />)}
          <SourceMark spec={{ kind: 'monogram', glyph: '~' }} small />
        </span>
      </div>
    </div>
  )
}

/**
 * Render the Skills tab.
 * @param props - the `skills` locale seat, the declared store, and the injected Host face.
 * @returns the catalog toolbar, its filters, the source groups, and the detail panel.
 */
export function SkillsSection(props: SkillsSectionProps): ReactNode {
  const { t, useSessions, load, setSource, setSkill, addFolder, removeFolder, pickFolder, createWithAi, useStore, actions } = props
  const [sources, setSources] = useState<readonly LocalSourceView[] | null>(null)
  const [folderDialog, setFolderDialog] = useState(false)
  const [catalogDialog, setCatalogDialog] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [writeFailure, setWriteFailure] = useState<WriteFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<readonly string[]>([])
  const [limits, setLimits] = useState<Readonly<Record<string, number>>>({})
  const [sourceFilter, setSourceFilter] = useState('all')
  const [stateFilter, setStateFilter] = useState<SkillStateFilter>('any')
  const [expanded, setExpanded] = useState<readonly string[]>([])
  const collapsed = useStore(state => state.collapsed)
  const selected = useStore(state => state.selected)

  const cwd = useSessions?.(state => Object.values(state.byId)
    .find(summary => (summary.retainedBy.mainView ?? 0) > 0)?.cwd)
  // A write that finishes after the working directory changed must reload the
  // directory that is current then, not the one its render captured, so every
  // load reads the latest cwd from this ref.
  const currentCwd = useRef(cwd)
  // An older response must never replace a newer one: every load, from a cwd
  // change or after a write, captures a request number and drops a result that
  // is no longer the latest request.
  const latestLoad = useRef(0)
  const refresh = async (): Promise<void> => {
    const request = latestLoad.current + 1
    latestLoad.current = request
    try {
      const next = await load(currentCwd.current)
      if (latestLoad.current !== request) return
      setSources(next)
      setFailure(null)
    } catch (error) {
      if (latestLoad.current !== request) return
      // A failed reload keeps the described rows on screen and says they are stale.
      setFailure(error instanceof Error ? error.message : String(error))
    }
  }

  useEffect(() => {
    currentCwd.current = cwd
    void refresh()
  }, [cwd])

  const withBusy = async (key: string, name: string, write: () => Promise<string | undefined>): Promise<void> => {
    setBusy(previous => [...previous, key])
    try {
      const error = await write()
      if (error !== undefined) {
        setWriteFailure({ name, error })
        return
      }
      // The notice survives a refused write; only an accepted one retires it.
      setWriteFailure(null)
      setNotice(null)
      await refresh()
    } finally {
      setBusy(previous => previous.filter(entry => entry !== key))
    }
  }

  const titleFor = (source: LocalSourceView): string => {
    const application = source.applicationId === undefined ? undefined : APPLICATION_TITLES[source.applicationId]
    if (application !== undefined) return t(application)
    const harness = SOURCE_TITLES[source.id]
    if (harness !== undefined) return t(harness)
    return source.title.length === 0 ? source.displayPath : source.title
  }
  const titles = new Map<string, string>()
  for (const source of sources ?? []) titles.set(source.id, titleFor(source))
  const sourceTitleFor = (id: string): string => titles.get(id) ?? id

  const needle = query.trim().toLowerCase()
  const filtering = needle !== '' || sourceFilter !== 'all' || stateFilter !== 'any'
  const groups = useMemo((): readonly CatalogGroup[] => (sources ?? []).flatMap((source) => {
    if (sourceFilter !== 'all' && source.id !== sourceFilter) return []
    const skills = source.skills.filter(skill => (needle.length === 0
      || (skill.name ?? '').toLowerCase().includes(needle)
      || (skill.description ?? '').toLowerCase().includes(needle))
      && (stateFilter === 'any' || skillState(skill, source.enabled) === stateFilter))
    // A search or filter hides a group it leaves empty; the unfiltered catalog keeps every source.
    return filtering && skills.length === 0 ? [] : [{ source, skills }]
  }), [sources, needle, sourceFilter, stateFilter, filtering])

  const totalSkills = (sources ?? []).reduce((sum, source) => sum + source.skills.length, 0)
  const emptyInventory = sources !== null && totalSkills === 0 && !filtering
  const shown = groups.reduce((sum, group) => sum + group.skills.length, 0)
  const enabled = groups.reduce((sum, group) => sum
    + group.skills.filter(skill => skillState(skill, group.source.enabled) === 'enabled').length, 0)
  const selectedSkill = useMemo(() => {
    if (sources === null || selected === null) return null
    for (const source of sources) {
      for (const skill of source.skills) {
        if (skillKey(source.id, skill) === selected) {
          return { source, skill, state: skillState(skill, source.enabled) }
        }
      }
    }
    return null
  }, [sources, selected])

  return (
    <section className={css.tab}>
      {emptyInventory
        ? null
        : (
          <div className={css.toolbar}>
            <Input type="search" className={css.search as string} icon={<IconSearchOutlineRegular size={14} />} value={query}
              placeholder={t('searchPlaceholder')} aria-label={t('search')}
              onChange={(event) => { setQuery(event.target.value) }} />
            <AddSkillsMenu t={t} onAddFolder={() => { setNotice(null); setFolderDialog(true) }}
              onBrowseCatalog={() => { setCatalogDialog(true) }} createWithAi={createWithAi} />
          </div>
        )}
      {sources === null || emptyInventory
        ? null
        : (
          <div className={css.filters}>
            <FilterMenu label={t('filterSource')}
              current={sourceFilter === 'all' ? t('allSources') : sourceTitleFor(sourceFilter)}
              options={[
                { value: 'all', label: t('allSources'), current: sourceFilter === 'all' },
                ...sources.map(source => ({ value: source.id, label: titleFor(source), current: sourceFilter === source.id })),
              ]}
              onSelect={(value) => { setSourceFilter(value) }} />
            <FilterMenu label={t('filterState')} current={t(STATE_FILTER_KEYS[stateFilter])}
              options={STATE_FILTERS.map(option => ({
                value: option.value, label: t(option.key), current: option.value === stateFilter,
              }))}
              onSelect={(value) => { setStateFilter(value as SkillStateFilter) }} />
            <span className={css.summary}>{t('summary', { shown: String(shown), enabled: String(enabled) })}</span>
          </div>
        )}
      {failure === null
        ? null
        : (
          <div className={css.notice} role="alert">
            <IconWarningTriangleOutlineRegular size={16} aria-hidden="true" className={css.noticeIcon} />
            <p className={css.noticeText}>
              {sources === null ? t('failed', { error: failure }) : t('staleList', { error: failure })}
            </p>
            <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular size={13} />}
              onClick={() => { void refresh() }}>
              {t('retry')}
            </Button>
          </div>
        )}
      {writeFailure === null
        ? null
        : (
          <p className={css.alert} role="alert">
            {t('writeFailed', { name: writeFailure.name, error: writeFailure.error })}
          </p>
        )}
      {notice === null ? null : <p className={css.status} role="status">{notice}</p>}
      {sources === null
        ? (failure === null ? <Skeleton t={t} /> : null)
        : emptyInventory
          ? (
            <EmptyState t={t} createWithAi={createWithAi} onAddFolder={() => { setFolderDialog(true) }}
              onBrowseCatalog={() => { setCatalogDialog(true) }} />
          )
          : (
            <>
              {groups.length === 0
                ? (
                  <div className={css.noResults}>
                    <p className={css.status}>{needle === '' ? t('noMatchesFilters') : t('noMatches')}</p>
                    {needle === '' ? null : (
                      <Button variant="ghost" size="sm" onClick={() => { setQuery('') }}>{t('clearSearch')}</Button>
                    )}
                    {stateFilter === 'any' && sourceFilter === 'all' ? null : (
                      <Button variant="ghost" size="sm" onClick={() => { setStateFilter('any'); setSourceFilter('all') }}>
                        {t('clearFilters')}
                      </Button>
                    )}
                  </div>
                )
                : null}
              <div className={css.split} data-detail={selectedSkill !== null}>
                <div className={css.list}>
                  {groups.map(group => (
                    <Group
                      key={group.source.id}
                      t={t}
                      group={group}
                      title={titleFor(group.source)}
                      labelFor={sourceTitleFor}
                      collapsed={collapsed.includes(group.source.id)}
                      busy={busy}
                      selected={selected}
                      expanded={expanded}
                      limit={limits[group.source.id] ?? PAGE_SIZE}
                      onToggleGroup={() => { actions.toggleGroup(group.source.id) }}
                      onSelectSkill={(key) => { actions.select(key === selected ? null : key) }}
                      onToggleDescription={(key) => {
                        setExpanded(previous => previous.includes(key)
                          ? previous.filter(entry => entry !== key)
                          : [...previous, key])
                      }}
                      onToggleSkill={(name, next) => {
                        void withBusy(skillIdentity(group.source.id, name), name,
                          () => setSkill(group.source.id, name, next))
                      }}
                      onToggleSource={(next) => {
                        void withBusy(group.source.id, titleFor(group.source),
                          () => setSource(group.source.id, next))
                      }}
                      onRemoveFolder={() => {
                        void withBusy(group.source.id, titleFor(group.source),
                          () => removeFolder(group.source.path))
                      }}
                      onShowMore={() => {
                        setLimits(previous => ({
                          ...previous,
                          [group.source.id]: (previous[group.source.id] ?? PAGE_SIZE) + PAGE_SIZE,
                        }))
                      }} />
                  ))}
                </div>
                {selectedSkill === null
                  ? null
                  : (
                    <SkillDetail t={t} sourceTitle={titleFor(selectedSkill.source)} skill={selectedSkill.skill}
                      state={selectedSkill.state} />
                  )}
              </div>
            </>
          )}
      <AddFolderDialog t={t} open={folderDialog} onClose={() => { setFolderDialog(false) }}
        onAdded={() => {
          setFolderDialog(false)
          // The added folder arrives switched off; the notice names the switch that applies it.
          setNotice(t('folderAddedHint'))
          void refresh()
        }} addFolder={addFolder} pickFolder={pickFolder} />
      <CatalogDialog t={t} open={catalogDialog} onClose={() => { setCatalogDialog(false) }} />
    </section>
  )
}
