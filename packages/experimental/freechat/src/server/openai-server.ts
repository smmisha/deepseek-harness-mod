/**
 * Local OpenAI-compatible surface: `/v1/models`, `/v1/chat/completions` with
 * server-sent events, and the thread-reset admin route. Any client that speaks
 * the OpenAI protocol can point at it; the harness reaches it through its own
 * OpenAI-compatible provider route, so no agent-loop change is involved.
 */

import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  BridgeLogger,
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelCard,
  WireToolCall,
  WireUsage,
} from '../types.ts'
import { BridgeError } from '../kernel/errors.ts'
import type { FreeChatKernel } from '../kernel/kernel.ts'
import type { ModelRegistry } from '../kernel/model-registry.ts'

/** Server settings resolved once at mount. */
export interface OpenAiServerOptions {
  /** Turn executor the routes call. */
  readonly kernel: FreeChatKernel
  /** Playable model directory behind `/v1/models`. */
  readonly registry: ModelRegistry
  /** Diagnostic sink. */
  readonly logger: BridgeLogger
  /** Bind address; the default keeps the proxy off the network. */
  readonly host: string
  /** Listen port; zero asks the operating system for a free one. */
  readonly port: number
  /** Bearer token every request must present; an empty string disables authentication. */
  readonly token: string
  /** Largest accepted request body in bytes. */
  readonly maxBodyBytes: number
}

/** The listening proxy, with the origin resolved after `listen`. */
export interface FreeChatServer {
  /** Origin clients target, valid after {@link FreeChatServer.listen}. */
  origin(): string
  /**
   * Bind the port.
   * @returns the resolved origin, for example `http://127.0.0.1:8788`.
   */
  listen(): Promise<string>
  /** Stop accepting connections and release the port. */
  close(): Promise<void>
}

/** Read a whole request body while enforcing the configured cap. */
async function readBody(request: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  // No encoding is set on the request, so the stream yields Buffers.
  for await (const buffer of request as AsyncIterable<Buffer>) {
    size += buffer.length
    if (size > limit) throw new BridgeError(`request body exceeds ${limit} bytes`, 'INVALID_REQUEST', 413)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Write one JSON response. */
function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  response.end(payload)
}

/** Write one OpenAI-compatible error body. */
function sendError(response: ServerResponse, error: BridgeError): void {
  sendJson(response, error.status, {
    error: { message: error.message, type: 'invalid_request_error', code: error.code },
  })
}

/** Start an SSE response; a comment line makes intermediate proxies flush. */
function startSse(response: ServerResponse): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  response.write(': freechat\n\n')
}

/** Write one SSE payload. */
function writeSse(response: ServerResponse, payload: unknown): void {
  response.write(`data: ${JSON.stringify(payload)}\n\n`)
}

/** Write the terminator, which is the one payload the wire sends unquoted. */
function endSse(response: ServerResponse): void {
  response.write('data: [DONE]\n\n')
  response.end()
}

/** Read the presented credential from either accepted header. */
function presentedToken(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization
  if (authorization !== undefined && authorization.startsWith('Bearer ')) return authorization.slice('Bearer '.length)
  const apiKey = request.headers['x-api-key']
  return typeof apiKey === 'string' ? apiKey : undefined
}

/** Validate the request body into the request type the kernel takes. */
function parseChatRequest(body: string): ChatCompletionRequest {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new BridgeError('request body is not valid JSON', 'INVALID_REQUEST', 400)
  }
  if (typeof parsed !== 'object' || parsed === null) throw new BridgeError('request body must be an object', 'INVALID_REQUEST', 400)
  const candidate = parsed as Partial<ChatCompletionRequest>
  if (!Array.isArray(candidate.messages)) throw new BridgeError('messages must be an array', 'INVALID_REQUEST', 400)
  return candidate as ChatCompletionRequest
}

/** Build one streamed chunk for the given delta. */
function chunkOf(id: string, created: number, model: string, delta: ChatCompletionChunk['choices'][number]['delta'], finish: ChatCompletionChunk['choices'][number]['finish_reason']): ChatCompletionChunk {
  return { id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }] }
}

/** Usage object for one response. */
function usageOf(prompt: number, completion: number): WireUsage {
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion }
}

/**
 * Build the proxy server without binding it, so a caller controls the port.
 * @param options - kernel, registry, address, credential, body cap.
 * @returns the server handle.
 */
