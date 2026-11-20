/**
 * Installed-list design rules, asserted against the CSS text on disk.
 *
 * jsdom paints nothing, so the row anatomy's measured rules — the description's
 * two 13/20 lines and its measure, the grouped header, the row step, and the
 * title's focus ring — are read from the stylesheet the browser receives.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/PluginManagerPage.module.css', import.meta.url)), 'utf8')
/** Comment bodies blanked, so prose about a rule is not read as the rule. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, text => ' '.repeat(text.length))

/** The declarations of one rule, by its literal selector. */
function ruleBody(selector: string): string {
  const start = rules.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`PluginManagerPage.module.css has no \`${selector}\` rule`)
  const open = rules.indexOf('{', start)
  return rules.slice(open + 1, rules.indexOf('}', open))
}

/** The declarations of one custom property, wherever the sheet defines it. */
function customProperty(name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(rules)
  if (match === null) throw new Error(`PluginManagerPage.module.css never sets ${name}`)
  return match[1]!
}

describe('installed list design rules', () => {
  it('keeps the description to two 13/20 lines at a readable measure', () => {
    const desc = ruleBody('.cardDesc')
    expect(desc).toContain('font-size: 13px')
    expect(desc).toContain('line-height: 20px')
    expect(desc).toContain('-webkit-line-clamp: 2')
    expect(desc).toContain('max-width: var(--card-description-measure)')
    expect(customProperty('--card-description-measure')).toBe('68ch')
    // Word boundaries: long tokens fall back to a break, ordinary prose never does.
    expect(desc).toContain('overflow-wrap: break-word')
    expect(desc).not.toContain('word-break: break')
    expect(desc).not.toContain('overflow-wrap: anywhere')
  })

  it('wraps titles instead of clipping them', () => {
    for (const selector of ['.cardTitle', '.cardOpen']) {
      const rule = ruleBody(selector)
      expect(rule).toContain('overflow-wrap: break-word')
      expect(rule).not.toContain('white-space: nowrap')
      expect(rule).not.toContain('text-overflow: ellipsis')
    }
  })

  it('puts one axis under the icon, the title, and the description', () => {
    // 48px icon frame + 16px gap + 8px head inset is the text's left edge; every
    // value on the 4px grid.
    expect(customProperty('--card-icon-size')).toBe('48px')
    expect(customProperty('--card-head-gap')).toBe('16px')
    expect(customProperty('--card-head-inset')).toBe('8px')
    const head = ruleBody('.cardHead')
    expect(head).toContain('grid-template-columns: var(--card-icon-size) minmax(0, 1fr) auto')
    expect(head).toContain('align-items: start')
    expect(ruleBody('.cardMain')).toContain('gap: 4px')
  })

  it('gives every group a counted 32px header and a hairline between groups', () => {
    expect(ruleBody('.groupHead')).toContain('min-height: 32px')
    expect(ruleBody('.groupCount')).toContain('font-size: 12px')
    expect(ruleBody('.groupCount')).toContain('margin-inline-start: auto')
    expect(ruleBody('.groupRule')).toContain('height: 0.5px')
    const between = ruleBody('.group + .group')
    expect(between).toContain('border-top: 0.5px solid var(--dsw-alias-border-l2)')
    expect(between).toContain('padding-top: 16px')
  })

  it('separates rows by one 8px step on the 4px grid', () => {
    expect(ruleBody('.cards')).toContain('gap: 8px')
    expect(ruleBody('.installedPanel')).toContain('gap: 16px')
  })

  it('renders a marker as a quiet dot-plus-word caption, never a badge', () => {
    const caption = ruleBody('.cardCaption')
    expect(caption).toContain('font-size: 12px')
    expect(caption).toContain('line-height: 20px')
    expect(caption).toContain('color: var(--dsw-alias-label-secondary)')
    expect(caption).not.toContain('background')
    expect(caption).not.toContain('border-radius: 999px')
    // Center alignment keeps the caption inside the title's 20px line box: adding
    // a marker changes neither the title baseline nor the row height.
    expect(ruleBody('.titleRow')).toContain('align-items: center')
    expect(ruleBody('.cardCaption::before')).toContain('width: 6px')
    expect(ruleBody(".cardCaption[data-tone='danger']::before"))
      .toContain('background: var(--dsw-alias-state-error-primary)')
  })

  it('draws a visible focus ring on the clickable title', () => {
    const focus = ruleBody('.cardOpen:focus-visible')
    expect(focus).toContain('outline: var(--dsw-focus-ring-width)')
    expect(focus).toContain('outline-offset: 2px')
    expect(focus).not.toContain('outline: none')
  })

  it('closes a group with a quiet More control below the rows', () => {
    const more = ruleBody('.groupMore')
    expect(more).toContain('color: var(--dsw-alias-label-secondary)')
    expect(more).toContain('background: transparent')
    expect(more).toContain('font-size: 13px')
    expect(more).toContain('line-height: 20px')
  })
})
