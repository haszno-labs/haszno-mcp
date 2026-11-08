/**
 * MCP tools — Termékötletek (product ideas / recommendations).
 *
 * Domain: ideas
 * Endpoints:
 *   GET  /api/recommendations         — trend-scored product idea list
 *   POST /api/recommendations/ai      — AI shortlist (up to 5 picks, reports token cost)
 *   POST /api/products/:id/ai-description — AI-generated product description
 *   POST /api/trends/keywords         — fill missing trend keywords via AI (write)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { HasznoClient, RecommendationItem } from '../client/index.js'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compact representation of one recommendation item for agents. */
function compactItem(item: RecommendationItem, rank: number) {
  return {
    rank,
    id: item.id,
    sku: item.sku,
    name: item.name,
    supplier: item.supplierName,
    stock: item.stock,
    costNet_HUF: item.costNet,
    suggestedPriceGross_HUF: item.recommended?.priceGross ?? null,
    marginNet_HUF: item.recommended?.marginNet ?? null,
    marginPct: item.recommended?.marginPct ?? null,
    trendScore: item.trendScore ?? null,
  }
}

// ---------------------------------------------------------------------------
// Tool: haszno_ideas_list
// ---------------------------------------------------------------------------

function registerIdeasListTool(server: McpServer, client: HasznoClient): void {
  server.registerTool(
    'haszno_ideas_list',
    {
      title: 'Haszno termékötlet lista',
      description:
        'Get the ranked product idea shortlist for this shop. ' +
        'Products are scored by Google Trends demand (HU) and margin safety. ' +
        'Use this to find which new products to add, or which catalogue items ' +
        'are currently trending in Hungary. ' +
        'Returns: anchor keyword (the Google Trends normalisation base), geo, ' +
        'total count, and an array of items each with: rank, id, sku, name, ' +
        'supplier, stock, costNet_HUF (net cost in HUF), ' +
        'suggestedPriceGross_HUF (VAT-inclusive), marginNet_HUF, marginPct, ' +
        'trendScore (0–100; null if not yet scored). ' +
        'Default limit 25; max 100. Read-only, no confirmation needed.',
      inputSchema: {
        min_score: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe('Keep only items with trendScore >= this value (0–100).'),
        supplier: z
          .string()
          .optional()
          .describe('Filter by supplier name — case-insensitive substring match.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Maximum number of items to return. Default 25, max 100.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ min_score, supplier, limit }) => {
      const recs = await client.recommendations.get()

      let items: RecommendationItem[] = recs.items ?? []

      if (min_score != null) {
        items = items.filter((it) => (it.trendScore ?? 0) >= min_score)
      }
      if (supplier) {
        const q = supplier.toLowerCase()
        items = items.filter((it) => it.supplierName.toLowerCase().includes(q))
      }

      // Sort by trendScore DESC then marginPct DESC
      items = [...items].sort((a, b) => {
        const tsDiff = (b.trendScore ?? 0) - (a.trendScore ?? 0)
        if (tsDiff !== 0) return tsDiff
        return (b.recommended?.marginPct ?? 0) - (a.recommended?.marginPct ?? 0)
      })

      const cap = limit ?? 25
      const truncated = items.length > cap
      items = items.slice(0, cap)

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              anchor: recs.anchor,
              geo: recs.geo,
              total: (recs.items ?? []).length,
              filtered: items.length,
              truncated,
              items: items.map((it, i) => compactItem(it, i + 1)),
            }),
          },
        ],
      }
    },
  )
}

// ---------------------------------------------------------------------------
// Tool: haszno_ideas_ai_shortlist
// ---------------------------------------------------------------------------

