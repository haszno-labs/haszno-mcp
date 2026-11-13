/**
 * @haszno/mcp — Haszno MCP server (stdio transport).
 *
 * Usage (Claude Code CLI):
 *   claude mcp add haszno -- npx -y github:haszno-labs/haszno-mcp
 *
 * Local path variant (after npm install -g):
 *   claude mcp add haszno -- node ~/.haszno/haszno-mcp/dist/index.js
 *
 * Credentials are read from (in priority order):
 *   1. HASZNO_API_TOKEN (per-shop token), then HASZNO_API_KEY / HASZNO_API_URL environment variables
 *   2. ARFUTAR_API_KEY / ARFUTAR_API_URL (silent fallback for migration)
 *   3. ~/.config/haszno/config.json  (written by `haszno configure`)
 *   4. ~/.config/arfutar/config.json (silent fallback for migration)
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createClient } from './client/index.js'

import { registerCatalogTools } from './tools/catalog.js'
import { registerProductsTools } from './tools/products.js'
import { registerProposalsTools } from './tools/proposals.js'
import { registerRulesTools } from './tools/rules.js'
import { registerOrdersTools } from './tools/orders.js'
import { registerIdeasTools } from './tools/ideas.js'
import { registerFeedsTools } from './tools/feeds.js'
import { registerAccountTools } from './tools/account.js'
import { registerCatalogueTools } from './tools/catalogue.js'
import { registerConnectionsTools } from './tools/connections.js'
import { registerPeersTools } from './tools/peers.js'
import { registerBlogTools } from './tools/blog.js'
import { registerShopTools } from './tools/shop.js'

/** Read flat config from ~/.config/haszno/config.json with ~/.config/arfutar fallback. */
function readHasznoConfig(): { apiUrl?: string; apiKey?: string; basicAuth?: string } {
  const candidates = [
    path.join(os.homedir(), '.config', 'haszno', 'config.json'),
    path.join(os.homedir(), '.config', 'arfutar', 'config.json'),
  ]
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, 'utf8')) as {
          apiUrl?: string
          apiKey?: string
          basicAuth?: string
        }
      }
    } catch {
      // ignore malformed config
    }
  }
  return {}
}

async function main() {
  // Priority: env vars (new + fallback) > config file
  // HASZNO_API_TOKEN (per-shop token) wins over the older key variables, as documented in the README.
  const envApiKey = process.env['HASZNO_API_TOKEN'] ?? process.env['HASZNO_API_KEY'] ?? process.env['ARFUTAR_API_KEY']
  const envApiUrl = process.env['HASZNO_API_URL'] ?? process.env['ARFUTAR_API_URL']
  const envBasic = process.env['HASZNO_BASIC'] ?? process.env['ARFUTAR_BASIC']

  let apiKey = envApiKey
  let apiUrl = envApiUrl
  let basicAuth = envBasic

  if (!apiKey && !basicAuth) {
    const config = readHasznoConfig()
    if (!apiKey) apiKey = config.apiKey
    if (!basicAuth) basicAuth = config.basicAuth
    if (!apiUrl) apiUrl = config.apiUrl
  }

  const httpOpts = { apiKey, basicAuth, baseUrl: apiUrl }
  const client = createClient(httpOpts)

  const server = new McpServer({
    name: 'haszno',
    version: '0.1.0',
  })

  // Each domain registers its own tools; parallel agents only edit their domain file.
  registerCatalogTools(server, client)
  registerProductsTools(server, client)
  registerProposalsTools(server, client)
  registerRulesTools(server, client)
  registerOrdersTools(server, client)
  registerIdeasTools(server, client)
  registerFeedsTools(server, client)
  registerAccountTools(server, client)
  registerCatalogueTools(server, client)
  registerConnectionsTools(server, client)
  registerPeersTools(server, client)
  registerBlogTools(server, client)
  registerShopTools(server, httpOpts)

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('haszno-mcp fatal error:', err)
  process.exit(1)
})
