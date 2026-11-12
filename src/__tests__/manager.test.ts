/**
 * Unit tests for src/tools/manager.ts
 * No network calls — all client.manager methods are mocked.
 */
import { describe, it, expect, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { HasznoClient, DailyReport, DailyReportSummary, ResearchBrief, AgentAction } from '../client/index.js'
import { registerManagerTools } from '../tools/manager.js'

// ---- minimal server mock -------------------------------------------------------

type TextBlock = { type: string; text: string }
type ToolResult = { content: TextBlock[] }
type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<ToolResult>

interface CapturedTool {
  config: Record<string, unknown>
  handler: ToolHandler
}

function makeMockServer() {
  const tools = new Map<string, CapturedTool>()
  const server: Partial<McpServer> = {
    registerTool(name: string, config: unknown, handler: unknown) {
      tools.set(name, {
        config: config as Record<string, unknown>,
        handler: handler as ToolHandler,
      })
      return {} as ReturnType<McpServer['registerTool']>
    },
  }
  return { server: server as McpServer, tools }
}

function parsed(result: ToolResult): unknown {
  return JSON.parse(result.content[0].text)
}

function callTool(
  tools: Map<string, CapturedTool>,
  name: string,
  args: Record<string, unknown> = {},
) {
  const tool = tools.get(name)
  if (!tool) throw new Error(`Tool not registered: ${name}`)
  return tool.handler(args, {})
}

// ---- fixtures ------------------------------------------------------------------

const REPORT_SUMMARY: DailyReportSummary = {
  id: 1,
  day: '2026-11-12',
  headline: 'PS5 Pro ára emelkedett',
  itemCount: 5,
  agentItemCount: 2,
}

const REPORT: DailyReport = {
  id: 1,
  day: '2026-11-12',
  headline: 'PS5 Pro ára emelkedett',
  summary: 'Rövid összefoglaló',
  items: [
    {
      id: 10,
      origin: 'agent',
      kind: 'hir',
      title: 'PS5 Pro ára emelkedett',
      body: 'A PS5 Pro piaci minimális ára 10%-ot emelkedett az elmúlt 24 órában.',
      changePct: 10.0,
      keyword: 'PS5 Pro',
      productId: null,
      productName: null,
      sourceName: 'IGN',
      sourceUrl: 'https://ign.com/ps5pro',
      suggestedAction: null,
      action: null,
    },
  ],
  createdAt: '2026-11-12T06:00:00Z',
  updatedAt: '2026-11-12T08:00:00Z',
}

const RESEARCH_BRIEF: ResearchBrief = {
  day: '2026-11-12',
  shopFocus: [
    {
      keyword: 'PS5 Pro',
      productId: 42,
      name: 'PlayStation 5 Pro',
      priceGross: 249990,
      marketMinGross: 239990,
      trend: 'emelkedo',
    },
  ],
  questions: ['Milyen ártrendek figyelhetők meg a PS5 Pro piacon?'],
  postTo: '/api/daily-reports/2026-11-12/findings',
}

const AGENT_ACTION: AgentAction = {
  id: 7,
  action: { type: 'ar', productId: 42, priceGross: 244990 },
  reason: 'Piac minimuma emelkedett, érdemes módosítani.',
  status: 'javasolt',
  origin: 'agent',
  autoApproved: false,
  reportItemId: 10,
  target: { name: 'PlayStation 5 Pro', sku: 'PS5PRO', imageUrl: null },
  preview: {
    oldPriceGross: 249990,
    newPriceGross: 244990,
    floorGross: 220000,
    marginPct: 18.5,
  },
  error: null,
  canUndo: false,
  createdAt: '2026-11-12T09:00:00Z',
  decidedAt: null,
  executedAt: null,
}

// ---- minimal client mock -------------------------------------------------------

function makeMockClient(overrides: Partial<HasznoClient['manager']> = {}): HasznoClient {
  const manager: HasznoClient['manager'] = {
    listReports: vi.fn().mockResolvedValue([REPORT_SUMMARY]),
    getReport: vi.fn().mockResolvedValue(REPORT),
    getResearchBrief: vi.fn().mockResolvedValue(RESEARCH_BRIEF),
    postFindings: vi.fn().mockResolvedValue(REPORT),
    listActions: vi.fn().mockResolvedValue([AGENT_ACTION]),
    proposeAction: vi.fn().mockResolvedValue(AGENT_ACTION),
    rejectAction: vi.fn().mockResolvedValue(AGENT_ACTION),
    ...overrides,
  }
  return { manager } as unknown as HasznoClient
}

// ---- tests ---------------------------------------------------------------------

describe('registerManagerTools', () => {
  it('registers all 6 tools', () => {
    const { server, tools } = makeMockServer()
    registerManagerTools(server, makeMockClient())
    expect(tools.has('haszno_daily_report')).toBe(true)
    expect(tools.has('haszno_research_brief')).toBe(true)
    expect(tools.has('haszno_post_findings')).toBe(true)
    expect(tools.has('haszno_list_actions')).toBe(true)
    expect(tools.has('haszno_propose_action')).toBe(true)
    expect(tools.has('haszno_withdraw_action')).toBe(true)
    // Approve / undo / autopilot-write deliberately NOT registered.
    expect(tools.has('haszno_approve_action')).toBe(false)
    expect(tools.has('haszno_undo_action')).toBe(false)
    expect(tools.has('haszno_autopilot_set')).toBe(false)
  })
})

describe('haszno_daily_report', () => {
  it('returns list when list=true', async () => {
    const { server, tools } = makeMockServer()
    registerManagerTools(server, makeMockClient())
    const result = await callTool(tools, 'haszno_daily_report', { list: true })
    const data = parsed(result) as { reports: DailyReportSummary[] }
    expect(data.reports).toHaveLength(1)
    expect(data.reports[0].day).toBe('2026-11-12')
  })

  it('returns latest report when no day given', async () => {
    const { server, tools } = makeMockServer()
    registerManagerTools(server, makeMockClient())
    const result = await callTool(tools, 'haszno_daily_report', {})
    const data = parsed(result) as { report: DailyReport }
    expect(data.report.day).toBe('2026-11-12')
    expect(data.report.items).toHaveLength(1)
  })

  it('fetches report by specific day', async () => {
    const getReport = vi.fn().mockResolvedValue(REPORT)
    const { server, tools } = makeMockServer()
    registerManagerTools(server, makeMockClient({ getReport }))
    await callTool(tools, 'haszno_daily_report', { day: '2026-11-12' })
    expect(getReport).toHaveBeenCalledWith('2026-11-12')
  })

  it('rejects invalid day format', async () => {
    const { server, tools } = makeMockServer()
    registerManagerTools(server, makeMockClient())
    const result = await callTool(tools, 'haszno_daily_report', { day: 'nem-datum' })
    const data = parsed(result) as { error: string }
    expect(data.error).toMatch(/Érvénytelen dátum/)
  })

  it('handles null report (no report for day)', async () => {
    const { server, tools } = makeMockServer()
    registerManagerTools(server, makeMockClient({ getReport: vi.fn().mockResolvedValue(null) }))
    const result = await callTool(tools, 'haszno_daily_report', { day: '2026-01-01' })
    const data = parsed(result) as { report: null; message: string }
    expect(data.report).toBeNull()
    expect(data.message).toMatch(/nem készült/)
  })
})

describe('haszno_research_brief', () => {
  it('returns the research brief', async () => {
    const { server, tools } = makeMockServer()
    registerManagerTools(server, makeMockClient())
    const result = await callTool(tools, 'haszno_research_brief', {})
    const brief = parsed(result) as ResearchBrief
    expect(brief.day).toBe('2026-11-12')
    expect(brief.shopFocus).toHaveLength(1)
    expect(brief.questions).toHaveLength(1)
    expect(brief.postTo).toContain('/findings')
  })
})

describe('haszno_post_findings', () => {
  const VALID_ARGS = {
    day: '2026-11-12',
    headline: 'Teszt headline',
    items: [
      {
        kind: 'hir',
        title: 'PS5 Pro ára emelkedett',
        body: 'A PS5 Pro piaci minimuma 10%-ot emelkedett az elmúlt 24 órában.',
        changePct: 10.0,
        sourceName: 'IGN',
        sourceUrl: 'https://ign.com/ps5pro',
      },
    ],
  }

  it('posts findings and returns updated report', async () => {
    const postFindings = vi.fn().mockResolvedValue(REPORT)
    const { server, tools } = makeMockServer()
    registerManagerTools(server, makeMockClient({ postFindings }))
    const result = await callTool(tools, 'haszno_post_findings', VALID_ARGS)
    const data = parsed(result) as { report: DailyReport }
    expect(data.report.day).toBe('2026-11-12')
    expect(postFindings).toHaveBeenCalledWith('2026-11-12', expect.objectContaining({
      headline: 'Teszt headline',
      items: expect.arrayContaining([
        expect.objectContaining({ kind: 'hir', title: 'PS5 Pro ára emelkedett' }),
      ]),
    }))
  })

  it('rejects invalid day format', async () => {
    const { server, tools } = makeMockServer()
    registerManagerTools(server, makeMockClient())
    const result = await callTool(tools, 'haszno_post_findings', {
      ...VALID_ARGS,
      day: 'tegnap',
    })
    const data = parsed(result) as { error: string }
    expect(data.error).toMatch(/Érvénytelen dátum/)
  })

  it('rejects non-http sourceUrl', async () => {
    const { server, tools } = makeMockServer()
    registerManagerTools(server, makeMockClient())
    const result = await callTool(tools, 'haszno_post_findings', {
      day: '2026-11-12',
      items: [
        {
          kind: 'hir',
          title: 'Teszt cím valami szöveg',
          body: 'Legalább tíz karakter a body szöveghez.',
          sourceUrl: 'ftp://valahol.hu',
        },
      ],
    })
    const data = parsed(result) as { error: string }
    expect(data.error).toMatch(/Érvénytelen sourceUrl/)
  })

  it('accepts null sourceUrl', async () => {
    const postFindings = vi.fn().mockResolvedValue(REPORT)
    const { server, tools } = makeMockServer()
    registerManagerTools(server, makeMockClient({ postFindings }))
    const result = await callTool(tools, 'haszno_post_findings', {
      day: '2026-11-12',
      items: [
        {
          kind: 'trend',
          title: 'Konzol kereslet emelkedik',
          body: 'A GTA VI megjelenése után konzol-kereslet emelkedés várható.',
          sourceUrl: null,
        },
      ],
    })
    const data = parsed(result) as { report: DailyReport }
    expect(data.report).toBeDefined()
  })
})

describe('haszno_list_actions', () => {
  it('returns actions list', async () => {
    const { server, tools } = makeMockServer()
    registerManagerTools(server, makeMockClient())
    const result = await callTool(tools, 'haszno_list_actions', {})
    const data = parsed(result) as { actions: AgentAction[]; count: number }
    expect(data.actions).toHaveLength(1)
    expect(data.count).toBe(1)
    expect(data.actions[0].id).toBe(7)
  })

  it('passes status and limit filters to client', async () => {
    const listActions = vi.fn().mockResolvedValue([])
    const { server, tools } = makeMockServer()
    registerManagerTools(server, makeMockClient({ listActions }))
    await callTool(tools, 'haszno_list_actions', { status: 'javasolt', limit: 10 })
    expect(listActions).toHaveBeenCalledWith({ status: 'javasolt', limit: 10 })
  })
})

describe('haszno_propose_action', () => {
  it('proposes an ar action', async () => {
    const proposeAction = vi.fn().mockResolvedValue(AGENT_ACTION)
    const { server, tools } = makeMockServer()
    registerManagerTools(server, makeMockClient({ proposeAction }))
    const result = await callTool(tools, 'haszno_propose_action', {
      type: 'ar',
      productId: 42,
      priceGross: 244990,
      reason: 'Piac minimuma emelkedett.',
    })
    const data = parsed(result) as { action: AgentAction }
    expect(data.action.id).toBe(7)
    expect(proposeAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ar', productId: 42, priceGross: 244990 }),
    )
  })

  it('proposes a felvetel action', async () => {
    const proposeAction = vi.fn().mockResolvedValue({ ...AGENT_ACTION, action: { type: 'felvetel', productId: 5 } })
    const { server, tools } = makeMockServer()
    registerManagerTools(server, makeMockClient({ proposeAction }))
    await callTool(tools, 'haszno_propose_action', {
      type: 'felvetel',
      productId: 5,
      reason: 'Trendelő termék, érdemes feltüntetni.',
    })
    expect(proposeAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'felvetel', productId: 5 }),
    )
  })

  it('proposes an import action', async () => {
    const proposeAction = vi.fn().mockResolvedValue(AGENT_ACTION)
    const { server, tools } = makeMockServer()
    registerManagerTools(server, makeMockClient({ proposeAction }))
    await callTool(tools, 'haszno_propose_action', {
      type: 'import',
      networkProductId: 999,
      reason: 'Érdemes importlistára venni.',
    })
    expect(proposeAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'import', networkProductId: 999 }),
    )
  })

  it('returns error when ar action has no priceGross', async () => {
    const { server, tools } = makeMockServer()
    registerManagerTools(server, makeMockClient())
    const result = await callTool(tools, 'haszno_propose_action', {
      type: 'ar',
      productId: 42,
      reason: 'Hiányzik az ár.',
    })
    const data = parsed(result) as { error: string }
    expect(data.error).toMatch(/priceGross/)
  })

  it('returns error when felvetel action has no productId', async () => {
    const { server, tools } = makeMockServer()
    registerManagerTools(server, makeMockClient())
    const result = await callTool(tools, 'haszno_propose_action', {
      type: 'felvetel',
      reason: 'Hiányzik a termék.',
    })
    const data = parsed(result) as { error: string }
    expect(data.error).toMatch(/productId/)
  })

  it('returns error when import action has no networkProductId', async () => {
    const { server, tools } = makeMockServer()
    registerManagerTools(server, makeMockClient())
    const result = await callTool(tools, 'haszno_propose_action', {
      type: 'import',
      reason: 'Hiányzik a hálózati termék.',
    })
    const data = parsed(result) as { error: string }
    expect(data.error).toMatch(/networkProductId/)
  })

  it('passes reportItemId when provided', async () => {
    const proposeAction = vi.fn().mockResolvedValue(AGENT_ACTION)
    const { server, tools } = makeMockServer()
    registerManagerTools(server, makeMockClient({ proposeAction }))
    await callTool(tools, 'haszno_propose_action', {
      type: 'ar',
      productId: 42,
      priceGross: 244990,
      reason: 'Napi jelentés alapján.',
      reportItemId: 10,
    })
    expect(proposeAction).toHaveBeenCalledWith(
      expect.objectContaining({ reportItemId: 10 }),
    )
  })
})

describe('haszno_withdraw_action', () => {
  it('successfully withdraws an action', async () => {
    const withdrawnAction: AgentAction = { ...AGENT_ACTION, status: 'visszavonva' }
    const rejectAction = vi.fn().mockResolvedValue(withdrawnAction)
    const { server, tools } = makeMockServer()
    registerManagerTools(server, makeMockClient({ rejectAction }))
    const result = await callTool(tools, 'haszno_withdraw_action', { id: 7 })
    const data = parsed(result) as { action: AgentAction }
    expect(data.action.status).toBe('visszavonva')
    expect(data.action.id).toBe(7)
  })

  it('passes the correct action id to rejectAction', async () => {
    const rejectAction = vi.fn().mockResolvedValue(AGENT_ACTION)
    const { server, tools } = makeMockServer()
    registerManagerTools(server, makeMockClient({ rejectAction }))
    await callTool(tools, 'haszno_withdraw_action', { id: 42 })
    expect(rejectAction).toHaveBeenCalledWith(42)
  })
})
