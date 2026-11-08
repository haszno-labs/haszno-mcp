/**
 * Unit tests for haszno_rules_* and haszno_automation_* MCP tools.
 *
 * Strategy: mock HasznoClient entirely; spin up a real McpServer; call
 * server.server.requestHandlers to invoke the tool handler the same way the
 * transport would, then assert that the right client method was called with
 * the right arguments and that the response content is correct.
 *
 * No network required.
 */
import { describe, it, expect, vi } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { HasznoClient, Rule, RuleTemplate, RuleRun } from '../client/index.js'
import { registerRulesTools } from '../tools/rules.js'

// ---- helpers ----

type RulesOverrides = Partial<HasznoClient['rules']>
type AutomationOverrides = Partial<HasznoClient['automation']>

/** Minimal mock HasznoClient — only the rules & automation namespaces. */
function makeClient(
  rulesOverrides: RulesOverrides = {},
  automationOverrides: AutomationOverrides = {},
): HasznoClient {
  const rules: HasznoClient['rules'] = {
    listTemplates: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({
      id: 1, name: 'Test', enabled: true, trigger: 'manual',
      conditions: [], actions: [], template: null, createdAt: '2024-01-01T00:00:00Z',
    } as Rule),
    update: vi.fn().mockResolvedValue({
      id: 1, name: 'Test', enabled: false, trigger: 'manual',
      conditions: [], actions: [], template: null, createdAt: '2024-01-01T00:00:00Z',
    } as Rule),
    delete: vi.fn().mockResolvedValue({ deleted: true }),
    run: vi.fn().mockResolvedValue({ applied: 3, skipped: 1, errors: 0 }),
    runAll: vi.fn().mockResolvedValue({ applied: 5, skipped: 2, errors: 0 }),
    trigger: vi.fn().mockResolvedValue({ applied: 2, skipped: 0, errors: 0 }),
    listRuns: vi.fn().mockResolvedValue([]),
    undoUnlists: vi.fn().mockResolvedValue({ relisted: 2 }),
    ...rulesOverrides,
  }
  const automationGet = automationOverrides.get ?? vi.fn().mockResolvedValue({ paused: false })
  const automationSet = automationOverrides.set ?? vi.fn().mockResolvedValue({ paused: true })
  const automation: HasznoClient['automation'] = {
    get: automationGet,
    set: automationSet,
  }
  // return a stub — only rules and automation are tested here
  return { rules, automation } as unknown as HasznoClient
}

/** Build a server and register the rules tools, return the server + client mock. */
function setup() {
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  const client = makeClient()
  registerRulesTools(server, client)
  return { server, client }
}

/**
 * Invoke a registered tool by name on the McpServer and return its result.
 * We call the low-level handler directly — same code path the transport uses.
 *
 * In @modelcontextprotocol/sdk ≥1.32, _registeredTools is a plain object
 * (not a Map) where each value has a `handler` function.
 */
async function callTool(server: McpServer, name: string, args: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const registeredTools: Record<string, { handler?: (args: Record<string, unknown>, extra: unknown) => unknown }> = (server as any)._registeredTools
  const tool = registeredTools[name]
  if (!tool?.handler) throw new Error(`Tool "${name}" not registered or missing handler`)
  return tool.handler(args, {}) as Promise<{ content: Array<{ type: string; text: string }>; isError?: true }>
}

/** Parse the first text content item of a tool result. */
function parseResult(result: { content: Array<{ type: string; text: string }>; isError?: true }) {
  expect(result.isError).toBeUndefined()
  expect(result.content[0].type).toBe('text')
  return JSON.parse(result.content[0].text) as unknown
}

// ---- tests ----

describe('haszno_rules_list_templates', () => {
  it('calls client.rules.listTemplates() and returns JSON', async () => {
    const { server, client } = setup()
    const templates: RuleTemplate[] = [
      { key: 'keszlet_or', name: 'Készlet-őr', description: 'desc', trigger: 'feed_import', conditions: [], actions: [] },
    ]
    vi.mocked(client.rules.listTemplates).mockResolvedValueOnce(templates)

    const result = await callTool(server, 'haszno_rules_list_templates', {})
    expect(client.rules.listTemplates).toHaveBeenCalledOnce()
    expect(parseResult(result)).toEqual(templates)
  })

  it('surfaces API errors as isError=true', async () => {
    const { server, client } = setup()
    vi.mocked(client.rules.listTemplates).mockRejectedValueOnce(new Error('Network failure'))

    const result = await callTool(server, 'haszno_rules_list_templates', {})
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Network failure')
  })
})

describe('haszno_rules_list', () => {
  it('calls client.rules.list() and returns JSON array', async () => {
    const { server, client } = setup()
    const rules: Rule[] = [
      { id: 1, name: 'Rule 1', enabled: true, trigger: 'manual', conditions: [], actions: [{ type: 'unlist' }], template: null, createdAt: '2024-01-01T00:00:00Z' },
    ]
    vi.mocked(client.rules.list).mockResolvedValueOnce(rules)

    const result = await callTool(server, 'haszno_rules_list', {})
    expect(client.rules.list).toHaveBeenCalledOnce()
    expect(parseResult(result)).toEqual(rules)
  })
})

