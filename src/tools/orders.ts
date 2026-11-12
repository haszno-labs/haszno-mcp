/**
 * MCP tools — Rendelések (orders via agent endpoint).
 *
 * Uses GET /api/agent/orders which returns the last 20 orders (AgentOrder[]).
 * Fields available: id, externalId, customerName, status, totalGross, createdAt,
 *   items: [{orderId, qty, priceGross, name, sku}]
 *
 * Fields NOT available via shop token: address, supplierOrderId, trackingNumber,
 *   event log — excluded from the agent endpoint.
 *
 * Write operations (ship, receive, createDemo) are not available via shop API tokens —
 * the server returns 403. Each write tool returns a clear "not available with a shop API token"
 * message instead of an obscure HTTP 403.
 *
 * Money: `totalGross` and `priceGross` are whole forints (HUF), gross (VAT-inclusive).
 * Status transitions: received → forwarded → shipped (or error on forwarding failure).
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { HasznoClient, AgentOrder } from '../client/index.js'
import { HasznoApiError } from '../client/index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOT_AVAILABLE =
  'Not available with a shop API token. ' +
  'This operation requires a session token (web login). ' +
  'Use the Haszno web dashboard to perform this action.'

function ok(data: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

function apiErr(msg: string): { content: [{ type: 'text'; text: string }]; isError: true } {
  return { isError: true, content: [{ type: 'text' as const, text: msg }] }
}

/** Compact order row: omits items for quick overview. */
function compactOrder(o: AgentOrder) {
  return {
    id: o.id,
    externalId: o.externalId,
    customerName: o.customerName,
    status: o.status,
    totalGross: o.totalGross,
    itemCount: o.items.length,
    createdAt: o.createdAt,
  }
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerOrdersTools(server: McpServer, client: HasznoClient): void {
  // ── haszno_orders_list ────────────────────────────────────────────────────

  server.tool(
    'haszno_orders_list',
    `List the last 20 orders from your shop via the agent endpoint.

Returns compact rows sorted newest-first. Fields available: id, externalId,
customerName, status, totalGross, createdAt, itemCount.

Fields NOT available via shop tokens: address, supplierOrderId, trackingNumber,
event log — use the Haszno web dashboard to see those.

Status values: received (new, not yet forwarded), forwarded (sent to supplier),
shipped (tracking confirmed), error (forwarding failed).
Money fields are whole forints (HUF), gross (VAT-inclusive).`,
    {
      status: z
        .enum(['received', 'forwarded', 'shipped', 'error'])
        .optional()
        .describe('Filter by order status. Omit to return all statuses.'),
    },
    { readOnlyHint: true },
    async (args) => {
      let all: AgentOrder[]
      try {
        all = await client.agent.orders()
      } catch (e) {
        if (e instanceof HasznoApiError) {
          return apiErr(`API error fetching orders: ${e.message} (HTTP ${e.status})`)
        }
        return apiErr(`Unexpected error: ${String(e)}`)
      }
      const filtered = args.status ? all.filter((o) => o.status === args.status) : all
      return ok({
        orders: filtered.map(compactOrder),
        total: filtered.length,
      })
    },
  )

  // ── haszno_orders_get ─────────────────────────────────────────────────────

  server.tool(
    'haszno_orders_get',
    `Get one order with its line items.

Fetches the agent order list and returns the matching order including items
(name, SKU, qty, unit price in HUF gross).

Fields NOT available via shop tokens: address, supplierOrderId, trackingNumber,
event log — use the Haszno web dashboard for full order detail.`,
    {
      id: z.number().int().positive().describe('Haszno order ID.'),
    },
    { readOnlyHint: true },
    async (args) => {
      let all: AgentOrder[]
      try {
        all = await client.agent.orders()
      } catch (e) {
        if (e instanceof HasznoApiError) {
          return apiErr(`API error fetching orders: ${e.message} (HTTP ${e.status})`)
        }
        return apiErr(`Unexpected error: ${String(e)}`)
      }
      const order = all.find((o) => o.id === args.id)
      if (!order) {
        return apiErr(
          `Order #${args.id} not found in the last 20 orders. ` +
            'Use haszno_orders_list to see available orders.',
        )
      }
      return ok(order)
    },
  )

  // ── haszno_orders_ship ────────────────────────────────────────────────────

  server.tool(
    'haszno_orders_ship',
    'Mark an order as shipped. NOT AVAILABLE with a shop API token — requires a session token.',
    {
      id: z.number().int().positive().describe('Order ID.'),
    },
    { readOnlyHint: false },
    async (_args) => apiErr(NOT_AVAILABLE),
  )

  // ── haszno_orders_receive ─────────────────────────────────────────────────

  server.tool(
    'haszno_orders_receive',
    'Inject a new order into the forwarding pipeline. NOT AVAILABLE with a shop API token — requires a session token.',
    {
      externalId: z.string().describe('Shop order reference.'),
      customerName: z.string().describe('Customer name.'),
      address: z.string().describe('Delivery address.'),
      items: z.array(z.object({ sku: z.string(), qty: z.number().int().positive() })).min(1),
    },
    { readOnlyHint: false },
    async (_args) => apiErr(NOT_AVAILABLE),
  )

  // ── haszno_orders_create_demo ─────────────────────────────────────────────

  server.tool(
    'haszno_orders_create_demo',
    'Create a demo order. NOT AVAILABLE with a shop API token — requires a session token.',
    {},
    { readOnlyHint: false },
    async (_args) => apiErr(NOT_AVAILABLE),
  )
}
