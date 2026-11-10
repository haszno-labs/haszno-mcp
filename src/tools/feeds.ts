/**
 * MCP tools — Feedek (import/export feeds).
 *
 * Domain: feeds
 * Endpoints covered:
 *   POST /api/feeds/import           → haszno_feeds_import_supplier (write)
 *   POST /api/market-prices/import   → haszno_feeds_import_market   (write)
 *   GET  /feed/arukereso.xml         → haszno_feeds_outbound_info   (read-only, URL or with fetch)
 *   GET  /feed/google.xml            → haszno_feeds_outbound_info   (read-only, URL or with fetch)
 */
import { readFileSync } from 'node:fs'
import { resolve as resolvePath, sep } from 'node:path'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { HasznoClient } from '../client/index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve feed content: use the provided string or read from filePath. */
export function resolveContent(content: string | undefined, filePath: string | undefined): string {
  if (content != null && content.length > 0) return content
  if (filePath != null && filePath.length > 0) {
    // Only feed files may be read: the content is uploaded to the API, so an arbitrary path
    // (e.g. ~/.ssh/id_rsa or the stored API key) would exfiltrate local secrets.
    const resolved = resolvePath(filePath)
    if (!/\.(csv|xml|tsv|txt)$/i.test(resolved)) {
      throw new Error('filePath must point to a .csv, .tsv, .txt or .xml feed file.')
    }
    if (resolved.split(sep).some((part) => part.startsWith('.') && part.length > 1)) {
      throw new Error('filePath must not be inside a hidden directory (e.g. ~/.ssh, ~/.config).')
    }
    return readFileSync(resolved, 'utf8')
  }
  throw new Error('Provide either `content` (feed text) or `filePath` (path to the feed file).')
}

/** Build auth headers matching the client's logic. Never logs credentials. */
export function buildAuthHeaders(): Record<string, string> {
  const key = process.env['HASZNO_API_KEY'] ?? process.env['ARFUTAR_API_KEY']
  if (key) return { 'x-api-key': key }
  const basic = process.env['HASZNO_BASIC'] ?? process.env['ARFUTAR_BASIC']
  if (basic) {
    const encoded = Buffer.from(basic).toString('base64')
    return { Authorization: `Basic ${encoded}` }
  }
  return {}
}

/** Derive the base URL the same way the client does. */
export function getBaseUrl(): string {
  return (
    process.env['HASZNO_API_URL'] ??
    process.env['ARFUTAR_API_URL'] ??
    'https://haszno.com'
  ).replace(/\/$/, '')
}

