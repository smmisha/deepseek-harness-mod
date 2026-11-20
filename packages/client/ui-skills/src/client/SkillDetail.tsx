/**
 * The skill detail panel: the open skill's full description with its language,
 * its source, its path with a copy action, the files it ships with a script
 * mark, and where it came from. It is a region beside the catalog inside the
 * tab rather than a modal, so the reader keeps the list and the row they came
 * from.
 */
import type { ReactNode } from 'react'
import {
  Button, IconCheckOutlineRegular, IconCopyOutlineRegular, IconTrashOutlineRegular, IconWarningTriangleOutlineRegular,
  StateDot, Tag, useClipboardCopy,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { LocalSkillView } from '@deepseek-ai/dsh-skill-filesystem/types'
import {
  formatDate, formatSize, SKILL_STATE_KEYS, skillStateDot, skillTitle, type SkillState, type SkillsTranslate,
} from './skills-catalog.ts'
import css from './SkillDetail.module.css'

/** Element id of the detail panel, so the row that opens it can name the region it controls. */
export const DETAIL_PANEL_ID = 'skills-detail'

/**
 * Render one skill's detail panel.
 * @param props.t - the `skills` locale seat.
 * @param props.sourceTitle - localized name of the source that discovered the skill.
 * @param props.categoryTitle - localized name of the skill's category, when the Host described one.
 * @param props.skill - the open skill row.
 * @param props.state - the row state the panel explains.
 * @param props.onRemove - asks the tab to confirm removing an installed skill; absent
 *   for a skill this app did not install, because its files are never deleted.
 * @returns the panel region.
 */
export function SkillDetail({ t, sourceTitle, categoryTitle, skill, state, onRemove }: {
  readonly t: SkillsTranslate
  readonly sourceTitle: string
  readonly categoryTitle?: string
  readonly skill: LocalSkillView
  readonly state: SkillState
  readonly onRemove?: (() => void) | undefined
}): ReactNode {
  const title = skillTitle(skill)
  const { copied, onCopy } = useClipboardCopy(skill.path)
  const language = skill.language
  const files = skill.files ?? []
  const scripts = files.filter(file => file.isScript).length
  const provenance = skill.provenance
  return (
    <aside id={DETAIL_PANEL_ID} className={css.detail} aria-label={title}>
      <h2 className={css.title}>{title}</h2>
      <p className={css.subtitle}>
        <span>{sourceTitle}</span>
        {categoryTitle === undefined
          ? null
          : (
            <>
              <span aria-hidden="true">{' · '}</span>
              <span>{categoryTitle}</span>
            </>
          )}
        <span aria-hidden="true">{' · '}</span>
        <span className={css.state} data-state={state}>
          <StateDot state={skillStateDot(state)} />
          {t(SKILL_STATE_KEYS[state])}
        </span>
      </p>
      <section className={css.section} aria-label={t('detailDescription')}>
        <p className={css.label} aria-hidden="true">{t('detailDescription')}</p>
        <p className={css.description} dir="auto" lang={language}>{skill.description ?? t('noDescription')}</p>
        <span className={css.languageTag} lang={language}>
          <Tag tone="neutral">{language === undefined ? t('descFrom') : `${language} · ${t('descFrom')}`}</Tag>
        </span>
      </section>
      <section className={css.section} aria-label={t('detailPath')}>
        <p className={css.label} aria-hidden="true">{t('detailPath')}</p>
        <div className={css.pathChip}>
          <code className={css.path} title={t('pathTooltip', { path: skill.path })}>{skill.displayPath ?? skill.path}</code>
          <Button variant="ghost" size="sm" className={css.copy}
            icon={copied ? <IconCheckOutlineRegular size={14} /> : <IconCopyOutlineRegular size={14} />}
            aria-label={copied ? t('copied') : t('copyPath')} onClick={onCopy} />
        </div>
      </section>
      {files.length === 0
        ? null
        : (
          <section className={css.section} aria-label={t('detailFiles')}>
            <p className={css.label} aria-hidden="true">{t('detailFiles')}</p>
            <ul className={css.files}>
              {files.map(file => (
                <li key={file.path} className={css.file} data-script={file.isScript}>
                  <span className={css.filePath}>{file.path}</span>
                  <span className={css.fileSize}>{formatSize(file.size)}</span>
                </li>
              ))}
            </ul>
            {scripts === 0
              ? null
              : (
                <p className={css.scripts}>
                  <IconWarningTriangleOutlineRegular size={14} aria-hidden="true" />
                  <span>{t('scriptsCount', { count: String(scripts) })}</span>
                  <span>{t('scriptsNote')}</span>
                </p>
              )}
          </section>
        )}
      {provenance === undefined
        ? null
        : (
          <section className={css.section} aria-label={t('detailOrigin')}>
            <p className={css.label} aria-hidden="true">{t('detailOrigin')}</p>
            <p className={css.provenance}>
              <code>{provenance.url}</code>
              {provenance.commit === undefined ? null : <span className={css.commit}>{provenance.commit}</span>}
            </p>
            {provenance.installedAt === undefined
              ? null
              : <p className={css.provenance}>{t('installedOn', { date: formatDate(provenance.installedAt) })}</p>}
            {onRemove === undefined
              ? null
              : (
                <Button variant="outline" size="sm" className={css.remove}
                  icon={<IconTrashOutlineRegular size={13} />} onClick={onRemove}>
                  {t('removeSkill')}
                </Button>
              )}
          </section>
        )}
    </aside>
  )
}
