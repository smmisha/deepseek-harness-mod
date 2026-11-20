/**
 * The install dialog: browse the configured catalogs, resolve a repository and
 * preview one of its skill folders, or review what a dropped `.zip` or folder
 * would write. Nothing is written until the reader confirms, and a name clash
 * asks whether to replace, install under a new name, or cancel.
 */
import { useEffect, useState, type ReactNode } from 'react'
import {
  Button, IconArchiveOutlineRegular, IconChevronRightOutlineRegular, IconGlobeOutlineRegular,
  IconWarningTriangleOutlineRegular, Input, Modal, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InstallPreview, RepositoryView, SkillCatalogView } from '@deepseek-ai/dsh-skill-install/types'
import { failureSentence, type FaceFailure, type InstallFace } from './skills-install.ts'
import { SkillPreview } from './SkillPreview.tsx'
import type { SkillsTranslate } from './skills-catalog.ts'
import css from './CatalogDialog.module.css'

/** What the dialog is showing. */
type Step =
  | { readonly kind: 'catalog' }
  | { readonly kind: 'repository'; readonly input: string; readonly view: RepositoryView }
  | { readonly kind: 'preview'; readonly preview: InstallPreview }
  | { readonly kind: 'installed'; readonly names: readonly string[] }

/** Props of the install dialog. */
export interface CatalogDialogProps {
  /** The `skills` locale seat. */
  readonly t: SkillsTranslate
  /** Whether the dialog is open. */
  readonly open: boolean
  /** The Host surface the dialog reads and writes through. */
  readonly face: InstallFace
  /** Preview the tab already read from a drop or a chosen archive, when one exists. */
  readonly initialPreview?: InstallPreview | undefined
  /** Whether the tab is still reading a drop it will preview here. */
  readonly initialBusy?: boolean | undefined
  /** Failure the tab hit before the dialog opened. */
  readonly initialFailure?: string | undefined
  /** Close the dialog. */
  readonly onClose: () => void
  /** Called with the names an install wrote, so the tab reloads and says what happened. */
  readonly onInstalled: (names: readonly string[]) => void
}

/**
 * Render the install dialog.
 * @param props - the locale seat, the Host face, and the entry state the tab supplies.
 * @returns the dialog, or nothing while it is closed.
 */
export function CatalogDialog({
  t, open, face, initialPreview, initialBusy = false, initialFailure, onClose, onInstalled,
}: CatalogDialogProps): ReactNode {
  const [step, setStep] = useState<Step>({ kind: 'catalog' })
  const [busy, setBusy] = useState(initialBusy)
  const [failure, setFailure] = useState<string | null>(initialFailure ?? null)
  const [input, setInput] = useState('')
  const [newName, setNewName] = useState('')

  useEffect(() => {
    if (!open) return
    setStep(initialPreview === undefined ? { kind: 'catalog' } : { kind: 'preview', preview: initialPreview })
    setBusy(initialBusy)
    setFailure(initialFailure ?? null)
    setInput('')
    setNewName('')
  }, [open, initialPreview, initialBusy, initialFailure])

  /** Run one Host call, reporting a refusal in place. */
  const run = async <Value,>(call: () => Promise<{ ok: true; value: Value } | { ok: false; failure: FaceFailure }>):
  Promise<Value | undefined> => {
    setBusy(true)
    setFailure(null)
    try {
      const outcome = await call()
      if (outcome.ok) return outcome.value
      setFailure(failureSentence(t, outcome.failure))
      return undefined
    } finally {
      setBusy(false)
    }
  }

  const resolve = async (reference: string): Promise<void> => {
    const view = await run(() => face.repository(reference))
    if (view !== undefined) setStep({ kind: 'repository', input: reference, view })
  }

  const preview = async (reference: string, folder: string): Promise<void> => {
    const read = await run(() => face.previewRepository(reference, folder))
    if (read !== undefined) setStep({ kind: 'preview', preview: read })
  }

  const install = async (name: string | undefined, replace: boolean): Promise<void> => {
    /* v8 ignore next -- the footer only offers install while a preview is open. */
    if (step.kind !== 'preview') return
    const result = await run(() => face.installSkill(step.preview.id, name, replace))
    if (result === undefined) return
    const names = result.installed.map(skill => skill.name)
    setStep({ kind: 'installed', names })
    onInstalled(names)
  }

  const conflicting = step.kind === 'preview' ? step.preview.skills.filter(skill => skill.conflict) : []
  const conflict = conflicting.length > 0
  const title = conflicting[0] === undefined ? t('catalogTitle') : t('conflictTitle', { name: conflicting[0].name })

  return (
    <Modal open={open} onClose={onClose} title={title} closeLabel={t('cancel')}
      className={css.dialog as string}
      footer={open
        ? (
          <Footer
            t={t}
            step={step}
            busy={busy}
            conflict={conflict}
            canInstall={step.kind === 'preview' && !conflict}
            newName={newName}
            onClose={onClose}
            onBack={() => { setStep({ kind: 'catalog' }); setFailure(null) }}
            onInstall={() => { void install(undefined, false) }}
            onReplace={() => { void install(undefined, true) }}
            onRename={() => { void install(newName.trim(), false) }}
            onRenameChange={setNewName}
            onDone={() => { onClose() }} />
        )
        : undefined}>
      {open ? renderBody() : null}
    </Modal>
  )

  /** The dialog body for the current step. */
  function renderBody(): ReactNode {
    return (
      <>
        {failure === null
          ? null
          : (
            <p className={css.alert} role="alert">
              <IconWarningTriangleOutlineRegular size={14} aria-hidden="true" />
              <span>{failure}</span>
            </p>
          )}
        {step.kind === 'catalog'
          ? (
            <CatalogList t={t} face={face} busy={busy} input={input} onInput={setInput}
              onResolve={(reference) => { void resolve(reference) }} />
          )
          : null}
        {step.kind === 'repository'
          ? (
            <RepositorySkills t={t} view={step.view} busy={busy}
              onPreview={(folder) => { void preview(step.input, folder) }} />
          )
          : null}
        {step.kind === 'preview' ? <SkillPreview t={t} preview={step.preview} /> : null}
        {step.kind === 'preview' && conflict ? <p className={css.status}>{t('conflictBody')}</p> : null}
        {step.kind === 'installed'
          ? (
            <p className={css.status} role="status">
              {t('installedNotice', { names: step.names.join(', ') })}
            </p>
          )
          : null}
        {step.kind === 'catalog' || step.kind === 'repository' || step.kind === 'preview' ? (
          <p className={css.hint}>{t('installHint')}</p>
        ) : null}
      </>
    )
  }
}

