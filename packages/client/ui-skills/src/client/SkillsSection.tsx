/**
 * Skills tab: the local skill catalog. The board groups skills either by the
 * category the Host derived for them — the default view — or by the source that
 * discovered them; a group header carries the name and count, and in source mode
 * also the source mark, kind, folder, and the switch that owns every skill
 * below. Each skill is one tile of the catalog columns — mark, name and source,
 * description, state, and the quiet switch. Selecting a tile opens its detail
 * panel beside the list.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Button, IconArchiveOutlineRegular, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular,
  IconFolderOpenOutlineRegular, IconLayersOutlineRegular, IconNewChatOutlineRegular, IconPlusOutlineRegular,
  IconRefreshOutlineRegular, IconSearchOutlineRegular, IconTrashOutlineRegular, IconWarningTriangleOutlineRegular,
  Input, Menu, MenuItemButton, Modal, SegmentedControl, StateDot, Switch, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { AddSkillFolderResult, LocalSkillView, LocalSourceView } from '@deepseek-ai/dsh-skill-filesystem/types'
import type { InstallPreview } from '@deepseek-ai/dsh-skill-install/types'
import { CatalogDialog } from './CatalogDialog.tsx'
import { readArchive, readDrop, type DropOutcome, type DropProblem } from './drop.ts'
import { failureSentence, type FaceFailure, type InstallFace } from './skills-install.ts'
import { DETAIL_PANEL_ID, SkillDetail } from './SkillDetail.tsx'
import { applicationMarkSpec, SourceMark, sourceMarkSpec } from './SourceMark.tsx'
import type { SkillsLocaleKey } from './locales.ts'
import type { SkillsGrouping, SkillsStoreHandle } from './skills-store.ts'
import {
  categoryTitle, SKILL_STATE_KEYS, skillIdentity, skillKey, skillState, skillStateDot, skillTitle, type SkillState,
  type SkillStateFilter, type SkillsTranslate,
} from './skills-catalog.ts'
import css from './SkillsSection.module.css'

/** Outcome of adding a folder: the Host's answer, or a failure message when the call itself failed. */
export type AddFolderOutcome = AddSkillFolderResult | { readonly error: string }

