// @vitest-environment jsdom
/**
 * The shared Copy/Branch action row. An unavailable branch stays reachable and
 * explains its reason, and that reason is announced exactly once while the
 * pinned explanation tooltip repeats the same sentence.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { MessageIconActions } from '../src/client/chat/MessageIconActions.tsx'
import { en } from '../src/client/locale.ts'

const t = makeTranslate(en, commonEn)

afterEach(cleanup)

describe('message icon actions', () => {
  it('announces an unavailable branch once while its explanation tooltip is open', () => {
    render(<MessageIconActions text="copy me" clock="start" onBranch={() => {}} branchUnavailable t={t} />)
    const branch = screen.getByRole('button', { name: t('message.branch') })
    expect(branch.getAttribute('aria-disabled')).toBe('true')
    const reasonId = screen.getByText(t('message.branchUnavailable')).id
    expect(branch.getAttribute('aria-describedby')).toBe(reasonId)
    fireEvent.click(branch)
    const bubble = screen.getByRole('tooltip')
    expect(bubble.textContent).toBe(t('message.branchUnavailable'))
    // One description only: the pinned bubble repeats the reason rather than
    // becoming a second association for it.
    const describedBy = branch.getAttribute('aria-describedby') ?? ''
    expect(describedBy.split(' ')).toHaveLength(1)
    expect(describedBy).toBe(reasonId)
    expect(bubble.id).not.toBe(reasonId)
    expect(describedBy.split(' ').map(id => document.getElementById(id)?.textContent ?? '').join(' '))
      .toBe(t('message.branchUnavailable'))
  })

  it('leaves an available branch without a description or a reason node', () => {
    render(<MessageIconActions text="copy me" clock="start" onBranch={() => {}} t={t} />)
    const branch = screen.getByRole('button', { name: t('message.branch') })
    expect(branch.hasAttribute('aria-describedby')).toBe(false)
    expect(screen.queryByText(t('message.branchUnavailable'))).toBeNull()
  })
})
