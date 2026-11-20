/**
 * Skill installation for DeepSeek Harness: resolve skills from a GitHub
 * repository or an imported `.zip` archive, preview them, write them under the
 * harness home's `skills` folder switched off, and remove the ones this app
 * installed.
 *
 * The package is one capability seam: {@link SkillInstallController} owns the
 * `skillInstall` Remote namespace, {@link SkillInstaller} is the service that
 * resolves, previews, writes, and removes, and the Skills tab is the Consumer.
 *
 * @module @deepseek-ai/dsh-skill-install
 */

export { SkillInstallController as default } from './controller.ts'
export type * from './types.ts'
export type { Config } from './config.ts'
export type { SkillInstallService } from './service.ts'
