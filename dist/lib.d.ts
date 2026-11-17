import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

interface HttpOptions {
    baseUrl?: string;
    apiKey?: string;
    basicAuth?: string;
    /** fetch implementation; defaults to global fetch */
    fetch?: typeof fetch;
    /** initial retry delay ms (doubles each attempt) */
    retryDelayMs?: number;
    /** max retry attempts */
    maxRetries?: number;
    /** request timeout ms */
    timeoutMs?: number;
    /**
     * When true, disables ALL process.env fallbacks for auth credentials and baseUrl.
     * Required for hosted/remote MCP endpoints where every credential must be supplied
     * explicitly in opts — never read from the host server's environment.
     */
    noEnvFallback?: boolean;
}

declare function registerShopTools(server: McpServer, opts: HttpOptions, flags?: {
    remote?: boolean;
}): void;

declare function registerJobTools(server: McpServer, opts: HttpOptions, flags?: {
    remote?: boolean;
}): void;

/** All money values are whole forints. `costNet` is VAT-exclusive; prices are gross. */
interface MarginResult {
    priceGross: number;
    marginNet: number;
    marginPct: number;
}
interface Settings {
    id: 1;
    undercutPct: number;
    minMarginPct: number;
    vatPct: number;
    automationPaused: boolean;
}
interface Product {
    id: number;
    supplierId: number;
    sku: string;
    name: string;
    costNet: number;
    stock: number;
    rrpGross: number | null;
    marketMinGross: number | null;
    marketShop: string | null;
    priceGross: number;
    listed: boolean;
    trendKeyword: string | null;
    trendKeywordEn: string | null;
    updatedAt: string;
    supplierName: string;
    current: MarginResult;
    recommended: MarginResult;
}
interface Supplier {
    id: number;
    name: string;
    orderMode: 'simulated' | 'email';
    email: string | null;
    network: boolean;
    category: string | null;
    country: string | null;
    description: string | null;
    shopUrl: string | null;
    createdAt: string;
}
interface OrderEvent {
    at: string;
    text: string;
}
interface OrderItem {
    orderId: number;
    qty: number;
    priceGross: number;
    name: string;
    sku: string;
}
interface Order {
    id: number;
    externalId: string;
    customerName: string;
    address: string;
    status: 'received' | 'forwarded' | 'shipped' | 'error';
    supplierOrderId: string | null;
    trackingNumber: string | null;
    totalGross: number;
    events: OrderEvent[];
    createdAt: string;
    items: OrderItem[];
}
interface Stats {
    products: number;
    losing: number;
    overMarket: number;
    toFix: number;
    orders: number;
}
interface Impact {
    days: number;
    extraProfit: number;
    baseline: number;
    pctGain: number;
    orders: number;
    autoForwardedOrders: number;
}
type RuleConditionOp = 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq' | 'changed';
interface RuleCondition {
    field: string;
    op: RuleConditionOp;
    value?: number | string | null;
}
interface RuleAction {
    type: string;
    params?: Record<string, unknown>;
}
interface Rule {
    id: number;
    name: string;
    enabled: boolean;
    trigger: string;
    conditions: RuleCondition[];
    actions: RuleAction[];
    template: string | null;
    createdAt: string;
}
interface RuleTemplate {
    key: string;
    name: string;
    description: string;
    trigger: string;
    conditions: RuleCondition[];
    actions: RuleAction[];
}
interface RuleRun {
    id: number;
    ruleId: number;
    ruleName: string | null;
    trigger: string;
    productId: number | null;
    summary: string;
    at: string;
}
type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'rolled_back';
interface Proposal {
    id: number;
    productId: number;
    productName: string | null;
    productSku: string | null;
    oldPriceGross: number;
    proposedPriceGross: number;
    reason: string;
    source: string;
    status: ProposalStatus;
    batchId: string | null;
    createdAt: string;
    decidedAt: string | null;
}
interface NetworkSupplier extends Supplier {
    connected: boolean;
    productCount: number;
    avgResellerMarginPct: number | null;
}
interface NetworkProduct {
    id: number;
    supplierId: number;
    sku: string;
    name: string;
    ean: string | null;
    category: string | null;
    wholesaleNet: number;
    rrpGross: number | null;
    stock: number;
    updatedAt: string;
    potentialMargin: MarginResult;
}
interface ResellerStats {
    resellerCount: number;
    minGross: number | null;
    avgGross: number | null;
    maxGross: number | null;
    belowRrp: number;
    lossCount: number;
    saturation: number;
}
interface NetworkProductStats extends ResellerStats {
    id: number;
    sku: string;
    name: string;
    ean: string | null;
    category: string | null;
    wholesaleNet: number;
    rrpGross: number | null;
    stock: number;
}
interface SupplierView {
    supplier: Pick<Supplier, 'id' | 'name' | 'category' | 'country' | 'shopUrl'>;
    products: NetworkProductStats[];
}
interface RecommendationItem {
    id: number;
    sku: string;
    name: string;
    costNet: number;
    stock: number;
    supplierName: string;
    recommended: MarginResult;
    trendScore?: number;
}
interface Recommendations {
    anchor: string;
    geo: string;
    items: RecommendationItem[];
}
interface AiUsage {
    model: string;
    inputTokens: number;
    outputTokens: number;
    /** Estimated cost in Hungarian forints (not an official invoice amount) */
    costFt: number;
}
interface AiShortlistPick {
    productId: number;
    networkProductId: number | null;
    name: string;
    imageUrl: string | null;
    supplierName: string;
    recommendedPriceGross: number;
    marginNet: number;
    marginPct: number;
    listed: boolean;
    fit: number;
    aiReason: string;
}
interface AiShortlistResult {
    summary: string;
    picks: AiShortlistPick[];
    usage: AiUsage | null;
    cached?: boolean;
}
interface FeedImportResult {
    created: number;
    updated: number;
    total: number;
}
interface MarketImportResult {
    matched: number;
    total: number;
}
interface ApplyPricesResult {
    changed: number;
    total: number;
}
interface ApproveResult {
    batchId: string | null;
    applied: number;
}
interface RollbackResult {
    rolledBack: number;
}
interface ConnectResult {
    status: string;
    imported: number;
    skipped: number;
}
interface SyncResult {
    costChanges: number;
    stockOuts: number;
    total: number;
}
interface RunResult {
    applied?: number;
    skipped?: number;
    errors?: number;
    [key: string]: unknown;
}
interface CatalogueItem {
    id: number;
    name: string;
    imageUrl: string | null;
    partnerId: number;
    partnerName: string;
    partnerCountry: string | null;
    category: string | null;
    categoryKey: string | null;
    wholesaleNet: number | null;
    rrpGross: number | null;
    marginNet: number | null;
    marginPct: number | null;
    stock: number;
    example: boolean;
    inImportList: boolean;
    inShop: boolean;
}
interface CatalogueFacets {
    partners: {
        id: number;
        name: string;
        count: number;
    }[];
    countries: {
        country: string;
        count: number;
    }[];
    categories: {
        key: string | null;
        label: string | null;
        count: number;
    }[];
    marginBuckets: {
        label: string;
        min: number;
        max: number | null;
        count: number;
    }[];
}
interface CatalogueSearchResult {
    items: CatalogueItem[];
    total: number;
    facets: CatalogueFacets;
}
interface ImportListItem {
    id: number;
    networkProductId: number;
    name: string;
    sku: string;
    partnerName: string;
    wholesaleNet: number | null;
    rrpGross: number | null;
    stock: number;
    pushStatus: 'varakozik' | 'kuldve' | 'kesz' | 'hiba';
    targetConnectionId: number | null;
    targetExternalId: string | null;
    addedAt: string;
}
interface ImportListAddResult {
    added: number;
    skipped: number;
}
/** Returned by POST /api/import-list/push (no target store). */
interface ImportListPushResult {
    pushed: number;
}
/** Returned by POST /api/connect/stores/:id/push (target store specified). */
interface ConnectStorePushResult {
    pushed: number;
    failed: number;
    errors: string[];
}
interface StoreConnection {
    id: number;
    platform: string;
    name: string;
    status: 'uj' | 'domain_ok' | 'kapcsolva' | 'hiba';
    domain: string | null;
    lastError: string | null;
    connectedAt: string | null;
    config: Record<string, unknown>;
    lastSyncAt: string | null;
    createdAt: string;
}
interface PeerInvite {
    id: number;
    code: string;
    createdBy: string;
    supplierId: number;
    expiresAt: string;
    acceptedBy: string | null;
    acceptedAt: string | null;
    revokedAt: string | null;
    createdAt: string;
}
interface PeerLink {
    id: number;
    supplierId: number;
    partner: string;
    createdAt: string;
}
type BlogPostStatus = 'piszkozat' | 'publikalt';
type BlogPeriod = 'het' | 'honap';
interface BlogPostData {
    rankedCategories?: Array<{
        category: string;
        score: number;
    }>;
    rankedProducts?: Array<{
        name: string;
        score: number;
    }>;
    shopsCount?: number;
}
interface BlogPost {
    id: number;
    slug: string;
    period: BlogPeriod;
    periodStart: string;
    periodEnd: string;
    title: string;
    summary: string;
    bodyMd: string;
    data: BlogPostData;
    ogTitle: string | null;
    publishedAt: string | null;
    status: BlogPostStatus;
    createdAt: string;
    updatedAt: string;
}
interface BlogListResult {
    posts: BlogPost[];
    total: number;
    page: number;
    perPage: number;
}
type ActionInput = {
    type: 'felvetel';
    productId: number;
} | {
    type: 'levetel';
    productId: number;
} | {
    type: 'ar';
    productId: number;
    priceGross: number;
} | {
    type: 'import';
    networkProductId: number;
};
type ActionStatus = 'javasolt' | 'vegrehajtva' | 'elutasitva' | 'hiba' | 'visszavonva';
type ActionOrigin = 'agent' | 'autopilot' | 'jelentes' | 'kezi';
type ReportItemKind = 'ar_emelkedes' | 'ar_csokkenes' | 'trend' | 'hir' | 'keszlet' | 'top_eladas' | 'lehetoseg';
interface AgentActionTarget {
    name: string;
    sku: string | null;
    imageUrl: string | null;
}
interface AgentActionPreview {
    oldPriceGross: number | null;
    newPriceGross: number | null;
    floorGross: number | null;
    marginPct: number | null;
}
interface AgentAction {
    id: number;
    action: ActionInput;
    reason: string;
    status: ActionStatus;
    origin: ActionOrigin;
    autoApproved: boolean;
    reportItemId: number | null;
    target: AgentActionTarget | null;
    preview: AgentActionPreview | null;
    error: string | null;
    canUndo: boolean;
    createdAt: string;
    decidedAt: string | null;
    executedAt: string | null;
}
interface ReportItem {
    id: number;
    origin: 'rendszer' | 'agent';
    kind: ReportItemKind;
    title: string;
    body: string;
    changePct: number | null;
    keyword: string | null;
    productId: number | null;
    productName: string | null;
    sourceName: string | null;
    sourceUrl: string | null;
    suggestedAction: ActionInput | null;
    action: AgentAction | null;
}
interface DailyReport {
    id: number;
    day: string;
    headline: string;
    summary: string;
    items: ReportItem[];
    createdAt: string;
    updatedAt: string;
}
interface DailyReportSummary {
    id: number;
    day: string;
    headline: string;
    itemCount: number;
    agentItemCount: number;
}
interface ResearchBriefFocus {
    keyword: string;
    productId: number | null;
    name: string;
    priceGross: number | null;
    marketMinGross: number | null;
    trend: 'emelkedo' | 'stabil' | 'csokkeno' | null;
}
interface ResearchBrief {
    day: string;
    shopFocus: ResearchBriefFocus[];
    questions: string[];
    postTo: string;
}
interface FindingInput {
    kind: ReportItemKind;
    title: string;
    body: string;
    changePct?: number | null;
    keyword?: string | null;
    productId?: number | null;
    sourceName?: string | null;
    sourceUrl?: string | null;
    suggestedAction?: ActionInput | null;
}
interface FindingsInput {
    headline?: string;
    summary?: string;
    items: FindingInput[];
}
interface ModulePrice {
    moduleId: string;
    priceHuf: number;
    billable: boolean;
}
interface ModulePriceList {
    currency: 'HUF';
    periodDays: number;
    modules: ModulePrice[];
}
type ModuleSubscriptionStatus = 'pending' | 'active' | 'cancelled' | 'ended';
interface ModuleSubscription {
    moduleId: string;
    status: ModuleSubscriptionStatus;
    activatedAt: string | null;
    expiresAt: string | null;
    cancelledAt: string | null;
}
interface ShopModuleList {
    isOwner: boolean;
    modules: ModuleSubscription[];
}
interface ModuleActivateResult {
    status: ModuleSubscriptionStatus;
    moduleId: string;
    /** Message for immediately-activated (free) modules. */
    message?: string;
    /** Present for billable modules (status=pending) — user must visit checkout.redirectUrl to complete payment. */
    checkout?: {
        redirectUrl: string;
        orderRef: string;
        provider: string;
        amountHuf: number;
    } | null;
}

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

