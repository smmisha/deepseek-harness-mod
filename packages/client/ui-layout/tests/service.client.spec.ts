import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { describe, expect, it, vi } from 'vitest'
import { LayoutController } from '../src/client/service.ts'
import type { ChromeMode, MainPanelId, PanelActions } from '../src/client/service.ts'

/** The frame-chrome source the controller reads alongside the panel selection. */
const chromeSource = () => createSnapshotStore<ChromeMode>('full')

/** The covered-frame source the controller reads beside the chrome source. */
const frameCoveredSource = () => createSnapshotStore(false)

/** One controller over fresh sources, so each case only states its own stubs. */
function serviceFor(panels: PanelActions, hasMainPanel: (id: MainPanelId) => boolean = () => true): LayoutController {
  return new LayoutController(panels, hasMainPanel, createSnapshotStore({ activePanelId: null }), chromeSource(), frameCoveredSource())
}

function fakePanels(): PanelActions {
  return {
    selectPanel: vi.fn(),
    retainMainPanels: vi.fn(),
    setSidebar: vi.fn(),
    toggleSidebar: vi.fn(),
    setViewportWidth: vi.fn(),
    setChrome: vi.fn(),
    setFrameCovered: vi.fn(),
    setTopBand: vi.fn(),
    setRightbar: vi.fn(),
    openRightbar: vi.fn(),
    closeRightbar: vi.fn(),
  }
}

describe('LayoutController', () => {
  it('forwards right column transitions to the constructor-supplied actions', () => {
    const panels = fakePanels()
    const service = serviceFor(panels)

    service.openRightbar(true, false)
    service.openRightbar(true, true)
    service.openRightbar(false, true)
    service.closeRightbar()

    expect(panels.openRightbar).toHaveBeenNthCalledWith(1, true, false)
    expect(panels.openRightbar).toHaveBeenNthCalledWith(2, true, true)
    expect(panels.openRightbar).toHaveBeenNthCalledWith(3, false, true)
    expect(panels.closeRightbar).toHaveBeenCalledTimes(1)
    // The drag width stays the frame's own business, never the caller's.
    expect(panels.setRightbar).not.toHaveBeenCalled()
  })

  it('can toggle the sidebar immediately after construction', () => {
    const panels = fakePanels()
    const service = serviceFor(panels)

    service.toggleSidebar()

    expect(panels.toggleSidebar).toHaveBeenCalledTimes(1)
    expect(panels.setSidebar).not.toHaveBeenCalled()
  })

  it('forwards panel selection and returning to the Conversation without changing geometry', () => {
    const panels = fakePanels()
    const service = serviceFor(panels)
    const panelId = 'panel-a' as MainPanelId
    service.selectPanel(panelId)
    service.selectPanel(panelId)
    service.selectPanel(null)
    expect(panels.selectPanel).toHaveBeenNthCalledWith(1, panelId)
    expect(panels.selectPanel).toHaveBeenNthCalledWith(2, panelId)
    expect(panels.selectPanel).toHaveBeenNthCalledWith(3, null)
    expect(panels.toggleSidebar).not.toHaveBeenCalled()
    expect(panels.openRightbar).not.toHaveBeenCalled()
    expect(panels.closeRightbar).not.toHaveBeenCalled()
  })

  it('keeps separately constructed controllers bound to their own instances', () => {
    const first = fakePanels()
    const second = fakePanels()
    const firstService = serviceFor(first)
    const secondService = serviceFor(second)
    firstService.toggleSidebar()
    expect(first.toggleSidebar).toHaveBeenCalledTimes(1)
    expect(second.toggleSidebar).not.toHaveBeenCalled()
    secondService.closeRightbar()
    expect(first.closeRightbar).not.toHaveBeenCalled()
    expect(second.closeRightbar).toHaveBeenCalledTimes(1)
  })

  it('rejects an absent main entry without changing selection or cancelling pending navigation', () => {
    const panels = fakePanels()
    const present = new Set(['panel-a'])
    const service = serviceFor(panels, id => present.has(id))
    service.selectPanel('panel-a' as MainPanelId)
    const navigation = service.beginNavigation()
    present.delete('panel-a')
    expect(() => { service.selectPanel('panel-a' as MainPanelId) }).toThrow('main panel "panel-a" is not registered')
    expect(panels.selectPanel).toHaveBeenCalledOnce()
    expect(navigation.aborted).toBe(false)
    service.selectPanel(null)
    expect(navigation.aborted).toBe(true)
  })

  it('forwards the frame chrome choice to the shared actions', () => {
    const panels = fakePanels()
    const service = serviceFor(panels)
    service.setChrome('minimal')
    expect(panels.setChrome).toHaveBeenCalledWith('minimal')
    service.setChrome('full')
    expect(panels.setChrome).toHaveBeenNthCalledWith(2, 'full')
    // Chrome never touches the widths or the selected panel.
    expect(panels.setSidebar).not.toHaveBeenCalled()
    expect(panels.selectPanel).not.toHaveBeenCalled()
  })

  it('forwards the covered-frame flag to the shared actions', () => {
    const panels = fakePanels()
    const service = serviceFor(panels)
    service.setFrameCovered(true)
    expect(panels.setFrameCovered).toHaveBeenCalledWith(true)
    service.setFrameCovered(false)
    expect(panels.setFrameCovered).toHaveBeenNthCalledWith(2, false)
    expect(panels.setChrome).not.toHaveBeenCalled()
  })

  it('supersedes asynchronous navigation on another request, any valid selection, and disposal', () => {
    const service = serviceFor(fakePanels())
    const first = service.beginNavigation()
    const second = service.beginNavigation()
    expect(first.aborted).toBe(true)
    expect(second.aborted).toBe(false)
    service.selectPanel('panel-a' as MainPanelId)
    expect(second.aborted).toBe(true)
    const repeated = service.beginNavigation()
    service.selectPanel('panel-a' as MainPanelId)
    expect(repeated.aborted).toBe(true)
    const pending = service.beginNavigation()
    service.dispose()
    expect(pending.aborted).toBe(true)
    service.dispose()
  })
})
