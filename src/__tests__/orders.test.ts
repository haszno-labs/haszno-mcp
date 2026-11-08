/**
 * Unit tests for packages/mcp/src/tools/orders.ts
 *
 * McpServer is mocked — no stdio transport, no network, no real MCP protocol.
 * Client methods are vi.fn() stubs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerOrdersTools } from '../tools/orders.js'
import type { HasznoClient, Order, OrderItem, OrderEvent } from '../client/index.js'

// ---------------------------------------------------------------------------
// Mock McpServer
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
  cb: (args: any) => Promise<unknown>
}

function createMockServer() {
  const tools = new Map<string, ToolEntry>()
  const server = {
    registerTool(
      name: string,
      config: ToolEntry['config'],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cb: (args: any) => Promise<unknown>,
    ) {
      tools.set(name, { config, cb })
    },
  }
  return { server: server as never, tools }
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const ITEM: OrderItem = { orderId: 1, qty: 2, priceGross: 5990, name: 'Test termék', sku: 'SKU-001' }
const EVENT: OrderEvent = { at: '2024-01-15T10:00:00Z', text: 'Rendelés rögzítve' }

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 1,
    externalId: 'WEB-001',
    customerName: 'Kovács Anna',
    address: '9200 Mosonmagyaróvár, Fő u. 1.',
    status: 'received',
    supplierOrderId: null,
    trackingNumber: null,
    totalGross: 11980,
    events: [EVENT],
    createdAt: '2024-01-15T10:00:00Z',
    items: [ITEM],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Mock HasznoClient (orders domain only)
// ---------------------------------------------------------------------------

function createMockClient() {
  const c = {
    orders: {
      list: vi.fn().mockResolvedValue([] as Order[]),
      ship: vi.fn().mockResolvedValue(undefined as unknown as Order),
      receiveOrder: vi.fn().mockResolvedValue({ id: 0 } as { id: number }),
      createDemo: vi.fn().mockResolvedValue({ id: 0 } as { id: number }),
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
  const result = await tool.cb(args)
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

    it('returns compact list of all orders when no filter', async () => {
      const orders = [makeOrder({ id: 1 }), makeOrder({ id: 2, status: 'shipped' })]
      client.orders.list.mockResolvedValue(orders)

      const { text } = await call(tools, 'haszno_orders_list', {})
      const data = JSON.parse(text)

      expect(data.total).toBe(2)
      expect(data.showing).toBe(2)
      expect(data.orders[0]).toMatchObject({ id: 1, status: 'received', itemCount: 1 })
      // compact rows must NOT include events
      expect(data.orders[0]).not.toHaveProperty('events')
    })

    it('filters by status', async () => {
      const orders = [
        makeOrder({ id: 1, status: 'received' }),
        makeOrder({ id: 2, status: 'shipped' }),
        makeOrder({ id: 3, status: 'shipped' }),
      ]
      client.orders.list.mockResolvedValue(orders)

      const { text } = await call(tools, 'haszno_orders_list', { status: 'shipped' })
      const data = JSON.parse(text)

      expect(data.total).toBe(2)
      expect(data.orders.every((o: { status: string }) => o.status === 'shipped')).toBe(true)
    })

    it('respects explicit limit', async () => {
      const orders = Array.from({ length: 10 }, (_, i) => makeOrder({ id: i + 1 }))
      client.orders.list.mockResolvedValue(orders)

      const { text } = await call(tools, 'haszno_orders_list', { limit: 3 })
      const data = JSON.parse(text)

      expect(data.showing).toBe(3)
      expect(data.total).toBe(10)
    })

    it('defaults limit to 25', async () => {
      const orders = Array.from({ length: 30 }, (_, i) => makeOrder({ id: i + 1 }))
      client.orders.list.mockResolvedValue(orders)

      const { text } = await call(tools, 'haszno_orders_list', {})
      const data = JSON.parse(text)

      expect(data.showing).toBe(25)
    })
  })

  // ---- haszno_orders_get -------------------------------------------------

  describe('haszno_orders_get', () => {
    it('has readOnlyHint: true', () => {
      expect(tools.get('haszno_orders_get')?.config.annotations?.readOnlyHint).toBe(true)
    })

    it('returns full order including events and items when found', async () => {
      const order = makeOrder({ id: 42, trackingNumber: 'GLS-123456' })
      client.orders.list.mockResolvedValue([order])

      const { text, isError } = await call(tools, 'haszno_orders_get', { id: 42 })
      const data = JSON.parse(text)

      expect(isError).toBeUndefined()
      expect(data.id).toBe(42)
      expect(data.trackingNumber).toBe('GLS-123456')
      expect(data.events).toHaveLength(1)
      expect(data.items).toHaveLength(1)
    })

    it('returns error when order not found', async () => {
      client.orders.list.mockResolvedValue([makeOrder({ id: 1 })])

      const { text, isError } = await call(tools, 'haszno_orders_get', { id: 999 })
      const data = JSON.parse(text)

      expect(isError).toBe(true)
      expect(data.error).toMatch(/999/)
    })
  })

  // ---- haszno_orders_ship ------------------------------------------------

  describe('haszno_orders_ship', () => {
    it('has idempotentHint: true and readOnlyHint: false', () => {
      const annotations = tools.get('haszno_orders_ship')?.config.annotations
      expect(annotations?.idempotentHint).toBe(true)
      expect(annotations?.readOnlyHint).toBe(false)
    })

    it('calls client.orders.ship with the given id', async () => {
      const shipped = makeOrder({ id: 7, status: 'shipped', trackingNumber: 'GLS-999' })
      client.orders.ship.mockResolvedValue(shipped)

      const { text } = await call(tools, 'haszno_orders_ship', { id: 7, confirm: true })
      expect(client.orders.ship).toHaveBeenCalledWith(7)

      const data = JSON.parse(text)
      expect(data.status).toBe('shipped')
      expect(data.trackingNumber).toBe('GLS-999')
    })
  })

  // ---- haszno_orders_receive ---------------------------------------------

  describe('haszno_orders_receive', () => {
    it('has readOnlyHint: false', () => {
      expect(tools.get('haszno_orders_receive')?.config.annotations?.readOnlyHint).toBe(false)
    })

    it('calls receiveOrder with correct arguments and returns new id', async () => {
      client.orders.receiveOrder.mockResolvedValue({ id: 55 })

      const args = {
        externalId: 'WEB-055',
        customerName: 'Nagy Péter',
        address: '1011 Budapest, Fő u. 1.',
        items: [{ sku: 'SKU-001', qty: 1 }],
        confirm: true as const,
      }
      const { text } = await call(tools, 'haszno_orders_receive', args)

      expect(client.orders.receiveOrder).toHaveBeenCalledWith({
        externalId: 'WEB-055',
        customerName: 'Nagy Péter',
        address: '1011 Budapest, Fő u. 1.',
        items: [{ sku: 'SKU-001', qty: 1 }],
      })
      const data = JSON.parse(text)
      expect(data.id).toBe(55)
    })
  })

  // ---- haszno_orders_create_demo -----------------------------------------

  describe('haszno_orders_create_demo', () => {
    const origEnv = process.env.HASZNO_API_URL

    afterEach(() => {
      if (origEnv === undefined) {
        delete process.env.HASZNO_API_URL
      } else {
        process.env.HASZNO_API_URL = origEnv
      }
    })

    it('has readOnlyHint: false', () => {
      expect(tools.get('haszno_orders_create_demo')?.config.annotations?.readOnlyHint).toBe(false)
    })

    it('calls createDemo and returns id when in demo env (URL contains "demo")', async () => {
      process.env.HASZNO_API_URL = 'https://demo.haszno.hu'
      client.orders.createDemo.mockResolvedValue({ id: 99 })

      const { text, isError } = await call(tools, 'haszno_orders_create_demo', { confirm: true })
      expect(isError).toBeUndefined()
      const data = JSON.parse(text)
      expect(data.id).toBe(99)
      expect(client.orders.createDemo).toHaveBeenCalledOnce()
    })

    it('calls createDemo when URL contains "localhost"', async () => {
      process.env.HASZNO_API_URL = 'http://localhost:9000'
      client.orders.createDemo.mockResolvedValue({ id: 1 })

      const { isError } = await call(tools, 'haszno_orders_create_demo', { confirm: true })
      expect(isError).toBeUndefined()
    })

    it('blocks and returns error when URL is production (no demo/staging/localhost)', async () => {
      process.env.HASZNO_API_URL = 'https://myshop.haszno.hu'

      const { text, isError } = await call(tools, 'haszno_orders_create_demo', { confirm: true })
      expect(isError).toBe(true)
      const data = JSON.parse(text)
      expect(data.error).toMatch(/demo/)
      expect(client.orders.createDemo).not.toHaveBeenCalled()
    })
  })
})
