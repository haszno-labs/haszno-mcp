/**
 * Registers MCP Apps resources (`ui://haszno/<domain>`) with the server.
 *
 * Each resource serves a self-contained HTML bundle.  When an MCP host that
 * supports MCP Apps (Claude web, ChatGPT, VS Code ≥ 2026-01-26, Goose, …)
 * invokes a tool whose `_meta.ui.resourceUri` points here, it mounts the HTML
 * in a sandboxed iframe and passes the tool result via
 * `ui/notifications/tool-result` postMessage.
 *
 * Clients that do NOT support MCP Apps ignore `_meta.ui` entirely and read the
 * plain `{ content: [{ type: 'text', text: '...' }] }` already in the tool result
 * — zero regression.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { proposalsHtml } from './proposals-html.js'
import { productsHtml } from './products-html.js'
import { ideasHtml } from './ideas-html.js'
import { ordersHtml } from './orders-html.js'
import { rulesHtml } from './rules-html.js'

/** MIME type required by the MCP Apps spec. */
const MCP_APP_MIME = 'text/html;profile=mcp-app'

function registerUiResource(
  server: McpServer,
  name: string,
  uri: string,
  description: string,
  html: string,
): void {
  server.registerResource(
    name,
    uri,
    { description, mimeType: MCP_APP_MIME },
    async () => ({
      contents: [{ uri, mimeType: MCP_APP_MIME, text: html }],
    }),
  )
}

/**
 * Register all Haszno MCP Apps UI resources.
 * Call this once during server startup, before connecting the transport.
 */
export function registerUiResources(server: McpServer): void {
  registerUiResource(
    server,
    'haszno-proposals-ui',
    'ui://haszno/proposals',
    'Interactive proposal cards with approve / reject buttons.',
    proposalsHtml,
  )

  registerUiResource(
    server,
    'haszno-products-ui',
    'ui://haszno/products',
    'Product cards showing price, margin, floor and listed toggle.',
    productsHtml,
  )

  registerUiResource(
    server,
    'haszno-ideas-ui',
    'ui://haszno/ideas',
    'AI shortlist cards with one-click import-list add.',
    ideasHtml,
  )

  registerUiResource(
    server,
    'haszno-orders-ui',
    'ui://haszno/orders',
    'Order rows with status chip and ship action button.',
    ordersHtml,
  )

  registerUiResource(
    server,
    'haszno-rules-ui',
    'ui://haszno/rules',
    'Pricing-rule cards with enable / disable toggle.',
    rulesHtml,
  )
}