/**
 * Body for POST /api/agent/proposals.
 * The nonce must be generated once per user action (crypto.randomUUID()) and
 * reused across transport retries of the same action.
 */
interface AgentProposalBody {
    productId: number;
    proposedPriceGross: number;
    reason: string;
    /** Opaque dedup key (1–128 chars). Repeating the same nonce returns 409. */
    nonce: string;
}
/** Response from POST /api/agent/proposals (201 Created). */
interface AgentProposalResult {
    id: number;
    status: 'pending';
    createdAt: string;
}
/** Identity of the currently authenticated shop, returned by GET /api/auth/me. */
interface WhoAmI {
    id: number;
    email: string;
    name: string;
    shopId: number;
    shopName: string;
    founderSince: string | null;
    role: string;
    tokenScope: string | null;
}
interface HasznoClient {
    health: {
        check(): Promise<{
            ok: boolean;
        }>;
    };
    /** Identity & token operations — available to Bearer tokens and all other credential modes. */
    auth: {
        /**
         * Returns identity of the authenticated shop.
         * Works with Bearer, Basic, and x-api-key.
         * Recommended first call to verify credentials and discover tokenScope.
         * GET /api/v1/auth/me
         */
        me(): Promise<WhoAmI>;
        /**
         * Revokes the current Bearer token (the one used in this request).
         * Only works with Bearer tokens — not with Basic or x-api-key.
         * POST /api/v1/auth/tokens/revoke-current
         */
        revokeCurrentToken(): Promise<{
            ok: true;
        }>;
    };
    settings: {
        get(): Promise<Settings>;
        update(body: {
            undercutPct: number;
            minMarginPct: number;
            vatPct: number;
        }): Promise<Settings>;
    };
    products: {
        list(params?: {
            all?: boolean;
        }): Promise<Product[]>;
        update(id: number, body: {
            marketMinGross?: number | null;
            marketShop?: string | null;
            priceGross?: number;
        }): Promise<Product>;
        setListing(id: number, body: {
            listed: boolean;
        }): Promise<Product>;
        generateAiDescription(id: number): Promise<{
            text: string;
        }>;
        applyPrices(body?: {
            ids?: number[];
        }): Promise<ApplyPricesResult>;
    };
    stats: {
        get(): Promise<Stats>;
        getImpact(params?: {
            days?: number;
        }): Promise<Impact>;
    };
    suppliers: {
        list(): Promise<Supplier[]>;
    };
    feeds: {
        importFeed(body: {
            supplierId: number;
            format: 'csv' | 'xml';
            content: string;
        }): Promise<FeedImportResult>;
        importMarketPrices(body: {
            content: string;
        }): Promise<MarketImportResult>;
    };
    orders: {
        list(): Promise<Order[]>;
        receiveOrder(body: {
            externalId: string;
            customerName: string;
            address: string;
            items: Array<{
                sku: string;
                qty: number;
            }>;
        }): Promise<{
            id: number;
        }>;
        ship(id: number): Promise<Order>;
        createDemo(): Promise<{
            id: number;
        }>;
    };
    recommendations: {
        get(): Promise<Recommendations>;
        getAiShortlist(): Promise<AiShortlistResult>;
        fillTrendKeywords(): Promise<{
            updated: number;
        }>;
    };
    rules: {
        listTemplates(): Promise<RuleTemplate[]>;
        list(): Promise<Rule[]>;
        create(body: {
            name: string;
            enabled?: boolean;
            trigger: string;
            conditions?: RuleCondition[];
            actions: RuleAction[];
            template?: string | null;
        }): Promise<Rule>;
        update(id: number, body: {
            name?: string;
            enabled?: boolean;
            trigger?: string;
            conditions?: RuleCondition[];
            actions?: RuleAction[];
        }): Promise<Rule>;
        delete(id: number): Promise<{
            deleted: boolean;
        }>;
        run(id: number): Promise<RunResult>;
        runAll(): Promise<RunResult>;
        trigger(body: {
            trigger: string;
            productIds?: number[];
        }): Promise<RunResult>;
        listRuns(params?: {
            limit?: number;
        }): Promise<RuleRun[]>;
        undoUnlists(body: {
            ids?: number[];
            ruleId?: number;
            at?: string;
        }): Promise<{
            relisted: number;
        }>;
    };
    proposals: {
        list(params?: {
            status?: ProposalStatus;
        }): Promise<Proposal[]>;
        approve(body?: {
            ids?: number[];
        }): Promise<ApproveResult>;
        reject(body: {
            ids: number[];
        }): Promise<{
            rejected: number;
        }>;
        rollback(body: {
            batchId: string;
        }): Promise<RollbackResult>;
        /**
         * Submit a price-change proposal via the agent endpoint (shop token only).
         * In legacy mode this method still exists but calls POST /api/proposals
         * is not an agent endpoint — use the rules engine or the web UI for that.
         * The nonce must be generated once per action and reused on retries.
         */
        propose(body: AgentProposalBody): Promise<AgentProposalResult>;
    };
    automation: {
        get(): Promise<{
            paused: boolean;
        }>;
        set(body: {
            paused: boolean;
        }): Promise<{
            paused: boolean;
        }>;
    };
    network: {
        listSuppliers(): Promise<NetworkSupplier[]>;
        getSupplierProducts(id: number): Promise<NetworkProduct[]>;
        connect(id: number): Promise<ConnectResult>;
        disconnect(id: number): Promise<{
            status: string;
        }>;
        sync(id: number): Promise<SyncResult>;
        getSupplierView(supplierId: number): Promise<SupplierView>;
    };
    catalogue: {
        search(params: {
            q?: string;
            cats?: string;
            partner?: number;
            minMarginPct?: number;
            maxPrice?: number;
            minPrice?: number;
            inStock?: boolean;
            hasImage?: boolean;
            country?: string;
            sort?: 'margin_desc' | 'price_asc' | 'price_desc' | 'name_asc';
            page?: number;
            pageSize?: number;
        }): Promise<CatalogueSearchResult>;
    };
    importList: {
        list(params?: {
            status?: string;
            partner?: number;
            q?: string;
        }): Promise<ImportListItem[]>;
        add(body: {
            networkProductIds: number[];
        }): Promise<ImportListAddResult>;
        /** With targetConnectionId → calls POST /api/connect/stores/:id/push → ConnectStorePushResult */
        push(body: {
            ids: number[];
            targetConnectionId: number;
        }): Promise<ConnectStorePushResult>;
        /** Without targetConnectionId → calls POST /api/import-list/push → ImportListPushResult */
        push(body: {
            ids: number[];
        }): Promise<ImportListPushResult>;
    };
    connections: {
        list(): Promise<StoreConnection[]>;
        get(id: number): Promise<StoreConnection>;
    };
    peers: {
        createInvite(body: {
            supplierId: number;
            expiresAt: string;
        }): Promise<PeerInvite>;
        listInvites(): Promise<PeerInvite[]>;
        revokeInvite(code: string): Promise<{
            revoked: boolean;
        }>;
        acceptInvite(code: string, body: {
            acceptorId: string;
        }): Promise<PeerLink>;
        listLinks(): Promise<PeerLink[]>;
        removeLink(id: number): Promise<{
            removed: boolean;
        }>;
        setVisibility(id: number, body: {
            visibility: 'private' | 'public';
        }): Promise<{
            id: number;
            visibility: string;
        }>;
    };
    blog: {
        list(params?: {
            period?: BlogPeriod;
            page?: number;
            perPage?: number;
        }): Promise<BlogListResult>;
        get(slug: string): Promise<BlogPost>;
    };
    manager: {
        listReports(): Promise<DailyReportSummary[]>;
        getReport(day: 'latest' | string): Promise<DailyReport | null>;
        getResearchBrief(): Promise<ResearchBrief>;
        postFindings(day: string, body: FindingsInput): Promise<DailyReport>;
        listActions(params?: {
            status?: ActionStatus;
            limit?: number;
        }): Promise<AgentAction[]>;
        proposeAction(body: ActionInput & {
            reason: string;
            reportItemId?: number;
        }): Promise<AgentAction>;
        rejectAction(id: number): Promise<AgentAction>;
    };
    modules: {
        /**
         * Returns the public price-list for all modules.
         * No auth required — public endpoint.
         * GET /api/shop/modules/prices
         */
        listPrices(): Promise<ModulePriceList>;
        /**
         * Returns the modules currently active/pending for this shop.
         * Requires Bearer (haszno_…).
         * GET /api/shop/modules/my
         */
        listMy(): Promise<ShopModuleList>;
        /**
         * Start activation for a module. Billable modules return a checkoutUrl.
         * Requires Bearer + write scope + ownership (tulajdonos).
         * POST /api/shop/modules/:moduleId/activate
         */
        activate(moduleId: string): Promise<ModuleActivateResult>;
        /**
         * Cancel a currently-active module subscription.
         * Requires Bearer + write scope + ownership (tulajdonos).
         * POST /api/shop/modules/:moduleId/cancel
         */
        cancel(moduleId: string): Promise<{
            moduleId: string;
            status: string;
        }>;
        /**
         * Resume a cancelled-but-not-yet-ended subscription.
         * Requires Bearer + write scope + ownership (tulajdonos).
         * POST /api/shop/modules/:moduleId/resume
         */
        resume(moduleId: string): Promise<{
            moduleId: string;
            status: string;
        }>;
    };
}
declare function createClient(opts?: HttpOptions): HasznoClient;

