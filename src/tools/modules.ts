/**
 * MCP tools — Modulok (workspace module subscriptions).
 *
 * Domain: modules
 * Tools:
 *   haszno_modules_list_prices   — public price-list (no auth required)
 *   haszno_modules_list_my       — authenticated: show active/pending modules for this shop
 *   haszno_modules_activate      — start activation (billable: returns checkout URL; free: activates immediately)
 *   haszno_modules_cancel        — cancel a currently-active module subscription
 *   haszno_modules_resume        — resume a cancelled-but-not-yet-ended subscription
 *
 * Auth model:
 *   list_prices  — public, no Bearer required
 *   list_my      — requires Bearer (haszno_… shop token)
 *   activate     — requires Bearer, requires write scope
 *   cancel       — requires Bearer, requires write scope, requires ownership (tulajdonos role)
 *   resume       — requires Bearer, requires write scope, requires ownership
 *
 * Note on billing:
 *   Activating a billable module (fitness, booking_salon, booking_clinic, booking_other) starts
 *   a SimplePay payment flow. The API returns { status, checkoutUrl } where the user must visit
 *   checkoutUrl to complete payment. Never report activation as "done" before payment succeeds.
 *   Free modules (webshop, dropshipping_supplier, restaurant) activate immediately — no checkout.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { HasznoClient } from '../client/index.js'

export const MODULE_IDS = [
  'webshop',
  'dropshipping_supplier',
  'fitness',
  'booking_salon',
  'booking_clinic',
  'booking_other',
  'restaurant',
] as const

export type ModuleId = (typeof MODULE_IDS)[number]

export function registerModulesTools(server: McpServer, client: HasznoClient): void {
  // ── haszno_modules_list_prices ─────────────────────────────────────────────

  server.registerTool(
    'haszno_modules_list_prices',
    {
      title: 'Module price list',
      description:
        'Returns the public price-list for all Haszno workspace modules: ' +
        'module id, monthly price in HUF, and whether it is billable (requires payment). ' +
        'Free modules (webshop, dropshipping_supplier, restaurant) have priceHuf = 0. ' +
        'No authentication required.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {},
    },
    async () => {
      const result = await client.modules.listPrices()
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      }
    },
  )

  // ── haszno_modules_list_my ─────────────────────────────────────────────────

  server.registerTool(
    'haszno_modules_list_my',
    {
      title: 'My active modules',
      description:
        'Returns the workspace modules currently active (or pending activation) for this shop. ' +
        'Shows module id, subscription status (pending/active/cancelled/ended), billing period, and expiry. ' +
        'Requires a shop Bearer token (haszno_…).',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {},
    },
    async () => {
      const result = await client.modules.listMy()
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      }
    },
  )

  // ── haszno_modules_activate ────────────────────────────────────────────────

  server.registerTool(
    'haszno_modules_activate',
    {
      title: 'Activate a module',
      description:
        'Starts the activation flow for a Haszno workspace module. ' +
        'For free modules (webshop, dropshipping_supplier, restaurant) this activates immediately. ' +
        'For billable modules (fitness, booking_salon, booking_clinic, booking_other) it returns a ' +
        'checkoutUrl that the user must visit to complete the payment. ' +
        'IMPORTANT: If a checkoutUrl is returned, tell the user to open it and complete payment — ' +
        'do NOT report the module as active until payment is confirmed. ' +
        'Requires confirm: true (safety gate). ' +
        'Requires a write-scope shop Bearer token (haszno_…) with ownership (tulajdonos) role.',
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        moduleId: z.enum(MODULE_IDS).describe('The module to activate.'),
        confirm: z
          .literal(true)
          .describe(
            'Must be exactly true. This may start a real payment flow — only set after the user confirms.',
          ),
      },
    },
    async (args) => {
      if (args.confirm !== true) {
        return {
          content: [
            {
              type: 'text',
              text: 'Confirm required: set confirm: true after the user has acknowledged this may trigger a payment.',
            },
          ],
        }
      }
      const result = await client.modules.activate(args.moduleId as ModuleId)
      const lines: string[] = [`Module: ${args.moduleId}`, `Status: ${result.status}`]
      if (result.checkout?.redirectUrl) {
        lines.push(`Checkout URL: ${result.checkout.redirectUrl}`)
        lines.push(`Order ref: ${result.checkout.orderRef}`)
        lines.push(`Amount: ${result.checkout.amountHuf} HUF`)
        lines.push(
          'The user must visit the checkout URL to complete payment. The module will not be active until payment succeeds.',
        )
      } else if (result.status === 'active') {
        lines.push(result.message ?? 'Module activated immediately (free module, no payment required).')
      }
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      }
    },
  )

  // ── haszno_modules_cancel ─────────────────────────────────────────────────

  server.registerTool(
    'haszno_modules_cancel',
    {
      title: 'Cancel a module subscription',
      description:
        'Cancels a currently-active module subscription. ' +
        'The module remains accessible until the end of the current paid period (not an immediate shutdown). ' +
        'Requires confirm: true. Requires ownership (tulajdonos) role.',
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        moduleId: z.enum(MODULE_IDS).describe('The module to cancel.'),
        confirm: z.literal(true).describe('Must be exactly true (safety gate).'),
      },
    },
    async (args) => {
      if (args.confirm !== true) {
        return {
          content: [{ type: 'text', text: 'Confirm required: set confirm: true to cancel the module.' }],
        }
      }
      const result = await client.modules.cancel(args.moduleId as ModuleId)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      }
    },
  )

  // ── haszno_modules_resume ─────────────────────────────────────────────────

  server.registerTool(
    'haszno_modules_resume',
    {
      title: 'Resume a cancelled module',
      description:
        'Resumes a module subscription that was cancelled but has not yet expired. ' +
        'Has no effect if the module is already active or if the period has already ended. ' +
        'Requires confirm: true. Requires ownership (tulajdonos) role.',
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        moduleId: z.enum(MODULE_IDS).describe('The module to resume.'),
        confirm: z.literal(true).describe('Must be exactly true (safety gate).'),
      },
    },
    async (args) => {
      if (args.confirm !== true) {
        return {
          content: [{ type: 'text', text: 'Confirm required: set confirm: true to resume the module.' }],
        }
      }
      const result = await client.modules.resume(args.moduleId as ModuleId)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      }
    },
  )
}
