/**
 * Unit tests for packages/mcp/src/tools/ideas.ts
 *
 * Strategy: mock HasznoClient methods and an in-process McpServer, then
 * call registerIdeasTools(), find each registered tool by name, and invoke
 * its handler directly with mocked args. No network required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { HasznoClient } from '../../client/index.js'
import { registerIdeasTools } from '../ideas.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>

/** Capture all tools registered on a fresh server and return a lookup by name. */
function captureTools(client: HasznoClient): Map<string, ToolHandler> {
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerIdeasTools(server, client)

  // Access the internal _registeredTools map to extract handlers for direct invocation.
  // RegisteredTool stores the callback at `.handler` (SDK v1.12+).
  const reg = (server as unknown as { _registeredTools: Record<string, { handler: ToolHandler }> })._registeredTools
  const tools = new Map<string, ToolHandler>()
  for (const [name, entry] of Object.entries(reg)) {
    tools.set(name, entry.handler as ToolHandler)
  }
  return tools
}

function makeClient(overrides: Partial<HasznoClient> = {}): HasznoClient {
  const base: Partial<HasznoClient> = {
    recommendations: {
      get: vi.fn(),
      getAiShortlist: vi.fn(),
      fillTrendKeywords: vi.fn(),
    },
    products: {
      list: vi.fn(),
      update: vi.fn(),
      setListing: vi.fn(),
      generateAiDescription: vi.fn(),
      applyPrices: vi.fn(),
    },
    // remaining domains are unused by ideas tools — stubs enough for the type
    health: { check: vi.fn() },
    settings: { get: vi.fn(), update: vi.fn() },
    stats: { get: vi.fn(), getImpact: vi.fn() },
    suppliers: { list: vi.fn() },
    feeds: { importFeed: vi.fn(), importMarketPrices: vi.fn() },
    orders: { list: vi.fn(), receiveOrder: vi.fn(), ship: vi.fn(), createDemo: vi.fn() },
    rules: { listTemplates: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), run: vi.fn(), runAll: vi.fn(), trigger: vi.fn(), listRuns: vi.fn(), undoUnlists: vi.fn() },
    proposals: { list: vi.fn(), approve: vi.fn(), reject: vi.fn(), rollback: vi.fn() },
    automation: { get: vi.fn(), set: vi.fn() },
    network: { listSuppliers: vi.fn(), getSupplierProducts: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), sync: vi.fn(), getSupplierView: vi.fn() },
  }
  return { ...base, ...overrides } as HasznoClient
}

