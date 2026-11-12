/** All money values are whole forints. `costNet` is VAT-exclusive; prices are gross. */

export interface MarginResult {
  priceGross: number
  marginNet: number
  marginPct: number
}

export interface Settings {
  id: 1
  undercutPct: number
  minMarginPct: number
  vatPct: number
  automationPaused: boolean
}

export interface Product {
  id: number
  supplierId: number
  sku: string
  name: string
  costNet: number
  stock: number
  rrpGross: number | null
  marketMinGross: number | null
  marketShop: string | null
  priceGross: number
  listed: boolean
  trendKeyword: string | null
  trendKeywordEn: string | null
  updatedAt: string
  supplierName: string
  current: MarginResult
  recommended: MarginResult
}

export interface Supplier {
  id: number
  name: string
  orderMode: 'simulated' | 'email'
  email: string | null
  network: boolean
  category: string | null
  country: string | null
  description: string | null
  shopUrl: string | null
  createdAt: string
}

export interface OrderEvent {
  at: string
  text: string
}

export interface OrderItem {
  orderId: number
  qty: number
  priceGross: number
  name: string
  sku: string
}

export interface Order {
  id: number
  externalId: string
  customerName: string
  address: string
  status: 'received' | 'forwarded' | 'shipped' | 'error'
  supplierOrderId: string | null
  trackingNumber: string | null
  totalGross: number
  events: OrderEvent[]
  createdAt: string
  items: OrderItem[]
}

export interface Stats {
  products: number
  losing: number
  overMarket: number
  toFix: number
  orders: number
}

export interface Impact {
  days: number
  extraProfit: number
  baseline: number
  pctGain: number
  orders: number
  autoForwardedOrders: number
}

export type RuleConditionOp = 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq' | 'changed'

export interface RuleCondition {
  field: string
  op: RuleConditionOp
  value?: number | string | null
}

export interface RuleAction {
  type: string
  params?: Record<string, unknown>
}

export interface Rule {
  id: number
  name: string
  enabled: boolean
  trigger: string
  conditions: RuleCondition[]
  actions: RuleAction[]
  template: string | null
  createdAt: string
}

export interface RuleTemplate {
  key: string
  name: string
  description: string
  trigger: string
  conditions: RuleCondition[]
  actions: RuleAction[]
}

export interface RuleRun {
  id: number
  ruleId: number
  ruleName: string | null
  trigger: string
  productId: number | null
  summary: string
  at: string
}

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'rolled_back'

export interface Proposal {
  id: number
  productId: number
  productName: string | null
  productSku: string | null
  oldPriceGross: number
  proposedPriceGross: number
  reason: string
  source: string
  status: ProposalStatus
  batchId: string | null
  createdAt: string
  decidedAt: string | null
}

export interface NetworkSupplier extends Supplier {
  connected: boolean
  productCount: number
  avgResellerMarginPct: number | null
}

export interface NetworkProduct {
  id: number
  supplierId: number
  sku: string
  name: string
  ean: string | null
  category: string | null
  wholesaleNet: number
  rrpGross: number | null
  stock: number
  updatedAt: string
  potentialMargin: MarginResult
}

export interface ResellerStats {
  resellerCount: number
  minGross: number | null
  avgGross: number | null
  maxGross: number | null
  belowRrp: number
  lossCount: number
  saturation: number
}

export interface NetworkProductStats extends ResellerStats {
  id: number
  sku: string
  name: string
  ean: string | null
  category: string | null
  wholesaleNet: number
  rrpGross: number | null
  stock: number
}

export interface SupplierView {
  supplier: Pick<Supplier, 'id' | 'name' | 'category' | 'country' | 'shopUrl'>
  products: NetworkProductStats[]
}

export interface RecommendationItem {
  id: number
  sku: string
  name: string
  costNet: number
  stock: number
  supplierName: string
  recommended: MarginResult
  trendScore?: number
}

export interface Recommendations {
  anchor: string
  geo: string
  items: RecommendationItem[]
}

export interface AiUsage {
  model: string
  inputTokens: number
  outputTokens: number
  /** Estimated cost in Hungarian forints (not an official invoice amount) */
  costFt: number
}

export interface AiShortlistPick {
  productId: number
  networkProductId: number | null
  name: string
  imageUrl: string | null
  supplierName: string
  recommendedPriceGross: number
  marginNet: number
  marginPct: number
  listed: boolean
  fit: number
  aiReason: string
}

export interface AiShortlistResult {
  summary: string
  picks: AiShortlistPick[]
  usage: AiUsage | null
  cached?: boolean
}

// ---- request/response helpers ----

export interface FeedImportResult {
  created: number
  updated: number
  total: number
}

export interface MarketImportResult {
  matched: number
  total: number
}

export interface ApplyPricesResult {
  changed: number
  total: number
}

export interface ApproveResult {
  batchId: string | null
  applied: number
}

export interface RollbackResult {
  rolledBack: number
}

export interface ConnectResult {
  status: string
  imported: number
  skipped: number
}

export interface SyncResult {
  costChanges: number
  stockOuts: number
  total: number
}

export interface RunResult {
  applied?: number
  skipped?: number
  errors?: number
  [key: string]: unknown
}

