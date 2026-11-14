export class HasznoApiError extends Error {
  /**
   * Machine-readable error code from the API error envelope
   * (e.g. "unauthenticated", "forbidden", "invalid_request", "conflict",
   * "rate_limited"). Undefined when the response body was not parseable.
   */
  readonly code: string | undefined
  /**
   * Request-ID echoed from the X-Request-Id response header or the
   * requestId field in the error envelope. Pass this to support when
   * reporting a problem. Undefined when not supplied by the server.
   */
  readonly requestId: string | undefined

  constructor(
    public readonly status: number,
    message: string,
    code?: string,
    requestId?: string,
  ) {
    super(message)
    this.name = 'HasznoApiError'
    this.code = code
    this.requestId = requestId
  }
}