describe('haszno_rules_list_runs', () => {
  it('passes default limit=25 when no limit given', async () => {
    const { server, client } = setup()
    await callTool(server, 'haszno_rules_list_runs', {})
    expect(client.rules.listRuns).toHaveBeenCalledWith({ limit: 25 })
  })

  it('passes provided limit', async () => {
    const { server, client } = setup()
    await callTool(server, 'haszno_rules_list_runs', { limit: 50 })
    expect(client.rules.listRuns).toHaveBeenCalledWith({ limit: 50 })
  })

  it('returns run entries as JSON', async () => {
    const { server, client } = setup()
    const runs: RuleRun[] = [
      { id: 10, ruleId: 1, ruleName: 'Készlet-őr', trigger: 'feed_import', productId: 42, summary: 'Levéve: Product A (stock=0)', at: '2024-05-10T14:00:00Z' },
    ]
    vi.mocked(client.rules.listRuns).mockResolvedValueOnce(runs)
    const result = await callTool(server, 'haszno_rules_list_runs', {})
    expect(parseResult(result)).toEqual(runs)
  })
})

describe('haszno_automation_get', () => {
  it('calls client.automation.get() and returns paused status', async () => {
    const { server, client } = setup()
    vi.mocked(client.automation.get).mockResolvedValueOnce({ paused: true })

    const result = await callTool(server, 'haszno_automation_get', {})
    expect(client.automation.get).toHaveBeenCalledOnce()
    expect(parseResult(result)).toEqual({ paused: true })
  })
})

describe('haszno_rules_create', () => {
  it('passes all fields to client.rules.create()', async () => {
    const { server, client } = setup()
    await callTool(server, 'haszno_rules_create', {
      confirm: true,
      name: 'My Rule',
      enabled: false,
      trigger: 'manual',
      conditions: [{ field: 'stock', op: 'eq', value: 0 }],
      actions: [{ type: 'unlist' }],
      template: 'keszlet_or',
    })
    expect(client.rules.create).toHaveBeenCalledWith({
      name: 'My Rule',
      enabled: false,
      trigger: 'manual',
      conditions: [{ field: 'stock', op: 'eq', value: 0 }],
      actions: [{ type: 'unlist' }],
      template: 'keszlet_or',
    })
  })

  it('returns the created rule', async () => {
    const { server, client } = setup()
    const created: Rule = { id: 7, name: 'My Rule', enabled: true, trigger: 'manual', conditions: [], actions: [{ type: 'unlist' }], template: null, createdAt: '2024-01-01T00:00:00Z' }
    vi.mocked(client.rules.create).mockResolvedValueOnce(created)

    const result = await callTool(server, 'haszno_rules_create', {
      confirm: true,
      name: 'My Rule',
      trigger: 'manual',
      actions: [{ type: 'unlist' }],
    })
    expect(parseResult(result)).toEqual(created)
  })
})

describe('haszno_rules_update', () => {
  it('passes id and changed fields to client.rules.update()', async () => {
    const { server, client } = setup()
    await callTool(server, 'haszno_rules_update', {
      confirm: true,
      id: 3,
      enabled: false,
    })
    expect(client.rules.update).toHaveBeenCalledWith(3, {
      name: undefined,
      enabled: false,
      trigger: undefined,
      conditions: undefined,
      actions: undefined,
    })
  })

  it('handles enable/disable toggle', async () => {
    const { server, client } = setup()
    await callTool(server, 'haszno_rules_update', { confirm: true, id: 5, enabled: true })
    expect(client.rules.update).toHaveBeenCalledWith(5, expect.objectContaining({ enabled: true }))
  })
})

describe('haszno_rules_delete', () => {
  it('calls client.rules.delete() with the rule id', async () => {
    const { server, client } = setup()
    await callTool(server, 'haszno_rules_delete', { confirm: true, id: 9 })
    expect(client.rules.delete).toHaveBeenCalledWith(9)
  })

  it('returns deleted=true', async () => {
    const { server, client } = setup()
    const result = await callTool(server, 'haszno_rules_delete', { confirm: true, id: 9 })
    expect(parseResult(result)).toEqual({ deleted: true })
  })
})

describe('haszno_rules_run', () => {
  it('calls client.rules.run() with the rule id', async () => {
    const { server, client } = setup()
    await callTool(server, 'haszno_rules_run', { confirm: true, id: 2 })
    expect(client.rules.run).toHaveBeenCalledWith(2)
  })

  it('returns applied/skipped/errors', async () => {
    const { server, client } = setup()
    vi.mocked(client.rules.run).mockResolvedValueOnce({ applied: 10, skipped: 3, errors: 1 })
    const result = await callTool(server, 'haszno_rules_run', { confirm: true, id: 2 })
    expect(parseResult(result)).toEqual({ applied: 10, skipped: 3, errors: 1 })
  })
})

