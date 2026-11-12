/**
 * MCP tools — Árajánlatok (price proposals via agent endpoint).
 *
 * Uses:
 *   GET  /api/agent/proposals   — pending proposals only (AgentProposal[])
 *   POST /api/agent/proposals   — create a proposal (CreateProposalRequest → CreateProposalResult)
 *
 * Fields available on AgentProposal: id, productId, productName, productSku,
 *   oldPriceGross, proposedPriceGross, reason, status, createdAt
 *
 * Fields NOT available via shop tokens: source, batchId, decidedAt
 *
 * Approve / reject / rollback return 403 for Bearer tokens by design — these
 * operations require human review through the Haszno web dashboard. Each
 * disabled tool returns a clear "not available" message rather than a
 * confusing HTTP 403.
 *
 * The create tool auto-generates a unique nonce (crypto.randomUUID()) to
 * prevent replay of duplicate proposals.
 */
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { HasznoClient, AgentProduct, AgentProposal } from '../client/index.js'
import { HasznoApiError } from '../client/index.js'

// ── helpers ──────────────────────────────────────────────────────────────────

const NOT_AVAILABLE =
  'Not available with a shop API token. ' +
  'Approve, reject, and rollback operations require human review through the Haszno web dashboard. ' +
  'This is by design: shop tokens can only CREATE proposals (pending), not apply them. ' +
  'Human-in-the-loop approval is mandatory.'

