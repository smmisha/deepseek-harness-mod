/** Chat is the only mode that asks for minimal chrome. */
import { describe, expect, it, vi } from 'vitest'
import { applyWorkModeChrome } from '../src/client/chrome.ts'

describe('applyWorkModeChrome', () => {
  it('keeps the centre column alone for Chat', () => {
    const layout = { setChrome: vi.fn() }
    applyWorkModeChrome(layout, 'chat')
    expect(layout.setChrome).toHaveBeenCalledWith('minimal')
  })

  it('restores the full shell for Harness and for an unread mode', () => {
    const layout = { setChrome: vi.fn() }
    applyWorkModeChrome(layout, 'harness')
    expect(layout.setChrome).toHaveBeenCalledWith('full')
    applyWorkModeChrome(layout, 'corrupted')
    expect(layout.setChrome).toHaveBeenNthCalledWith(2, 'full')
  })
})
