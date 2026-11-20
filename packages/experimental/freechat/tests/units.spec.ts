/** Small kernel pieces: the per-thread lock, message projection, and the scripted transport. */
import { describe, expect, it } from 'vitest'
import { SessionLock } from '../src/kernel/session-lock.ts'
import {
  clampText, contentText, normalizeHistory, normalizeMessage, renderToolCall, renderToolResult,
} from '../src/kernel/messages.ts'
import { LoopbackTransport } from '../src/transport/loopback.ts'

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('SessionLock', () => {
  it('queues holders of one key in order and forgets an idle key', async () => {
    const lock = new SessionLock()
    const order: string[] = []
    const first = await lock.acquire('a')
    const second = lock.run('a', () => { order.push('second'); return Promise.resolve(2) })
    expect(lock.size).toBe(1)
    order.push('first')
    first()
    first()
    expect(await second).toBe(2)
    expect(order).toEqual(['first', 'second'])
    expect(lock.size).toBe(0)
  })

  it('releases the lock when the operation fails', async () => {
    const lock = new SessionLock()
    await expect(lock.run('a', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(lock.size).toBe(0)
    expect(await lock.run('a', () => Promise.resolve('next'))).toBe('next')
  })
})

describe('message projection', () => {
  it('flattens content to its text parts and clamps long text', () => {
    expect(contentText(null)).toBe('')
    expect(contentText(undefined)).toBe('')
    expect(contentText('plain')).toBe('plain')
    expect(contentText([{ type: 'text', text: 'a' }, { type: 'image_url' }, { type: 'text', text: '' }, { type: 'text', text: 'b' }])).toBe('a\nb')
    expect(clampText('abcdef', 3)).toBe('abc\n…[truncated]')
    expect(clampText('abc', 3)).toBe('abc')
  })

  it('renders tool results and calls in the prompt-level protocol', () => {
    expect(renderToolResult('c1', undefined, 'ok')).toBe('<tool_result call_id="c1" name="unknown">\nok\n</tool_result>')
    expect(renderToolResult('c1', '', 'ok')).toContain('name="unknown"')
    expect(renderToolResult('c1', 'read', 'ok')).toContain('name="read"')
    expect(renderToolCall('c1', 'read', '{"path":"a"}')).toBe('<tool_call id="c1" name="read">{"path":"a"}</tool_call>')
  })

  it('projects tool messages, assistant calls, and plain turns, and drops empty projections', () => {
    const tool = normalizeMessage({ role: 'tool', content: 'done', name: 'read' }, 100)
    expect(tool.text).toBe('<tool_result call_id="" name="read">\ndone\n</tool_result>')
    const call = normalizeMessage({
      role: 'assistant', content: null,
      tool_calls: [{ type: 'function', function: { name: 'read', arguments: '{}' } }],
    }, 100)
    expect(call.text).toBe('<tool_call id="" name="read">{}</tool_call>')
    const said = normalizeMessage({
      role: 'assistant', content: 'Reading.',
      tool_calls: [{ id: 'c2', type: 'function', function: { name: 'read', arguments: '{}' } }],
    }, 100)
    expect(said.text).toBe('Reading.\n\n<tool_call id="c2" name="read">{}</tool_call>')
    expect(normalizeMessage({ role: 'assistant', content: 'hi', tool_calls: [] }, 100).text).toBe('hi')
    expect(normalizeMessage({ role: 'user', content: 'hi' }, 100).fingerprint).toBe(normalizeMessage({ role: 'user', content: 'hi' }, 100).fingerprint)
    expect(normalizeHistory([{ role: 'assistant', content: '' }, { role: 'user', content: 'hi' }], 100).map(m => m.text)).toEqual(['hi'])
  })
})

describe('LoopbackTransport', () => {
  it('answers whole or chunked, records prompts, and refuses closed or aborted sends', async () => {
    const transport = new LoopbackTransport((prompt, index) => (index === 0 ? `echo ${prompt}` : ['a', 'b']), 1)
    const first = await transport.open()
    expect(await collect(first.send('hi'))).toEqual(['echo hi'])
    const second = await transport.open()
    expect(await collect(second.send('x'))).toEqual(['a', 'b'])
    expect(transport.sessions.map(session => session.prompts)).toEqual([['hi'], ['x']])
    const aborted = new AbortController()
    aborted.abort()
    await expect(collect(second.send('y', aborted.signal))).rejects.toThrow('generation aborted')
    await second.close()
    await expect(collect(second.send('z'))).rejects.toThrow('loopback session is closed')
  })
})
