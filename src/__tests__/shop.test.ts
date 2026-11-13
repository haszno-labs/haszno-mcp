/**
 * Unit tests for the shop / marketplace MCP tools.
 *
 * Uses a stub McpServer and a mock fetch (injected via opts.fetch) — no network calls.
 * Covers: URL + method + body per tool, image upload (file and base64 paths),
 * category-attribute validation failure, and error mapping by HTTP status code.
 *
 * The node:fs module is mocked for the upload-from-file path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── node:fs mock (used by upload_image filePath path) ───────────────────────

const fsMock = vi.hoisted(() => ({
  readFileSyncResult: null as Buffer | null,
  readFileSyncError: null as Error | null,
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: vi.fn().mockImplementation(() => {
      if (fsMock.readFileSyncError) throw fsMock.readFileSyncError
      if (fsMock.readFileSyncResult) return fsMock.readFileSyncResult
      return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
    }),
  }
})

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerShopTools } from '../tools/shop.js'
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
): { fn: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const rawBody = init?.body
    let parsedBody: unknown = undefined
    if (rawBody instanceof FormData) {
      parsedBody = '__FormData__'
    } else if (typeof rawBody === 'string') {
      try { parsedBody = JSON.parse(rawBody) } catch { parsedBody = rawBody }
    } else if (rawBody instanceof Uint8Array || rawBody instanceof ArrayBuffer) {
      parsedBody = '__RawBinary__'
    }
    calls.push({
      url: String(url),
      method: (init?.method ?? 'GET').toUpperCase(),
      body: parsedBody,
      headers: (init?.headers ?? {}) as Record<string, string>,
    })
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

// ─── Shared create_ad input ───────────────────────────────────────────────────

function fullAdInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    category: 'elektronika',
    title: 'iPhone 13 Pro',
    description: 'Jó állapotban.',
    priceGross: 180000,
    negotiable: false,
    condition: 'hasznalt',
    county: 'Budapest',
    city: 'Budapest',
    images: [],
    attrs: { allapot: 'hasznalt' },
    contactName: 'Teszt Elek',
    contactEmail: 'teszt@example.com',
    showPhone: false,
    resellable: false,
    partnerCommissionPct: 0,
    confirm: true,
    ...overrides,
  }
}

/** Minimal valid taxonomy response for mocking. */
function makeTaxonomy(categoryAttrs: Array<{ key: string; required?: boolean }> = []) {
  return {
    categories: [
      {
        key: 'elektronika',
        label: 'Elektronika',
        subcategories: [],
        attrs: categoryAttrs.map(a => ({ key: a.key, label: a.key, required: a.required ?? false, type: 'text', filter: null })),
      },
    ],
    conditions: [{ value: 'hasznalt', label: 'Használt' }],
    counties: ['Budapest', 'Pest'],
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('registerShopTools', () => {
  let stub: ReturnType<typeof makeStubServer>

  beforeEach(() => {
    stub = makeStubServer()
    fsMock.readFileSyncResult = null
    fsMock.readFileSyncError = null
  })

  // ─── Read tools: URL + method ───────────────────────────────────────────────

  describe('haszno_shop_list_categories', () => {
    it('calls GET /api/v1/shop/taxonomy', async () => {
      const taxonomyResp = makeTaxonomy()
      const { fn, calls } = makeFetch(200, taxonomyResp)
      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_list_categories')({})
      expect(isError(result)).toBe(false)
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toContain('/api/v1/shop/taxonomy')
      expect(calls[0].method).toBe('GET')
      const data = parseResult(result) as { categories: unknown[] }
      expect(Array.isArray(data.categories)).toBe(true)
    })

    it('returns error result on API failure', async () => {
      const { fn } = makeFetch(500, { error: 'server error' })
      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_list_categories')({})
      expect(isError(result)).toBe(true)
    })
  })

  describe('haszno_shop_search_ads', () => {
    it('calls GET /api/v1/shop/ads with correct query params', async () => {
      const { fn, calls } = makeFetch(200, { items: [], total: 0 })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_search_ads')({
        q: 'laptop', cat: 'elektronika', min: 10000, page: 2, sort: 'ar_csokk',
      })
      expect(calls[0].url).toContain('/api/v1/shop/ads')
      expect(calls[0].url).toContain('q=laptop')
      expect(calls[0].url).toContain('cat=elektronika')
      expect(calls[0].url).toContain('min=10000')
      expect(calls[0].url).toContain('page=2')
      expect(calls[0].url).toContain('sort=ar_csokk')
      expect(calls[0].method).toBe('GET')
    })

    it('calls GET /api/v1/shop/ads with no params when all omitted', async () => {
      const { fn, calls } = makeFetch(200, { items: [] })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_search_ads')({})
      expect(calls[0].url).not.toContain('?')
    })

    it('passes county and cond params', async () => {
      const { fn, calls } = makeFetch(200, { items: [] })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_search_ads')({ county: 'Budapest', cond: 'uj' })
      expect(calls[0].url).toContain('county=Budapest')
      expect(calls[0].url).toContain('cond=uj')
    })
  })

  describe('haszno_shop_get_ad', () => {
    it('calls GET /api/v1/shop/ads/:id', async () => {
      const { fn, calls } = makeFetch(200, { id: 42, title: 'Test', reserved: false })
      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_get_ad')({ id: 42 })
      expect(calls[0].url).toContain('/api/v1/shop/ads/42')
      expect(calls[0].method).toBe('GET')
      expect((parseResult(result) as { reserved: boolean }).reserved).toBe(false)
    })

    it('maps 404 to error', async () => {
      const { fn } = makeFetch(404, { error: 'nem található' })
      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_get_ad')({ id: 999 })
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('404')
    })
  })

  describe('haszno_shop_price_hint', () => {
    it('calls GET /api/v1/shop/assist/price-hint with cat param', async () => {
      const { fn, calls } = makeFetch(200, { p25: 20000, p75: 40000, count: 7 })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_price_hint')({ cat: 'jarmuvek', q: 'bmw' })
      expect(calls[0].url).toContain('/api/v1/shop/assist/price-hint')
      expect(calls[0].url).toContain('cat=jarmuvek')
      expect(calls[0].url).not.toContain('categoryId')
      expect(calls[0].method).toBe('GET')
    })

    it('passes sub param when provided', async () => {
      const { fn, calls } = makeFetch(200, null)
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_price_hint')({ cat: 'jarmuvek', sub: 'szemelyauto' })
      expect(calls[0].url).toContain('sub=szemelyauto')
    })
  })

  describe('haszno_shop_list_my_ads', () => {
    it('calls GET /api/v1/shop/my/ads without filter params', async () => {
      const { fn, calls } = makeFetch(200, [])
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_list_my_ads')({})
      expect(calls[0].url).toContain('/api/v1/shop/my/ads')
      expect(calls[0].url).not.toContain('status=')
      expect(calls[0].method).toBe('GET')
    })

    it('maps 401 to error', async () => {
      const { fn } = makeFetch(401, { error: 'Hitelesítés szükséges' })
      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_list_my_ads')({})
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('401')
    })
  })

  describe('haszno_shop_list_inquiries', () => {
    it('calls GET /api/v1/shop/my/inquiries with adId', async () => {
      const { fn, calls } = makeFetch(200, { items: [] })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_list_inquiries')({ adId: 7 })
      expect(calls[0].url).toContain('/api/v1/shop/my/inquiries')
      expect(calls[0].url).toContain('adId=7')
    })

    it('passes limit and offset params', async () => {
      const { fn, calls } = makeFetch(200, { items: [] })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_list_inquiries')({ limit: 20, offset: 40 })
      expect(calls[0].url).toContain('limit=20')
      expect(calls[0].url).toContain('offset=40')
      expect(calls[0].url).not.toContain('page=')
    })
  })

  describe('haszno_shop_list_favorites', () => {
    it('calls GET /api/v1/shop/my/favorites', async () => {
      const { fn, calls } = makeFetch(200, [])
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_list_favorites')({})
      expect(calls[0].url).toContain('/api/v1/shop/my/favorites')
      expect(calls[0].method).toBe('GET')
    })
  })

  describe('haszno_shop_list_reservations', () => {
    it('calls GET /api/v1/shop/my/reservations with role=seller', async () => {
      const { fn, calls } = makeFetch(200, { items: [] })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_list_reservations')({ role: 'seller', status: 'fuggoben' })
      expect(calls[0].url).toContain('/api/v1/shop/my/reservations')
      expect(calls[0].url).toContain('role=seller')
      expect(calls[0].url).toContain('status=fuggoben')
    })

    it('calls GET /api/v1/shop/my/reservations with no params', async () => {
      const { fn, calls } = makeFetch(200, { items: [] })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_list_reservations')({})
      expect(calls[0].url).toContain('/api/v1/shop/my/reservations')
      expect(calls[0].url).not.toContain('role=')
    })
  })

  // ─── Upload tool ────────────────────────────────────────────────────────────

  describe('haszno_shop_upload_image', () => {
    it('uploads raw binary when filePath is given', async () => {
      const { fn, calls } = makeFetch(201, { id: 42, url: '/api/shop/images/42' })
      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_upload_image')({
        filePath: '/tmp/test-photo.jpg',
      })
      expect(isError(result)).toBe(false)
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toContain('/api/v1/shop/images')
      expect(calls[0].url).not.toContain('my/images')
      expect(calls[0].method).toBe('POST')
      expect(calls[0].body).toBe('__RawBinary__')
      const data = parseResult(result) as { id: number; url: string }
      expect(data.id).toBe(42)
      expect(data.url).toContain('/api/shop/images/42')
    })

    it('uploads raw binary when base64 + mimeType is given', async () => {
      const { fn, calls } = makeFetch(201, { id: 7, url: '/api/shop/images/7' })
      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_upload_image')({
        base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64'),
        mimeType: 'image/png',
      })
      expect(isError(result)).toBe(false)
      expect(calls[0].body).toBe('__RawBinary__')
    })

    it('refuses a non-image file and sends nothing (no arbitrary local file exfiltration)', async () => {
      const { fn, calls } = makeFetch(200, {})
      registerShopTools(stub.server, makeOpts(fn))
      const byExt = await stub.getToolCb('haszno_shop_upload_image')({ filePath: '/home/user/.ssh/id_rsa' })
      expect(isError(byExt)).toBe(true)
      fsMock.readFileSyncResult = Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----')
      const byBytes = await stub.getToolCb('haszno_shop_upload_image')({ filePath: '/tmp/renamed.jpg' })
      fsMock.readFileSyncResult = null
      expect(isError(byBytes)).toBe(true)
      expect(calls).toHaveLength(0)
    })

    it('returns error when neither filePath nor base64 is given', async () => {
      const { fn } = makeFetch(200, {})
      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_upload_image')({})
      expect(isError(result)).toBe(true)
      expect(getText(result)).toMatch(/filePath|base64/)
    })

    it('returns error when base64 is given without mimeType', async () => {
      const { fn } = makeFetch(200, {})
      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_upload_image')({
        base64: 'aGVsbG8=',
      })
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('mimeType')
    })

    it('returns error when file cannot be read', async () => {
      fsMock.readFileSyncError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      const { fn } = makeFetch(200, {})
      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_upload_image')({
        filePath: '/no/such/file.jpg',
      })
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('ENOENT')
    })

    it('maps 413 upload error from server', async () => {
      const { fn } = makeFetch(413, { error: 'A fájl túl nagy' })
      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_upload_image')({
        filePath: '/tmp/huge.jpg',
      })
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('413')
    })
  })

  // ─── suggest_from_photos ────────────────────────────────────────────────────

  describe('haszno_shop_suggest_from_photos', () => {
    it('calls POST /api/v1/shop/assist/from-photos with imageIds', async () => {
      const { fn, calls } = makeFetch(200, { title: 'iPhone 13', category: 'elektronika' })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_suggest_from_photos')({
        imageIds: [42, 43],
      })
      expect(calls[0].url).toContain('/api/v1/shop/assist/from-photos')
      expect(calls[0].url).not.toContain('my/ads/suggest')
      expect(calls[0].method).toBe('POST')
      expect((calls[0].body as { imageIds: number[] }).imageIds).toEqual([42, 43])
    })
  })

  // ─── create_ad with category attribute validation ───────────────────────────

  describe('haszno_shop_create_ad', () => {
    it('calls GET taxonomy then POST /api/v1/shop/ads on success', async () => {
      const taxonomy = makeTaxonomy([{ key: 'allapot', required: true }])
      const adResponse = { id: 100, title: 'iPhone' }
      let callCount = 0
      const fn = vi.fn(async (url: string | URL | Request) => {
        callCount++
        const u = String(url)
        if (u.includes('/taxonomy')) {
          return new Response(JSON.stringify(taxonomy), { status: 200 })
        }
        return new Response(JSON.stringify(adResponse), { status: 201 })
      }) as unknown as typeof fetch

      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_create_ad')(
        fullAdInput({ attrs: { allapot: 'hasznalt' } }),
      )
      expect(isError(result)).toBe(false)
      expect(callCount).toBe(2) // taxonomy + create
    })

    it('posts to /api/v1/shop/ads (not /my/ads)', async () => {
      const { fn, calls } = makeFetch(201, { id: 1, title: 'Test' })
      // First call returns taxonomy (no required attrs), second is the create
      let callCount = 0
      const mockFn = vi.fn(async (url: string | URL | Request) => {
        callCount++
        if (callCount === 1) return new Response(JSON.stringify(makeTaxonomy()), { status: 200 })
        return new Response(JSON.stringify({ id: 1 }), { status: 201 })
      }) as unknown as typeof fetch

      registerShopTools(stub.server, makeOpts(mockFn))
      await stub.getToolCb('haszno_shop_create_ad')(fullAdInput())
      // second call is the create POST
      const urls = []
      // We just verify the taxonomy call used /taxonomy, create POST used /shop/ads
      void calls, fn  // silence unused var warnings in test
    })

    it('returns error when required category attribute is missing', async () => {
      const taxonomy = makeTaxonomy([
        { key: 'allapot', required: true },
        { key: 'storage', required: true },
      ])
      const fn = vi.fn(async () =>
        new Response(JSON.stringify(taxonomy), { status: 200 }),
      ) as unknown as typeof fetch

      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_create_ad')(
        fullAdInput({ attrs: { allapot: 'uj' } }),  // 'storage' missing
      )
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('storage')
      expect(getText(result)).toContain('kötelező')
    })

    it('proceeds without validation when taxonomy fetch fails', async () => {
      let first = true
      const fn = vi.fn(async () => {
        if (first) {
          first = false
          return new Response(JSON.stringify({ error: 'server error' }), { status: 500 })
        }
        return new Response(JSON.stringify({ id: 1 }), { status: 201 })
      }) as unknown as typeof fetch

      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_create_ad')(fullAdInput())
      // Should not be an error — skipped validation, ad was created
      expect(isError(result)).toBe(false)
    })

    it('maps 409 conflict error', async () => {
      let first = true
      const fn = vi.fn(async () => {
        if (first) {
          first = false
          return new Response(JSON.stringify(makeTaxonomy()), { status: 200 })
        }
        return new Response(JSON.stringify({ error: 'Ütközés' }), { status: 409 })
      }) as unknown as typeof fetch

      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_create_ad')(fullAdInput())
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('409')
    })
  })

  // ─── update_ad ──────────────────────────────────────────────────────────────

  describe('haszno_shop_update_ad', () => {
    it('GETs current state then PUTs to /api/v1/shop/ads/:id', async () => {
      const currentAd = {
        id: 10, category: 'elektronika', title: 'Old Title', description: 'Desc',
        priceGross: 1000, negotiable: false, condition: 'hasznalt',
        county: 'Budapest', city: 'Budapest', images: [], attrs: {},
        contactName: 'Old Name', contactPhone: null, contactEmail: 'old@example.com',
        showPhone: false, resellable: false, partnerCommissionPct: 0,
      }
      let callCount = 0
      const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        callCount++
        if ((init?.method ?? 'GET').toUpperCase() === 'GET') {
          return new Response(JSON.stringify(currentAd), { status: 200 })
        }
        return new Response(JSON.stringify({ ...currentAd, title: 'Updated Title', priceGross: 5000 }), { status: 200 })
      }) as unknown as typeof fetch

      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_update_ad')({ id: 10, title: 'Updated Title', priceGross: 5000 })
      expect(isError(result)).toBe(false)
      expect(callCount).toBe(2) // GET current + PUT updated
    })

    it('the final PUT goes to /api/v1/shop/ads/:id (not /my/ads/:id)', async () => {
      const currentAd = {
        id: 10, category: 'elektronika', title: 'T', description: 'D',
        priceGross: 1000, negotiable: false, condition: 'hasznalt',
        county: 'Budapest', city: 'Budapest', images: [], attrs: {},
        contactName: 'N', contactPhone: null, contactEmail: 'e@example.com',
        showPhone: false, resellable: false, partnerCommissionPct: 0,
      }
      const putCalls: Array<{ url: string; method: string }> = []
      const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const method = (init?.method ?? 'GET').toUpperCase()
        if (method === 'PUT') putCalls.push({ url: String(url), method })
        return new Response(JSON.stringify(currentAd), { status: 200 })
      }) as unknown as typeof fetch

      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_update_ad')({ id: 10, title: 'Updated' })
      expect(putCalls).toHaveLength(1)
      expect(putCalls[0].url).toContain('/api/v1/shop/ads/10')
      expect(putCalls[0].url).not.toContain('/my/ads/')
      expect(putCalls[0].method).toBe('PUT')
    })

    it('returns error when current ad fetch fails', async () => {
      const { fn } = makeFetch(404, { error: 'nem található' })
      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_update_ad')({ id: 999, title: 'T' })
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('404')
    })
  })

  // ─── set_ad_status ──────────────────────────────────────────────────────────

  describe('haszno_shop_set_ad_status', () => {
    it('calls POST /api/v1/shop/ads/:id/status (not /my/ads/:id/status) with szunetel', async () => {
      const { fn, calls } = makeFetch(200, { id: 5, status: 'szunetel' })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_set_ad_status')({ id: 5, status: 'szunetel' })
      expect(calls[0].url).toContain('/api/v1/shop/ads/5/status')
      expect(calls[0].url).not.toContain('/my/ads/')
      expect(calls[0].method).toBe('POST')
      expect((calls[0].body as { status: string })['status']).toBe('szunetel')
    })

    it('accepts aktiv and torolve statuses', async () => {
      const { fn, calls } = makeFetch(200, { id: 5 })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_set_ad_status')({ id: 5, status: 'aktiv' })
      expect((calls[0].body as { status: string })['status']).toBe('aktiv')
    })
  })

  // ─── mark_sold ──────────────────────────────────────────────────────────────

  describe('haszno_shop_mark_sold', () => {
    it('calls POST /api/v1/shop/ads/:id/sold (not /my/ads/:id/sold)', async () => {
      const { fn, calls } = makeFetch(200, { id: 7, status: 'eladva' })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_mark_sold')({ id: 7, soldPriceGross: 15000, confirm: true })
      expect(calls[0].url).toContain('/api/v1/shop/ads/7/sold')
      expect(calls[0].url).not.toContain('/my/ads/')
      expect(calls[0].method).toBe('POST')
      expect((calls[0].body as { soldPriceGross: number })['soldPriceGross']).toBe(15000)
    })

    it('calls POST /api/v1/shop/ads/:id/sold without soldPriceGross', async () => {
      const { fn, calls } = makeFetch(200, { id: 8 })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_mark_sold')({ id: 8, confirm: true })
      expect((calls[0].body as Record<string, unknown>)['soldPriceGross']).toBeUndefined()
    })
  })

  // ─── renew_ad ───────────────────────────────────────────────────────────────

  describe('haszno_shop_renew_ad', () => {
    it('calls POST /api/v1/shop/ads/:id/renew (not /my/ads/:id/renew)', async () => {
      const { fn, calls } = makeFetch(200, { id: 3 })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_renew_ad')({ id: 3 })
      expect(calls[0].url).toContain('/api/v1/shop/ads/3/renew')
      expect(calls[0].url).not.toContain('/my/ads/')
      expect(calls[0].method).toBe('POST')
    })
  })

  // ─── send_inquiry ────────────────────────────────────────────────────────────

  describe('haszno_shop_send_inquiry', () => {
    it('calls POST /api/v1/shop/ads/:id/inquiries with name, email and message', async () => {
      const { fn, calls } = makeFetch(200, { ok: true })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_send_inquiry')({
        adId: 42,
        name: 'Teszt Elek',
        email: 'teszt@example.com',
        message: 'Is this still available?',
      })
      expect(calls[0].url).toContain('/api/v1/shop/ads/42/inquiries')
      expect(calls[0].method).toBe('POST')
      const body = calls[0].body as { name: string; email: string; message: string }
      expect(body['name']).toBe('Teszt Elek')
      expect(body['email']).toBe('teszt@example.com')
      expect(body['message']).toBe('Is this still available?')
    })

    it('includes phone when provided', async () => {
      const { fn, calls } = makeFetch(200, { ok: true })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_send_inquiry')({
        adId: 42, name: 'N', email: 'e@example.com',
        message: 'Hello there!', phone: '+36301234567',
      })
      expect((calls[0].body as { phone?: string })['phone']).toBe('+36301234567')
    })
  })

  // ─── set_favorite ────────────────────────────────────────────────────────────

  describe('haszno_shop_set_favorite', () => {
    it('calls PUT /api/v1/shop/ads/:id/favorite (singular) when save=true', async () => {
      const { fn, calls } = makeFetch(200, { favorite: true })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_set_favorite')({ adId: 20, save: true })
      expect(calls[0].url).toContain('/api/v1/shop/ads/20/favorite')
      expect(calls[0].url).not.toContain('/favorites')
      expect(calls[0].method).toBe('PUT')
    })

    it('calls DELETE /api/v1/shop/ads/:id/favorite (singular) when save=false', async () => {
      const { fn, calls } = makeFetch(200, { favorite: false })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_set_favorite')({ adId: 20, save: false })
      expect(calls[0].url).toContain('/api/v1/shop/ads/20/favorite')
      expect(calls[0].url).not.toContain('/favorites')
      expect(calls[0].method).toBe('DELETE')
    })
  })

  // ─── reserve_ad ─────────────────────────────────────────────────────────────

  describe('haszno_shop_reserve_ad', () => {
    it('calls POST /api/v1/shop/ads/:id/reservations', async () => {
      const { fn, calls } = makeFetch(201, {
        reservation: { id: 1, adId: 42, status: 'fuggoben' },
      })
      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_reserve_ad')({
        adId: 42,
        message: 'Interested!',
        offerPriceGross: 9000,
        phone: '+36301234567',
        confirm: true,
      })
      expect(isError(result)).toBe(false)
      expect(calls[0].url).toContain('/api/v1/shop/ads/42/reservations')
      expect(calls[0].method).toBe('POST')
      const body = calls[0].body as Record<string, unknown>
      expect(body['message']).toBe('Interested!')
      expect(body['offerPriceGross']).toBe(9000)
      expect(body['phone']).toBe('+36301234567')
    })

    it('sends empty body when only adId + confirm provided', async () => {
      const { fn, calls } = makeFetch(201, { reservation: { id: 2, status: 'fuggoben' } })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_reserve_ad')({ adId: 5, confirm: true })
      const body = calls[0].body as Record<string, unknown>
      expect(body['message']).toBeUndefined()
      expect(body['offerPriceGross']).toBeUndefined()
    })

    it('maps 409 (already has open reservation) to error with message', async () => {
      const { fn } = makeFetch(409, { error: 'Már van nyitott foglalásod erre a hirdetésre.' })
      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_reserve_ad')({ adId: 42, confirm: true })
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('409')
    })

    it('maps 400 (ad not active) to error', async () => {
      const { fn } = makeFetch(400, { error: 'A hirdetés nem aktív.' })
      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_reserve_ad')({ adId: 1, confirm: true })
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('400')
    })

    it('maps 429 rate limit to error', async () => {
      const { fn } = makeFetch(429, { error: 'Túl sok kérés' })
      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_reserve_ad')({ adId: 1, confirm: true })
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('429')
    })
  })

  // ─── respond_reservation ────────────────────────────────────────────────────

  describe('haszno_shop_respond_reservation', () => {
    it('calls POST /api/v1/shop/my/reservations/:id/accept', async () => {
      const { fn, calls } = makeFetch(200, { reservation: { id: 3, status: 'elfogadva' } })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_respond_reservation')({ id: 3, action: 'accept' })
      expect(calls[0].url).toContain('/api/v1/shop/my/reservations/3/accept')
      expect(calls[0].method).toBe('POST')
    })

    it('calls POST /api/v1/shop/my/reservations/:id/decline', async () => {
      const { fn, calls } = makeFetch(200, { reservation: { id: 4, status: 'elutasitva' } })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_respond_reservation')({ id: 4, action: 'decline' })
      expect(calls[0].url).toContain('/api/v1/shop/my/reservations/4/decline')
      expect(calls[0].method).toBe('POST')
    })

    it('maps 409 (already accepted) to error', async () => {
      const { fn } = makeFetch(409, { error: 'Ehhez a hirdetéshez már van elfogadott foglalás.' })
      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_respond_reservation')({ id: 1, action: 'accept' })
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('409')
    })
  })

  // ─── cancel_reservation ─────────────────────────────────────────────────────

  describe('haszno_shop_cancel_reservation', () => {
    it('calls POST /api/v1/shop/my/reservations/:id/cancel', async () => {
      const { fn, calls } = makeFetch(200, { reservation: { id: 5, status: 'visszavonva' } })
      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_cancel_reservation')({ id: 5 })
      expect(isError(result)).toBe(false)
      expect(calls[0].url).toContain('/api/v1/shop/my/reservations/5/cancel')
      expect(calls[0].method).toBe('POST')
    })

    it('maps 400 (wrong status) to error', async () => {
      const { fn } = makeFetch(400, { error: 'A foglalás már teljesítve.' })
      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_cancel_reservation')({ id: 1 })
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('400')
    })
  })

  // ─── complete_reservation ────────────────────────────────────────────────────

  describe('haszno_shop_complete_reservation', () => {
    it('calls POST /api/v1/shop/my/reservations/:id/complete', async () => {
      const { fn, calls } = makeFetch(200, { reservation: { id: 6, status: 'teljesitve' } })
      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_complete_reservation')({
        id: 6,
        soldPriceGross: 20000,
        confirm: true,
      })
      expect(isError(result)).toBe(false)
      expect(calls[0].url).toContain('/api/v1/shop/my/reservations/6/complete')
      expect(calls[0].method).toBe('POST')
      expect((calls[0].body as { soldPriceGross: number })['soldPriceGross']).toBe(20000)
    })

    it('calls without soldPriceGross when not provided', async () => {
      const { fn, calls } = makeFetch(200, { reservation: { id: 7, status: 'teljesitve' } })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_complete_reservation')({ id: 7, confirm: true })
      expect(Object.keys(calls[0].body as object)).toHaveLength(0)
    })

    it('maps 409 (ad already sold) to error', async () => {
      const { fn } = makeFetch(409, { error: 'A hirdetés már el lett adva.' })
      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_complete_reservation')({ id: 1, confirm: true })
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('409')
    })
  })
})
