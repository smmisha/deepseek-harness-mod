/**
 * Turn the text a reader pastes into a repository the installer can resolve.
 * Accepted forms are `owner/repo`, a GitHub repository URL (optionally a
 * `/tree/<branch>/<path>` link), and an `npx skills add …` command, which names
 * the same repository. Anything else is refused with one code, so the Skills
 * tab can say what it accepts.
 *
 * @module @deepseek-ai/dsh-skill-install/source-spec
 */

import { SkillInstallError } from './errors.ts'
import { group } from './match.ts'

/** One resolved repository reference. */
export interface RepositorySpec {
  /** Repository owner or organization. */
  readonly owner: string
  /** Repository name. */
  readonly repo: string
}

/** GitHub allows letters, digits, dot, hyphen, and underscore in both segments. */
const SEGMENT = /^[A-Za-z0-9._-]+$/u

/** A pasted `npx skills add …` command, with the leading binaries and flags. */
const NPX_COMMAND = /^\$?\s*(?:npx|pnpm\s+dlx|yarn\s+dlx|bunx)\s+(?:--?[\w-]+(?:=\S+)?\s+)*skills\s+add\s+(.*)$/u

/** GitHub repository page or clone URL. */
const GITHUB_URL = /^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)(?:[/?#].*)?$/u

/**
 * Parse the reader's repository text.
 * @param input - `owner/repo`, a GitHub repository URL, or an `npx skills add` command.
 * @returns the owner and repository name.
 * @throws {SkillInstallError} `SKILL_INSTALL_SPEC_INVALID` when the text names no
 *   repository, or carries another scheme or host, so the installer never
 *   fetches from a site the reader's text merely resembles.
 */
export function parseRepositorySpec(input: string): RepositorySpec {
  const text = input.trim()
  if (text.length === 0) throw invalid(input, 'the repository is empty')
  const command = NPX_COMMAND.exec(text)
  if (command === null) return parseReference(text, input)
  const argument = (group(command, 1).split(/\s+/u).find(part => !part.startsWith('-')) ?? '').trim()
  if (argument.length === 0) throw invalid(input, 'the command names no repository')
  return parseReference(argument, input)
}

/**
 * Parse one repository reference, with or without its GitHub URL wrapper.
 * @param reference - bare `owner/repo`, a GitHub URL, or `owner/repo.git`.
 * @param input - the reader's original text, quoted when refused.
 * @returns the owner and repository name.
 */
function parseReference(reference: string, input: string): RepositorySpec {
  const url = GITHUB_URL.exec(reference)
  if (url !== null) return validated(group(url, 1), stripGitSuffix(group(url, 2)), input)
  if (reference.includes('://') || reference.includes('@')) {
    throw invalid(input, 'only github.com repositories are resolved')
  }
  const segments = reference.replace(/^\/+|\/+$/gu, '').split('/')
  const [owner = '', repo = ''] = segments
  // A `/tree/<branch>/<path>` tail names where in the repository to look, not a
  // different repository; the resolver lists every skill folder either way.
  return validated(owner, stripGitSuffix(repo), input)
}

/**
 * Remove one `.git` suffix a clone URL carries.
 * @param repo - repository segment as written.
 * @returns the repository name without the suffix.
 */
function stripGitSuffix(repo: string): string {
  return repo.endsWith('.git') ? repo.slice(0, -'.git'.length) : repo
}

/**
 * Validate one resolved reference.
 * @param owner - repository owner.
 * @param repo - repository name.
 * @param input - the reader's original text, quoted when refused.
 * @returns the owner and repository name.
 */
function validated(owner: string, repo: string, input: string): RepositorySpec {
  if (!SEGMENT.test(owner) || !SEGMENT.test(repo) || owner === '.' || owner === '..' || repo === '.' || repo === '..') {
    throw invalid(input, 'the repository name carries characters a GitHub repository cannot have')
  }
  return { owner, repo }
}

/**
 * Refuse one repository text.
 * @param input - the reader's original text.
 * @param reason - what is wrong with it.
 * @returns the typed failure to throw.
 */
function invalid(input: string, reason: string): SkillInstallError {
  return new SkillInstallError(
    `"${input}" is not a repository reference: ${reason}; enter owner/repo, a GitHub URL, or an npx skills add command`,
    'SKILL_INSTALL_SPEC_INVALID',
    input,
  )
}