describe('haszno_rules_run_all', () => {
  it('calls client.rules.runAll()', async () => {
    const { server, client } = setup()
    await callTool(server, 'haszno_rules_run_all', { confirm: true })
    expect(client.rules.runAll).toHaveBeenCalledOnce()
  })

  it('returns aggregate result', async () => {
    const { server, client } = setup()
    vi.mocked(client.rules.runAll).mockResolvedValueOnce({ applied: 20, skipped: 5, errors: 0 })
    const result = await callTool(server, 'haszno_rules_run_all', { confirm: true })
    expect(parseResult(result)).toEqual({ applied: 20, skipped: 5, errors: 0 })
  })
})

describe('haszno_rules_trigger', () => {
  it('passes trigger and product_ids (renamed to productIds) to client.rules.trigger()', async () => {
    const { server, client } = setup()
    await callTool(server, 'haszno_rules_trigger', {
      confirm: true,
      trigger: 'market_price',
      product_ids: [1, 2, 3],
    })
    expect(client.rules.trigger).toHaveBeenCalledWith({
      trigger: 'market_price',
      productIds: [1, 2, 3],
    })
  })

  it('works without product_ids (all products)', async () => {
    const { server, client } = setup()
    await callTool(server, 'haszno_rules_trigger', { confirm: true, trigger: 'feed_import' })
    expect(client.rules.trigger).toHaveBeenCalledWith({ trigger: 'feed_import', productIds: undefined })
  })
})

describe('haszno_rules_undo_unlists', () => {
  it('passes ids array to client.rules.undoUnlists()', async () => {
    const { server, client } = setup()
    await callTool(server, 'haszno_rules_undo_unlists', { confirm: true, ids: [10, 11] })
    expect(client.rules.undoUnlists).toHaveBeenCalledWith({ ids: [10, 11], ruleId: undefined, at: undefined })
  })

  it('passes rule_id + at to client.rules.undoUnlists()', async () => {
    const { server, client } = setup()
    await callTool(server, 'haszno_rules_undo_unlists', {
      confirm: true,
      rule_id: 3,
      at: '2024-05-10T14:00:00Z',
    })
    expect(client.rules.undoUnlists).toHaveBeenCalledWith({
      ids: undefined,
      ruleId: 3,
      at: '2024-05-10T14:00:00Z',
    })
  })

  it('returns relisted count', async () => {
    const { server, client } = setup()
    vi.mocked(client.rules.undoUnlists).mockResolvedValueOnce({ relisted: 5 })
    const result = await callTool(server, 'haszno_rules_undo_unlists', { confirm: true, ids: [10] })
    expect(parseResult(result)).toEqual({ relisted: 5 })
  })
})

describe('haszno_automation_set', () => {
  it('passes paused=true to client.automation.set()', async () => {
    const { server, client } = setup()
    await callTool(server, 'haszno_automation_set', { confirm: true, paused: true })
    expect(client.automation.set).toHaveBeenCalledWith({ paused: true })
  })

  it('passes paused=false to resume', async () => {
    const { server, client } = setup()
    await callTool(server, 'haszno_automation_set', { confirm: true, paused: false })
    expect(client.automation.set).toHaveBeenCalledWith({ paused: false })
  })

  it('returns paused state from server', async () => {
    const { server, client } = setup()
    vi.mocked(client.automation.set).mockResolvedValueOnce({ paused: false })
    const result = await callTool(server, 'haszno_automation_set', { confirm: true, paused: false })
    expect(parseResult(result)).toEqual({ paused: false })
  })
})

describe('tool annotations', () => {
  it('read-only tools have readOnlyHint=true', () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerRulesTools(server, makeClient())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: Record<string, { annotations?: Record<string, boolean> }> = (server as any)._registeredTools
    for (const name of ['haszno_rules_list_templates', 'haszno_rules_list', 'haszno_rules_list_runs', 'haszno_automation_get']) {
      expect(tools[name]?.annotations?.readOnlyHint, `${name} should have readOnlyHint`).toBe(true)
    }
  })

  it('delete tool has destructiveHint=true', () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerRulesTools(server, makeClient())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: Record<string, { annotations?: Record<string, boolean> }> = (server as any)._registeredTools
    expect(tools['haszno_rules_delete']?.annotations?.destructiveHint).toBe(true)
  })

  it('automation_set has idempotentHint=true', () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerRulesTools(server, makeClient())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: Record<string, { annotations?: Record<string, boolean> }> = (server as any)._registeredTools
    expect(tools['haszno_automation_set']?.annotations?.idempotentHint).toBe(true)
  })

  it('registers all 12 expected tools', () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerRulesTools(server, makeClient())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: Record<string, unknown> = (server as any)._registeredTools
    const expected = [
      'haszno_rules_list_templates',
      'haszno_rules_list',
      'haszno_rules_list_runs',
      'haszno_automation_get',
      'haszno_rules_create',
      'haszno_rules_update',
      'haszno_rules_delete',
      'haszno_rules_run',
      'haszno_rules_run_all',
      'haszno_rules_trigger',
      'haszno_rules_undo_unlists',
      'haszno_automation_set',
    ]
    for (const name of expected) {
      expect(name in tools, `expected tool "${name}" to be registered`).toBe(true)
    }
  })
})
