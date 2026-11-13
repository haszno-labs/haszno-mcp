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
      return Buffer.from('fake-image-bytes')
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
    it('calls GET /api/v1/shop/categories', async () => {
      const { fn, calls } = makeFetch(200, [{ id: 1, name: 'Elektronika' }])
      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_list_categories')({})
      expect(isError(result)).toBe(false)
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toContain('/api/v1/shop/categories')
      expect(calls[0].method).toBe('GET')
      const data = parseResult(result) as unknown[]
      expect(Array.isArray(data)).toBe(true)
    })

    it('returns error result on API failure', async () => {
      const { fn } = makeFetch(500, { error: 'server error' })
      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_list_categories')({})
      expect(isError(result)).toBe(true)
    })
  })

  describe('haszno_shop_search_ads', () => {
    it('calls GET /api/v1/shop/ads with query params', async () => {
      const { fn, calls } = makeFetch(200, { items: [], total: 0 })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_search_ads')({ q: 'laptop', categoryId: 3, minPrice: 10000, page: 2 })
      expect(calls[0].url).toContain('/api/v1/shop/ads')
      expect(calls[0].url).toContain('q=laptop')
      expect(calls[0].url).toContain('categoryId=3')
      expect(calls[0].url).toContain('minPrice=10000')
      expect(calls[0].url).toContain('page=2')
      expect(calls[0].method).toBe('GET')
    })

    it('calls GET /api/v1/shop/ads with no params when all omitted', async () => {
      const { fn, calls } = makeFetch(200, { items: [] })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_search_ads')({})
      expect(calls[0].url).not.toContain('?')
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
    it('calls GET /api/v1/shop/ads/price-hint with params', async () => {
      const { fn, calls } = makeFetch(200, { hint: 25000 })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_price_hint')({ categoryId: 1, q: 'iphone' })
      expect(calls[0].url).toContain('/api/v1/shop/ads/price-hint')
      expect(calls[0].url).toContain('categoryId=1')
      expect(calls[0].url).toContain('q=iphone')
      expect(calls[0].method).toBe('GET')
    })
  })

  describe('haszno_shop_list_my_ads', () => {
    it('calls GET /api/v1/shop/my/ads with status filter', async () => {
      const { fn, calls } = makeFetch(200, { items: [] })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_list_my_ads')({ status: 'aktiv' })
      expect(calls[0].url).toContain('/api/v1/shop/my/ads')
      expect(calls[0].url).toContain('status=aktiv')
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
  })

  describe('haszno_shop_list_favorites', () => {
    it('calls GET /api/v1/shop/my/favorites', async () => {
      const { fn, calls } = makeFetch(200, { items: [] })
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
    it('uploads via FormData when filePath is given', async () => {
      const { fn, calls } = makeFetch(200, { url: 'https://cdn.haszno.com/img/abc.jpg' })
      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_upload_image')({
        filePath: '/tmp/test-photo.jpg',
      })
      expect(isError(result)).toBe(false)
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toContain('/api/v1/shop/my/images')
      expect(calls[0].method).toBe('POST')
      expect(calls[0].body).toBe('__FormData__')
      const data = parseResult(result) as { url: string }
      expect(data.url).toContain('cdn.haszno.com')
    })

    it('uploads via FormData when base64 + mimeType is given', async () => {
      const { fn, calls } = makeFetch(200, { url: 'https://cdn.haszno.com/img/xyz.png' })
      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_upload_image')({
        base64: Buffer.from('fake-png-data').toString('base64'),
        mimeType: 'image/png',
      })
      expect(isError(result)).toBe(false)
      expect(calls[0].body).toBe('__FormData__')
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
    it('calls POST /api/v1/shop/my/ads/suggest with imageUrls', async () => {
      const { fn, calls } = makeFetch(200, { title: 'iPhone 13', priceGross: 150000 })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_suggest_from_photos')({
        imageUrls: ['https://cdn.haszno.com/img/a.jpg'],
      })
      expect(calls[0].url).toContain('/api/v1/shop/my/ads/suggest')
      expect(calls[0].method).toBe('POST')
      expect((calls[0].body as { imageUrls: string[] }).imageUrls).toHaveLength(1)
    })
  })

  // ─── create_ad with category attribute validation ───────────────────────────

  describe('haszno_shop_create_ad', () => {
    it('calls GET categories then POST /api/v1/shop/my/ads on success', async () => {
      const categories = [
        { id: 5, name: 'Telefonok', attributes: [{ name: 'condition', required: true }] },
      ]
      const adResponse = { ad: { id: 100, title: 'iPhone' } }
      let callCount = 0
      const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        callCount++
        const u = String(url)
        if (u.includes('/categories')) {
          return new Response(JSON.stringify(categories), { status: 200 })
        }
        return new Response(JSON.stringify(adResponse), { status: 201 })
      }) as unknown as typeof fetch

      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_create_ad')({
        title: 'iPhone 13 Pro',
        priceGross: 180000,
        categoryId: 5,
        attributes: { condition: 'hasznalt' },
        confirm: true,
      })
      expect(isError(result)).toBe(false)
      expect(callCount).toBe(2) // categories + create
    })

    it('returns error when required category attribute is missing', async () => {
      const categories = [
        {
          id: 5,
          name: 'Telefonok',
          attributes: [
            { name: 'condition', required: true },
            { name: 'storage', required: true },
          ],
        },
      ]
      const fn = vi.fn(async () =>
        new Response(JSON.stringify(categories), { status: 200 }),
      ) as unknown as typeof fetch

      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_create_ad')({
        title: 'Phone',
        priceGross: 50000,
        categoryId: 5,
        attributes: { condition: 'uj' },
        // 'storage' is missing
        confirm: true,
      })
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('storage')
      expect(getText(result)).toContain('kötelező')
    })

    it('proceeds without validation when category fetch fails', async () => {
      let first = true
      const fn = vi.fn(async () => {
        if (first) {
          first = false
          return new Response(JSON.stringify({ error: 'server error' }), { status: 500 })
        }
        return new Response(JSON.stringify({ ad: { id: 1 } }), { status: 201 })
      }) as unknown as typeof fetch

      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_create_ad')({
        title: 'Item',
        priceGross: 1000,
        categoryId: 99,
        confirm: true,
      })
      // Should not be an error — skipped validation, ad was created
      expect(isError(result)).toBe(false)
    })

    it('maps 409 conflict error', async () => {
      // Categories call succeeds (empty → no validation), create returns 409
      let first = true
      const fn = vi.fn(async () => {
        if (first) {
          first = false
          return new Response(JSON.stringify([]), { status: 200 })
        }
        return new Response(JSON.stringify({ error: 'Ütközés' }), { status: 409 })
      }) as unknown as typeof fetch

      registerShopTools(stub.server, makeOpts(fn))
      const result = await stub.getToolCb('haszno_shop_create_ad')({
        title: 'Item',
        priceGross: 1000,
        categoryId: 1,
        confirm: true,
      })
      expect(isError(result)).toBe(true)
      expect(getText(result)).toContain('409')
    })
  })

  // ─── update_ad ──────────────────────────────────────────────────────────────

  describe('haszno_shop_update_ad', () => {
    it('calls PATCH /api/v1/shop/my/ads/:id', async () => {
      const { fn, calls } = makeFetch(200, { ad: { id: 10, title: 'Updated' } })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_update_ad')({ id: 10, title: 'Updated', priceGross: 5000 })
      expect(calls[0].url).toContain('/api/v1/shop/my/ads/10')
      expect(calls[0].method).toBe('PATCH')
      const body = calls[0].body as Record<string, unknown>
      expect(body['title']).toBe('Updated')
      expect(body['priceGross']).toBe(5000)
    })
  })

  // ─── set_ad_status ──────────────────────────────────────────────────────────

  describe('haszno_shop_set_ad_status', () => {
    it('calls POST /api/v1/shop/my/ads/:id/status with status body', async () => {
      const { fn, calls } = makeFetch(200, { ad: { id: 5, status: 'fuggeszetett' } })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_set_ad_status')({ id: 5, status: 'fuggeszetett' })
      expect(calls[0].url).toContain('/api/v1/shop/my/ads/5/status')
      expect(calls[0].method).toBe('POST')
      expect((calls[0].body as { status: string })['status']).toBe('fuggeszetett')
    })
  })

  // ─── mark_sold ──────────────────────────────────────────────────────────────

  describe('haszno_shop_mark_sold', () => {
    it('calls POST /api/v1/shop/my/ads/:id/sold with optional soldPriceGross', async () => {
      const { fn, calls } = makeFetch(200, { ad: { id: 7, status: 'eladva' } })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_mark_sold')({ id: 7, soldPriceGross: 15000, confirm: true })
      expect(calls[0].url).toContain('/api/v1/shop/my/ads/7/sold')
      expect(calls[0].method).toBe('POST')
      expect((calls[0].body as { soldPriceGross: number })['soldPriceGross']).toBe(15000)
    })

    it('calls POST /api/v1/shop/my/ads/:id/sold without soldPriceGross', async () => {
      const { fn, calls } = makeFetch(200, { ad: { id: 8 } })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_mark_sold')({ id: 8, confirm: true })
      expect((calls[0].body as Record<string, unknown>)['soldPriceGross']).toBeUndefined()
    })
  })

  // ─── renew_ad ───────────────────────────────────────────────────────────────

  describe('haszno_shop_renew_ad', () => {
    it('calls POST /api/v1/shop/my/ads/:id/renew', async () => {
      const { fn, calls } = makeFetch(200, { ad: { id: 3 } })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_renew_ad')({ id: 3 })
      expect(calls[0].url).toContain('/api/v1/shop/my/ads/3/renew')
      expect(calls[0].method).toBe('POST')
    })
  })

  // ─── send_inquiry ────────────────────────────────────────────────────────────

  describe('haszno_shop_send_inquiry', () => {
    it('calls POST /api/v1/shop/ads/:id/inquiries with message', async () => {
      const { fn, calls } = makeFetch(201, { inquiry: { id: 1 } })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_send_inquiry')({ adId: 42, message: 'Is this still available?' })
      expect(calls[0].url).toContain('/api/v1/shop/ads/42/inquiries')
      expect(calls[0].method).toBe('POST')
      expect((calls[0].body as { message: string })['message']).toBe('Is this still available?')
    })
  })

  // ─── set_favorite ────────────────────────────────────────────────────────────

  describe('haszno_shop_set_favorite', () => {
    it('calls POST /api/v1/shop/ads/:id/favorites when save=true', async () => {
      const { fn, calls } = makeFetch(200, { saved: true })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_set_favorite')({ adId: 20, save: true })
      expect(calls[0].url).toContain('/api/v1/shop/ads/20/favorites')
      expect(calls[0].method).toBe('POST')
    })

    it('calls DELETE /api/v1/shop/ads/:id/favorites when save=false', async () => {
      const { fn, calls } = makeFetch(200, { saved: false })
      registerShopTools(stub.server, makeOpts(fn))
      await stub.getToolCb('haszno_shop_set_favorite')({ adId: 20, save: false })
      expect(calls[0].url).toContain('/api/v1/shop/ads/20/favorites')
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
      await stub.getToolCb('haszno_shop_respond_reservation')({
        id: 3,
        action: 'accept',
        heldUntil: '2026-12-01T12:00:00Z',
      })
      expect(calls[0].url).toContain('/api/v1/shop/my/reservations/3/accept')
      expect(calls[0].method).toBe('POST')
      expect((calls[0].body as { heldUntil: string })['heldUntil']).toBe('2026-12-01T12:00:00Z')
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
      const { fn, calls } = makeFetch(200, { reservation: { id: 5, status: 'lemondva' } })
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
