/**
 * Unit tests for src/tools/catalogue.ts, src/tools/connections.ts,
 * src/tools/peers.ts, and src/tools/blog.ts.
 * No network calls — all client methods are mocked.
 */
import { describe, it, expect, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type {
  HasznoClient,
  CatalogueSearchResult,
  ImportListItem,
  StoreConnection,
  ConnectStorePushResult,
  PeerInvite,
  PeerLink,
  BlogPost,
  BlogListResult,
} from '../client/index.js'
import { registerCatalogueTools } from '../tools/catalogue.js'
import { registerConnectionsTools } from '../tools/connections.js'
import { registerPeersTools } from '../tools/peers.js'
import { registerBlogTools } from '../tools/blog.js'

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

// ---- fixtures -----------------------------------------------------------------

const CATALOGUE_RESULT: CatalogueSearchResult = {
  items: [
    {
      id: 1,
      name: 'Widget Pro',
      imageUrl: null,
      partnerId: 10,
      partnerName: 'Alfa Kft.',
      partnerCountry: 'HU',
      category: 'Elektronika',
      categoryKey: 'elektronika',
      wholesaleNet: 3000,
      rrpGross: 7000,
      marginNet: 2512,
      marginPct: 44.0,
      stock: 50,
      example: false,
      inImportList: false,
      inShop: false,
    },
  ],
  total: 1,
  facets: {
    partners: [{ id: 10, name: 'Alfa Kft.', count: 1 }],
    countries: [{ country: 'HU', count: 1 }],
    categories: [{ key: 'elektronika', label: 'Elektronika', count: 1 }],
    marginBuckets: [],
  },
}

const IMPORT_ITEM: ImportListItem = {
  id: 5,
  networkProductId: 1,
  name: 'Widget Pro',
  sku: 'WID-001',
  partnerName: 'Alfa Kft.',
  wholesaleNet: 3000,
  rrpGross: 7000,
  stock: 50,
  pushStatus: 'varakozik',
  targetConnectionId: null,
  targetExternalId: null,
  addedAt: '2026-11-01T10:00:00Z',
}

const CONNECTION: StoreConnection = {
  id: 1,
  platform: 'woocommerce',
  name: 'Fő webshop',
  status: 'kapcsolva',
  domain: 'mybolt.hu',
  lastError: null,
  connectedAt: '2026-10-01T00:00:00Z',
  config: {},
  lastSyncAt: '2026-11-07T12:00:00Z',
  createdAt: '2026-09-15T00:00:00Z',
}

const PEER_INVITE: PeerInvite = {
  id: 1,
  code: 'inv_abc123',
  createdBy: 'mybolt',
  supplierId: 42,
  expiresAt: '2026-12-31T23:59:00Z',
  acceptedBy: null,
  acceptedAt: null,
  revokedAt: null,
  createdAt: '2026-11-08T00:00:00Z',
}

const PEER_LINK: PeerLink = {
  id: 1,
  supplierId: 42,
  partner: 'partnerbolt',
  createdAt: '2026-11-08T10:00:00Z',
}

const BLOG_POST: BlogPost = {
  id: 1,
  slug: '2026-w45-het-osszefoglalo',
  period: 'het',
  periodStart: '2026-11-03',
  periodEnd: '2026-11-09',
  title: '2026/45. heti piac-összefoglaló',
  summary: 'Az elektronika kategóriában erős kereslet mutatkozott.',
  bodyMd: '## Fő trendek\n\nAz elektronika...',
  data: {
    rankedCategories: [{ category: 'Elektronika', score: 0.9 }],
    shopsCount: 12,
  },
  ogTitle: null,
  publishedAt: '2026-11-08T08:00:00Z',
  status: 'publikalt',
  createdAt: '2026-11-08T07:00:00Z',
  updatedAt: '2026-11-08T08:00:00Z',
}

// ---- client factory -----------------------------------------------------------

function makeClient(overrides: Partial<HasznoClient> = {}): HasznoClient {
  return {
    health: { check: vi.fn() },
    settings: { get: vi.fn(), update: vi.fn() },
    products: { list: vi.fn(), update: vi.fn(), setListing: vi.fn(), generateAiDescription: vi.fn(), applyPrices: vi.fn() },
    stats: { get: vi.fn(), getImpact: vi.fn() },
    suppliers: { list: vi.fn() },
    feeds: { importFeed: vi.fn(), importMarketPrices: vi.fn() },
    orders: { list: vi.fn(), receiveOrder: vi.fn(), ship: vi.fn(), createDemo: vi.fn() },
    recommendations: { get: vi.fn(), getAiShortlist: vi.fn(), fillTrendKeywords: vi.fn() },
    rules: { listTemplates: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), run: vi.fn(), runAll: vi.fn(), trigger: vi.fn(), listRuns: vi.fn(), undoUnlists: vi.fn() },
    proposals: { list: vi.fn(), approve: vi.fn(), reject: vi.fn(), rollback: vi.fn() },
    automation: { get: vi.fn(), set: vi.fn() },
    network: { listSuppliers: vi.fn(), getSupplierProducts: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), sync: vi.fn(), getSupplierView: vi.fn() },
    catalogue: {
      search: vi.fn().mockResolvedValue(CATALOGUE_RESULT),
    },
    importList: {
      list: vi.fn().mockResolvedValue([IMPORT_ITEM]),
      add: vi.fn().mockResolvedValue({ added: 1, skipped: 0 }),
      // Default: no-target path returns { pushed } only (ImportListPushResult)
      push: vi.fn().mockResolvedValue({ pushed: 1 }),
    },
    connections: {
      list: vi.fn().mockResolvedValue([CONNECTION]),
      get: vi.fn().mockResolvedValue(CONNECTION),
    },
    peers: {
      createInvite: vi.fn().mockResolvedValue(PEER_INVITE),
      listInvites: vi.fn().mockResolvedValue([PEER_INVITE]),
      revokeInvite: vi.fn().mockResolvedValue({ revoked: true }),
      acceptInvite: vi.fn().mockResolvedValue(PEER_LINK),
      listLinks: vi.fn().mockResolvedValue([PEER_LINK]),
      removeLink: vi.fn().mockResolvedValue({ removed: true }),
      setVisibility: vi.fn().mockResolvedValue({ id: 42, visibility: 'public' }),
    },
    blog: {
      list: vi.fn().mockResolvedValue({ posts: [BLOG_POST], total: 1, page: 1, perPage: 1 } as BlogListResult),
      get: vi.fn().mockResolvedValue(BLOG_POST),
    },
    ...overrides,
  } as unknown as HasznoClient
}

