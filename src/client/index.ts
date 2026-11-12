/**
 * Haszno HTTP client — vendored into haszno-mcp.
 *
 * Dual-mode: behaviour depends on the credential in use.
 *
 * SHOP TOKEN MODE — credential starts with "haszno_"
 *   Accepted from HASZNO_API_TOKEN (preferred), HASZNO_API_KEY, ARFUTAR_API_KEY, or opts.apiKey.
 *   Sent as "Authorization: Bearer <token>".
 *   Routes products / orders / proposals to the shop-scoped /api/agent/* endpoints.
 *   Operations outside that scope (approve/reject/rollback, rules, feeds, …) throw
 *   ShopTokenNotSupportedError immediately — no HTTP call is made.
 *
 * LEGACY MODE — anything else (non-prefixed key → x-api-key; Basic → Authorization: Basic)
 *   Behaviour is byte-for-byte identical to the previous version of this file.
 *   Same endpoints, same headers, same response shapes.
 *
 * Usage:
 *   import { createClient } from './client/index.js'
 *   const client = createClient()   // reads HASZNO_API_URL + HASZNO_API_KEY from env
 *   const products = await client.products.list()
 */
import { type HttpOptions, get, post, put, patch, del, isShopToken, SHOP_TOKEN_PREFIX } from './http.js'
import type {
  Settings,
  Product,
  Supplier,
  Order,
  Stats,
  Impact,
  Rule,
  RuleTemplate,
  RuleRun,
  Proposal,
  ProposalStatus,
  NetworkSupplier,
  NetworkProduct,
  SupplierView,
  Recommendations,
  AiShortlistResult,
  FeedImportResult,
  MarketImportResult,
  ApplyPricesResult,
  ApproveResult,
  CatalogueSearchResult,
  ImportListItem,
  ImportListAddResult,
  ImportListPushResult,
  ConnectStorePushResult,
  StoreConnection,
  PeerInvite,
  PeerLink,
  BlogPost,
  BlogListResult,
  BlogPeriod,
  RollbackResult,
  ConnectResult,
  SyncResult,
  RunResult,
  RuleCondition,
  RuleAction,
} from './types.js'

export type { HttpOptions }
export * from './types.js'
export { HasznoApiError } from './error.js'
export { isShopToken, SHOP_TOKEN_PREFIX } from './http.js'

// ── Shop-token-specific types ──────────────────────────────────────────────────

/**
 * Body for POST /api/agent/proposals.
 * The nonce must be generated once per user action (crypto.randomUUID()) and
 * reused across transport retries of the same action.
 */
export interface AgentProposalBody {
  productId: number
  proposedPriceGross: number
  reason: string
  /** Opaque dedup key (1–128 chars). Repeating the same nonce returns 409. */
  nonce: string
}

/** Response from POST /api/agent/proposals (201 Created). */
export interface AgentProposalResult {
  id: number
  status: 'pending'
  createdAt: string
}

// ── Error for disabled operations ─────────────────────────────────────────────

/**
 * Thrown when a shop API token calls an operation that requires a full session
 * (e.g. approve/reject/rollback, rules, feeds, connections).
 * Zero HTTP calls are made when this error is thrown.
 */
export class ShopTokenNotSupportedError extends Error {
  readonly isShopTokenNotSupported = true
  readonly operation: string

  constructor(operation: string) {
    super(
      `"${operation}" nem érhető el bolt API-tokennel — használja a Haszno webalkalmazást ` +
        '(https://haszno.com). ' +
        'Az ügynök-token csak olvasási (GET /api/agent/*) és javaslat-beküldési ' +
        '(POST /api/agent/proposals) műveletekre jogosult.',
    )
    this.name = 'ShopTokenNotSupportedError'
    this.operation = operation
  }
}

// ── Client interface ───────────────────────────────────────────────────────────

export interface HasznoClient {
  health: {
    check(): Promise<{ ok: boolean }>
  }

  settings: {
    get(): Promise<Settings>
    update(body: { undercutPct: number; minMarginPct: number; vatPct: number }): Promise<Settings>
  }

