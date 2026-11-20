import { describe, expect, it } from 'vitest'
import { composeSystemPrompt, renderToolCatalog } from '../src/tools/tool-catalog.ts'
import { ToolCallStreamParser, parseToolCalls } from '../src/tools/tool-parser.ts'
import type { ParsedToolCall, WireTool } from '../src/types.ts'

const tools: readonly WireTool[] = [
  {
    type: 'function',
    function: {
      name: 'github_search',
      description: 'Search repositories and issues.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
]

/** Feed one answer one character at a time, which is the worst chunking the transport can produce. */
function feedByCharacter(parser: ToolCallStreamParser, answer: string): { text: string; calls: ParsedToolCall[] } {
  let text = ''
  const calls: ParsedToolCall[] = []
  for (const character of answer) {
    const frame = parser.push(character)
    text += frame.text
    calls.push(...frame.calls)
  }
  const tail = parser.finish()
  return { text: text + tail.text, calls: [...calls, ...tail.calls] }
}

describe('tool prompt protocol', () => {
  it('renders the declared tools and the exact call form', () => {
    const catalog = renderToolCatalog(tools)
    expect(catalog).toContain('<tool_call name="tool_name">')
    expect(catalog).toContain('<tool name="github_search">')
    expect(catalog).toContain('"query"')
  })

  it('clamps long descriptions and schemas and defaults a missing schema', () => {
    const rendered = renderToolCatalog([
      { type: 'function', function: { name: 'long', description: 'd'.repeat(500), parameters: { blob: 'x'.repeat(3_000) } } },
      { type: 'function', function: { name: 'bare' } },
    ])
    expect(rendered).toContain(`${'d'.repeat(400)}…</description>`)
    expect(rendered).toContain('…')
    expect(rendered).toContain('{"type":"object","properties":{}}')
  })

  it('renders nothing when the caller offers no tools', () => {
    expect(renderToolCatalog([])).toBe('')
    expect(composeSystemPrompt('be brief', [])).toBe('be brief')
  })

  it('keeps the caller contract ahead of the catalog', () => {
    const composed = composeSystemPrompt('be brief', tools)
    expect(composed.startsWith('be brief')).toBe(true)
    expect(composed).toContain('<available_tools>')
  })
})

describe('tool call stream parser', () => {
  it('splits visible text from one call regardless of chunk boundaries', () => {
    const parser = new ToolCallStreamParser()
    const result = feedByCharacter(parser, 'before<tool_call name="github_search">{"query":"harness"}</tool_call>after')
    expect(result.text).toBe('beforeafter')
    expect(result.calls).toHaveLength(1)
    expect(result.calls[0]?.name).toBe('github_search')
    expect(result.calls[0]?.arguments).toBe('{"query":"harness"}')
    expect(result.calls[0]?.id.startsWith('call_')).toBe(true)
  })

  it('holds back a suffix that could still become a tag', () => {
    const parser = new ToolCallStreamParser()
    const frame = parser.push('visible <tool_ca')
    expect(frame.text).toBe('visible ')
    expect(frame.calls).toHaveLength(0)
  })

  it('reads several calls from one answer', () => {
    const answer = '<tool_call name="a">{}</tool_call><tool_call name="b" id="given">{"x":1}</tool_call>'
    const calls = parseToolCalls(answer)
    expect(calls.map(call => call.name)).toEqual(['a', 'b'])
    expect(calls[1]?.id).toBe('given')
    expect(calls[0]?.arguments).toBe('{}')
  })

  it('emits an unclosed block as text instead of dropping it', () => {
    const calls = parseToolCalls('text <tool_call name="a">{"x":1}')
    expect(calls).toHaveLength(0)
  })

  it('keeps a nameless block as text and honors a given call id', () => {
    expect(parseToolCalls('<tool_call>{}</tool_call>')).toEqual([])
    const parser = new ToolCallStreamParser()
    expect(parser.push('a <tool_call name="">{}</tool_call> b').text).toBe('a <tool_call name="">{}</tool_call> b')
    expect(parseToolCalls('<tool_call id="c7" name="read"></tool_call>')).toEqual([{ id: 'c7', name: 'read', arguments: '{}' }])
  })

  it('releases an oversized pending buffer as text', () => {
    const parser = new ToolCallStreamParser()
    const huge = `<tool_call name="x">${'a'.repeat(1_000_001)}`
    expect(parser.push(huge)).toEqual({ text: huge, calls: [] })
  })

  it('keeps ordinary prose untouched', () => {
    const parser = new ToolCallStreamParser()
    expect(parser.push('plain answer').text).toBe('plain answer')
    expect(parser.finish().text).toBe('')
  })
})
