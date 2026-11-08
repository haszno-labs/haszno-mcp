/**
 * MCP tools — P2P partner meghívók (peer invites + links).
 *
 * Tools:
 *   haszno_peers_invite_create  — create an invite code for a supplier
 *   haszno_peers_invite_list    — list own peer invites
 *   haszno_peers_invite_accept  — accept a peer invite (become a partner)
 *
 * Legal note: supplier visibility only affects catalogue exposure.
 * No pricing coordination between shops; each reseller sets their own price.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { HasznoClient } from '../client/index.js'

export function registerPeersTools(server: McpServer, client: HasznoClient): void {
  // ---- haszno_peers_invite_create -------------------------------------------
  server.registerTool(
    'haszno_peers_invite_create',
    {
      title: 'Create peer invite',
      description:
        'Creates a one-time invite code that lets another Haszno shop become your peer partner ' +
        'for a specific supplier. The invited shop gains access to that supplier\'s catalogue. ' +
        'You must own or manage the supplier (supplierId). ' +
        'Returns { code, expiresAt, supplierId } — share the code with the partner. ' +
        'Each invite is single-use and expires at the given datetime.',
      inputSchema: {
        supplierId: z.number().int().positive().describe('Supplier ID to share access for'),
        expiresAt: z
          .string()
          .describe('Expiry datetime in ISO-8601, e.g. "2026-12-31T23:59:00Z". Must be in the future.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      const invite = await client.peers.createInvite({
        supplierId: args.supplierId,
        expiresAt: args.expiresAt,
      })
      return { content: [{ type: 'text' as const, text: JSON.stringify(invite) }] }
    },
  )

  // ---- haszno_peers_invite_list ---------------------------------------------
  server.registerTool(
    'haszno_peers_invite_list',
    {
      title: 'List peer invites',
      description:
        'Lists all invite codes you have created. ' +
        'Each invite shows: code, supplierId, expiresAt, acceptedBy (null if pending), ' +
        'revokedAt (null if active). ' +
        'Use to check which invites are still pending, accepted, or revoked.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const invites = await client.peers.listInvites()
      return { content: [{ type: 'text' as const, text: JSON.stringify({ invites }) }] }
    },
  )

  // ---- haszno_peers_invite_accept -------------------------------------------
  server.registerTool(
    'haszno_peers_invite_accept',
    {
      title: 'Accept peer invite',
      description:
        'Accepts a peer invite code, establishing a partner link between your shop and the ' +
        'inviting supplier\'s catalogue. After acceptance you can browse and import products ' +
        'from that supplier\'s catalogue. ' +
        'Requires confirm=true. The code is single-use and invalidated after acceptance. ' +
        'Returns the created PeerLink: { id, supplierId, partner, createdAt }.',
      inputSchema: {
        code: z.string().min(1).describe('Invite code received from the partner (e.g. "abc123xyz")'),
        acceptorId: z
          .string().min(1).max(120)
          .describe('Your shop/tenant identifier (the accepting party)'),
        confirm: z
          .boolean()
          .describe('Must be true to accept — set false for a preview/dry-run response'),
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
              message: `Elfogadod a(z) "${args.code}" kódú meghívót "${args.acceptorId}" nevében. Add meg confirm: true a valós elfogadáshoz.`,
            }),
          }],
        }
      }
      const link = await client.peers.acceptInvite(args.code, { acceptorId: args.acceptorId })
      return { content: [{ type: 'text' as const, text: JSON.stringify(link) }] }
    },
  )
}
