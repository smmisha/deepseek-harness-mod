// @vitest-environment jsdom
/** User-message layout and bubble width: live preferences, Host reconciliation, body presentation, and rows. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { makeTranslate, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { ChatSettings } from '../src/chat-settings.ts'
import {
  BUBBLE_WIDTH_SHARES, BUBBLE_WIDTH_VARIABLES, MESSAGE_LAYOUT_ATTRIBUTE, MessageLayoutPolicy,
} from '../src/client/message-layout.ts'
import { BubbleWidthRow, MessageLayoutRow, type MessageLayoutRowProps } from '../src/client/settings/MessageLayoutRows.tsx'
import { en } from '../src/client/locale.ts'

const t = makeTranslate(en, commonEn)

afterEach(cleanup)

describe('MessageLayoutPolicy', () => {
  it('keeps both choices live while the Host write is pending, writing each change once', () => {
    const host = stubConfigForm<ChatSettings>()
    host.publish({ status: 'ready' })
    const policy = new MessageLayoutPolicy(host.scope)
    expect(policy.layout.getSnapshot()).toBe('bubble')
    expect(policy.width.getSnapshot()).toBe('standard')
    policy.setLayout('flat')
    policy.setWidth('wide')
    policy.setLayout('flat')
    policy.setWidth('wide')
    expect(policy.layout.getSnapshot()).toBe('flat')
    expect(policy.width.getSnapshot()).toBe('wide')
    expect(host.set.mock.calls).toEqual([['messageLayout', 'flat'], ['bubbleWidth', 'wide']])
  })

  it('adopts accepted Host settings and releases its subscription', () => {
    const host = stubConfigForm<ChatSettings>()
    host.publish({ value: { performanceUsage: 'detailed', linkOpening: 'sidebar', messageLayout: 'flat', bubbleWidth: 'narrow' } })
    const policy = new MessageLayoutPolicy(host.scope)
    expect(policy.layout.getSnapshot()).toBe('flat')
    expect(policy.width.getSnapshot()).toBe('narrow')
    host.publish({ value: { performanceUsage: 'detailed', linkOpening: 'sidebar' } })
    expect(policy.layout.getSnapshot()).toBe('flat')
    policy.dispose()
    expect(host.listenerCount()).toBe(0)
  })

  it('presents the layout and width on its target and removes them on release', () => {
    const host = stubConfigForm<ChatSettings>()
    const policy = new MessageLayoutPolicy(host.scope)
    const target = document.createElement('div')
    const release = policy.present(target)
    expect(target.getAttribute(MESSAGE_LAYOUT_ATTRIBUTE)).toBe('bubble')
    expect(target.style.getPropertyValue(BUBBLE_WIDTH_VARIABLES.share)).toBe(String(BUBBLE_WIDTH_SHARES.standard.share))
    policy.setLayout('flat')
    policy.setWidth('full')
    expect(target.getAttribute(MESSAGE_LAYOUT_ATTRIBUTE)).toBe('flat')
    expect(target.style.getPropertyValue(BUBBLE_WIDTH_VARIABLES.share)).toBe('1')
    expect(target.style.getPropertyValue(BUBBLE_WIDTH_VARIABLES.cap)).toBe('100%')
    release()
    expect(target.hasAttribute(MESSAGE_LAYOUT_ATTRIBUTE)).toBe(false)
    expect(target.style.getPropertyValue(BUBBLE_WIDTH_VARIABLES.share)).toBe('')
    policy.setLayout('bubble')
    expect(target.hasAttribute(MESSAGE_LAYOUT_ATTRIBUTE)).toBe(false)
  })

  it('keeps the designed share as the standard preset', () => {
    expect(BUBBLE_WIDTH_SHARES.standard).toEqual({ share: 0.702, cap: '82%' })
  })
})

describe('message layout rows', () => {
  function props(policy: MessageLayoutPolicy): MessageLayoutRowProps {
    return {
      layout: policy.layout,
      width: policy.width,
      setLayout: (layout) => { policy.setLayout(layout) },
      setWidth: (width) => { policy.setWidth(width) },
      t,
    } as MessageLayoutRowProps
  }

  it('switches the layout and hides the width row while messages are flat', () => {
    const host = stubConfigForm<ChatSettings>()
    const policy = new MessageLayoutPolicy(host.scope)
    render(<><MessageLayoutRow {...props(policy)} /><BubbleWidthRow {...props(policy)} /></>)
    expect(screen.getByText(t('settings.bubbleWidth.title'))).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: t('settings.messageLayout.bubble') }))
    fireEvent.click(screen.getByRole('menuitem', { name: t('settings.messageLayout.flat') }))
    expect(policy.layout.getSnapshot()).toBe('flat')
    expect(screen.queryByText(t('settings.bubbleWidth.title'))).toBeNull()
  })

  it('selects a bubble width preset', () => {
    const host = stubConfigForm<ChatSettings>()
    const policy = new MessageLayoutPolicy(host.scope)
    render(<BubbleWidthRow {...props(policy)} />)
    fireEvent.click(screen.getByRole('button', { name: t('settings.bubbleWidth.standard') }))
    fireEvent.click(screen.getByRole('menuitem', { name: t('settings.bubbleWidth.wide') }))
    expect(policy.width.getSnapshot()).toBe('wide')
    expect(screen.getByRole('button', { name: t('settings.bubbleWidth.wide') })).toBeDefined()
  })
})