/** Data and writes the tab reads from its Host namespace. */
export interface SkillsFace extends InstallFace {
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

/** Skills rendered per section before the "show more" control appears. */
const PAGE_SIZE = 50

/** Grouping options, in the order the switch lists them. */
const GROUPINGS: readonly { readonly value: SkillsGrouping; readonly key: SkillsLocaleKey }[] = [
  { value: 'categories', key: 'groupCategories' },
  { value: 'sources', key: 'groupSources' },
]

/** Collapse-store key and DOM id prefix of the group that holds skills no category claims. */
const CATEGORY_OTHER_KEY = 'category-other'

/** One discovered source with the skills the current search and filters keep. */
interface CatalogGroup {
  readonly source: LocalSourceView
  readonly skills: readonly LocalSkillView[]
}

/** One skill tile of the board, with everything the tile and its panel read. */
interface CatalogTile {
  /** Selection and busy identity of the skill. */
  readonly key: string
  readonly skill: LocalSkillView
  readonly source: LocalSourceView
  /** Localized name of the source that discovered the skill. */
  readonly sourceTitle: string
  readonly state: SkillState
  /** Localized name of the source that won the duplicate, or empty for a tile that lost nothing. */
  readonly shadowedTitle: string
}

/** One section of the board: a source group, or a category. */
interface CatalogSection {
  /** Identity the collapse store keeps for this section. */
  readonly key: string
  /** DOM id of the section's list, named by the header's `aria-controls` while it is open. */
  readonly listId: string
  /** Localized section name. */
  readonly title: string
  readonly tiles: readonly CatalogTile[]
  /** Number the header prints: every skill the source holds, or the category's tiles after the search and filters. */
  readonly count: number
  /** Source a source-mode section stands for; absent for a category. */
  readonly source?: LocalSourceView
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

/** What the install dialog is showing while the tab reads a drop or an archive. */
type ImportState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'preview'; readonly preview: InstallPreview }
  | { readonly kind: 'failure'; readonly failure: FaceFailure }

/** Locale key of each reason a drop carried nothing installable. */
function dropProblemKey(problem: DropProblem): SkillsLocaleKey {
  if (problem === 'empty') return 'dropEmpty'
  return problem === 'too-large' ? 'dropTooLarge' : 'dropTooMany'
}

/** The split add button: its primary half adds a folder, and its menu offers every way to add skills. */
function AddSkillsMenu({ t, onAddFolder, onImportArchive, onBrowseCatalog, createWithAi }: {
  readonly t: SkillsTranslate
  readonly onAddFolder: () => void
  readonly onImportArchive: () => void
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
        <MenuItemButton icon={<IconArchiveOutlineRegular size={16} />}
          onSelect={() => { dismiss(); onImportArchive() }}>
          <span className={css.addMenuItem}>
            <span>{t('importArchive')}</span>
            <span className={css.addMenuDescription}>{t('importArchiveDescription')}</span>
          </span>
        </MenuItemButton>
        <MenuItemButton icon={<IconNewChatOutlineRegular size={16} />} onSelect={() => { dismiss(); onBrowseCatalog() }}>
          <span className={css.addMenuItem}>
            <span>{t('browseCatalog')}</span>
            <span className={css.addMenuDescription}>{t('catalogDescription')}</span>
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

/**
 * The grouping switch's narrow form: one icon whose tooltip and accessible name
 * state the mode in effect, opening the two modes as a menu. Two unnamed icons
 * could not say "categories" against "sources"; the menu names both, and marks
 * the current one the way the toolbar's filter menus do.
 */
function GroupingMenu({ t, grouping, onChange }: {
  readonly t: SkillsTranslate
  readonly grouping: SkillsGrouping
  readonly onChange: (next: SkillsGrouping) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const dismiss = (): void => { setOpen(false) }
  const name = t('groupingCompact', { mode: t(grouping === 'categories' ? 'groupCategories' : 'groupSources') })
  return (
    <Menu open={open} onClose={dismiss} align="end" portal autoFocus className={css.groupingCompact}
      listClassName={css.groupingMenu}
      anchor={(
        <Tooltip label={name} side="bottom" delayMs={500} focusDelayMs={500} portal disabled={open}>
          <Button variant="outline" size="sm" className={css.actionButton} aria-label={name}
            aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
            <IconLayersOutlineRegular size={13} aria-hidden="true" />
          </Button>
        </Tooltip>
      )}>
      {GROUPINGS.map(option => (
        <MenuItemButton key={option.value} current={option.value === grouping}
          onSelect={() => { dismiss(); onChange(option.value) }}>
          {t(option.key)}
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
      <div className={css.cardHead}>
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
      <div className={css.cardFoot}>
        <span className={css.state} data-state={state}>
          <StateDot state={skillStateDot(state)} />
          {t(SKILL_STATE_KEYS[state])}
        </span>
        {note === null ? null : <p className={css.rowNote} data-tone={state}>{note}</p>}
      </div>
    </li>
  )
}

/** Props of one board section. */
interface SectionProps {
  readonly t: SkillsTranslate
  readonly section: CatalogSection
  readonly collapsed: boolean
  readonly busy: readonly string[]
  readonly selected: string | null
  readonly expanded: readonly string[]
  readonly limit: number
  readonly onToggleSection: () => void
  readonly onSelectSkill: (key: string) => void
  readonly onToggleDescription: (key: string) => void
  readonly onToggleSkill: (source: LocalSourceView, name: string, enabled: boolean) => void
  readonly onToggleSource: (source: LocalSourceView, enabled: boolean) => void
  readonly onRemoveFolder: (source: LocalSourceView) => void
  readonly onShowMore: () => void
}

/**
 * One board section: a disclosure header over its skill tiles. A source section
 * also carries the mark, kind, folder, remove control, and the switch that owns
 * every skill below; a category section carries only its name and count, because
 * a category is not a folder.
 */
function BoardSection({
  t, section, collapsed, busy, selected, expanded, limit, onToggleSection, onSelectSkill, onToggleDescription,
  onToggleSkill, onToggleSource, onRemoveFolder, onShowMore,
}: SectionProps): ReactNode {
  const { source, tiles } = section
  const sourceBusy = source !== undefined && busy.includes(source.id)
  return (
    <section className={css.group} data-source={source?.id} data-category={source === undefined ? section.key : undefined}>
      <div className={css.groupHead}>
        <button type="button" className={css.groupToggle} aria-expanded={!collapsed}
          {...collapsed ? {} : { 'aria-controls': section.listId }}
          onClick={onToggleSection}>
          {collapsed
            ? <IconChevronRightOutlineRegular size={14} aria-hidden="true" className={css.disclosure} />
            : <IconChevronDownOutlineRegular size={14} aria-hidden="true" className={css.disclosure} />}
          {source === undefined ? null : <SourceMark spec={sourceMarkSpec(source)} />}
          <span className={css.groupName}>{section.title}</span>
        </button>
        {source === undefined
          ? null
          : (
            <>
              <span className={css.groupKind}>{t(SOURCE_KINDS[source.kind])}</span>
              <code className={css.groupPath} title={t('pathTooltip', { path: source.path })}>{source.displayPath}</code>
            </>
          )}
        <span className={css.groupEnd}>
          <span className={css.count}>{section.count}</span>
          {source?.kind === 'folder'
            ? (
              <Tooltip label={t('removeFolderHint')} side="bottom" delayMs={500} focusDelayMs={500} portal>
                <Button variant="ghost" size="sm" className={css.removeButton}
                  aria-label={t('removeFolder', { name: section.title })} disabled={sourceBusy}
                  icon={<IconTrashOutlineRegular size={14} />} onClick={() => { onRemoveFolder(source) }} />
              </Tooltip>
            )
            : null}
          {source === undefined
            ? null
            : (
              <Switch checked={source.enabled} disabled={sourceBusy}
                label={t('sourceSwitch', { name: section.title, state: t(source.enabled ? 'switchOn' : 'switchOff') })}
                onChange={(enabled) => { onToggleSource(source, enabled) }} />
            )}
        </span>
      </div>
      <div className={css.groupRule} aria-hidden="true" />
      {collapsed
        ? null
        : (
          <ul id={section.listId} className={css.rows}>
            {tiles.slice(0, limit).map(tile => (
              <SkillRow
                key={tile.key}
                t={t}
                source={tile.source}
                sourceTitle={tile.sourceTitle}
                shadowedTitle={tile.shadowedTitle}
                skill={tile.skill}
                state={tile.state}
                selected={tile.key === selected}
                busy={sourceBusy || busy.includes(tile.key)}
                expanded={expanded.includes(tile.key)}
                onSelect={() => { onSelectSkill(tile.key) }}
                onToggleDescription={() => { onToggleDescription(tile.key) }}
                onToggleEnabled={(name, enabled) => { onToggleSkill(tile.source, name, enabled) }} />
            ))}
          </ul>
        )}
      {collapsed || tiles.length <= limit
        ? null
        : (
          <button type="button" className={css.more} onClick={onShowMore}>
            {t('showMore', { count: String(tiles.length - limit) })}
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
  const [reloading, setReloading] = useState(false)
  const [folderDialog, setFolderDialog] = useState(false)
  const [catalogDialog, setCatalogDialog] = useState(false)
  const [importState, setImportState] = useState<ImportState>({ kind: 'idle' })
  const [removeTarget, setRemoveTarget] = useState<LocalSkillView | null>(null)
  const [removing, setRemoving] = useState(false)
  const [dragging, setDragging] = useState(false)
  const archiveInput = useRef<HTMLInputElement>(null)
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
  const grouping = useStore(state => state.grouping)

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
    setReloading(true)
    try {
      const next = await load(currentCwd.current)
      if (latestLoad.current !== request) return
      setSources(next)
      setFailure(null)
    } catch (error) {
      if (latestLoad.current !== request) return
      // A failed reload keeps the described rows on screen and says they are stale.
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      // A superseded request leaves the newer one's busy state alone.
      if (latestLoad.current === request) setReloading(false)
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

  /**
   * Open the install dialog on what the reader chose or dropped, previewing it
   * first so nothing is written before they confirm.
   * @param outcome - what the browser read from the drop or the archive picker.
   */
  const startImport = async (outcome: DropOutcome): Promise<void> => {
    if (outcome.kind === 'problem') {
      setImportState({ kind: 'failure', failure: { code: 'local/drop', message: t(dropProblemKey(outcome.problem)) } })
      setCatalogDialog(true)
      return
    }
    setImportState({ kind: 'busy' })
    setCatalogDialog(true)
    const value = outcome.value
    const preview = value.kind === 'archive'
      ? await props.previewArchive(value.fileName, value.content)
      : await props.previewFolder(value.folderName, value.files)
    setImportState(preview.ok ? { kind: 'preview', preview: preview.value } : { kind: 'failure', failure: preview.failure })
  }

  const installFace: InstallFace = {
    catalogs: props.catalogs,
    repository: props.repository,
    previewRepository: props.previewRepository,
    previewArchive: props.previewArchive,
    previewFolder: props.previewFolder,
    install: props.install,
    removeInstalled: props.removeInstalled,
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
    // A source that offers no skill is nothing to browse: it is hidden whether or
    // not a filter is active, and an added folder that holds no skill stays
    // reachable through the hidden-folders line below.
    return skills.length === 0 ? [] : [{ source, skills }]
  }), [sources, needle, sourceFilter, stateFilter])

  // Added folders whose folder holds no skill are not tiles, but the reader must
  // still be able to drop one, so source mode lists them in one quiet line.
  const emptyFolders = (sources ?? []).filter(source => source.kind === 'folder' && source.skills.length === 0)

  const tileFor = (source: LocalSourceView, skill: LocalSkillView): CatalogTile => ({
    key: skillKey(source.id, skill),
    skill,
    source,
    sourceTitle: titleFor(source),
    state: skillState(skill, source.enabled),
    shadowedTitle: skill.shadowedBy === undefined ? '' : sourceTitleFor(skill.shadowedBy),
  })

  const sections = useMemo((): readonly CatalogSection[] => {
    const tiles = (group: CatalogGroup): readonly CatalogTile[] =>
      group.skills.map(skill => tileFor(group.source, skill))
    if (grouping === 'sources') {
      return groups.map(group => ({
        key: group.source.id,
        listId: `skills-group-${group.source.id}`,
        title: titleFor(group.source),
        count: group.source.skills.length,
        source: group.source,
        tiles: tiles(group),
      }))
    }
    // A category is not a folder: the board buckets the filtered tiles by the
    // category the Host derived, and skills no rule claimed share one last group.
    const buckets = new Map<string, { title: string; tiles: CatalogTile[] }>()
    for (const group of groups) {
      for (const tile of tiles(group)) {
        const id = tile.skill.category ?? ''
        const bucket = buckets.get(id)
        if (bucket === undefined) {
          buckets.set(id, {
            title: tile.skill.category === undefined
              ? t('categoryOther')
              : categoryTitle(tile.skill.category, tile.skill.categoryTitle, t),
            tiles: [tile],
          })
          continue
        }
        bucket.tiles.push(tile)
      }
    }
    const entries = [...buckets.entries()].map(([id, bucket]) => ({ id, ...bucket }))
    const named = entries.filter(entry => entry.id !== '').sort((left, right) => right.tiles.length - left.tiles.length)
    const other = entries.filter(entry => entry.id === '')
    return [...named, ...other].map((entry, index) => ({
      key: entry.id === '' ? CATEGORY_OTHER_KEY : `category:${entry.id}`,
      listId: `skills-category-${String(index)}`,
      title: entry.title,
      count: entry.tiles.length,
      tiles: entry.tiles,
    }))
    // `groups` already follows every search and filter input; titleFor and t are
    // read here so a locale or source-title change renames the sections.
  }, [grouping, groups, sources, t])

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
  const selectedCategory = selectedSkill?.skill.category
  const selectedCategoryTitle = selectedCategory === undefined
    ? undefined
    : categoryTitle(selectedCategory, selectedSkill?.skill.categoryTitle, t)

  /**
   * Remove the skill the confirmation names, then reload the catalog.
   */
  const confirmRemove = async (): Promise<void> => {
    const target = removeTarget
    /* v8 ignore next -- the panel only offers removal for a skill the Host named. */
    if (target?.name === undefined) return
    setRemoving(true)
    try {
      const error = await props.removeInstalled(target.name)
      setRemoveTarget(null)
      if (error !== undefined) {
        setWriteFailure({ name: target.name, error })
        return
      }
      setNotice(t('removedNotice', { name: target.name }))
      actions.select(null)
      await refresh()
    } finally {
      setRemoving(false)
    }
  }

  return (
    <section className={css.tab} data-dragging={dragging}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => { setDragging(false) }}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        void readDrop(event.dataTransfer).then(startImport)
      }}>
      {dragging
        ? (
          <div className={css.dropOverlay} aria-hidden="true">
            <IconArchiveOutlineRegular size={20} />
            <span>{t('dropHint')}</span>
          </div>
        )
        : null}
      <input ref={archiveInput} type="file" accept=".zip,application/zip" className={css.fileInput}
        aria-label={t('chooseArchive')}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file !== undefined) void readArchive(file).then(startImport)
        }} />
      {emptyInventory
        ? null
        : (
          <div className={css.toolbar}>
            <Input type="search" className={css.search as string} icon={<IconSearchOutlineRegular size={14} />} value={query}
              placeholder={t('searchPlaceholder')} aria-label={t('search')}
              onChange={(event) => { setQuery(event.target.value) }} />
            <span className={css.toolbarEnd}>
              <Tooltip label={t('refresh')} side="bottom" delayMs={500} focusDelayMs={500} portal
                disabled={sources === null || reloading}>
                <Button variant="outline" size="sm" className={css.actionButton} aria-label={t('refresh')}
                  aria-busy={reloading} disabled={sources === null || reloading}
                  icon={reloading ? <StateDot state="ongoing" size={13} /> : <IconRefreshOutlineRegular size={13} />}
                  onClick={() => { void refresh() }} />
              </Tooltip>
              <SegmentedControl id="skills-grouping" className={css.groupingWide} label={t('groupingLabel')} value={grouping}
                options={GROUPINGS.map(option => ({ value: option.value, label: t(option.key) }))}
                onChange={(next) => { actions.setGrouping(next) }} />
              <GroupingMenu t={t} grouping={grouping} onChange={(next) => { actions.setGrouping(next) }} />
              <AddSkillsMenu t={t} onAddFolder={() => { setNotice(null); setFolderDialog(true) }}
                onImportArchive={() => { archiveInput.current?.click() }}
                onBrowseCatalog={() => { setCatalogDialog(true) }} createWithAi={createWithAi} />
            </span>
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
              {emptyFolders.length === 0 || grouping !== 'sources'
                ? null
                : (
                  <div className={css.hiddenFolders}>
                    <span className={css.hiddenFoldersLabel}>{t('hiddenFolders')}</span>
                    {emptyFolders.map(folder => (
                      <span key={folder.id} className={css.hiddenFolder}>
                        <code className={css.groupPath} title={t('pathTooltip', { path: folder.path })}>{folder.displayPath}</code>
                        {folder.exists ? null : <span className={css.warning}>{t('notFound')}</span>}
                        <Tooltip label={t('removeFolderHint')} side="bottom" delayMs={500} focusDelayMs={500} portal>
                          <Button variant="ghost" size="sm" className={css.removeButton}
                            aria-label={t('removeFolder', { name: titleFor(folder) })}
                            disabled={busy.includes(folder.id)}
                            icon={<IconTrashOutlineRegular size={14} />}
                            onClick={() => {
                              void withBusy(folder.id, titleFor(folder), () => removeFolder(folder.path))
                            }} />
                        </Tooltip>
                      </span>
                    ))}
                  </div>
                )}
              <div className={css.split} role="tabpanel" id={`skills-grouping-${grouping}-panel`}
                aria-labelledby={`skills-grouping-${grouping}`} data-detail={selectedSkill !== null}>
                <div className={css.list}>
                  {sections.map(section => (
                    <BoardSection
                      key={section.key}
                      t={t}
                      section={section}
                      collapsed={collapsed.includes(section.key)}
                      busy={busy}
                      selected={selected}
                      expanded={expanded}
                      limit={limits[section.key] ?? PAGE_SIZE}
                      onToggleSection={() => { actions.toggleGroup(section.key) }}
                      onSelectSkill={(key) => { actions.select(key === selected ? null : key) }}
                      onToggleDescription={(key) => {
                        setExpanded(previous => previous.includes(key)
                          ? previous.filter(entry => entry !== key)
                          : [...previous, key])
                      }}
                      onToggleSkill={(source, name, next) => {
                        void withBusy(skillIdentity(source.id, name), name, () => setSkill(source.id, name, next))
                      }}
                      onToggleSource={(source, next) => {
                        void withBusy(source.id, section.title, () => setSource(source.id, next))
                      }}
                      onRemoveFolder={(source) => {
                        void withBusy(source.id, section.title, () => removeFolder(source.path))
                      }}
                      onShowMore={() => {
                        setLimits(previous => ({ ...previous, [section.key]: (previous[section.key] ?? PAGE_SIZE) + PAGE_SIZE }))
                      }} />
                  ))}
                </div>
                {selectedSkill === null
                  ? null
                  : (
                    <SkillDetail t={t} sourceTitle={titleFor(selectedSkill.source)} skill={selectedSkill.skill}
                      state={selectedSkill.state}
                      {...selectedCategoryTitle === undefined ? {} : { categoryTitle: selectedCategoryTitle }}
                      onRemove={selectedSkill.skill.provenance === undefined || selectedSkill.skill.name === undefined
                        ? undefined
                        : () => { setRemoveTarget(selectedSkill.skill) }} />
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
      <CatalogDialog t={t} open={catalogDialog} face={installFace}
        initialPreview={importState.kind === 'preview' ? importState.preview : undefined}
        initialBusy={importState.kind === 'busy'}
        initialFailure={importState.kind === 'failure' ? failureSentence(t, importState.failure) : undefined}
        onClose={() => {
          setCatalogDialog(false)
          setImportState({ kind: 'idle' })
        }}
        onInstalled={(names) => {
          setNotice(t('installedNotice', { names: names.join(', ') }))
          void refresh()
        }} />
      <Modal open={removeTarget !== null} onClose={() => { setRemoveTarget(null) }}
        title={t('removeTitle', { name: removeTarget?.name ?? '' })} description={t('removeBody')}
        closeLabel={t('cancel')}
        footer={(
          <>
            <Button variant="outline" size="sm" onClick={() => { setRemoveTarget(null) }}>{t('cancel')}</Button>
            <Button variant="primary" size="sm" disabled={removing} aria-busy={removing}
              onClick={() => { void confirmRemove() }}>
              {t('remove')}
            </Button>
          </>
        )}>
        {null}
      </Modal>
    </section>
  )
}
