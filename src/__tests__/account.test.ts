/**
 * Unit tests for account domain MCP tools.
 * Uses a stub McpServer that captures registerTool calls, and a fully mocked
 * HasznoClient — no network required.
 *
 * The configure tool writes to the filesystem; we intercept those calls via a
 * vitest module mock on 'node:fs' using vi.hoisted() so the shared state is
 * available inside the hoisted mock factory.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Shared state for the node:fs mock ───────────────────────────────────────
// vi.hoisted ensures this is evaluated before the vi.mock factory runs.
const fsState = vi.hoisted(() => ({
  existingContent: null as string | null,
  writtenContent: null as string | null,
  mkdirCalled: false,
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    mkdirSync: vi.fn().mockImplementation(() => { fsState.mkdirCalled = true }),
    writeFileSync: vi.fn().mockImplementation((_p: unknown, data: unknown) => {
      fsState.writtenContent = String(data)
    }),
    readFileSync: vi.fn().mockImplementation(() => {
      if (fsState.existingContent !== null) return fsState.existingContent
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }),
  }
})
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { HasznoClient, Settings, Stats, Impact, Supplier } from '../client/index.js'
import { registerAccountTools } from '../tools/account.js'

// ─── Stub server that captures tool registrations ────────────────────────────

type ToolCallback = (args: Record<string, unknown>) => Promise<unknown>
type ToolConfig = {
  title?: string
  description?: string
  annotations?: Record<string, unknown>
  inputSchema?: unknown
}

function makeStubServer(): { server: McpServer; getToolCb: (name: string) => ToolCallback } {
  const tools = new Map<string, ToolCallback>()
  const server = {
    registerTool: (_name: string, _config: ToolConfig, cb: ToolCallback) => {
      tools.set(_name, cb)
      return {} // RegisteredTool stub
    },
  } as unknown as McpServer
  return {
    server,
    getToolCb: (name: string) => {
      const cb = tools.get(name)
      if (!cb) throw new Error(`Tool "${name}" was not registered`)
      return cb
    },
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseResult(result: unknown): unknown {
  const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean }
  expect(r.content[0].type).toBe('text')
  return JSON.parse(r.content[0].text)
}

function isError(result: unknown): boolean {
  return !!(result as { isError?: boolean }).isError
}

// ─── Mock client fixtures ─────────────────────────────────────────────────────

const mockSettings: Settings = {
  id: 1,
  undercutPct: 5,
  minMarginPct: 10,
  vatPct: 27,
  automationPaused: false,
}

const mockStats: Stats = {
  products: 100,
  losing: 3,
  overMarket: 12,
  toFix: 15,
  orders: 42,
}

const mockImpact: Impact = {
  days: 30,
  extraProfit: 50000,
  baseline: 500000,
  pctGain: 10,
  orders: 42,
  autoForwardedOrders: 20,
}

const mockSuppliers: Supplier[] = [
  {
    id: 1,
    name: 'Test Supplier',
    orderMode: 'email',
    email: 'supplier@example.com',
    network: false,
    category: 'electronics',
    country: 'HU',
    description: null,
    shopUrl: null,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
]

function makeClient(overrides: Partial<HasznoClient> = {}): HasznoClient {
  return {
    health: { check: vi.fn().mockResolvedValue({ ok: true }) },
    settings: {
      get: vi.fn().mockResolvedValue(mockSettings),
      update: vi.fn().mockResolvedValue(mockSettings),
    },
    stats: {
      get: vi.fn().mockResolvedValue(mockStats),
      getImpact: vi.fn().mockResolvedValue(mockImpact),
    },
    suppliers: { list: vi.fn().mockResolvedValue(mockSuppliers) },
    // Remaining domains not used in account tests — provide empty stubs
    products: {} as never,
    feeds: {} as never,
    orders: {} as never,
    recommendations: {} as never,
    rules: {} as never,
    proposals: {} as never,
    automation: {} as never,
    network: {} as never,
    ...overrides,
  } as unknown as HasznoClient
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('registerAccountTools', () => {
  let stub: ReturnType<typeof makeStubServer>
  let client: HasznoClient

  beforeEach(() => {
    stub = makeStubServer()
    client = makeClient()
    registerAccountTools(stub.server, client)
  })

  // ── haszno_ping ────────────────────────────────────────────────────────────

  describe('haszno_ping', () => {
    it('calls client.health.check and returns { ok: true }', async () => {
      const result = await stub.getToolCb('haszno_ping')({})
      expect(isError(result)).toBe(false)
      expect(parseResult(result)).toEqual({ ok: true })
      expect(client.health.check).toHaveBeenCalledTimes(1)
    })

    it('returns an error result when health.check rejects', async () => {
      vi.mocked(client.health.check).mockRejectedValueOnce(new Error('connection refused'))
      const result = await stub.getToolCb('haszno_ping')({})
      expect(isError(result)).toBe(true)
      const { content } = result as { content: Array<{ text: string }> }
      expect(content[0].text).toContain('Ping failed')
    })
  })

  // ── haszno_account_get_settings ────────────────────────────────────────────

  describe('haszno_account_get_settings', () => {
    it('returns the full settings object', async () => {
      const result = await stub.getToolCb('haszno_account_get_settings')({})
      expect(isError(result)).toBe(false)
      expect(parseResult(result)).toMatchObject({
        undercutPct: 5,
        minMarginPct: 10,
        vatPct: 27,
        automationPaused: false,
      })
      expect(client.settings.get).toHaveBeenCalledTimes(1)
    })

    it('returns an error result when settings.get rejects', async () => {
      vi.mocked(client.settings.get).mockRejectedValueOnce(new Error('500'))
      const result = await stub.getToolCb('haszno_account_get_settings')({})
      expect(isError(result)).toBe(true)
    })
  })

  // ── haszno_account_update_settings ─────────────────────────────────────────

  describe('haszno_account_update_settings', () => {
    it('calls client.settings.update with the provided values', async () => {
      const result = await stub.getToolCb('haszno_account_update_settings')({
        undercutPct: 3,
        minMarginPct: 8,
        vatPct: 27,
        confirm: true,
      })
      expect(isError(result)).toBe(false)
      expect(client.settings.update).toHaveBeenCalledWith({
        undercutPct: 3,
        minMarginPct: 8,
        vatPct: 27,
      })
    })

    it('returns an error result when settings.update rejects', async () => {
      vi.mocked(client.settings.update).mockRejectedValueOnce(new Error('422'))
      const result = await stub.getToolCb('haszno_account_update_settings')({
        undercutPct: 3,
        minMarginPct: 8,
        vatPct: 27,
        confirm: true,
      })
      expect(isError(result)).toBe(true)
    })
  })

  // ── haszno_account_get_stats ────────────────────────────────────────────────

  describe('haszno_account_get_stats', () => {
    it('returns all stat fields', async () => {
      const result = await stub.getToolCb('haszno_account_get_stats')({})
      expect(isError(result)).toBe(false)
      expect(parseResult(result)).toMatchObject({
        products: 100,
        losing: 3,
        overMarket: 12,
        toFix: 15,
        orders: 42,
      })
      expect(client.stats.get).toHaveBeenCalledTimes(1)
    })

    it('returns an error result when stats.get rejects', async () => {
      vi.mocked(client.stats.get).mockRejectedValueOnce(new Error('503'))
      const result = await stub.getToolCb('haszno_account_get_stats')({})
      expect(isError(result)).toBe(true)
    })
  })

  // ── haszno_account_get_impact ───────────────────────────────────────────────

  describe('haszno_account_get_impact', () => {
    it('calls stats.getImpact with no days when omitted', async () => {
      const result = await stub.getToolCb('haszno_account_get_impact')({})
      expect(isError(result)).toBe(false)
      expect(client.stats.getImpact).toHaveBeenCalledWith({ days: undefined })
      expect(parseResult(result)).toMatchObject({ days: 30, extraProfit: 50000 })
    })

    it('passes the days parameter through', async () => {
      await stub.getToolCb('haszno_account_get_impact')({ days: 7 })
      expect(client.stats.getImpact).toHaveBeenCalledWith({ days: 7 })
    })

    it('returns an error result when stats.getImpact rejects', async () => {
      vi.mocked(client.stats.getImpact).mockRejectedValueOnce(new Error('500'))
      const result = await stub.getToolCb('haszno_account_get_impact')({})
      expect(isError(result)).toBe(true)
    })
  })

  // ── haszno_account_list_suppliers ───────────────────────────────────────────

  describe('haszno_account_list_suppliers', () => {
    it('returns the list of suppliers', async () => {
      const result = await stub.getToolCb('haszno_account_list_suppliers')({})
      expect(isError(result)).toBe(false)
      const data = parseResult(result) as typeof mockSuppliers
      expect(Array.isArray(data)).toBe(true)
      expect(data[0].name).toBe('Test Supplier')
      expect(client.suppliers.list).toHaveBeenCalledTimes(1)
    })

    it('returns an error result when suppliers.list rejects', async () => {
      vi.mocked(client.suppliers.list).mockRejectedValueOnce(new Error('500'))
      const result = await stub.getToolCb('haszno_account_list_suppliers')({})
      expect(isError(result)).toBe(true)
    })
  })

  // ── haszno_account_configure ────────────────────────────────────────────────
  // The node:fs module is mocked at the top of this file via vi.mock / vi.hoisted.
  // Each test resets fsState.writtenContent / existingContent in beforeEach.

  describe('haszno_account_configure', () => {
    beforeEach(() => {
      fsState.existingContent = null
      fsState.writtenContent = null
      fsState.mkdirCalled = false
    })

    it('writes config.json with apiKey (Bearer mode) in flat format', async () => {
      const result = await stub.getToolCb('haszno_account_configure')({
        apiUrl: 'https://shop.haszno.com',
        apiKey: 'secret-key',
        confirm: true,
      })
      expect(isError(result)).toBe(false)
      const data = parseResult(result) as Record<string, unknown>
      expect(data.saved).toBe(true)
      expect(data.authMethod).toBe('apiKey')
      expect(fsState.mkdirCalled).toBe(true)

      expect(fsState.writtenContent).not.toBeNull()
      const written = JSON.parse(fsState.writtenContent!) as Record<string, string>
      expect(written['apiUrl']).toBe('https://shop.haszno.com')
      expect(written['apiKey']).toBe('secret-key')
      expect(written['basicAuth']).toBeUndefined()
    })

    it('writes config.json with basicAuth fallback in flat format', async () => {
      const result = await stub.getToolCb('haszno_account_configure')({
        apiUrl: 'https://shop.haszno.com',
        basicAuth: 'user:pass',
        confirm: true,
      })
      expect(isError(result)).toBe(false)
      const written = JSON.parse(fsState.writtenContent!) as Record<string, string>
      expect(written['basicAuth']).toBe('user:pass')
      expect(written['apiKey']).toBeUndefined()
    })

    it('merges with existing flat config, preserving existing keys', async () => {
      fsState.existingContent = JSON.stringify({
        apiUrl: 'https://old.haszno.com',
        apiKey: 'old-key',
      })
      await stub.getToolCb('haszno_account_configure')({
        apiUrl: 'https://new.haszno.com',
        apiKey: 'new-key',
        confirm: true,
      })
      const written = JSON.parse(fsState.writtenContent!) as Record<string, string>
      expect(written['apiUrl']).toBe('https://new.haszno.com')
      expect(written['apiKey']).toBe('new-key')
    })

    it('returns an error when neither apiKey nor basicAuth is supplied', async () => {
      const result = await stub.getToolCb('haszno_account_configure')({
        apiUrl: 'https://shop.haszno.com',
        confirm: true,
      })
      expect(isError(result)).toBe(true)
      const { content } = result as { content: Array<{ text: string }> }
      expect(content[0].text).toMatch(/apiKey or basicAuth/)
    })

    it('returns an error when both apiKey and basicAuth are supplied', async () => {
      const result = await stub.getToolCb('haszno_account_configure')({
        apiUrl: 'https://shop.haszno.com',
        apiKey: 'k',
        basicAuth: 'u:p',
        confirm: true,
      })
      expect(isError(result)).toBe(true)
    })
  })
})
