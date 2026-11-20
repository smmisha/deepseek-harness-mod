import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function readStyles(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
}

const conversationCss = readStyles('../src/client/skeleton/ConversationRoot.module.css')
const inputBarCss = readStyles('../src/client/skeleton/InputBar.module.css')
const contextMeterCss = readStyles('../src/client/skeleton/ContextMeter.module.css')

/** Return the body of the rule whose selector list starts with `selector`. */
function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\n)${escaped}[^{]*\\{([^}]*)\\}`).exec(css)
  expect(match, `missing ${selector} rule`).not.toBeNull()
  return match?.[1] ?? ''
}

/** One px value declared by a rule body. */
function px(body: string, property: string): number {
  const match = new RegExp(`\\b${property}:\\s*(-?[\\d.]+)px`).exec(body)
  expect(match, `missing ${property} px value`).not.toBeNull()
  return Number(match?.[1])
}

/** The four px values of a rule body's `inset` shorthand, in top/right/bottom/left order. */
function inset(body: string): readonly number[] {
  const match = /\binset:\s*([^;]+);/.exec(body)
  expect(match, 'missing inset').not.toBeNull()
  const values = (match?.[1] ?? '').trim().split(/\s+/)
  expect(values).toHaveLength(4)
  return values.map((value) => {
    expect(value).toMatch(/^-?[\d.]+(?:px)?$/)
    return Number.parseFloat(value)
  })
}

/** The right value of a rule body's `padding` shorthand. */
function paddingRight(body: string): number {
  const match = /\bpadding:\s*([^;]+);/.exec(body)
  expect(match, 'missing padding').not.toBeNull()
  const values = (match?.[1] ?? '').trim().split(/\s+/)
  expect(values.length).toBeGreaterThanOrEqual(1)
  expect(values.length).toBeLessThanOrEqual(4)
  return Number.parseFloat(values.length === 1 ? values[0] ?? '0' : values[1] ?? '0')
}

describe('docked composer seat styles', () => {
  const seat = rule(conversationCss, ".root[data-phase='active'] .composerSeat,")

  it('keeps the seat at one stacking rank in every state', () => {
    expect(seat).toMatch(/position:\s*sticky;/)
    expect(seat).toMatch(/z-index:\s*9;/)
    // No other rule ranks the seat, so opening a menu inside it changes nothing.
    const ranked = [...conversationCss.matchAll(/([^{}]*\.composerSeat[^{}]*)\{([^}]*)\}/g)]
      .filter(([, , body]) => body !== undefined && /z-index/.test(body))
    expect(ranked).toHaveLength(1)
  })

  it('rests the seat at the floor without depending on a View to fill the column', () => {
    expect(seat).toMatch(/margin-top:\s*auto;/)
  })

  it('gives the seat a compositing reason that does not depend on overlap', () => {
    expect(seat).toMatch(/will-change:\s*transform;/)
  })

  it('keeps scroll anchoring off composer content', () => {
    expect(seat).toMatch(/overflow-anchor:\s*none;/)
  })
})

describe('composer statistics row styles', () => {
  it('reserves one reading row in the docked composer only', () => {
    expect(rule(inputBarCss, '.root:not(.hero) > .dock'))
      .toContain('min-height: calc(22px + var(--dsh-content-font-delta-secondary, 0px))')
    expect(rule(inputBarCss, '.hero .dock:empty')).toMatch(/display:\s*none;/)
  })

  it('sizes the reservation to one reading: a 20px secondary line plus 1px block padding', () => {
    const trigger = rule(contextMeterCss, '.trigger')
    expect(trigger).toContain('line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px))')
    expect(trigger).toMatch(/padding:\s*1px 8px;/)
  })
})

describe('composer stop seat target size', () => {
  it('grows the caret pointer target to 24x28 without moving the glyph or covering the primary stop', () => {
    const caret = rule(inputBarCss, '.stopCaret')
    const extension = rule(inputBarCss, '.stopCaret::after')
    const [top, right, bottom, left] = inset(extension)
    expect(px(caret, 'width') + Math.abs(left ?? 0) + Math.abs(right ?? 0)).toBeGreaterThanOrEqual(24)
    expect(px(caret, 'height') + Math.abs(top ?? 0) + Math.abs(bottom ?? 0)).toBeGreaterThanOrEqual(24)
    // The extension stops at the seat gap, so the primary stop and the caret
    // remain separate targets, and inside the row's end padding so no hit area
    // leaves the card.
    expect(-(left ?? 0)).toBeLessThanOrEqual(px(rule(inputBarCss, '.stopSplit'), 'gap'))
    expect(-(right ?? 0)).toBeLessThanOrEqual(paddingRight(rule(inputBarCss, '.row')))
    // The visual seat keeps its 14x28 box around the 10px glyph.
    expect(px(caret, 'width')).toBe(14)
    expect(px(caret, 'height')).toBe(28)
    expect(extension).toMatch(/position:\s*absolute;/)
  })
})
