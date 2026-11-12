/**
 * Low-level fetch wrapper — the ONLY place HTTP calls happen in the client.
 * - Auth from env: HASZNO_API_TOKEN → Authorization: Bearer (canonical for shop API tokens)
 *   HASZNO_API_KEY → Authorization: Bearer (silent migration alias)
 *   HASZNO_BASIC  → Authorization: Basic  (HTTP Basic, for session-based endpoints)
 * - Never logs or exposes credentials.
 * - Retries 5xx and 429 with exponential back-off (max 3 attempts).
 */
import { HasznoApiError } from './error.js'

export interface HttpOptions {
  baseUrl?: string
  apiKey?: string
  basicAuth?: string
  /** fetch implementation; defaults to global fetch */
  fetch?: typeof fetch
  /** initial retry delay ms (doubles each attempt) */
  retryDelayMs?: number
  /** max retry attempts */
  maxRetries?: number
  /** request timeout ms */
  timeoutMs?: number
}

function buildAuthHeader(opts: HttpOptions): Record<string, string> {
  // Shop API token: HASZNO_API_TOKEN (canonical) or HASZNO_API_KEY (migration alias).
  // Both are sent as Authorization: Bearer <token>.
  // Never print credentials.
  const bearerToken =
    opts.apiKey ??
    process.env['HASZNO_API_TOKEN'] ??
    process.env['HASZNO_API_KEY'] ?? // silent migration alias
    process.env['ARFUTAR_API_KEY'] // legacy alias
  if (bearerToken) return { Authorization: `Bearer ${bearerToken}` }

  // HTTP Basic is kept as an escape hatch for session-based endpoints.
  const basic =
    opts.basicAuth ??
    process.env['HASZNO_BASIC'] ??
    process.env['ARFUTAR_BASIC'] // legacy alias
  if (basic) {
    const encoded = Buffer.from(basic).toString('base64')
    return { Authorization: `Basic ${encoded}` }
  }
  return {}
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export async function request<T>(
  method: string,
  path: string,
  body: unknown,
  opts: HttpOptions,
): Promise<T> {
  const baseUrl = (
    opts.baseUrl ??
    process.env['HASZNO_API_URL'] ??
    process.env['ARFUTAR_API_URL'] ??
    'https://haszno.com'
  ).replace(/\/$/, '')
  const url = `${baseUrl}${path}`
  const fetchFn = opts.fetch ?? fetch

  const maxRetries = opts.maxRetries ?? 3
  const retryDelayMs = opts.retryDelayMs ?? 500
  const timeoutMs = opts.timeoutMs ?? 30_000

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'haszno-mcp/0.1.0',
    ...buildAuthHeader(opts),
  }

  let lastError: unknown
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs * Math.pow(2, attempt - 1))

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let response: Response
    try {
      response = await fetchFn(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
    } catch (err) {
      lastError = err
      // Network errors (not HTTP errors) are retried
      continue
    } finally {
      clearTimeout(timer)
    }

    // Retry on 429 or 5xx
    if ((response.status === 429 || response.status >= 500) && attempt < maxRetries - 1) {
      lastError = new HasznoApiError(response.status, `HTTP ${response.status}`)
      continue
    }

    if (!response.ok) {
      let message = `HTTP ${response.status}`
      try {
        const json = (await response.json()) as { error?: string }
        if (json.error) message = json.error
      } catch {
        // ignore parse errors — keep generic message
      }
      throw new HasznoApiError(response.status, message)
    }

    // 204 or empty body
    const text = await response.text()
    if (!text) return undefined as unknown as T
    return JSON.parse(text) as T
  }

  if (lastError instanceof HasznoApiError) throw lastError
  throw new Error(`Network error after ${maxRetries} attempts: ${String(lastError)}`)
}

export function get<T>(path: string, opts: HttpOptions): Promise<T> {
  return request<T>('GET', path, undefined, opts)
}

export function post<T>(path: string, body: unknown, opts: HttpOptions): Promise<T> {
  return request<T>('POST', path, body, opts)
}

export function put<T>(path: string, body: unknown, opts: HttpOptions): Promise<T> {
  return request<T>('PUT', path, body, opts)
}

export function patch<T>(path: string, body: unknown, opts: HttpOptions): Promise<T> {
  return request<T>('PATCH', path, body, opts)
}

export function del<T>(path: string, opts: HttpOptions): Promise<T> {
  return request<T>('DELETE', path, undefined, opts)
}
