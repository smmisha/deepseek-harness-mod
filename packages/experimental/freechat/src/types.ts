/**
 * Every type crossing the free-web-chat bridge: the OpenAI-compatible wire
 * vocabulary the proxy accepts and emits, the provider-neutral thread and
 * rotation domain, the web-chat transport seam, and the `mcpServers` connector
 * document. Types only — the runtime lives in the sibling modules.
 *
 * @module @deepseek-ai/dsh-freechat
 */

/** Role of one OpenAI-compatible chat message. */
export type WireRole = 'system' | 'user' | 'assistant' | 'tool'

/** One text fragment of a multi-part message content array. */
export interface WireContentPart {
  readonly type?: string
  readonly text?: string
}

/** The `function` object of a tool call. */
export interface WireFunctionCall {
  readonly name: string
  readonly arguments: string
}

/** One tool call carried by an assistant message. */
export interface WireToolCall {
  readonly id?: string
  readonly type?: string
  readonly function: WireFunctionCall
}

/**
 * One OpenAI-compatible chat message as the caller sends it. `content` accepts
 * a plain string, the multi-part array every OpenAI client produces, or null
 * for an assistant message that only calls tools.
 */
export interface WireMessage {
  readonly role: WireRole
  readonly content?: string | readonly WireContentPart[] | null
  readonly name?: string
  readonly tool_call_id?: string
  readonly tool_calls?: readonly WireToolCall[]
}

/** The `function` declaration of one tool schema. */
export interface WireToolFunction {
  readonly name: string
  readonly description?: string
  readonly parameters?: Readonly<Record<string, unknown>>
}

/** One tool definition offered by the caller, in OpenAI `tools` form. */
export interface WireTool {
  readonly type?: string
  readonly function: WireToolFunction
}

/** The subset of an OpenAI chat-completions request the bridge reads. */
export interface ChatCompletionRequest {
  /** Requested model id; the registry decides whether it maps to a playable route. */
  readonly model?: string
  /** Full conversation the caller believes exists. */
  readonly messages: readonly WireMessage[]
  /** Tool schemas active for this request; rendered into the prompt by the tool bridge. */
  readonly tools?: readonly WireTool[]
  /** Accepted for wire compatibility; the tool bridge decides actual call policy. */
  readonly tool_choice?: unknown
  /** `true` selects server-sent events; omission or `false` returns one JSON body. */
  readonly stream?: boolean
  /**
   * Stable caller-side conversation key. The bridge reuses it as the local
   * thread id, which is how one harness session maps onto one web-chat thread.
   */
  readonly user?: string
  /** Accepted for wire compatibility and ignored by the web transport. */
  readonly temperature?: number
  /** Accepted for wire compatibility and ignored by the web transport. */
  readonly max_tokens?: number
  /** Accepted for wire compatibility and ignored by the web transport. */
  readonly stop?: string | readonly string[]
}

/** One streamed tool-call fragment inside a chunk delta. */
export interface WireToolCallDelta {
  readonly index: number
  readonly id?: string
  readonly type?: 'function'
  readonly function?: {
    readonly name?: string
    readonly arguments?: string
  }
}

/** The `delta` of one streamed chunk. */
export interface WireChunkDelta {
  readonly role?: 'assistant'
  readonly content?: string
  readonly tool_calls?: readonly WireToolCallDelta[]
}

/** One choice of a streamed chunk. */
export interface WireChunkChoice {
  readonly index: number
  readonly delta: WireChunkDelta
  readonly finish_reason: 'stop' | 'tool_calls' | 'length' | null
}

/** Token accounting on the wire. */
export interface WireUsage {
  readonly prompt_tokens: number
  readonly completion_tokens: number
  readonly total_tokens: number
}

/** One server-sent `data:` payload of a streamed chat completion. */
export interface ChatCompletionChunk {
  readonly id: string
  readonly object: 'chat.completion.chunk'
  readonly created: number
  readonly model: string
  readonly choices: readonly WireChunkChoice[]
  readonly usage?: WireUsage
}

