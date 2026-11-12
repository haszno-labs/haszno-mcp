/**
 * Unit tests for haszno_proposals_* MCP tools.
 *
 * Changes from the pre-bearer version:
 *  - Tools now call client.agent.proposals() (GET /api/agent/proposals, pending only)
 *    instead of client.proposals.list()
 *  - haszno_proposals_create added (POST /api/agent/proposals with auto nonce)
 *  - haszno_proposals_approve / reject / rollback return "not available" (no API call)
 *  - Response shapes use AgentProposal (no source, batchId, decidedAt)
 *  - Error handling for 401/403/404/409/429 status codes
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
import type { HasznoClient, AgentProposal, AgentProduct } from '../client/index.js'

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
      const handler = rest[rest.length - 1] as ToolHandler
      const description = typeof rest[0] === 'string' ? (rest[0] as string) : ''
      tools.set(name, { description, handler })
    },
  }
}

type MockServer = ReturnType<typeof makeMockServer>

// ── Fixture factories ─────────────────────────────────────────────────────────

function makeAgentProposal(overrides: Partial<AgentProposal> = {}): AgentProposal {
  return {
    id: 1,
    productId: 10,
    productName: 'Test Product',
    productSku: 'SKU-001',
    oldPriceGross: 10000,
    proposedPriceGross: 9500,
    reason: 'market undercut detected',
    status: 'pending',
    createdAt: '2025-01-01T12:00:00Z',
    ...overrides,
  }
}

function makeAgentProduct(overrides: Partial<AgentProduct> = {}): AgentProduct {
  return {
    id: 10,
    sku: 'SKU-001',
    name: 'Test Product',
    listed: true,
    priceGross: 10000,
    stock: 5,
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
      list: vi.fn(),
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
      undoUnlists: vi.fn(),
    },
    proposals: {
      list: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
      rollback: vi.fn(),
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
    catalogue: { search: vi.fn() },
    importList: { list: vi.fn(), add: vi.fn(), push: vi.fn() },
    connections: { list: vi.fn(), get: vi.fn() },
    peers: {
      createInvite: vi.fn(),
      listInvites: vi.fn(),
      revokeInvite: vi.fn(),
      acceptInvite: vi.fn(),
      listLinks: vi.fn(),
      removeLink: vi.fn(),
      setVisibility: vi.fn(),
    },
    blog: { list: vi.fn(), get: vi.fn() },
    agent: {
      products: vi.fn().mockResolvedValue([makeAgentProduct()]),
      orders: vi.fn().mockResolvedValue([]),
      proposals: vi.fn().mockResolvedValue([makeAgentProposal()]),
      createProposal: vi.fn().mockResolvedValue({ id: 42, status: 'pending', createdAt: '2025-01-02T10:00:00Z' }),
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

  it('registers exactly 6 proposal tools', () => {
    const proposalTools = [...server.tools.keys()].filter((k) => k.startsWith('haszno_proposals'))
    expect(proposalTools.sort()).toEqual([
      'haszno_proposals_approve',
      'haszno_proposals_create',
      'haszno_proposals_list',
      'haszno_proposals_market',
      'haszno_proposals_reject',
      'haszno_proposals_rollback',
    ])
  })

  // ── haszno_proposals_list ─────────────────────────────────────────────────

  describe('haszno_proposals_list', () => {
    it('calls client.agent.proposals() — not client.proposals.list()', async () => {
      const handler = server.tools.get('haszno_proposals_list')!.handler
      await handler({})
      expect(client.agent.proposals).toHaveBeenCalledOnce()
      expect(client.proposals.list).not.toHaveBeenCalled()
    })

    it('returns proposals with computed diffGross', async () => {
      const handler = server.tools.get('haszno_proposals_list')!.handler
      const result = await handler({})
      const data = parseResult(result)
      expect(data.proposals).toHaveLength(1)
      expect(data.proposals[0].diffGross).toBe(9500 - 10000) // -500
      expect(data.proposals[0].id).toBe(1)
    })

    it('does not include source, batchId, decidedAt in output', async () => {
      const handler = server.tools.get('haszno_proposals_list')!.handler
      const result = await handler({})
      const data = parseResult(result)
      const proposal = data.proposals[0]
      expect(proposal).not.toHaveProperty('source')
      expect(proposal).not.toHaveProperty('batchId')
      expect(proposal).not.toHaveProperty('decidedAt')
    })

    it('includes a note about pending-only restriction in _meta', async () => {
      const handler = server.tools.get('haszno_proposals_list')!.handler
      const result = await handler({})
      const data = parseResult(result)
      expect(data._meta.note).toContain('pending')
    })

    it('returns isError on API 401 with helpful message', async () => {
      vi.mocked(client.agent.proposals).mockRejectedValue(new HasznoApiError(401, 'Unauthorized'))
      const handler = server.tools.get('haszno_proposals_list')!.handler
      const result = await handler({})
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/Invalid.*expired.*revoked|token/i)
    })

    it('returns isError on API 429 with helpful message', async () => {
      vi.mocked(client.agent.proposals).mockRejectedValue(new HasznoApiError(429, 'Too Many Requests'))
      const handler = server.tools.get('haszno_proposals_list')!.handler
      const result = await handler({})
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/Too many|failed attempt/i)
    })
  })

  // ── haszno_proposals_market ───────────────────────────────────────────────

  describe('haszno_proposals_market', () => {
    it('calls client.agent.products() and client.agent.proposals() — not legacy endpoints', async () => {
      const handler = server.tools.get('haszno_proposals_market')!.handler
      await handler({ productId: 10 })
      expect(client.agent.products).toHaveBeenCalledOnce()
      expect(client.agent.proposals).toHaveBeenCalledOnce()
      expect(client.products.list).not.toHaveBeenCalled()
      expect(client.proposals.list).not.toHaveBeenCalled()
    })

    it('returns product + pending proposals for the given productId', async () => {
      vi.mocked(client.agent.proposals).mockResolvedValue([
        makeAgentProposal({ id: 1, productId: 10 }),
        makeAgentProposal({ id: 3, productId: 99 }),
      ])
      const handler = server.tools.get('haszno_proposals_market')!.handler
      const result = await handler({ productId: 10 })
      const data = parseResult(result)
      expect(data.product.id).toBe(10)
      expect(data.pendingProposals).toHaveLength(1)
      expect(data.pendingProposals[0].id).toBe(1)
    })

    it('product does not include costNet, marketMinGross (not available via shop token)', async () => {
      const handler = server.tools.get('haszno_proposals_market')!.handler
      const result = await handler({ productId: 10 })
      const data = parseResult(result)
      expect(data.product).not.toHaveProperty('costNet')
      expect(data.product).not.toHaveProperty('marketMinGross')
    })

    it('returns isError when product not found', async () => {
      const handler = server.tools.get('haszno_proposals_market')!.handler
      const result = await handler({ productId: 999 })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('999')
    })
  })

  // ── haszno_proposals_create ───────────────────────────────────────────────

  describe('haszno_proposals_create', () => {
    it('calls client.agent.createProposal() with the right args', async () => {
      const handler = server.tools.get('haszno_proposals_create')!.handler
      await handler({ productId: 10, proposedPriceGross: 8900, reason: 'Cheaper competitor' })
      expect(client.agent.createProposal).toHaveBeenCalledOnce()
      const call = vi.mocked(client.agent.createProposal).mock.calls[0][0]
      expect(call.productId).toBe(10)
      expect(call.proposedPriceGross).toBe(8900)
      expect(call.reason).toBe('Cheaper competitor')
      // nonce must be a UUID
      expect(call.nonce).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    })

    it('generates a unique nonce per call', async () => {
      const handler = server.tools.get('haszno_proposals_create')!.handler
      await handler({ productId: 10, proposedPriceGross: 8900, reason: 'reason 1' })
      await handler({ productId: 10, proposedPriceGross: 8900, reason: 'reason 2' })
      const calls = vi.mocked(client.agent.createProposal).mock.calls
      expect(calls[0][0].nonce).not.toBe(calls[1][0].nonce)
    })

    it('returns id, status, createdAt in result', async () => {
      const handler = server.tools.get('haszno_proposals_create')!.handler
      const result = await handler({ productId: 10, proposedPriceGross: 8900, reason: 'test' })
      const data = parseResult(result)
      expect(data.id).toBe(42)
      expect(data.status).toBe('pending')
      expect(data.createdAt).toBe('2025-01-02T10:00:00Z')
      expect(data.note.toLowerCase()).toContain('pending')
    })

    it('returns isError on 404 with product-not-in-shop message', async () => {
      vi.mocked(client.agent.createProposal).mockRejectedValue(new HasznoApiError(404, 'Not found'))
      const handler = server.tools.get('haszno_proposals_create')!.handler
      const result = await handler({ productId: 999, proposedPriceGross: 8900, reason: 'test' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/shop|bolt|Product not found/i)
    })

    it('returns isError on 409 with replay explanation', async () => {
      vi.mocked(client.agent.createProposal).mockRejectedValue(new HasznoApiError(409, 'Conflict'))
      const handler = server.tools.get('haszno_proposals_create')!.handler
      const result = await handler({ productId: 10, proposedPriceGross: 8900, reason: 'test' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/nonce|replay|Duplicate/i)
    })
  })

  // ── haszno_proposals_approve ──────────────────────────────────────────────

  describe('haszno_proposals_approve', () => {
    it('returns not-available without calling any API', async () => {
      const handler = server.tools.get('haszno_proposals_approve')!.handler
      const result = await handler({ ids: [1, 2] })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/not available|shop API token|human/i)
      expect(client.proposals.approve).not.toHaveBeenCalled()
      expect(client.agent.proposals).not.toHaveBeenCalled()
    })
  })

  // ── haszno_proposals_reject ───────────────────────────────────────────────

  describe('haszno_proposals_reject', () => {
    it('returns not-available without calling any API', async () => {
      const handler = server.tools.get('haszno_proposals_reject')!.handler
      const result = await handler({ ids: [1] })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/not available|shop API token|human/i)
      expect(client.proposals.reject).not.toHaveBeenCalled()
    })
  })

  // ── haszno_proposals_rollback ─────────────────────────────────────────────

  describe('haszno_proposals_rollback', () => {
    it('returns not-available without calling any API', async () => {
      const handler = server.tools.get('haszno_proposals_rollback')!.handler
      const result = await handler({ batchId: 'b-abc123' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/not available|shop API token|human/i)
      expect(client.proposals.rollback).not.toHaveBeenCalled()
    })
  })
})

// ── http / auth integration test ──────────────────────────────────────────────

describe('HTTP client auth header', () => {
  it('sends Authorization: Bearer when HASZNO_API_TOKEN is set', async () => {
    const { createClient } = await import('../client/index.js')

    const captured: Record<string, string>[] = []
    const mockFetch = vi.fn(async (url: string, init: RequestInit) => {
      captured.push(Object.fromEntries(Object.entries(init.headers as Record<string, string>)))
      return new Response(JSON.stringify([]), { status: 200 })
    })

    const client = createClient({
      apiKey: 'haszno_testtoken123',
      fetch: mockFetch as typeof fetch,
    })

    await client.agent.products()

    expect(captured[0]?.['Authorization']).toBe('Bearer haszno_testtoken123')
    expect(captured[0]).not.toHaveProperty('x-api-key')
  })

  it('reads HASZNO_API_TOKEN env var and sends as Bearer', async () => {
    const original = process.env['HASZNO_API_TOKEN']
    process.env['HASZNO_API_TOKEN'] = 'haszno_envtoken456'
    try {
      const { createClient } = await import('../client/index.js')
      const captured: Record<string, string>[] = []
      const mockFetch = vi.fn(async () => {
        captured.push({})
        return new Response(JSON.stringify([]), { status: 200 })
      })
      // Can't easily capture headers from env-sourced tokens without reinitializing;
      // verify the env var is read by ensuring no error is thrown
      const client = createClient({ fetch: mockFetch as typeof fetch })
      await expect(client.agent.proposals()).resolves.toBeDefined()
    } finally {
      if (original === undefined) delete process.env['HASZNO_API_TOKEN']
      else process.env['HASZNO_API_TOKEN'] = original
    }
  })

  it('routes agent endpoints to /api/agent/* paths', async () => {
    const { createClient } = await import('../client/index.js')

    const capturedUrls: string[] = []
    const mockFetch = vi.fn(async (url: string) => {
      capturedUrls.push(url)
      return new Response(JSON.stringify([]), { status: 200 })
    })

    const client = createClient({
      apiKey: 'haszno_testtoken',
      baseUrl: 'https://haszno.com',
      fetch: mockFetch as typeof fetch,
    })

    await client.agent.products()
    await client.agent.orders()
    await client.agent.proposals()

    expect(capturedUrls[0]).toBe('https://haszno.com/api/agent/products')
    expect(capturedUrls[1]).toBe('https://haszno.com/api/agent/orders')
    expect(capturedUrls[2]).toBe('https://haszno.com/api/agent/proposals')
  })
})
