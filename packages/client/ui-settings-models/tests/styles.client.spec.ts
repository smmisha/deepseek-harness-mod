/**
 * Models section stylesheet contract, asserted against the CSS text on disk.
 *
 * The section paints in both themes, and a `--dsw-*` name the theme does not
 * declare fails silently: the browser takes the `var()` fallback, so the sheet
 * still renders and only the dark theme looks wrong. Checking the names against
 * the sheet that declares them is what turns that into a test failure.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/ModelsSection.module.css', import.meta.url)), 'utf8')
// The theme package maps `./styles/*` to `./src/styles/*`, so the declarations
// stay on the source plane rather than needing a build.
// Every theme sheet, not just the platform tokens: font and scrollbar
// variables are declared in siblings, and a gate reading one file would call
// their names undeclared.
const tokens = readdirSync(fileURLToPath(new URL('../../ui-theme/src/styles/', import.meta.url)))
  .filter(name => name.endsWith('.css'))
  .map(name => readFileSync(fileURLToPath(new URL(`../../ui-theme/src/styles/${name}`, import.meta.url)), 'utf8'))
  .join('\n')

/** The declarations of one top-level rule, by selector. */
function block(selector: string): string {
  const match = new RegExp(`^\\${selector} \\{([^}]*)\\}`, 'm').exec(css)
  if (match === null) throw new Error(`ModelsSection.module.css has no \`${selector}\` rule`)
  return match[1] ?? ''
}

/** One declaration's value inside a block, or undefined when the rule omits it. */
function declaration(source: string, property: string): string | undefined {
  return new RegExp(`(?:^|[;{\\s])${property}:\\s*([^;]+);`).exec(source)?.[1]?.trim()
}

/** The body of one `@container` / `@media` block, by its prelude. */
function atRule(prelude: string): string {
  const start = css.indexOf(prelude)
  if (start < 0) throw new Error(`ModelsSection.module.css has no \`${prelude}\``)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, index)
    }
  }
  throw new Error(`unbalanced block for \`${prelude}\``)
}

/** One rule's body matched by a full pattern, required to exist. */
function asOnlyRule(pattern: RegExp, what: string): string {
  const match = pattern.exec(css)
  if (match === null) throw new Error(`ModelsSection.module.css has no ${what}`)
  return match[1] ?? ''
}

/** The selector list and body of one rule inside a block of text. */
function ruleIn(source: string, selector: string): string {
  const match = new RegExp(`(?:^|\\n)\\s*\\${selector} \\{([^}]*)\\}`, 'm').exec(source)
  if (match === null) throw new Error(`no \`${selector}\` rule in the block`)
  return match[1] ?? ''
}

