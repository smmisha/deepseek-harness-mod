// @vitest-environment node
/**
 * The in-place editor's geometry: the field takes the width of the text it
 * carries (inside the bubble stack's width family) instead of the row's width,
 * a one-line edit rests at one line with the action pair one house step under
 * it, and the field's box never leaves the row's cap.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(
  fileURLToPath(new URL('../src/client/chat/EditMessageEditor.module.css', import.meta.url)),
  'utf8',
)
const ROW_CSS = readFileSync(
  fileURLToPath(new URL('../src/client/chat/MessageItem.module.css', import.meta.url)),
  'utf8',
)

/** Return the body of the `occurrence`-th rule whose selector list starts with `selector`. */
function rule(selector: string, source = CSS, occurrence = 0): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?:^|\\n)${escaped}(?![\\w-])[^{]*\\{([^}]*)\\}`, 'g')
  const matches = [...source.matchAll(pattern)]
  expect(matches[occurrence], `missing ${selector} rule ${String(occurrence)}`).toBeDefined()
  return matches[occurrence]?.[1] ?? ''
}

describe('in-place message editor geometry', () => {
  it('stacks the field and the action pair one house step apart', () => {
    const editor = rule('.editor')
    expect(editor).toMatch(/flex-direction:\s*column;/)
    expect(editor).toMatch(/gap:\s*4px;/)
  })

  it('fills the row edit block instead of stretching itself to the row', () => {
    const editor = rule('.editor')
    expect(editor).toMatch(/width:\s*100%;/)
    expect(editor).toMatch(/max-width:\s*100%;/)
    // The bubble stack's cap belongs to the row block that hosts the attachments
    // and the editor, so both keep one width family.
    expect(rule('.editBlock', ROW_CSS)).toMatch(/width:\s*fit-content;/)
    expect(rule('.editBlock', ROW_CSS)).toMatch(/max-width:\s*var\(--dsh-chat-bubble-max-width\);/)
    expect(rule('.userRow', ROW_CSS))
      .toMatch(/--dsh-chat-bubble-max-width:\s*min\(calc\(var\(--dsh-chat-content-width, 748px\) \* 0\.702\), 82%\);/)
    expect(rule('.userStack', ROW_CSS)).toMatch(/max-width:\s*var\(--dsh-chat-bubble-max-width\);/)
  })

  it('sizes the field from its text instead of its intrinsic cols', () => {
    const field = rule('.field')
    expect(field).toMatch(/display:\s*grid;/)
    expect(rule('.sizer')).toMatch(/grid-area:\s*1 \/ 1;/)
    // The sizer's own rule follows the shared metrics rule in the sheet.
    expect(rule('.sizer', CSS, 1)).toMatch(/visibility:\s*hidden;/)
    expect(rule('.sizer', CSS, 1)).toMatch(/min-width:\s*calc\(14ch \+ 17px\);/)
    // The field's own rule follows the shared metrics rule in the sheet.
    expect(rule('.editor .input', CSS, 1)).toMatch(/contain:\s*inline-size;/)
    expect(rule('.editor .input', CSS, 1)).toMatch(/width:\s*100%;/)
  })

  it('gives the sizer and the field the same text metrics so both wrap alike', () => {
    const shared = rule('.sizer')
    expect(shared).toMatch(/box-sizing:\s*border-box;/)
    expect(shared).toMatch(/padding:\s*3px 8px;/)
    expect(shared).toMatch(/font-size:\s*var\(--dsh-content-font-size, 14px\);/)
    expect(shared).toMatch(/line-height:\s*calc\(22px \+ var\(--dsh-content-font-delta, 0px\)\);/)
    expect(shared).toMatch(/white-space:\s*pre-wrap;/)
    expect(shared).toMatch(/overflow-wrap:\s*break-word;/)
  })

  it('takes the action to its glyph plus a 4px inset instead of a 28px band', () => {
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
