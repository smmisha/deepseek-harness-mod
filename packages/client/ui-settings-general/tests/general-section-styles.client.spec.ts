/**
 * General-section design rules, asserted against the CSS text on disk.
 *
 * jsdom paints nothing, so the shared row anatomy — the control line, the two
 * axes, the label and description inks, the group rhythm, and the two item
 * kinds that leave the field anatomy — is read from the stylesheet the browser
 * receives.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/GeneralSection.module.css', import.meta.url)), 'utf8')
/** Comment bodies blanked, so prose about a rule is not read as the rule. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, text => ' '.repeat(text.length))

/** The declarations of one rule, by its literal selector. */
function ruleBody(selector: string): string {
  const start = rules.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`GeneralSection.module.css has no \`${selector}\` rule`)
  const open = rules.indexOf('{', start)
  return rules.slice(open + 1, rules.indexOf('}', open))
}

/** The declarations of one custom property on the section. */
function sectionProperty(name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(ruleBody('.section'))
  if (match === null) throw new Error(`GeneralSection.module.css never sets ${name}`)
  return match[1]!
}

/** A row root: the item's own root, or a row inside an item-declared container. */
const ROOT = `:is(
  .group > [data-slot='settings.general.item'] > *:not([data-settings-item]):not([data-settings-rows]),
  .group > [data-slot='settings.general.item'] > [data-settings-rows] > *:not([data-settings-item])
)`
const LABEL = `${ROOT} > :first-child > :first-child`
const DESCRIPTION = `${ROOT} > :first-child > :nth-child(2)`
const CONTROL = `${ROOT} > :last-child:not(:first-child)`

describe('General section design rules', () => {
  it('gives every field row one control line and one right-hand column', () => {
    expect(sectionProperty('--dsh-settings-control-height')).toBe('36px')
    expect(sectionProperty('--dsh-settings-row-pad')).toBe('16px')
    expect(sectionProperty('--dsh-settings-control-gap')).toBe('24px')
    const row = ruleBody(ROOT)
    expect(row).toContain('display: grid')
    expect(row).toContain('grid-template-columns: minmax(0, 1fr) auto')
    // The control line is a floor, not a fixed height: a two-line label grows
    // the row instead of overlapping its description.
    expect(row).toContain('grid-template-rows: minmax(var(--dsh-settings-control-height), auto) auto')
    expect(row).toContain('column-gap: var(--dsh-settings-control-gap)')
    // Equal spacing above and below on every row.
    expect(row).toContain('padding: var(--dsh-settings-row-pad) 0')
    expect(row).toContain('border-bottom: 0.5px solid var(--dsw-alias-border-l2)')
  })

  it('puts the label and the control on one axis and hangs the description below the label', () => {
    // The text block dissolves into the row grid; without it the label cannot
    // share the control's line while the description keeps the text column.
    expect(ruleBody(`${ROOT} > :first-child`)).toContain('display: contents')
    const label = ruleBody(LABEL)
    expect(label).toContain('grid-row: 1')
    expect(label).toContain('grid-column: 1')
    expect(label).toContain('align-self: center')
    expect(label).toContain('font-size: 14px')
    expect(label).toContain('line-height: 22px')
    expect(label).toContain('font-weight: 500')
    expect(label).toContain('color: var(--dsw-alias-label-primary)')
    const description = ruleBody(DESCRIPTION)
    expect(description).toContain('grid-row: 2')
    expect(description).toContain('grid-column: 1')
    expect(description).toContain('font-size: 13px')
    expect(description).toContain('line-height: 20px')
    expect(description).toContain('color: var(--dsw-alias-label-secondary)')
    const control = ruleBody(CONTROL)
    // Anchored to the control line, not centred on the whole row: a description
    // that wraps to a second line never moves the control. Centring inside the
    // line (rather than stretching) keeps a 20px switch and a 36px selector on
    // the same centre without resizing either.
    expect(control).toContain('grid-row: 1')
    expect(control).toContain('grid-column: 2')
    expect(control).toContain('justify-self: end')
    expect(control).toContain('align-self: center')
    expect(control).not.toContain('min-height')
    expect(control).not.toContain('display: flex')
  })

  it('keeps a row alert in the text column at the caption size', () => {
    const alert = ruleBody(`${ROOT} > :first-child > [role='alert']`)
    expect(alert).toContain('grid-column: 1')
    expect(alert).toContain('font-size: 12px')
    expect(alert).toContain('line-height: 18px')
    expect(alert).toContain('color: var(--dsw-alias-state-error-primary)')
  })

  it('separates groups by one step over the row padding and keeps the heading closer to its own rows', () => {
    expect(ruleBody('.group + .group')).toContain('margin-top: 24px')
    const heading = ruleBody('.groupLabel')
    expect(heading).toContain('margin: 0 0 8px')
    expect(heading).toContain('font-size: 12px')
    expect(heading).toContain('line-height: 18px')
    expect(heading).toContain('font-weight: 500')
    expect(heading).toContain('color: var(--dsw-alias-label-secondary)')
  })

  it('lets a full-width choice block and a footnote leave the field anatomy', () => {
    const block = ruleBody(".group > [data-slot='settings.general.item'] > *[data-settings-item='block']")
    expect(block).toContain('padding: var(--dsh-settings-row-pad) 0')
    expect(block).not.toContain('grid-template-columns')
    const note = ruleBody(".group > [data-slot='settings.general.item'] > *[data-settings-item='note']")
    expect(note).toContain('padding-top: var(--dsh-settings-row-pad)')
    expect(note).toContain('font-size: 13px')
    expect(note).toContain('color: var(--dsw-alias-label-secondary)')
  })

  it('closes a group with its last row and narrows the gutter in the narrow panel', () => {
    expect(ruleBody(".group > [data-slot='settings.general.item']:last-child > :last-child"))
      .toContain('border-bottom: none')
    // The narrow override re-declares the gutter on the section, so every row
    // inherits it without a per-row media query.
    expect(rules).toContain('--dsh-settings-control-gap: 16px')
  })
})
