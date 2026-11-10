/** Chat is the only mode that asks for minimal chrome and a covered frame. */
import { describe, expect, it, vi } from 'vitest'
import { applyWorkModeChrome } from '../src/client/chrome.ts'

describe('applyWorkModeChrome', () => {
  it('keeps the centre column alone and covers it for Chat', () => {
    const layout = { setChrome: vi.fn(), setFrameCovered: vi.fn() }
    applyWorkModeChrome(layout, 'chat')
    expect(layout.setChrome).toHaveBeenCalledWith('minimal')
    expect(layout.setFrameCovered).toHaveBeenCalledWith(true)
  })

  it('restores the full shell for Harness and for an unread mode', () => {
    const layout = { setChrome: vi.fn(), setFrameCovered: vi.fn() }
    applyWorkModeChrome(layout, 'harness')
    expect(layout.setChrome).toHaveBeenCalledWith('full')
    expect(layout.setFrameCovered).toHaveBeenCalledWith(false)
    applyWorkModeChrome(layout, 'corrupted')
    expect(layout.setChrome).toHaveBeenNthCalledWith(2, 'full')
    expect(layout.setFrameCovered).toHaveBeenNthCalledWith(2, false)
  })
})