// ---- Catalogue / Import list ------------------------------------------------

export interface CatalogueItem {
  id: number
  name: string
  imageUrl: string | null
  partnerId: number
  partnerName: string
  partnerCountry: string | null
  category: string | null
  categoryKey: string | null
  wholesaleNet: number | null
  rrpGross: number | null
  marginNet: number | null
  marginPct: number | null
  stock: number
  example: boolean
  inImportList: boolean
  inShop: boolean
}

export interface CatalogueFacets {
  partners: { id: number; name: string; count: number }[]
  countries: { country: string; count: number }[]
  categories: { key: string | null; label: string | null; count: number }[]
  marginBuckets: { label: string; min: number; max: number | null; count: number }[]
}

export interface CatalogueSearchResult {
  items: CatalogueItem[]
  total: number
  facets: CatalogueFacets
}

export interface ImportListItem {
  id: number
  networkProductId: number
  name: string
  sku: string
  partnerName: string
  wholesaleNet: number | null
  rrpGross: number | null
  stock: number
  pushStatus: 'varakozik' | 'kuldve' | 'kesz' | 'hiba'
  targetConnectionId: number | null
  targetExternalId: string | null
  addedAt: string
}

export interface ImportListAddResult {
  added: number
  skipped: number
}

/** Returned by POST /api/import-list/push (no target store). */
export interface ImportListPushResult {
  pushed: number
}

/** Returned by POST /api/connect/stores/:id/push (target store specified). */
export interface ConnectStorePushResult {
  pushed: number
  failed: number
  errors: string[]
}

// ---- Store connections -------------------------------------------------------

export interface StoreConnection {
  id: number
  platform: string
  name: string
  status: 'uj' | 'domain_ok' | 'kapcsolva' | 'hiba'
  domain: string | null
  lastError: string | null
  connectedAt: string | null
  config: Record<string, unknown>
  lastSyncAt: string | null
  createdAt: string
}

// ---- Peers / P2P ------------------------------------------------------------

export interface PeerInvite {
  id: number
  code: string
  createdBy: string
  supplierId: number
  expiresAt: string
  acceptedBy: string | null
  acceptedAt: string | null
  revokedAt: string | null
  createdAt: string
}

export interface PeerLink {
  id: number
  supplierId: number
  partner: string
  createdAt: string
}

// ---- Blog -------------------------------------------------------------------

export type BlogPostStatus = 'piszkozat' | 'publikalt'
export type BlogPeriod = 'het' | 'honap'

export interface BlogPostData {
  rankedCategories?: Array<{ category: string; score: number }>
  rankedProducts?: Array<{ name: string; score: number }>
  shopsCount?: number
}

export interface BlogPost {
  id: number
  slug: string
  period: BlogPeriod
  periodStart: string
  periodEnd: string
  title: string
  summary: string
  bodyMd: string
  data: BlogPostData
  ogTitle: string | null
  publishedAt: string | null
  status: BlogPostStatus
  createdAt: string
  updatedAt: string
}

export interface BlogListResult {
  posts: BlogPost[]
  total: number
  page: number
  perPage: number
}

// ---- Agent API types (GET /api/agent/* and POST /api/agent/proposals) -------
// These types match exactly what the server returns from the agent endpoints.
// Purchase cost (costNet) is deliberately absent — the server never returns it.

/** Product as returned by GET /api/agent/products */
export interface AgentProduct {
  id: number
  sku: string
  name: string
  listed: boolean
  priceGross: number
  stock: number
  supplierName: string
  current: MarginResult
  recommended: MarginResult
}

/** Order item as returned by GET /api/agent/orders */
export interface AgentOrderItem {
  orderId: number
  qty: number
  priceGross: number
  name: string
  sku: string
}

/**
 * Order as returned by GET /api/agent/orders (last 20, newest-first).
 * Note: address, supplierOrderId, trackingNumber and events are NOT returned
 * by the agent endpoint — these are session-only fields.
 */
export interface AgentOrder {
  id: number
  externalId: string
  customerName: string
  status: 'received' | 'forwarded' | 'shipped' | 'error'
  totalGross: number
  createdAt: string
  items: AgentOrderItem[]
}

/**
 * Proposal as returned by GET /api/agent/proposals (pending only, scoped to shop).
 * Note: source, batchId and decidedAt are NOT returned by the agent endpoint.
 */
export interface AgentProposal {
  id: number
  productId: number
  productName: string | null
  productSku: string | null
  oldPriceGross: number
  proposedPriceGross: number
  reason: string
  status: string
  createdAt: string
}

/** Request body for POST /api/agent/proposals */
export interface CreateProposalRequest {
  productId: number
  proposedPriceGross: number
  /** Free text, 1–500 chars. Stored verbatim — never interpreted as code. */
  reason: string
  /**
   * Opaque dedup key (1–128 chars).  A second request with the same nonce returns 409.
   * Generate with crypto.randomUUID() — do not reuse across requests.
   */
  nonce: string
}

/** Response body from POST /api/agent/proposals (201 Created) */
export interface CreateProposalResult {
  id: number
  status: 'pending'
  createdAt: string
}
