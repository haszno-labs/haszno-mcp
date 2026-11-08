/**
 * MCP tools — Termékek (own shop products).
 *
 * Domain: products
 * Endpoints: GET /api/products, PATCH /api/products/:id,
 *            POST /api/products/:id/listing, POST /api/products/apply-prices,
 *            POST /api/products/:id/ai-description
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { HasznoClient } from '../client/index.js'

export function registerProductsTools(_server: McpServer, _client: HasznoClient): void {
  // TODO: implement in a parallel agent pass
  // Tools to register:
  //   haszno_products_list            — GET /api/products[?all=1]        (read-only)
  //   haszno_products_update          — PATCH /api/products/:id           (write, confirm required)
  //   haszno_products_set_listing     — POST /api/products/:id/listing    (write, confirm required)
  //   haszno_products_apply_prices    — POST /api/products/apply-prices   (write, confirm required)
  //   haszno_products_ai_description  — POST /api/products/:id/ai-description (write)
}