function registerAiShortlistTool(server: McpServer, client: HasznoClient): void {
  server.registerTool(
    'haszno_ideas_ai_shortlist',
    {
      title: 'Haszno AI termékötlet shortlist',
      description:
        'Get an AI-curated shortlist of up to 5 products that best fit this shop. ' +
        'The AI evaluates own catalogue items (not yet listed, positive margin) and ' +
        'partner network products, then picks the ones most complementary to the ' +
        "shop's existing mix. " +
        'Returns: summary (1–2 Hungarian sentences), picks (≤5 items — each with ' +
        'name, supplier, recommendedPriceGross_HUF (VAT-inclusive), marginNet_HUF, ' +
        'marginPct, fit score 0–100, aiReason in Hungarian), usage (model, ' +
        'inputTokens, outputTokens, estimatedCostFt_HUF), and cached flag. ' +
        '"cached: true" means the server returned a 24-hour cached result — ' +
        'no additional AI spend occurred. ' +
        'Requires confirm: true because it may trigger an AI API call on the server.',
      inputSchema: {
        confirm: z
          .literal(true)
          .describe('Must be true. Confirms you accept a possible AI API call and its cost.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ confirm: _confirm }) => {
      const result = await client.recommendations.getAiShortlist()

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              summary: result.summary,
              cached: result.cached ?? false,
              picks: (result.picks ?? []).map((p) => ({
                productId: p.productId,
                networkProductId: p.networkProductId,
                name: p.name,
                supplier: p.supplierName,
                recommendedPriceGross_HUF: p.recommendedPriceGross,
                marginNet_HUF: p.marginNet,
                marginPct: p.marginPct,
                fit: p.fit,
                aiReason: p.aiReason,
              })),
              usage: result.usage
                ? {
                    model: result.usage.model,
                    inputTokens: result.usage.inputTokens,
                    outputTokens: result.usage.outputTokens,
                    estimatedCostFt_HUF: result.usage.costFt,
                  }
                : null,
            }),
          },
        ],
      }
    },
  )
}

// ---------------------------------------------------------------------------
// Tool: haszno_ideas_ai_description
// ---------------------------------------------------------------------------

function registerAiDescriptionTool(server: McpServer, client: HasznoClient): void {
  server.registerTool(
    'haszno_ideas_ai_description',
    {
      title: 'Haszno AI termékleiras generátor',
      description:
        'Generate an AI product description for a shop product. ' +
        'Uses the product name and its trend keyword to write a Hungarian webshop ' +
        'product description. The result is returned as text — it is NOT saved ' +
        'automatically. Review it, then apply it via haszno_products_update if ' +
        'satisfied. ' +
        'Get the product_id from haszno_ideas_list or haszno_products_list. ' +
        'Requires confirm: true because it triggers an AI API call on the server.',
      inputSchema: {
        product_id: z.number().int().min(1).describe('Numeric id of the shop product to describe.'),
        confirm: z
          .literal(true)
          .describe('Must be true. Confirms you accept the AI API call and its cost.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ product_id, confirm: _confirm }) => {
      const result = await client.products.generateAiDescription(product_id)

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ product_id, description: result.text }),
          },
        ],
      }
    },
  )
}

// ---------------------------------------------------------------------------
// Tool: haszno_ideas_fill_keywords
// ---------------------------------------------------------------------------

function registerFillKeywordsTool(server: McpServer, client: HasznoClient): void {
  server.registerTool(
    'haszno_ideas_fill_keywords',
    {
      title: 'Haszno trendkulcsszó feltöltés',
      description:
        'Fill missing Google Trends keywords for all products that have none. ' +
        'Products without a trend keyword are excluded from the idea scoring; ' +
        'running this improves haszno_ideas_list and haszno_ideas_ai_shortlist. ' +
        'Uses Claude AI to suggest a generic Hungarian + English search phrase ' +
        'per product. Changes are saved immediately on the server. ' +
        'Returns: { updated: N }. Returns { updated: 0 } when all keywords are ' +
        'already filled — safe to call repeatedly (outcome is idempotent). ' +
        'Requires confirm: true because it modifies shop data and incurs AI cost.',
      inputSchema: {
        confirm: z
          .literal(true)
          .describe('Must be true. Confirms the write and AI API call.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ confirm: _confirm }) => {
      const result = await client.recommendations.fillTrendKeywords()

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ updated: result.updated }),
          },
        ],
      }
    },
  )
}

// ---------------------------------------------------------------------------
// Register all ideas tools
// ---------------------------------------------------------------------------

export function registerIdeasTools(server: McpServer, client: HasznoClient): void {
  registerIdeasListTool(server, client)
  registerAiShortlistTool(server, client)
  registerAiDescriptionTool(server, client)
  registerFillKeywordsTool(server, client)
}