export function createFreeChatServer(options: OpenAiServerOptions): FreeChatServer {
  let resolvedOrigin = `http://${options.host}:${options.port}`
  /** Model id echoed in responses: the requested one, else the registry's default route. */
  const modelIdOf = (request: ChatCompletionRequest): string => {
    if (request.model !== undefined) return request.model
    /* v8 ignore next -- the registry always keeps its built-in routes, so a default exists */
    return options.registry.resolve(undefined)?.id ?? 'deepseek-web-chat'
  }
  const server = createServer((request, response) => {
    /* v8 ignore next 5 -- safety net: handle answers every failure itself, so nothing reaches here */
    void handle(request, response).catch((error: unknown) => {
      options.logger.error('freechat: unhandled request failure', error)
      if (!response.headersSent) sendJson(response, 500, { error: { message: 'internal bridge failure', type: 'internal_error' } })
      else response.end()
    })
  })

  /** Authenticate one request against the configured token. */
  const authorize = (request: IncomingMessage): void => {
    if (options.token.length === 0) return
    if (presentedToken(request) !== options.token) throw new BridgeError('invalid bearer token', 'UNAUTHORIZED', 401)
  }

  /** Answer `/v1/models`. */
  const models = (response: ServerResponse): void => {
    const created = Math.floor(Date.now() / 1000)
    const data: ModelCard[] = options.registry.list().map(model => ({ id: model.id, object: 'model', created, owned_by: 'freechat' }))
    sendJson(response, 200, { object: 'list', data })
  }

  /** Answer a streaming chat completion. */
  const streamCompletion = async (
    response: ServerResponse,
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): Promise<void> => {
    const id = `chatcmpl-${randomUUID()}`
    const created = Math.floor(Date.now() / 1000)
    const model = modelIdOf(request)
    const iterator = options.kernel.complete(request, signal)
    let promptTokens = 0
    let completionTokens = 0
    try {
      const first = await iterator.next()
      startSse(response)
      writeSse(response, chunkOf(id, created, model, { role: 'assistant' }, null))
      let index = 0
      let frame = first
      while (frame.done !== true) {
        const value = frame.value
        if (value.type === 'text') writeSse(response, chunkOf(id, created, model, { content: value.text }, null))
        else if (value.type === 'tool-call') {
          writeSse(response, chunkOf(id, created, model, {
            tool_calls: [{ index, id: value.id, type: 'function', function: { name: value.name, arguments: value.arguments } }],
          }, null))
          index += 1
        } else {
          promptTokens = value.usage.prompt_tokens
          completionTokens = value.usage.completion_tokens
          writeSse(response, {
            ...chunkOf(id, created, model, {}, value.reason),
            usage: usageOf(promptTokens, completionTokens),
          })
        }
        frame = await iterator.next()
      }
      endSse(response)
    } catch (error) {
      if (!response.headersSent) throw error
      /* v8 ignore next -- the kernel reports every failure as a BridgeError */
      const failure = error instanceof BridgeError ? error : new BridgeError('stream failed', 'INTERNAL', 500)
      writeSse(response, { error: { message: failure.message, code: failure.code } })
      response.end()
      options.logger.warn(`freechat: stream terminated: ${failure.message}`)
    }
  }

  /** Answer a non-streaming chat completion. */
  const completeOnce = async (
    response: ServerResponse,
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): Promise<void> => {
    const id = `chatcmpl-${randomUUID()}`
    const created = Math.floor(Date.now() / 1000)
    let content = ''
    const toolCalls: WireToolCall[] = []
    let usage: WireUsage | undefined
    let finish: 'stop' | 'tool_calls' = 'stop'
    for await (const frame of options.kernel.complete(request, signal)) {
      if (frame.type === 'text') content += frame.text
      else if (frame.type === 'tool-call') toolCalls.push({ id: frame.id, type: 'function', function: { name: frame.name, arguments: frame.arguments } })
      else {
        usage = frame.usage
        finish = frame.reason
      }
    }
    const body: ChatCompletionResponse = {
      id,
      object: 'chat.completion',
      created,
      model: modelIdOf(request),
      choices: [{
        index: 0,
        message: toolCalls.length > 0
          ? { role: 'assistant', content, tool_calls: toolCalls }
          : { role: 'assistant', content },
        finish_reason: finish,
      }],
      /* v8 ignore next -- the kernel always ends a turn with a finish frame carrying usage */
      usage: usage ?? usageOf(0, 0),
    }
    sendJson(response, 200, body)
  }

  /** Route one request. */
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader('access-control-allow-origin', '*')
    response.setHeader('access-control-allow-headers', 'authorization, content-type, x-api-key')
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }
    /* v8 ignore next -- a server-side request always carries its URL */
    const url = new URL(request.url ?? '/', 'http://localhost')
    try {
      if (request.method === 'GET' && url.pathname === '/healthz') {
        sendJson(response, 200, { ok: true })
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/models') {
        authorize(request)
        models(response)
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
        authorize(request)
        const body = await readBody(request, options.maxBodyBytes)
        const parsed = parseChatRequest(body)
        const controller = new AbortController()
        response.on('close', () => {
          if (!response.writableEnded) controller.abort()
        })
        if (parsed.stream === true) {
          await streamCompletion(response, parsed, controller.signal)
          return
        }
        await completeOnce(response, parsed, controller.signal)
        return
      }
      if (request.method === 'GET' && url.pathname === '/admin/state') {
        authorize(request)
        sendJson(response, 200, {
          ok: true,
          models: options.registry.list(),
          threads: await options.kernel.snapshots(),
        })
        return
      }
      const reset = /^\/admin\/threads\/([^/]+)\/reset$/u.exec(url.pathname)
      if (request.method === 'POST' && reset !== null) {
        authorize(request)
        /* v8 ignore next -- the route pattern always captures the id */
        const key = decodeURIComponent(reset[1] ?? '')
        const closed = await options.kernel.resetThread(key)
        sendJson(response, 200, { reset: true, closedSession: closed })
        return
      }
      /* v8 ignore next -- a server-side request always carries its method */
      sendJson(response, 404, { error: { message: `no route for ${request.method ?? ''} ${url.pathname}`, type: 'invalid_request_error' } })
    } catch (error) {
      const failure = error instanceof BridgeError ? error : new BridgeError('internal bridge failure', 'INTERNAL', 500)
      if (!(error instanceof BridgeError)) options.logger.error('freechat: request failed', error)
      sendError(response, failure)
    }
  }

  return {
    origin: () => resolvedOrigin,
    async listen(): Promise<string> {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(options.port, options.host, () => {
          server.off('error', reject)
          resolve()
        })
      })
      const address = server.address()
      /* v8 ignore next -- a TCP server listening on a host and port reports an address object */
      if (address !== null && typeof address === 'object') {
        resolvedOrigin = `http://${options.host}:${address.port}`
      }
      return resolvedOrigin
    },
    async close(): Promise<void> {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) reject(error)
          else resolve()
        })
      })
    },
  }
}
