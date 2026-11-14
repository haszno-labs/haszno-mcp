/**
 * MCP tools — Fiók / beállítások (account & settings).
 *
 * Domain: account
 * Tools:
 *   haszno_ping                     — health check (read-only)
 *   haszno_account_get_settings     — GET /api/settings (read-only)
 *   haszno_account_update_settings  — PUT /api/settings (write, confirm required)
 *   haszno_account_get_stats        — GET /api/stats (read-only)
 *   haszno_account_get_impact       — GET /api/impact[?days=N] (read-only)
 *   haszno_account_list_suppliers   — GET /api/suppliers (read-only)
 *   haszno_account_configure        — save credentials to ~/.config/haszno/config.json (write, confirm required)
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { HasznoClient } from '../client/index.js'

/** Wraps any value as a compact JSON text content block. */
function json(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

/** Returns an error result without throwing. */
function mkErr(message: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

export function registerAccountTools(server: McpServer, client: HasznoClient): void {

  // ─── haszno_ping ────────────────────────────────────────────────────────────
  server.registerTool(
    'haszno_ping',
    {
      title: 'Ping / health check',
      description:
        'Verifies that the Haszno API is reachable and responding. ' +
        'Call this before any other tool to confirm connectivity, or whenever you want to check whether the backend is up. ' +
        'Returns { ok: true } on success.',
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => {
      try {
        const result = await client.health.check()
        return json(result)
      } catch (e) {
        return mkErr(`Ping failed: ${String(e)}`)
      }
    },
  )

  // ─── haszno_account_get_settings ────────────────────────────────────────────
  server.registerTool(
    'haszno_account_get_settings',
    {
      title: 'Get pricing rule settings',
      description:
        "Returns the shop's pricing rule configuration: " +
        '"undercutPct" — how many percent below the cheapest market competitor the system prices (e.g. 5 = 5% below); ' +
        '"minMarginPct" — minimum gross-profit margin required before the rule applies (e.g. 10 = 10%); ' +
        '"vatPct" — VAT rate used for net/gross conversions (e.g. 27 for Hungarian ÁFA); ' +
        '"automationPaused" — when true the automatic proposal engine is halted. ' +
        'All prices in the system are in HUF (gross). Read this before interpreting or proposing any pricing changes.',
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => {
      try {
        const settings = await client.settings.get()
        return json(settings)
      } catch (e) {
        return mkErr(`Failed to fetch settings: ${String(e)}`)
      }
    },
  )

  // ─── haszno_account_update_settings ─────────────────────────────────────────
  server.registerTool(
    'haszno_account_update_settings',
    {
      title: 'Update pricing rule settings',
      description:
        "Updates the shop's global pricing rule parameters. " +
        'All three numeric fields are required. Use haszno_account_get_settings first to read the current values, ' +
        'then adjust only what needs to change. ' +
        '"undercutPct": percentage to undercut the cheapest market competitor (e.g. 5 → 5% lower). ' +
        '"minMarginPct": minimum net profit margin % to keep (e.g. 10 → never price below 10% margin). ' +
        '"vatPct": the shop\'s VAT rate for gross/net conversion (e.g. 27 for Hungarian ÁFA). ' +
        'All money values in the system are gross HUF. ' +
        'Requires confirm: true to prevent accidental changes — do NOT omit it.',
      inputSchema: {
        undercutPct: z.number().min(0).max(100).describe(
          'Percentage to undercut the cheapest market price (0–100). E.g. 5 = price 5% below the market minimum.',
        ),
        minMarginPct: z.number().min(0).max(100).describe(
          'Minimum net profit margin percentage (0–100). The rule will never go below this.',
        ),
        vatPct: z.number().min(0).max(100).describe(
          'VAT rate used for gross ↔ net conversions (e.g. 27 for Hungarian ÁFA).',
        ),
        confirm: z.literal(true).describe(
          'Must be exactly true. This is a safeguard — always pass true explicitly.',
        ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const updated = await client.settings.update({
          undercutPct: args.undercutPct,
          minMarginPct: args.minMarginPct,
          vatPct: args.vatPct,
        })
        return json(updated)
      } catch (e) {
        return mkErr(`Failed to update settings: ${String(e)}`)
      }
    },
  )

  // ─── haszno_account_get_stats ───────────────────────────────────────────────
  server.registerTool(
    'haszno_account_get_stats',
    {
      title: 'Get account statistics',
      description:
        "Returns a compact dashboard snapshot of the shop's current state: " +
        '"products" — total number of products in the catalogue; ' +
        '"losing" — products currently priced below cost (should be fixed urgently); ' +
        '"overMarket" — products priced above the cheapest market competitor; ' +
        '"toFix" — products that have a pending pricing problem (losing + overMarket combined); ' +
        '"orders" — total number of orders received. ' +
        "Use this to quickly assess the shop's health before deciding what to investigate next.",
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => {
      try {
        const stats = await client.stats.get()
        return json(stats)
      } catch (e) {
        return mkErr(`Failed to fetch stats: ${String(e)}`)
      }
    },
  )

  // ─── haszno_account_get_impact ──────────────────────────────────────────────
  server.registerTool(
    'haszno_account_get_impact',
    {
      title: 'Get profit impact report',
      description:
        "Returns the financial impact of Haszno's pricing optimisation over the last N days. " +
        '"days" — the reporting window (defaults to 30 if omitted). ' +
        '"extraProfit" — additional gross HUF profit earned compared to no-automation baseline; ' +
        '"baseline" — baseline gross profit without Haszno; ' +
        '"pctGain" — percentage uplift ((extraProfit / baseline) × 100); ' +
        '"orders" — total orders in the window; ' +
        '"autoForwardedOrders" — orders automatically forwarded to suppliers without manual action. ' +
        'All money values are gross HUF.',
      inputSchema: {
        days: z.number().int().min(1).max(365).optional().describe(
          'Look-back window in days (1–365). Defaults to 30 when omitted.',
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args) => {
      try {
        const impact = await client.stats.getImpact({ days: args.days })
        return json(impact)
      } catch (e) {
        return mkErr(`Failed to fetch impact report: ${String(e)}`)
      }
    },
  )

  // ─── haszno_account_list_suppliers ──────────────────────────────────────────
  server.registerTool(
    'haszno_account_list_suppliers',
    {
      title: 'List active supplier integrations',
      description:
        "Returns the shop's own supplier integrations — the suppliers whose catalogues have been imported. " +
        'Each entry includes: "id", "name", "orderMode" (simulated | email), "email" for email-based ordering, ' +
        '"network" (true if this is a network/marketplace supplier), "category", "country", "shopUrl", "createdAt". ' +
        'Note: this is different from haszno_catalog_list_suppliers which lists the full partner marketplace. ' +
        "Use this to identify which supplier a product belongs to, or to understand the shop's supply chain.",
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => {
      try {
        const suppliers = await client.suppliers.list()
        return json(suppliers)
      } catch (e) {
        return mkErr(`Failed to list suppliers: ${String(e)}`)
      }
    },
  )

  // ─── haszno_account_configure ───────────────────────────────────────────────
  server.registerTool(
    'haszno_account_configure',
    {
      title: 'Save API credentials to local config',
      description:
        'Writes Haszno API credentials to ~/.config/haszno/config.json (chmod 600) so the CLI and MCP server ' +
        'can read them without requiring environment variables on every invocation. ' +
        'Provide "apiUrl" (default https://haszno.com) and either "apiKey" (sent as the x-api-key header) or ' +
        '"basicAuth" ("user:pass" for HTTP Basic — only used while per-shop API keys are unavailable). ' +
        'The file is created with restricted permissions (owner read/write only) and credentials are NEVER logged. ' +
        'Requires confirm: true. ' +
        'WARNING: overwrites any previously saved credentials.',
      inputSchema: {
        apiUrl: z.string().url().describe(
          'Base URL of the Haszno API, default https://haszno.com',
        ),
        apiKey: z.string().min(1).optional().describe(
          'API key, sent as the x-api-key header (preferred). Provide this OR basicAuth, not both.',
        ),
        basicAuth: z.string().regex(/^[^:]+:[^:]+$/).optional().describe(
          'HTTP Basic credentials in "user:pass" format. Fallback when API keys are not yet available.',
        ),
        confirm: z.literal(true).describe(
          'Must be exactly true. This is a safeguard — always pass true explicitly.',
        ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      if (!args.apiKey && !args.basicAuth) {
        return mkErr('Provide either apiKey or basicAuth (not both omitted).')
      }
      if (args.apiKey && args.basicAuth) {
        return mkErr('Provide either apiKey or basicAuth — not both.')
      }

      const configDir = path.join(os.homedir(), '.config', 'haszno')
      const configFile = path.join(configDir, 'config.json')

      try {
        // Read existing flat config (or start fresh)
        let existing: Record<string, string> = {}
        try {
          const raw = fs.readFileSync(configFile, 'utf8')
          existing = JSON.parse(raw) as Record<string, string>
        } catch {
          // File does not exist or is not valid JSON — start fresh
        }

        const written: Record<string, string> = {
          ...existing,
          apiUrl: args.apiUrl,
        }
        if (args.apiKey) {
          written['apiKey'] = args.apiKey
        } else if (args.basicAuth) {
          written['basicAuth'] = args.basicAuth
        }

        fs.mkdirSync(configDir, { recursive: true, mode: 0o700 })
        fs.writeFileSync(configFile, JSON.stringify(written, null, 2), { mode: 0o600 })

        return json({
          saved: true,
          configFile,
          apiUrl: args.apiUrl,
          authMethod: args.apiKey ? 'apiKey' : 'basicAuth',
        })
      } catch (e) {
        return mkErr(`Failed to save config: ${String(e)}`)
      }
    },
  )

  // ─── haszno_account_whoami ──────────────────────────────────────────────────
  server.registerTool(
    'haszno_account_whoami',
    {
      title: 'Who am I (identity check)',
      description:
        'Returns the identity of the currently authenticated shop: id, email, name, shopId, shopName, ' +
        'founderSince, role, and tokenScope.\n\n' +
        'Works with every credential mode (Bearer shop token, HTTP Basic, x-api-key).\n\n' +
        'The tokenScope field is especially useful for shop API tokens: ' +
        '"read" means GET-only access; "write" means full agent access including POST /api/agent/proposals. ' +
        'A null tokenScope means session or legacy key (all operations available).\n\n' +
        'Use this as the recommended first call to verify credentials and discover your scope. ' +
        'GET /api/v1/auth/me.',
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => {
      try {
        const identity = await client.auth.me()
        return json(identity)
      } catch (e) {
        if (e instanceof Error) {
          const hint =
            (e as { status?: number }).status === 401
              ? ' (token érvénytelen, lejárt vagy visszavont — ellenőrizd a HASZNO_API_TOKEN értékét)'
              : ''
          return mkErr(`haszno_account_whoami sikertelen: ${e.message}${hint}`)
        }
        return mkErr(`haszno_account_whoami: ${String(e)}`)
      }
    },
  )

  // ─── haszno_auth_revoke_token ───────────────────────────────────────────────
  server.registerTool(
    'haszno_auth_revoke_token',
    {
      title: 'Revoke current Bearer token',
      description:
        'Revokes the shop API token used by the current MCP session. ' +
        'After revocation the token is dead immediately (the server does a live DB lookup on every request).\n\n' +
        '**Only works with a Bearer shop API token (haszno_)** — calling this with Basic or x-api-key returns an error.\n\n' +
        'POST /api/v1/auth/tokens/revoke-current — returns { ok: true }.\n\n' +
        'Use this when decommissioning a CI/CD agent or rotating credentials. ' +
        'Requires confirm: true.',
      inputSchema: {
        confirm: z.literal(true).describe('Must be exactly true (safety gate — this is irreversible).'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async () => {
      try {
        const result = await client.auth.revokeCurrentToken()
        return json({ ...result, note: 'Token visszavonva. A kapcsolat ezentúl 401-gyel fog visszatérni.' })
      } catch (e) {
        if (e instanceof Error) {
          return mkErr(`haszno_auth_revoke_token sikertelen: ${e.message}`)
        }
        return mkErr(`haszno_auth_revoke_token: ${String(e)}`)
      }
    },
  )
}
