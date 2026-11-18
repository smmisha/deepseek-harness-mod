/**
 * Install vocabulary shared by the Skills tab and its catalog dialog: the
 * outcomes the Host face answers with, and the sentence each Host failure code
 * becomes. A code the tab does not know falls back to the failure's own text.
 */
import type { InstallPreview, InstallResult, RepositoryView, SkillCatalogView } from '@deepseek-ai/dsh-skill-install/types'
import type { SkillsLocaleKey } from './locales.ts'
import type { SkillsTranslate } from './skills-catalog.ts'

/** One Host failure, as the Remote face reported it. */
export interface FaceFailure {
  /** Stable `skill-install/*` code. */
  readonly code: string
  /** Diagnostic text, shown only for a code the tab does not know. */
  readonly message: string
}

/** One face call's outcome. */
export type FaceResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly failure: FaceFailure }

/** The install surface the tab reads. */
export interface InstallFace {
  /** Catalogs this deployment offers. */
  readonly catalogs: () => Promise<FaceResult<readonly SkillCatalogView[]>>
  /** Resolve a repository reference into its skill folders. */
  readonly repository: (input: string) => Promise<FaceResult<RepositoryView>>
  /** Preview one repository skill folder. */
  readonly previewRepository: (input: string, folder: string) => Promise<FaceResult<InstallPreview>>
  /** Preview the skills one `.zip` archive holds. */
  readonly previewArchive: (fileName: string, content: string) => Promise<FaceResult<InstallPreview>>
  /** Preview the skills one dropped folder holds. */
  readonly previewFolder: (
    folderName: string,
    files: readonly { readonly path: string; readonly content: string }[],
  ) => Promise<FaceResult<InstallPreview>>
  /** Write one confirmed preview. */
  readonly install: (
    previewId: string,
    name: string | undefined,
    replace: boolean,
  ) => Promise<FaceResult<InstallResult>>
  /** Remove one installed skill; resolves to a failure message when the Host refused. */
  readonly removeInstalled: (name: string) => Promise<string | undefined>
}

/** Locale key of each Host failure code. */
const FAILURE_KEYS: Readonly<Record<string, SkillsLocaleKey>> = {
  'skill-install/unavailable': 'installUnavailable',
  'skill-install/spec-invalid': 'installSpecInvalid',
  'skill-install/not-found': 'installNotFound',
  'skill-install/rate-limited': 'installRateLimited',
  'skill-install/network': 'installNetwork',
  'skill-install/host-blocked': 'installHostBlocked',
  'skill-install/tree-too-large': 'installTreeTooLarge',
  'skill-install/archive-invalid': 'installArchiveInvalid',
  'skill-install/invalid-skill': 'installInvalidSkill',
  'skill-install/conflict': 'installConflict',
  'skill-install/preview-expired': 'installPreviewExpired',
  'skill-install/upload-too-large': 'installUploadTooLarge',
  'skill-install/not-installed': 'installNotInstalled',
  'skill-install/io-failed': 'installIoFailed',
}

/**
 * Turn one Host failure into the sentence the reader acts on.
 * @param t - `skills` locale seat.
 * @param failure - code and diagnostic the Host answered with.
 * @returns the localized sentence, with the diagnostic only for an unknown code.
 */
export function failureSentence(t: SkillsTranslate, failure: FaceFailure): string {
  const key = FAILURE_KEYS[failure.code]
  return key === undefined ? t('installFailed', { error: failure.message }) : t(key)
}