/**
 * MCP tools — Modulok (workspace module subscriptions).
 *
 * Domain: modules
 * Tools:
 *   haszno_modules_list_prices   — public price-list (no auth required)
 *   haszno_modules_list_my       — authenticated: show active/pending modules for this shop
 *   haszno_modules_activate      — start activation (billable: returns checkout URL; free: activates immediately)
 *   haszno_modules_cancel        — cancel a currently-active module subscription
 *   haszno_modules_resume        — resume a cancelled-but-not-yet-ended subscription
 *
 * Auth model:
 *   list_prices  — public, no Bearer required
 *   list_my      — requires Bearer (haszno_… shop token)
 *   activate     — requires Bearer, requires write scope
 *   cancel       — requires Bearer, requires write scope, requires ownership (tulajdonos role)
 *   resume       — requires Bearer, requires write scope, requires ownership
 *
 * Note on billing:
 *   Activating a billable module (fitness, booking_salon, booking_clinic, booking_other) starts
 *   a SimplePay payment flow. The API returns { status, checkoutUrl } where the user must visit
 *   checkoutUrl to complete payment. Never report activation as "done" before payment succeeds.
 *   Free modules (webshop, dropshipping_supplier, restaurant) activate immediately — no checkout.
 */

declare function registerModulesTools(server: McpServer, client: HasznoClient): void;

/**
 * AsyncLocalStorage-based tool name context for the MCP server.
 *
 * Usage:
 *   1. Call patchForToolContext(server) once after new McpServer() and before
 *      any register*Tools() calls.
 *   2. http.ts reads currentToolName() to populate the X-Haszno-Tool header.
 *
 * Works for both the stdio binary (src/index.ts) and the hosted library entry
 * (src/lib.ts) because the patch happens at the McpServer instance level.
 */

interface ServerWithRegisterTool {
    registerTool(name: string, schema: any, handler: (...args: any[]) => any, ...rest: any[]): unknown;
}
/**
 * Patches server.registerTool so every registered handler runs inside
 * toolNameStorage.run(toolName, handler), making the tool name available
 * anywhere down the async call chain (including http.ts).
 *
 * Call once right after `new McpServer(...)`, before registering any tools.
 * Safe to call multiple times — the patch is idempotent because it checks
 * for the __toolContextPatched marker.
 */
declare function patchForToolContext(server: ServerWithRegisterTool): void;

export { type HasznoClient, type HttpOptions, createClient, patchForToolContext, registerJobTools, registerModulesTools, registerShopTools };
