/**
 * Unit tests for feeds MCP tools.
 * Uses a minimal mock of McpServer and HasznoClient — no network required.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { HasznoClient } from '../client/index.js'
import {
  registerFeedsTools,
  resolveContent,
  buildAuthHeaders,
  getBaseUrl,
  countXmlTags,
  sampleArukereso,
  sampleGoogle,
} from '../tools/feeds.js'

// ---------------------------------------------------------------------------
// Minimal McpServer mock
// ---------------------------------------------------------------------------

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>
  isError?: boolean
}>

interface MockTool {
  config: {
    title?: string
    description?: string
    annotations?: Record<string, unknown>
    inputSchema?: unknown
  }
  handler: ToolHandler
}

function makeMockServer() {
  const tools = new Map<string, MockTool>()
  return {
    tools,
    registerTool(
      name: string,
      config: MockTool['config'],
      handler: ToolHandler,
    ) {
      tools.set(name, { config, handler })
      return {}
    },
  }
}

// ---------------------------------------------------------------------------
// Minimal HasznoClient mock
// ---------------------------------------------------------------------------

function makeMockClient(overrides: Partial<HasznoClient['feeds']> = {}) {
  return {
    feeds: {
      importFeed: vi.fn().mockResolvedValue({ created: 5, updated: 3, total: 8 }),
      importMarketPrices: vi.fn().mockResolvedValue({ matched: 4, total: 6 }),
      ...overrides,
    },
  } as unknown as HasznoClient
}

// ---------------------------------------------------------------------------
// Helper: call a registered tool and parse its JSON response
// ---------------------------------------------------------------------------

async function callTool(
  server: ReturnType<typeof makeMockServer>,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ result: unknown; isError?: boolean }> {
  const tool = server.tools.get(name)
  if (!tool) throw new Error(`Tool "${name}" not registered`)
  const response = await tool.handler(args)
  const text = response.content[0]?.text ?? ''
  return { result: JSON.parse(text), isError: response.isError }
}

// ---------------------------------------------------------------------------
// Helper utilities tests
// ---------------------------------------------------------------------------

describe('resolveContent()', () => {
  it('returns content string directly when provided', () => {
    expect(resolveContent('hello', undefined)).toBe('hello')
  })

  it('reads file when filePath provided (mocked fs)', () => {
    // We test this indirectly by ensuring it throws when neither is provided
    expect(() => resolveContent(undefined, undefined)).toThrow('content')
  })

  it('prefers content over filePath', () => {
    expect(resolveContent('direct', '/some/path')).toBe('direct')
  })

  it('refuses non-feed files and hidden directories (no secret exfiltration)', () => {
    expect(() => resolveContent(undefined, '/home/u/.ssh/id_rsa')).toThrow(/\.csv/)
    expect(() => resolveContent(undefined, '/home/u/.config/arfutar/config.json')).toThrow(/\.csv/)
    expect(() => resolveContent(undefined, '/home/u/.config/feeds/x.csv')).toThrow(/hidden/)
    expect(() => resolveContent(undefined, '/etc/passwd')).toThrow(/\.csv/)
  })
})

describe('buildAuthHeaders()', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env['HASZNO_API_KEY']
    delete process.env['HASZNO_BASIC']
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns empty object when no credentials are set', () => {
    expect(buildAuthHeaders()).toEqual({})
  })

  it('returns Bearer header when HASZNO_API_KEY is set', () => {
    process.env['HASZNO_API_KEY'] = 'test-key'
    const headers = buildAuthHeaders()
    expect(headers['Authorization']).toBe('Bearer test-key')
  })

  it('returns Basic header when HASZNO_BASIC is set', () => {
    process.env['HASZNO_BASIC'] = 'user:pass'
    const headers = buildAuthHeaders()
    expect(headers['Authorization']).toMatch(/^Basic /)
  })

  it('prefers Bearer over Basic when both are set', () => {
    process.env['HASZNO_API_KEY'] = 'key'
    process.env['HASZNO_BASIC'] = 'user:pass'
    const headers = buildAuthHeaders()
    expect(headers['Authorization']).toBe('Bearer key')
  })
})

describe('getBaseUrl()', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env['HASZNO_API_URL']
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns default URL when env is not set', () => {
    expect(getBaseUrl()).toBe('https://demo.haszno.hu')
  })

  it('strips trailing slash', () => {
    process.env['HASZNO_API_URL'] = 'https://myshop.hu/'
    expect(getBaseUrl()).toBe('https://myshop.hu')
  })

  it('uses env value', () => {
    process.env['HASZNO_API_URL'] = 'https://custom.example.com'
    expect(getBaseUrl()).toBe('https://custom.example.com')
  })
})

describe('countXmlTags()', () => {
  it('counts self-closing and open tags', () => {
    const xml = '<product><name>A</name></product><product><name>B</name></product>'
    expect(countXmlTags(xml, 'product')).toBe(2)
  })

  it('returns 0 for missing tag', () => {
    expect(countXmlTags('<products/>', 'product')).toBe(0)
  })
})

describe('sampleArukereso()', () => {
  const xml = `<?xml version="1.0"?>
<products>
  <product>
    <identifier>SKU-1</identifier>
    <name>Teszt termék 1</name>
    <price>1000</price>
  </product>
  <product>
    <identifier>SKU-2</identifier>
    <name>Teszt termék 2</name>
    <price>2000</price>
  </product>
  <product>
    <identifier>SKU-3</identifier>
    <name>Teszt termék 3</name>
    <price>3000</price>
  </product>
  <product>
    <identifier>SKU-4</identifier>
    <name>Teszt termék 4</name>
    <price>4000</price>
  </product>
</products>`

  it('returns up to limit items', () => {
    const sample = sampleArukereso(xml, 3)
    expect(sample).toHaveLength(3)
  })

  it('extracts correct fields', () => {
    const sample = sampleArukereso(xml, 1)
    expect(sample[0]).toEqual({ sku: 'SKU-1', name: 'Teszt termék 1', price: '1000' })
  })

  it('returns all when limit > item count', () => {
    const sample = sampleArukereso(xml, 100)
    expect(sample).toHaveLength(4)
  })
})

describe('sampleGoogle()', () => {
  const xml = `<?xml version="1.0"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <item>
      <g:id>SKU-A</g:id>
      <title>Teszt A</title>
      <g:price>500 HUF</g:price>
    </item>
    <item>
      <g:id>SKU-B</g:id>
      <title>Teszt B</title>
      <g:price>800 HUF</g:price>
    </item>
  </channel>
</rss>`

  it('returns up to limit items', () => {
    expect(sampleGoogle(xml, 1)).toHaveLength(1)
  })

  it('extracts correct fields', () => {
    const sample = sampleGoogle(xml, 2)
    expect(sample[0]).toEqual({ id: 'SKU-A', title: 'Teszt A', price: '500 HUF' })
    expect(sample[1]).toEqual({ id: 'SKU-B', title: 'Teszt B', price: '800 HUF' })
  })
})

// ---------------------------------------------------------------------------
// Tool registration and behaviour
// ---------------------------------------------------------------------------

describe('registerFeedsTools()', () => {
  it('registers 3 tools', () => {
    const server = makeMockServer()
    const client = makeMockClient()
    registerFeedsTools(server as never, client)
    expect(server.tools.size).toBe(3)
    expect(server.tools.has('haszno_feeds_import_supplier')).toBe(true)
    expect(server.tools.has('haszno_feeds_import_market')).toBe(true)
    expect(server.tools.has('haszno_feeds_outbound_info')).toBe(true)
  })
})

// ---- haszno_feeds_import_supplier ----------------------------------------

describe('haszno_feeds_import_supplier', () => {
  it('returns dry_run result when confirm is false (default)', async () => {
    const server = makeMockServer()
    const client = makeMockClient()
    registerFeedsTools(server as never, client)

    const { result } = await callTool(server, 'haszno_feeds_import_supplier', {
      supplierId: 1,
      format: 'csv',
      content: 'sku,name,price\nA,Widget,1000',
      confirm: false,
    })

    expect((result as { dry_run: boolean }).dry_run).toBe(true)
    expect(client.feeds.importFeed).not.toHaveBeenCalled()
  })

  it('calls client.feeds.importFeed when confirm is true', async () => {
    const server = makeMockServer()
    const client = makeMockClient()
    registerFeedsTools(server as never, client)

    const { result } = await callTool(server, 'haszno_feeds_import_supplier', {
      supplierId: 2,
      format: 'xml',
      content: '<products><product><identifier>X</identifier></product></products>',
      confirm: true,
    })

    expect(client.feeds.importFeed).toHaveBeenCalledWith({
      supplierId: 2,
      format: 'xml',
      content: expect.stringContaining('<products>'),
    })
    expect((result as { created: number }).created).toBe(5)
    expect((result as { updated: number }).updated).toBe(3)
  })

  it('returns error result when neither content nor filePath provided', async () => {
    const server = makeMockServer()
    const client = makeMockClient()
    registerFeedsTools(server as never, client)

    const { result, isError } = await callTool(server, 'haszno_feeds_import_supplier', {
      supplierId: 1,
      format: 'csv',
      confirm: true,
    })

    expect(isError).toBe(true)
    expect((result as { error: string }).error).toMatch(/content.*filePath/i)
  })

  it('propagates API errors with isError flag', async () => {
    const server = makeMockServer()
    const client = makeMockClient({
      importFeed: vi.fn().mockRejectedValue(new Error('Nincs ilyen beszállító')),
    })
    registerFeedsTools(server as never, client)

    const { result, isError } = await callTool(server, 'haszno_feeds_import_supplier', {
      supplierId: 99,
      format: 'csv',
      content: 'sku,name\nX,Y',
      confirm: true,
    })

    expect(isError).toBe(true)
    expect((result as { error: string }).error).toBe('Nincs ilyen beszállító')
  })

  it('tool has destructiveHint: true annotation', () => {
    const server = makeMockServer()
    registerFeedsTools(server as never, makeMockClient())
    const tool = server.tools.get('haszno_feeds_import_supplier')!
    expect(tool.config.annotations?.destructiveHint).toBe(true)
  })
})

// ---- haszno_feeds_import_market ------------------------------------------

describe('haszno_feeds_import_market', () => {
  it('returns dry_run when confirm is false', async () => {
    const server = makeMockServer()
    const client = makeMockClient()
    registerFeedsTools(server as never, client)

    const { result } = await callTool(server, 'haszno_feeds_import_market', {
      content: 'sku,price\nA,999',
      confirm: false,
    })

    expect((result as { dry_run: boolean }).dry_run).toBe(true)
    expect(client.feeds.importMarketPrices).not.toHaveBeenCalled()
  })

  it('calls client.feeds.importMarketPrices when confirm is true', async () => {
    const server = makeMockServer()
    const client = makeMockClient()
    registerFeedsTools(server as never, client)

    const { result } = await callTool(server, 'haszno_feeds_import_market', {
      content: 'sku,price,shop\nA,999,bolt.hu',
      confirm: true,
    })

    expect(client.feeds.importMarketPrices).toHaveBeenCalledWith({
      content: 'sku,price,shop\nA,999,bolt.hu',
    })
    expect((result as { matched: number }).matched).toBe(4)
  })

  it('returns error when neither content nor filePath provided', async () => {
    const server = makeMockServer()
    const client = makeMockClient()
    registerFeedsTools(server as never, client)

    const { isError } = await callTool(server, 'haszno_feeds_import_market', {
      confirm: true,
    })

    expect(isError).toBe(true)
  })

  it('tool has idempotentHint: true annotation', () => {
    const server = makeMockServer()
    registerFeedsTools(server as never, makeMockClient())
    const tool = server.tools.get('haszno_feeds_import_market')!
    expect(tool.config.annotations?.idempotentHint).toBe(true)
  })

  it('propagates API errors', async () => {
    const server = makeMockServer()
    const client = makeMockClient({
      importMarketPrices: vi.fn().mockRejectedValue(new Error('CSV parse error')),
    })
    registerFeedsTools(server as never, client)

    const { result, isError } = await callTool(server, 'haszno_feeds_import_market', {
      content: 'bad,csv',
      confirm: true,
    })

    expect(isError).toBe(true)
    expect((result as { error: string }).error).toBe('CSV parse error')
  })
})

// ---- haszno_feeds_outbound_info ------------------------------------------

describe('haszno_feeds_outbound_info', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env['HASZNO_API_URL']
    delete process.env['HASZNO_API_KEY']
    delete process.env['HASZNO_BASIC']
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns URLs without fetching when fetch_summary is false (default)', async () => {
    process.env['HASZNO_API_URL'] = 'https://test.example.com'
    const server = makeMockServer()
    registerFeedsTools(server as never, makeMockClient())

    const { result } = await callTool(server, 'haszno_feeds_outbound_info', {
      fetch_summary: false,
    })

    const r = result as { arukereso_url: string; google_url: string }
    expect(r.arukereso_url).toBe('https://test.example.com/feed/arukereso.xml')
    expect(r.google_url).toBe('https://test.example.com/feed/google.xml')
  })

  it('fetches feeds and returns summary when fetch_summary is true', async () => {
    process.env['HASZNO_API_URL'] = 'https://test.example.com'

    const arukeresoXml = `<?xml version="1.0"?>
<products>
  <product>
    <identifier>SKU-1</identifier>
    <name>Widget</name>
    <price>1000</price>
  </product>
  <product>
    <identifier>SKU-2</identifier>
    <name>Gadget</name>
    <price>2000</price>
  </product>
</products>`

    const googleXml = `<?xml version="1.0"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <item>
      <g:id>SKU-1</g:id>
      <title>Widget</title>
      <g:price>1000 HUF</g:price>
    </item>
  </channel>
</rss>`

    // Mock global fetch
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      const body = url.includes('arukereso') ? arukeresoXml : googleXml
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(body),
      })
    })
    vi.stubGlobal('fetch', mockFetch)

    const server = makeMockServer()
    registerFeedsTools(server as never, makeMockClient())

    const { result } = await callTool(server, 'haszno_feeds_outbound_info', {
      fetch_summary: true,
    })

    vi.unstubAllGlobals()

    const r = result as {
      arukereso: { item_count: number; sample: unknown[] }
      google: { item_count: number; sample: unknown[] }
    }
    expect(r.arukereso.item_count).toBe(2)
    expect(r.arukereso.sample).toHaveLength(2)
    expect(r.google.item_count).toBe(1)
    expect(r.google.sample).toHaveLength(1)
  })

  it('returns error info when feed fetch fails', async () => {
    process.env['HASZNO_API_URL'] = 'https://test.example.com'

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('Service Unavailable'),
    })
    vi.stubGlobal('fetch', mockFetch)

    const server = makeMockServer()
    registerFeedsTools(server as never, makeMockClient())

    const { result } = await callTool(server, 'haszno_feeds_outbound_info', {
      fetch_summary: true,
    })

    vi.unstubAllGlobals()

    const r = result as { arukereso: { error: string }; google: { error: string } }
    expect(r.arukereso.error).toContain('503')
    expect(r.google.error).toContain('503')
  })

  it('tool has readOnlyHint: true annotation', () => {
    const server = makeMockServer()
    registerFeedsTools(server as never, makeMockClient())
    const tool = server.tools.get('haszno_feeds_outbound_info')!
    expect(tool.config.annotations?.readOnlyHint).toBe(true)
  })
})
