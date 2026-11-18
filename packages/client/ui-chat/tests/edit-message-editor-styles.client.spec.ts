// @vitest-environment node
/**
 * The in-place editor's vertical rhythm: the action pair sits one house step
 * under the field, and its own box is only the glyph plus a small inset, so a
 * one-line edit does not open a band of empty space below the field.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(
  fileURLToPath(new URL('../src/client/chat/EditMessageEditor.module.css', import.meta.url)),
  'utf8',
)

/** Return the body of the rule whose selector list starts with `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\n)${escaped}(?![\\w-])[^{]*\\{([^}]*)\\}`).exec(CSS)
  expect(match, `missing ${selector} rule`).not.toBeNull()
  return match?.[1] ?? ''
}

describe('in-place message editor geometry', () => {
  it('stacks the field and the action pair one house step apart', () => {
    const editor = rule('.editor')
    expect(editor).toMatch(/flex-direction:\s*column;/)
    expect(editor).toMatch(/gap:\s*4px;/)
  })

  it('sizes the action to its glyph plus a 4px inset instead of a 28px band', () => {
    const action = rule('.action')
    expect(action).toMatch(/width:\s*calc\(24px \+ var\(--dsh-content-font-delta, 0px\)\);/)
    expect(action).toMatch(/height:\s*calc\(24px \+ var\(--dsh-content-font-delta, 0px\)\);/)
    expect(action).toMatch(/padding:\s*4px;/)
    // 24px still clears the 2.5.8 target size; the 15px glyph keeps its air.
    expect(action).not.toMatch(/28px/)
    expect(rule('.action svg')).toContain('calc(15px + var(--dsh-content-font-delta, 0px))')
  })

  it('tightens the pair itself to the same house step', () => {
    expect(rule('.actions')).toMatch(/gap:\s*4px;/)
  })
})
