/**
 * Host owner of the `skillInstall` Remote namespace: the Skills tab's only path
 * to the installer. Each Remote failure is a {@link SkillInstallError} code
 * translated into the namespace's own `skill-install/*` vocabulary, so the tab
 * can answer with one localized sentence and one next action.
 *
 * @module @deepseek-ai/dsh-skill-install/controller
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { ConfigSchema, type Config } from './config.ts'
import type { SkillInstallCode } from './errors.ts'
import { SkillInstallError } from './errors.ts'
import { SkillInstaller, type SkillInstallerInternals } from './service.ts'
import type {
  DroppedFile, InstallPreview, InstallResult, RepositoryView, SkillCatalogView, SkillInstallRemoteCode,
} from './types.ts'

/** Every installer failure code, in the namespace's wire vocabulary. */
const REMOTE_CODES: Readonly<Record<SkillInstallCode, SkillInstallRemoteCode>> = {
  SKILL_INSTALL_UNAVAILABLE: 'skill-install/unavailable',
  SKILL_INSTALL_SPEC_INVALID: 'skill-install/spec-invalid',
  SKILL_INSTALL_NOT_FOUND: 'skill-install/not-found',
  SKILL_INSTALL_RATE_LIMITED: 'skill-install/rate-limited',
  SKILL_INSTALL_NETWORK: 'skill-install/network',
  SKILL_INSTALL_HOST_BLOCKED: 'skill-install/host-blocked',
  SKILL_INSTALL_TREE_TOO_LARGE: 'skill-install/tree-too-large',
  SKILL_INSTALL_ARCHIVE_INVALID: 'skill-install/archive-invalid',
  SKILL_INSTALL_INVALID_SKILL: 'skill-install/invalid-skill',
  SKILL_INSTALL_CONFLICT: 'skill-install/conflict',
  SKILL_INSTALL_PREVIEW_EXPIRED: 'skill-install/preview-expired',
  SKILL_INSTALL_UPLOAD_TOO_LARGE: 'skill-install/upload-too-large',
  SKILL_INSTALL_NOT_INSTALLED: 'skill-install/not-installed',
  SKILL_INSTALL_IO_FAILED: 'skill-install/io-failed',
}

/**
 * Host owner of the `skillInstall` Remote namespace.
 *
 * The installer itself is mounted beside this controller as `ctx.skillInstall`;
 * this class only translates the wire calls and the failures.
 */
export class SkillInstallController extends TypertRemoteService {
  /** Validated plugin configuration, shared with the installer. */
  static readonly Config = ConfigSchema

  /** The installer this namespace answers with; it owns every repository read and folder write. */
  private readonly installer: SkillInstaller

  /**
   * Register the namespace and build the installer that answers it.
   * @param ctx - Host context the installer runs on.
   * @param config - validated configuration: catalogs, network policy, and limits.
   * @param internals - Host integrations a test replaces.
   */
  constructor(ctx: Context, config: Config = {}, internals: SkillInstallerInternals = {}) {
    super(ctx, 'skillInstallController', { namespace: 'skillInstall' })
    this.installer = new SkillInstaller(ctx, config, internals)
  }

  /**
   * Catalogs configured for this deployment.
   * @returns the catalog rows the Skills tab lists.
   */
  @Remote
  async catalogs(): Promise<readonly SkillCatalogView[]> {
    return await this.translated(() => this.installer.catalogs())
  }

  /**
   * Resolve a repository reference and list the skill folders it holds.
   * @param input - `owner/repo`, a GitHub repository URL, or an `npx skills add` command.
   * @returns the pinned commit and every folder holding a `SKILL.md`.
   */
  @Remote
  async repository(input: string): Promise<RepositoryView> {
    return await this.translated(() => this.installer.resolveRepository(input))
  }

  /**
   * Preview one skill folder of a repository.
   * @param input - repository reference, as typed by the reader.
   * @param folder - folder the previous resolution listed.
   * @returns the preview the reader confirms.
   */
  @Remote
  async previewRepository(input: string, folder: string): Promise<InstallPreview> {
    return await this.translated(() => this.installer.previewRepository(input, folder))
  }

  /**
   * Preview the skills one `.zip` archive holds.
   * @param fileName - name the archive was chosen or dropped under.
   * @param content - base64 archive bytes.
   * @returns the preview the reader confirms.
   */
  @Remote
  async previewArchive(fileName: string, content: string): Promise<InstallPreview> {
    return await this.translated(() => this.installer.previewArchive(fileName, content))
  }

  /**
   * Preview the skills one dropped folder holds.
   * @param folderName - name the folder was dropped under.
   * @param files - the folder's files, paths relative to the folder.
   * @returns the preview the reader confirms.
   */
  @Remote
  async previewFolder(folderName: string, files: readonly DroppedFile[]): Promise<InstallPreview> {
    return await this.translated(() => this.installer.previewFolder(folderName, files))
  }

  /**
   * Write one confirmed preview.
   * @param previewId - id of the preview the reader confirmed.
   * @param name - new name for a single-skill import; the source name is kept when undefined.
   * @param replace - whether an existing folder of the same name is replaced.
   * @returns the skills written, each recorded switched off.
   */
  @Remote
  async install(previewId: string, name: string | undefined, replace: boolean): Promise<InstallResult> {
    return await this.translated(() => this.installer.install(previewId, name, replace))
  }

  /**
   * Remove one skill this installer wrote; a folder the reader added is never removed.
   * @param name - installed skill name.
   */
  @Remote
  async remove(name: string): Promise<void> {
    await this.translated(() => this.installer.remove(name))
  }

  /**
   * Run one installer call, translating its typed failures for the wire.
   * @param operation - the call to run.
   * @returns the call's result.
   */
  private async translated<Value>(operation: () => Value | Promise<Value>): Promise<Value> {
    try {
      return await operation()
    } catch (error) {
      if (!(error instanceof SkillInstallError)) throw error
      throw new RemoteError(
        REMOTE_CODES[error.code],
        error.message,
        error.target === undefined ? {} : { target: error.target },
        { cause: error },
      )
    }
  }
}
