/**
 * Unit tests for the products domain MCP tools.
 *
 * Tests verify:
 *  1. haszno_products_list – returns products + count in both credential modes
 *  2. haszno_products_update – surfaces ShopTokenNotSupportedError clearly
 *  3. haszno_products_set_listing – surfaces ShopTokenNotSupportedError clearly
 *  4. haszno_products_apply_prices – surfaces ShopTokenNotSupportedError clearly
 *  5. haszno_products_ai_description – legacy-only, error surfacing
 *
 * No live network calls are made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { HasznoClient, Product } from '../client/index.js'
import { HasznoApiError, ShopTokenNotSupportedError } from '../client/index.js'
import { registerProductsTools } from '../tools/products.js'

// ── Stub server ───────────────────────────────────────────────────────────────

type ToolCallback = (args: Record<string, unknown>) => Promise<unknown>
type ToolConfig = { title?: string; description?: string; annotations?: Record<string, unknown>; inputSchema?: unknown }

function makeStubServer(): { server: McpServer; getToolCb: (name: string) => ToolCallback } {
  const tools = new Map<string, ToolCallback>()
  const server = {
    registerTool: (_name: string, _config: ToolConfig, cb: ToolCallback) => {
      tools.set(_name, cb)
      return {}
    },
  } as unknown as McpServer
  return {
    server,
    getToolCb: (name: string) => {
      const cb = tools.get(name)
      if (!cb) throw new Error(`Tool "${name}" was not registered`)
      return cb
    },
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseResult(result: unknown): unknown {
  const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean }
  expect(r.content[0].type).toBe('text')
  return JSON.parse(r.content[0].text)
}

function isError(result: unknown): boolean {
  return !!(result as { isError?: boolean }).isError
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockProduct: Product = {
  id: 1,
  sku: 'PROD-001',
  name: 'Teszt termék',
  listed: true,
  priceGross: 9990,
  costNet: 5000,
  stock: 10,
  supplierName: 'Teszt Nagyker',
  current: { marginNet: 1872, marginPct: 21.4 },
  recommended: { priceGross: 9500, marginNet: 1600, marginPct: 18.3, floorGross: 7000 },
  marketMinGross: 9000,
  marketShop: 'riválisshop.hu',
  trendKeyword: null,
  rrpGross: 12000,
  decidedAt: null,
  createdAt: '2024-01-01T00:00:00.000Z',
} as unknown as Product

function makeClient(overrides: Partial<HasznoClient['products']> = {}): HasznoClient {
  return {
    products: {
      list: vi.fn().mockResolvedValue([mockProduct]),
      update: vi.fn().mockResolvedValue(mockProduct),
      setListing: vi.fn().mockResolvedValue({ ...mockProduct, listed: false }),
      applyPrices: vi.fn().mockResolvedValue({ changed: 1, total: 1 }),
      generateAiDescription: vi.fn().mockResolvedValue({ text: 'Ez egy AI leírás.' }),
      ...overrides,
    },
    health: {} as never,
    auth: {} as never,
    settings: {} as never,
    stats: {} as never,
    suppliers: {} as never,
    feeds: {} as never,
    orders: {} as never,
    recommendations: {} as never,
    rules: {} as never,
    proposals: {} as never,
    automation: {} as never,
    network: {} as never,
  } as unknown as HasznoClient
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('registerProductsTools', () => {
  let stub: ReturnType<typeof makeStubServer>
  let client: HasznoClient

  beforeEach(() => {
    stub = makeStubServer()
    client = makeClient()
    registerProductsTools(stub.server, client)
  })

  // ── haszno_products_list ──────────────────────────────────────────────────

  describe('haszno_products_list', () => {
    it('calls client.products.list and returns products + count', async () => {
      const result = await stub.getToolCb('haszno_products_list')({})
      expect(isError(result)).toBe(false)
      const data = parseResult(result) as { products: Product[]; count: number }
      expect(data.count).toBe(1)
      expect(data.products[0].sku).toBe('PROD-001')
      expect(client.products.list).toHaveBeenCalledTimes(1)
    })

    it('passes all=true to list when provided', async () => {
      await stub.getToolCb('haszno_products_list')({ all: true })
      expect(client.products.list).toHaveBeenCalledWith({ all: true })
    })

    it('passes no params when all is omitted', async () => {
      await stub.getToolCb('haszno_products_list')({})
      expect(client.products.list).toHaveBeenCalledWith(undefined)
    })

    it('returns an error result when list rejects with HasznoApiError', async () => {
      vi.mocked(client.products.list).mockRejectedValueOnce(
        new HasznoApiError(401, 'Érvényes Bearer token szükséges', 'unauthenticated', 'req-abc'),
      )
      const result = await stub.getToolCb('haszno_products_list')({})
      expect(isError(result)).toBe(true)
      const { content } = result as { content: Array<{ text: string }> }
      expect(content[0].text).toContain('HTTP 401')
      expect(content[0].text).toContain('unauthenticated')
      expect(content[0].text).toContain('req-abc')
    })
  })

  // ── haszno_products_update ────────────────────────────────────────────────

  describe('haszno_products_update', () => {
    it('calls client.products.update with the given fields', async () => {
      const result = await stub.getToolCb('haszno_products_update')({
        id: 1,
        priceGross: 10990,
        confirm: true,
      })
      expect(isError(result)).toBe(false)
      expect(client.products.update).toHaveBeenCalledWith(1, { priceGross: 10990 })
    })

    it('surfaces ShopTokenNotSupportedError with isError: true and the operation name', async () => {
      vi.mocked(client.products.update).mockRejectedValueOnce(
        new ShopTokenNotSupportedError('products.update'),
      )
      const result = await stub.getToolCb('haszno_products_update')({
        id: 1,
        priceGross: 10990,
        confirm: true,
      })
      expect(isError(result)).toBe(true)
      const { content } = result as { content: Array<{ text: string }> }
      // ShopTokenNotSupportedError message mentions the operation and haszno.com
      expect(content[0].text).toContain('products.update')
      expect(content[0].text).toContain('haszno.com')
    })

    it('surfaces HasznoApiError with code and requestId', async () => {
      vi.mocked(client.products.update).mockRejectedValueOnce(
        new HasznoApiError(422, 'Érvénytelen adat', 'invalid_request', 'req-xyz'),
      )
      const result = await stub.getToolCb('haszno_products_update')({
        id: 1,
        priceGross: 10990,
        confirm: true,
      })
      expect(isError(result)).toBe(true)
      const { content } = result as { content: Array<{ text: string }> }
      expect(content[0].text).toContain('422')
      expect(content[0].text).toContain('invalid_request')
      expect(content[0].text).toContain('req-xyz')
    })
  })

  // ── haszno_products_set_listing ────────────────────────────────────────────

  describe('haszno_products_set_listing', () => {
    it('calls setListing with the given id and listed value', async () => {
      const result = await stub.getToolCb('haszno_products_set_listing')({
        id: 1,
        listed: false,
        confirm: true,
      })
      expect(isError(result)).toBe(false)
      expect(client.products.setListing).toHaveBeenCalledWith(1, { listed: false })
    })

    it('surfaces ShopTokenNotSupportedError with isError: true', async () => {
      vi.mocked(client.products.setListing).mockRejectedValueOnce(
        new ShopTokenNotSupportedError('products.setListing'),
      )
      const result = await stub.getToolCb('haszno_products_set_listing')({
        id: 1,
        listed: false,
        confirm: true,
      })
      expect(isError(result)).toBe(true)
    })
  })

  // ── haszno_products_apply_prices ──────────────────────────────────────────

  describe('haszno_products_apply_prices', () => {
    it('calls applyPrices with ids when provided', async () => {
      const result = await stub.getToolCb('haszno_products_apply_prices')({
        ids: [1, 2],
        confirm: true,
      })
      expect(isError(result)).toBe(false)
      expect(client.products.applyPrices).toHaveBeenCalledWith({ ids: [1, 2] })
      const data = parseResult(result) as { changed: number; total: number }
      expect(data.changed).toBe(1)
    })

    it('calls applyPrices with no args when ids omitted', async () => {
      await stub.getToolCb('haszno_products_apply_prices')({ confirm: true })
      expect(client.products.applyPrices).toHaveBeenCalledWith(undefined)
    })

    it('surfaces ShopTokenNotSupportedError with isError: true', async () => {
      vi.mocked(client.products.applyPrices).mockRejectedValueOnce(
        new ShopTokenNotSupportedError('products.applyPrices'),
      )
      const result = await stub.getToolCb('haszno_products_apply_prices')({
        confirm: true,
      })
      expect(isError(result)).toBe(true)
    })
  })

  // ── haszno_products_ai_description ────────────────────────────────────────

  describe('haszno_products_ai_description', () => {
    it('returns the generated text', async () => {
      const result = await stub.getToolCb('haszno_products_ai_description')({ id: 1 })
      expect(isError(result)).toBe(false)
      const data = parseResult(result) as { text: string }
      expect(data.text).toBe('Ez egy AI leírás.')
      expect(client.products.generateAiDescription).toHaveBeenCalledWith(1)
    })

    it('returns an error result when generateAiDescription rejects', async () => {
      vi.mocked(client.products.generateAiDescription).mockRejectedValueOnce(
        new HasznoApiError(404, 'Termék nem található'),
      )
      const result = await stub.getToolCb('haszno_products_ai_description')({ id: 999 })
      expect(isError(result)).toBe(true)
      const { content } = result as { content: Array<{ text: string }> }
      expect(content[0].text).toContain('404')
    })
  })
})
