// @vitest-environment jsdom
/**
 * A pending steering message stays editable and removable while the Host still
 * holds it. A refused change is reported in the composer, and an open editor
 * whose message the running step admits meanwhile is announced instead of
 * dropped with the bubble.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { PendingSteeringBubble } from '../src/client/chat/MessageItem.tsx'
import type { PendingSteerActions } from '../src/client/contract/slots.ts'
import { en } from '../src/client/locale.ts'

const t = makeTranslate(en, commonEn)
const itemId = 'steer-1' as MessageId
const content = [{ type: 'text', text: 'use the second path' }]
const loadImage = Object.assign(() => Promise.resolve(''), { peek: () => undefined })

function pendingSteer(update: PendingSteerActions['update'] = () => Promise.resolve()): PendingSteerActions & {
  update: ReturnType<typeof vi.fn<PendingSteerActions['update']>>
  notify: ReturnType<typeof vi.fn<PendingSteerActions['notify']>>
} {
  return {
    update: vi.fn<PendingSteerActions['update']>(update),
    notify: vi.fn<PendingSteerActions['notify']>(),
  }
}

function renderBubble(steer: PendingSteerActions) {
  return render(
    <PendingSteeringBubble
      itemId={itemId}
      content={content}
      pendingSteer={steer}
      renderFactorySlot={() => null}
      loadImage={loadImage}
      t={t}
    />,
  )
}

describe('pending steering bubble', () => {
  afterEach(cleanup)

  it('edits the pending text in place and saves it through the Host', async () => {
    const steer = pendingSteer()
    renderBubble(steer)
    fireEvent.click(screen.getByRole('button', { name: t('message.edit') }))
    fireEvent.change(screen.getByDisplayValue('use the second path'), { target: { value: 'use the first path' } })
    fireEvent.click(screen.getByRole('button', { name: t('message.editSave') }))
    await waitFor(() => {
      expect(steer.update).toHaveBeenCalledWith(itemId, { kind: 'edit', text: 'use the first path' })
    })
    await waitFor(() => { expect(screen.queryByDisplayValue('use the first path')).toBeNull() })
    expect(steer.notify).not.toHaveBeenCalled()
  })

  it('removes the pending message through the Host', async () => {
    const steer = pendingSteer()
    renderBubble(steer)
    fireEvent.click(screen.getByRole('button', { name: t('steering.remove') }))
    await waitFor(() => { expect(steer.update).toHaveBeenCalledWith(itemId, { kind: 'remove' }) })
  })

  it('keeps the editor open and reports a refused change in the composer', async () => {
    const steer = pendingSteer(() => Promise.reject(new Error('already admitted')))
    renderBubble(steer)
    fireEvent.click(screen.getByRole('button', { name: t('message.edit') }))
    fireEvent.click(screen.getByRole('button', { name: t('message.editSave') }))
    await waitFor(() => { expect(steer.notify).toHaveBeenCalledWith(t('steering.failed')) })
    expect(screen.getByDisplayValue('use the second path')).toBeTruthy()
  })

  it('announces an open edit when the running step admits the message first', () => {
    const steer = pendingSteer()
    const view = renderBubble(steer)
    fireEvent.click(screen.getByRole('button', { name: t('message.edit') }))
    view.unmount()
    expect(steer.notify).toHaveBeenCalledWith(t('steering.admitted'))
  })

  it('stays silent when the message leaves without an open edit', () => {
    const steer = pendingSteer()
    const view = renderBubble(steer)
    view.unmount()
    expect(steer.notify).not.toHaveBeenCalled()
  })
})
