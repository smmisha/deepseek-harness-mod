// @vitest-environment jsdom
/** The Chat/Harness switch: two localized segments with the whale on Harness. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ModeSwitcher, type ModeSwitcherProps } from '../src/client/ModeSwitcher.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

/** The `workMode` locale seat over the English dictionary. */
const t = ((key: keyof typeof en) => en[key]) as ModeSwitcherProps['t']

describe('ModeSwitcher', () => {
  it('renders both modes in a named tablist with Harness selected', () => {
    render(<ModeSwitcher mode="harness" onSelect={() => {}} t={t} />)
    expect(screen.getByRole('tablist', { name: en['mode.label'] })).toBeTruthy()
    const harness = screen.getByRole('tab', { name: en['mode.harness'] })
    expect(harness.getAttribute('aria-selected')).toBe('true')
    expect(harness.querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('tab', { name: en['mode.chat'] }).getAttribute('aria-selected')).toBe('false')
  })

  it('reports the chosen mode without re-reporting the current one', () => {
    const onSelect = vi.fn()
    render(<ModeSwitcher mode="harness" onSelect={onSelect} t={t} />)
    screen.getByRole('tab', { name: en['mode.chat'] }).click()
    expect(onSelect).toHaveBeenCalledWith('chat')
    screen.getByRole('tab', { name: en['mode.harness'] }).click()
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})
