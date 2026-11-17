/**
 * Layout invariants that jsdom cannot measure: the onboarding actions stay in normal flow and
 * translated labels wrap the action row instead of squeezing into fixed-height buttons.
 */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const onboarding = readFileSync(new URL('../src/client/DesktopOnboarding.module.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')

function rule(selector: RegExp): string {
  const match = selector.exec(onboarding)
  if (match === null) throw new Error(`no \`${selector.source}\` rule`)
  return match[1] ?? ''
}

it('keeps the onboarding primary action and navigation in normal flow', () => {
  expect(rule(/\.primaryAction\s*\{([^{}]*)\}/)).not.toContain('position: absolute')
  expect(rule(/\.navigation\s*\{([^{}]*)\}/)).not.toContain('position: absolute')
  expect(rule(/\.navigation\s*\{([^{}]*)\}/)).toContain('flex: none;')
  // The step content, not the page, owns the scroll so nothing can overlap the actions.
  expect(rule(/\.purpose, \.process\s*\{([^{}]*)\}/)).toContain('overflow-y: auto;')
  expect(rule(/\.credit\s*\{([^{}]*)\}/)).toContain('overflow-y: auto;')
})

it('lets translated confirmation labels wrap the row instead of the label', () => {
  expect(rule(/\.confirmationActions\s*\{([^{}]*)\}/)).toContain('flex-wrap: wrap;')
  expect(rule(/\.dialogButton\s*\{([^{}]*)\}/)).toContain('white-space: nowrap;')
})

it('visibly and natively disables busy onboarding choices', () => {
  expect(rule(/\.card:disabled, \.card:has\(\.cardCheckbox input:disabled\)\s*\{([^{}]*)\}/))
    .toContain('opacity: 0.4;')
  expect(onboarding).not.toContain("[aria-disabled='true']")
})
