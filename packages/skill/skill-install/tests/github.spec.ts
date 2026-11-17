/** Repository resolution against a stubbed HTTP layer; no case touches the network. */
import { describe, expect, it } from 'vitest'
import { GitHubResolver, isScriptPath, skillFolders } from '../src/github.ts'
import type { HttpClient, HttpResponse } from '../src/http.ts'

/** Limits the resolver runs with in these cases. */
const LIMITS = { maxMetadataBytes: 4096, maxDocumentBytes: 4096, maxFileBytes: 4096, maxFiles: 10 }

/** One canned answer. */
interface Route {
  readonly status?: number
  readonly body: string
}

/**
 * Build a stubbed client over a URL-to-body map.
 * @param routes - answers by exact URL.
 * @param record - collector that receives every requested URL.
 * @returns the client and the request log.
 */
function stubClient(routes: Readonly<Record<string, Route>>): { http: HttpClient; requests: string[] } {
  const requests: string[] = []
  return {
    requests,
    http: {
      async get(url: string): Promise<HttpResponse> {
        requests.push(url)
        const route = routes[url]
        if (route === undefined) throw new Error(`unexpected request ${url}`)
        return { status: route.status ?? 200, url, bytes: new TextEncoder().encode(route.body) }
      },
    },
  }
}

/** The repository metadata a resolution starts from. */
const COMMITS = 'https://api.github.com/repos/acme/skills/commits?per_page=1'
/** The tree a resolution reads next. */
const TREE = 'https://api.github.com/repos/acme/skills/git/trees/abc123?recursive=1'

/** One tree body with the given blobs. */
function tree(blobs: readonly { path: string; size?: number }[], truncated = false): Route {
  return {
    body: JSON.stringify({
      truncated,
      tree: blobs.map(blob => ({ path: blob.path, type: 'blob', size: blob.size ?? 10 })),
    }),
  }
}

/** Run one resolution and return the typed code it failed with. */
async function failure(routes: Readonly<Record<string, Route>>): Promise<string> {
  try {
    await new GitHubResolver(stubClient(routes).http, LIMITS).list('acme/skills')
  } catch (error) {
    return (error as { code: string }).code
  }
  throw new Error('expected the resolution to fail')
}

describe('isScriptPath', () => {
  it.each([
    ['run.sh', true],
    ['scripts/setup', true],
    ['bin/tool', true],
    ['SKILL.md', false],
    ['reference/notes.txt', false],
    ['no-extension', false],
  ])('classifies %s as a script: %s', (path, expected) => {
    expect(isScriptPath(path)).toBe(expected)
  })
})

describe('skillFolders', () => {
  it('groups blobs by the folder holding a SKILL.md', () => {
    const folders = skillFolders([
      { path: 'skills/pdf/SKILL.md', size: 10 },
      { path: 'skills/pdf/LICENSE.txt', size: 20 },
      { path: 'README.md', size: 5 },
      { path: 'SKILL.md', size: 7 },
    ], 10)
    expect(folders.map(folder => [folder.folder, folder.name, folder.files.length])).toEqual([
      ['', '', 2],
      ['skills/pdf', 'pdf', 2],
    ])
    expect(folders[1]?.hasScripts).toBe(false)
  })

  it('accepts a lower-case document name and marks scripts', () => {
    const folders = skillFolders([
      { path: 'tools/build/skill.md', size: 1 },
      { path: 'tools/build/scripts/run.py', size: 2 },
    ], 10)
    expect(folders[0]?.hasScripts).toBe(true)
  })

  it('refuses a folder holding more files than the cap', () => {
    expect(() => skillFolders([
      { path: 'big/SKILL.md', size: 1 },
      { path: 'big/a', size: 1 },
      { path: 'big/b', size: 1 },
    ], 2)).toThrow(expect.objectContaining({ code: 'SKILL_INSTALL_INVALID_SKILL' }))
  })

  it('names the repository root when its own folder is oversized', () => {
    expect(() => skillFolders([
      { path: 'SKILL.md', size: 1 },
      { path: 'a', size: 1 },
    ], 1)).toThrow(/repository root/)
  })
})

