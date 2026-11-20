/**
 * Prompt-level tool protocol. The free web chat has no native `tool_calls`, so
 * the offered OpenAI tool schemas are rendered into the system contract and the
 * model answers with the same XML blocks the stream parser reads back.
 */

import type { WireTool } from '../types.ts'

/** Longest tool description carried into the prompt. */
const MAX_DESCRIPTION_CHARS = 400
/** Longest serialized parameter schema carried into the prompt. */
const MAX_SCHEMA_CHARS = 2_000

/** Protocol clause that states the exact call form the parser accepts. */
const PROTOCOL = [
  '<tool_protocol>',
  'You can act on the user\'s machine and accounts through the tools below.',
  'To call one tool, emit exactly this block and nothing else around it:',
  '<tool_call name="tool_name">{"argument": "value"}</tool_call>',
  'Rules:',
  '- One JSON object per block, matching the declared parameters.',
  '- Never wrap a call in Markdown fences and never rename a tool.',
  '- Emit several blocks only when the task needs several calls.',
  '- Wait for the tool result before describing its outcome as fact.',
  '</tool_protocol>',
].join('\n')

/** Clamp one prompt section without breaking its JSON body open. */
function clamp(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`
}

/**
 * Render the active tool catalog into the prompt fragment a web-chat turn
 * prepends. An empty tool list renders nothing, so a plain chat request stays
 * byte-identical to a request without the bridge.
 * @param tools - tool schemas the caller offered for this request.
 * @returns the prompt fragment, or an empty string when no tool is active.
 */
export function renderToolCatalog(tools: readonly WireTool[]): string {
  const usable = tools.filter(tool => tool.function.name.length > 0)
  if (usable.length === 0) return ''
  const entries = usable.map((tool) => {
    const description = tool.function.description ?? ''
    const parameters = tool.function.parameters === undefined
      ? '{"type":"object","properties":{}}'
      : clamp(JSON.stringify(tool.function.parameters), MAX_SCHEMA_CHARS)
    return [
      `<tool name="${tool.function.name}">`,
      `<description>${clamp(description, MAX_DESCRIPTION_CHARS)}</description>`,
      `<parameters>${parameters}</parameters>`,
      '</tool>',
    ].join('\n')
  })
  return [PROTOCOL, '<available_tools>', ...entries, '</available_tools>'].join('\n')
}

/**
 * Prefix the system contract with the tool catalog. A caller that sent no tools
 * keeps its contract untouched.
 * @param systemPrompt - the caller's assembled system prompt text.
 * @param tools - offered tool schemas.
 * @returns the composed system prompt.
 */
export function composeSystemPrompt(systemPrompt: string, tools: readonly WireTool[]): string {
  const catalog = renderToolCatalog(tools)
  if (catalog.length === 0) return systemPrompt
  return systemPrompt.length === 0 ? catalog : `${systemPrompt}\n\n${catalog}`
}
