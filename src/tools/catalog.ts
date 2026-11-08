/**
 * MCP tools — Partnerkatekógus (network suppliers + their products).
 *
 * Domain: catalog
 * Endpoints:
 *   GET  /api/network/suppliers                       → haszno_catalog_list_suppliers, haszno_catalog_list_categories
 *   GET  /api/network/suppliers/:id/products          → haszno_catalog_supplier_products
 *   GET  /api/network/supplier-view/:supplierId       → haszno_catalog_supplier_view
 *   POST /api/network/suppliers/:id/connect  (write)  → haszno_catalog_connect_supplier
 *   POST /api/network/suppliers/:id/sync     (write)  → haszno_catalog_sync_supplier
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { HasznoClient } from '../client/index.js'

const DEFAULT_LIMIT = 25

function paginate<T>(items: T[], page: number, limit: number) {
  const total = items.length
  const pages = Math.max(1, Math.ceil(total / limit))
  const safePage = Math.min(Math.max(1, page), pages)
  const start = (safePage - 1) * limit
  return { items: items.slice(start, start + limit), total, page: safePage, pages }
}

export function registerCatalogTools(server: McpServer, client: HasznoClient): void {
  // ---- haszno_catalog_list_categories ----------------------------------------
  server.registerTool(
    'haszno_catalog_list_categories',
    {
      title: 'List partner categories',
      description:
        'Returns the list of distinct product categories available in the Haszno partner network. ' +
        'Call this first to discover valid values for the `category` filter used by ' +
        '`haszno_catalog_list_suppliers` and `haszno_catalog_supplier_products`. ' +
        'Returns: { categories: string[] } sorted alphabetically.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const suppliers = await client.network.listSuppliers()
      const cats = Array.from(
        new Set(suppliers.map((s) => s.category).filter((c): c is string => c != null)),
      ).sort()
      return { content: [{ type: 'text' as const, text: JSON.stringify({ categories: cats }) }] }
    },
  )

  // ---- haszno_catalog_list_suppliers -----------------------------------------
  server.registerTool(
    'haszno_catalog_list_suppliers',
    {
      title: 'List partner suppliers',
      description:
        'Lists dropshipping suppliers available in the Haszno partner network. ' +
        'Each row: id, name, category, country, connected (bool — already imported into this shop), ' +
        'productCount, avgResellerMarginPct (% average margin other resellers achieve; null if unknown), ' +
        'shopUrl (supplier website). ' +
        'Filter by category (exact, case-insensitive) or search by name substring. ' +
        'Set connected=true to show only suppliers the shop already pulls products from. ' +
        'Money: avgResellerMarginPct is a percentage, e.g. 18.5 means 18.5 %. ' +
        `Pagination: default ${DEFAULT_LIMIT} per page. ` +
        'Use haszno_catalog_list_categories to find valid category values.',
      inputSchema: {
        category: z.string().optional().describe('Filter by category (case-insensitive exact match)'),
        search: z.string().optional().describe('Substring search on supplier name (case-insensitive)'),
        connected: z.boolean().optional().describe('true = only suppliers the shop already imports from'),
        page: z.number().int().min(1).optional().describe('Page number, 1-based (default 1)'),
        limit: z
          .number().int().min(1).max(100).optional()
          .describe(`Items per page, max 100 (default ${DEFAULT_LIMIT})`),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      let suppliers = await client.network.listSuppliers()

      if (args.category != null) {
        const cat = args.category.toLowerCase()
        suppliers = suppliers.filter((s) => s.category?.toLowerCase() === cat)
      }
      if (args.search != null) {
        const q = args.search.toLowerCase()
        suppliers = suppliers.filter((s) => s.name.toLowerCase().includes(q))
      }
      if (args.connected === true) {
        suppliers = suppliers.filter((s) => s.connected)
      }

      const { items, total, page, pages } = paginate(
        suppliers,
        args.page ?? 1,
        args.limit ?? DEFAULT_LIMIT,
      )

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            suppliers: items.map((s) => ({
              id: s.id,
              name: s.name,
              category: s.category,
              country: s.country,
              connected: s.connected,
              productCount: s.productCount,
              avgResellerMarginPct: s.avgResellerMarginPct,
              shopUrl: s.shopUrl,
            })),
            total,
            page,
            pages,
          }),
        }],
      }
    },
  )

  // ---- haszno_catalog_supplier_products --------------------------------------
  server.registerTool(
    'haszno_catalog_supplier_products',
    {
      title: 'Browse supplier catalogue',
      description:
        "Returns products from a partner supplier's catalogue. " +
        'Each product: id, sku, name, ean, category, ' +
        'wholesaleNet (VAT-exclusive net cost in HUF), ' +
        'rrpGross (supplier recommended retail price, VAT-inclusive HUF, may be null), ' +
        'stock (units in supplier warehouse), ' +
        "potentialMargin.priceGross / .marginNet / .marginPct (projected selling price and margin " +
        "at the shop's current pricing rules — gross HUF and % respectively). " +
        'Filter by name/SKU substring (search) or product category. ' +
        `Paginated — default ${DEFAULT_LIMIT} per page. ` +
        'Money note: wholesaleNet is net (VAT-excluded); rrpGross and potentialMargin.priceGross are gross (VAT-included).',
      inputSchema: {
        supplier_id: z.number().int().describe('Supplier ID (from haszno_catalog_list_suppliers)'),
        search: z
          .string().optional()
          .describe('Substring search on product name or SKU (case-insensitive)'),
        category: z.string().optional().describe('Filter by product category (case-insensitive)'),
        page: z.number().int().min(1).optional().describe('Page number, 1-based (default 1)'),
        limit: z
          .number().int().min(1).max(100).optional()
          .describe(`Items per page, max 100 (default ${DEFAULT_LIMIT})`),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      let products = await client.network.getSupplierProducts(args.supplier_id)

      if (args.search != null) {
        const q = args.search.toLowerCase()
        products = products.filter(
          (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q),
        )
      }
      if (args.category != null) {
        const cat = args.category.toLowerCase()
        products = products.filter((p) => p.category?.toLowerCase() === cat)
      }

      const { items, total, page, pages } = paginate(
        products,
        args.page ?? 1,
        args.limit ?? DEFAULT_LIMIT,
      )

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            products: items.map((p) => ({
              id: p.id,
              sku: p.sku,
              name: p.name,
              ean: p.ean,
              category: p.category,
              wholesaleNet: p.wholesaleNet,
              rrpGross: p.rrpGross,
              stock: p.stock,
              potentialMargin: p.potentialMargin,
            })),
            total,
            page,
            pages,
          }),
        }],
      }
    },
  )

  // ---- haszno_catalog_supplier_view ------------------------------------------
  server.registerTool(
    'haszno_catalog_supplier_view',
    {
      title: 'Supplier market view',
      description:
        'Returns a full market overview for a partner supplier: supplier metadata and, for every ' +
        'product in their catalogue, aggregated reseller-market statistics. ' +
        'Per-product stats: resellerCount (how many shops carry it), ' +
        'minGross / avgGross / maxGross (market price range, VAT-inclusive HUF, null if no data), ' +
        'belowRrp (resellers priced under supplier RRP), lossCount (resellers selling at a loss), ' +
        'saturation (0–100 market saturation score — higher = more competition). ' +
        'Use this to evaluate a supplier before connecting. ' +
        'Money: *Gross prices are HUF VAT-inclusive; wholesaleNet is HUF VAT-exclusive.',
      inputSchema: {
        supplier_id: z.number().int().describe('Supplier ID (from haszno_catalog_list_suppliers)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const view = await client.network.getSupplierView(args.supplier_id)
      return { content: [{ type: 'text' as const, text: JSON.stringify(view) }] }
    },
  )

  // ---- haszno_catalog_connect_supplier (WRITE) --------------------------------
  server.registerTool(
    'haszno_catalog_connect_supplier',
    {
      title: 'Connect partner supplier',
      description:
        "Connects a partner supplier to the shop, importing all their products into the shop's " +
        "product database. After a successful connect the supplier's products appear in the " +
        'products domain and can be priced and published. ' +
        'Returns: { status: string, imported: number, skipped: number }. ' +
        'WRITE OPERATION — set confirm: true explicitly to execute; ' +
        'confirm: false returns a preview only and makes no changes. ' +
        'Recommended workflow: (1) call haszno_catalog_supplier_view to evaluate the supplier, ' +
        '(2) call this tool with confirm: true once satisfied.',
      inputSchema: {
        supplier_id: z.number().int().describe('Supplier ID to connect'),
        confirm: z
          .boolean()
          .describe('Must be true to execute. false → dry-run preview, no changes.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      if (!args.confirm) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              preview: true,
              supplier_id: args.supplier_id,
              message:
                'Set confirm: true to actually connect this supplier and import their products.',
            }),
          }],
        }
      }
      const result = await client.network.connect(args.supplier_id)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    },
  )

  // ---- haszno_catalog_sync_supplier (WRITE) -----------------------------------
  server.registerTool(
    'haszno_catalog_sync_supplier',
    {
      title: 'Sync supplier products',
      description:
        'Synchronises prices and stock from a connected partner supplier. ' +
        'Returns: { costChanges: number, stockOuts: number, total: number }. ' +
        'costChanges = products whose wholesale price changed; ' +
        'stockOuts = products that went out of stock; ' +
        'total = products evaluated. ' +
        'Run this after a supplier announces a feed update or on a nightly schedule. ' +
        'WRITE OPERATION — set confirm: true explicitly to execute; ' +
        'confirm: false returns a preview only and makes no changes.',
      inputSchema: {
        supplier_id: z.number().int().describe('Supplier ID of a connected supplier'),
        confirm: z
          .boolean()
          .describe('Must be true to execute. false → dry-run preview, no changes.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      if (!args.confirm) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              preview: true,
              supplier_id: args.supplier_id,
              message: 'Set confirm: true to actually sync this supplier.',
            }),
          }],
        }
      }
      const result = await client.network.sync(args.supplier_id)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    },
  )
}