  products: {
    list(params?: { all?: boolean }): Promise<Product[]>
    update(id: number, body: { marketMinGross?: number | null; marketShop?: string | null; priceGross?: number }): Promise<Product>
    setListing(id: number, body: { listed: boolean }): Promise<Product>
    generateAiDescription(id: number): Promise<{ text: string }>
    applyPrices(body?: { ids?: number[] }): Promise<ApplyPricesResult>
  }

  stats: {
    get(): Promise<Stats>
    getImpact(params?: { days?: number }): Promise<Impact>
  }

  suppliers: {
    list(): Promise<Supplier[]>
  }

  feeds: {
    importFeed(body: { supplierId: number; format: 'csv' | 'xml'; content: string }): Promise<FeedImportResult>
    importMarketPrices(body: { content: string }): Promise<MarketImportResult>
  }

  orders: {
    list(): Promise<Order[]>
    receiveOrder(body: { externalId: string; customerName: string; address: string; items: Array<{ sku: string; qty: number }> }): Promise<{ id: number }>
    ship(id: number): Promise<Order>
    createDemo(): Promise<{ id: number }>
  }

  recommendations: {
    get(): Promise<Recommendations>
    getAiShortlist(): Promise<AiShortlistResult>
    fillTrendKeywords(): Promise<{ updated: number }>
  }

  rules: {
    listTemplates(): Promise<RuleTemplate[]>
    list(): Promise<Rule[]>
    create(body: { name: string; enabled?: boolean; trigger: string; conditions?: RuleCondition[]; actions: RuleAction[]; template?: string | null }): Promise<Rule>
    update(id: number, body: { name?: string; enabled?: boolean; trigger?: string; conditions?: RuleCondition[]; actions?: RuleAction[] }): Promise<Rule>
    delete(id: number): Promise<{ deleted: boolean }>
    run(id: number): Promise<RunResult>
    runAll(): Promise<RunResult>
    trigger(body: { trigger: string; productIds?: number[] }): Promise<RunResult>
    listRuns(params?: { limit?: number }): Promise<RuleRun[]>
    undoUnlists(body: { ids?: number[]; ruleId?: number; at?: string }): Promise<{ relisted: number }>
  }

  proposals: {
    list(params?: { status?: ProposalStatus }): Promise<Proposal[]>
    approve(body?: { ids?: number[] }): Promise<ApproveResult>
    reject(body: { ids: number[] }): Promise<{ rejected: number }>
    rollback(body: { batchId: string }): Promise<RollbackResult>
    /**
     * Submit a price-change proposal via the agent endpoint (shop token only).
     * In legacy mode this method still exists but calls POST /api/proposals
     * is not an agent endpoint — use the rules engine or the web UI for that.
     * The nonce must be generated once per action and reused on retries.
     */
    propose(body: AgentProposalBody): Promise<AgentProposalResult>
  }

  automation: {
    get(): Promise<{ paused: boolean }>
    set(body: { paused: boolean }): Promise<{ paused: boolean }>
  }

  network: {
    listSuppliers(): Promise<NetworkSupplier[]>
    getSupplierProducts(id: number): Promise<NetworkProduct[]>
    connect(id: number): Promise<ConnectResult>
    disconnect(id: number): Promise<{ status: string }>
    sync(id: number): Promise<SyncResult>
    getSupplierView(supplierId: number): Promise<SupplierView>
  }

  catalogue: {
    search(params: {
      q?: string
      cats?: string
      partner?: number
      minMarginPct?: number
      maxPrice?: number
      minPrice?: number
      inStock?: boolean
      hasImage?: boolean
      country?: string
      sort?: 'margin_desc' | 'price_asc' | 'price_desc' | 'name_asc'
      page?: number
      pageSize?: number
    }): Promise<CatalogueSearchResult>
  }

  importList: {
    list(params?: { status?: string; partner?: number; q?: string }): Promise<ImportListItem[]>
    add(body: { networkProductIds: number[] }): Promise<ImportListAddResult>
    /** With targetConnectionId → calls POST /api/connect/stores/:id/push → ConnectStorePushResult */
    push(body: { ids: number[]; targetConnectionId: number }): Promise<ConnectStorePushResult>
    /** Without targetConnectionId → calls POST /api/import-list/push → ImportListPushResult */
    push(body: { ids: number[] }): Promise<ImportListPushResult>
  }

