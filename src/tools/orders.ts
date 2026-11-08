/**
 * MCP tools — Rendelések (orders).
 *
 * Domain: orders
 * Endpoints:
 *   GET  /api/orders               — list all orders with items (up to 50, newest-first)
 *   POST /api/webhooks/order       — inject a new order into the forwarding pipeline
 *   POST /api/orders/:id/ship      — mark an order as shipped
 *   POST /api/demo/order           — create a random demo order (demo environments only)
 *
 * Money: `totalGross` and `priceGross` are whole forints (HUF), gross (VAT-inclusive).
 * Status transitions: received → forwarded → shipped (or error on forwarding failure).
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { HasznoClient, Order } from '../client/index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compact order row: omits the event log and items for quick overview. */
function compactOrder(o: Order) {
  return {
    id: o.id,
    externalId: o.externalId,
    customerName: o.customerName,
    address: o.address,
    status: o.status,
    totalGross: o.totalGross,
    supplierOrderId: o.supplierOrderId,
    trackingNumber: o.trackingNumber,
    itemCount: o.items.length,
    createdAt: o.createdAt,
  }
}

/** Returns true when the base URL looks like a demo/staging environment. */
function isDemoEnv(): boolean {
  const url = process.env['HASZNO_API_URL'] ?? process.env['ARFUTAR_API_URL'] ?? 'https://demo.haszno.hu'
  return url.includes('demo') || url.includes('staging') || url.includes('localhost')
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerOrdersTools(server: McpServer, client: HasznoClient): void {
  // ---- haszno_orders_list -------------------------------------------------

  server.registerTool(
    'haszno_orders_list',
    {
      title: 'List orders',
      description:
        'List orders from the Haszno fulfilment pipeline, optionally filtered by status. ' +
        'Returns compact rows (no event log) sorted newest-first. ' +
        'Use to monitor the pipeline, find orders awaiting action, or audit history. ' +
        'Status values: received (new, not yet forwarded), forwarded (sent to supplier), ' +
        'shipped (tracking confirmed), error (forwarding failed). ' +
        'Money fields are whole forints (HUF), gross (VAT-inclusive).',
      inputSchema: {
        status: z
          .enum(['received', 'forwarded', 'shipped', 'error'])
          .optional()
          .describe('Filter by order status. Omit to return all statuses.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(25)
          .optional()
          .describe('Maximum rows to return (1–50, default 25).'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ status, limit = 25 }) => {
      const all = await client.orders.list()
      const filtered = status ? all.filter((o) => o.status === status) : all
      const page = filtered.slice(0, limit)
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              orders: page.map(compactOrder),
              total: filtered.length,
              showing: page.length,
            }),
          },
        ],
      }
    },
  )

  // ---- haszno_orders_get --------------------------------------------------

  server.registerTool(
    'haszno_orders_get',
    {
      title: 'Get order details',
      description:
        'Retrieve a single order with full details: items (SKU, qty, unit price in HUF gross), ' +
        'event log (timeline of status changes with timestamps), supplier order ID, and tracking number. ' +
        'Use after haszno_orders_list to drill into a specific order.',
      inputSchema: {
        id: z.number().int().positive().describe('Haszno order ID (integer).'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const all = await client.orders.list()
      const order = all.find((o) => o.id === id)
      if (!order) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: `Order #${id} not found.` }),
            },
          ],
          isError: true,
        }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(order) }],
      }
    },
  )

  // ---- haszno_orders_ship -------------------------------------------------

  server.registerTool(
    'haszno_orders_ship',
    {
      title: 'Mark order as shipped',
      description:
        'Mark an order as shipped (sets status to "shipped" and records a tracking event). ' +
        'Idempotent — safe to call again if already shipped. ' +
        'Only use this for orders in "forwarded" state; calling it on "received" or "error" orders ' +
        'may produce unexpected results. ' +
        'Returns the updated order object including tracking number if set by the supplier. ' +
        'Requires confirm: true to prevent accidental execution.',
      inputSchema: {
        id: z.number().int().positive().describe('ID of the order to mark as shipped.'),
        confirm: z
          .literal(true)
          .describe('Must be true. Prevents accidental execution of this write operation.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ id, confirm: _confirm }) => {
      const updated = await client.orders.ship(id)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(updated) }],
      }
    },
  )

  // ---- haszno_orders_receive ----------------------------------------------

  server.registerTool(
    'haszno_orders_receive',
    {
      title: 'Receive / inject a new order',
      description:
        'Inject a new order into the Haszno forwarding pipeline via the shop webhook. ' +
        'The system will attempt to forward it to the connected supplier automatically ' +
        '(email or simulated, depending on supplier configuration). ' +
        'Use this only when integrating a shop checkout flow or testing end-to-end order handling. ' +
        'Each item SKU must already exist in the Haszno product catalogue; unknown SKUs return an error. ' +
        'Returns the new order ID on success. ' +
        'Requires confirm: true to prevent accidental writes.',
      inputSchema: {
        externalId: z
          .string()
          .min(1)
          .max(64)
          .describe(
            "The shop's own order reference (e.g. \"WEB-00123\"). Must be unique within the shop.",
          ),
        customerName: z.string().min(1).max(120).describe('Full name of the end customer.'),
        address: z
          .string()
          .min(1)
          .max(300)
          .describe(
            'Delivery address as a single string (e.g. "9200 Mosonmagyaróvár, Fő u. 1.").',
          ),
        items: z
          .array(
            z.object({
              sku: z.string().min(1).describe('Supplier SKU of the product.'),
              qty: z.number().int().positive().describe('Quantity ordered (positive integer).'),
            }),
          )
          .min(1)
          .describe('Order line items. At least one item required.'),
        confirm: z
          .literal(true)
          .describe('Must be true. Prevents accidental execution of this write operation.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ externalId, customerName, address, items, confirm: _confirm }) => {
      const result = await client.orders.receiveOrder({ externalId, customerName, address, items })
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      }
    },
  )

  // ---- haszno_orders_create_demo ------------------------------------------

  server.registerTool(
    'haszno_orders_create_demo',
    {
      title: 'Create demo order (demo environment only)',
      description:
        'Create a randomly-generated demo order using in-stock products. ' +
        'ONLY call this against a demo or staging environment ' +
        '(HASZNO_API_URL must contain "demo", "staging", or "localhost"). ' +
        'Calling against a production shop will be blocked by this tool. ' +
        'Useful for end-to-end testing of the forwarding pipeline without manual order construction. ' +
        'Requires confirm: true.',
      inputSchema: {
        confirm: z
          .literal(true)
          .describe('Must be true. Prevents accidental execution of this write operation.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ confirm: _confirm }) => {
      if (!isDemoEnv()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error:
                  'haszno_orders_create_demo is only allowed in demo/staging environments. ' +
                  'Set HASZNO_API_URL to a demo or localhost URL to use this tool.',
              }),
            },
          ],
          isError: true,
        }
      }
      const result = await client.orders.createDemo()
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      }
    },
  )
}
