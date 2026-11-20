/**
 * Card anatomy, state rendering and spacing, asserted against the stylesheet on
 * disk. jsdom resolves no CSS, so these design decisions exist only as
 * declarations: the card's padding and grid gap, its three-step type scale, the
 * quiet identity chip, the fixed state column, and the one-column narrow layout.
 * Reading the sheet is the only ownership-safe way to keep them.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/PluginInventorySettingsTab.module.css', import.meta.url)), 'utf8')
/** Comment bodies blanked, so prose that mentions a property is not read as a declaration. */
const stylesheet = css.replace(/\/\*[\s\S]*?\*\//g, text => ' '.repeat(text.length))

/**
 * Declarations of every rule whose selector list ends in the literal selector.
 * @param selector - literal selector as written in the sheet, without its brace.
 * @returns the rule bodies, in source order, joined.
 */
function declarations(selector: string): string {
  const bodies: string[] = []
  for (let index = stylesheet.indexOf(`${selector} {`); index !== -1; index = stylesheet.indexOf(`${selector} {`, index + 1)) {
    const open = stylesheet.indexOf('{', index)
    bodies.push(stylesheet.slice(open + 1, stylesheet.indexOf('}', open)))
  }
  if (bodies.length === 0) throw new Error(`PluginInventorySettingsTab.module.css has no \`${selector}\` rule`)
  return bodies.join('\n')
}

/** Text of the one-column container query, which owns the narrow tab layout. */
function narrowBlock(): string {
  const opening = '@container plugin-inventory (max-width: 520px) {'
  const start = stylesheet.indexOf(opening)
  if (start === -1) throw new Error('PluginInventorySettingsTab.module.css has no narrow container query')
  let depth = 0
  for (let index = stylesheet.indexOf('{', start); index < stylesheet.length; index += 1) {
    if (stylesheet[index] === '{') depth += 1
    else if (stylesheet[index] === '}' && (depth -= 1) === 0) return stylesheet.slice(start, index)
  }
  throw new Error('unbalanced braces in the narrow container query')
}

describe('plugin inventory card design', () => {
  it('keeps the settings-card material and the two-column board', () => {
    const card = declarations('.card')
    expect(card).toContain('border: 0.5px solid var(--dsw-alias-settings-card-stroke)')
    expect(card).toContain('border-radius: var(--dsw-radius-xl)')
    expect(card).toContain('background: var(--dsw-alias-settings-card-fill)')
    expect(declarations('.cards')).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
  })

  it('spaces the card and its grid on the 4px scale', () => {
    expect(declarations('.cardContent')).toContain('padding: 12px 16px')
    expect(declarations('.cards')).toContain('gap: 12px')
    expect(declarations('.cardMainRow')).toContain('gap: 12px')
    expect(declarations('.cardDescription')).toContain('margin-top: 4px')
    expect(declarations('.cardMeta')).toContain('padding-top: 8px')
    expect(declarations('.cardDetails')).toContain('padding: 12px 16px')
  })

  it('reads title, description and identity at three ink and size steps', () => {
    expect(declarations('.cardTitle')).toContain('font-size: 14px')
    expect(declarations('.cardTitle')).toContain('line-height: 20px')
    expect(declarations('.cardTitle')).toContain('font-weight: 500')
    const description = declarations('.cardDescription')
    expect(description).toContain('font-size: 13px')
    expect(description).toContain('line-height: 20px')
    expect(description).toContain('color: var(--dsw-alias-label-secondary)')
    expect(description).toContain('-webkit-line-clamp: 2')
    const identity = declarations('.cardIdentity')
    expect(identity).toContain('color: var(--dsw-alias-label-tertiary)')
    expect(identity).toContain('font-size: 11px')
    expect(identity).toContain('line-height: 16px')
  })

  it('lets the title wrap instead of clipping it', () => {
    const title = declarations('.cardTitle')
    expect(title).toContain('overflow-wrap: break-word')
    expect(title).not.toContain('white-space: nowrap')
    expect(title).not.toContain('text-overflow: ellipsis')
    expect(title).not.toContain('-webkit-line-clamp')
  })

  it('draws the machine identity as a hairline chip, not a filled badge', () => {
    const identity = declarations('.cardIdentity')
    expect(identity).toContain('border: 0.5px solid var(--dsw-alias-border-l1)')
    expect(identity).toContain('border-radius: var(--dsw-radius-xs)')
    expect(identity).toContain('background: transparent')
    expect(identity).toContain('font-family: var(--ds-font-family-code)')
    // A long entry id still ellipsizes inside the chip and keeps the hover text.
    expect(identity).toContain('text-overflow: ellipsis')
    expect(identity).not.toContain('--dsw-alias-bg-module-platform')
  })

  it('states enablement in one fixed trailing column that the title cannot move', () => {
    expect(declarations('.cardMainRow')).toContain('align-items: flex-start')
    expect(declarations('.cardTrailing')).toContain('flex: none')
    expect(declarations('.cardTrailing')).toContain('height: 20px')
    const state = declarations('.cardState')
    expect(state).toContain('color: var(--dsw-alias-label-secondary)')
    expect(state).toContain('font-size: 12px')
    expect(state).toContain('line-height: 20px')
    expect(state).toContain('gap: 6px')
    expect(state).toContain('white-space: nowrap')
  })

  it('keeps the expanded facts on the card grid', () => {
    expect(declarations('.cardDetails')).toContain('gap: 8px')
    expect(declarations('.details')).toContain('gap: 8px 12px')
    expect(declarations('.details dt')).toContain('font-size: 12px')
    expect(declarations('.details dt')).toContain('line-height: 18px')
    expect(declarations('.details dd')).toContain('font-size: 12px')
  })

  it('falls to one column and wraps the section header in a narrow tab', () => {
    const narrow = narrowBlock()
    expect(narrow).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(narrow).toContain('.switcher {')
    expect(narrow).toContain('max-width: 100%')
    expect(narrow).toContain('.headerEnd {')
    expect(narrow).toContain('flex: 1 1 100%')
    // Without a shrinkable label the preset name would run past the tab edge.
    expect(narrow).toContain('min-width: 0')
  })
})
