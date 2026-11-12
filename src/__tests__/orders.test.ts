/**
 * Unit tests for packages/mcp/src/tools/orders.ts
 *
 * McpServer is mocked — no stdio transport, no network, no real MCP protocol.
 * Client methods are vi.fn() stubs.
 *
 * Changes from pre-bearer version:
 *  - server.tool() (5 args) replaces server.registerTool() (3 args)
 *  - haszno_orders_list and haszno_orders_get call client.agent.orders()
 *  - haszno_orders_ship, haszno_orders_receive, haszno_orders_create_demo
 *    return NOT_AVAILABLE (isError) without calling any client method
 *  - AgentOrder shape: no address, supplierOrderId, trackingNumber, events
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerOrdersTools } from '../tools/orders.js'
import type { HasznoClient, AgentOrder } from '../client/index.js'

// ---------------------------------------------------------------------------
// Mock McpServer — supports server.tool() (5-arg: name, desc, schema, annots, handler)
// ---------------------------------------------------------------------------

type ToolEntry = {
  config: {
    title?: string
    description?: string
    annotations?: {
      readOnlyHint?: boolean
      destructiveHint?: boolean
      idempotentHint?: boolean
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => Promise<unknown>
}

function createMockServer() {
  const tools = new Map<string, ToolEntry>()
  const server = {
    // server.tool(name, description, inputSchema, annotations, handler)
    tool(
      name: string,
      _description: string,
      _inputSchema: unknown,
      annotations: ToolEntry['config']['annotations'],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler: (args: any) => Promise<unknown>,
    ) {
      tools.set(name, { config: { annotations }, handler })
    },
    // keep registerTool for any legacy tools that still use it
    registerTool(
      name: string,
      config: ToolEntry['config'],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler: (args: any) => Promise<unknown>,
    ) {
      tools.set(name, { config, handler })
    },
  }
  return { server: server as never, tools }
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeAgentOrder(overrides: Partial<AgentOrder> = {}): AgentOrder {
  return {
    id: 1,
    externalId: 'WEB-001',
    customerName: 'Kovács Anna',
    status: 'received',
    totalGross: 11980,
    createdAt: '2024-01-15T10:00:00Z',
    items: [{ orderId: 1, qty: 2, priceGross: 5990, name: 'Test termék', sku: 'SKU-001' }],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Mock HasznoClient — only the agent.orders branch needed
// ---------------------------------------------------------------------------

function createMockClient() {
  const c = {
    agent: {
      orders: vi.fn().mockResolvedValue([] as AgentOrder[]),
      products: vi.fn().mockResolvedValue([]),
      proposals: vi.fn().mockResolvedValue([]),
      createProposal: vi.fn(),
    },
    orders: {
      list: vi.fn(),
      ship: vi.fn(),
      receiveOrder: vi.fn(),
      createDemo: vi.fn(),
    },
  }
  return c as unknown as HasznoClient & typeof c
}

// ---------------------------------------------------------------------------
// Helper: call a registered tool and parse its first text content
// ---------------------------------------------------------------------------

async function call(
  tools: Map<string, ToolEntry>,
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any>,
): Promise<{ text: string; isError?: boolean }> {
  const tool = tools.get(name)
  if (!tool) throw new Error(`Tool "${name}" was not registered`)
  const result = await tool.handler(args)
  const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean }
  return { text: r.content[0]?.text ?? '', isError: r.isError }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registerOrdersTools()', () => {
  let tools: Map<string, ToolEntry>
  let client: ReturnType<typeof createMockClient>

  beforeEach(() => {
    const { server, tools: t } = createMockServer()
    tools = t
    client = createMockClient()
    registerOrdersTools(server, client)
  })

  it('registers all five expected tools', () => {
    expect([...tools.keys()].sort()).toEqual(
      [
        'haszno_orders_list',
        'haszno_orders_get',
        'haszno_orders_ship',
        'haszno_orders_receive',
        'haszno_orders_create_demo',
      ].sort(),
    )
  })

  // ---- haszno_orders_list ------------------------------------------------

  describe('haszno_orders_list', () => {
    it('has readOnlyHint: true', () => {
      expect(tools.get('haszno_orders_list')?.config.annotations?.readOnlyHint).toBe(true)
    })

    it('calls client.agent.orders() — not client.orders.list()', async () => {
      client.agent.orders.mockResolvedValue([makeAgentOrder({ id: 1 }), makeAgentOrder({ id: 2, status: 'shipped' })])
      await call(tools, 'haszno_orders_list', {})
      expect(client.agent.orders).toHaveBeenCalledOnce()
      expect(client.orders.list).not.toHaveBeenCalled()
    })

    it('returns compact list of all orders when no filter', async () => {
      const orders = [makeAgentOrder({ id: 1 }), makeAgentOrder({ id: 2, status: 'shipped' })]
      client.agent.orders.mockResolvedValue(orders)

      const { text } = await call(tools, 'haszno_orders_list', {})
      const data = JSON.parse(text)

      expect(data.total).toBe(2)
      expect(data.orders[0]).toMatchObject({ id: 1, status: 'received', itemCount: 1 })
      // compact rows must NOT include items array directly
      expect(data.orders[0]).not.toHaveProperty('events')
    })

    it('filters by status', async () => {
      const orders = [
        makeAgentOrder({ id: 1, status: 'received' }),
        makeAgentOrder({ id: 2, status: 'shipped' }),
        makeAgentOrder({ id: 3, status: 'shipped' }),
      ]
      client.agent.orders.mockResolvedValue(orders)

      const { text } = await call(tools, 'haszno_orders_list', { status: 'shipped' })
      const data = JSON.parse(text)

      expect(data.total).toBe(2)
      expect(data.orders.every((o: { status: string }) => o.status === 'shipped')).toBe(true)
    })
  })

  // ---- haszno_orders_get -------------------------------------------------

  describe('haszno_orders_get', () => {
    it('has readOnlyHint: true', () => {
      expect(tools.get('haszno_orders_get')?.config.annotations?.readOnlyHint).toBe(true)
    })

    it('calls client.agent.orders() — not client.orders.list()', async () => {
      client.agent.orders.mockResolvedValue([makeAgentOrder({ id: 42 })])
      await call(tools, 'haszno_orders_get', { id: 42 })
      expect(client.agent.orders).toHaveBeenCalledOnce()
      expect(client.orders.list).not.toHaveBeenCalled()
    })

    it('returns order with items when found', async () => {
      const order = makeAgentOrder({ id: 42 })
      client.agent.orders.mockResolvedValue([order])

      const { text, isError } = await call(tools, 'haszno_orders_get', { id: 42 })
      const data = JSON.parse(text)

      expect(isError).toBeUndefined()
      expect(data.id).toBe(42)
      expect(data.items).toHaveLength(1)
      // shop token does not return address, trackingNumber, events
      expect(data).not.toHaveProperty('trackingNumber')
      expect(data).not.toHaveProperty('address')
      expect(data).not.toHaveProperty('events')
    })

    it('returns error when order not found', async () => {
      client.agent.orders.mockResolvedValue([makeAgentOrder({ id: 1 })])

      const { text, isError } = await call(tools, 'haszno_orders_get', { id: 999 })

      expect(isError).toBe(true)
      expect(text).toMatch(/999/)
    })
  })

  // ---- haszno_orders_ship — NOT AVAILABLE with shop token ----------------

  describe('haszno_orders_ship', () => {
    it('has readOnlyHint: false', () => {
      const annotations = tools.get('haszno_orders_ship')?.config.annotations
      expect(annotations?.readOnlyHint).toBe(false)
    })

    it('returns not-available isError without calling any client method', async () => {
      const { text, isError } = await call(tools, 'haszno_orders_ship', { id: 7 })
      expect(isError).toBe(true)
      expect(text).toMatch(/shop API token|session token/i)
      expect(client.orders.ship).not.toHaveBeenCalled()
      expect(client.agent.orders).not.toHaveBeenCalled()
    })
  })

  // ---- haszno_orders_receive — NOT AVAILABLE with shop token -------------

  describe('haszno_orders_receive', () => {
    it('has readOnlyHint: false', () => {
      expect(tools.get('haszno_orders_receive')?.config.annotations?.readOnlyHint).toBe(false)
    })

    it('returns not-available isError without calling any client method', async () => {
      const args = {
        externalId: 'WEB-055',
        customerName: 'Nagy Péter',
        address: '1011 Budapest, Fő u. 1.',
        items: [{ sku: 'SKU-001', qty: 1 }],
      }
      const { text, isError } = await call(tools, 'haszno_orders_receive', args)
      expect(isError).toBe(true)
      expect(text).toMatch(/shop API token|session token/i)
      expect(client.orders.receiveOrder).not.toHaveBeenCalled()
    })
  })

  // ---- haszno_orders_create_demo — NOT AVAILABLE with shop token ---------

  describe('haszno_orders_create_demo', () => {
    it('has readOnlyHint: false', () => {
      expect(tools.get('haszno_orders_create_demo')?.config.annotations?.readOnlyHint).toBe(false)
    })

    it('returns not-available isError without calling any client method', async () => {
      const { text, isError } = await call(tools, 'haszno_orders_create_demo', {})
      expect(isError).toBe(true)
      expect(text).toMatch(/shop API token|session token/i)
      expect(client.orders.createDemo).not.toHaveBeenCalled()
    })
  })
})