/** Count occurrences of an XML open tag in raw text. */
export function countXmlTags(xml: string, tag: string): number {
  return (xml.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length
}

/** Extract first `limit` items from Árukereső feed (<products><product>…). */
export function sampleArukereso(
  xml: string,
  limit: number,
): Array<{ sku: string; name: string; price: string }> {
  const results: Array<{ sku: string; name: string; price: string }> = []
  const productRegex = /<product>([\s\S]*?)<\/product>/g
  let m: RegExpExecArray | null
  while ((m = productRegex.exec(xml)) !== null && results.length < limit) {
    const block = m[1] ?? ''
    const sku = block.match(/<identifier>([\s\S]*?)<\/identifier>/)?.[1] ?? ''
    const name = block.match(/<name>([\s\S]*?)<\/name>/)?.[1] ?? ''
    const price = block.match(/<price>([\s\S]*?)<\/price>/)?.[1] ?? ''
    results.push({ sku, name, price })
  }
  return results
}

/** Extract first `limit` items from Google RSS feed (<rss><channel><item>…). */
export function sampleGoogle(
  xml: string,
  limit: number,
): Array<{ id: string; title: string; price: string }> {
  const results: Array<{ id: string; title: string; price: string }> = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let m: RegExpExecArray | null
  while ((m = itemRegex.exec(xml)) !== null && results.length < limit) {
    const block = m[1] ?? ''
    const id = block.match(/<g:id>([\s\S]*?)<\/g:id>/)?.[1] ?? ''
    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''
    const price = block.match(/<g:price>([\s\S]*?)<\/g:price>/)?.[1] ?? ''
    results.push({ id, title, price })
  }
  return results
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerFeedsTools(server: McpServer, client: HasznoClient): void {
  // ---- haszno_feeds_import_supplier -----------------------------------------

  server.registerTool(
    'haszno_feeds_import_supplier',
    {
      title: 'Import Supplier Feed',
      description: `Import a supplier's product catalogue feed (CSV or XML) into Haszno.
Use when a partner/supplier sends an updated price or stock list.
Creates new products that do not exist yet and updates (name, costNet, stock, rrpGross)
existing products matched by SKU.
Triggers the feed_import rule afterwards.
Returns { created, updated, total } — counts of product rows affected.
Prices in the feed are gross HUF (bruttó Ft).
WRITE OPERATION — requires confirm: true; with confirm: false (default) the call is a no-op safe dry-run.`,
      inputSchema: {
        supplierId: z
          .number()
          .int()
          .positive()
          .describe(
            'ID of the network supplier whose feed this is. Get IDs from haszno_catalog_list_suppliers.',
          ),
        format: z
          .enum(['csv', 'xml'])
          .describe(
            'Feed format. Use "csv" for comma/tab-separated, "xml" for Árukereső-style XML.',
          ),
        content: z
          .string()
          .optional()
          .describe('Feed text content pasted directly. Either this or filePath is required.'),
        filePath: z
          .string()
          .optional()
          .describe(
            'Absolute path to the feed file on the local filesystem. The MCP server reads it. Either this or content is required.',
          ),
        confirm: z
          .boolean()
          .default(false)
          .describe(
            'Set to true to execute the import. When false (default) the tool returns a dry-run summary without touching the database.',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async ({ supplierId, format, content, filePath, confirm }) => {
      if (!confirm) {
        const preview =
          content != null
            ? `${content.trim().split('\n').length} sorok (${content.length} karakter) közvetlenül átadva`
            : filePath != null
              ? `fájl: ${filePath}`
              : '(nincs tartalom megadva)'
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                dry_run: true,
                message:
                  'Feed importálás NEM történt. Állítsd confirm: true értékre a tényleges importáláshoz.',
                supplierId,
                format,
                source: preview,
              }),
            },
          ],
        }
      }

      let feedContent: string
      try {
        feedContent = resolveContent(content, filePath)
      } catch (err) {
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ error: (err as Error).message }) },
          ],
          isError: true,
        }
      }

      try {
        const result = await client.feeds.importFeed({ supplierId, format, content: feedContent })
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        }
      } catch (err) {
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ error: (err as Error).message }) },
          ],
          isError: true,
        }
      }
    },
  )

  // ---- haszno_feeds_import_market -------------------------------------------

  server.registerTool(
    'haszno_feeds_import_market',
    {
      title: 'Import Market Prices',
      description: `Import competitor market prices from a CSV export (e.g. from Árukereső.hu or a scrape).
Matches rows to existing products by SKU and updates the marketMinGross (legolcsóbb versenytársi ár,
gross HUF) and marketShop fields.
Returns { matched, total } — how many rows matched a product vs total rows in the CSV.
Triggers the market_price rule afterwards.
Safe to re-import (idempotent): running the same CSV twice sets the same values.
WRITE OPERATION — requires confirm: true.`,
      inputSchema: {
        content: z
          .string()
          .optional()
          .describe('CSV text content. Either this or filePath is required.'),
        filePath: z
          .string()
          .optional()
          .describe(
            'Absolute path to the CSV file on the local filesystem. Either this or content is required.',
          ),
        confirm: z
          .boolean()
          .default(false)
          .describe(
            'Set to true to execute the import. When false (default) no changes are made.',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ content, filePath, confirm }) => {
      if (!confirm) {
        const preview =
          content != null
            ? `${content.trim().split('\n').length} sorok (${content.length} karakter)`
            : filePath != null
              ? `fájl: ${filePath}`
              : '(nincs tartalom megadva)'
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                dry_run: true,
                message: 'Piaci ár importálás NEM történt. Állítsd confirm: true értékre.',
                source: preview,
              }),
            },
          ],
        }
      }

      let csvContent: string
      try {
        csvContent = resolveContent(content, filePath)
      } catch (err) {
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ error: (err as Error).message }) },
          ],
          isError: true,
        }
      }

      try {
        const result = await client.feeds.importMarketPrices({ content: csvContent })
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        }
      } catch (err) {
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ error: (err as Error).message }) },
          ],
          isError: true,
        }
      }
    },
  )

  // ---- haszno_feeds_outbound_info -------------------------------------------

  server.registerTool(
    'haszno_feeds_outbound_info',
    {
      title: 'Outbound Feed Info',
      description: `Returns the public XML feed URLs that Haszno publishes for price comparison services:
  - Árukereső.hu : <baseUrl>/feed/arukereso.xml
  - Google Shopping: <baseUrl>/feed/google.xml
These URLs are configured in price comparison partner dashboards so their bots can crawl
the shop's listed (active) products. Only products with listed=true appear in the feeds.
Prices are gross HUF (bruttó Ft).
Set fetch_summary: true to GET the live feeds and return item_count + 3-item sample —
useful for verifying the feeds are populated after a supplier import.`,
      inputSchema: {
        fetch_summary: z
          .boolean()
          .default(false)
          .describe(
            'If true, fetches both feeds and returns item_count + 3-item sample. Default false (returns URLs only).',
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ fetch_summary }) => {
      const base = getBaseUrl()
      const arukeresoUrl = `${base}/feed/arukereso.xml`
      const googleUrl = `${base}/feed/google.xml`

      if (!fetch_summary) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                arukereso_url: arukeresoUrl,
                google_url: googleUrl,
                note: 'Set fetch_summary: true to verify the feeds are live and check item counts.',
              }),
            },
          ],
        }
      }

      const headers = buildAuthHeaders()

      async function fetchFeed(
        url: string,
      ): Promise<{ ok: boolean; status?: number; error?: string; xml?: string }> {
        try {
          const res = await fetch(url, { headers })
          if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` }
          const xml = await res.text()
          return { ok: true, xml }
        } catch (err) {
          return { ok: false, error: (err as Error).message }
        }
      }

      const [arRes, goRes] = await Promise.all([fetchFeed(arukeresoUrl), fetchFeed(googleUrl)])

      const arukeresoSummary =
        arRes.ok && arRes.xml != null
          ? {
              url: arukeresoUrl,
              item_count: countXmlTags(arRes.xml, 'product'),
              sample: sampleArukereso(arRes.xml, 3),
            }
          : { url: arukeresoUrl, error: arRes.error ?? `HTTP ${arRes.status}` }

      const googleSummary =
        goRes.ok && goRes.xml != null
          ? {
              url: googleUrl,
              item_count: countXmlTags(goRes.xml, 'item'),
              sample: sampleGoogle(goRes.xml, 3),
            }
          : { url: googleUrl, error: goRes.error ?? `HTTP ${goRes.status}` }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ arukereso: arukeresoSummary, google: googleSummary }),
          },
        ],
      }
    },
  )
}
