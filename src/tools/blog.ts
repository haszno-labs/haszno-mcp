/**
 * MCP tools — Blog / piaci összefoglalók (blog / insights).
 *
 * Tools:
 *   haszno_blog_latest   — fetch the latest published blog post(s)
 *
 * Legal: data always aggregated from >= 5 shops; no per-shop info exposed.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { HasznoClient } from '../client/index.js'

export function registerBlogTools(server: McpServer, client: HasznoClient): void {
  // ---- haszno_blog_latest ---------------------------------------------------
  server.registerTool(
    'haszno_blog_latest',
    {
      title: 'Latest Haszno market blog post',
      description:
        'Returns the latest published Haszno market insight blog post(s). ' +
        'Posts contain aggregated market trends from the Haszno dropshipping network. ' +
        'period: "het" (weekly summary) or "honap" (monthly summary). ' +
        'Each post includes: title, summary, bodyMd (Markdown), period, periodStart/End, ' +
        'publishedAt, and optional data with rankedCategories / rankedProducts / shopsCount. ' +
        'All data is anonymised aggregate from >= 5 shops — no per-shop information. ' +
        'Returns the most recent N posts matching the period filter.',
      inputSchema: {
        period: z
          .enum(['het', 'honap'])
          .optional()
          .describe('"het" for weekly, "honap" for monthly posts. Omit to get both.'),
        limit: z
          .number().int().min(1).max(10)
          .optional()
          .describe('Maximum posts to return (default 1)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const limit = args.limit ?? 1
      const result = await client.blog.list({
        period: args.period,
        page: 1,
        perPage: limit,
      })
      // Return newest first if multiple, include full body
      const posts = result.posts.slice(0, limit)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ posts, total: result.total }),
        }],
      }
    },
  )
}