/** The non-streaming chat-completions body. */
export interface ChatCompletionResponse {
  readonly id: string
  readonly object: 'chat.completion'
  readonly created: number
  readonly model: string
  readonly choices: readonly {
    readonly index: number
    readonly message: { readonly role: 'assistant'; readonly content: string; readonly tool_calls?: readonly WireToolCall[] }
    readonly finish_reason: 'stop' | 'tool_calls'
  }[]
  readonly usage: WireUsage
}

/** One model entry of the OpenAI `/v1/models` list. */
export interface ModelCard {
  readonly id: string
  readonly object: 'model'
  readonly created: number
  readonly owned_by: string
}

/**
 * One playable model. The registry owns availability: an id missing from this
 * list is refused instead of being forwarded to a web account that cannot run it.
 */
export interface ModelDescriptor {
  /** Request id the caller sends, and the value echoed back in every chunk. */
  readonly id: string
  /** Provider display name shown by configuration surfaces. */
  readonly name: string
  /** Context capacity the local compactor treats as the rotation budget. */
  readonly contextWindow: number
  /** Output cap advertised to callers; the web chat enforces its own. */
  readonly maxOutputTokens: number
  /** Whether the upstream web chat exposes a reasoning mode for this route. */
  readonly reasoning: boolean
}

/** One message after wire normalization, plus the identity used for prefix diffing. */
export interface NormalizedMessage {
  readonly role: WireRole
  /** Deterministic text projection; tool payloads are rendered, never forwarded raw. */
  readonly text: string
  /** Stable digest of role and text, comparing sent history against the caller's history. */
  readonly fingerprint: string
}

/** One prompt the bridge types into the web chat. */
export interface OutgoingMessage {
  readonly text: string
}

/** Why the bridge gave up on the current web-chat thread and opened a new one. */
export type RotationReason = 'first-turn' | 'diverged' | 'overflow' | 'message-limit' | 'explicit'

/**
 * The decision of the context planner for one request: either append the
 * delta to the live web thread, or start a new web thread and replay a
 * compacted preamble into it.
 */
export type SyncPlan =
  | { readonly kind: 'reuse'; readonly outgoing: readonly OutgoingMessage[] }
  | { readonly kind: 'rotate'; readonly reason: RotationReason; readonly outgoing: readonly OutgoingMessage[] }

/** Durable state of one local thread and the web session currently serving it. */
export interface ThreadState {
  /** Local thread id, derived from the caller's `user` key. */
  readonly id: string
  /** Monotonic web-session counter; increments on every rotation. */
  readonly generation: number
  /** Opaque id of the web chat currently bound, for diagnostics only. */
  readonly webSessionId: string
  /** Fingerprints of every message already delivered to the live web session, in order. */
  readonly synced: readonly string[]
  /** Estimated tokens held by the live web session. */
  readonly tokens: number
  /** Number of completed bridge turns on this generation. */
  readonly turns: number
  /** ISO timestamp of the first turn. */
  readonly createdAt: string
  /** ISO timestamp of the last committed turn. */
  readonly updatedAt: string
}

/** Budget that turns a growing web thread into a rotation. */
export interface ContextPolicy {
  /** Hard cap on messages injected into one web session. */
  readonly maxMessages: number
  /** Estimated-token cap for one web session. */
  readonly maxTokens: number
  /** Newest messages replayed verbatim into a replacement session. */
  readonly replayTail: number
  /** Per-message clamp applied before accounting, so one huge paste cannot exhaust a session. */
  readonly maxCharsPerMessage: number
}

/** One frame the kernel produces for the wire encoder. */
export type KernelChunk =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tool-call'; readonly id: string; readonly name: string; readonly arguments: string }
  | { readonly type: 'finish'; readonly reason: 'stop' | 'tool_calls'; readonly usage: WireUsage }

/** One live web-chat conversation the bridge can drive. */
export interface WebChatSession {
  /** Opaque id used in logs and thread state. */
  readonly id: string
  /**
   * Deliver one prompt and yield the answer as incremental text, ending when
   * the upstream stops generating. Implementations must honor `signal`.
   * @param prompt - text typed into the web chat composer.
   * @param signal - cancellation of the upstream generation.
   * @returns incremental answer text chunks.
   */
  send(prompt: string, signal?: AbortSignal): AsyncIterable<string>
  /** Leave the conversation; a rotated thread calls this before opening the next one. */
  close(): Promise<void>
}