// ==============================================================================
// registerCatalogueTools
// ==============================================================================

describe('registerCatalogueTools()', () => {
  it('registers 4 tools', () => {
    const { server, tools } = makeMockServer()
    registerCatalogueTools(server, makeClient())
    expect(tools.size).toBe(4)
    expect([...tools.keys()]).toEqual(
      expect.arrayContaining([
        'haszno_catalogue_search',
        'haszno_import_list_list',
        'haszno_import_list_add',
        'haszno_import_list_push',
      ]),
    )
  })

  describe('haszno_catalogue_search', () => {
    it('calls catalogue.search and returns items', async () => {
      const client = makeClient()
      const { server, tools } = makeMockServer()
      registerCatalogueTools(server, client)
      const result = await callTool(tools, 'haszno_catalogue_search', { q: 'widget' })
      expect(client.catalogue.search).toHaveBeenCalledWith(expect.objectContaining({ q: 'widget' }))
      const data = parsed(result) as typeof CATALOGUE_RESULT
      expect(data.items).toHaveLength(1)
      expect(data.items[0].name).toBe('Widget Pro')
    })

    it('passes all filter params', async () => {
      const client = makeClient()
      const { server, tools } = makeMockServer()
      registerCatalogueTools(server, client)
      await callTool(tools, 'haszno_catalogue_search', {
        q: 'test',
        cats: 'elektronika',
        partner: 10,
        minMarginPct: 20,
        maxPrice: 10000,
        inStock: true,
        country: 'HU',
        sort: 'margin_desc',
        page: 2,
        pageSize: 10,
      })
      expect(client.catalogue.search).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'test',
          cats: 'elektronika',
          partner: 10,
          minMarginPct: 20,
          maxPrice: 10000,
          inStock: true,
          country: 'HU',
          sort: 'margin_desc',
          page: 2,
          pageSize: 10,
        }),
      )
    })

    it('is readOnlyHint: true', () => {
      const { server, tools } = makeMockServer()
      registerCatalogueTools(server, makeClient())
      const ann = tools.get('haszno_catalogue_search')!.config.annotations as Record<string, unknown>
      expect(ann.readOnlyHint).toBe(true)
    })
  })

  describe('haszno_import_list_list', () => {
    it('returns items from importList.list', async () => {
      const client = makeClient()
      const { server, tools } = makeMockServer()
      registerCatalogueTools(server, client)
      const result = await callTool(tools, 'haszno_import_list_list', {})
      expect(client.importList.list).toHaveBeenCalled()
      const data = parsed(result) as { items: ImportListItem[]; total: number }
      expect(data.items).toHaveLength(1)
      expect(data.items[0].pushStatus).toBe('varakozik')
    })

    it('passes status filter', async () => {
      const client = makeClient()
      const { server, tools } = makeMockServer()
      registerCatalogueTools(server, client)
      await callTool(tools, 'haszno_import_list_list', { status: 'hiba' })
      expect(client.importList.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'hiba' }))
    })
  })

  describe('haszno_import_list_add', () => {
    it('calls importList.add and returns result', async () => {
      const client = makeClient()
      const { server, tools } = makeMockServer()
      registerCatalogueTools(server, client)
      const result = await callTool(tools, 'haszno_import_list_add', { networkProductIds: [1, 2] })
      expect(client.importList.add).toHaveBeenCalledWith({ networkProductIds: [1, 2] })
      const data = parsed(result) as { added: number; skipped: number }
      expect(data.added).toBe(1)
    })
  })

  describe('haszno_import_list_push', () => {
    it('returns preview when confirm=false', async () => {
      const client = makeClient()
      const { server, tools } = makeMockServer()
      registerCatalogueTools(server, client)
      const result = await callTool(tools, 'haszno_import_list_push', { ids: [5, 6], confirm: false })
      expect(client.importList.push).not.toHaveBeenCalled()
      const data = parsed(result) as { preview: boolean }
      expect(data.preview).toBe(true)
    })

    it('no-target path: calls push without targetConnectionId and returns { pushed } only', async () => {
      const client = makeClient({
        importList: {
          list: vi.fn(),
          add: vi.fn(),
          push: vi.fn().mockResolvedValue({ pushed: 2 }),
        },
      })
      const { server, tools } = makeMockServer()
      registerCatalogueTools(server, client)
      const result = await callTool(tools, 'haszno_import_list_push', { ids: [5, 6], confirm: true })
      expect(client.importList.push).toHaveBeenCalledWith({ ids: [5, 6] })
      const data = parsed(result) as { pushed: number }
      expect(data.pushed).toBe(2)
      expect('failed' in data).toBe(false)
    })

    it('target path: calls push with targetConnectionId and returns { pushed, failed, errors }', async () => {
      const connectResult: ConnectStorePushResult = { pushed: 1, failed: 1, errors: ['Widget Pro: out of stock'] }
      const client = makeClient({
        importList: {
          list: vi.fn(),
          add: vi.fn(),
          push: vi.fn().mockResolvedValue(connectResult),
        },
      })
      const { server, tools } = makeMockServer()
      registerCatalogueTools(server, client)
      const result = await callTool(tools, 'haszno_import_list_push', {
        ids: [5],
        targetConnectionId: 1,
        confirm: true,
      })
      expect(client.importList.push).toHaveBeenCalledWith({ ids: [5], targetConnectionId: 1 })
      const data = parsed(result) as ConnectStorePushResult
      expect(data.pushed).toBe(1)
      expect(data.failed).toBe(1)
      expect(data.errors).toHaveLength(1)
    })

    it('target path: does not crash when errors is undefined (regression guard)', async () => {
      // Guard: if the connected-store API omits errors, the tool must not throw.
      const client = makeClient({
        importList: {
          list: vi.fn(),
          add: vi.fn(),
          push: vi.fn().mockResolvedValue({ pushed: 1, failed: 0 } as ConnectStorePushResult),
        },
      })
      const { server, tools } = makeMockServer()
      registerCatalogueTools(server, client)
      await expect(
        callTool(tools, 'haszno_import_list_push', { ids: [5], targetConnectionId: 1, confirm: true }),
      ).resolves.not.toThrow()
    })
  })
})