/** The dialog's action row, which changes with the step. */
function Footer({
  t, step, busy, conflict, canInstall, newName, onClose, onBack, onInstall, onReplace, onRename, onRenameChange,
  onDone,
}: {
  readonly t: SkillsTranslate
  readonly step: Step
  readonly busy: boolean
  readonly conflict: boolean
  readonly canInstall: boolean
  readonly newName: string
  readonly onClose: () => void
  readonly onBack: () => void
  readonly onInstall: () => void
  readonly onReplace: () => void
  readonly onRename: () => void
  readonly onRenameChange: (name: string) => void
  readonly onDone: () => void
}): ReactNode {
  if (step.kind === 'installed') {
    return <Button variant="primary" size="sm" onClick={onDone}>{t('done')}</Button>
  }
  if (step.kind === 'catalog') {
    return <Button variant="outline" size="sm" onClick={onClose}>{t('close')}</Button>
  }
  if (step.kind === 'repository') {
    return (
      <>
        <Button variant="outline" size="sm" disabled={busy} onClick={onBack}>{t('back')}</Button>
        <Button variant="outline" size="sm" onClick={onClose}>{t('cancel')}</Button>
      </>
    )
  }
  if (!conflict) {
    return (
      <>
        <Button variant="outline" size="sm" disabled={busy} onClick={onBack}>{t('back')}</Button>
        <Button variant="primary" size="sm" disabled={busy || !canInstall} aria-busy={busy} onClick={onInstall}>
          {busy ? t('installing') : t('install')}
        </Button>
      </>
    )
  }
  return (
    <div className={css.conflictActions}>
      <label className={css.nameField}>
        <span>{t('conflictNameLabel')}</span>
        <Input value={newName} spellCheck={false} placeholder={t('conflictNamePlaceholder')}
          onChange={(event) => { onRenameChange(event.target.value) }} />
      </label>
      <Button variant="outline" size="sm" disabled={busy || newName.trim().length === 0} onClick={onRename}>
        {t('conflictRename')}
      </Button>
      <Button variant="primary" size="sm" disabled={busy} onClick={onReplace}>{t('conflictReplace')}</Button>
      <Button variant="ghost" size="sm" onClick={onClose}>{t('cancel')}</Button>
    </div>
  )
}

