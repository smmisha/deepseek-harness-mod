/**
 * Contrast invariants for the account surfaces: secondary copy must not use the tertiary alias,
 * which measures 3.71:1 on the light theme's white background and misses WCAG AA.
 */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const read = (name: string): string => readFileSync(new URL(`../src/client/${name}`, import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')

const account = read('AccountSection.module.css')
const platform = read('PlatformOverlay.module.css')

it('raises account status and explanatory copy off the tertiary alias', () => {
  expect(account).not.toContain('--dsw-alias-label-tertiary')
  expect(account).toMatch(/\.status,\s*\.secondary,\s*\.unavailable\s*\{[^}]*--dsw-alias-label-secondary/)
  expect(account).toMatch(/\.signedOutDescription\s*\{[^}]*--dsw-alias-label-secondary/)
})

it('raises the Platform overlay failure message off the tertiary alias', () => {
  expect(platform).not.toContain('--dsw-alias-label-tertiary')
  expect(platform).toMatch(/\.failure\s*\{[^}]*--dsw-alias-label-secondary/)
})
