/** The browser return document after a failed web sign-in, in every shipped UI language. */
import { expect, it } from 'vitest'
import { failedCallbackPage } from '../src/failed-callback.ts'

it.each([
  ['en', 'en'], ['zh', 'zh-CN'], ['zh-CN', 'zh-CN'], ['zh_hans', 'zh-CN'],
  ['ja', 'ja'], ['ja-JP', 'ja'], ['es', 'es'], ['fr', 'fr'], ['de', 'de'],
  ['ru', 'ru'], ['pt', 'pt'], ['pt_BR', 'pt'], ['uk', 'uk'],
] as const)('localizes the failure page for %s as %s', (locale, lang) => {
  const page = failedCallbackPage(locale)
  expect(page.lang).toBe(lang)
  expect(page.message.trim()).not.toBe('')
})

it('falls back to English for an empty or unknown language', () => {
  expect(failedCallbackPage('')).toEqual(failedCallbackPage('en'))
  expect(failedCallbackPage('xx')).toEqual(failedCallbackPage('en'))
})

it('keeps every shipped language distinct and placeholder-free', () => {
  const messages = ['en', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt', 'uk'].map(locale => failedCallbackPage(locale).message)
  expect(new Set(messages).size).toBe(messages.length)
  for (const message of messages) expect(message).not.toMatch(/\{\w+\}/)
})
