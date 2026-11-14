/**
 * MCP tools — Termékek (own shop products).
 *
 * Domain: products
 * Endpoints used (credential-dependent routing):
 *   GET    /api/agent/products              — shop API token (haszno_)
 *   GET    /api/products[?all=1]            — legacy key / Basic
 *   PATCH  /api/products/:id               — legacy key / Basic only
 *   POST   /api/products/:id/listing       — legacy key / Basic only
 *   POST   /api/products/apply-prices      — legacy key / Basic only
 *   POST   /api/products/:id/ai-description — legacy key / Basic only
 *
 * With a shop API token (haszno_), only haszno_products_list is available;
 * the other tools will surface a ShopTokenNotSupportedError with a clear message.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { HasznoClient } from '../client/index.js'
import { HasznoApiError, ShopTokenNotSupportedError } from '../client/index.js'

// ── helpers ────────────────────────────────────────────────────────────────────

function json(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

function mkErr(message: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

function handleErr(e: unknown, action: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  if (e instanceof ShopTokenNotSupportedError) {
    return mkErr(e.message)
  }
  if (e instanceof HasznoApiError) {
    const extra = e.code ? ` [code: ${e.code}]` : ''
    const reqId = e.requestId ? ` requestId: ${e.requestId}` : ''
    const hint =
      e.status === 401 ? ' — token érvénytelen, lejárt vagy visszavont' :
      e.status === 403 ? ' — nincs jogosultság (read-scope tokennél vagy hiányzó write jog)' :
      e.status === 404 ? ' — termék nem található' :
      e.status === 422 ? ' — érvénytelen adat' : ''
    return mkErr(`${action} [HTTP ${e.status}${extra}]: ${e.message}${hint}${reqId}`)
  }
  return mkErr(`${action}: ${String(e)}`)
}

// ── registration ──────────────────────────────────────────────────────────────

export function registerProductsTools(server: McpServer, client: HasznoClient): void {

  // ── haszno_products_list ──────────────────────────────────────────────────
  server.registerTool(
    'haszno_products_list',
    {
      title: 'List shop products',
      description:
        'Returns products in the shop catalogue with current price, margin and stock.\n\n' +
        '**Shop API token (haszno_)**: calls GET /api/v1/agent/products — returns all products ' +
        'scoped to this shop only, with fields: id, sku, name, listed, priceGross, stock, ' +
        'supplierName, current (marginNet, marginPct), recommended (priceGross, floorGross). ' +
        'The recommended.floorGross is the absolute price floor the agent must never go below. ' +
        'No pagination — all products are returned in one response.\n\n' +
        '**Legacy key / Basic**: calls GET /api/products (supports all=true to include unlisted products). ' +
        'Returns additional fields: costNet, marketMinGross, marketShop, trendKeyword.\n\n' +
        'All prices are gross HUF integers. Margins are net-on-net percentages.',
      inputSchema: {
        all: z.boolean().optional().describe(
          'Legacy mode only: when true, includes unlisted products. ' +
          'Ignored in shop-API-token mode.',
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ all }) => {
      try {
        const products = await client.products.list(all ? { all: true } : undefined)
        return json({ products, count: (products as unknown[]).length })
      } catch (e) {
        return handleErr(e, 'haszno_products_list')
      }
    },
  )

  // ── haszno_products_update ────────────────────────────────────────────────
  server.registerTool(
    'haszno_products_update',
    {
      title: 'Update product market data',
      description:
        'Updates a product\'s manually-recorded market price and/or gross price.\n\n' +
        '**Requires legacy key or Basic auth** — not available with a shop API token (haszno_). ' +
        'Shop-API-token users will receive an explanatory error; use the Haszno web app for price adjustments ' +
        'or submit a price proposal via haszno_proposals_propose instead.\n\n' +
        'PATCH /api/products/:id — fields: marketMinGross, marketShop (the cheapest known competitor), ' +
        'and/or priceGross (direct price override, bypasses the pricing engine).\n\n' +
        'Requires confirm: true.',
      inputSchema: {
        id: z.number().int().positive().describe('Product ID.'),
        marketMinGross: z.number().int().positive().optional().describe(
          'Cheapest competitor price in gross HUF (integer). Set to null to clear.',
        ).nullable(),
        marketShop: z.string().max(120).optional().nullable().describe(
          'Name of the cheapest competitor shop. Set to null to clear.',
        ),
        priceGross: z.number().int().positive().optional().describe(
          'Direct gross price override in HUF (integer). Use with care — overrides the pricing engine.',
        ),
        confirm: z.literal(true).describe('Must be exactly true (safety gate).'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ id, marketMinGross, marketShop, priceGross }) => {
      try {
        const updated = await client.products.update(id, {
          ...(marketMinGross !== undefined ? { marketMinGross } : {}),
          ...(marketShop !== undefined ? { marketShop } : {}),
          ...(priceGross !== undefined ? { priceGross } : {}),
        })
        return json(updated)
      } catch (e) {
        return handleErr(e, 'haszno_products_update')
      }
    },
  )

  // ── haszno_products_set_listing ────────────────────────────────────────────
  server.registerTool(
    'haszno_products_set_listing',
    {
      title: 'List or unlist a product',
      description:
        'Sets whether a product is listed (visible in the webshop) or unlisted (hidden).\n\n' +
        '**Requires legacy key or Basic auth** — not available with a shop API token (haszno_). ' +
        'Shop-API-token users will receive an explanatory error.\n\n' +
        'POST /api/products/:id/listing — body: { listed: boolean }.\n\n' +
        'Requires confirm: true.',
      inputSchema: {
        id: z.number().int().positive().describe('Product ID.'),
        listed: z.boolean().describe('true = visible in the webshop; false = hidden.'),
        confirm: z.literal(true).describe('Must be exactly true (safety gate).'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ id, listed }) => {
      try {
        const updated = await client.products.setListing(id, { listed })
        return json(updated)
      } catch (e) {
        return handleErr(e, 'haszno_products_set_listing')
      }
    },
  )

  // ── haszno_products_apply_prices ──────────────────────────────────────────
  server.registerTool(
    'haszno_products_apply_prices',
    {
      title: 'Apply recommended prices',
      description:
        'Applies the AI-recommended prices to products immediately (no proposal required).\n\n' +
        '**Requires legacy key or Basic auth** — not available with a shop API token (haszno_). ' +
        'Shop-API-token users receive an explanatory error; use haszno_proposals_propose instead.\n\n' +
        'POST /api/products/apply-prices — if ids is omitted, applies to ALL products. ' +
        'Returns { changed, total }.\n\n' +
        'Requires confirm: true.',
      inputSchema: {
        ids: z.array(z.number().int().positive()).optional().describe(
          'Product IDs to reprice. Omit to reprice ALL products.',
        ),
        confirm: z.literal(true).describe('Must be exactly true (safety gate).'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ ids }) => {
      try {
        const result = await client.products.applyPrices(ids ? { ids } : undefined)
        return json(result)
      } catch (e) {
        return handleErr(e, 'haszno_products_apply_prices')
      }
    },
  )

  // ── haszno_products_ai_description ───────────────────────────────────────
  server.registerTool(
    'haszno_products_ai_description',
    {
      title: 'Generate AI product description',
      description:
        'Generates an AI-written product description for a given product and returns the text.\n\n' +
        '**Requires legacy key or Basic auth** — not available with a shop API token (haszno_).\n\n' +
        'POST /api/products/:id/ai-description — returns { text: string }. ' +
        'The text is a suggestion only; it is not automatically saved to the product.',
      inputSchema: {
        id: z.number().int().positive().describe('Product ID.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ id }) => {
      try {
        const result = await client.products.generateAiDescription(id)
        return json(result)
      } catch (e) {
        return handleErr(e, 'haszno_products_ai_description')
      }
    },
  )
}
