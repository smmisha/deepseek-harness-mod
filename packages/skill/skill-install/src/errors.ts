/**
 * Typed failures of the skill installer. One class carries every code, because
 * the Skills tab only routes on the code; `target` names the repository, folder,
 * or skill the failure is about so the reader's sentence can quote it.
 *
 * @module @deepseek-ai/dsh-skill-install/errors
 */

import { HarnessError } from '@deepseek-ai/dsh-error'

/** Stable machine-routable failure codes of one install or removal. */
export type SkillInstallCode =
  /** The profile settings service that stores skill switches is not mounted. */
  | 'SKILL_INSTALL_UNAVAILABLE'
  /** The typed text is not a repository the installer can resolve. */
  | 'SKILL_INSTALL_SPEC_INVALID'
  /** The repository, folder, or skill does not exist. */
  | 'SKILL_INSTALL_NOT_FOUND'
  /** GitHub refused the request because the rate limit is spent. */
  | 'SKILL_INSTALL_RATE_LIMITED'
  /** A request failed: refused network, timeout, oversized body, or a redirect. */
  | 'SKILL_INSTALL_NETWORK'
  /** The resolved host is not in the configured allowlist. */
  | 'SKILL_INSTALL_HOST_BLOCKED'
  /** The repository tree came back truncated. */
  | 'SKILL_INSTALL_TREE_TOO_LARGE'
  /** The archive is not a usable zip. */
  | 'SKILL_INSTALL_ARCHIVE_INVALID'
  /** The content holds no readable `SKILL.md` or an unusable skill name. */
  | 'SKILL_INSTALL_INVALID_SKILL'
  /** The target name is taken and no replacement choice was made. */
  | 'SKILL_INSTALL_CONFLICT'
  /** The preview id is unknown or expired. */
  | 'SKILL_INSTALL_PREVIEW_EXPIRED'
  /** The upload exceeds the configured byte cap. */
  | 'SKILL_INSTALL_UPLOAD_TOO_LARGE'
  /** Removal was refused because the folder was not written by this installer. */
  | 'SKILL_INSTALL_NOT_INSTALLED'
  /** Reading or writing the skill folder failed. */
  | 'SKILL_INSTALL_IO_FAILED'

/**
 * One refused install or removal.
 *
 * Nothing is written when this is thrown: the installer writes into a staging
 * folder and moves it into place only after every file and the switch are
 * prepared, so a failure leaves the skill folder as it was.
 */
export class SkillInstallError extends HarnessError {
  /** Stable failure code, narrowed to this package's vocabulary. */
  declare readonly code: SkillInstallCode

  /**
   * @param message - diagnostic naming the concrete failure.
   * @param code - stable failure code the Remote face forwards.
   * @param target - repository, folder, or skill name the failure is about.
   * @param options - standard Error options; `cause` keeps the foreign failure.
   */
  constructor(
    message: string,
    code: SkillInstallCode,
    readonly target?: string,
    options?: ErrorOptions,
  ) {
    super(message, code, options)
  }
}
