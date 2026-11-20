/**
 * Source marks: one 20px box in one ink for the source of a skill row, a group
 * header, or the quiet row under the empty state. Official brand artwork ships
 * only where the brand's own policy permits it; every other source takes a
 * monogram or a line glyph drawn by this package. Each mark's source URL,
 * licence, and conditions are recorded in the package README.
 */
import type { CSSProperties, ReactNode } from 'react'
import { IconFolderOpenOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LocalSourceView } from '@deepseek-ai/dsh-skill-filesystem/types'
import codexMark from './assets/openai-codex.svg'
import githubMark from './assets/github.svg'
import opencodeMark from './assets/opencode.svg'
import css from './SourceMark.module.css'

/**
 * Official monochrome marks, by configured application id. `copilot` uses the
 * GitHub mark, which is that product's lockup; `github` names the repository
 * source itself.
 */
const OFFICIAL_MARKS: Readonly<Record<string, string>> = {
  codex: codexMark,
  copilot: githubMark,
  github: githubMark,
  opencode: opencodeMark,
}

/** Monograms drawn here for brands that publish no mark grant. */
const MONOGRAMS: Readonly<Record<string, string>> = {
  'claude-code': 'C',
  'gemini-cli': 'G',
  antigravity: 'A',
}

/** Monogram the harness's own folders take: they are home-relative roots. */
const HARNESS_GLYPH = '~'

/** How one source draws its mark. */
export type SourceMarkSpec =
  /** An official vendor asset, masked so it takes the row's ink. */
  | { readonly kind: 'official'; readonly asset: string }
  /** A monogram drawn by this package. */
  | { readonly kind: 'monogram'; readonly glyph: string }
  /** A neutral line glyph for a folder the reader added. */
  | { readonly kind: 'line' }

/**
 * Mark one configured application draws.
 * @param applicationId - configured application id, such as `claude-code`.
 * @returns the official asset, a known monogram, or the id's first letter.
 */
export function applicationMarkSpec(applicationId: string): SourceMarkSpec {
  const asset = OFFICIAL_MARKS[applicationId]
  if (asset !== undefined) return { kind: 'official', asset }
  return { kind: 'monogram', glyph: MONOGRAMS[applicationId] ?? applicationId.slice(0, 1).toUpperCase() }
}

/**
 * Mark one source row draws.
 * @param source - the described source row, or only the fields the mark needs.
 * @returns the mark for that source.
 */
export function sourceMarkSpec(
  source: Pick<LocalSourceView, 'id' | 'kind'> & Partial<Pick<LocalSourceView, 'applicationId'>>,
): SourceMarkSpec {
  if (source.kind === 'folder') return { kind: 'line' }
  if (source.applicationId !== undefined) return applicationMarkSpec(source.applicationId)
  return source.kind === 'application'
    ? applicationMarkSpec(source.id)
    : { kind: 'monogram', glyph: HARNESS_GLYPH }
}

/**
 * Render one source mark.
 * @param props.spec - the mark the source draws.
 * @param props.small - render at 16px for the empty state's quiet source row.
 * @returns the mark element, hidden from assistive technology.
 */
export function SourceMark({ spec, small = false }: {
  readonly spec: SourceMarkSpec
  readonly small?: boolean
}): ReactNode {
  const className = `${css.mark} ${small ? css.small : ''}`
  switch (spec.kind) {
    case 'official': {
      // A mask keeps the vendor's silhouette and lets the row's token ink show through,
      // so one asset serves both themes and every row state.
      const style = { maskImage: `url("${spec.asset}")`, WebkitMaskImage: `url("${spec.asset}")` } as CSSProperties
      return <span className={`${className} ${css.official}`} style={style} aria-hidden="true" />
    }
    case 'monogram':
      return <span className={`${className} ${css.monogram}`} aria-hidden="true">{spec.glyph}</span>
    case 'line':
      return (
        <span className={`${className} ${css.line}`} aria-hidden="true">
          <IconFolderOpenOutlineRegular size={20} />
        </span>
      )
  }
}
