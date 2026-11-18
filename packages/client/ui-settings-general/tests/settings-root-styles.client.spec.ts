/** Settings carrier geometry is independent of contributed launcher markup. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/SettingsRoot.module.css', import.meta.url), 'utf8')
/** Comment bodies blanked, so prose about a rule is not read as the rule. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, text => ' '.repeat(text.length))

/** The declarations of one rule, by its literal selector. */
function ruleBody(selector: string): string {
  const start = rules.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`SettingsRoot.module.css has no \`${selector}\` rule`)
  const open = rules.indexOf('{', start)
  return rules.slice(open + 1, rules.indexOf('}', open))
}

it('keeps the indicator carrier full-width without inspecting account state', () => {
  expect(css).toMatch(/\.triggerRow\s*\{[^}]*width: 100%;[^}]*margin: 4px 0;/)
  expect(css).not.toContain('data-signed-out')
  expect(css).toMatch(/\.triggerRow\.railRow\s*\{[^}]*width: 36px;/)
})

it('gives the navigation rail one cell height and wraps translated names instead of clipping them', () => {
  // The rail track holds the longest shipped section name on two lines; the
  // label text measure is what keeps the German compound and the Spanish
  // phrase inside it.
  expect(ruleBody('.panel')).toContain('grid-template-columns: 236px minmax(0, 1fr)')
  const cell = ruleBody('.navCell')
  // A floor rather than a fixed height: two lines fit, and a name that needed
  // three would grow its cell instead of clipping.
  expect(cell).toContain('min-height: 56px')
  expect(cell).toContain('padding: 8px 16px 8px 12px')
  expect(cell).toContain('font-size: 14px')
  expect(cell).toContain('line-height: 20px')
  expect(cell).not.toContain('height: 40px')
  const label = ruleBody('.navLabel')
  expect(label).toContain('white-space: normal')
  expect(label).toContain('overflow-wrap: break-word')
  expect(label).not.toContain('text-overflow: ellipsis')
  expect(label).not.toContain('white-space: nowrap')
  expect(label).not.toContain('overflow: hidden')
})

it('keeps the narrow strip on one 40px row and lets it scroll instead of wrapping', () => {
  expect(rules).toContain('min-height: 40px')
  expect(rules).toContain('height: 40px')
  // The strip's labels stay on one line; the strip itself scrolls.
  expect(rules).toContain('white-space: nowrap')
  expect(rules).toContain('overflow-x: auto')
})
