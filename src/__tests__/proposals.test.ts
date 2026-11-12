/**
 * Unit tests for haszno_proposals_* MCP tools.
 *
 * Strategy:
 *  - mock McpServer by capturing tool registrations in a plain Map
 *  - mock HasznoClient using vi.fn() for each method
 *  - invoke the captured handler directly and assert on the JSON output
 *
 * No network calls are made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerProposalsTools } from '../tools/proposals.js'
import { HasznoApiError } from '../client/index.js'
import type { HasznoClient, Proposal, Product } from '../client/index.js'

// ── McpServer mock ────────────────────────────────────────────────────────────

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>
  isError?: boolean
}>

type RegisteredTool = { description: string; handler: ToolHandler }

function makeMockServer() {
  const tools = new Map<string, RegisteredTool>()
  return {
    tools,
    tool(name: string, ...rest: unknown[]) {
      // rest = [description?, schema?, annotations?, handler]
      const handler = rest[rest.length - 1] as ToolHandler
      const description = typeof rest[0] === 'string' ? (rest[0] as string) : ''
      tools.set(name, { description, handler })
    },
  }
}

type MockServer = ReturnType<typeof makeMockServer>

// ── HasznoClient mock ────────────────────────────────────────────────────────

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: 1,
    productId: 10,
    productName: 'Test Product',
    productSku: 'SKU-001',
    oldPriceGross: 10000,
    proposedPriceGross: 9500,
    reason: 'market undercut detected',
    source: 'rule:auto-price',
    status: 'pending',
    batchId: null,
    createdAt: '2025-01-01T12:00:00Z',
    decidedAt: null,
    ...overrides,
  }
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 10,
    supplierId: 2,
    sku: 'SKU-001',
    name: 'Test Product',
    costNet: 6000,
    stock: 5,
    rrpGross: 12000,
    marketMinGross: 9200,
    marketShop: 'competitor.hu',
    priceGross: 10000,
    listed: true,
    trendKeyword: null,
    trendKeywordEn: null,
    updatedAt: '2025-01-01T00:00:00Z',
    supplierName: 'Supplier A',
    current: { priceGross: 10000, marginNet: 3150, marginPct: 31.5 },
    recommended: { priceGross: 9500, marginNet: 2756, marginPct: 27.6 },
    ...overrides,
  }
}

function makeMockClient(overrides?: Partial<HasznoClient>): HasznoClient {
  return {
    health: { check: vi.fn() },
    settings: { get: vi.fn(), update: vi.fn() },
    products: {
      list: vi.fn().mockResolvedValue([makeProduct()]),
      update: vi.fn(),
      setListing: vi.fn(),
      generateAiDescription: vi.fn(),
      applyPrices: vi.fn(),
    },
    stats: { get: vi.fn(), getImpact: vi.fn() },
    suppliers: { list: vi.fn() },
    feeds: { importFeed: vi.fn(), importMarketPrices: vi.fn() },
    orders: { list: vi.fn(), receiveOrder: vi.fn(), ship: vi.fn(), createDemo: vi.fn() },
    recommendations: { get: vi.fn(), fillTrendKeywords: vi.fn() },
    rules: {
      listTemplates: vi.fn(),
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      run: vi.fn(),
      runAll: vi.fn(),
      trigger: vi.fn(),
      listRuns: vi.fn(),
    },
    proposals: {
      list: vi.fn().mockResolvedValue([makeProposal()]),
      approve: vi.fn().mockResolvedValue({ batchId: 'b-abc123', applied: 1 }),
      reject: vi.fn().mockResolvedValue({ rejected: 1 }),
      rollback: vi.fn().mockResolvedValue({ rolledBack: 1 }),
    },
    automation: { get: vi.fn(), set: vi.fn() },
    network: {
      listSuppliers: vi.fn(),
      getSupplierProducts: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      sync: vi.fn(),
      getSupplierView: vi.fn(),
    },
    ...overrides,
  } as unknown as HasznoClient
}

// ── helpers ───────────────────────────────────────────────────────────────────

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text)
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('registerProposalsTools()', () => {
  let server: MockServer
  let client: HasznoClient

  beforeEach(() => {
    server = makeMockServer()
    client = makeMockClient()
    registerProposalsTools(server as never, client)
  })

  it('registers exactly 6 proposal tools (including propose for shop tokens)', () => {
    const proposalTools = [...server.tools.keys()].filter((k) => k.startsWith('haszno_proposals'))
    expect(proposalTools.sort()).toEqual([
      'haszno_proposals_approve',
      'haszno_proposals_list',
      'haszno_proposals_market',
      'haszno_proposals_propose',
      'haszno_proposals_reject',
      'haszno_proposals_rollback',
    ])
  })

  // ── haszno_proposals_list ─────────────────────────────────────────────────

  describe('haszno_proposals_list', () => {
    it('calls client.proposals.list() without params when no status given', async () => {
      const handler = server.tools.get('haszno_proposals_list')!.handler
      await handler({ limit: 25, offset: 0 })
      expect(client.proposals.list).toHaveBeenCalledWith(undefined)
    })

    it('calls client.proposals.list({ status }) when status is provided', async () => {
      const handler = server.tools.get('haszno_proposals_list')!.handler
      await handler({ status: 'pending', limit: 25, offset: 0 })
      expect(client.proposals.list).toHaveBeenCalledWith({ status: 'pending' })
    })

    it('returns proposals with computed diffGross', async () => {
      const handler = server.tools.get('haszno_proposals_list')!.handler
      const result = await handler({ limit: 25, offset: 0 })
      const data = parseResult(result)
      expect(data.proposals).toHaveLength(1)
      expect(data.proposals[0].diffGross).toBe(9500 - 10000) // -500
      expect(data.proposals[0].id).toBe(1)
    })

    it('paginates: returns correct slice with offset and limit', async () => {
      const proposals = Array.from({ length: 10 }, (_, i) =>
        makeProposal({ id: i + 1, productId: i + 1 }),
      )
      vi.mocked(client.proposals.list).mockResolvedValue(proposals)

      const handler = server.tools.get('haszno_proposals_list')!.handler
      const result = await handler({ limit: 3, offset: 2 })
      const data = parseResult(result)

      expect(data.proposals).toHaveLength(3)
      expect(data.proposals[0].id).toBe(3)
      expect(data._meta.total).toBe(10)
      expect(data._meta.hasMore).toBe(true)
    })

    it('filters by productId client-side', async () => {
      const proposals = [
        makeProposal({ id: 1, productId: 10 }),
        makeProposal({ id: 2, productId: 20 }),
        makeProposal({ id: 3, productId: 10 }),
      ]
      vi.mocked(client.proposals.list).mockResolvedValue(proposals)

      const handler = server.tools.get('haszno_proposals_list')!.handler
      const result = await handler({ productId: 10, limit: 25, offset: 0 })
      const data = parseResult(result)

      expect(data.proposals).toHaveLength(2)
      expect(data.proposals.every((p: { productId: number }) => p.productId === 10)).toBe(true)
    })

    it('returns isError on API failure', async () => {
      vi.mocked(client.proposals.list).mockRejectedValue(
        new HasznoApiError(404, 'Not found'),
      )
      const handler = server.tools.get('haszno_proposals_list')!.handler
      const result = await handler({ limit: 25, offset: 0 })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('404')
    })
  })

  // ── haszno_proposals_market ───────────────────────────────────────────────

  describe('haszno_proposals_market', () => {
    it('returns product + pending proposals for the given productId', async () => {
      // Mock returns only pending proposals (the API is called with status:'pending')
      vi.mocked(client.proposals.list).mockResolvedValue([
        makeProposal({ id: 1, productId: 10, status: 'pending' }),
        makeProposal({ id: 3, productId: 99, status: 'pending' }),
      ])

      const handler = server.tools.get('haszno_proposals_market')!.handler
      const result = await handler({ productId: 10 })
      const data = parseResult(result)

      expect(data.product.id).toBe(10)
      expect(data.product.market.minGross).toBe(9200)
      expect(data.product.market.shop).toBe('competitor.hu')
      // only pending proposals for productId 10
      expect(data.pendingProposals).toHaveLength(1)
      expect(data.pendingProposals[0].id).toBe(1)
    })

    it('returns error when product not found', async () => {
      vi.mocked(client.products.list).mockResolvedValue([makeProduct({ id: 42 })])

      const handler = server.tools.get('haszno_proposals_market')!.handler
      const result = await handler({ productId: 999 })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('999')
    })

    it('calls proposals.list with status:pending', async () => {
      const handler = server.tools.get('haszno_proposals_market')!.handler
      await handler({ productId: 10 })
      expect(client.proposals.list).toHaveBeenCalledWith({ status: 'pending' })
    })
  })

  // ── haszno_proposals_approve ──────────────────────────────────────────────

  describe('haszno_proposals_approve', () => {
    it('blocks without confirm: true', async () => {
      const handler = server.tools.get('haszno_proposals_approve')!.handler
      const result = await handler({ confirm: false })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Safety gate')
      expect(client.proposals.approve).not.toHaveBeenCalled()
    })

    it('blocks when confirm is omitted', async () => {
      const handler = server.tools.get('haszno_proposals_approve')!.handler
      const result = await handler({})
      expect(result.isError).toBe(true)
      expect(client.proposals.approve).not.toHaveBeenCalled()
    })

    it('calls client.proposals.approve with ids when confirm: true', async () => {
      const handler = server.tools.get('haszno_proposals_approve')!.handler
      await handler({ ids: [1, 2], confirm: true })
      expect(client.proposals.approve).toHaveBeenCalledWith({ ids: [1, 2] })
    })

    it('calls client.proposals.approve without ids for batch-approve', async () => {
      const handler = server.tools.get('haszno_proposals_approve')!.handler
      await handler({ confirm: true })
      expect(client.proposals.approve).toHaveBeenCalledWith(undefined)
    })

    it('returns batchId and applied count on success', async () => {
      const handler = server.tools.get('haszno_proposals_approve')!.handler
      const result = await handler({ confirm: true })
      const data = parseResult(result)
      expect(data.batchId).toBe('b-abc123')
      expect(data.applied).toBe(1)
      expect(data.note).toContain('b-abc123')
    })

    it('returns isError on API failure', async () => {
      vi.mocked(client.proposals.approve).mockRejectedValue(
        new HasznoApiError(403, 'Forbidden'),
      )
      const handler = server.tools.get('haszno_proposals_approve')!.handler
      const result = await handler({ confirm: true })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('403')
    })
  })

  // ── haszno_proposals_reject ───────────────────────────────────────────────

  describe('haszno_proposals_reject', () => {
    it('blocks without confirm: true', async () => {
      const handler = server.tools.get('haszno_proposals_reject')!.handler
      const result = await handler({ ids: [1], confirm: false })
      expect(result.isError).toBe(true)
      expect(client.proposals.reject).not.toHaveBeenCalled()
    })

    it('calls client.proposals.reject with ids when confirm: true', async () => {
      const handler = server.tools.get('haszno_proposals_reject')!.handler
      await handler({ ids: [3, 4], confirm: true })
      expect(client.proposals.reject).toHaveBeenCalledWith({ ids: [3, 4] })
    })

    it('returns rejected count and note on success', async () => {
      const handler = server.tools.get('haszno_proposals_reject')!.handler
      const result = await handler({ ids: [1], confirm: true })
      const data = parseResult(result)
      expect(data.rejected).toBe(1)
      expect(data.note).toContain('1 proposal')
      expect(data.note).toContain('No prices were changed')
    })

    it('returns isError on API failure', async () => {
      vi.mocked(client.proposals.reject).mockRejectedValue(new Error('timeout'))
      const handler = server.tools.get('haszno_proposals_reject')!.handler
      const result = await handler({ ids: [1], confirm: true })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('timeout')
    })
  })

  // ── haszno_proposals_rollback ─────────────────────────────────────────────

  describe('haszno_proposals_rollback', () => {
    it('blocks without confirm: true', async () => {
      const handler = server.tools.get('haszno_proposals_rollback')!.handler
      const result = await handler({ batchId: 'b-abc123', confirm: false })
      expect(result.isError).toBe(true)
      expect(client.proposals.rollback).not.toHaveBeenCalled()
    })

    it('calls client.proposals.rollback with batchId when confirm: true', async () => {
      const handler = server.tools.get('haszno_proposals_rollback')!.handler
      await handler({ batchId: 'b-abc123', confirm: true })
      expect(client.proposals.rollback).toHaveBeenCalledWith({ batchId: 'b-abc123' })
    })

    it('returns rolledBack count and note on success', async () => {
      const handler = server.tools.get('haszno_proposals_rollback')!.handler
      const result = await handler({ batchId: 'b-abc123', confirm: true })
      const data = parseResult(result)
      expect(data.rolledBack).toBe(1)
      expect(data.note).toContain('b-abc123')
    })

    it('returns isError on API failure', async () => {
      vi.mocked(client.proposals.rollback).mockRejectedValue(
        new HasznoApiError(404, 'Batch not found'),
      )
      const handler = server.tools.get('haszno_proposals_rollback')!.handler
      const result = await handler({ batchId: 'b-xyz', confirm: true })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('404')
    })
  })
})