/** Opens web-chat conversations; one implementation per transport mechanism. */
export interface WebChatTransport {
  /**
   * Start a fresh conversation, which is what a rotation consumes.
   * @param signal - cancellation of the open operation.
   * @returns the live conversation handle.
   */
  open(signal?: AbortSignal): Promise<WebChatSession>
}

/**
 * Bridge to the Electron guest page that owns the signed-in chat site. The
 * desktop shell implements it over its own `<webview>` automation channel;
 * the transport never imports Electron itself, so the package stays
 * Host-runtime agnostic and testable with a fake port.
 */
export interface GuestPort {
  /**
   * Run one script inside the guest page and return its JSON value.
   * @param script - self-contained expression evaluated in the guest's main world.
   * @returns the script's JSON-serializable result.
   */
  evaluate<T>(script: string): Promise<T>
}

/** One parsed tool call produced by the prompt-level protocol. */
export interface ParsedToolCall {
  /** Provider-issued id correlating the call with its result message. */
  readonly id: string
  /** Tool name exactly as declared in the offered schema. */
  readonly name: string
  /** Raw JSON argument text as the model emitted it. */
  readonly arguments: string
}

/** One `mcpServers` entry as written by a connector document. */
export interface McpServerConfig {
  /** Transport discriminator; a `command` implies stdio and a `url` implies streamable HTTP. */
  readonly type?: 'stdio' | 'sse' | 'streamable-http'
  /** stdio: executable to start, for example `npx` or `uvx`. */
  readonly command?: string
  /** stdio: arguments passed without shell interpolation. */
  readonly args?: readonly string[]
  /** stdio: extra child environment. */
  readonly env?: Readonly<Record<string, string>>
  /** stdio: working directory for the child process. */
  readonly cwd?: string
  /** Remote: MCP endpoint URL. */
  readonly url?: string
  /** Remote: extra request headers. */
  readonly headers?: Readonly<Record<string, string>>
  /** Durable intent; omission means enabled. */
  readonly enabled?: boolean
}

/** The `mcpServers` connector document this package reads and writes. */
export interface ConnectorDocument {
  readonly mcpServers: Readonly<Record<string, McpServerConfig>>
}

/**
 * One validated connector in the flat entry form the harness MCP manager
 * consumes, so a connector document needs no second translation layer.
 */
export interface ManagedConnector {
  readonly transport: 'stdio' | 'streamable-http'
  readonly command: string
  readonly args: string[]
  readonly env: Record<string, string>
  readonly cwd: string
  readonly url: string
  readonly headers: Record<string, string>
  readonly enabled: boolean
  readonly startupTimeoutMs: number
}

/** Minimal logging seam so the package does not depend on a host logger implementation. */
export interface BridgeLogger {
  /**
   * Record one informational line.
   * @param message - line to record.
   */
  info(message: string): void
  /**
   * Record one warning.
   * @param message - line to record.
   */
  warn(message: string): void
  /**
   * Record one recoverable failure.
   * @param message - line to record.
   * @param error - the failure.
   */
  error(message: string, error: unknown): void
}

/** One playable route the bridge serves. */
export interface FreeChatModelRow {
  /** Route id the caller requests. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** Rotation budget the local compactor uses. */
  readonly contextWindow: number
  /** Advertised output cap. */
  readonly maxOutputTokens: number
  /** Whether the route exposes a reasoning mode. */
  readonly reasoning: boolean
}

/** One local thread and its web-session generation. */
export interface FreeChatThreadRow {
  /** Sanitized local thread id. */
  readonly id: string
  /** Web-session generation the thread is on. */
  readonly generation: number
  /** Completed bridge turns on the current generation. */
  readonly turns: number
  /** ISO timestamp of the last committed turn, absent before the first commit. */
  readonly updatedAt?: string | undefined
  /** Whether a live web conversation is bound right now. */
  readonly live: boolean
}

/** Routes and threads as the administration page shows them. */
export interface FreeChatState {
  /** Playable routes. */
  readonly models: readonly FreeChatModelRow[]
  /** Known threads. */
  readonly threads: readonly FreeChatThreadRow[]
}
