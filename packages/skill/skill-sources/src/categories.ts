/**
 * Category rules for local skills: which name tokens and author-declared words
 * put a skill in one reader-facing category.
 *
 * The rules are deployment configuration, not discovery logic. A local provider
 * derives the candidate word from a skill's frontmatter or name and looks it up
 * here; the Skills tab groups by the identity a rule reports.
 *
 * @module
 */

/** One configured skill category. */
export interface SkillCategory {
  /** Stable identity the Skills tab groups by; the client translates the ids it knows. */
  readonly id: string
  /** Reader-facing name, used when the client does not translate `id`. */
  readonly title: string
  /** Skill-name prefixes this category claims, matched against the part of a name after any namespace and before its first `-`. */
  readonly prefixes?: string[]
  /** Plugin namespaces this category claims, matched against the `plugin:` part of a namespaced skill name. */
  readonly namespaces?: string[]
}

/** A built-in rule with both token lists written out, so the schema default is complete. */
interface BuiltInSkillCategory {
  readonly id: string
  readonly title: string
  readonly prefixes: readonly string[]
  readonly namespaces: readonly string[]
}

/**
 * Categories a profile ships without configuration. The Skills tab localizes
 * every id here; a deployment adds rules for its own skills and may replace this
 * list to rename or regroup the built-in categories.
 */
export const DEFAULT_SKILL_CATEGORIES: readonly BuiltInSkillCategory[] = [
  { id: 'google-cloud', title: 'Google Cloud', prefixes: ['gcp', 'google', 'bigquery', 'gemini'], namespaces: [] },
  { id: 'firebase', title: 'Firebase', prefixes: ['firebase'], namespaces: [] },
  {
    id: 'video',
    title: 'Video and animation',
    prefixes: ['hyperframes', 'remotion', 'faceless', 'reverse', 'product', 'style', 'blender', 'media'],
    namespaces: [],
  },
  { id: 'design', title: 'Design and Figma', prefixes: ['figma', 'ui', 'apple'], namespaces: [] },
  { id: 'content', title: 'Content and SMM', prefixes: ['smm', 'ads', 'copy', 'content', 'seo'], namespaces: [] },
  {
    id: 'office',
    title: 'Documents and Office',
    prefixes: ['office', 'pdf', 'docx', 'pptx', 'xlsx', 'jupyter', 'notebook'],
    namespaces: [],
  },
  {
    id: 'development',
    title: 'Development and code',
    prefixes: ['dsh', 'gh', 'skill', 'discover', 'codex', 'extension', 'schema', 'bigtable'],
    namespaces: [],
  },
  {
    id: 'automation',
    title: 'Automation and browsers',
    prefixes: ['playwright', 'agent', 'computer', 'cua', 'android', 'xcode'],
    namespaces: [],
  },
  {
    id: 'notes',
    title: 'Notes and productivity',
    prefixes: ['notion', 'linear', 'gmail', 'calendar', 'schedule'],
    namespaces: [],
  },
  { id: 'security', title: 'Security', prefixes: ['security'], namespaces: [] },
]

/** Compare a category token the way rules and names match: trimmed and without letter case. */
function tokenKey(token: string): string {
  return token.trim().toLowerCase()
}

/**
 * Refuse rules that cannot be applied unambiguously, so a profile states its
 * categories correctly before any skill is grouped by them.
 * @param categories - rules as configured.
 * @throws {TypeError} when an id or title is blank, a token is blank, or two rules
 *   claim the same id, prefix, or namespace.
 */
export function assertCategoryRules(categories: readonly SkillCategory[]): void {
  const claimed = new Map<string, string>()
  const ids = new Set<string>()
  for (const rule of categories) {
    const id = rule.id.trim()
    if (id.length === 0) throw new TypeError('skill-sources: a category needs a non-empty id')
    if (rule.title.trim().length === 0) throw new TypeError(`skill-sources: category "${id}" needs a non-empty title`)
    const idKey = id.toLowerCase()
    if (ids.has(idKey)) throw new TypeError(`skill-sources: category id "${id}" is declared twice`)
    ids.add(idKey)
    for (const token of [id, ...(rule.prefixes ?? []), ...(rule.namespaces ?? [])]) {
      const key = tokenKey(token)
      if (key.length === 0) throw new TypeError(`skill-sources: category "${id}" has an empty prefix or namespace`)
      const owner = claimed.get(key)
      if (owner !== undefined && owner !== id) {
        throw new TypeError(`skill-sources: categories "${owner}" and "${id}" both claim "${token}"`)
      }
      claimed.set(key, id)
    }
  }
}
