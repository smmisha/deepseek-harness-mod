// @vitest-environment jsdom
/**
 * The pencil opens the message row's editor. Opening it must never reach the
 * composer's submit path, and while the Session runs it stays visible but
 * unavailable with the reason exposed to assistive technology.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef, type FormEvent } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { EditMessageAction, type EditMessageActionProps } from '../src/client/chat/EditMessageAction.tsx'
import { en } from '../src/client/locale.ts'

const t = makeTranslate(en, commonEn)

function props(overrides: Partial<Omit<EditMessageActionProps, 't'>> = {}): EditMessageActionProps {
  return { beginEdit: () => {}, editUnavailable: false, t, ...overrides }
}

describe('user message edit action', () => {
  afterEach(cleanup)

  it('opens the row editor on a click and cannot submit a surrounding form', () => {
    const beginEdit = vi.fn()
    const onSubmit = vi.fn((event: FormEvent) => { event.preventDefault() })
    render(<form onSubmit={onSubmit}><EditMessageAction {...props({ beginEdit })} /></form>)
    const pencil = screen.getByRole('button', { name: t('message.edit') })
    expect(pencil).toHaveProperty('type', 'button')
    expect(pencil.getAttribute('aria-disabled')).toBeNull()
    expect(pencil.hasAttribute('aria-describedby')).toBe(false)
    expect(screen.queryByText(t('message.editUnavailable'))).toBeNull()
    fireEvent.click(pencil)
    expect(beginEdit).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('stays reachable but unavailable during a run, its reason programmatically associated', () => {
    const beginEdit = vi.fn()
    render(<EditMessageAction {...props({ beginEdit, editUnavailable: true })} />)
    const pencil = screen.getByRole('button', { name: t('message.edit') })
    expect(pencil).toHaveProperty('type', 'button')
    // A native disabled control leaves the tab order and delivers no tooltip
    // events, so the row keeps it reachable and explains the state instead.
    expect(pencil.getAttribute('aria-disabled')).toBe('true')
    expect(pencil.hasAttribute('data-unavailable')).toBe(true)
    expect(pencil.tabIndex).toBe(0)
    const reason = screen.getByText(t('message.editUnavailable'))
    expect(pencil.getAttribute('aria-describedby')).toBe(reason.id)
    fireEvent.click(pencil)
    expect(beginEdit).not.toHaveBeenCalled()
  })

  it('announces the unavailable reason once while its explanation tooltip is open', () => {
    render(<EditMessageAction {...props({ editUnavailable: true })} />)
    const pencil = screen.getByRole('button', { name: t('message.edit') })
    const reasonId = screen.getByText(t('message.editUnavailable')).id
    fireEvent.click(pencil)
    const bubble = screen.getByRole('tooltip')
    expect(bubble.textContent).toBe(t('message.editUnavailable'))
    // The pinned bubble repeats the reason; associating it again would make a
    // screen reader announce the same sentence twice.
    const describedBy = pencil.getAttribute('aria-describedby') ?? ''
    expect(describedBy.split(' ')).toHaveLength(1)
    expect(describedBy).toBe(reasonId)
    expect(bubble.id).not.toBe(reasonId)
    expect(describedBy.split(' ').map(id => document.getElementById(id)?.textContent ?? '').join(' '))
      .toBe(t('message.editUnavailable'))
  })

  it('hands its button to the row through the edit trigger ref', () => {
    const editTriggerRef = createRef<HTMLButtonElement>()
    render(<EditMessageAction {...props({ editTriggerRef })} />)
    expect(editTriggerRef.current).toBe(screen.getByRole('button', { name: t('message.edit') }))
  })
})
