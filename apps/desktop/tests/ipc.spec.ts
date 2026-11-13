/** IPC naming and sender validation the Desktop shell exposes to product documents. */
import { describe, expect, it } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { DESKTOP_IPC, assertDesktopSender } from '../src/ipc.ts'

/** A sender event carrying only the frame the guard reads. */
function invocation(frame: unknown): IpcMainInvokeEvent {
  return Object.assign({} as IpcMainInvokeEvent, { senderFrame: frame })
}

describe('assertDesktopSender', () => {
  it('accepts the configured Desktop document host', () => {
    expect(() => { assertDesktopSender(invocation({ url: 'dsh-app://app/index.html' }), ['app']) }).not.toThrow()
  })

  it('rejects foreign schemes, unlisted hosts, and a missing frame', () => {
    expect(() => { assertDesktopSender(invocation({ url: 'https://app/index.html' }), ['app']) })
      .toThrow('unowned renderer')
    expect(() => { assertDesktopSender(invocation({ url: 'dsh-app://shell/index.html' }), ['app']) })
      .toThrow('unowned renderer')
    expect(() => { assertDesktopSender(invocation(null), ['app']) }).toThrow('without a sender frame')
  })
})

describe('chat IPC surface', () => {
  it('names the chat actions the tab drives and no external-browser sign-in', () => {
    expect(DESKTOP_IPC.chatAcquire).toBe('dsh-desktop:chat-acquire')
    expect(DESKTOP_IPC.chatLoginState).toBe('dsh-desktop:chat-login-state')
    expect(DESKTOP_IPC.chatReturnToSignIn).toBe('dsh-desktop:chat-return-to-sign-in')
    expect(DESKTOP_IPC.chatOpenInBrowser).toBe('dsh-desktop:chat-open-in-browser')
    expect(DESKTOP_IPC.chatClearData).toBe('dsh-desktop:chat-clear-data')
    expect(Object.keys(DESKTOP_IPC)).not.toContain('chatLoginStart')
    expect(Object.keys(DESKTOP_IPC)).not.toContain('chatLoginCancel')
  })
})