/** The catalog list: configured sources, each offering what it supports. */
function CatalogList({
  t, face, busy, input, onInput, onResolve,
}: {
  readonly t: SkillsTranslate
  readonly face: InstallFace
  readonly busy: boolean
  readonly input: string
  readonly onInput: (value: string) => void
  readonly onResolve: (reference: string) => void
}): ReactNode {
  const [catalogs, setCatalogs] = useState<readonly SkillCatalogView[] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void face.catalogs().then((outcome) => {
      if (!live) return
      if (outcome.ok) setCatalogs(outcome.value)
      else setFailure(failureSentence(t, outcome.failure))
    })
    return () => { live = false }
  }, [face, t])
  return (
    <div className={css.catalog}>
      <p className={css.description}>{t('catalogDescription')}</p>
      {failure === null ? null : <p className={css.alert} role="alert">{failure}</p>}
      <ul className={css.catalogs}>
        {(catalogs ?? []).map(catalog => (
          <li key={catalog.id} className={css.catalogRow} data-searchable={catalog.searchable}>
            <span className={css.catalogName}>
              {catalog.title}
              {catalog.kind === 'recommended' ? <Tag tone="neutral">{t('catalogRecommended')}</Tag> : null}
            </span>
            {catalog.kind === 'link'
              ? (
                <span className={css.catalogNote}>
                  <span>{t('catalogLinkOnly')}</span>
                  <Button variant="outline" size="sm" icon={<IconGlobeOutlineRegular size={13} />}
                    onClick={() => { openInBrowser(catalog.homepage) }}>
                    {t('catalogOpenBrowser')}
                  </Button>
                </span>
              )
              : null}
            {catalog.kind === 'recommended'
              ? <RecommendedRow t={t} catalog={catalog} busy={busy} onResolve={onResolve} />
              : null}
            {catalog.kind === 'github'
              ? (
                <form className={css.repositoryForm}
                  onSubmit={(event) => { event.preventDefault(); onResolve(input.trim()) }}>
                  <label className={css.repoLabel} htmlFor="skills-repository">{t('repoLabel')}</label>
                  <div className={css.repoRow}>
                    <Input id="skills-repository" data-modal-autofocus value={input} spellCheck={false}
                      placeholder={t('repoPlaceholder')} aria-label={t('repoLabel')}
                      onChange={(event) => { onInput(event.target.value) }} />
                    <Button variant="primary" size="sm" type="submit"
                      disabled={busy || input.trim().length === 0}>
                      {busy ? t('repoResolving') : t('repoResolve')}
                    </Button>
                  </div>
                </form>
              )
              : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Open one catalog page in the browser.
 * @param homepage - configured HTTPS page.
 */
function openInBrowser(homepage: string): void {
  window.open(homepage, '_blank', 'noopener,noreferrer')
}

/** The row a recommended catalog offers: its repository, listed as skills. */
function RecommendedRow({ t: _t, catalog, busy, onResolve }: {
  readonly t: SkillsTranslate
  readonly catalog: SkillCatalogView
  readonly busy: boolean
  readonly onResolve: (reference: string) => void
}): ReactNode {
  const repository = catalog.repository
  if (repository === undefined) return null
  return (
    <Button variant="outline" size="sm" icon={<IconChevronRightOutlineRegular size={13} />}
      disabled={busy} onClick={() => { onResolve(repository) }}>
      {repository}
    </Button>
  )
}

/** The skill folders one resolved repository holds. */
function RepositorySkills({ t, view, busy, onPreview }: {
  readonly t: SkillsTranslate
  readonly view: RepositoryView
  readonly busy: boolean
  readonly onPreview: (folder: string) => void
}): ReactNode {
  if (view.skills.length === 0) return <p className={css.status}>{t('repoEmpty')}</p>
  return (
    <ul className={css.skills}>
      {view.skills.map(skill => (
        <li key={skill.folder} className={css.skillRow}>
          <span className={css.skillIdent}>
            <span className={css.skillName}>{skill.name}</span>
            <span className={css.skillFolder}>{skill.folder}</span>
          </span>
          <span className={css.skillMeta}>
            {t('repoFiles', { count: String(skill.fileCount) })}
            {skill.hasScripts ? <span className={css.scripts}>{t('repoScripts')}</span> : null}
          </span>
          <Button variant="outline" size="sm" icon={<IconArchiveOutlineRegular size={13} />}
            disabled={busy} onClick={() => { onPreview(skill.folder) }}>
            {t('previewTitle')}
          </Button>
        </li>
      ))}
    </ul>
  )
}