// ==============================================================================
// registerConnectionsTools
// ==============================================================================

describe('registerConnectionsTools()', () => {
  it('registers haszno_connections_list', () => {
    const { server, tools } = makeMockServer()
    registerConnectionsTools(server, makeClient())
    expect(tools.has('haszno_connections_list')).toBe(true)
  })

  it('returns all connections unfiltered', async () => {
    const client = makeClient()
    const { server, tools } = makeMockServer()
    registerConnectionsTools(server, client)
    const result = await callTool(tools, 'haszno_connections_list', {})
    expect(client.connections.list).toHaveBeenCalled()
    const data = parsed(result) as { connections: StoreConnection[] }
    expect(data.connections).toHaveLength(1)
    expect(data.connections[0].platform).toBe('woocommerce')
  })

  it('filters by status', async () => {
    const client = makeClient({
      connections: {
        list: vi.fn().mockResolvedValue([CONNECTION, { ...CONNECTION, id: 2, status: 'uj' }]),
        get: vi.fn(),
      },
    })
    const { server, tools } = makeMockServer()
    registerConnectionsTools(server, client)
    const result = await callTool(tools, 'haszno_connections_list', { status: 'kapcsolva' })
    const data = parsed(result) as { connections: StoreConnection[] }
    expect(data.connections).toHaveLength(1)
    expect(data.connections[0].status).toBe('kapcsolva')
  })

  it('is readOnlyHint: true', () => {
    const { server, tools } = makeMockServer()
    registerConnectionsTools(server, makeClient())
    const ann = tools.get('haszno_connections_list')!.config.annotations as Record<string, unknown>
    expect(ann.readOnlyHint).toBe(true)
  })
})

