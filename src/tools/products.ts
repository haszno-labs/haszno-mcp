/**
 * MCP tools — Termékek (own shop products via agent endpoint).
 *
 * Uses GET /api/agent/products which returns AgentProduct[].
 * Fields available: id, sku, name, listed, priceGross, stock, supplierName,
 *   current: {priceGross, marginNet, marginPct}, recommended: {priceGross, marginNet, marginPct}
 *
 * Fields NOT available via shop token: costNet, marketMinGross, marketShop,
 *   rrpGross, trendKeyword, updatedAt — these require a session token.
 *
 * Write operations (update, setListing, applyPrices, generateAiDescription)
 * are not available via shop API tokens — the server returns 403 for those
 * endpoints. Each write tool returns a clear "not available with a shop API token"
 * message instead of an obscure HTTP 403.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { HasznoClient, AgentProduct } from '../client/index.js'
import { HasznoApiError } from '../client/index.js'

// ── helpers ──────────────────────────────────────────────────────────────────

const NOT_AVAILABLE =
  'Not available with a shop API token. ' +
  'This operation requires a session token (web login). ' +
  'Use the Haszno web dashboard to perform this action.'

function ok(data: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

function err(msg: string): { content: [{ type: 'text'; text: string }]; isError: true } {
  return { isError: true, content: [{ type: 'text' as const, text: msg }] }
}

function fmtMargin(p: AgentProduct['current']): string {
  return `${p.marginPct.toFixed(1)}% (${p.marginNet} Ft net)`
}

// ── registration ─────────────────────────────────────────────────────────────

export function registerProductsTools(server: McpServer, client: HasznoClient): void {
  // ── haszno_products_list ──────────────────────────────────────────────────
  server.tool(
    'haszno_products_list',
    `List products in your Haszno shop with current and recommended pricing.

Returns AgentProduct rows — fields available: id, sku, name, listed, priceGross,
stock, supplierName, current (priceGross, marginNet, marginPct),
recommended (priceGross, marginNet, marginPct).

Fields intentionally not returned by shop tokens: costNet, marketMinGross,
marketShop, rrpGross — these are excluded from the agent endpoint.

Use the returned data to:
  • Monitor margin health (current.marginPct)
  • Spot products where recommended price differs from current price
  • Find unlisted products (listed: false)
  • Filter by supplier name

Money values are in whole forints (HUF), gross (VAT-inclusive).`,
    {
      listed: z
        .boolean()
        .optional()
        .describe('Filter by listing status. true = only listed, false = only unlisted. Omit for all.'),
      minMarginPct: z
        .number()
        .optional()
        .describe('Minimum current margin percentage (inclusive). Filter out products below this.'),
      supplierContains: z
        .string()
        .optional()
        .describe('Case-insensitive substring match on supplierName.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(100)
        .describe('Maximum rows to return (1–500, default 100).'),
    },
    { readOnlyHint: true },
    async (args) => {
      let products: AgentProduct[]
      try {
        products = await client.agent.products()
      } catch (e) {
        if (e instanceof HasznoApiError) {
          return err(`API error fetching products: ${e.message} (HTTP ${e.status})`)
        }
        return err(`Unexpected error: ${String(e)}`)
      }

      if (args.listed !== undefined) {
        products = products.filter((p) => p.listed === args.listed)
      }
      if (args.minMarginPct !== undefined) {
        products = products.filter((p) => p.current.marginPct >= (args.minMarginPct as number))
      }
      if (args.supplierContains) {
        const q = args.supplierContains.toLowerCase()
        products = products.filter((p) => p.supplierName.toLowerCase().includes(q))
      }

      const page = products.slice(0, args.limit)

      return ok({
        _meta: {
          total: products.length,
          showing: page.length,
        },
        products: page.map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          listed: p.listed,
          priceGross: p.priceGross,
          stock: p.stock,
          supplierName: p.supplierName,
          currentMargin: fmtMargin(p.current),
          recommendedPrice: p.recommended.priceGross,
          recommendedMargin: fmtMargin(p.recommended),
          priceDiff: p.recommended.priceGross - p.priceGross,
        })),
      })
    },
  )

  // ── haszno_products_update ────────────────────────────────────────────────
  server.tool(
    'haszno_products_update',
    'Update product market price data or listing price. ' +
      'NOT AVAILABLE with a shop API token — requires a session token.',
    {
      id: z.number().int().positive().describe('Product ID.'),
      marketMin: z.number().optional().describe('New market minimum gross price (HUF).'),
      price: z.number().optional().describe('New listing gross price (HUF).'),
    },
    { readOnlyHint: false },
    async (_args) => err(NOT_AVAILABLE),
  )

  // ── haszno_products_set_listing ───────────────────────────────────────────
  server.tool(
    'haszno_products_set_listing',
    'List or unlist a product. ' +
      'NOT AVAILABLE with a shop API token — requires a session token.',
    {
      id: z.number().int().positive().describe('Product ID.'),
      listed: z.boolean().describe('true = list the product, false = unlist.'),
    },
    { readOnlyHint: false },
    async (_args) => err(NOT_AVAILABLE),
  )

  // ── haszno_products_apply_prices ──────────────────────────────────────────
  server.tool(
    'haszno_products_apply_prices',
    'Apply AI-recommended prices to products. ' +
      'NOT AVAILABLE with a shop API token — requires a session token.',
    {
      ids: z.array(z.number().int().positive()).optional().describe('Product IDs to update. Omit for all.'),
    },
    { readOnlyHint: false },
    async (_args) => err(NOT_AVAILABLE),
  )

  // ── haszno_products_ai_description ────────────────────────────────────────
  server.tool(
    'haszno_products_ai_description',
    'Generate an AI product description. ' +
      'NOT AVAILABLE with a shop API token — requires a session token.',
    {
      id: z.number().int().positive().describe('Product ID.'),
    },
    { readOnlyHint: false },
    async (_args) => err(NOT_AVAILABLE),
  )
}