function parseText(result: { content: Array<{ type: string; text: string }> }) {
  expect(result.content[0].type).toBe('text')
  return JSON.parse(result.content[0].text)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registerIdeasTools()', () => {
  it('registers 4 tools', () => {
    const client = makeClient()
    const tools = captureTools(client)
    expect([...tools.keys()].sort()).toEqual([
      'haszno_ideas_ai_description',
      'haszno_ideas_ai_shortlist',
      'haszno_ideas_fill_keywords',
      'haszno_ideas_list',
    ])
  })

  // ---- haszno_ideas_list --------------------------------------------------

  describe('haszno_ideas_list', () => {
    const mockRecs = {
      anchor: 'páramentesítő',
      geo: 'HU',
      items: [
        {
          id: 1,
          sku: 'A-1',
          name: 'Páramentesítő 2000ml',
          costNet: 3000,
          stock: 10,
          supplierName: 'Demo Kft',
          recommended: { priceGross: 8990, marginNet: 1500, marginPct: 20 },
          trendScore: 85,
        },
        {
          id: 2,
          sku: 'B-2',
          name: 'Párásító 1L',
          costNet: 2000,
          stock: 5,
          supplierName: 'Másik Bt',
          recommended: { priceGross: 5990, marginNet: 900, marginPct: 18 },
          trendScore: 60,
        },
        {
          id: 3,
          sku: 'C-3',
          name: 'Levegőszűrő',
          costNet: 5000,
          stock: 3,
          supplierName: 'Demo Kft',
          recommended: { priceGross: 12990, marginNet: 2500, marginPct: 23 },
          trendScore: 40,
        },
      ],
    }

    let client: HasznoClient
    let tool: ToolHandler

    beforeEach(() => {
      client = makeClient()
      vi.mocked(client.recommendations.get).mockResolvedValue(mockRecs)
      const tools = captureTools(client)
      tool = tools.get('haszno_ideas_list')!
    })

    it('returns all items sorted by trendScore DESC when no filters', async () => {
      const result = parseText(await tool({}))
      expect(result.total).toBe(3)
      expect(result.filtered).toBe(3)
      expect(result.truncated).toBe(false)
      expect(result.anchor).toBe('páramentesítő')
      expect(result.geo).toBe('HU')
      expect(result.items[0].trendScore).toBe(85)
      expect(result.items[1].trendScore).toBe(60)
      expect(result.items[2].trendScore).toBe(40)
    })

    it('filters by min_score', async () => {
      const result = parseText(await tool({ min_score: 65 }))
      expect(result.filtered).toBe(1)
      expect(result.items[0].sku).toBe('A-1')
    })

    it('filters by supplier (case-insensitive substring)', async () => {
      const result = parseText(await tool({ supplier: 'demo' }))
      expect(result.filtered).toBe(2)
      expect(result.items.every((it: { supplier: string }) => it.supplier === 'Demo Kft')).toBe(true)
    })

    it('respects limit and sets truncated flag', async () => {
      const result = parseText(await tool({ limit: 2 }))
      expect(result.items.length).toBe(2)
      expect(result.truncated).toBe(true)
      expect(result.filtered).toBe(2)
    })

    it('reports correct money labels (HUF suffixes)', async () => {
      const result = parseText(await tool({ limit: 1 }))
      const item = result.items[0]
      expect('costNet_HUF' in item).toBe(true)
      expect('suggestedPriceGross_HUF' in item).toBe(true)
      expect('marginNet_HUF' in item).toBe(true)
    })

    it('calls client.recommendations.get() once', async () => {
      await tool({})
      expect(client.recommendations.get).toHaveBeenCalledTimes(1)
    })
  })

  // ---- haszno_ideas_ai_shortlist ------------------------------------------

  describe('haszno_ideas_ai_shortlist', () => {
    const mockShortlist = {
      summary: 'A bolt főleg tisztítószereket árul; ajánlott a légfrissítő termékek bővítése.',
      picks: [
        {
          productId: 5,
          networkProductId: null,
          name: 'Légfrissítő spray 300ml',
          imageUrl: null,
          supplierName: 'Demo Kft',
          recommendedPriceGross: 2990,
          marginNet: 600,
          marginPct: 24,
          listed: false,
          fit: 88,
          aiReason: 'Jól illeszkedik a tisztítószer-vevőkörhöz.',
        },
      ],
      usage: { model: 'claude-haiku-5-5', inputTokens: 400, outputTokens: 120, costFt: 0.08 },
      cached: false,
    }

    let client: HasznoClient
    let tool: ToolHandler

    beforeEach(() => {
      client = makeClient()
      vi.mocked(client.recommendations.getAiShortlist).mockResolvedValue(mockShortlist)
      const tools = captureTools(client)
      tool = tools.get('haszno_ideas_ai_shortlist')!
    })

    it('returns summary, picks, usage and cached flag', async () => {
      const result = parseText(await tool({ confirm: true }))
      expect(result.summary).toBe(mockShortlist.summary)
      expect(result.cached).toBe(false)
      expect(result.picks).toHaveLength(1)
      expect(result.picks[0].name).toBe('Légfrissítő spray 300ml')
      expect(result.picks[0].fit).toBe(88)
      expect(result.usage.inputTokens).toBe(400)
      expect(result.usage.estimatedCostFt_HUF).toBe(0.08)
    })

    it('renames supplierName → supplier in picks', async () => {
      const result = parseText(await tool({ confirm: true }))
      expect('supplier' in result.picks[0]).toBe(true)
      expect('supplierName' in result.picks[0]).toBe(false)
    })

    it('renames costFt → estimatedCostFt_HUF in usage', async () => {
      const result = parseText(await tool({ confirm: true }))
      expect('estimatedCostFt_HUF' in result.usage).toBe(true)
      expect('costFt' in result.usage).toBe(false)
    })

    it('returns null usage when server returns null usage', async () => {
      vi.mocked(client.recommendations.getAiShortlist).mockResolvedValue({
        summary: 'Nincs javaslat.',
        picks: [],
        usage: null,
        cached: false,
      })
      const tools = captureTools(client)
      const noUsageTool = tools.get('haszno_ideas_ai_shortlist')!
      const result = parseText(await noUsageTool({ confirm: true }))
      expect(result.usage).toBeNull()
      expect(result.picks).toHaveLength(0)
    })

    it('calls client.recommendations.getAiShortlist() once', async () => {
      await tool({ confirm: true })
      expect(client.recommendations.getAiShortlist).toHaveBeenCalledTimes(1)
    })
  })

  // ---- haszno_ideas_ai_description ----------------------------------------

  describe('haszno_ideas_ai_description', () => {
    let client: HasznoClient
    let tool: ToolHandler

    beforeEach(() => {
      client = makeClient()
      vi.mocked(client.products.generateAiDescription).mockResolvedValue({
        text: 'Ez egy kiváló páramentesítő 2000 ml-es tartállyal.',
      })
      const tools = captureTools(client)
      tool = tools.get('haszno_ideas_ai_description')!
    })

    it('returns product_id and generated description', async () => {
      const result = parseText(await tool({ product_id: 42, confirm: true }))
      expect(result.product_id).toBe(42)
      expect(result.description).toBe('Ez egy kiváló páramentesítő 2000 ml-es tartállyal.')
    })

    it('calls client.products.generateAiDescription with the given id', async () => {
      await tool({ product_id: 7, confirm: true })
      expect(client.products.generateAiDescription).toHaveBeenCalledWith(7)
    })
  })

  // ---- haszno_ideas_fill_keywords -----------------------------------------

  describe('haszno_ideas_fill_keywords', () => {
    let client: HasznoClient
    let tool: ToolHandler

    beforeEach(() => {
      client = makeClient()
      vi.mocked(client.recommendations.fillTrendKeywords).mockResolvedValue({ updated: 12 })
      const tools = captureTools(client)
      tool = tools.get('haszno_ideas_fill_keywords')!
    })

    it('returns { updated: N }', async () => {
      const result = parseText(await tool({ confirm: true }))
      expect(result.updated).toBe(12)
    })

    it('returns { updated: 0 } when nothing to fill', async () => {
      vi.mocked(client.recommendations.fillTrendKeywords).mockResolvedValue({ updated: 0 })
      const tools = captureTools(client)
      const noopTool = tools.get('haszno_ideas_fill_keywords')!
      const result = parseText(await noopTool({ confirm: true }))
      expect(result.updated).toBe(0)
    })

    it('calls client.recommendations.fillTrendKeywords() once', async () => {
      await tool({ confirm: true })
      expect(client.recommendations.fillTrendKeywords).toHaveBeenCalledTimes(1)
    })
  })
})
