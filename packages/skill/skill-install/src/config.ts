/**
 * The installer's plugin configuration: where installed skills are written, the
 * catalogs the Skills tab offers, the hosts the Host may contact, and every
 * request, upload, archive, and preview limit.
 *
 * The catalog list is configuration rather than code because which catalogs a
 * deployment offers, and which of them it can search, varies by deployment. The
 * defaults carry the catalogs this release supports; a deployment may replace
 * the list, disable one, or add a link-only catalog.
 *
 * @module @deepseek-ai/dsh-skill-install/config
 */

import z from '@deepseek-ai/schemastery'
import type { SkillCatalogView } from './types.ts'
import { DEFAULT_ALLOWED_HOSTS } from './policy.ts'

/** One configured catalog entry. */
export interface SkillCatalogConfig {
  /** Stable id the Skills tab and the configuration both use. */
  readonly id: string
  /** Reader-facing title; the tab localizes a known id and falls back to this text. */
  readonly title: string
  /** HTTPS page the tab opens in the browser. The Host never contacts it. */
  readonly homepage: string
  /** Whether the Host can enumerate this catalog's skills. */
  readonly searchable: boolean
  /** How the catalog is served. */
  readonly kind: SkillCatalogView['kind']
  /** Repository a `recommended` catalog lists, as `owner/repo`. */
  readonly repository?: string
}

/** Milliseconds one outbound request may take. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
/** Redirect hops one outbound request may follow. */
export const DEFAULT_MAX_REDIRECTS = 3
/** Largest response body one request accepts, in bytes. */
export const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024
/** Largest upload one drop or file choice may carry, in bytes. */
export const DEFAULT_MAX_UPLOAD_BYTES = 16 * 1024 * 1024
/** Most entries one archive may declare. */
export const DEFAULT_MAX_ARCHIVE_ENTRIES = 2_000
/** Largest total uncompressed size one archive may declare, in bytes. */
export const DEFAULT_MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
/** Most files one imported skill folder may hold. */
export const DEFAULT_MAX_FILES = 200
/** Most skills one archive or dropped folder may carry. */
export const DEFAULT_MAX_BUNDLES = 20
/** Most previews kept installable at once. */
export const DEFAULT_MAX_PREVIEWS = 16
/** How long one preview stays installable, in milliseconds. */
export const DEFAULT_PREVIEW_TTL_MS = 10 * 60_000

/**
 * Catalogs this release ships. `github` resolves a repository the reader names;
 * `anthropics` lists the Apache-2.0 skill folders of `anthropics/skills`;
 * `skills.sh`, `skillsmp`, and `skills-hub` are opened in the browser, because
 * this release holds no client for their APIs.
 */
export const DEFAULT_CATALOGS: readonly SkillCatalogConfig[] = [
  { id: 'github', title: 'GitHub', homepage: 'https://github.com', searchable: true, kind: 'github' },
  {
    id: 'anthropics',
    title: 'Anthropic skills',
    homepage: 'https://github.com/anthropics/skills',
    searchable: true,
    kind: 'recommended',
    repository: 'anthropics/skills',
  },
  { id: 'skills.sh', title: 'skills.sh', homepage: 'https://www.skills.sh', searchable: false, kind: 'link' },
  { id: 'skillsmp', title: 'SkillsMP', homepage: 'https://skillsmp.com', searchable: false, kind: 'link' },
  { id: 'skills-hub', title: 'skills-hub.ai', homepage: 'https://skills-hub.ai', searchable: false, kind: 'link' },
]

/** Plugin configuration resolved by the Loader. */
export interface Config {
  /** Folder installed skills are written to; defaults to the harness home's `skills` folder. */
  installRoot?: string
  /** Catalogs the Skills tab offers, in display order. */
  catalogs?: SkillCatalogConfig[]
  /** Hostnames outbound requests may target, exactly or through a `*.` entry. */
  allowedHosts?: string[]
  /** Milliseconds one outbound request may take. */
  requestTimeoutMs?: number
  /** Redirect hops one outbound request may follow; each hop is validated again. */
  maxRedirects?: number
  /** Largest response body one request accepts, in bytes. */
  maxResponseBytes?: number
  /** Largest upload the tab may send, in bytes. */
  maxUploadBytes?: number
  /** Most entries one archive may declare. */
  maxArchiveEntries?: number
  /** Largest total uncompressed size one archive may declare, in bytes. */
  maxUncompressedBytes?: number
  /** Most files one imported skill folder may hold. */
  maxFiles?: number
  /** Most skills one archive or dropped folder may carry. */
  maxBundles?: number
  /** Most previews kept installable at once. */
  maxPreviews?: number
  /** How long one preview stays installable, in milliseconds. */
  previewTtlMs?: number
}

/** A repository reference the resolver can split into owner and name. */
const REPOSITORY = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u

/** An https page the Skills tab opens in the browser. */
const HTTPS_URL = /^https:\/\/[^\s]+$/u

/** Validated plugin configuration. */
export const ConfigSchema = z.object({
  installRoot: z.string().min(1).description('Folder installed skills are written to.'),
  catalogs: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    homepage: z.string().pattern(HTTPS_URL).description('HTTPS page the Skills tab opens in the browser.'),
    searchable: z.boolean(),
    kind: z.union(['github', 'link', 'recommended'] as const),
    repository: z.string().pattern(REPOSITORY).description('Repository a recommended catalog lists, as owner/repo.'),
  })).default(DEFAULT_CATALOGS.map(catalog => ({ ...catalog }))),
  allowedHosts: z.array(z.string().min(1)).default([...DEFAULT_ALLOWED_HOSTS]),
  requestTimeoutMs: z.number().min(1).default(DEFAULT_REQUEST_TIMEOUT_MS),
  maxRedirects: z.number().min(0).default(DEFAULT_MAX_REDIRECTS),
  maxResponseBytes: z.number().min(1).default(DEFAULT_MAX_RESPONSE_BYTES),
  maxUploadBytes: z.number().min(1).default(DEFAULT_MAX_UPLOAD_BYTES),
  maxArchiveEntries: z.number().min(1).default(DEFAULT_MAX_ARCHIVE_ENTRIES),
  maxUncompressedBytes: z.number().min(1).default(DEFAULT_MAX_UNCOMPRESSED_BYTES),
  maxFiles: z.number().min(1).default(DEFAULT_MAX_FILES),
  maxBundles: z.number().min(1).default(DEFAULT_MAX_BUNDLES),
  maxPreviews: z.number().min(1).default(DEFAULT_MAX_PREVIEWS),
  previewTtlMs: z.number().min(1).default(DEFAULT_PREVIEW_TTL_MS),
})
