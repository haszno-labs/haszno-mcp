/**
 * Unit tests for packages/mcp/src/tools/catalog.ts
 * No network calls — all client methods are mocked.
 */
import { describe, it, expect, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { HasznoClient, NetworkSupplier, NetworkProduct, SupplierView } from '../client/index.js'
import { registerCatalogTools } from '../tools/catalog.js'

// ---- minimal server mock -------------------------------------------------------
// Captures registerTool() calls so tests can invoke handlers directly.

type TextBlock = { type: string; text: string }
type ToolResult = { content: TextBlock[] }
type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<ToolResult>

interface CapturedTool {
  config: Record<string, unknown>
  handler: ToolHandler
}

function makeMockServer() {
  const tools = new Map<string, CapturedTool>()
  const server: Partial<McpServer> = {
    registerTool(name: string, config: unknown, handler: unknown) {
      tools.set(name, {
        config: config as Record<string, unknown>,
        handler: handler as ToolHandler,
      })
      return {} as ReturnType<McpServer['registerTool']>
    },
  }
  return { server: server as McpServer, tools }
}

// Convenience: parse the first content block as JSON.
function parsed(result: ToolResult): unknown {
  return JSON.parse(result.content[0].text)
}

// Invoke a registered tool by name with the given (pre-validated) args.
function callTool(
  tools: Map<string, CapturedTool>,
  name: string,
  args: Record<string, unknown> = {},
) {
  const tool = tools.get(name)
  if (!tool) throw new Error(`Tool not registered: ${name}`)
  return tool.handler(args, {})
}

// ---- test fixtures -------------------------------------------------------------

const SUPPLIER_A: NetworkSupplier = {
  id: 1,
  name: 'Alfa Kft.',
  category: 'Elektronika',
  country: 'HU',
  connected: false,
  productCount: 50,
  avgResellerMarginPct: 18.5,
  shopUrl: 'https://alfa.hu',
  network: true,
  orderMode: 'email',
  email: null,
  description: null,
  createdAt: '2024-01-01T00:00:00Z',
}

const SUPPLIER_B: NetworkSupplier = {
  id: 2,
  name: 'Beta Bt.',
  category: 'Ruházat',
  country: 'DE',
  connected: true,
  productCount: 200,
  avgResellerMarginPct: null,
  shopUrl: null,
  network: true,
  orderMode: 'simulated',
  email: null,
  description: null,
  createdAt: '2024-02-01T00:00:00Z',
}

const PRODUCT_A: NetworkProduct = {
  id: 10,
  supplierId: 1,
  sku: 'SKU-01',
  name: 'Widget Plus',
  ean: '1234567890',
  category: 'Elektronika',
  wholesaleNet: 5000,
  rrpGross: 9999,
  stock: 100,
  updatedAt: '2024-01-01T00:00:00Z',
  potentialMargin: { priceGross: 8800, marginNet: 2000, marginPct: 28.5 },
}

const PRODUCT_B: NetworkProduct = {
  id: 11,
  supplierId: 1,
  sku: 'SKU-02',
  name: 'Gadget Mini',
  ean: null,
  category: 'Ruházat',
  wholesaleNet: 2000,
  rrpGross: null,
  stock: 0,
  updatedAt: '2024-01-02T00:00:00Z',
  potentialMargin: { priceGross: 3500, marginNet: 900, marginPct: 20.0 },
}

const SUPPLIER_VIEW: SupplierView = {
  supplier: {
    id: 1,
    name: 'Alfa Kft.',
    category: 'Elektronika',
    country: 'HU',
    shopUrl: 'https://alfa.hu',
  },
  products: [
    {
      id: 10,
      sku: 'SKU-01',
      name: 'Widget Plus',
      ean: '1234567890',
      category: 'Elektronika',
      wholesaleNet: 5000,
      rrpGross: 9999,
      stock: 100,
      resellerCount: 5,
      minGross: 7500,
      avgGross: 8800,
      maxGross: 9999,
      belowRrp: 4,
      lossCount: 0,
      saturation: 42,
    },
  ],
}

function makeClient(
  overrides: Partial<HasznoClient['network']> = {},
): HasznoClient {
  return {
    network: {
      listSuppliers: vi.fn().mockResolvedValue([SUPPLIER_A, SUPPLIER_B]),
      getSupplierProducts: vi.fn().mockResolvedValue([PRODUCT_A, PRODUCT_B]),
      getSupplierView: vi.fn().mockResolvedValue(SUPPLIER_VIEW),
      connect: vi.fn().mockResolvedValue({ status: 'connected', imported: 50, skipped: 0 }),
      disconnect: vi.fn().mockResolvedValue({ status: 'disconnected' }),
      sync: vi.fn().mockResolvedValue({ costChanges: 3, stockOuts: 1, total: 50 }),
      ...overrides,
    },
  } as unknown as HasznoClient
}

// ---- tests --------------------------------------------------------------------

describe('registerCatalogTools()', () => {
  it('registers 6 tools', () => {
    const { server, tools } = makeMockServer()
    registerCatalogTools(server, makeClient())
    expect(tools.size).toBe(6)
    expect([...tools.keys()]).toEqual(
      expect.arrayContaining([
        'haszno_catalog_list_categories',
        'haszno_catalog_list_suppliers',
        'haszno_catalog_supplier_products',
        'haszno_catalog_supplier_view',
        'haszno_catalog_connect_supplier',
        'haszno_catalog_sync_supplier',
      ]),
    )
  })

  // ---- list_categories --------------------------------------------------------
  describe('haszno_catalog_list_categories', () => {
    it('returns sorted unique categories derived from suppliers', async () => {
      const { server, tools } = makeMockServer()
      registerCatalogTools(server, makeClient())
      const result = await callTool(tools, 'haszno_catalog_list_categories')
      expect(parsed(result)).toEqual({ categories: ['Elektronika', 'Ruházat'] })
    })

    it('deduplicated — only unique categories returned', async () => {
      const dup: NetworkSupplier = { ...SUPPLIER_A, id: 3, name: 'Gamma' }
      const { server, tools } = makeMockServer()
      registerCatalogTools(
        server,
        makeClient({
          listSuppliers: vi.fn().mockResolvedValue([SUPPLIER_A, SUPPLIER_B, dup]),
        }),
      )
      const result = await callTool(tools, 'haszno_catalog_list_categories')
      const data = parsed(result) as { categories: string[] }
      expect(data.categories).toHaveLength(2)
    })

    it('tool is marked readOnlyHint: true', () => {
      const { server, tools } = makeMockServer()
      registerCatalogTools(server, makeClient())
      const ann = tools.get('haszno_catalog_list_categories')!.config.annotations as Record<string, boolean>
      expect(ann.readOnlyHint).toBe(true)
    })
  })

  // ---- list_suppliers ---------------------------------------------------------
  describe('haszno_catalog_list_suppliers', () => {
    it('returns all suppliers when no filters given', async () => {
      const { server, tools } = makeMockServer()
      registerCatalogTools(server, makeClient())
      const result = await callTool(tools, 'haszno_catalog_list_suppliers')
      const data = parsed(result) as { suppliers: unknown[]; total: number }
      expect(data.total).toBe(2)
      expect(data.suppliers).toHaveLength(2)
    })

    it('filters by category (case-insensitive)', async () => {
      const { server, tools } = makeMockServer()
      registerCatalogTools(server, makeClient())
      const result = await callTool(tools, 'haszno_catalog_list_suppliers', { category: 'elektronika' })
      const data = parsed(result) as { suppliers: Array<{ id: number }> }
      expect(data.suppliers).toHaveLength(1)
      expect(data.suppliers[0].id).toBe(1)
    })

    it('filters connected=true', async () => {
      const { server, tools } = makeMockServer()
      registerCatalogTools(server, makeClient())
      const result = await callTool(tools, 'haszno_catalog_list_suppliers', { connected: true })
      const data = parsed(result) as { suppliers: Array<{ id: number }> }
      expect(data.suppliers).toHaveLength(1)
      expect(data.suppliers[0].id).toBe(2)
    })

    it('searches by name substring', async () => {
      const { server, tools } = makeMockServer()
      registerCatalogTools(server, makeClient())
      const result = await callTool(tools, 'haszno_catalog_list_suppliers', { search: 'alfa' })
      const data = parsed(result) as { suppliers: Array<{ id: number }> }
      expect(data.suppliers).toHaveLength(1)
      expect(data.suppliers[0].id).toBe(1)
    })

    it('paginates — limit=1, page=1 returns one item and correct totals', async () => {
      const { server, tools } = makeMockServer()
      registerCatalogTools(server, makeClient())
      const result = await callTool(tools, 'haszno_catalog_list_suppliers', { limit: 1, page: 1 })
      const data = parsed(result) as { suppliers: unknown[]; total: number; pages: number }
      expect(data.suppliers).toHaveLength(1)
      expect(data.total).toBe(2)
      expect(data.pages).toBe(2)
    })

    it('page 2 returns remaining items', async () => {
      const { server, tools } = makeMockServer()
      registerCatalogTools(server, makeClient())
      const result = await callTool(tools, 'haszno_catalog_list_suppliers', { limit: 1, page: 2 })
      const data = parsed(result) as { suppliers: Array<{ id: number }> }
      expect(data.suppliers).toHaveLength(1)
      expect(data.suppliers[0].id).toBe(2)
    })

    it('tool is marked readOnlyHint: true', () => {
      const { server, tools } = makeMockServer()
      registerCatalogTools(server, makeClient())
      const ann = tools.get('haszno_catalog_list_suppliers')!.config.annotations as Record<string, boolean>
      expect(ann.readOnlyHint).toBe(true)
    })
  })

  // ---- supplier_products ------------------------------------------------------
  describe('haszno_catalog_supplier_products', () => {
    it('calls getSupplierProducts with the given supplier_id', async () => {
      const client = makeClient()
      const { server, tools } = makeMockServer()
      registerCatalogTools(server, client)
      await callTool(tools, 'haszno_catalog_supplier_products', { supplier_id: 7 })
      expect(client.network.getSupplierProducts).toHaveBeenCalledWith(7)
    })

    it('returns all products when no filters given', async () => {
      const { server, tools } = makeMockServer()
      registerCatalogTools(server, makeClient())
      const result = await callTool(tools, 'haszno_catalog_supplier_products', { supplier_id: 1 })
      const data = parsed(result) as { products: unknown[]; total: number }
      expect(data.total).toBe(2)
      expect(data.products).toHaveLength(2)
    })

    it('search filters by product name (case-insensitive)', async () => {
      const { server, tools } = makeMockServer()
      registerCatalogTools(server, makeClient())
      const result = await callTool(tools, 'haszno_catalog_supplier_products', {
        supplier_id: 1,
        search: 'widget',
      })
      const data = parsed(result) as { products: Array<{ sku: string }> }
      expect(data.products).toHaveLength(1)
      expect(data.products[0].sku).toBe('SKU-01')
    })

    it('search filters by SKU', async () => {
      const { server, tools } = makeMockServer()
      registerCatalogTools(server, makeClient())
      const result = await callTool(tools, 'haszno_catalog_supplier_products', {
        supplier_id: 1,
        search: 'SKU-02',
      })
      const data = parsed(result) as { products: Array<{ sku: string }> }
      expect(data.products).toHaveLength(1)
      expect(data.products[0].sku).toBe('SKU-02')
    })

    it('category filter', async () => {
      const { server, tools } = makeMockServer()
      registerCatalogTools(server, makeClient())
      const result = await callTool(tools, 'haszno_catalog_supplier_products', {
        supplier_id: 1,
        category: 'Ruházat',
      })
      const data = parsed(result) as { products: Array<{ sku: string }> }
      expect(data.products).toHaveLength(1)
      expect(data.products[0].sku).toBe('SKU-02')
    })

    it('paginates — limit=1 returns one product', async () => {
      const { server, tools } = makeMockServer()
      registerCatalogTools(server, makeClient())
      const result = await callTool(tools, 'haszno_catalog_supplier_products', {
        supplier_id: 1,
        limit: 1,
        page: 1,
      })
      const data = parsed(result) as { products: unknown[]; total: number; pages: number }
      expect(data.products).toHaveLength(1)
      expect(data.total).toBe(2)
      expect(data.pages).toBe(2)
    })

    it('tool is marked readOnlyHint: true', () => {
      const { server, tools } = makeMockServer()
      registerCatalogTools(server, makeClient())
      const ann = tools.get('haszno_catalog_supplier_products')!.config.annotations as Record<string, boolean>
      expect(ann.readOnlyHint).toBe(true)
    })
  })

  // ---- supplier_view ----------------------------------------------------------
  describe('haszno_catalog_supplier_view', () => {
    it('calls getSupplierView with supplier_id and returns full view', async () => {
      const client = makeClient()
      const { server, tools } = makeMockServer()
      registerCatalogTools(server, client)
      const result = await callTool(tools, 'haszno_catalog_supplier_view', { supplier_id: 1 })
      expect(client.network.getSupplierView).toHaveBeenCalledWith(1)
      const data = parsed(result) as typeof SUPPLIER_VIEW
      expect(data.supplier.id).toBe(1)
      expect(data.products).toHaveLength(1)
      expect(data.products[0].saturation).toBe(42)
    })

    it('tool is marked readOnlyHint: true', () => {
      const { server, tools } = makeMockServer()
      registerCatalogTools(server, makeClient())
      const ann = tools.get('haszno_catalog_supplier_view')!.config.annotations as Record<string, boolean>
      expect(ann.readOnlyHint).toBe(true)
    })
  })

  // ---- connect_supplier -------------------------------------------------------
  describe('haszno_catalog_connect_supplier', () => {
    it('returns preview and does NOT call connect when confirm=false', async () => {
      const client = makeClient()
      const { server, tools } = makeMockServer()
      registerCatalogTools(server, client)
      const result = await callTool(tools, 'haszno_catalog_connect_supplier', {
        supplier_id: 1,
        confirm: false,
      })
      expect(client.network.connect).not.toHaveBeenCalled()
      const data = parsed(result) as { preview: boolean }
      expect(data.preview).toBe(true)
    })

    it('calls connect and returns result when confirm=true', async () => {
      const client = makeClient()
      const { server, tools } = makeMockServer()
      registerCatalogTools(server, client)
      const result = await callTool(tools, 'haszno_catalog_connect_supplier', {
        supplier_id: 1,
        confirm: true,
      })
      expect(client.network.connect).toHaveBeenCalledWith(1)
      const data = parsed(result) as { imported: number }
      expect(data.imported).toBe(50)
    })

    it('has correct annotations (not readOnly, idempotent)', () => {
      const { server, tools } = makeMockServer()
      registerCatalogTools(server, makeClient())
      const ann = tools.get('haszno_catalog_connect_supplier')!.config.annotations as Record<string, boolean>
      expect(ann.readOnlyHint).toBe(false)
      expect(ann.idempotentHint).toBe(true)
      expect(ann.destructiveHint).toBe(false)
    })
  })

  // ---- sync_supplier ----------------------------------------------------------
  describe('haszno_catalog_sync_supplier', () => {
    it('returns preview and does NOT call sync when confirm=false', async () => {
      const client = makeClient()
      const { server, tools } = makeMockServer()
      registerCatalogTools(server, client)
      const result = await callTool(tools, 'haszno_catalog_sync_supplier', {
        supplier_id: 2,
        confirm: false,
      })
      expect(client.network.sync).not.toHaveBeenCalled()
      const data = parsed(result) as { preview: boolean }
      expect(data.preview).toBe(true)
    })

    it('calls sync and returns result when confirm=true', async () => {
      const client = makeClient()
      const { server, tools } = makeMockServer()
      registerCatalogTools(server, client)
      const result = await callTool(tools, 'haszno_catalog_sync_supplier', {
        supplier_id: 2,
        confirm: true,
      })
      expect(client.network.sync).toHaveBeenCalledWith(2)
      const data = parsed(result) as { costChanges: number; stockOuts: number }
      expect(data.costChanges).toBe(3)
      expect(data.stockOuts).toBe(1)
    })

    it('has correct annotations (not readOnly, idempotent)', () => {
      const { server, tools } = makeMockServer()
      registerCatalogTools(server, makeClient())
      const ann = tools.get('haszno_catalog_sync_supplier')!.config.annotations as Record<string, boolean>
      expect(ann.readOnlyHint).toBe(false)
      expect(ann.idempotentHint).toBe(true)
      expect(ann.destructiveHint).toBe(false)
    })
  })
})
