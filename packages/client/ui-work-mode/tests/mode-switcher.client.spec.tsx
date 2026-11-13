// @vitest-environment jsdom
/** The Chat/Harness switch: two named icon buttons in a radio group, driven by click and keyboard. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ModeSwitcher, type ModeSwitcherProps } from '../src/client/ModeSwitcher.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

/** The `workMode` locale seat over the English dictionary. */
const t = ((key: keyof typeof en) => en[key]) as ModeSwitcherProps['t']

describe('ModeSwitcher', () => {
  it('renders both modes as named icon radios with Harness checked and focusable', () => {
    render(<ModeSwitcher mode="harness" onSelect={() => {}} t={t} />)
    expect(screen.getByRole('radiogroup', { name: en['mode.label'] })).toBeTruthy()
    const harness = screen.getByRole('radio', { name: en['mode.harness'] })
    const chat = screen.getByRole('radio', { name: en['mode.chat'] })
    expect(harness.getAttribute('aria-checked')).toBe('true')
    expect(harness.tabIndex).toBe(0)
    expect(chat.getAttribute('aria-checked')).toBe('false')
    expect(chat.tabIndex).toBe(-1)
    // Icons only: the names come from aria-label, not visible text.
    expect(harness.textContent).toBe('')
    expect(chat.querySelector('svg')).not.toBeNull()
    expect(harness.querySelector('svg')).not.toBeNull()
  })

  it('reports the chosen mode without re-reporting the current one', () => {
    const onSelect = vi.fn()
    render(<ModeSwitcher mode="harness" onSelect={onSelect} t={t} />)
    fireEvent.click(screen.getByRole('radio', { name: en['mode.chat'] }))
    expect(onSelect).toHaveBeenCalledWith('chat')
    fireEvent.click(screen.getByRole('radio', { name: en['mode.harness'] }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('moves and selects with the arrow, Home and End keys and ignores other keys', () => {
    const onSelect = vi.fn()
    const view = render(<ModeSwitcher mode="harness" onSelect={onSelect} t={t} />)
    const group = screen.getByRole('radiogroup')
    fireEvent.keyDown(group, { key: 'ArrowRight' })
    fireEvent.keyDown(group, { key: 'ArrowDown' })
    fireEvent.keyDown(group, { key: 'ArrowLeft' })
    fireEvent.keyDown(group, { key: 'ArrowUp' })
    fireEvent.keyDown(group, { key: 'Home' })
    fireEvent.keyDown(group, { key: 'End' })
    fireEvent.keyDown(group, { key: 'Enter' })
    expect(onSelect.mock.calls).toEqual([['chat'], ['chat'], ['chat'], ['chat'], ['chat'], ['harness']])
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: en['mode.harness'] }))
    view.rerender(<ModeSwitcher mode="chat" onSelect={onSelect} t={t} />)
    fireEvent.keyDown(group, { key: 'ArrowRight' })
    expect(onSelect).toHaveBeenLastCalledWith('harness')
  })
})
