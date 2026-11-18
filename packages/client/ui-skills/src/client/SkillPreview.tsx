/**
 * What one confirmed install would write: the source, each skill's name,
 * description, target folder and files, the `SKILL.md` as it would be written,
 * and a warning when the skill ships scripts. Shown inside the install dialog
 * before anything reaches the disk.
 */
import type { ReactNode } from 'react'
import { IconWarningTriangleOutlineRegular, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InstallPreview, InstallSource } from '@deepseek-ai/dsh-skill-install/types'
import { formatSize, type SkillsTranslate } from './skills-catalog.ts'
import css from './SkillPreview.module.css'

/**
 * Render one install preview.
 * @param props.t - the `skills` locale seat.
 * @param props.preview - the preview the Host minted.
 * @returns the preview body.
 */
export function SkillPreview({ t, preview }: {
  readonly t: SkillsTranslate
  readonly preview: InstallPreview
}): ReactNode {
  return (
    <div className={css.preview}>
      <p className={css.source}>
        <span className={css.label}>{t('previewSource')}</span>
        <code className={css.sourceValue}>{sourceReference(preview.source)}</code>
      </p>
      <p className={css.description}>{t('previewDescription')}</p>
      {preview.skills.map(skill => (
        <section key={skill.target} className={css.skill} aria-label={skill.name}>
          <header className={css.head}>
            <h3 className={css.name}>{skill.name}</h3>
            {skill.hasScripts ? <Tag tone="outline">{t('repoScripts')}</Tag> : null}
          </header>
          {skill.description === undefined ? null : <p className={css.text}>{skill.description}</p>}
          <code className={css.target} title={skill.target}>{skill.target}</code>
          <ul className={css.files}>
            {skill.files.map(file => (
              <li key={file.path} className={css.file} data-script={file.isScript}>
                <span className={css.filePath}>{file.path}</span>
                <span className={css.fileSize}>{formatSize(file.size)}</span>
              </li>
            ))}
          </ul>
          {skill.hasScripts
            ? (
              <p className={css.scripts}>
                <IconWarningTriangleOutlineRegular size={14} aria-hidden="true" />
                <span>{t('previewScripts')}</span>
              </p>
            )
            : null}
          <p className={css.label}>{t('previewDocument')}</p>
          <pre className={css.document} dir="auto">{skill.document}</pre>
        </section>
      ))}
    </div>
  )
}

/**
 * Render one install source as the reader sees it.
 * @param source - where the bytes came from.
 * @returns the repository URL, the archive name, or the folder name.
 */
export function sourceReference(source: InstallSource): string {
  switch (source.kind) {
    case 'repository': return `https://github.com/${source.owner}/${source.repo}/${source.folder === '' ? '' : `${source.folder}/`}`
    case 'archive': return source.fileName
    case 'folder': return source.folderName
  }
}
