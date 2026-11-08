/**
 * MCP tools — Bolt-bekötések (store connections).
 *
 * Tools:
 *   haszno_connections_list   — list connected webshops
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { HasznoClient } from '../client/index.js'

export function registerConnectionsTools(server: McpServer, client: HasznoClient): void {
  // ---- haszno_connections_list -----------------------------------------------
  server.registerTool(
    'haszno_connections_list',
    {
      title: 'List connected webshops',
      description:
        'Lists the user\'s connected webshop store connections. ' +
        'Each connection has: id, platform (shoprenter/unas/woocommerce/shopify/medusa/mock), ' +
        'name, status (uj=new/setup, domain_ok=domain verified, kapcsolva=connected, hiba=error), ' +
        'domain, lastError, connectedAt, lastSyncAt. ' +
        'Use the connection id as targetConnectionId in haszno_import_list_push. ' +
        'Only connections with status "kapcsolva" can receive pushed products.',
      inputSchema: {
        status: z
          .enum(['uj', 'domain_ok', 'kapcsolva', 'hiba'])
          .optional()
          .describe('Filter by connection status'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      let connections = await client.connections.list()
      if (args.status != null) {
        connections = connections.filter((c) => c.status === args.status)
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify({ connections }) }] }
    },
  )
}