  connections: {
    list(): Promise<StoreConnection[]>
    get(id: number): Promise<StoreConnection>
  }

  peers: {
    createInvite(body: { supplierId: number; expiresAt: string }): Promise<PeerInvite>
    listInvites(): Promise<PeerInvite[]>
    revokeInvite(code: string): Promise<{ revoked: boolean }>
    acceptInvite(code: string, body: { acceptorId: string }): Promise<PeerLink>
    listLinks(): Promise<PeerLink[]>
    removeLink(id: number): Promise<{ removed: boolean }>
    setVisibility(id: number, body: { visibility: 'private' | 'public' }): Promise<{ id: number; visibility: string }>
  }

  blog: {
    list(params?: { period?: BlogPeriod; page?: number; perPage?: number }): Promise<BlogListResult>
    get(slug: string): Promise<BlogPost>
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Detect whether the resolved credential is a shop API token.
 * Checks opts.apiKey and the same env-var chain as http.ts buildAuthHeader.
 */
function detectShopToken(opts: HttpOptions): string | undefined {
  const key =
    opts.apiKey ??
    process.env['HASZNO_API_TOKEN'] ??
    process.env['HASZNO_API_KEY'] ??
    process.env['ARFUTAR_API_KEY']
  return isShopToken(key) ? key : undefined
}

/** Returns a function that returns a rejected Promise (zero HTTP calls). */
function notSupported(op: string): (..._args: unknown[]) => Promise<never> {
  return (..._args: unknown[]): Promise<never> => {
    return Promise.reject(new ShopTokenNotSupportedError(op))
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createClient(opts: HttpOptions = {}): HasznoClient {
  const shopToken = detectShopToken(opts)

  if (shopToken) {
    return createShopTokenClient({ ...opts, apiKey: shopToken })
  }
  return createLegacyClient(opts)
}

/**
 * Shop-token client: routes reads to /api/agent/*, blocks disabled ops.
 * The token is sent as Authorization: Bearer (handled by http.ts buildAuthHeader).
 */
function createShopTokenClient(opts: HttpOptions): HasznoClient {
  const o = opts

  return {
    health: {
      check: () => get('/api/health', o),
    },

    // settings.get is not on the agent API — blocked
    settings: {
      get: notSupported('settings.get'),
      update: notSupported('settings.update'),
    },

    // /api/agent/products — shop-scoped, no purchase cost
    products: {
      list: (_params?: { all?: boolean }) => get('/api/agent/products', o),
      update: notSupported('products.update'),
      setListing: notSupported('products.setListing'),
      generateAiDescription: notSupported('products.generateAiDescription'),
      applyPrices: notSupported('products.applyPrices'),
    },

    stats: {
      get: notSupported('stats.get'),
      getImpact: notSupported('stats.getImpact'),
    },

    suppliers: {
      list: notSupported('suppliers.list'),
    },

    feeds: {
      importFeed: notSupported('feeds.importFeed'),
      importMarketPrices: notSupported('feeds.importMarketPrices'),
    },

    // /api/agent/orders — last 20 orders, shop-scoped
    orders: {
      list: () => get('/api/agent/orders', o),
      receiveOrder: notSupported('orders.receiveOrder'),
      ship: notSupported('orders.ship'),
      createDemo: notSupported('orders.createDemo'),
    },

    recommendations: {
      get: notSupported('recommendations.get'),
      getAiShortlist: notSupported('recommendations.getAiShortlist'),
      fillTrendKeywords: notSupported('recommendations.fillTrendKeywords'),
    },

    rules: {
      listTemplates: notSupported('rules.listTemplates'),
      list: notSupported('rules.list'),
      create: notSupported('rules.create'),
      update: notSupported('rules.update'),
      delete: notSupported('rules.delete'),
      run: notSupported('rules.run'),
      runAll: notSupported('rules.runAll'),
      trigger: notSupported('rules.trigger'),
      listRuns: notSupported('rules.listRuns'),
      undoUnlists: notSupported('rules.undoUnlists'),
    },

    proposals: {
      // /api/agent/proposals — returns pending proposals for this shop
      list: (_params?: { status?: ProposalStatus }) => get('/api/agent/proposals', o),
      // approve/reject/rollback are human-only — blocked for agent tokens
      approve: notSupported('proposals.approve'),
      reject: notSupported('proposals.reject'),
      rollback: notSupported('proposals.rollback'),
      // POST /api/agent/proposals — submit a price-change proposal for human review
      propose: (body: AgentProposalBody) => post('/api/agent/proposals', body, o),
    },

    automation: {
      get: notSupported('automation.get'),
      set: notSupported('automation.set'),
    },

    network: {
      listSuppliers: notSupported('network.listSuppliers'),
      getSupplierProducts: notSupported('network.getSupplierProducts'),
      connect: notSupported('network.connect'),
      disconnect: notSupported('network.disconnect'),
      sync: notSupported('network.sync'),
      getSupplierView: notSupported('network.getSupplierView'),
    },

    catalogue: {
      search: notSupported('catalogue.search'),
    },

    importList: {
      list: notSupported('importList.list'),
      add: notSupported('importList.add'),
      push: notSupported('importList.push') as HasznoClient['importList']['push'],
    },

    connections: {
      list: notSupported('connections.list'),
      get: notSupported('connections.get'),
    },

    peers: {
      createInvite: notSupported('peers.createInvite'),
      listInvites: notSupported('peers.listInvites'),
      revokeInvite: notSupported('peers.revokeInvite'),
      acceptInvite: notSupported('peers.acceptInvite'),
      listLinks: notSupported('peers.listLinks'),
      removeLink: notSupported('peers.removeLink'),
      setVisibility: notSupported('peers.setVisibility'),
    },

    blog: {
      list: notSupported('blog.list'),
      get: notSupported('blog.get'),
    },
  }
}

/**
 * Legacy client: behaviour byte-for-byte identical to the original createClient().
 * Non-prefixed API key → x-api-key header; Basic → Authorization: Basic.
 */
function createLegacyClient(opts: HttpOptions): HasznoClient {
  const o = opts

  return {
    health: {
      check: () => get('/api/health', o),
    },

    settings: {
      get: () => get('/api/settings', o),
      update: (body) => put('/api/settings', body, o),
    },

    products: {
      list: (params) => {
        const qs = params?.all ? '?all=1' : ''
        return get(`/api/products${qs}`, o)
      },
      update: (id, body) => patch(`/api/products/${id}`, body, o),
      setListing: (id, body) => post(`/api/products/${id}/listing`, body, o),
      generateAiDescription: (id) => post(`/api/products/${id}/ai-description`, null, o),
      applyPrices: (body) => post('/api/products/apply-prices', body ?? {}, o),
    },

    stats: {
      get: () => get('/api/stats', o),
      getImpact: (params) => {
        const qs = params?.days != null ? `?days=${params.days}` : ''
        return get(`/api/impact${qs}`, o)
      },
    },

    suppliers: {
      list: () => get('/api/suppliers', o),
    },

    feeds: {
      importFeed: (body) => post('/api/feeds/import', body, o),
      importMarketPrices: (body) => post('/api/market-prices/import', body, o),
    },

    orders: {
      list: () => get('/api/orders', o),
      receiveOrder: (body) => post('/api/webhooks/order', body, o),
      ship: (id) => post(`/api/orders/${id}/ship`, null, o),
      createDemo: () => post('/api/demo/order', null, o),
    },

    recommendations: {
      get: () => get('/api/recommendations', o),
      getAiShortlist: () => post('/api/recommendations/ai', null, o),
      fillTrendKeywords: () => post('/api/trends/keywords', null, o),
    },

    rules: {
      listTemplates: () => get('/api/rules/templates', o),
      list: () => get('/api/rules', o),
      create: (body) => post('/api/rules', body, o),
      update: (id, body) => patch(`/api/rules/${id}`, body, o),
      delete: (id) => del(`/api/rules/${id}`, o),
      run: (id) => post(`/api/rules/${id}/run`, null, o),
      runAll: () => post('/api/rules/run-all', null, o),
      trigger: (body) => post('/api/rules/trigger', body, o),
      listRuns: (params) => {
        const qs = params?.limit != null ? `?limit=${params.limit}` : ''
        return get(`/api/rule-runs${qs}`, o)
      },
      undoUnlists: (body) => post('/api/rule-runs/undo', body, o),
    },

    proposals: {
      list: (params) => {
        const qs = params?.status ? `?status=${params.status}` : ''
        return get(`/api/proposals${qs}`, o)
      },
      approve: (body) => post('/api/proposals/approve', body ?? {}, o),
      reject: (body) => post('/api/proposals/reject', body, o),
      rollback: (body) => post('/api/proposals/rollback', body, o),
      // Legacy mode: no agent propose endpoint; not applicable outside shop-token mode
      propose: notSupported('proposals.propose (requires a shop API token)'),
    },

    automation: {
      get: () => get('/api/automation', o),
      set: (body) => put('/api/automation', body, o),
    },

    network: {
      listSuppliers: () => get('/api/network/suppliers', o),
      getSupplierProducts: (id) => get(`/api/network/suppliers/${id}/products`, o),
      connect: (id) => post(`/api/network/suppliers/${id}/connect`, null, o),
      disconnect: (id) => post(`/api/network/suppliers/${id}/disconnect`, null, o),
      sync: (id) => post(`/api/network/suppliers/${id}/sync`, null, o),
      getSupplierView: (supplierId) => get(`/api/network/supplier-view/${supplierId}`, o),
    },

    catalogue: {
      search: (params) => {
        const qs = new URLSearchParams()
        if (params.q) qs.set('q', params.q)
        if (params.cats) qs.set('cats', params.cats)
        if (params.partner != null) qs.set('partner', String(params.partner))
        if (params.minMarginPct != null) qs.set('minMarginPct', String(params.minMarginPct))
        if (params.maxPrice != null) qs.set('maxPrice', String(params.maxPrice))
        if (params.minPrice != null) qs.set('minPrice', String(params.minPrice))
        if (params.inStock) qs.set('inStock', '1')
        if (params.hasImage) qs.set('hasImage', '1')
        if (params.country) qs.set('country', params.country)
        if (params.sort) qs.set('sort', params.sort)
        if (params.page != null) qs.set('page', String(params.page))
        if (params.pageSize != null) qs.set('pageSize', String(params.pageSize))
        const suffix = qs.toString() ? `?${qs.toString()}` : ''
        return get(`/api/catalogue/products${suffix}`, o)
      },
    },

    importList: {
      list: (params) => {
        const qs = new URLSearchParams()
        if (params?.status) qs.set('status', params.status)
        if (params?.partner != null) qs.set('partner', String(params.partner))
        if (params?.q) qs.set('q', params.q)
        const suffix = qs.toString() ? `?${qs.toString()}` : ''
        return get(`/api/import-list${suffix}`, o)
      },
      add: (body) => post('/api/import-list', body, o),
      // Routes to the correct endpoint depending on whether a target connection is given.
      push: ((body: { ids: number[]; targetConnectionId?: number }) => {
        if (body.targetConnectionId != null) {
          return post<ConnectStorePushResult>(
            `/api/connect/stores/${body.targetConnectionId}/push`,
            { importListIds: body.ids },
            o,
          )
        }
        return post<ImportListPushResult>('/api/import-list/push', { ids: body.ids }, o)
      }) as HasznoClient['importList']['push'],
    },

    connections: {
      list: () => get('/api/connect/stores', o),
      get: (id) => get(`/api/connect/stores/${id}`, o),
    },

    peers: {
      createInvite: (body) => post('/api/peers/invites', body, o),
      listInvites: () => get('/api/peers/invites', o),
      revokeInvite: (code) => del(`/api/peers/invites/${code}`, o),
      acceptInvite: (code, body) => post(`/api/peers/invites/${code}/accept`, body, o),
      listLinks: () => get('/api/peers/links', o),
      removeLink: (id) => del(`/api/peers/links/${id}`, o),
      setVisibility: (id, body) => put(`/api/peers/suppliers/${id}/visibility`, body, o),
    },

    blog: {
      list: (params) => {
        const qs = new URLSearchParams()
        if (params?.period) qs.set('period', params.period)
        if (params?.page != null) qs.set('page', String(params.page))
        if (params?.perPage != null) qs.set('perPage', String(params.perPage))
        const suffix = qs.toString() ? `?${qs.toString()}` : ''
        return get(`/api/blog${suffix}`, o)
      },
      get: (slug) => get(`/api/blog/${slug}`, o),
    },
  }
}