function ok(data: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

function err(msg: string): { content: [{ type: 'text'; text: string }]; isError: true } {
  return { isError: true, content: [{ type: 'text' as const, text: msg }] }
}

function handleApiError(e: unknown, action: string): ReturnType<typeof err> {
  if (e instanceof HasznoApiError) {
    switch (e.status) {
      case 401:
        return err(
          `${action}: Invalid, expired, or revoked shop API token. ` +
            'Generate a new token at Haszno → Integráció → API-kulcsok.',
        )
      case 403:
        return err(
          `${action}: The shop token does not have permission for this operation. ` +
            'Check the token scope at Haszno → Integráció → API-kulcsok.',
        )
      case 404:
        return err(
          `${action}: Product not found in your shop. ` +
            'The productId must be a product listed in your shop (GET /api/agent/products).',
        )
      case 409:
        return err(
          `${action}: Duplicate proposal detected (replayed nonce). ` +
            'A proposal with this nonce already exists. Each call generates a fresh nonce automatically; ' +
            'this error usually means the same call was retried after success.',
        )
      case 429:
        return err(
          `${action}: Too many failed attempts. Wait a few minutes before retrying.`,
        )
      default:
        return err(`${action}: API error — ${e.message} (HTTP ${e.status})`)
    }
  }
  return err(`${action}: Unexpected error — ${String(e)}`)
}

// ── registration ─────────────────────────────────────────────────────────────

export function registerProposalsTools(server: McpServer, client: HasznoClient): void {
  // ── haszno_proposals_list ─────────────────────────────────────────────────
  server.tool(
    'haszno_proposals_list',
    `List PENDING price-change proposals for your shop via the agent endpoint.

A "proposal" is a recommended price change that the shop owner must review
in the Haszno web dashboard before it takes effect. Shop tokens can read and
create proposals (pending only); approve/reject/rollback require a session token.

Each proposal has:
  • oldPriceGross / proposedPriceGross — current and suggested prices (HUF gross)
  • reason — why the change was suggested
  • status — always "pending" from the agent endpoint
  • createdAt — when the proposal was created

Fields NOT available via shop token: source, batchId, decidedAt.

Returns all pending proposals (no pagination — the endpoint returns pending only).`,
    {},
    { readOnlyHint: true },
    async (_args) => {
      let proposals: AgentProposal[]
      try {
        proposals = await client.agent.proposals()
      } catch (e) {
        return handleApiError(e, 'haszno_proposals_list')
      }
      return ok({
        _meta: { total: proposals.length, note: 'Shows pending proposals only via shop token.' },
        proposals: proposals.map((p) => ({
          id: p.id,
          productId: p.productId,
          productName: p.productName,
          productSku: p.productSku,
          oldPriceGross: p.oldPriceGross,
          proposedPriceGross: p.proposedPriceGross,
          diffGross: p.proposedPriceGross - p.oldPriceGross,
          reason: p.reason,
          status: p.status,
          createdAt: p.createdAt,
        })),
      })
    },
  )

  // ── haszno_proposals_market ───────────────────────────────────────────────
  server.tool(
    'haszno_proposals_market',
    `Show a product's current pricing alongside its pending proposals.

Fetches agent products and pending proposals in parallel. Use this before
creating a proposal to understand whether a price change is warranted.

Returns:
  • product — id, sku, name, listed, priceGross, stock, supplierName,
    current margin, recommended price/margin
  • pendingProposals — pending proposals for this product

Note: costNet, marketMinGross, marketShop are not available via shop tokens.
All prices are in HUF (gross, VAT-inclusive).`,
    {
      productId: z
        .number()
        .int()
        .positive()
        .describe('The product ID to inspect. Obtain from haszno_products_list.'),
    },
    { readOnlyHint: true },
    async (args) => {
      let products: AgentProduct[]
      let proposals: AgentProposal[]
      try {
        ;[products, proposals] = await Promise.all([
          client.agent.products(),
          client.agent.proposals(),
        ])
      } catch (e) {
        return handleApiError(e, 'haszno_proposals_market')
      }

      const product = products.find((p) => p.id === args.productId)
      if (!product) {
        return err(
          `Product ${args.productId} not found in your shop. ` +
            'Use haszno_products_list to see valid product IDs.',
        )
      }

      const pending = proposals
        .filter((p) => p.productId === args.productId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

      return ok({
        product: {
          id: product.id,
          sku: product.sku,
          name: product.name,
          listed: product.listed,
          priceGross: product.priceGross,
          stock: product.stock,
          supplierName: product.supplierName,
          current: product.current,
          recommended: product.recommended,
        },
        pendingProposals: pending.map((p) => ({
          id: p.id,
          oldPriceGross: p.oldPriceGross,
          proposedPriceGross: p.proposedPriceGross,
          diffGross: p.proposedPriceGross - p.oldPriceGross,
          reason: p.reason,
          createdAt: p.createdAt,
        })),
      })
    },
  )

  // ── haszno_proposals_create ───────────────────────────────────────────────
  server.tool(
    'haszno_proposals_create',
    `Create a pending price-change proposal for a product.

The proposal enters "pending" status and must be approved in the Haszno web
dashboard before the price changes. Shop tokens can ONLY create pending proposals
— approve/reject/rollback are human-only operations by design.

A unique nonce is generated automatically per call (crypto.randomUUID()).
The server rejects duplicate nonces (409) to prevent replay attacks.

Validation rules:
  • productId must be a product in your shop (GET /api/agent/products)
  • proposedPriceGross must be a positive integer (HUF gross)
  • The server enforces a price floor: proposed price must be ≥ cost + min margin
  • reason is required (1–500 chars)

Returns: { id, status: "pending", createdAt }`,
    {
      productId: z
        .number()
        .int()
        .positive()
        .describe('ID of the product to propose a price change for.'),
      proposedPriceGross: z
        .number()
        .int()
        .positive()
        .describe('Proposed new gross price in HUF (whole forints, VAT-inclusive).'),
      reason: z
        .string()
        .min(1)
        .max(500)
        .describe(
          'Why you are proposing this price change (1–500 chars). ' +
            'Example: "Competitor reduced to 8900 Ft, matching to stay competitive."',
        ),
    },
    { readOnlyHint: false, idempotentHint: false },
    async (args) => {
      const nonce = randomUUID()
      try {
        const result = await client.agent.createProposal({
          productId: args.productId,
          proposedPriceGross: args.proposedPriceGross,
          reason: args.reason,
          nonce,
        })
        return ok({
          id: result.id,
          status: result.status,
          createdAt: result.createdAt,
          nonce,
          note:
            'Proposal created. It is now PENDING — a shop owner must approve it ' +
            'in the Haszno web dashboard before the price changes.',
        })
      } catch (e) {
        return handleApiError(e, 'haszno_proposals_create')
      }
    },
  )

  // ── haszno_proposals_approve ───────────────────────────────────────────────
  server.tool(
    'haszno_proposals_approve',
    'Approve price proposals. NOT AVAILABLE with a shop API token — requires human review via the web dashboard.',
    {
      ids: z.array(z.number().int().positive()).optional().describe('Proposal IDs to approve.'),
    },
    { readOnlyHint: false },
    async (_args) => err(NOT_AVAILABLE),
  )

  // ── haszno_proposals_reject ────────────────────────────────────────────────
  server.tool(
    'haszno_proposals_reject',
    'Reject price proposals. NOT AVAILABLE with a shop API token — requires human review via the web dashboard.',
    {
      ids: z.array(z.number().int().positive()).min(1).describe('Proposal IDs to reject.'),
    },
    { readOnlyHint: false },
    async (_args) => err(NOT_AVAILABLE),
  )

  // ── haszno_proposals_rollback ──────────────────────────────────────────────
  server.tool(
    'haszno_proposals_rollback',
    'Roll back an approval batch. NOT AVAILABLE with a shop API token — requires human review via the web dashboard.',
    {
      batchId: z.string().min(1).describe('The batchId to roll back.'),
    },
    { readOnlyHint: false },
    async (_args) => err(NOT_AVAILABLE),
  )
}