describe('GitHubResolver', () => {
  it('resolves the commit and lists every skill folder', async () => {
    const { http, requests } = stubClient({
      [COMMITS]: { body: JSON.stringify([{ sha: 'abc123' }]) },
      [TREE]: tree([
        { path: 'skills/pdf/SKILL.md' },
        { path: 'skills/pdf/LICENSE.txt' },
        { path: 'skills/docx/SKILL.md' },
      ]),
    })
    const listing = await new GitHubResolver(http, LIMITS).list('https://github.com/acme/skills')
    expect(listing).toMatchObject({ owner: 'acme', repo: 'skills', commit: 'abc123' })
    expect(listing.skills.map(skill => skill.folder)).toEqual(['skills/docx', 'skills/pdf'])
    expect(requests).toEqual([COMMITS, TREE])
  })

  it('refuses a missing repository', async () => {
    expect(await failure({ [COMMITS]: { status: 404, body: '{}' } })).toBe('SKILL_INSTALL_NOT_FOUND')
  })

  it('reports a spent rate limit', async () => {
    expect(await failure({ [COMMITS]: { status: 403, body: '{}' } })).toBe('SKILL_INSTALL_RATE_LIMITED')
    expect(await failure({ [COMMITS]: { status: 429, body: '{}' } })).toBe('SKILL_INSTALL_RATE_LIMITED')
  })

  it('reports any other status as a network failure', async () => {
    expect(await failure({ [COMMITS]: { status: 500, body: '{}' } })).toBe('SKILL_INSTALL_NETWORK')
  })

  it('refuses a commit body that is not JSON', async () => {
    expect(await failure({ [COMMITS]: { body: 'not json' } })).toBe('SKILL_INSTALL_NETWORK')
  })

  it('refuses a commit list with no commit', async () => {
    expect(await failure({ [COMMITS]: { body: '[]' } })).toBe('SKILL_INSTALL_NETWORK')
  })

  it('refuses a commit body that is not a list', async () => {
    expect(await failure({ [COMMITS]: { body: '{}' } })).toBe('SKILL_INSTALL_NETWORK')
  })

  it('refuses a truncated tree', async () => {
    expect(await failure({
      [COMMITS]: { body: JSON.stringify([{ sha: 'abc123' }]) },
      [TREE]: tree([{ path: 'a/SKILL.md' }], true),
    })).toBe('SKILL_INSTALL_TREE_TOO_LARGE')
  })

  it('refuses a tree body without a tree array', async () => {
    expect(await failure({
      [COMMITS]: { body: JSON.stringify([{ sha: 'abc123' }]) },
      [TREE]: { body: JSON.stringify({ truncated: false }) },
    })).toBe('SKILL_INSTALL_NETWORK')
  })

  it('refuses a tree body that is not an object', async () => {
    expect(await failure({
      [COMMITS]: { body: JSON.stringify([{ sha: 'abc123' }]) },
      [TREE]: { body: '[]' },
    })).toBe('SKILL_INSTALL_NETWORK')
  })

  it('skips tree entries it cannot read', async () => {
    const { http } = stubClient({
      [COMMITS]: { body: JSON.stringify([{ sha: 'abc123' }]) },
      [TREE]: {
        body: JSON.stringify({
          truncated: false,
          tree: [null, { path: 'ignored', type: 'tree' }, { type: 'blob' }, { path: 's/SKILL.md', type: 'blob' }],
        }),
      },
    })
    expect((await new GitHubResolver(http, LIMITS).list('acme/skills')).skills.map(skill => skill.folder)).toEqual(['s'])
  })

  it('reads a file at the pinned commit', async () => {
    const { http, requests } = stubClient({
      'https://raw.githubusercontent.com/acme/skills/abc123/skills/pdf/SKILL.md': { body: '# PDF' },
    })
    const bytes = await new GitHubResolver(http, LIMITS).file({ owner: 'acme', repo: 'skills', commit: 'abc123' }, 'skills/pdf/SKILL.md', 1024)
    expect(new TextDecoder().decode(bytes)).toBe('# PDF')
    expect(requests).toEqual(['https://raw.githubusercontent.com/acme/skills/abc123/skills/pdf/SKILL.md'])
  })

  it('encodes each path segment of a file request', async () => {
    const { http, requests } = stubClient({
      'https://raw.githubusercontent.com/acme/skills/abc123/a%20b/c%23.md': { body: 'x' },
    })
    await new GitHubResolver(http, LIMITS).file({ owner: 'acme', repo: 'skills', commit: 'abc123' }, 'a b/c#.md', 1024)
    expect(requests).toEqual(['https://raw.githubusercontent.com/acme/skills/abc123/a%20b/c%23.md'])
  })

  it('refuses repository text it cannot parse', async () => {
    const { http } = stubClient({})
    await expect(new GitHubResolver(http, LIMITS).list('not a repository'))
      .rejects.toMatchObject({ code: 'SKILL_INSTALL_SPEC_INVALID' })
  })
})
