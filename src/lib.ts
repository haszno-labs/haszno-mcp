/**
 * @haszno/mcp — Library entry for hosted (HTTP/remote) MCP endpoints.
 *
 * This module has NO side effects on import:
 *   - It does NOT start a server.
 *   - It does NOT read environment variables at import time.
 *   - It does NOT touch the filesystem.
 *
 * Usage in a hosted MCP endpoint (e.g. Hono, Express, Cloudflare Worker):
 *
 *   import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
 *   import { registerShopTools, type HttpOptions } from '@haszno/mcp/lib'
 *
 *   const server = new McpServer({ name: 'my-server', version: '1.0.0' })
 *
 *   registerShopTools(
 *     server,
 *     {
 *       apiKey:  req.headers['x-haszno-token'],  // per-request credential
 *       baseUrl: process.env.HASZNO_API_BASE,
 *       fetch,                                    // supply the runtime's fetch
 *     },
 *     { remote: true },  // ← enables remote mode (no filePath, no env fallbacks)
 *   )
 *
 * remote: true guarantees:
 *   - haszno_shop_upload_image accepts only base64+mimeType; filePath is absent
 *     from the schema and fs.readFileSync is never called.
 *   - All process.env fallbacks for auth (HASZNO_API_TOKEN, HASZNO_API_KEY, …)
 *     and baseUrl (HASZNO_API_URL, …) are disabled — credentials and URL must
 *     come exclusively from the opts argument.
 *
 * Peer dependencies (must be installed by the host application):
 *   @modelcontextprotocol/sdk  ^1.12.0
 *   zod                         ^4.0
 */
export { registerShopTools } from './tools/shop.js'
export type { HttpOptions } from './client/http.js'
