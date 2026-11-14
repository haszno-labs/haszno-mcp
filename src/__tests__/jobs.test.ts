/**
 * Unit tests for the job-application MCP tools (haszno_shop_job_*).
 *
 * Uses a stub McpServer and a mock fetch (injected via opts.fetch) — no network calls.
 * Covers: URL + method + body per tool, CV upload (filePath and base64 paths),
 * apply error-code mapping, remote-mode behaviour, and mapApiError fallthrough.
 *
 * The node:fs module is mocked for the cv_upload filePath path and
 * the applicant_cv_download savePath path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── node:fs mock ─────────────────────────────────────────────────────────────

const fsMock = vi.hoisted(() => ({
  readFileSyncResult: null as Buffer | null,
  readFileSyncError: null as Error | null,
  writeFileSyncError: null as Error | null,
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: vi.fn().mockImplementation(() => {
      if (fsMock.readFileSyncError) throw fsMock.readFileSyncError
      if (fsMock.readFileSyncResult) return fsMock.readFileSyncResult
      // Default: a minimal valid PDF (starts with %PDF-)
      return Buffer.from('%PDF-1.4 test content')
    }),
    writeFileSync: vi.fn().mockImplementation(() => {
      if (fsMock.writeFileSyncError) throw fsMock.writeFileSyncError
    }),
  }
})

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerJobTools } from '../tools/jobs.js'
import type { HttpOptions } from '../client/http.js'

// ─── Stub McpServer ───────────────────────────────────────────────────────────

type ToolCb = (args: Record<string, unknown>) => Promise<unknown>

function makeStubServer(): { server: McpServer; getToolCb: (name: string) => ToolCb } {
  const tools = new Map<string, ToolCb>()
  const server = {
    registerTool: (_name: string, _cfg: unknown, cb: ToolCb) => {
      tools.set(_name, cb)
      return {}
    },
  } as unknown as McpServer
  return {
    server,
    getToolCb: (name) => {
      const cb = tools.get(name)
      if (!cb) throw new Error(`Tool "${name}" not registered`)
      return cb
    },
  }
}

// ─── Mock fetch helpers ───────────────────────────────────────────────────────

type FetchCall = { url: string; method: string; body: unknown; headers: Record<string, string> }

function makeFetch(
  status: number,
  body: unknown,
): { fn: typeof fetch; calls: FetchCall[] }
function makeFetch(
  status: number,
  body: unknown,
  binary: true,
): { fn: typeof fetch; calls: FetchCall[] }
function makeFetch(
  status: number,
  body: unknown,
  binary = false,
): { fn: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const rawBody = init?.body
    let parsedBody: unknown = undefined
    if (typeof rawBody === 'string') {
      try { parsedBody = JSON.parse(rawBody) } catch { parsedBody = rawBody }
    } else if (rawBody instanceof Uint8Array || rawBody instanceof ArrayBuffer || Buffer.isBuffer(rawBody)) {
      parsedBody = '__RawBinary__'
    }
    calls.push({
      url: String(url),
      method: (init?.method ?? 'GET').toUpperCase(),
      body: parsedBody,
      headers: (init?.headers ?? {}) as Record<string, string>,
    })
    if (binary) {
      const bytes = body instanceof Uint8Array ? body : Buffer.from('%PDF-binary')
      return new Response(bytes as unknown as ArrayBuffer, {
        status,
        headers: { 'Content-Type': 'application/pdf' },
      })
    }
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return { fn, calls }
}

function makeOpts(fetchFn: typeof fetch): HttpOptions {
  return { baseUrl: 'https://test.haszno.com', apiKey: 'haszno_testtoken', fetch: fetchFn }
}

// ─── Result helpers ───────────────────────────────────────────────────────────

function parseResult(result: unknown): unknown {
  const r = result as { content: Array<{ type: string; text: string }> }
  return JSON.parse(r.content[0].text)
}

function isError(result: unknown): boolean {
  return !!(result as { isError?: boolean }).isError
}

function getText(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0].text
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal valid PDF buffer (%PDF- magic). */
const validPdf = Buffer.from('%PDF-1.4 minimal test content')

