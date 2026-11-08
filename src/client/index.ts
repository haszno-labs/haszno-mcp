/**
 * Haszno HTTP client — vendored into haszno-mcp.
 *
 * Usage:
 *   import { createClient } from './client/index.js'
 *   const client = createClient()   // reads HASZNO_API_URL + HASZNO_API_KEY from env
 *   const products = await client.products.list()
 */
import { type HttpOptions, get, post, put, patch, del } from './http.js'
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
}

export function createClient(opts: HttpOptions = {}): HasznoClient {
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
  }
}
