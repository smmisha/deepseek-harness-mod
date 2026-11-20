/** The sign-in action row must wrap translated labels instead of squeezing buttons. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/SignInDialog.module.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')

it('wraps translated action labels instead of squeezing fixed-height buttons', () => {
  const actions = /\.actions\s*\{([^{}]*)\}/.exec(css)?.[1] ?? ''
  const buttons = /\.primaryButton, \.secondaryButton\s*\{([^{}]*)\}/.exec(css)?.[1] ?? ''
  expect(actions).toContain('flex-wrap: wrap;')
  expect(buttons).toContain('white-space: nowrap;')
})