// ==============================================================================
// registerPeersTools
// ==============================================================================

describe('registerPeersTools()', () => {
  it('registers 3 tools', () => {
    const { server, tools } = makeMockServer()
    registerPeersTools(server, makeClient())
    expect(tools.size).toBe(3)
    expect([...tools.keys()]).toEqual(
      expect.arrayContaining([
        'haszno_peers_invite_create',
        'haszno_peers_invite_list',
        'haszno_peers_invite_accept',
      ]),
    )
  })

  describe('haszno_peers_invite_create', () => {
    it('returns dry-run preview when confirm=false and does NOT call API', async () => {
      const client = makeClient()
      const { server, tools } = makeMockServer()
      registerPeersTools(server, client)
      const result = await callTool(tools, 'haszno_peers_invite_create', {
        supplierId: 42,
        expiresAt: '2026-12-31T23:59:00Z',
        confirm: false,
      })
      expect(client.peers.createInvite).not.toHaveBeenCalled()
      const data = parsed(result) as { preview: boolean; supplierId: number }
      expect(data.preview).toBe(true)
      expect(data.supplierId).toBe(42)
    })

    it('calls peers.createInvite and returns invite when confirm=true', async () => {
      const client = makeClient()
      const { server, tools } = makeMockServer()
      registerPeersTools(server, client)
      const result = await callTool(tools, 'haszno_peers_invite_create', {
        supplierId: 42,
        expiresAt: '2026-12-31T23:59:00Z',
        confirm: true,
      })
      expect(client.peers.createInvite).toHaveBeenCalledWith({
        supplierId: 42,
        expiresAt: '2026-12-31T23:59:00Z',
      })
      const data = parsed(result) as PeerInvite
      expect(data.code).toBe('inv_abc123')
    })
  })

  describe('haszno_peers_invite_list', () => {
    it('returns all invites', async () => {
      const client = makeClient()
      const { server, tools } = makeMockServer()
      registerPeersTools(server, client)
      const result = await callTool(tools, 'haszno_peers_invite_list', {})
      expect(client.peers.listInvites).toHaveBeenCalled()
      const data = parsed(result) as { invites: PeerInvite[] }
      expect(data.invites).toHaveLength(1)
    })
  })

  describe('haszno_peers_invite_accept', () => {
    it('returns preview when confirm=false', async () => {
      const client = makeClient()
      const { server, tools } = makeMockServer()
      registerPeersTools(server, client)
      const result = await callTool(tools, 'haszno_peers_invite_accept', {
        code: 'inv_abc123',
        acceptorId: 'partnerbolt',
        confirm: false,
      })
      expect(client.peers.acceptInvite).not.toHaveBeenCalled()
      const data = parsed(result) as { preview: boolean }
      expect(data.preview).toBe(true)
    })

    it('calls peers.acceptInvite when confirm=true', async () => {
      const client = makeClient()
      const { server, tools } = makeMockServer()
      registerPeersTools(server, client)
      const result = await callTool(tools, 'haszno_peers_invite_accept', {
        code: 'inv_abc123',
        acceptorId: 'partnerbolt',
        confirm: true,
      })
      expect(client.peers.acceptInvite).toHaveBeenCalledWith('inv_abc123', { acceptorId: 'partnerbolt' })
      const data = parsed(result) as PeerLink
      expect(data.supplierId).toBe(42)
    })
  })
})

