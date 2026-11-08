/**
 * MCP tools — Automatikák (rule engine + kill switch).
 *
 * Domain: rules
 * Endpoints:
 *   GET  /api/rules/templates           → haszno_rules_list_templates  (read-only)
 *   GET  /api/rules                     → haszno_rules_list            (read-only)
 *   POST /api/rules                     → haszno_rules_create          (write, confirm)
 *   PATCH /api/rules/:id                → haszno_rules_update          (write, confirm)
 *   DELETE /api/rules/:id               → haszno_rules_delete          (write, destructive, confirm)
 *   POST /api/rules/:id/run             → haszno_rules_run             (write, confirm)
 *   POST /api/rules/run-all             → haszno_rules_run_all         (write, confirm)
 *   POST /api/rules/trigger             → haszno_rules_trigger         (write, confirm)
 *   GET  /api/rule-runs                 → haszno_rules_list_runs       (read-only)
 *   POST /api/rule-runs/undo            → haszno_rules_undo_unlists    (write, confirm)
 *   GET  /api/automation                → haszno_automation_get        (read-only)
 *   PUT  /api/automation                → haszno_automation_set        (write, idempotent, confirm)
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { HasznoClient } from '../client/index.js'

// ---- internal helpers ----

type TextResult = { content: Array<{ type: 'text'; text: string }>; isError?: true }

function ok(data: unknown): TextResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] }
}

async function wrap<T>(fn: () => Promise<T>): Promise<TextResult> {
  try {
    return ok(await fn())
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }
  }
}

// ---- shared sub-schemas (reused across create/update) ----

const conditionSchema = z.object({
  field: z.string().describe(
    'Product field to test. Known values: "stock", "marginPct", "recommendedChange", "priceGross".',
  ),
  op: z.enum(['lt', 'lte', 'gt', 'gte', 'eq', 'neq', 'changed']).describe(
    'Comparison operator: lt/lte/gt/gte compare numbers; eq/neq compare equality; changed detects any change.',
  ),
  value: z.union([z.number(), z.string(), z.null()]).optional().describe(
    'Threshold value. Omit or null for the "changed" operator.',
  ),
})

const actionSchema = z.object({
  type: z.string().describe(
    'Action type. Known values: "unlist" (remove from shop), "propose_price" (create price proposal), "notify" (log a warning).',
  ),
  params: z.record(z.string(), z.unknown()).optional().describe(
    'Action-specific parameters. For propose_price: {strategy, maxChangePct, tiers?}. For notify: {text}.',
  ),
})

// ---- registration ----

export function registerRulesTools(server: McpServer, client: HasznoClient): void {
  // ===========================================================
  //  READ-ONLY: list templates
  // ===========================================================

  server.registerTool(
    'haszno_rules_list_templates',
    {
      description:
        'List the built-in pricing-rule templates available for instantiation. ' +
        "Returns each template's key, human-readable name, description, trigger event, " +
        'preconfigured conditions, and actions. ' +
        'Call this before creating a rule to discover available starting points: ' +
        '"keszlet_or" (stock-out protection), "arjavaslat" (auto price-proposal on market update), ' +
        '"felar_savok" (AutoDS-style markup tiers), "veszteseg_riasztas" (loss-alert + floor price). ' +
        'Read-only — always safe to call.',
      annotations: { readOnlyHint: true },
    },
    () => wrap(() => client.rules.listTemplates()),
  )

  // ===========================================================
  //  READ-ONLY: list rules
  // ===========================================================

  server.registerTool(
    'haszno_rules_list',
    {
      description:
        'List all automation rules configured for this shop. ' +
        "Returns each rule's id, name, enabled flag, trigger event, conditions, actions, " +
        'template key (if created from one), and creation date. ' +
        'Use to audit active automations, find a rule id before running or updating it, ' +
        'or check whether automation is configured at all. ' +
        'Read-only — always safe to call.',
      annotations: { readOnlyHint: true },
    },
    () => wrap(() => client.rules.list()),
  )

  // ===========================================================
  //  READ-ONLY: list rule-run log
  // ===========================================================

  server.registerTool(
    'haszno_rules_list_runs',
    {
      description:
        'Fetch the rule-execution log. ' +
        'Returns entries ordered newest-first, each with: run id, rule id, rule name, ' +
        'trigger event, affected product id (or null for bulk runs), human-readable outcome summary, ' +
        'and ISO timestamp. ' +
        'Default limit is 25; pass limit (1–200) to get more. ' +
        'Use to audit what automation has done, find products that were automatically unlisted, ' +
        'or collect run-log IDs before calling haszno_rules_undo_unlists. ' +
        'Entries where summary starts with "Levéve" are unlist actions that can be undone. ' +
        'Read-only — always safe to call.',
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe('Max entries to return (1–200). Default 25.'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ limit }) => wrap(() => client.rules.listRuns({ limit: limit ?? 25 })),
  )

  // ===========================================================
  //  READ-ONLY: automation kill switch status
  // ===========================================================

  server.registerTool(
    'haszno_automation_get',
    {
      description:
        'Check the global automation kill switch. ' +
        'Returns {paused: boolean}. ' +
        'When paused=true, the server blocks proposal-approve requests (returns HTTP 409). ' +
        'Always call this before attempting to approve proposals if the last attempt returned a 409 error, ' +
        'or before running automations if behaviour seems blocked. ' +
        'Read-only — always safe to call.',
      annotations: { readOnlyHint: true },
    },
    () => wrap(() => client.automation.get()),
  )

  // ===========================================================
  //  WRITE: create rule
  // ===========================================================

  server.registerTool(
    'haszno_rules_create',
    {
      description:
        'Create a new automation rule. ' +
        'Pass template="keszlet_or" (or another key from haszno_rules_list_templates) to prefill ' +
        'trigger/conditions/actions from that template — override any fields you want. ' +
        'Without a template, provide trigger, conditions (optional), and at least one action. ' +
        'trigger values: "feed_import" (runs after every feed import), "market_price" (runs after market-price refresh), ' +
        '"manual" (only runs when explicitly triggered). ' +
        'enabled defaults to true; set false to create the rule paused. ' +
        'Returns the created rule with its id. ' +
        'confirm must be true.',
      inputSchema: {
        confirm: z.literal(true).describe('Must be true to execute this write operation.'),
        name: z.string().min(1).max(120).describe('Human-readable rule name (1–120 chars).'),
        enabled: z.boolean().optional().describe('Whether the rule runs automatically. Defaults to true.'),
        trigger: z.string().describe(
          'Event that fires this rule: "feed_import", "market_price", "manual", or any custom string.',
        ),
        conditions: z.array(conditionSchema).optional().describe(
          'Conditions that must ALL match for a product to be acted on. Empty or omitted means all products.',
        ),
        actions: z.array(actionSchema).describe(
          'Actions to perform on matching products. At least one required.',
        ),
        template: z.string().nullable().optional().describe(
          'Template key this rule was based on (informational; use haszno_rules_list_templates to list keys).',
        ),
      },
    },
    ({ confirm: _c, name, enabled, trigger, conditions, actions, template }) =>
      wrap(() => client.rules.create({ name, enabled, trigger, conditions, actions, template })),
  )

  // ===========================================================
  //  WRITE: update rule
  // ===========================================================

  server.registerTool(
    'haszno_rules_update',
    {
      description:
        'Update an existing rule. Only the fields you send are changed; omit a field to leave it unchanged. ' +
        'Most common use: toggle enabled on/off with {id, enabled: false/true}. ' +
        'You can also rename, change the trigger, adjust conditions, or replace all actions. ' +
        'Get rule ids from haszno_rules_list. ' +
        'confirm must be true.',
      inputSchema: {
        confirm: z.literal(true).describe('Must be true to execute this write operation.'),
        id: z.number().int().describe('Rule id (from haszno_rules_list).'),
        name: z.string().min(1).max(120).optional().describe('New name (1–120 chars). Omit to keep current.'),
        enabled: z.boolean().optional().describe('true = active, false = paused. Omit to keep current.'),
        trigger: z.string().optional().describe('New trigger event. Omit to keep current.'),
        conditions: z.array(conditionSchema).optional().describe('Replace all conditions. Omit to keep current.'),
        actions: z.array(actionSchema).optional().describe('Replace all actions. Omit to keep current.'),
      },
    },
    ({ confirm: _c, id, name, enabled, trigger, conditions, actions }) =>
      wrap(() => client.rules.update(id, { name, enabled, trigger, conditions, actions })),
  )

  // ===========================================================
  //  WRITE: delete rule (destructive)
  // ===========================================================

  server.registerTool(
    'haszno_rules_delete',
    {
      description:
        'Permanently delete a rule and its entire run-history. This CANNOT be undone. ' +
        'Prefer disabling the rule (haszno_rules_update with enabled=false) for reversible deactivation. ' +
        'Only delete when the rule is permanently no longer needed. ' +
        'Get rule ids from haszno_rules_list. ' +
        'confirm must be true.',
      inputSchema: {
        confirm: z.literal(true).describe('Must be true to execute this destructive operation.'),
        id: z.number().int().describe('Rule id to delete permanently (from haszno_rules_list).'),
      },
      annotations: { destructiveHint: true },
    },
    ({ confirm: _c, id }) => wrap(() => client.rules.delete(id)),
  )

  // ===========================================================
  //  WRITE: run one rule manually
  // ===========================================================

  server.registerTool(
    'haszno_rules_run',
    {
      description:
        'Manually run a single rule against all currently eligible products, regardless of its trigger setting. ' +
        'Returns {applied, skipped, errors} counts. ' +
        'Use for one-off rule application (e.g. re-price after a manual cost update) or to test a rule before enabling it. ' +
        'If the rule has an "unlist" action and products get delisted, use haszno_rules_list_runs + ' +
        'haszno_rules_undo_unlists to reverse. ' +
        'Get rule ids from haszno_rules_list. ' +
        'confirm must be true.',
      inputSchema: {
        confirm: z.literal(true).describe('Must be true to execute this write operation.'),
        id: z.number().int().describe('Rule id to run (from haszno_rules_list).'),
      },
    },
    ({ confirm: _c, id }) => wrap(() => client.rules.run(id)),
  )

  // ===========================================================
  //  WRITE: run all manual rules
  // ===========================================================

  server.registerTool(
    'haszno_rules_run_all',
    {
      description:
        'Run all currently ENABLED rules whose trigger is "manual" in one shot. ' +
        'Returns aggregate {applied, skipped, errors} counts. ' +
        'Use for bulk re-pricing or cleanup tasks (e.g. apply markup tiers across the whole catalogue). ' +
        'confirm must be true.',
      inputSchema: {
        confirm: z.literal(true).describe('Must be true to execute this write operation.'),
      },
    },
    ({ confirm: _c }) => wrap(() => client.rules.runAll()),
  )

  // ===========================================================
  //  WRITE: fire rules by trigger event
  // ===========================================================

  server.registerTool(
    'haszno_rules_trigger',
    {
      description:
        'Fire all ENABLED rules that listen to a specific trigger event, optionally scoped to a subset of product ids. ' +
        'Returns aggregate {applied, skipped, errors} counts. ' +
        'Trigger values: "feed_import" (simulate a feed-import event), "market_price" (simulate a market-price refresh), ' +
        '"manual", or any custom trigger string. ' +
        'Use to replay an event, test trigger-based rules, or selectively apply automation to specific products. ' +
        'confirm must be true.',
      inputSchema: {
        confirm: z.literal(true).describe('Must be true to execute this write operation.'),
        trigger: z.string().describe('Trigger event name, e.g. "feed_import", "market_price", "manual".'),
        product_ids: z.array(z.number().int()).optional().describe(
          'Restrict execution to these product ids. Omit to run on all eligible products.',
        ),
      },
    },
    ({ confirm: _c, trigger, product_ids }) =>
      wrap(() => client.rules.trigger({ trigger, productIds: product_ids })),
  )

  // ===========================================================
  //  WRITE: undo unlist actions from run log
  // ===========================================================

  server.registerTool(
    'haszno_rules_undo_unlists',
    {
      description:
        'Undo "unlist" actions recorded in the rule-execution log — re-lists products that were automatically ' +
        'delisted by a rule and marks those log entries as "(visszavonva)" (reversed). ' +
        'Two targeting modes: ' +
        '  ids=[...] — undo specific run-log row IDs (get these from haszno_rules_list_runs); ' +
        '  rule_id + at — undo all unlists from a specific rule at a specific ISO timestamp. ' +
        'Only log entries whose summary starts with "Levéve" (and are not already reversed) are affected. ' +
        'Returns {relisted: N} with the count of re-listed products. ' +
        'Use after an accidental bulk-unlist or after reviewing rule results and deciding to reverse them. ' +
        'confirm must be true.',
      inputSchema: {
        confirm: z.literal(true).describe('Must be true to execute this write operation.'),
        ids: z.array(z.number().int()).optional().describe(
          'Run-log row IDs to undo (from haszno_rules_list_runs). Use this OR rule_id+at, not both.',
        ),
        rule_id: z.number().int().optional().describe(
          'Rule id: undo all unlists from this rule at the given timestamp (use with at).',
        ),
        at: z.string().optional().describe(
          'ISO timestamp of the rule run to undo (use with rule_id). ' +
            'Example: "2024-05-10T14:32:00.000Z".',
        ),
      },
    },
    ({ confirm: _c, ids, rule_id, at }) =>
      wrap(() => client.rules.undoUnlists({ ids, ruleId: rule_id, at })),
  )

  // ===========================================================
  //  WRITE: automation kill switch (idempotent)
  // ===========================================================

  server.registerTool(
    'haszno_automation_set',
    {
      description:
        'Toggle the global automation kill switch. ' +
        'Pass paused=true to pause all automations: proposal-approve will return HTTP 409 until resumed. ' +
        'Pass paused=false to resume normal operation. ' +
        'This is idempotent — setting to the current state is harmless. ' +
        'Always check haszno_automation_get first to know the current state. ' +
        'confirm must be true.',
      inputSchema: {
        confirm: z.literal(true).describe('Must be true to execute this write operation.'),
        paused: z.boolean().describe('true = pause all automations and block approvals; false = resume.'),
      },
      annotations: { idempotentHint: true },
    },
    ({ confirm: _c, paused }) => wrap(() => client.automation.set({ paused })),
  )
}
