// @vitest-environment node
/**
 * The tracked Ukrainian dictionaries stay key-complete against the English
 * source dictionaries: every registered namespace is translated, every key and
 * placeholder survives, and verbatim command tokens are copied unchanged.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { UK_DICTIONARIES } from '../src/client/dictionaries.ts'

/** English dictionaries extracted from the package sources. */
interface EnglishSource {
  readonly namespaces: Readonly<Record<string, {
    readonly file: string
    readonly entries: readonly (readonly [string, string])[]
  }>>
  readonly problems: readonly string[]
}

const require = createRequire(import.meta.url)
const { extractEnglishDictionaries } = require('../scripts/extract-english.cjs') as {
  extractEnglishDictionaries: (root: string) => EnglishSource
}

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
const SOURCE = extractEnglishDictionaries(REPOSITORY_ROOT)

/** Copy tokens that translations must preserve verbatim. */
const TOKEN_PATTERN = /\{\w+\}|(?<![A-Za-z0-9/])\/[A-Za-z][\w-]*(?:=[\w-]+| (?:on|off))?|\b[a-z]+_[a-z_]+\b/gu

/**
 * Copy tokens of one dictionary value, sorted for order-insensitive comparison.
 * @param text - dictionary value.
 * @returns placeholders, slash commands, and API identifiers it contains.
 */
function tokens(text: string): string[] {
  return (text.match(TOKEN_PATTERN) ?? []).sort()
}

describe('ui-locale-uk dictionaries', () => {
  it('extracts the English source without unresolved dictionaries', () => {
    expect(SOURCE.problems).toEqual([])
    expect(Object.keys(SOURCE.namespaces).length).toBeGreaterThan(50)
  })

  it('translates exactly the registered namespaces', () => {
    expect(Object.keys(UK_DICTIONARIES).sort()).toEqual(Object.keys(SOURCE.namespaces).sort())
  })

  it('keeps every key of every English dictionary', () => {
    for (const [namespace, source] of Object.entries(SOURCE.namespaces)) {
      const dictionary = UK_DICTIONARIES[namespace]
      expect(dictionary, namespace).toBeDefined()
      const keys = source.entries.map(([key]) => key)
      expect(Object.keys(dictionary ?? {}), `${namespace} keys`).toEqual(keys)
    }
  })

  it('preserves placeholders and literal tokens', () => {
    for (const [namespace, source] of Object.entries(SOURCE.namespaces)) {
      const dictionary = UK_DICTIONARIES[namespace] ?? {}
      for (const [key, english] of source.entries) {
        expect(tokens(dictionary[key] ?? ''), `${namespace}.${key}`).toEqual(tokens(english))
      }
    }
  })

  it('copies command tokens unchanged and never ships empty or invisible text', () => {
    for (const [namespace, source] of Object.entries(SOURCE.namespaces)) {
      const dictionary = UK_DICTIONARIES[namespace] ?? {}
      for (const [key, english] of source.entries) {
        const translated = dictionary[key] ?? ''
        if (english.trim() !== '') expect(translated.trim().length, `${namespace}.${key}`).toBeGreaterThan(0)
        expect(/[\u200b\ufeff]/u.test(translated), `${namespace}.${key}`).toBe(false)
        if (key.startsWith('token.')) expect(translated, `${namespace}.${key}`).toBe(english)
      }
    }
  })
})