// ==============================================================================
// registerBlogTools
// ==============================================================================

describe('registerBlogTools()', () => {
  it('registers haszno_blog_latest', () => {
    const { server, tools } = makeMockServer()
    registerBlogTools(server, makeClient())
    expect(tools.has('haszno_blog_latest')).toBe(true)
  })

  it('returns latest published post', async () => {
    const client = makeClient()
    const { server, tools } = makeMockServer()
    registerBlogTools(server, client)
    const result = await callTool(tools, 'haszno_blog_latest', {})
    expect(client.blog.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, perPage: 1 }))
    const data = parsed(result) as { posts: BlogPost[]; total: number }
    expect(data.posts).toHaveLength(1)
    expect(data.posts[0].period).toBe('het')
  })

  it('passes period filter', async () => {
    const client = makeClient()
    const { server, tools } = makeMockServer()
    registerBlogTools(server, client)
    await callTool(tools, 'haszno_blog_latest', { period: 'honap', limit: 3 })
    expect(client.blog.list).toHaveBeenCalledWith(
      expect.objectContaining({ period: 'honap', perPage: 3 }),
    )
  })

  it('is readOnlyHint: true', () => {
    const { server, tools } = makeMockServer()
    registerBlogTools(server, makeClient())
    const ann = tools.get('haszno_blog_latest')!.config.annotations as Record<string, unknown>
    expect(ann.readOnlyHint).toBe(true)
  })
})
