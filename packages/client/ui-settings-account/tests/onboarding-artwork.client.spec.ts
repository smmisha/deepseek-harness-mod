/** First-run artwork selection: localized screenshots only where a translation ships. */
import { expect, it } from 'vitest'
import { onboardingArtworkLanguage } from '../src/client/onboarding-artwork.ts'

it.each([
  ['zh', 'zh'], ['zh-CN', 'zh'], ['ZH_hans', 'zh'],
  ['en', 'en'], ['ja', 'en'], ['es', 'en'], ['fr', 'en'], ['de', 'en'], ['ru', 'en'], ['pt', 'en'], ['uk', 'en'], ['', 'en'],
] as const)('selects %j artwork for %j', (language, expected) => {
  expect(onboardingArtworkLanguage(language)).toBe(expected)
})