describe('ModelsSection theme styles', () => {
  it('names only theme variables the token sheet defines', () => {
    // A `--dsw-*` name the sheet never declares is not a near miss: it silently
    // resolves to whatever literal sits in its fallback slot, which is how this
    // section stayed light under the dark theme before. Undeclared names have
    // no fallback at all and inherit, so both spellings must fail here.
    // Every theme-variable prefix the sheets actually use, not just `--dsw-`:
    // a `--dsh-` name reads as a plausible sibling and would otherwise slip
    // past this gate into a fallback literal. A custom property this sheet
    // declares itself (its own row geometry) is not a theme token to resolve.
    const declaredHere = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map(match => match[1]))
    const named = [...css.matchAll(/var\((--(?:dsw|dsh|ds)-[a-z0-9-]+)/g)].map(match => match[1])
    const undeclared = [...new Set(named)]
      .filter(name => !tokens.includes(`  ${String(name)}:`) && !declaredHere.has(name))
    expect(undeclared).toEqual([])
    expect(css).not.toMatch(/var\(--(?:surface|text-|border|accent-strong)/)
  })

  it('closes every block, so no rule is swallowed by the one above it', () => {
    // A missing `}` on an `@media` block is not a parse error: every rule after
    // it silently becomes conditional, and the whole fetch dialog once painted
    // unstyled for anyone whose system does not ask for reduced motion. Nothing
    // downstream reports this — the sheet loads and the classes still attach.
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect((bare.match(/\}/g) ?? []).length).toBe((bare.match(/\{/g) ?? []).length)
  })

  it('uses the shared settings card material around the nested editor', () => {
    expect(block('.editor')).toContain('background: var(--dsw-alias-bg-module-platform)')
    expect(block('.rowCard')).toContain('border: 0.5px solid var(--dsw-alias-settings-card-stroke)')
    expect(block('.rowCard')).toContain('background: var(--dsw-alias-settings-card-fill)')
  })

  it('gives every dropdown the shared chevron instead of the OS arrow', () => {
    // `select.input` caps the control at 240px, and the OS arrow is painted
    // flush inside that shrunk right edge — visibly tighter than every other
    // control on the page. `.selectInput` is what removes it, reserves the
    // right pad, and paints the shared chevron; a `<select>` that takes
    // `.input` alone silently keeps the OS one.
    const sources = readdirSync(fileURLToPath(new URL('../src/client/', import.meta.url)))
      .filter(name => name.endsWith('.tsx'))
      .map(name => ({
        name,
        text: readFileSync(fileURLToPath(new URL(`../src/client/${name}`, import.meta.url)), 'utf8'),
      }))
    const bare = sources.flatMap(({ name, text }) => text
      .split('<select')
      .slice(1)
      // The element's own attributes end at the first `>`; a child `<option>`
      // carries no className of its own and must not answer for the select.
      .map(rest => rest.slice(0, rest.indexOf('>')))
      .filter(attributes => !attributes.includes('selectInput'))
      .map(() => name))
    expect(bare).toEqual([])
  })

  it('never falls back to a literal colour', () => {
    // A token that resolves is never the problem; an undeclared one takes this
    // branch, and a literal here is a single colour for both themes.
    expect(css).not.toMatch(/var\(--dsw-[a-z0-9-]+\s*,\s*(?:#|rgb|rgba|hsl|hsla)/)
  })

  it('gives every provider row one head anatomy with a fixed control column', () => {
    // The head is a two-column grid: the reading column (name, then the state
    // and machine fact) and one fixed trailing column for the controls, so a
    // control or a state never moves the reading edge.
    expect(declaration(block('.section'), 'container')).toBe('models-section / inline-size')
    const head = block('.rowHead')
    expect(declaration(head, 'display')).toBe('grid')
    expect(declaration(head, 'grid-template-columns')).toBe(
      'minmax(0, 1fr) var(--dsh-models-action-column)',
    )
    expect(declaration(head, 'row-gap')).toBe('4px')
    expect(declaration(head, 'column-gap')).toBe('var(--dsh-models-head-gap)')
    // The column is wide enough for the widest shipped pair (ru: 102 + 64 + 4).
    expect(declaration(block('.section'), '--dsh-models-action-column')).toBe('172px')
    expect(declaration(block('.section'), '--dsh-models-head-gap')).toBe('16px')
    const actions = block('.rowActions')
    expect(declaration(actions, 'grid-column')).toBe('2')
    expect(declaration(actions, 'justify-content')).toBe('flex-start')
    expect(declaration(actions, 'margin-left')).toBeUndefined()
  })

  it('closes the head to one column once the fixed column would squeeze the name', () => {
    const narrow = atRule('@container models-section (max-width: 480px)')
    expect(declaration(ruleIn(narrow, '.rowHead'), 'grid-template-columns')).toBe('minmax(0, 1fr)')
    expect(declaration(ruleIn(narrow, '.rowActions'), 'grid-row')).toBe('3')
    expect(declaration(ruleIn(narrow, '.rowActions'), 'grid-column')).toBe('1')
  })

  it('states a row state as a dot plus its word, never a filled badge', () => {
    const state = block('.rowState')
    expect(declaration(state, 'font-size')).toBe('12px')
    expect(declaration(state, 'line-height')).toBe('20px')
    expect(declaration(state, 'color')).toBe('var(--dsw-alias-label-secondary)')
    expect(declaration(state, 'background')).toBeUndefined()
    expect(declaration(state, 'border')).toBeUndefined()
    expect(asOnlyRule(
      /^\.rowState\[data-state='unavailable'\] \{([^}]*)\}/m,
      'the unavailable state rule',
    )).toContain('color: var(--dsw-alias-state-error-primary)')
  })

  it('keeps the machine identity quiet and distinct from the human name', () => {
    const name = block('.rowName')
    expect(declaration(name, 'font-size')).toBe('14px')
    expect(declaration(name, 'line-height')).toBe('22px')
    expect(declaration(name, 'font-weight')).toBe('500')
    expect(declaration(name, 'color')).toBe('var(--dsw-alias-label-primary)')
    for (const selector of ['.rowId', '.editorRoute']) {
      const chip = block(selector)
      expect(declaration(chip, 'font-family')).toBe('var(--ds-font-family-code)')
      expect(declaration(chip, 'font-size')).toBe('11px')
      expect(declaration(chip, 'line-height')).toBe('16px')
      expect(declaration(chip, 'color')).toBe('var(--dsw-alias-label-tertiary)')
      expect(declaration(chip, 'border')).toBe('0.5px solid var(--dsw-alias-border-l1)')
      expect(declaration(chip, 'border-radius')).toBe('var(--dsw-radius-xs)')
    }
  })

  it('wraps every title, label, and state instead of truncating it', () => {
    // A translated name leaves the row whole: wrapping is the only way a
    // longer string is guaranteed reachable, and an ellipsis is the one thing
    // this sheet must never put on a title or a state. (The fetch dialog's
    // candidate ids keep theirs: they are a long machine list inside a
    // scrollable panel, and each carries the full id as its title.)
    for (const selector of ['.rowName', '.rowId', '.intro', '.editorTitle', '.editorRoute', '.rowState']) {
      const rule = block(selector)
      expect(rule, selector).not.toContain('text-overflow')
      expect(declaration(rule, 'overflow-wrap'), selector).toBeDefined()
    }
    expect(block('.candidateId')).toContain('text-overflow: ellipsis')
  })

  it('keeps every font weight at or below the 500 the house uses', () => {
    const weights = [...css.matchAll(/font-weight:\s*(\d+)/g)].map(match => Number(match[1]))
    expect(weights.filter(weight => weight > 500)).toEqual([])
  })

  it('lays the card out on the 4px step', () => {
    expect(declaration(block('.rowCard'), 'padding')).toBe('12px 16px')
    expect(declaration(block('.rowCard'), 'gap')).toBe('8px')
    expect(declaration(block('.editor'), 'padding')).toBe('12px 16px')
    expect(declaration(block('.editor'), 'gap')).toBe('12px')
    expect(declaration(block('.field'), 'gap')).toBe('8px')
    expect(declaration(block('.rowMeta'), 'min-height')).toBe('20px')
  })
})
