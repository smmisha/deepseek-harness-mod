/**
 * Typed bridge failures. The HTTP layer maps them to OpenAI-compatible error
 * bodies, so a caller sees a status and a machine code instead of a stack.
 */

/** Stable machine codes the proxy reports to OpenAI-compatible clients. */
export type BridgeErrorCode =
  | 'INVALID_REQUEST'
  | 'MODEL_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'TRANSPORT_FAILED'
  | 'UNAVAILABLE'
  | 'INTERNAL'

/** One failure with the HTTP status its callers should observe. */
export class BridgeError extends Error {
  /** Stable machine code. */
  readonly code: BridgeErrorCode
  /** HTTP status the server answers with. */
  readonly status: number

  /**
   * @param message - human-readable failure summary.
   * @param code - stable machine code.
   * @param status - HTTP status the server answers with.
   */
  constructor(message: string, code: BridgeErrorCode, status: number) {
    super(message)
    this.name = 'BridgeError'
    this.code = code
    this.status = status
  }
}
