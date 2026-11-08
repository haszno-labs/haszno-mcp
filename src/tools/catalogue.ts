/**
 * MCP tools — Katalógus böngésző (catalogue search + import list).
 *
 * Tools:
 *   haszno_catalogue_search   — search the partner product catalogue
 *   haszno_import_list_list   — list items in the import list
 *   haszno_import_list_add    — add products to the import list
 *   haszno_import_list_push   — push import-list items to a connected store
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { HasznoClient } from '../client/index.js'

export function registerCatalogueTools(server: McpServer, client: HasznoClient): void {
  // ---- haszno_catalogue_search -----------------------------------------------
  server.registerTool(
    'haszno_catalogue_search',
    {
      title: 'Search partner product catalogue',
      description:
        'Search the Haszno dropshipping partner product catalogue. ' +
        'Returns products with pricing, margin, and stock details. ' +
        'Filter by free-text (name/category), category key, partner/supplier id, ' +
        'margin %, price range, stock availability, country, or sort order. ' +
        'Returns: { items: CatalogueItem[], total, facets } — facets include partners, ' +
        'countries, categories, margin buckets for drill-down. ' +
        'Default page size is 24. Use inStock=true for available stock only. ' +
        'Use marginPct filter to surface only profitable products.',
      inputSchema: {
        q: z.string().optional().describe('Free-text search on product name or category'),
        cats: z.string().optional().describe('Comma-separated category keys, e.g. "elektronika,ruházat"'),
        partner: z.number().int().positive().optional().describe('Filter by supplier/partner id'),
        minMarginPct: z.number().optional().describe('Minimum margin % (e.g. 15 means 15%)'),
        maxPrice: z.number().optional().describe('Maximum RRP gross price in HUF'),
        minPrice: z.number().optional().describe('Minimum RRP gross price in HUF'),
        inStock: z.boolean().optional().describe('true = only products currently in stock'),
        hasImage: z.boolean().optional().describe('true = only products that have an image'),
        country: z.string().optional().describe('Supplier country code, e.g. "HU", "DE"'),
        sort: z
          .enum(['margin_desc', 'price_asc', 'price_desc', 'name_asc'])
          .optional()
          .describe('Sort order (default name_asc)'),
        page: z.number().int().min(1).optional().describe('Page number, 1-based (default 1)'),
        pageSize: z
          .number().int().min(1).max(100).optional()
          .describe('Items per page, max 100 (default 24)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const result = await client.catalogue.search({
        q: args.q,
        cats: args.cats,
        partner: args.partner,
        minMarginPct: args.minMarginPct,
        maxPrice: args.maxPrice,
        minPrice: args.minPrice,
        inStock: args.inStock,
        hasImage: args.hasImage,
        country: args.country,
        sort: args.sort,
        page: args.page,
        pageSize: args.pageSize,
      })
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    },
  )

  // ---- haszno_import_list_list -----------------------------------------------
  server.registerTool(
    'haszno_import_list_list',
    {
      title: 'List import list items',
      description:
        'Lists products the user has added to their Haszno import list. ' +
        'The import list is a staging area: products are added here from the catalogue ' +
        'before being pushed to a connected webshop. ' +
        'Each item shows id, name, sku, partnerName, pricing, stock, pushStatus, and targetConnectionId. ' +
        'pushStatus: varakozik=waiting, kuldve=sent, kesz=done, hiba=error. ' +
        'Filter by status or partner/supplier id.',
      inputSchema: {
        status: z
          .enum(['varakozik', 'kuldve', 'kesz', 'hiba'])
          .optional()
          .describe('Filter by push status'),
        partner: z.number().int().positive().optional().describe('Filter by supplier/partner id'),
        q: z.string().optional().describe('Free-text search on product name or SKU'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const items = await client.importList.list({
        status: args.status,
        partner: args.partner,
        q: args.q,
      })
      return { content: [{ type: 'text' as const, text: JSON.stringify({ items, total: items.length }) }] }
    },
  )

  // ---- haszno_import_list_add ------------------------------------------------
  server.registerTool(
    'haszno_import_list_add',
    {
      title: 'Add products to import list',
      description:
        'Adds one or more network/catalogue products to the import list by their catalogue product IDs. ' +
        'Use haszno_catalogue_search first to find product IDs. ' +
        'Returns { added, skipped } — skipped means the product was already in the list. ' +
        'This is a non-destructive write; no product is created in the shop yet. ' +
        'To push to the shop, use haszno_import_list_push afterwards.',
      inputSchema: {
        networkProductIds: z
          .array(z.number().int().positive())
          .min(1)
          .max(100)
          .describe('IDs of catalogue/network products to add (from haszno_catalogue_search)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      const result = await client.importList.add({ networkProductIds: args.networkProductIds })
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    },
  )

  // ---- haszno_import_list_push -----------------------------------------------
  server.registerTool(
    'haszno_import_list_push',
    {
      title: 'Push import list items to connected store',
      description:
        'Pushes import-list items to the user\'s connected webshop (WooCommerce, Shopify, etc.). ' +
        'Requires confirm=true to prevent accidental pushes. ' +
        'You MUST pass the import list item IDs (from haszno_import_list_list). ' +
        'Optionally specify targetConnectionId to target a specific store connection. ' +
        'Returns { pushed, failed, errors }. ' +
        'Note: the connected store must have status "kapcsolva" (use haszno_connections_list to check).',
      inputSchema: {
        ids: z
          .array(z.number().int().positive())
          .min(1)
          .describe('Import list item IDs to push (from haszno_import_list_list)'),
        targetConnectionId: z
          .number().int().positive()
          .optional()
          .describe('Store connection ID to push to (from haszno_connections_list); uses shop default if omitted'),
        confirm: z
          .boolean()
          .describe('Must be true to execute the push — set false for a preview/dry-run response'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      if (!args.confirm) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              preview: true,
              message: `Ezt a ${args.ids.length} terméket tolja ki a boltba. Add meg confirm: true a valós futtatáshoz.`,
              ids: args.ids,
              targetConnectionId: args.targetConnectionId ?? null,
            }),
          }],
        }
      }
      // Route to the correct endpoint based on whether a target connection is given.
      const result = args.targetConnectionId != null
        ? await client.importList.push({ ids: args.ids, targetConnectionId: args.targetConnectionId })
        : await client.importList.push({ ids: args.ids })
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    },
  )
}