/** Base64 of the valid PDF. */
const validPdfB64 = validPdf.toString('base64')

/** Buffer that is NOT a valid PDF (no %PDF- magic). */
const notPdf = Buffer.from('Not a PDF file at all!')

/** Base64 of the non-PDF buffer. */
const notPdfB64 = notPdf.toString('base64')

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('registerJobTools', () => {
  let stub: ReturnType<typeof makeStubServer>

  beforeEach(() => {
    stub = makeStubServer()
    fsMock.readFileSyncResult = null
    fsMock.readFileSyncError = null
    fsMock.writeFileSyncError = null
  })

  // ─── haszno_shop_job_profile_get ───────────────────────────────────────────

  describe('haszno_shop_job_profile_get', () => {
    it('calls GET /api/v1/shop/jobs/profile', async () => {
      const { fn, calls } = makeFetch(200, { profile: { fullName: 'Teszt Elek' } })
      registerJobTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_job_profile_get')({})
      expect(isError(result)).toBe(false)
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toContain('/api/v1/shop/jobs/profile')
      expect(calls[0].method).toBe('GET')
    })

    it('returns null profile when no profile exists', async () => {
      const { fn } = makeFetch(200, { profile: null })
      registerJobTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_job_profile_get')({})
      const data = parseResult(result) as { profile: null }
      expect(data.profile).toBeNull()
    })

    it('returns error on 401', async () => {
      const { fn } = makeFetch(401, { error: 'unauthenticated' })
      registerJobTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_job_profile_get')({})
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('401')
    })
  })

  // ─── haszno_shop_job_profile_save ──────────────────────────────────────────

  describe('haszno_shop_job_profile_save', () => {
    it('calls PUT /api/v1/shop/jobs/profile with required fields', async () => {
      const { fn, calls } = makeFetch(200, { profile: { fullName: 'Teszt Elek', email: 'teszt@example.com' } })
      registerJobTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_job_profile_save')({
        fullName: 'Teszt Elek',
        email: 'teszt@example.com',
        consent: true,
      })
      expect(calls[0].url).toContain('/api/v1/shop/jobs/profile')
      expect(calls[0].method).toBe('PUT')
      const body = calls[0].body as Record<string, unknown>
      expect(body['fullName']).toBe('Teszt Elek')
      expect(body['email']).toBe('teszt@example.com')
      expect(body['consent']).toBe(true)
    })

    it('includes optional fields when supplied', async () => {
      const { fn, calls } = makeFetch(200, { profile: {} })
      registerJobTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_job_profile_save')({
        fullName: 'Teszt Elek',
        email: 'teszt@example.com',
        consent: true,
        headline: 'Senior fejlesztő',
        skills: ['TypeScript', 'Node.js'],
        desiredSectors: ['it'],
        autoApply: true,
      })
      const body = calls[0].body as Record<string, unknown>
      expect(body['headline']).toBe('Senior fejlesztő')
      expect(body['skills']).toEqual(['TypeScript', 'Node.js'])
      expect(body['desiredSectors']).toEqual(['it'])
      expect(body['autoApply']).toBe(true)
    })

    it('returns error on API failure', async () => {
      const { fn } = makeFetch(422, { error: 'validation error' })
      registerJobTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_job_profile_save')({
        fullName: 'X',
        email: 'bad',
        consent: true,
      })
      expect(isError(result)).toBe(true)
    })
  })

  // ─── haszno_shop_job_cv_upload (local mode) ────────────────────────────────

  describe('haszno_shop_job_cv_upload (local mode)', () => {
    it('calls PUT /api/v1/shop/jobs/profile/cv with raw binary from filePath', async () => {
      fsMock.readFileSyncResult = validPdf
      const { fn, calls } = makeFetch(200, { profile: { cvFileName: 'cv.pdf' } })
      registerJobTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_job_cv_upload')({
        filePath: '/home/user/cv.pdf',
      })
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toContain('/api/v1/shop/jobs/profile/cv')
      expect(calls[0].method).toBe('PUT')
      expect(calls[0].body).toBe('__RawBinary__')
      expect(calls[0].headers['Content-Type']).toBe('application/pdf')
      expect(calls[0].headers['X-File-Name']).toBeTruthy()
    })

    it('calls PUT with base64 PDF', async () => {
      const { fn, calls } = makeFetch(200, { profile: { cvFileName: 'mycv.pdf' } })
      registerJobTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_job_cv_upload')({
        base64: validPdfB64,
        fileName: 'mycv.pdf',
      })
      expect(calls[0].url).toContain('/api/v1/shop/jobs/profile/cv')
      expect(calls[0].method).toBe('PUT')
      expect(calls[0].body).toBe('__RawBinary__')
    })

    it('rejects when neither filePath nor base64 provided', async () => {
      const { fn } = makeFetch(200, {})
      registerJobTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_job_cv_upload')({})
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('filePath')
    })

    it('rejects when base64 provided without fileName', async () => {
      const { fn } = makeFetch(200, {})
      registerJobTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_job_cv_upload')({
        base64: validPdfB64,
      })
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('fileName')
    })

    it('rejects non-PDF file (no %PDF- magic)', async () => {
      fsMock.readFileSyncResult = notPdf
      const { fn } = makeFetch(200, {})
      registerJobTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_job_cv_upload')({
        filePath: '/home/user/notapdf.pdf',
      })
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('PDF')
    })

    it('rejects non-PDF base64', async () => {
      const { fn } = makeFetch(200, {})
      registerJobTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_job_cv_upload')({
        base64: notPdfB64,
        fileName: 'nope.pdf',
      })
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('PDF')
    })

    it('rejects oversized file', async () => {
      // 4 MB + 1 byte of valid-ish PDF data
      const bigPdf = Buffer.concat([
        Buffer.from('%PDF-'),
        Buffer.alloc(4 * 1024 * 1024),
      ])
      fsMock.readFileSyncResult = bigPdf
      const { fn } = makeFetch(200, {})
      registerJobTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_job_cv_upload')({
        filePath: '/home/user/big.pdf',
      })
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('4 MB')
    })

    it('returns error on 409 (profile_required)', async () => {
      fsMock.readFileSyncResult = validPdf
      const { fn } = makeFetch(409, { error: 'profile required', code: 'profile_required' })
      registerJobTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_job_cv_upload')({
        filePath: '/home/user/cv.pdf',
      })
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('409')
    })
  })

  // ─── haszno_shop_job_cv_upload (remote mode) ──────────────────────────────

  describe('haszno_shop_job_cv_upload (remote mode)', () => {
    it('accepts base64 in remote mode', async () => {
      const { fn, calls } = makeFetch(200, { profile: { cvFileName: 'cv.pdf' } })
      registerJobTools(stub.server, makeOpts(fn), { remote: true })
      await stub.getToolCb('haszno_shop_job_cv_upload')({
        base64: validPdfB64,
        fileName: 'cv.pdf',
      })
      expect(calls[0].url).toContain('/api/v1/shop/jobs/profile/cv')
      expect(calls[0].method).toBe('PUT')
    })

    it('rejects non-PDF base64 in remote mode', async () => {
      const { fn } = makeFetch(200, {})
      registerJobTools(stub.server, makeOpts(fn), { remote: true })
      const result = await stub.getToolCb('haszno_shop_job_cv_upload')({
        base64: notPdfB64,
        fileName: 'nope.pdf',
      })
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('PDF')
    })
  })

  // ─── haszno_shop_job_matches ───────────────────────────────────────────────

  describe('haszno_shop_job_matches', () => {
    it('calls GET /api/v1/shop/jobs/matches', async () => {
      const { fn, calls } = makeFetch(200, { items: [] })
      registerJobTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_job_matches')({})
      expect(isError(result)).toBe(false)
      expect(calls[0].url).toContain('/api/v1/shop/jobs/matches')
      expect(calls[0].method).toBe('GET')
      expect(calls[0].url).not.toContain('?')
    })

    it('passes limit param', async () => {
      const { fn, calls } = makeFetch(200, { items: [] })
      registerJobTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_job_matches')({ limit: 5 })
      expect(calls[0].url).toContain('limit=5')
    })
  })

  // ─── haszno_shop_job_apply ─────────────────────────────────────────────────

  describe('haszno_shop_job_apply', () => {
    it('calls POST /api/v1/shop/ads/{adId}/applications', async () => {
      const { fn, calls } = makeFetch(201, { application: { id: 1, adId: 42 } })
      registerJobTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_job_apply')({ adId: 42 })
      expect(isError(result)).toBe(false)
      expect(calls[0].url).toContain('/api/v1/shop/ads/42/applications')
      expect(calls[0].method).toBe('POST')
    })

    it('includes message when provided', async () => {
      const { fn, calls } = makeFetch(201, { application: {} })
      registerJobTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_job_apply')({ adId: 10, message: 'Érdeklődöm az állás iránt.' })
      const body = calls[0].body as Record<string, unknown>
      expect(body['message']).toBe('Érdeklődöm az állás iránt.')
    })

    it('maps auto_apply_disabled (403) with next-step hint', async () => {
      const { fn } = makeFetch(403, { error: 'auto_apply_disabled', code: 'auto_apply_disabled' })
      registerJobTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_job_apply')({ adId: 42 })
      expect(isError(result)).toBe(true)
      const text = getText(result)
      expect(text).toContain('autoApply')
      expect(text).toContain('haszno.com')
    })

    it('maps profile_required (409) with next-step hint', async () => {
      const { fn } = makeFetch(409, { error: 'profile required', code: 'profile_required' })
      registerJobTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_job_apply')({ adId: 42 })
      expect(isError(result)).toBe(true)
      const text = getText(result)
      expect(text).toContain('haszno_shop_job_profile_save')
    })

    it('maps already_applied (409 code) correctly', async () => {
      const { fn } = makeFetch(409, { error: 'already applied', code: 'already_applied' })
      registerJobTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_job_apply')({ adId: 42 })
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('egyszer')
    })

    it('maps 429 (daily cap) correctly', async () => {
      const { fn } = makeFetch(429, { error: 'rate limited' })
      registerJobTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_job_apply')({ adId: 42 })
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('20')
    })

    it('maps 404 (not a job offer)', async () => {
      const { fn } = makeFetch(404, { error: 'not a job offer', code: 'not_a_job_offer' })
      registerJobTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_job_apply')({ adId: 99 })
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('404')
    })
  })

  // ─── haszno_shop_job_my_applications ──────────────────────────────────────

  describe('haszno_shop_job_my_applications', () => {
    it('calls GET /api/v1/shop/my/applications', async () => {
      const { fn, calls } = makeFetch(200, { items: [] })
      registerJobTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_job_my_applications')({})
      expect(isError(result)).toBe(false)
      expect(calls[0].url).toContain('/api/v1/shop/my/applications')
      expect(calls[0].method).toBe('GET')
    })
  })

  // ─── haszno_shop_job_withdraw ─────────────────────────────────────────────

  describe('haszno_shop_job_withdraw', () => {
    it('calls POST /api/v1/shop/my/applications/{id}/withdraw', async () => {
      const { fn, calls } = makeFetch(200, { application: { id: 7 } })
      registerJobTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_job_withdraw')({ id: 7 })
      expect(calls[0].url).toContain('/api/v1/shop/my/applications/7/withdraw')
      expect(calls[0].method).toBe('POST')
    })

    it('returns error on 404', async () => {
      const { fn } = makeFetch(404, { error: 'not found' })
      registerJobTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_job_withdraw')({ id: 999 })
      expect(isError(result)).toBe(true)
    })
  })

  // ─── haszno_shop_job_applicants_list ──────────────────────────────────────

  describe('haszno_shop_job_applicants_list', () => {
    it('calls GET /api/v1/shop/my/job-applications with no params', async () => {
      const { fn, calls } = makeFetch(200, { items: [], counts: { total: 0, unread: 0 } })
      registerJobTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_job_applicants_list')({})
      expect(isError(result)).toBe(false)
      expect(calls[0].url).toContain('/api/v1/shop/my/job-applications')
      expect(calls[0].url).not.toContain('?')
      expect(calls[0].method).toBe('GET')
    })

    it('passes adId and status params', async () => {
      const { fn, calls } = makeFetch(200, { items: [], counts: { total: 0, unread: 0 } })
      registerJobTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_job_applicants_list')({ adId: 5, status: 'uj' })
      expect(calls[0].url).toContain('adId=5')
      expect(calls[0].url).toContain('status=uj')
    })
  })

  // ─── haszno_shop_job_applicant_update ─────────────────────────────────────

  describe('haszno_shop_job_applicant_update', () => {
    it('calls PATCH /api/v1/shop/my/job-applications/{id}', async () => {
      const { fn, calls } = makeFetch(200, { application: { id: 3, status: 'behivva' } })
      registerJobTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_job_applicant_update')({ id: 3, status: 'behivva' })
      expect(calls[0].url).toContain('/api/v1/shop/my/job-applications/3')
      expect(calls[0].method).toBe('PATCH')
      const body = calls[0].body as Record<string, unknown>
      expect(body['status']).toBe('behivva')
    })

    it('includes employerNote when provided', async () => {
      const { fn, calls } = makeFetch(200, { application: {} })
      registerJobTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_job_applicant_update')({ id: 3, employerNote: 'Ígéretes jelölt.' })
      const body = calls[0].body as Record<string, unknown>
      expect(body['employerNote']).toBe('Ígéretes jelölt.')
    })

    it('returns error when no fields provided', async () => {
      const { fn } = makeFetch(200, {})
      registerJobTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_job_applicant_update')({ id: 3 })
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('status')
    })
  })

  // ─── haszno_shop_job_applicant_cv_download (local mode) ───────────────────

  describe('haszno_shop_job_applicant_cv_download (local mode)', () => {
    it('calls GET /api/v1/shop/my/job-applications/{id}/cv and saves file', async () => {
      const pdfBytes = Buffer.from('%PDF-downloaded')
      const { fn, calls } = makeFetch(200, pdfBytes, true)
      registerJobTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_job_applicant_cv_download')({
        id: 11,
        savePath: '/tmp/cv-11.pdf',
      })
      expect(isError(result)).toBe(false)
      expect(calls[0].url).toContain('/api/v1/shop/my/job-applications/11/cv')
      expect(calls[0].method).toBe('GET')
      const data = parseResult(result) as { savedPath: string; sizeBytes: number }
      expect(data.savedPath).toBe('/tmp/cv-11.pdf')
    })

    it('returns error when file write fails', async () => {
      const pdfBytes = Buffer.from('%PDF-downloaded')
      const { fn } = makeFetch(200, pdfBytes, true)
      fsMock.writeFileSyncError = new Error('permission denied')
      registerJobTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_job_applicant_cv_download')({
        id: 11,
        savePath: '/protected/cv.pdf',
      })
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('menteni')
    })

    it('returns error on 404', async () => {
      const { fn } = makeFetch(404, { error: 'not found' })
      registerJobTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_job_applicant_cv_download')({ id: 999 })
      expect(isError(result)).toBe(true)
    })
  })

  // ─── haszno_shop_job_applicant_cv_download (remote mode) ──────────────────

  describe('haszno_shop_job_applicant_cv_download (remote mode)', () => {
    it('returns a notice instead of binary in remote mode', async () => {
      const { fn } = makeFetch(200, {})
      registerJobTools(stub.server, makeOpts(fn), { remote: true })
      const result = await stub.getToolCb('haszno_shop_job_applicant_cv_download')({ id: 5 })
      expect(isError(result)).toBe(false)
      const data = parseResult(result) as { notice: string }
      expect(typeof data.notice).toBe('string')
      expect(data.notice).toContain('haszno.com')
    })
  })
})
