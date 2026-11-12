/**
 * Low-level fetch wrapper — the ONLY place HTTP calls happen in the client.
 *
 * Authentication is dual-mode:
 *   - Shop API token (starts with "haszno_"): Authorization: Bearer <token>
 *     Accepted from HASZNO_API_TOKEN (preferred), HASZNO_API_KEY, ARFUTAR_API_KEY, or opts.apiKey.
 *   - Non-prefixed API key: x-api-key header (unchanged legacy behaviour).
 *   - HTTP Basic ("user:password"): Authorization: Basic <base64> (unchanged).
 *
 * The haszno_ prefix is the token's shape, not a scope selection — any key that
 * starts with "haszno_" is a shop Bearer token; everything else is a legacy key.
 *
 * Never logs or exposes credentials.
 * Retries 5xx and 429 with exponential back-off (max 3 attempts).
 */
import { HasznoApiError } from './error.js'

/** Prefix that server-issued shop API tokens always carry. */
export const SHOP_TOKEN_PREFIX = 'haszno_'

/** Returns true when `key` is a server-issued shop API token. */
export function isShopToken(key: string | undefined): key is string {
  return !!key?.startsWith(SHOP_TOKEN_PREFIX)
}

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
  // Priority: explicit opts.apiKey > HASZNO_API_TOKEN (new, preferred for shop tokens) >
  //           HASZNO_API_KEY > ARFUTAR_API_KEY (legacy).
  // Never print credentials.
  const key =
    opts.apiKey ??
    process.env['HASZNO_API_TOKEN'] ??
    process.env['HASZNO_API_KEY'] ??
    process.env['ARFUTAR_API_KEY']

  if (key) {
    // Shop API token → Bearer; any other key → x-api-key (legacy behaviour unchanged).
    if (isShopToken(key)) return { Authorization: `Bearer ${key}` }
    return { 'x-api-key': key }
  }

  const basic = opts.basicAuth ?? process.env['HASZNO_BASIC'] ?? process.env['ARFUTAR_BASIC']
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
