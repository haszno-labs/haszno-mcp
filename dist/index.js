#!/usr/bin/env node

// src/index.ts
import * as fs3 from "fs";
import * as os2 from "os";
import * as path2 from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// src/client/error.ts
var HasznoApiError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = "HasznoApiError";
  }
  status;
};

// src/client/http.ts
var SHOP_TOKEN_PREFIX = "haszno_";
function isShopToken(key) {
  return !!key?.startsWith(SHOP_TOKEN_PREFIX);
}
function buildAuthHeader(opts) {
  const key = opts.apiKey ?? process.env["HASZNO_API_TOKEN"] ?? process.env["HASZNO_API_KEY"] ?? process.env["ARFUTAR_API_KEY"];
  if (key) {
    if (isShopToken(key)) return { Authorization: `Bearer ${key}` };
    return { "x-api-key": key };
  }
  const basic = opts.basicAuth ?? process.env["HASZNO_BASIC"] ?? process.env["ARFUTAR_BASIC"];
  if (basic) {
    const encoded = Buffer.from(basic).toString("base64");
    return { Authorization: `Basic ${encoded}` };
  }
  return {};
}
async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function request(method, path3, body, opts) {
  const baseUrl = (opts.baseUrl ?? process.env["HASZNO_API_URL"] ?? process.env["ARFUTAR_API_URL"] ?? "https://haszno.com").replace(/\/$/, "");
  const url = `${baseUrl}${path3}`;
  const fetchFn = opts.fetch ?? fetch;
  const maxRetries = opts.maxRetries ?? 3;
  const retryDelayMs = opts.retryDelayMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 3e4;
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "haszno-mcp/0.1.0",
    ...buildAuthHeader(opts)
  };
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs * Math.pow(2, attempt - 1));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchFn(url, {
        method,
        headers,
        body: body !== void 0 ? JSON.stringify(body) : void 0,
        signal: controller.signal
      });
    } catch (err2) {
      lastError = err2;
      continue;
    } finally {
      clearTimeout(timer);
    }
    if ((response.status === 429 || response.status >= 500) && attempt < maxRetries - 1) {
      lastError = new HasznoApiError(response.status, `HTTP ${response.status}`);
      continue;
    }
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const json3 = await response.json();
        if (json3.error) message = json3.error;
      } catch {
      }
      throw new HasznoApiError(response.status, message);
    }
    const text = await response.text();
    if (!text) return void 0;
    return JSON.parse(text);
  }
  if (lastError instanceof HasznoApiError) throw lastError;
  throw new Error(`Network error after ${maxRetries} attempts: ${String(lastError)}`);
}
function get(path3, opts) {
  return request("GET", path3, void 0, opts);
}
function post(path3, body, opts) {
  return request("POST", path3, body, opts);
}
function put(path3, body, opts) {
  return request("PUT", path3, body, opts);
}
function patch(path3, body, opts) {
  return request("PATCH", path3, body, opts);
}
function del(path3, opts) {
  return request("DELETE", path3, void 0, opts);
}

// src/client/index.ts
var ShopTokenNotSupportedError = class extends Error {
  isShopTokenNotSupported = true;
  operation;
  constructor(operation) {
    super(
      `"${operation}" nem \xE9rhet\u0151 el bolt API-tokennel \u2014 haszn\xE1lja a Haszno webalkalmaz\xE1st (https://haszno.com). Az \xFCgyn\xF6k-token csak olvas\xE1si (GET /api/agent/*) \xE9s javaslat-bek\xFCld\xE9si (POST /api/agent/proposals) m\u0171veletekre jogosult.`
    );
    this.name = "ShopTokenNotSupportedError";
    this.operation = operation;
  }
};
function detectShopToken(opts) {
  const key = opts.apiKey ?? process.env["HASZNO_API_TOKEN"] ?? process.env["HASZNO_API_KEY"] ?? process.env["ARFUTAR_API_KEY"];
  return isShopToken(key) ? key : void 0;
}
function notSupported(op) {
  return (..._args) => {
    return Promise.reject(new ShopTokenNotSupportedError(op));
  };
}
function createClient(opts = {}) {
  const shopToken = detectShopToken(opts);
  if (shopToken) {
    return createShopTokenClient({ ...opts, apiKey: shopToken });
  }
  return createLegacyClient(opts);
}
function createShopTokenClient(opts) {
  const o = opts;
  return {
    health: {
      check: () => get("/api/health", o)
    },
    // settings.get is not on the agent API — blocked
    settings: {
      get: notSupported("settings.get"),
      update: notSupported("settings.update")
    },
    // /api/agent/products — shop-scoped, no purchase cost
    products: {
      list: (_params) => get("/api/agent/products", o),
      update: notSupported("products.update"),
      setListing: notSupported("products.setListing"),
      generateAiDescription: notSupported("products.generateAiDescription"),
      applyPrices: notSupported("products.applyPrices")
    },
    stats: {
      get: notSupported("stats.get"),
      getImpact: notSupported("stats.getImpact")
    },
    suppliers: {
      list: notSupported("suppliers.list")
    },
    feeds: {
      importFeed: notSupported("feeds.importFeed"),
      importMarketPrices: notSupported("feeds.importMarketPrices")
    },
    // /api/agent/orders — last 20 orders, shop-scoped
    orders: {
      list: () => get("/api/agent/orders", o),
      receiveOrder: notSupported("orders.receiveOrder"),
      ship: notSupported("orders.ship"),
      createDemo: notSupported("orders.createDemo")
    },
    recommendations: {
      get: notSupported("recommendations.get"),
      getAiShortlist: notSupported("recommendations.getAiShortlist"),
      fillTrendKeywords: notSupported("recommendations.fillTrendKeywords")
    },
    rules: {
      listTemplates: notSupported("rules.listTemplates"),
      list: notSupported("rules.list"),
      create: notSupported("rules.create"),
      update: notSupported("rules.update"),
      delete: notSupported("rules.delete"),
      run: notSupported("rules.run"),
      runAll: notSupported("rules.runAll"),
      trigger: notSupported("rules.trigger"),
      listRuns: notSupported("rules.listRuns"),
      undoUnlists: notSupported("rules.undoUnlists")
    },
    proposals: {
      // /api/agent/proposals — returns pending proposals for this shop
      list: (_params) => get("/api/agent/proposals", o),
      // approve/reject/rollback are human-only — blocked for agent tokens
      approve: notSupported("proposals.approve"),
      reject: notSupported("proposals.reject"),
      rollback: notSupported("proposals.rollback"),
      // POST /api/agent/proposals — submit a price-change proposal for human review
      propose: (body) => post("/api/agent/proposals", body, o)
    },
    automation: {
      get: notSupported("automation.get"),
      set: notSupported("automation.set")
    },
    network: {
      listSuppliers: notSupported("network.listSuppliers"),
      getSupplierProducts: notSupported("network.getSupplierProducts"),
      connect: notSupported("network.connect"),
      disconnect: notSupported("network.disconnect"),
      sync: notSupported("network.sync"),
      getSupplierView: notSupported("network.getSupplierView")
    },
    catalogue: {
      search: notSupported("catalogue.search")
    },
    importList: {
      list: notSupported("importList.list"),
      add: notSupported("importList.add"),
      push: notSupported("importList.push")
    },
    connections: {
      list: notSupported("connections.list"),
      get: notSupported("connections.get")
    },
    peers: {
      createInvite: notSupported("peers.createInvite"),
      listInvites: notSupported("peers.listInvites"),
      revokeInvite: notSupported("peers.revokeInvite"),
      acceptInvite: notSupported("peers.acceptInvite"),
      listLinks: notSupported("peers.listLinks"),
      removeLink: notSupported("peers.removeLink"),
      setVisibility: notSupported("peers.setVisibility")
    },
    blog: {
      list: notSupported("blog.list"),
      get: notSupported("blog.get")
    }
  };
}
function createLegacyClient(opts) {
  const o = opts;
  return {
    health: {
      check: () => get("/api/health", o)
    },
    settings: {
      get: () => get("/api/settings", o),
      update: (body) => put("/api/settings", body, o)
    },
    products: {
      list: (params) => {
        const qs = params?.all ? "?all=1" : "";
        return get(`/api/products${qs}`, o);
      },
      update: (id, body) => patch(`/api/products/${id}`, body, o),
      setListing: (id, body) => post(`/api/products/${id}/listing`, body, o),
      generateAiDescription: (id) => post(`/api/products/${id}/ai-description`, null, o),
      applyPrices: (body) => post("/api/products/apply-prices", body ?? {}, o)
    },
    stats: {
      get: () => get("/api/stats", o),
      getImpact: (params) => {
        const qs = params?.days != null ? `?days=${params.days}` : "";
        return get(`/api/impact${qs}`, o);
      }
    },
    suppliers: {
      list: () => get("/api/suppliers", o)
    },
    feeds: {
      importFeed: (body) => post("/api/feeds/import", body, o),
      importMarketPrices: (body) => post("/api/market-prices/import", body, o)
    },
    orders: {
      list: () => get("/api/orders", o),
      receiveOrder: (body) => post("/api/webhooks/order", body, o),
      ship: (id) => post(`/api/orders/${id}/ship`, null, o),
      createDemo: () => post("/api/demo/order", null, o)
    },
    recommendations: {
      get: () => get("/api/recommendations", o),
      getAiShortlist: () => post("/api/recommendations/ai", null, o),
      fillTrendKeywords: () => post("/api/trends/keywords", null, o)
    },
    rules: {
      listTemplates: () => get("/api/rules/templates", o),
      list: () => get("/api/rules", o),
      create: (body) => post("/api/rules", body, o),
      update: (id, body) => patch(`/api/rules/${id}`, body, o),
      delete: (id) => del(`/api/rules/${id}`, o),
      run: (id) => post(`/api/rules/${id}/run`, null, o),
      runAll: () => post("/api/rules/run-all", null, o),
      trigger: (body) => post("/api/rules/trigger", body, o),
      listRuns: (params) => {
        const qs = params?.limit != null ? `?limit=${params.limit}` : "";
        return get(`/api/rule-runs${qs}`, o);
      },
      undoUnlists: (body) => post("/api/rule-runs/undo", body, o)
    },
    proposals: {
      list: (params) => {
        const qs = params?.status ? `?status=${params.status}` : "";
        return get(`/api/proposals${qs}`, o);
      },
      approve: (body) => post("/api/proposals/approve", body ?? {}, o),
      reject: (body) => post("/api/proposals/reject", body, o),
      rollback: (body) => post("/api/proposals/rollback", body, o),
      // Legacy mode: no agent propose endpoint; not applicable outside shop-token mode
      propose: notSupported("proposals.propose (requires a shop API token)")
    },
    automation: {
      get: () => get("/api/automation", o),
      set: (body) => put("/api/automation", body, o)
    },
    network: {
      listSuppliers: () => get("/api/network/suppliers", o),
      getSupplierProducts: (id) => get(`/api/network/suppliers/${id}/products`, o),
      connect: (id) => post(`/api/network/suppliers/${id}/connect`, null, o),
      disconnect: (id) => post(`/api/network/suppliers/${id}/disconnect`, null, o),
      sync: (id) => post(`/api/network/suppliers/${id}/sync`, null, o),
      getSupplierView: (supplierId) => get(`/api/network/supplier-view/${supplierId}`, o)
    },
    catalogue: {
      search: (params) => {
        const qs = new URLSearchParams();
        if (params.q) qs.set("q", params.q);
        if (params.cats) qs.set("cats", params.cats);
        if (params.partner != null) qs.set("partner", String(params.partner));
        if (params.minMarginPct != null) qs.set("minMarginPct", String(params.minMarginPct));
        if (params.maxPrice != null) qs.set("maxPrice", String(params.maxPrice));
        if (params.minPrice != null) qs.set("minPrice", String(params.minPrice));
        if (params.inStock) qs.set("inStock", "1");
        if (params.hasImage) qs.set("hasImage", "1");
        if (params.country) qs.set("country", params.country);
        if (params.sort) qs.set("sort", params.sort);
        if (params.page != null) qs.set("page", String(params.page));
        if (params.pageSize != null) qs.set("pageSize", String(params.pageSize));
        const suffix = qs.toString() ? `?${qs.toString()}` : "";
        return get(`/api/catalogue/products${suffix}`, o);
      }
    },
    importList: {
      list: (params) => {
        const qs = new URLSearchParams();
        if (params?.status) qs.set("status", params.status);
        if (params?.partner != null) qs.set("partner", String(params.partner));
        if (params?.q) qs.set("q", params.q);
        const suffix = qs.toString() ? `?${qs.toString()}` : "";
        return get(`/api/import-list${suffix}`, o);
      },
      add: (body) => post("/api/import-list", body, o),
      // Routes to the correct endpoint depending on whether a target connection is given.
      push: ((body) => {
        if (body.targetConnectionId != null) {
          return post(
            `/api/connect/stores/${body.targetConnectionId}/push`,
            { importListIds: body.ids },
            o
          );
        }
        return post("/api/import-list/push", { ids: body.ids }, o);
      })
    },
    connections: {
      list: () => get("/api/connect/stores", o),
      get: (id) => get(`/api/connect/stores/${id}`, o)
    },
    peers: {
      createInvite: (body) => post("/api/peers/invites", body, o),
      listInvites: () => get("/api/peers/invites", o),
      revokeInvite: (code) => del(`/api/peers/invites/${code}`, o),
      acceptInvite: (code, body) => post(`/api/peers/invites/${code}/accept`, body, o),
      listLinks: () => get("/api/peers/links", o),
      removeLink: (id) => del(`/api/peers/links/${id}`, o),
      setVisibility: (id, body) => put(`/api/peers/suppliers/${id}/visibility`, body, o)
    },
    blog: {
      list: (params) => {
        const qs = new URLSearchParams();
        if (params?.period) qs.set("period", params.period);
        if (params?.page != null) qs.set("page", String(params.page));
        if (params?.perPage != null) qs.set("perPage", String(params.perPage));
        const suffix = qs.toString() ? `?${qs.toString()}` : "";
        return get(`/api/blog${suffix}`, o);
      },
      get: (slug) => get(`/api/blog/${slug}`, o)
    }
  };
}

// src/tools/catalog.ts
import { z } from "zod";
var DEFAULT_LIMIT = 25;
function paginate(items, page, limit) {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(Math.max(1, page), pages);
  const start = (safePage - 1) * limit;
  return { items: items.slice(start, start + limit), total, page: safePage, pages };
}
function registerCatalogTools(server, client) {
  server.registerTool(
    "haszno_catalog_list_categories",
    {
      title: "List partner categories",
      description: "Returns the list of distinct product categories available in the Haszno partner network. Call this first to discover valid values for the `category` filter used by `haszno_catalog_list_suppliers` and `haszno_catalog_supplier_products`. Returns: { categories: string[] } sorted alphabetically.",
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async () => {
      const suppliers = await client.network.listSuppliers();
      const cats = Array.from(
        new Set(suppliers.map((s) => s.category).filter((c) => c != null))
      ).sort();
      return { content: [{ type: "text", text: JSON.stringify({ categories: cats }) }] };
    }
  );
  server.registerTool(
    "haszno_catalog_list_suppliers",
    {
      title: "List partner suppliers",
      description: `Lists dropshipping suppliers available in the Haszno partner network. Each row: id, name, category, country, connected (bool \u2014 already imported into this shop), productCount, avgResellerMarginPct (% average margin other resellers achieve; null if unknown), shopUrl (supplier website). Filter by category (exact, case-insensitive) or search by name substring. Set connected=true to show only suppliers the shop already pulls products from. Money: avgResellerMarginPct is a percentage, e.g. 18.5 means 18.5 %. Pagination: default ${DEFAULT_LIMIT} per page. Use haszno_catalog_list_categories to find valid category values.`,
      inputSchema: {
        category: z.string().optional().describe("Filter by category (case-insensitive exact match)"),
        search: z.string().optional().describe("Substring search on supplier name (case-insensitive)"),
        connected: z.boolean().optional().describe("true = only suppliers the shop already imports from"),
        page: z.number().int().min(1).optional().describe("Page number, 1-based (default 1)"),
        limit: z.number().int().min(1).max(100).optional().describe(`Items per page, max 100 (default ${DEFAULT_LIMIT})`)
      },
      annotations: { readOnlyHint: true }
    },
    async (args) => {
      let suppliers = await client.network.listSuppliers();
      if (args.category != null) {
        const cat = args.category.toLowerCase();
        suppliers = suppliers.filter((s) => s.category?.toLowerCase() === cat);
      }
      if (args.search != null) {
        const q = args.search.toLowerCase();
        suppliers = suppliers.filter((s) => s.name.toLowerCase().includes(q));
      }
      if (args.connected === true) {
        suppliers = suppliers.filter((s) => s.connected);
      }
      const { items, total, page, pages } = paginate(
        suppliers,
        args.page ?? 1,
        args.limit ?? DEFAULT_LIMIT
      );
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            suppliers: items.map((s) => ({
              id: s.id,
              name: s.name,
              category: s.category,
              country: s.country,
              connected: s.connected,
              productCount: s.productCount,
              avgResellerMarginPct: s.avgResellerMarginPct,
              shopUrl: s.shopUrl
            })),
            total,
            page,
            pages
          })
        }]
      };
    }
  );
  server.registerTool(
    "haszno_catalog_supplier_products",
    {
      title: "Browse supplier catalogue",
      description: `Returns products from a partner supplier's catalogue. Each product: id, sku, name, ean, category, wholesaleNet (VAT-exclusive net cost in HUF), rrpGross (supplier recommended retail price, VAT-inclusive HUF, may be null), stock (units in supplier warehouse), potentialMargin.priceGross / .marginNet / .marginPct (projected selling price and margin at the shop's current pricing rules \u2014 gross HUF and % respectively). Filter by name/SKU substring (search) or product category. Paginated \u2014 default ${DEFAULT_LIMIT} per page. Money note: wholesaleNet is net (VAT-excluded); rrpGross and potentialMargin.priceGross are gross (VAT-included).`,
      inputSchema: {
        supplier_id: z.number().int().describe("Supplier ID (from haszno_catalog_list_suppliers)"),
        search: z.string().optional().describe("Substring search on product name or SKU (case-insensitive)"),
        category: z.string().optional().describe("Filter by product category (case-insensitive)"),
        page: z.number().int().min(1).optional().describe("Page number, 1-based (default 1)"),
        limit: z.number().int().min(1).max(100).optional().describe(`Items per page, max 100 (default ${DEFAULT_LIMIT})`)
      },
      annotations: { readOnlyHint: true }
    },
    async (args) => {
      let products = await client.network.getSupplierProducts(args.supplier_id);
      if (args.search != null) {
        const q = args.search.toLowerCase();
        products = products.filter(
          (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
        );
      }
      if (args.category != null) {
        const cat = args.category.toLowerCase();
        products = products.filter((p) => p.category?.toLowerCase() === cat);
      }
      const { items, total, page, pages } = paginate(
        products,
        args.page ?? 1,
        args.limit ?? DEFAULT_LIMIT
      );
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            products: items.map((p) => ({
              id: p.id,
              sku: p.sku,
              name: p.name,
              ean: p.ean,
              category: p.category,
              wholesaleNet: p.wholesaleNet,
              rrpGross: p.rrpGross,
              stock: p.stock,
              potentialMargin: p.potentialMargin
            })),
            total,
            page,
            pages
          })
        }]
      };
    }
  );
  server.registerTool(
    "haszno_catalog_supplier_view",
    {
      title: "Supplier market view",
      description: "Returns a full market overview for a partner supplier: supplier metadata and, for every product in their catalogue, aggregated reseller-market statistics. Per-product stats: resellerCount (how many shops carry it), minGross / avgGross / maxGross (market price range, VAT-inclusive HUF, null if no data), belowRrp (resellers priced under supplier RRP), lossCount (resellers selling at a loss), saturation (0\u2013100 market saturation score \u2014 higher = more competition). Use this to evaluate a supplier before connecting. Money: *Gross prices are HUF VAT-inclusive; wholesaleNet is HUF VAT-exclusive.",
      inputSchema: {
        supplier_id: z.number().int().describe("Supplier ID (from haszno_catalog_list_suppliers)")
      },
      annotations: { readOnlyHint: true }
    },
    async (args) => {
      const view = await client.network.getSupplierView(args.supplier_id);
      return { content: [{ type: "text", text: JSON.stringify(view) }] };
    }
  );
  server.registerTool(
    "haszno_catalog_connect_supplier",
    {
      title: "Connect partner supplier",
      description: "Connects a partner supplier to the shop, importing all their products into the shop's product database. After a successful connect the supplier's products appear in the products domain and can be priced and published. Returns: { status: string, imported: number, skipped: number }. WRITE OPERATION \u2014 set confirm: true explicitly to execute; confirm: false returns a preview only and makes no changes. Recommended workflow: (1) call haszno_catalog_supplier_view to evaluate the supplier, (2) call this tool with confirm: true once satisfied.",
      inputSchema: {
        supplier_id: z.number().int().describe("Supplier ID to connect"),
        confirm: z.boolean().describe("Must be true to execute. false \u2192 dry-run preview, no changes.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async (args) => {
      if (!args.confirm) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              preview: true,
              supplier_id: args.supplier_id,
              message: "Set confirm: true to actually connect this supplier and import their products."
            })
          }]
        };
      }
      const result = await client.network.connect(args.supplier_id);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );
  server.registerTool(
    "haszno_catalog_sync_supplier",
    {
      title: "Sync supplier products",
      description: "Synchronises prices and stock from a connected partner supplier. Returns: { costChanges: number, stockOuts: number, total: number }. costChanges = products whose wholesale price changed; stockOuts = products that went out of stock; total = products evaluated. Run this after a supplier announces a feed update or on a nightly schedule. WRITE OPERATION \u2014 set confirm: true explicitly to execute; confirm: false returns a preview only and makes no changes.",
      inputSchema: {
        supplier_id: z.number().int().describe("Supplier ID of a connected supplier"),
        confirm: z.boolean().describe("Must be true to execute. false \u2192 dry-run preview, no changes.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async (args) => {
      if (!args.confirm) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              preview: true,
              supplier_id: args.supplier_id,
              message: "Set confirm: true to actually sync this supplier."
            })
          }]
        };
      }
      const result = await client.network.sync(args.supplier_id);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );
}

// src/tools/products.ts
function registerProductsTools(_server, _client) {
}

// src/tools/proposals.ts
import { randomUUID } from "crypto";
import { z as z2 } from "zod";
function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function err(msg) {
  return { isError: true, content: [{ type: "text", text: msg }] };
}
function requireConfirm(confirm) {
  if (!confirm) {
    return err(
      "Safety gate: this tool modifies data. Re-call with confirm: true to proceed. Read the tool description and verify the input before confirming."
    );
  }
  return null;
}
function handleApiError(e, action) {
  if (e instanceof ShopTokenNotSupportedError) {
    return err(e.message);
  }
  if (e instanceof HasznoApiError) {
    return err(`API error during ${action}: ${e.message} (status ${e.status})`);
  }
  return err(`Unexpected error during ${action}: ${String(e)}`);
}
function registerProposalsTools(server, client) {
  server.tool(
    "haszno_proposals_list",
    `List price-change proposals generated by Haszno rules.

A "proposal" is a recommended price change that the shop owner must review
before it takes effect.  Each proposal has:
  \u2022 oldPriceGross / proposedPriceGross \u2014 current and suggested prices (HUF gross)
  \u2022 reason \u2014 why the change was suggested (e.g. "market undercut detected")
  \u2022 source \u2014 which rule or trigger created it
  \u2022 status \u2014 pending | approved | rejected | rolled_back
  \u2022 batchId \u2014 groups proposals applied together (use for rollback)

Use this tool to review pending proposals before calling approve/reject,
or to audit previously approved/rejected ones.

Returns up to \`limit\` proposals (default 25, max 100) starting at \`offset\`.
Includes a \`_meta\` field with total count hint and pagination cursor.`,
    {
      status: z2.enum(["pending", "approved", "rejected", "rolled_back"]).optional().describe(
        'Filter by status. Omit to return all statuses. "pending" is the most useful \u2014 these need a decision.'
      ),
      productId: z2.number().int().positive().optional().describe("Narrow to a single product ID."),
      limit: z2.number().int().min(1).max(100).default(25).describe("Maximum number of proposals to return (1\u2013100, default 25)."),
      offset: z2.number().int().min(0).default(0).describe("Skip this many proposals (for pagination). Default 0.")
    },
    { readOnlyHint: true },
    async (args) => {
      try {
        const all = await client.proposals.list(
          args.status ? { status: args.status } : void 0
        );
        const filtered = args.productId != null ? all.filter((p) => p.productId === args.productId) : all;
        const page = filtered.slice(args.offset, args.offset + args.limit);
        return ok({
          _meta: {
            total: filtered.length,
            offset: args.offset,
            limit: args.limit,
            hasMore: args.offset + args.limit < filtered.length
          },
          proposals: page.map((p) => ({
            id: p.id,
            productId: p.productId,
            productName: p.productName,
            productSku: p.productSku,
            oldPriceGross: p.oldPriceGross,
            proposedPriceGross: p.proposedPriceGross,
            diffGross: p.proposedPriceGross - p.oldPriceGross,
            reason: p.reason,
            source: p.source,
            status: p.status,
            batchId: p.batchId,
            createdAt: p.createdAt,
            decidedAt: p.decidedAt
          }))
        });
      } catch (e) {
        return handleApiError(e, "haszno_proposals_list");
      }
    }
  );
  server.tool(
    "haszno_proposals_market",
    `Show pending proposals for a product together with the product's market context.

Use this before approving or rejecting to understand whether the proposed
price makes sense given the current market situation.

Returns:
  \u2022 product \u2014 name, SKU, costNet (HUF net), current price/margin, AI-recommended
    price/margin, cheapest market competitor (marketMinGross, marketShop)
  \u2022 pendingProposals \u2014 proposals with status "pending" for this product, ordered
    by creation time (newest first)

All prices are in HUF.  "gross" = VAT-inclusive, "net" = VAT-exclusive.
Margin percentages are calculated on the net sale price after VAT.`,
    {
      productId: z2.number().int().positive().describe("The product ID to inspect. Obtain from haszno_proposals_list.")
    },
    { readOnlyHint: true },
    async (args) => {
      try {
        const [products, proposals] = await Promise.all([
          client.products.list(),
          client.proposals.list({ status: "pending" })
        ]);
        const product = products.find((p) => p.id === args.productId);
        if (!product) {
          return err(
            `Product ${args.productId} not found. Use haszno_proposals_list to see valid product IDs.`
          );
        }
        const pending = proposals.filter((p) => p.productId === args.productId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return ok({
          product: {
            id: product.id,
            sku: product.sku,
            name: product.name,
            supplierName: product.supplierName,
            costNet: product.costNet,
            stock: product.stock,
            listed: product.listed,
            current: {
              priceGross: product.priceGross,
              marginNet: product.current.marginNet,
              marginPct: product.current.marginPct
            },
            recommended: {
              priceGross: product.recommended.priceGross,
              marginNet: product.recommended.marginNet,
              marginPct: product.recommended.marginPct
            },
            market: {
              minGross: product.marketMinGross,
              shop: product.marketShop
            },
            rrpGross: product.rrpGross
          },
          pendingProposals: pending.map((p) => ({
            id: p.id,
            oldPriceGross: p.oldPriceGross,
            proposedPriceGross: p.proposedPriceGross,
            diffGross: p.proposedPriceGross - p.oldPriceGross,
            reason: p.reason,
            source: p.source,
            batchId: p.batchId,
            createdAt: p.createdAt
          }))
        });
      } catch (e) {
        return handleApiError(e, "haszno_proposals_market");
      }
    }
  );
  server.tool(
    "haszno_proposals_approve",
    `Approve price-change proposals and apply them immediately to the shop.

**WRITE operation \u2014 requires confirm: true.**

If \`ids\` is provided: approve only those proposal IDs.
If \`ids\` is omitted: approve ALL pending proposals (batch-approve).

On success returns:
  \u2022 batchId \u2014 ID of the approval batch (save this \u2014 you can roll it back with
    haszno_proposals_rollback if the prices turn out to be wrong)
  \u2022 applied \u2014 number of proposals actually applied

Workflow:
  1. Call haszno_proposals_list with status:"pending" to see what is pending.
  2. Optionally call haszno_proposals_market per product to check context.
  3. Call this tool with the IDs you want to approve (or no IDs for all).
  4. Save the returned batchId in case you need to roll back.`,
    {
      ids: z2.array(z2.number().int().positive()).optional().describe(
        "Proposal IDs to approve. Omit to approve all pending proposals (use with care)."
      ),
      confirm: z2.boolean().describe("Must be true to proceed. Safety gate \u2014 prevents accidental writes.")
    },
    { destructiveHint: false, idempotentHint: false },
    async (args) => {
      const gate = requireConfirm(args.confirm);
      if (gate) return gate;
      try {
        const result = await client.proposals.approve(
          args.ids ? { ids: args.ids } : void 0
        );
        return ok({
          batchId: result.batchId,
          applied: result.applied,
          note: result.batchId ? `Prices updated. Use batchId "${result.batchId}" with haszno_proposals_rollback to undo.` : "No proposals were applied (none were pending)."
        });
      } catch (e) {
        return handleApiError(e, "haszno_proposals_approve");
      }
    }
  );
  server.tool(
    "haszno_proposals_reject",
    `Reject price-change proposals so they will not be applied.

**WRITE operation \u2014 requires confirm: true.**

Rejected proposals are kept in history (status becomes "rejected") so you can
audit why a proposal was not applied.  Rejecting does NOT change any prices.

Provide the \`ids\` of the proposals to reject.  Use haszno_proposals_list
with status:"pending" to get the IDs.

Returns:
  \u2022 rejected \u2014 number of proposals marked as rejected`,
    {
      ids: z2.array(z2.number().int().positive()).min(1).describe("IDs of the proposals to reject. At least one is required."),
      confirm: z2.boolean().describe("Must be true to proceed. Safety gate \u2014 prevents accidental writes.")
    },
    { destructiveHint: false, idempotentHint: true },
    async (args) => {
      const gate = requireConfirm(args.confirm);
      if (gate) return gate;
      try {
        const result = await client.proposals.reject({ ids: args.ids });
        return ok({
          rejected: result.rejected,
          note: `${result.rejected} proposal(s) marked as rejected. No prices were changed.`
        });
      } catch (e) {
        return handleApiError(e, "haszno_proposals_reject");
      }
    }
  );
  server.tool(
    "haszno_proposals_propose",
    `Submit a price-change proposal for human review (shop API token only).

**Requires a shop API token** (starts with "haszno_") sent as Bearer.

Creates a PENDING proposal for the given product. The price is NEVER applied
automatically \u2014 a human must approve it via the Haszno web app.

Constraints:
  \u2022 proposedPriceGross must be \u2265 the minimum-profit price floor (cost \xD7 (1+VAT)
    / (1\u2212minMarginPct)). The server enforces this \u2014 a price below floor returns 422.
  \u2022 reason must be 1\u2013500 characters of plain text. It is stored verbatim and
    shown to the shop owner \u2014 write clearly why the price change makes sense.
  \u2022 A nonce is generated automatically and reused on transport retries to prevent
    duplicate proposals. Do not call this tool twice for the same change.

Returns on success:
  \u2022 id \u2014 the new proposal's ID
  \u2022 status \u2014 always "pending"
  \u2022 createdAt \u2014 ISO timestamp

Error codes:
  \u2022 401 \u2014 token invalid, expired, or revoked
  \u2022 403 \u2014 token scope is "read"; needs "write"
  \u2022 404 \u2014 product ID not found (or not in this shop)
  \u2022 409 \u2014 duplicate nonce (previous submission succeeded)
  \u2022 422 \u2014 proposed price is below the minimum-profit floor`,
    {
      productId: z2.number().int().positive().describe("ID of the product to propose a price change for."),
      proposedPriceGross: z2.number().int().positive().describe(
        "Proposed gross price in HUF (whole forints, VAT-inclusive). Must be \u2265 the price floor enforced by the server."
      ),
      reason: z2.string().min(1).max(500).describe(
        'Plain-text explanation for the shop owner (1\u2013500 characters). Example: "Piaci minimum 9 100 Ft; 1%-os al\xE1l\xF6v\xE9ssel versenyk\xE9pes".'
      )
    },
    { destructiveHint: false, idempotentHint: false },
    async (args) => {
      const nonce = randomUUID();
      try {
        const result = await client.proposals.propose({
          productId: args.productId,
          proposedPriceGross: args.proposedPriceGross,
          reason: args.reason,
          nonce
        });
        return ok({
          id: result.id,
          status: result.status,
          createdAt: result.createdAt,
          note: `Javaslat bek\xFCldve (ID: ${result.id}). Az \xE1r nem v\xE1ltozott \u2014 a bolt tulajdonos\xE1nak j\xF3v\xE1 kell hagynia a Haszno webalkalmaz\xE1sban.`
        });
      } catch (e) {
        return handleApiError(e, "haszno_proposals_propose");
      }
    }
  );
  server.tool(
    "haszno_proposals_rollback",
    `Roll back all price changes from a previously approved batch.

**WRITE operation \u2014 requires confirm: true.**
**DESTRUCTIVE: restores prices to their pre-approval values.**

Use this when an approval batch produced incorrect prices and you want to
undo the whole batch atomically.  You need the \`batchId\` returned by
haszno_proposals_approve.

Returns:
  \u2022 rolledBack \u2014 number of products whose prices were restored

After rollback the proposals' status changes to "rolled_back".  The products
return to the prices they had immediately before the batch was approved.`,
    {
      batchId: z2.string().min(1).describe(
        'The batchId returned by haszno_proposals_approve. Example: "b-1234abcd". Use haszno_proposals_list to find the batchId of approved proposals.'
      ),
      confirm: z2.boolean().describe("Must be true to proceed. Safety gate \u2014 prevents accidental writes.")
    },
    { destructiveHint: true, idempotentHint: true },
    async (args) => {
      const gate = requireConfirm(args.confirm);
      if (gate) return gate;
      try {
        const result = await client.proposals.rollback({ batchId: args.batchId });
        return ok({
          rolledBack: result.rolledBack,
          note: `${result.rolledBack} product price(s) restored from batch "${args.batchId}".`
        });
      } catch (e) {
        return handleApiError(e, "haszno_proposals_rollback");
      }
    }
  );
}

// src/tools/rules.ts
import { z as z3 } from "zod";
function ok2(data) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}
async function wrap(fn) {
  try {
    return ok2(await fn());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
  }
}
var conditionSchema = z3.object({
  field: z3.string().describe(
    'Product field to test. Known values: "stock", "marginPct", "recommendedChange", "priceGross".'
  ),
  op: z3.enum(["lt", "lte", "gt", "gte", "eq", "neq", "changed"]).describe(
    "Comparison operator: lt/lte/gt/gte compare numbers; eq/neq compare equality; changed detects any change."
  ),
  value: z3.union([z3.number(), z3.string(), z3.null()]).optional().describe(
    'Threshold value. Omit or null for the "changed" operator.'
  )
});
var actionSchema = z3.object({
  type: z3.string().describe(
    'Action type. Known values: "unlist" (remove from shop), "propose_price" (create price proposal), "notify" (log a warning).'
  ),
  params: z3.record(z3.string(), z3.unknown()).optional().describe(
    "Action-specific parameters. For propose_price: {strategy, maxChangePct, tiers?}. For notify: {text}."
  )
});
function registerRulesTools(server, client) {
  server.registerTool(
    "haszno_rules_list_templates",
    {
      description: `List the built-in pricing-rule templates available for instantiation. Returns each template's key, human-readable name, description, trigger event, preconfigured conditions, and actions. Call this before creating a rule to discover available starting points: "keszlet_or" (stock-out protection), "arjavaslat" (auto price-proposal on market update), "felar_savok" (AutoDS-style markup tiers), "veszteseg_riasztas" (loss-alert + floor price). Read-only \u2014 always safe to call.`,
      annotations: { readOnlyHint: true }
    },
    () => wrap(() => client.rules.listTemplates())
  );
  server.registerTool(
    "haszno_rules_list",
    {
      description: "List all automation rules configured for this shop. Returns each rule's id, name, enabled flag, trigger event, conditions, actions, template key (if created from one), and creation date. Use to audit active automations, find a rule id before running or updating it, or check whether automation is configured at all. Read-only \u2014 always safe to call.",
      annotations: { readOnlyHint: true }
    },
    () => wrap(() => client.rules.list())
  );
  server.registerTool(
    "haszno_rules_list_runs",
    {
      description: 'Fetch the rule-execution log. Returns entries ordered newest-first, each with: run id, rule id, rule name, trigger event, affected product id (or null for bulk runs), human-readable outcome summary, and ISO timestamp. Default limit is 25; pass limit (1\u2013200) to get more. Use to audit what automation has done, find products that were automatically unlisted, or collect run-log IDs before calling haszno_rules_undo_unlists. Entries where summary starts with "Lev\xE9ve" are unlist actions that can be undone. Read-only \u2014 always safe to call.',
      inputSchema: {
        limit: z3.number().int().min(1).max(200).optional().describe("Max entries to return (1\u2013200). Default 25.")
      },
      annotations: { readOnlyHint: true }
    },
    ({ limit }) => wrap(() => client.rules.listRuns({ limit: limit ?? 25 }))
  );
  server.registerTool(
    "haszno_automation_get",
    {
      description: "Check the global automation kill switch. Returns {paused: boolean}. When paused=true, the server blocks proposal-approve requests (returns HTTP 409). Always call this before attempting to approve proposals if the last attempt returned a 409 error, or before running automations if behaviour seems blocked. Read-only \u2014 always safe to call.",
      annotations: { readOnlyHint: true }
    },
    () => wrap(() => client.automation.get())
  );
  server.registerTool(
    "haszno_rules_create",
    {
      description: 'Create a new automation rule. Pass template="keszlet_or" (or another key from haszno_rules_list_templates) to prefill trigger/conditions/actions from that template \u2014 override any fields you want. Without a template, provide trigger, conditions (optional), and at least one action. trigger values: "feed_import" (runs after every feed import), "market_price" (runs after market-price refresh), "manual" (only runs when explicitly triggered). enabled defaults to true; set false to create the rule paused. Returns the created rule with its id. confirm must be true.',
      inputSchema: {
        confirm: z3.literal(true).describe("Must be true to execute this write operation."),
        name: z3.string().min(1).max(120).describe("Human-readable rule name (1\u2013120 chars)."),
        enabled: z3.boolean().optional().describe("Whether the rule runs automatically. Defaults to true."),
        trigger: z3.string().describe(
          'Event that fires this rule: "feed_import", "market_price", "manual", or any custom string.'
        ),
        conditions: z3.array(conditionSchema).optional().describe(
          "Conditions that must ALL match for a product to be acted on. Empty or omitted means all products."
        ),
        actions: z3.array(actionSchema).describe(
          "Actions to perform on matching products. At least one required."
        ),
        template: z3.string().nullable().optional().describe(
          "Template key this rule was based on (informational; use haszno_rules_list_templates to list keys)."
        )
      }
    },
    ({ confirm: _c, name, enabled, trigger, conditions, actions, template }) => wrap(() => client.rules.create({ name, enabled, trigger, conditions, actions, template }))
  );
  server.registerTool(
    "haszno_rules_update",
    {
      description: "Update an existing rule. Only the fields you send are changed; omit a field to leave it unchanged. Most common use: toggle enabled on/off with {id, enabled: false/true}. You can also rename, change the trigger, adjust conditions, or replace all actions. Get rule ids from haszno_rules_list. confirm must be true.",
      inputSchema: {
        confirm: z3.literal(true).describe("Must be true to execute this write operation."),
        id: z3.number().int().describe("Rule id (from haszno_rules_list)."),
        name: z3.string().min(1).max(120).optional().describe("New name (1\u2013120 chars). Omit to keep current."),
        enabled: z3.boolean().optional().describe("true = active, false = paused. Omit to keep current."),
        trigger: z3.string().optional().describe("New trigger event. Omit to keep current."),
        conditions: z3.array(conditionSchema).optional().describe("Replace all conditions. Omit to keep current."),
        actions: z3.array(actionSchema).optional().describe("Replace all actions. Omit to keep current.")
      }
    },
    ({ confirm: _c, id, name, enabled, trigger, conditions, actions }) => wrap(() => client.rules.update(id, { name, enabled, trigger, conditions, actions }))
  );
  server.registerTool(
    "haszno_rules_delete",
    {
      description: "Permanently delete a rule and its entire run-history. This CANNOT be undone. Prefer disabling the rule (haszno_rules_update with enabled=false) for reversible deactivation. Only delete when the rule is permanently no longer needed. Get rule ids from haszno_rules_list. confirm must be true.",
      inputSchema: {
        confirm: z3.literal(true).describe("Must be true to execute this destructive operation."),
        id: z3.number().int().describe("Rule id to delete permanently (from haszno_rules_list).")
      },
      annotations: { destructiveHint: true }
    },
    ({ confirm: _c, id }) => wrap(() => client.rules.delete(id))
  );
  server.registerTool(
    "haszno_rules_run",
    {
      description: 'Manually run a single rule against all currently eligible products, regardless of its trigger setting. Returns {applied, skipped, errors} counts. Use for one-off rule application (e.g. re-price after a manual cost update) or to test a rule before enabling it. If the rule has an "unlist" action and products get delisted, use haszno_rules_list_runs + haszno_rules_undo_unlists to reverse. Get rule ids from haszno_rules_list. confirm must be true.',
      inputSchema: {
        confirm: z3.literal(true).describe("Must be true to execute this write operation."),
        id: z3.number().int().describe("Rule id to run (from haszno_rules_list).")
      }
    },
    ({ confirm: _c, id }) => wrap(() => client.rules.run(id))
  );
  server.registerTool(
    "haszno_rules_run_all",
    {
      description: 'Run all currently ENABLED rules whose trigger is "manual" in one shot. Returns aggregate {applied, skipped, errors} counts. Use for bulk re-pricing or cleanup tasks (e.g. apply markup tiers across the whole catalogue). confirm must be true.',
      inputSchema: {
        confirm: z3.literal(true).describe("Must be true to execute this write operation.")
      }
    },
    ({ confirm: _c }) => wrap(() => client.rules.runAll())
  );
  server.registerTool(
    "haszno_rules_trigger",
    {
      description: 'Fire all ENABLED rules that listen to a specific trigger event, optionally scoped to a subset of product ids. Returns aggregate {applied, skipped, errors} counts. Trigger values: "feed_import" (simulate a feed-import event), "market_price" (simulate a market-price refresh), "manual", or any custom trigger string. Use to replay an event, test trigger-based rules, or selectively apply automation to specific products. confirm must be true.',
      inputSchema: {
        confirm: z3.literal(true).describe("Must be true to execute this write operation."),
        trigger: z3.string().describe('Trigger event name, e.g. "feed_import", "market_price", "manual".'),
        product_ids: z3.array(z3.number().int()).optional().describe(
          "Restrict execution to these product ids. Omit to run on all eligible products."
        )
      }
    },
    ({ confirm: _c, trigger, product_ids }) => wrap(() => client.rules.trigger({ trigger, productIds: product_ids }))
  );
  server.registerTool(
    "haszno_rules_undo_unlists",
    {
      description: 'Undo "unlist" actions recorded in the rule-execution log \u2014 re-lists products that were automatically delisted by a rule and marks those log entries as "(visszavonva)" (reversed). Two targeting modes:   ids=[...] \u2014 undo specific run-log row IDs (get these from haszno_rules_list_runs);   rule_id + at \u2014 undo all unlists from a specific rule at a specific ISO timestamp. Only log entries whose summary starts with "Lev\xE9ve" (and are not already reversed) are affected. Returns {relisted: N} with the count of re-listed products. Use after an accidental bulk-unlist or after reviewing rule results and deciding to reverse them. confirm must be true.',
      inputSchema: {
        confirm: z3.literal(true).describe("Must be true to execute this write operation."),
        ids: z3.array(z3.number().int()).optional().describe(
          "Run-log row IDs to undo (from haszno_rules_list_runs). Use this OR rule_id+at, not both."
        ),
        rule_id: z3.number().int().optional().describe(
          "Rule id: undo all unlists from this rule at the given timestamp (use with at)."
        ),
        at: z3.string().optional().describe(
          'ISO timestamp of the rule run to undo (use with rule_id). Example: "2024-05-10T14:32:00.000Z".'
        )
      }
    },
    ({ confirm: _c, ids, rule_id, at }) => wrap(() => client.rules.undoUnlists({ ids, ruleId: rule_id, at }))
  );
  server.registerTool(
    "haszno_automation_set",
    {
      description: "Toggle the global automation kill switch. Pass paused=true to pause all automations: proposal-approve will return HTTP 409 until resumed. Pass paused=false to resume normal operation. This is idempotent \u2014 setting to the current state is harmless. Always check haszno_automation_get first to know the current state. confirm must be true.",
      inputSchema: {
        confirm: z3.literal(true).describe("Must be true to execute this write operation."),
        paused: z3.boolean().describe("true = pause all automations and block approvals; false = resume.")
      },
      annotations: { idempotentHint: true }
    },
    ({ confirm: _c, paused }) => wrap(() => client.automation.set({ paused }))
  );
}

// src/tools/orders.ts
import { z as z4 } from "zod";
function compactOrder(o) {
  return {
    id: o.id,
    externalId: o.externalId,
    customerName: o.customerName,
    address: o.address,
    status: o.status,
    totalGross: o.totalGross,
    supplierOrderId: o.supplierOrderId,
    trackingNumber: o.trackingNumber,
    itemCount: o.items.length,
    createdAt: o.createdAt
  };
}
function isDemoEnv() {
  const url = process.env["HASZNO_API_URL"] ?? process.env["ARFUTAR_API_URL"] ?? "https://haszno.com";
  return url.includes("demo") || url.includes("staging") || url.includes("localhost");
}
function registerOrdersTools(server, client) {
  server.registerTool(
    "haszno_orders_list",
    {
      title: "List orders",
      description: "List orders from the Haszno fulfilment pipeline, optionally filtered by status. Returns compact rows (no event log) sorted newest-first. Use to monitor the pipeline, find orders awaiting action, or audit history. Status values: received (new, not yet forwarded), forwarded (sent to supplier), shipped (tracking confirmed), error (forwarding failed). Money fields are whole forints (HUF), gross (VAT-inclusive).",
      inputSchema: {
        status: z4.enum(["received", "forwarded", "shipped", "error"]).optional().describe("Filter by order status. Omit to return all statuses."),
        limit: z4.number().int().min(1).max(50).default(25).optional().describe("Maximum rows to return (1\u201350, default 25).")
      },
      annotations: { readOnlyHint: true }
    },
    async ({ status, limit = 25 }) => {
      const all = await client.orders.list();
      const filtered = status ? all.filter((o) => o.status === status) : all;
      const page = filtered.slice(0, limit);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              orders: page.map(compactOrder),
              total: filtered.length,
              showing: page.length
            })
          }
        ]
      };
    }
  );
  server.registerTool(
    "haszno_orders_get",
    {
      title: "Get order details",
      description: "Retrieve a single order with full details: items (SKU, qty, unit price in HUF gross), event log (timeline of status changes with timestamps), supplier order ID, and tracking number. Use after haszno_orders_list to drill into a specific order.",
      inputSchema: {
        id: z4.number().int().positive().describe("Haszno order ID (integer).")
      },
      annotations: { readOnlyHint: true }
    },
    async ({ id }) => {
      const all = await client.orders.list();
      const order = all.find((o) => o.id === id);
      if (!order) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: `Order #${id} not found.` })
            }
          ],
          isError: true
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(order) }]
      };
    }
  );
  server.registerTool(
    "haszno_orders_ship",
    {
      title: "Mark order as shipped",
      description: 'Mark an order as shipped (sets status to "shipped" and records a tracking event). Idempotent \u2014 safe to call again if already shipped. Only use this for orders in "forwarded" state; calling it on "received" or "error" orders may produce unexpected results. Returns the updated order object including tracking number if set by the supplier. Requires confirm: true to prevent accidental execution.',
      inputSchema: {
        id: z4.number().int().positive().describe("ID of the order to mark as shipped."),
        confirm: z4.literal(true).describe("Must be true. Prevents accidental execution of this write operation.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ id, confirm: _confirm }) => {
      const updated = await client.orders.ship(id);
      return {
        content: [{ type: "text", text: JSON.stringify(updated) }]
      };
    }
  );
  server.registerTool(
    "haszno_orders_receive",
    {
      title: "Receive / inject a new order",
      description: "Inject a new order into the Haszno forwarding pipeline via the shop webhook. The system will attempt to forward it to the connected supplier automatically (email or simulated, depending on supplier configuration). Use this only when integrating a shop checkout flow or testing end-to-end order handling. Each item SKU must already exist in the Haszno product catalogue; unknown SKUs return an error. Returns the new order ID on success. Requires confirm: true to prevent accidental writes.",
      inputSchema: {
        externalId: z4.string().min(1).max(64).describe(
          `The shop's own order reference (e.g. "WEB-00123"). Must be unique within the shop.`
        ),
        customerName: z4.string().min(1).max(120).describe("Full name of the end customer."),
        address: z4.string().min(1).max(300).describe(
          'Delivery address as a single string (e.g. "9200 Mosonmagyar\xF3v\xE1r, F\u0151 u. 1.").'
        ),
        items: z4.array(
          z4.object({
            sku: z4.string().min(1).describe("Supplier SKU of the product."),
            qty: z4.number().int().positive().describe("Quantity ordered (positive integer).")
          })
        ).min(1).describe("Order line items. At least one item required."),
        confirm: z4.literal(true).describe("Must be true. Prevents accidental execution of this write operation.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async ({ externalId, customerName, address, items, confirm: _confirm }) => {
      const result = await client.orders.receiveOrder({ externalId, customerName, address, items });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );
  server.registerTool(
    "haszno_orders_create_demo",
    {
      title: "Create demo order (demo environment only)",
      description: 'Create a randomly-generated demo order using in-stock products. ONLY call this against a demo or staging environment (HASZNO_API_URL must contain "demo", "staging", or "localhost"). Calling against a production shop will be blocked by this tool. Useful for end-to-end testing of the forwarding pipeline without manual order construction. Requires confirm: true.',
      inputSchema: {
        confirm: z4.literal(true).describe("Must be true. Prevents accidental execution of this write operation.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ confirm: _confirm }) => {
      if (!isDemoEnv()) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "haszno_orders_create_demo is only allowed in demo/staging environments. Set HASZNO_API_URL to a demo or localhost URL to use this tool."
              })
            }
          ],
          isError: true
        };
      }
      const result = await client.orders.createDemo();
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );
}

// src/tools/ideas.ts
import { z as z5 } from "zod";
function compactItem(item, rank) {
  return {
    rank,
    id: item.id,
    sku: item.sku,
    name: item.name,
    supplier: item.supplierName,
    stock: item.stock,
    costNet_HUF: item.costNet,
    suggestedPriceGross_HUF: item.recommended?.priceGross ?? null,
    marginNet_HUF: item.recommended?.marginNet ?? null,
    marginPct: item.recommended?.marginPct ?? null,
    trendScore: item.trendScore ?? null
  };
}
function registerIdeasListTool(server, client) {
  server.registerTool(
    "haszno_ideas_list",
    {
      title: "Haszno term\xE9k\xF6tlet lista",
      description: "Get the ranked product idea shortlist for this shop. Products are scored by Google Trends demand (HU) and margin safety. Use this to find which new products to add, or which catalogue items are currently trending in Hungary. Returns: anchor keyword (the Google Trends normalisation base), geo, total count, and an array of items each with: rank, id, sku, name, supplier, stock, costNet_HUF (net cost in HUF), suggestedPriceGross_HUF (VAT-inclusive), marginNet_HUF, marginPct, trendScore (0\u2013100; null if not yet scored). Default limit 25; max 100. Read-only, no confirmation needed.",
      inputSchema: {
        min_score: z5.number().min(0).max(100).optional().describe("Keep only items with trendScore >= this value (0\u2013100)."),
        supplier: z5.string().optional().describe("Filter by supplier name \u2014 case-insensitive substring match."),
        limit: z5.number().int().min(1).max(100).optional().describe("Maximum number of items to return. Default 25, max 100.")
      },
      annotations: { readOnlyHint: true }
    },
    async ({ min_score, supplier, limit }) => {
      const recs = await client.recommendations.get();
      let items = recs.items ?? [];
      if (min_score != null) {
        items = items.filter((it) => (it.trendScore ?? 0) >= min_score);
      }
      if (supplier) {
        const q = supplier.toLowerCase();
        items = items.filter((it) => it.supplierName.toLowerCase().includes(q));
      }
      items = [...items].sort((a, b) => {
        const tsDiff = (b.trendScore ?? 0) - (a.trendScore ?? 0);
        if (tsDiff !== 0) return tsDiff;
        return (b.recommended?.marginPct ?? 0) - (a.recommended?.marginPct ?? 0);
      });
      const cap = limit ?? 25;
      const truncated = items.length > cap;
      items = items.slice(0, cap);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              anchor: recs.anchor,
              geo: recs.geo,
              total: (recs.items ?? []).length,
              filtered: items.length,
              truncated,
              items: items.map((it, i) => compactItem(it, i + 1))
            })
          }
        ]
      };
    }
  );
}
function registerAiShortlistTool(server, client) {
  server.registerTool(
    "haszno_ideas_ai_shortlist",
    {
      title: "Haszno AI term\xE9k\xF6tlet shortlist",
      description: `Get an AI-curated shortlist of up to 5 products that best fit this shop. The AI evaluates own catalogue items (not yet listed, positive margin) and partner network products, then picks the ones most complementary to the shop's existing mix. Returns: summary (1\u20132 Hungarian sentences), picks (\u22645 items \u2014 each with name, supplier, recommendedPriceGross_HUF (VAT-inclusive), marginNet_HUF, marginPct, fit score 0\u2013100, aiReason in Hungarian), usage (model, inputTokens, outputTokens, estimatedCostFt_HUF), and cached flag. "cached: true" means the server returned a 24-hour cached result \u2014 no additional AI spend occurred. Requires confirm: true because it may trigger an AI API call on the server.`,
      inputSchema: {
        confirm: z5.literal(true).describe("Must be true. Confirms you accept a possible AI API call and its cost.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ confirm: _confirm }) => {
      const result = await client.recommendations.getAiShortlist();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              summary: result.summary,
              cached: result.cached ?? false,
              picks: (result.picks ?? []).map((p) => ({
                productId: p.productId,
                networkProductId: p.networkProductId,
                name: p.name,
                supplier: p.supplierName,
                recommendedPriceGross_HUF: p.recommendedPriceGross,
                marginNet_HUF: p.marginNet,
                marginPct: p.marginPct,
                fit: p.fit,
                aiReason: p.aiReason
              })),
              usage: result.usage ? {
                model: result.usage.model,
                inputTokens: result.usage.inputTokens,
                outputTokens: result.usage.outputTokens,
                estimatedCostFt_HUF: result.usage.costFt
              } : null
            })
          }
        ]
      };
    }
  );
}
function registerAiDescriptionTool(server, client) {
  server.registerTool(
    "haszno_ideas_ai_description",
    {
      title: "Haszno AI term\xE9kleiras gener\xE1tor",
      description: "Generate an AI product description for a shop product. Uses the product name and its trend keyword to write a Hungarian webshop product description. The result is returned as text \u2014 it is NOT saved automatically. Review it, then apply it via haszno_products_update if satisfied. Get the product_id from haszno_ideas_list or haszno_products_list. Requires confirm: true because it triggers an AI API call on the server.",
      inputSchema: {
        product_id: z5.number().int().min(1).describe("Numeric id of the shop product to describe."),
        confirm: z5.literal(true).describe("Must be true. Confirms you accept the AI API call and its cost.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async ({ product_id, confirm: _confirm }) => {
      const result = await client.products.generateAiDescription(product_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ product_id, description: result.text })
          }
        ]
      };
    }
  );
}
function registerFillKeywordsTool(server, client) {
  server.registerTool(
    "haszno_ideas_fill_keywords",
    {
      title: "Haszno trendkulcssz\xF3 felt\xF6lt\xE9s",
      description: "Fill missing Google Trends keywords for all products that have none. Products without a trend keyword are excluded from the idea scoring; running this improves haszno_ideas_list and haszno_ideas_ai_shortlist. Uses Claude AI to suggest a generic Hungarian + English search phrase per product. Changes are saved immediately on the server. Returns: { updated: N }. Returns { updated: 0 } when all keywords are already filled \u2014 safe to call repeatedly (outcome is idempotent). Requires confirm: true because it modifies shop data and incurs AI cost.",
      inputSchema: {
        confirm: z5.literal(true).describe("Must be true. Confirms the write and AI API call.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ confirm: _confirm }) => {
      const result = await client.recommendations.fillTrendKeywords();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ updated: result.updated })
          }
        ]
      };
    }
  );
}
function registerIdeasTools(server, client) {
  registerIdeasListTool(server, client);
  registerAiShortlistTool(server, client);
  registerAiDescriptionTool(server, client);
  registerFillKeywordsTool(server, client);
}

// src/tools/feeds.ts
import { readFileSync } from "fs";
import { resolve as resolvePath, sep } from "path";
import { z as z6 } from "zod";
function resolveContent(content, filePath) {
  if (content != null && content.length > 0) return content;
  if (filePath != null && filePath.length > 0) {
    const resolved = resolvePath(filePath);
    if (!/\.(csv|xml|tsv|txt)$/i.test(resolved)) {
      throw new Error("filePath must point to a .csv, .tsv, .txt or .xml feed file.");
    }
    if (resolved.split(sep).some((part) => part.startsWith(".") && part.length > 1)) {
      throw new Error("filePath must not be inside a hidden directory (e.g. ~/.ssh, ~/.config).");
    }
    return readFileSync(resolved, "utf8");
  }
  throw new Error("Provide either `content` (feed text) or `filePath` (path to the feed file).");
}
function buildAuthHeaders() {
  const key = process.env["HASZNO_API_KEY"] ?? process.env["ARFUTAR_API_KEY"];
  if (key) return { "x-api-key": key };
  const basic = process.env["HASZNO_BASIC"] ?? process.env["ARFUTAR_BASIC"];
  if (basic) {
    const encoded = Buffer.from(basic).toString("base64");
    return { Authorization: `Basic ${encoded}` };
  }
  return {};
}
function getBaseUrl() {
  return (process.env["HASZNO_API_URL"] ?? process.env["ARFUTAR_API_URL"] ?? "https://haszno.com").replace(/\/$/, "");
}
function countXmlTags(xml, tag) {
  return (xml.match(new RegExp(`<${tag}[\\s>]`, "g")) ?? []).length;
}
function sampleArukereso(xml, limit) {
  const results = [];
  const productRegex = /<product>([\s\S]*?)<\/product>/g;
  let m;
  while ((m = productRegex.exec(xml)) !== null && results.length < limit) {
    const block = m[1] ?? "";
    const sku = block.match(/<identifier>([\s\S]*?)<\/identifier>/)?.[1] ?? "";
    const name = block.match(/<name>([\s\S]*?)<\/name>/)?.[1] ?? "";
    const price = block.match(/<price>([\s\S]*?)<\/price>/)?.[1] ?? "";
    results.push({ sku, name, price });
  }
  return results;
}
function sampleGoogle(xml, limit) {
  const results = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRegex.exec(xml)) !== null && results.length < limit) {
    const block = m[1] ?? "";
    const id = block.match(/<g:id>([\s\S]*?)<\/g:id>/)?.[1] ?? "";
    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
    const price = block.match(/<g:price>([\s\S]*?)<\/g:price>/)?.[1] ?? "";
    results.push({ id, title, price });
  }
  return results;
}
function registerFeedsTools(server, client) {
  server.registerTool(
    "haszno_feeds_import_supplier",
    {
      title: "Import Supplier Feed",
      description: `Import a supplier's product catalogue feed (CSV or XML) into Haszno.
Use when a partner/supplier sends an updated price or stock list.
Creates new products that do not exist yet and updates (name, costNet, stock, rrpGross)
existing products matched by SKU.
Triggers the feed_import rule afterwards.
Returns { created, updated, total } \u2014 counts of product rows affected.
Prices in the feed are gross HUF (brutt\xF3 Ft).
WRITE OPERATION \u2014 requires confirm: true; with confirm: false (default) the call is a no-op safe dry-run.`,
      inputSchema: {
        supplierId: z6.number().int().positive().describe(
          "ID of the network supplier whose feed this is. Get IDs from haszno_catalog_list_suppliers."
        ),
        format: z6.enum(["csv", "xml"]).describe(
          'Feed format. Use "csv" for comma/tab-separated, "xml" for \xC1rukeres\u0151-style XML.'
        ),
        content: z6.string().optional().describe("Feed text content pasted directly. Either this or filePath is required."),
        filePath: z6.string().optional().describe(
          "Absolute path to the feed file on the local filesystem. The MCP server reads it. Either this or content is required."
        ),
        confirm: z6.boolean().default(false).describe(
          "Set to true to execute the import. When false (default) the tool returns a dry-run summary without touching the database."
        )
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false
      }
    },
    async ({ supplierId, format, content, filePath, confirm }) => {
      if (!confirm) {
        const preview = content != null ? `${content.trim().split("\n").length} sorok (${content.length} karakter) k\xF6zvetlen\xFCl \xE1tadva` : filePath != null ? `f\xE1jl: ${filePath}` : "(nincs tartalom megadva)";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                dry_run: true,
                message: "Feed import\xE1l\xE1s NEM t\xF6rt\xE9nt. \xC1ll\xEDtsd confirm: true \xE9rt\xE9kre a t\xE9nyleges import\xE1l\xE1shoz.",
                supplierId,
                format,
                source: preview
              })
            }
          ]
        };
      }
      let feedContent;
      try {
        feedContent = resolveContent(content, filePath);
      } catch (err2) {
        return {
          content: [
            { type: "text", text: JSON.stringify({ error: err2.message }) }
          ],
          isError: true
        };
      }
      try {
        const result = await client.feeds.importFeed({ supplierId, format, content: feedContent });
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        };
      } catch (err2) {
        return {
          content: [
            { type: "text", text: JSON.stringify({ error: err2.message }) }
          ],
          isError: true
        };
      }
    }
  );
  server.registerTool(
    "haszno_feeds_import_market",
    {
      title: "Import Market Prices",
      description: `Import competitor market prices from a CSV export (e.g. from \xC1rukeres\u0151.hu or a scrape).
Matches rows to existing products by SKU and updates the marketMinGross (legolcs\xF3bb versenyt\xE1rsi \xE1r,
gross HUF) and marketShop fields.
Returns { matched, total } \u2014 how many rows matched a product vs total rows in the CSV.
Triggers the market_price rule afterwards.
Safe to re-import (idempotent): running the same CSV twice sets the same values.
WRITE OPERATION \u2014 requires confirm: true.`,
      inputSchema: {
        content: z6.string().optional().describe("CSV text content. Either this or filePath is required."),
        filePath: z6.string().optional().describe(
          "Absolute path to the CSV file on the local filesystem. Either this or content is required."
        ),
        confirm: z6.boolean().default(false).describe(
          "Set to true to execute the import. When false (default) no changes are made."
        )
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true
      }
    },
    async ({ content, filePath, confirm }) => {
      if (!confirm) {
        const preview = content != null ? `${content.trim().split("\n").length} sorok (${content.length} karakter)` : filePath != null ? `f\xE1jl: ${filePath}` : "(nincs tartalom megadva)";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                dry_run: true,
                message: "Piaci \xE1r import\xE1l\xE1s NEM t\xF6rt\xE9nt. \xC1ll\xEDtsd confirm: true \xE9rt\xE9kre.",
                source: preview
              })
            }
          ]
        };
      }
      let csvContent;
      try {
        csvContent = resolveContent(content, filePath);
      } catch (err2) {
        return {
          content: [
            { type: "text", text: JSON.stringify({ error: err2.message }) }
          ],
          isError: true
        };
      }
      try {
        const result = await client.feeds.importMarketPrices({ content: csvContent });
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        };
      } catch (err2) {
        return {
          content: [
            { type: "text", text: JSON.stringify({ error: err2.message }) }
          ],
          isError: true
        };
      }
    }
  );
  server.registerTool(
    "haszno_feeds_outbound_info",
    {
      title: "Outbound Feed Info",
      description: `Returns the public XML feed URLs that Haszno publishes for price comparison services:
  - \xC1rukeres\u0151.hu : <baseUrl>/feed/arukereso.xml
  - Google Shopping: <baseUrl>/feed/google.xml
These URLs are configured in price comparison partner dashboards so their bots can crawl
the shop's listed (active) products. Only products with listed=true appear in the feeds.
Prices are gross HUF (brutt\xF3 Ft).
Set fetch_summary: true to GET the live feeds and return item_count + 3-item sample \u2014
useful for verifying the feeds are populated after a supplier import.`,
      inputSchema: {
        fetch_summary: z6.boolean().default(false).describe(
          "If true, fetches both feeds and returns item_count + 3-item sample. Default false (returns URLs only)."
        )
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true
      }
    },
    async ({ fetch_summary }) => {
      const base = getBaseUrl();
      const arukeresoUrl = `${base}/feed/arukereso.xml`;
      const googleUrl = `${base}/feed/google.xml`;
      if (!fetch_summary) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                arukereso_url: arukeresoUrl,
                google_url: googleUrl,
                note: "Set fetch_summary: true to verify the feeds are live and check item counts."
              })
            }
          ]
        };
      }
      const headers = buildAuthHeaders();
      async function fetchFeed(url) {
        try {
          const res = await fetch(url, { headers });
          if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
          const xml = await res.text();
          return { ok: true, xml };
        } catch (err2) {
          return { ok: false, error: err2.message };
        }
      }
      const [arRes, goRes] = await Promise.all([fetchFeed(arukeresoUrl), fetchFeed(googleUrl)]);
      const arukeresoSummary = arRes.ok && arRes.xml != null ? {
        url: arukeresoUrl,
        item_count: countXmlTags(arRes.xml, "product"),
        sample: sampleArukereso(arRes.xml, 3)
      } : { url: arukeresoUrl, error: arRes.error ?? `HTTP ${arRes.status}` };
      const googleSummary = goRes.ok && goRes.xml != null ? {
        url: googleUrl,
        item_count: countXmlTags(goRes.xml, "item"),
        sample: sampleGoogle(goRes.xml, 3)
      } : { url: googleUrl, error: goRes.error ?? `HTTP ${goRes.status}` };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ arukereso: arukeresoSummary, google: googleSummary })
          }
        ]
      };
    }
  );
}

// src/tools/account.ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { z as z7 } from "zod";
function json(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
function mkErr(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}
function registerAccountTools(server, client) {
  server.registerTool(
    "haszno_ping",
    {
      title: "Ping / health check",
      description: "Verifies that the Haszno API is reachable and responding. Call this before any other tool to confirm connectivity, or whenever you want to check whether the backend is up. Returns { ok: true } on success.",
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async () => {
      try {
        const result = await client.health.check();
        return json(result);
      } catch (e) {
        return mkErr(`Ping failed: ${String(e)}`);
      }
    }
  );
  server.registerTool(
    "haszno_account_get_settings",
    {
      title: "Get pricing rule settings",
      description: `Returns the shop's pricing rule configuration: "undercutPct" \u2014 how many percent below the cheapest market competitor the system prices (e.g. 5 = 5% below); "minMarginPct" \u2014 minimum gross-profit margin required before the rule applies (e.g. 10 = 10%); "vatPct" \u2014 VAT rate used for net/gross conversions (e.g. 27 for Hungarian \xC1FA); "automationPaused" \u2014 when true the automatic proposal engine is halted. All prices in the system are in HUF (gross). Read this before interpreting or proposing any pricing changes.`,
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async () => {
      try {
        const settings = await client.settings.get();
        return json(settings);
      } catch (e) {
        return mkErr(`Failed to fetch settings: ${String(e)}`);
      }
    }
  );
  server.registerTool(
    "haszno_account_update_settings",
    {
      title: "Update pricing rule settings",
      description: `Updates the shop's global pricing rule parameters. All three numeric fields are required. Use haszno_account_get_settings first to read the current values, then adjust only what needs to change. "undercutPct": percentage to undercut the cheapest market competitor (e.g. 5 \u2192 5% lower). "minMarginPct": minimum net profit margin % to keep (e.g. 10 \u2192 never price below 10% margin). "vatPct": the shop's VAT rate for gross/net conversion (e.g. 27 for Hungarian \xC1FA). All money values in the system are gross HUF. Requires confirm: true to prevent accidental changes \u2014 do NOT omit it.`,
      inputSchema: {
        undercutPct: z7.number().min(0).max(100).describe(
          "Percentage to undercut the cheapest market price (0\u2013100). E.g. 5 = price 5% below the market minimum."
        ),
        minMarginPct: z7.number().min(0).max(100).describe(
          "Minimum net profit margin percentage (0\u2013100). The rule will never go below this."
        ),
        vatPct: z7.number().min(0).max(100).describe(
          "VAT rate used for gross \u2194 net conversions (e.g. 27 for Hungarian \xC1FA)."
        ),
        confirm: z7.literal(true).describe(
          "Must be exactly true. This is a safeguard \u2014 always pass true explicitly."
        )
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async (args) => {
      try {
        const updated = await client.settings.update({
          undercutPct: args.undercutPct,
          minMarginPct: args.minMarginPct,
          vatPct: args.vatPct
        });
        return json(updated);
      } catch (e) {
        return mkErr(`Failed to update settings: ${String(e)}`);
      }
    }
  );
  server.registerTool(
    "haszno_account_get_stats",
    {
      title: "Get account statistics",
      description: `Returns a compact dashboard snapshot of the shop's current state: "products" \u2014 total number of products in the catalogue; "losing" \u2014 products currently priced below cost (should be fixed urgently); "overMarket" \u2014 products priced above the cheapest market competitor; "toFix" \u2014 products that have a pending pricing problem (losing + overMarket combined); "orders" \u2014 total number of orders received. Use this to quickly assess the shop's health before deciding what to investigate next.`,
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async () => {
      try {
        const stats = await client.stats.get();
        return json(stats);
      } catch (e) {
        return mkErr(`Failed to fetch stats: ${String(e)}`);
      }
    }
  );
  server.registerTool(
    "haszno_account_get_impact",
    {
      title: "Get profit impact report",
      description: `Returns the financial impact of Haszno's pricing optimisation over the last N days. "days" \u2014 the reporting window (defaults to 30 if omitted). "extraProfit" \u2014 additional gross HUF profit earned compared to no-automation baseline; "baseline" \u2014 baseline gross profit without Haszno; "pctGain" \u2014 percentage uplift ((extraProfit / baseline) \xD7 100); "orders" \u2014 total orders in the window; "autoForwardedOrders" \u2014 orders automatically forwarded to suppliers without manual action. All money values are gross HUF.`,
      inputSchema: {
        days: z7.number().int().min(1).max(365).optional().describe(
          "Look-back window in days (1\u2013365). Defaults to 30 when omitted."
        )
      },
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async (args) => {
      try {
        const impact = await client.stats.getImpact({ days: args.days });
        return json(impact);
      } catch (e) {
        return mkErr(`Failed to fetch impact report: ${String(e)}`);
      }
    }
  );
  server.registerTool(
    "haszno_account_list_suppliers",
    {
      title: "List active supplier integrations",
      description: `Returns the shop's own supplier integrations \u2014 the suppliers whose catalogues have been imported. Each entry includes: "id", "name", "orderMode" (simulated | email), "email" for email-based ordering, "network" (true if this is a network/marketplace supplier), "category", "country", "shopUrl", "createdAt". Note: this is different from haszno_catalog_list_suppliers which lists the full partner marketplace. Use this to identify which supplier a product belongs to, or to understand the shop's supply chain.`,
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async () => {
      try {
        const suppliers = await client.suppliers.list();
        return json(suppliers);
      } catch (e) {
        return mkErr(`Failed to list suppliers: ${String(e)}`);
      }
    }
  );
  server.registerTool(
    "haszno_account_configure",
    {
      title: "Save API credentials to local config",
      description: 'Writes Haszno API credentials to ~/.config/haszno/config.json (chmod 600) so the CLI and MCP server can read them without requiring environment variables on every invocation. Provide "apiUrl" (default https://haszno.com) and either "apiKey" (sent as the x-api-key header) or "basicAuth" ("user:pass" for HTTP Basic \u2014 only used while per-shop API keys are unavailable). The file is created with restricted permissions (owner read/write only) and credentials are NEVER logged. Requires confirm: true. WARNING: overwrites any previously saved credentials.',
      inputSchema: {
        apiUrl: z7.string().url().describe(
          "Base URL of the Haszno API, default https://haszno.com"
        ),
        apiKey: z7.string().min(1).optional().describe(
          "API key, sent as the x-api-key header (preferred). Provide this OR basicAuth, not both."
        ),
        basicAuth: z7.string().regex(/^[^:]+:[^:]+$/).optional().describe(
          'HTTP Basic credentials in "user:pass" format. Fallback when API keys are not yet available.'
        ),
        confirm: z7.literal(true).describe(
          "Must be exactly true. This is a safeguard \u2014 always pass true explicitly."
        )
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async (args) => {
      if (!args.apiKey && !args.basicAuth) {
        return mkErr("Provide either apiKey or basicAuth (not both omitted).");
      }
      if (args.apiKey && args.basicAuth) {
        return mkErr("Provide either apiKey or basicAuth \u2014 not both.");
      }
      const configDir = path.join(os.homedir(), ".config", "haszno");
      const configFile = path.join(configDir, "config.json");
      try {
        let existing = {};
        try {
          const raw = fs.readFileSync(configFile, "utf8");
          existing = JSON.parse(raw);
        } catch {
        }
        const written = {
          ...existing,
          apiUrl: args.apiUrl
        };
        if (args.apiKey) {
          written["apiKey"] = args.apiKey;
        } else if (args.basicAuth) {
          written["basicAuth"] = args.basicAuth;
        }
        fs.mkdirSync(configDir, { recursive: true, mode: 448 });
        fs.writeFileSync(configFile, JSON.stringify(written, null, 2), { mode: 384 });
        return json({
          saved: true,
          configFile,
          apiUrl: args.apiUrl,
          authMethod: args.apiKey ? "apiKey" : "basicAuth"
        });
      } catch (e) {
        return mkErr(`Failed to save config: ${String(e)}`);
      }
    }
  );
}

// src/tools/catalogue.ts
import { z as z8 } from "zod";
function registerCatalogueTools(server, client) {
  server.registerTool(
    "haszno_catalogue_search",
    {
      title: "Search partner product catalogue",
      description: "Search the Haszno dropshipping partner product catalogue. Returns products with pricing, margin, and stock details. Filter by free-text (name/category), category key, partner/supplier id, margin %, price range, stock availability, country, or sort order. Returns: { items: CatalogueItem[], total, facets } \u2014 facets include partners, countries, categories, margin buckets for drill-down. Default page size is 24. Use inStock=true for available stock only. Use marginPct filter to surface only profitable products.",
      inputSchema: {
        q: z8.string().optional().describe("Free-text search on product name or category"),
        cats: z8.string().optional().describe('Comma-separated category keys, e.g. "elektronika,ruh\xE1zat"'),
        partner: z8.number().int().positive().optional().describe("Filter by supplier/partner id"),
        minMarginPct: z8.number().optional().describe("Minimum margin % (e.g. 15 means 15%)"),
        maxPrice: z8.number().optional().describe("Maximum RRP gross price in HUF"),
        minPrice: z8.number().optional().describe("Minimum RRP gross price in HUF"),
        inStock: z8.boolean().optional().describe("true = only products currently in stock"),
        hasImage: z8.boolean().optional().describe("true = only products that have an image"),
        country: z8.string().optional().describe('Supplier country code, e.g. "HU", "DE"'),
        sort: z8.enum(["margin_desc", "price_asc", "price_desc", "name_asc"]).optional().describe("Sort order (default name_asc)"),
        page: z8.number().int().min(1).optional().describe("Page number, 1-based (default 1)"),
        pageSize: z8.number().int().min(1).max(100).optional().describe("Items per page, max 100 (default 24)")
      },
      annotations: { readOnlyHint: true }
    },
    async (args) => {
      const result = await client.catalogue.search({
        q: args.q,
        cats: args.cats,
        partner: args.partner,
        minMarginPct: args.minMarginPct,
        maxPrice: args.maxPrice,
        minPrice: args.minPrice,
        inStock: args.inStock,
        hasImage: args.hasImage,
        country: args.country,
        sort: args.sort,
        page: args.page,
        pageSize: args.pageSize
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );
  server.registerTool(
    "haszno_import_list_list",
    {
      title: "List import list items",
      description: "Lists products the user has added to their Haszno import list. The import list is a staging area: products are added here from the catalogue before being pushed to a connected webshop. Each item shows id, name, sku, partnerName, pricing, stock, pushStatus, and targetConnectionId. pushStatus: varakozik=waiting, kuldve=sent, kesz=done, hiba=error. Filter by status or partner/supplier id.",
      inputSchema: {
        status: z8.enum(["varakozik", "kuldve", "kesz", "hiba"]).optional().describe("Filter by push status"),
        partner: z8.number().int().positive().optional().describe("Filter by supplier/partner id"),
        q: z8.string().optional().describe("Free-text search on product name or SKU")
      },
      annotations: { readOnlyHint: true }
    },
    async (args) => {
      const items = await client.importList.list({
        status: args.status,
        partner: args.partner,
        q: args.q
      });
      return { content: [{ type: "text", text: JSON.stringify({ items, total: items.length }) }] };
    }
  );
  server.registerTool(
    "haszno_import_list_add",
    {
      title: "Add products to import list",
      description: "Adds one or more network/catalogue products to the import list by their catalogue product IDs. Use haszno_catalogue_search first to find product IDs. Returns { added, skipped } \u2014 skipped means the product was already in the list. This is a non-destructive write; no product is created in the shop yet. To push to the shop, use haszno_import_list_push afterwards.",
      inputSchema: {
        networkProductIds: z8.array(z8.number().int().positive()).min(1).max(100).describe("IDs of catalogue/network products to add (from haszno_catalogue_search)")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async (args) => {
      const result = await client.importList.add({ networkProductIds: args.networkProductIds });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );
  server.registerTool(
    "haszno_import_list_push",
    {
      title: "Push import list items to connected store",
      description: `Pushes import-list items to the user's connected webshop (WooCommerce, Shopify, etc.). Requires confirm=true to prevent accidental pushes. You MUST pass the import list item IDs (from haszno_import_list_list). Optionally specify targetConnectionId to target a specific store connection. Returns { pushed, failed, errors }. Note: the connected store must have status "kapcsolva" (use haszno_connections_list to check).`,
      inputSchema: {
        ids: z8.array(z8.number().int().positive()).min(1).describe("Import list item IDs to push (from haszno_import_list_list)"),
        targetConnectionId: z8.number().int().positive().optional().describe("Store connection ID to push to (from haszno_connections_list); uses shop default if omitted"),
        confirm: z8.boolean().describe("Must be true to execute the push \u2014 set false for a preview/dry-run response")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      if (!args.confirm) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              preview: true,
              message: `Ezt a ${args.ids.length} term\xE9ket tolja ki a boltba. Add meg confirm: true a val\xF3s futtat\xE1shoz.`,
              ids: args.ids,
              targetConnectionId: args.targetConnectionId ?? null
            })
          }]
        };
      }
      const result = args.targetConnectionId != null ? await client.importList.push({ ids: args.ids, targetConnectionId: args.targetConnectionId }) : await client.importList.push({ ids: args.ids });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );
}

// src/tools/connections.ts
import { z as z9 } from "zod";
function registerConnectionsTools(server, client) {
  server.registerTool(
    "haszno_connections_list",
    {
      title: "List connected webshops",
      description: `Lists the user's connected webshop store connections. Each connection has: id, platform (shoprenter/unas/woocommerce/shopify/medusa/mock), name, status (uj=new/setup, domain_ok=domain verified, kapcsolva=connected, hiba=error), domain, lastError, connectedAt, lastSyncAt. Use the connection id as targetConnectionId in haszno_import_list_push. Only connections with status "kapcsolva" can receive pushed products.`,
      inputSchema: {
        status: z9.enum(["uj", "domain_ok", "kapcsolva", "hiba"]).optional().describe("Filter by connection status")
      },
      annotations: { readOnlyHint: true }
    },
    async (args) => {
      let connections = await client.connections.list();
      if (args.status != null) {
        connections = connections.filter((c) => c.status === args.status);
      }
      return { content: [{ type: "text", text: JSON.stringify({ connections }) }] };
    }
  );
}

// src/tools/peers.ts
import { z as z10 } from "zod";
function registerPeersTools(server, client) {
  server.registerTool(
    "haszno_peers_invite_create",
    {
      title: "Create peer invite",
      description: "Creates a one-time invite code that lets another Haszno shop become your peer partner for a specific supplier. The invited shop gains access to that supplier's catalogue. You must own or manage the supplier (supplierId). Requires confirm=true to prevent accidental invite creation. Without confirm:true returns a dry-run preview and does NOT call the API. Returns { code, expiresAt, supplierId } \u2014 share the code with the partner. Each invite is single-use and expires at the given datetime.",
      inputSchema: {
        supplierId: z10.number().int().positive().describe("Supplier ID to share access for"),
        expiresAt: z10.string().describe('Expiry datetime in ISO-8601, e.g. "2026-12-31T23:59:00Z". Must be in the future.'),
        confirm: z10.boolean().describe("Must be true to create the invite \u2014 set false for a preview/dry-run response")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      if (!args.confirm) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              preview: true,
              message: `Megh\xEDv\xF3 l\xE9trehoz\xE1sa: sz\xE1ll\xEDt\xF3 #${args.supplierId}, lej\xE1r: ${args.expiresAt}. Add meg confirm: true a val\xF3s futtat\xE1shoz.`,
              supplierId: args.supplierId,
              expiresAt: args.expiresAt
            })
          }]
        };
      }
      const invite = await client.peers.createInvite({
        supplierId: args.supplierId,
        expiresAt: args.expiresAt
      });
      return { content: [{ type: "text", text: JSON.stringify(invite) }] };
    }
  );
  server.registerTool(
    "haszno_peers_invite_list",
    {
      title: "List peer invites",
      description: "Lists all invite codes you have created. Each invite shows: code, supplierId, expiresAt, acceptedBy (null if pending), revokedAt (null if active). Use to check which invites are still pending, accepted, or revoked.",
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async () => {
      const invites = await client.peers.listInvites();
      return { content: [{ type: "text", text: JSON.stringify({ invites }) }] };
    }
  );
  server.registerTool(
    "haszno_peers_invite_accept",
    {
      title: "Accept peer invite",
      description: "Accepts a peer invite code, establishing a partner link between your shop and the inviting supplier's catalogue. After acceptance you can browse and import products from that supplier's catalogue. Requires confirm=true. The code is single-use and invalidated after acceptance. Returns the created PeerLink: { id, supplierId, partner, createdAt }.",
      inputSchema: {
        code: z10.string().min(1).describe('Invite code received from the partner (e.g. "abc123xyz")'),
        acceptorId: z10.string().min(1).max(120).describe("Your shop/tenant identifier (the accepting party)"),
        confirm: z10.boolean().describe("Must be true to accept \u2014 set false for a preview/dry-run response")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      if (!args.confirm) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              preview: true,
              message: `Elfogadod a(z) "${args.code}" k\xF3d\xFA megh\xEDv\xF3t "${args.acceptorId}" nev\xE9ben. Add meg confirm: true a val\xF3s elfogad\xE1shoz.`
            })
          }]
        };
      }
      const link = await client.peers.acceptInvite(args.code, { acceptorId: args.acceptorId });
      return { content: [{ type: "text", text: JSON.stringify(link) }] };
    }
  );
}

// src/tools/blog.ts
import { z as z11 } from "zod";
function registerBlogTools(server, client) {
  server.registerTool(
    "haszno_blog_latest",
    {
      title: "Latest Haszno market blog post",
      description: 'Returns the latest published Haszno market insight blog post(s). Posts contain aggregated market trends from the Haszno dropshipping network. period: "het" (weekly summary) or "honap" (monthly summary). Each post includes: title, summary, bodyMd (Markdown), period, periodStart/End, publishedAt, and optional data with rankedCategories / rankedProducts / shopsCount. All data is anonymised aggregate from >= 5 shops \u2014 no per-shop information. Returns the most recent N posts matching the period filter.',
      inputSchema: {
        period: z11.enum(["het", "honap"]).optional().describe('"het" for weekly, "honap" for monthly posts. Omit to get both.'),
        limit: z11.number().int().min(1).max(10).optional().describe("Maximum posts to return (default 1)")
      },
      annotations: { readOnlyHint: true }
    },
    async (args) => {
      const limit = args.limit ?? 1;
      const result = await client.blog.list({
        period: args.period,
        page: 1,
        perPage: limit
      });
      const posts = result.posts.slice(0, limit);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ posts, total: result.total })
        }]
      };
    }
  );
}

// src/tools/shop.ts
import * as fs2 from "fs";
import { z as z12 } from "zod";
function json2(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
function mkErr2(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}
function mapApiError(e, context) {
  if (e instanceof HasznoApiError) {
    const extra = e.status === 400 ? " (\xE9rv\xE9nytelen k\xE9r\xE9s \u2014 ellen\u0151rizd a k\xF6telez\u0151 mez\u0151ket)" : e.status === 401 ? " (hiteles\xEDt\xE9s sz\xFCks\xE9ges \u2014 ellen\u0151rizd a tokenedet)" : e.status === 403 ? " (nincs jogosults\xE1god ehhez a m\u0171velethez)" : e.status === 404 ? " (nem tal\xE1lhat\xF3)" : e.status === 409 ? " (\xFCtk\xF6z\xE9s \u2014 olvass r\xE1 a hiba\xFCzenetre)" : e.status === 422 ? " (feldolgoz\xE1si hiba)" : e.status === 429 ? " (t\xFAl sok k\xE9r\xE9s \u2014 pr\xF3b\xE1ld \xFAjra k\xE9s\u0151bb)" : "";
    return mkErr2(`${context}: [${e.status}] ${e.message}${extra}`);
  }
  return mkErr2(`${context}: ${String(e)}`);
}
function buildBearerHeaders(opts) {
  const key = opts.apiKey ?? process.env["HASZNO_API_TOKEN"] ?? process.env["HASZNO_API_KEY"] ?? process.env["ARFUTAR_API_KEY"];
  const headers = {
    Accept: "application/json",
    "User-Agent": "haszno-mcp/0.2.0"
  };
  if (key) {
    if (key.startsWith(SHOP_TOKEN_PREFIX)) headers["Authorization"] = `Bearer ${key}`;
    else headers["x-api-key"] = key;
  } else {
    const basic = opts.basicAuth ?? process.env["HASZNO_BASIC"] ?? process.env["ARFUTAR_BASIC"];
    if (basic) {
      headers["Authorization"] = `Basic ${Buffer.from(basic).toString("base64")}`;
    }
  }
  return headers;
}
async function uploadMultipart(path3, formData, opts) {
  const baseUrl = (opts.baseUrl ?? process.env["HASZNO_API_URL"] ?? process.env["ARFUTAR_API_URL"] ?? "https://haszno.com").replace(/\/$/, "");
  const fetchFn = opts.fetch ?? fetch;
  const response = await fetchFn(`${baseUrl}${path3}`, {
    method: "POST",
    headers: buildBearerHeaders(opts),
    body: formData
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const data = await response.json();
      if (data.error) message = data.error;
    } catch {
    }
    throw new HasznoApiError(response.status, message);
  }
  const text = await response.text();
  if (!text) return void 0;
  return JSON.parse(text);
}
async function validateCategoryAttributes(categoryId, suppliedAttributes, opts) {
  let categories;
  try {
    categories = await get("/api/v1/shop/categories", opts);
  } catch {
    return null;
  }
  if (!Array.isArray(categories)) return null;
  const cat = categories.find((c) => c.id === categoryId);
  if (!cat || !cat.attributes) return null;
  const missing = cat.attributes.filter((a) => a.required && !(a.name in suppliedAttributes)).map((a) => a.name);
  if (missing.length === 0) return null;
  return `Hi\xE1nyz\xF3 k\xF6telez\u0151 kateg\xF3ria-attrib\xFAtumok a "${cat.name}" kateg\xF3ri\xE1hoz: ` + missing.join(", ") + ". T\xF6ltsd ki ezeket az attributes mez\u0151be, majd pr\xF3b\xE1ld \xFAjra.";
}
function registerShopTools(server, opts) {
  server.registerTool(
    "haszno_shop_list_categories",
    {
      title: "List shop categories",
      description: 'Returns the full category taxonomy of the Haszno Hirdet\xE9si Piact\xE9r (marketplace). Each category may include "attributes" \u2014 the fields required (or optional) when posting an ad in that category. Call this before haszno_shop_create_ad to identify the correct categoryId and required attribute keys. The Haszno Shop is completely free \u2014 there are no listing or usage fees.',
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async () => {
      try {
        const result = await get("/api/v1/shop/categories", opts);
        return json2(result);
      } catch (e) {
        return mapApiError(e, "list_categories");
      }
    }
  );
  server.registerTool(
    "haszno_shop_search_ads",
    {
      title: "Search public ads",
      description: 'Searches the public Haszno Hirdet\xE9si Piact\xE9r (marketplace) for second-hand ads. Returns a paginated list of ads including their id, title, priceGross (HUF), status, images, and a "reserved" flag (true when an accepted reservation exists for the ad). The Shop is free \u2014 no fees for browsing or contacting sellers. Filter by category with categoryId, full-text search with q, price range with minPrice/maxPrice.',
      inputSchema: {
        q: z12.string().optional().describe("Full-text search query"),
        categoryId: z12.number().int().min(1).optional().describe("Filter by category ID"),
        minPrice: z12.number().int().min(0).optional().describe("Minimum price in HUF gross"),
        maxPrice: z12.number().int().min(0).optional().describe("Maximum price in HUF gross"),
        page: z12.number().int().min(1).optional().describe("Page number (default 1, page size 20)"),
        sort: z12.enum(["newest", "price_asc", "price_desc"]).optional().describe("Sort order")
      },
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async (args) => {
      try {
        const qs = new URLSearchParams();
        if (args.q) qs.set("q", args.q);
        if (args.categoryId != null) qs.set("categoryId", String(args.categoryId));
        if (args.minPrice != null) qs.set("minPrice", String(args.minPrice));
        if (args.maxPrice != null) qs.set("maxPrice", String(args.maxPrice));
        if (args.page != null) qs.set("page", String(args.page));
        if (args.sort) qs.set("sort", args.sort);
        const suffix = qs.toString() ? `?${qs}` : "";
        const result = await get(`/api/v1/shop/ads${suffix}`, opts);
        return json2(result);
      } catch (e) {
        return mapApiError(e, "search_ads");
      }
    }
  );
  server.registerTool(
    "haszno_shop_get_ad",
    {
      title: "Get a single ad",
      description: 'Fetches the full detail of a Haszno marketplace ad by its ID. Returns all fields including images, attributes, seller info, and the "reserved" flag (true when an accepted reservation exists). The Shop is free \u2014 browsing and contacting sellers costs nothing.',
      inputSchema: {
        id: z12.number().int().min(1).describe("Ad ID")
      },
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async (args) => {
      try {
        const result = await get(`/api/v1/shop/ads/${args.id}`, opts);
        return json2(result);
      } catch (e) {
        return mapApiError(e, "get_ad");
      }
    }
  );
  server.registerTool(
    "haszno_shop_price_hint",
    {
      title: "Get a suggested price hint",
      description: "Returns a suggested asking price for an item based on the category and optional keyword. The hint is derived from recent sold and active listings in the same category. Use this before calling haszno_shop_create_ad to set a realistic priceGross.",
      inputSchema: {
        categoryId: z12.number().int().min(1).optional().describe("Category ID for the hint"),
        q: z12.string().optional().describe("Item description or keywords to refine the hint")
      },
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async (args) => {
      try {
        const qs = new URLSearchParams();
        if (args.categoryId != null) qs.set("categoryId", String(args.categoryId));
        if (args.q) qs.set("q", args.q);
        const suffix = qs.toString() ? `?${qs}` : "";
        const result = await get(`/api/v1/shop/ads/price-hint${suffix}`, opts);
        return json2(result);
      } catch (e) {
        return mapApiError(e, "price_hint");
      }
    }
  );
  server.registerTool(
    "haszno_shop_list_my_ads",
    {
      title: "List my own ads",
      description: `Returns the authenticated user's own marketplace ads. Filter by status: "aktiv" (live), "fuggeszetett" (paused), "eladva" (sold), "lejart" (expired). Each entry includes id, title, priceGross, status, images, reserved flag, and stats (views, inquiries). Requires authentication (Bearer token or session).`,
      inputSchema: {
        status: z12.enum(["aktiv", "fuggeszetett", "eladva", "lejart"]).optional().describe("Filter by ad status"),
        page: z12.number().int().min(1).optional().describe("Page number (default 1)")
      },
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async (args) => {
      try {
        const qs = new URLSearchParams();
        if (args.status) qs.set("status", args.status);
        if (args.page != null) qs.set("page", String(args.page));
        const suffix = qs.toString() ? `?${qs}` : "";
        const result = await get(`/api/v1/shop/my/ads${suffix}`, opts);
        return json2(result);
      } catch (e) {
        return mapApiError(e, "list_my_ads");
      }
    }
  );
  server.registerTool(
    "haszno_shop_list_inquiries",
    {
      title: "List inquiries on my ads",
      description: "Returns messages/questions sent to your ads by potential buyers. Optionally filter by adId to see inquiries for a specific ad. Requires authentication.",
      inputSchema: {
        adId: z12.number().int().min(1).optional().describe("Filter by a specific ad ID"),
        page: z12.number().int().min(1).optional().describe("Page number (default 1)")
      },
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async (args) => {
      try {
        const qs = new URLSearchParams();
        if (args.adId != null) qs.set("adId", String(args.adId));
        if (args.page != null) qs.set("page", String(args.page));
        const suffix = qs.toString() ? `?${qs}` : "";
        const result = await get(`/api/v1/shop/my/inquiries${suffix}`, opts);
        return json2(result);
      } catch (e) {
        return mapApiError(e, "list_inquiries");
      }
    }
  );
  server.registerTool(
    "haszno_shop_list_favorites",
    {
      title: "List my saved favorites",
      description: "Returns the ads the authenticated user has saved as favorites. Requires authentication.",
      inputSchema: {
        page: z12.number().int().min(1).optional().describe("Page number (default 1)")
      },
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async (args) => {
      try {
        const qs = new URLSearchParams();
        if (args.page != null) qs.set("page", String(args.page));
        const suffix = qs.toString() ? `?${qs}` : "";
        const result = await get(`/api/v1/shop/my/favorites${suffix}`, opts);
        return json2(result);
      } catch (e) {
        return mapApiError(e, "list_favorites");
      }
    }
  );
  server.registerTool(
    "haszno_shop_list_reservations",
    {
      title: "List my reservations",
      description: `Returns reservations for the authenticated user. Use role="buyer" (default) to list reservations YOU placed on other people's ads. Use role="seller" to list reservations buyers placed on YOUR ads. Status values: "fuggoben" (pending), "elfogadva" (accepted), "elutasitva" (declined/auto-declined), "lemondva" (cancelled by buyer), "teljesitve" (completed), "lejart" (hold expired). Contact fields (phone, email) are only filled in when status is "elfogadva" or "teljesitve". Reserving is not paying \u2014 payment and handover happen directly between buyer and seller.`,
      inputSchema: {
        role: z12.enum(["buyer", "seller"]).optional().describe('Whose perspective: "buyer" (default) or "seller"'),
        status: z12.string().optional().describe("Filter by reservation status"),
        page: z12.number().int().min(1).optional().describe("Page number (default 1)")
      },
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async (args) => {
      try {
        const qs = new URLSearchParams();
        if (args.role) qs.set("role", args.role);
        if (args.status) qs.set("status", args.status);
        if (args.page != null) qs.set("page", String(args.page));
        const suffix = qs.toString() ? `?${qs}` : "";
        const result = await get(`/api/v1/shop/my/reservations${suffix}`, opts);
        return json2(result);
      } catch (e) {
        return mapApiError(e, "list_reservations");
      }
    }
  );
  server.registerTool(
    "haszno_shop_upload_image",
    {
      title: "Upload an ad image",
      description: 'Uploads an image for use in a Haszno marketplace ad. Provide either an absolute local file path ("filePath") OR a base64-encoded image with its MIME type ("base64" + "mimeType"). Returns an "url" field \u2014 pass this URL in the "images" array of haszno_shop_create_ad or haszno_shop_update_ad. Supported MIME types: image/jpeg, image/png, image/webp. The Haszno Shop is free \u2014 no fees for uploading images.',
      inputSchema: {
        filePath: z12.string().optional().describe(
          "Absolute path to a local image file (e.g. /home/user/photo.jpg). Provide this OR base64/mimeType."
        ),
        base64: z12.string().optional().describe(
          "Base64-encoded image data (without the data: URI prefix). Provide together with mimeType."
        ),
        mimeType: z12.string().optional().describe(
          "MIME type for base64 input: image/jpeg, image/png, or image/webp."
        )
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      if (!args.filePath && !args.base64) {
        return mkErr2("Adj meg vagy filePath-t (abszol\xFAt f\xE1jl\xFAtvonal) vagy base64 + mimeType p\xE1rt.");
      }
      if (args.base64 && !args.mimeType) {
        return mkErr2("base64 megad\xE1sakor mimeType is sz\xFCks\xE9ges (pl. image/jpeg).");
      }
      const ALLOWED_EXTS = /* @__PURE__ */ new Set(["jpg", "jpeg", "png", "webp"]);
      const ALLOWED_MIMES = /* @__PURE__ */ new Set(["image/jpeg", "image/png", "image/webp"]);
      const MAX_SIZE_BYTES = 20 * 1024 * 1024;
      function detectMimeFromBytes(buf) {
        if (buf.length < 4) return null;
        if (buf[0] === 255 && buf[1] === 216 && buf[2] === 255) return "image/jpeg";
        if (buf[0] === 137 && buf[1] === 80 && buf[2] === 78 && buf[3] === 71) return "image/png";
        if (buf.length >= 12 && buf[0] === 82 && buf[1] === 73 && buf[2] === 70 && buf[3] === 70 && buf[8] === 87 && buf[9] === 69 && buf[10] === 66 && buf[11] === 80) {
          return "image/webp";
        }
        return null;
      }
      let blob;
      let filename;
      if (args.filePath) {
        const ext = args.filePath.split(".").pop()?.toLowerCase() ?? "";
        if (!ALLOWED_EXTS.has(ext)) {
          return mkErr2(`Csak JPEG, PNG \xE9s WebP f\xE1jlok t\xF6lthet\u0151k fel (kapott kiterjeszt\xE9s: .${ext || "ismeretlen"}).`);
        }
        let buffer;
        try {
          buffer = fs2.readFileSync(args.filePath);
        } catch (e) {
          return mkErr2(`Nem siker\xFClt beolvasni a f\xE1jlt: ${String(e)}`);
        }
        if (buffer.length > MAX_SIZE_BYTES) {
          return mkErr2(`A f\xE1jl m\xE9rete (${(buffer.length / 1024 / 1024).toFixed(1)} MB) meghaladja a 20 MB-os hat\xE1rt.`);
        }
        const detectedMime = detectMimeFromBytes(buffer);
        if (!detectedMime) {
          return mkErr2("A f\xE1jl nem felismerhet\u0151 k\xE9pform\xE1tum (JPEG, PNG vagy WebP sz\xFCks\xE9ges).");
        }
        const extMime = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
        if (detectedMime !== extMime[ext]) {
          return mkErr2(`A f\xE1jl tartalma (${detectedMime}) nem egyezik a kiterjeszt\xE9ssel (.${ext}).`);
        }
        blob = new Blob([buffer], { type: detectedMime });
        filename = args.filePath.split("/").pop() ?? "image";
      } else {
        const declaredMime = args.mimeType;
        if (!ALLOWED_MIMES.has(declaredMime)) {
          return mkErr2(`Nem t\xE1mogatott MIME t\xEDpus: ${declaredMime}. Csak image/jpeg, image/png \xE9s image/webp elfogadott.`);
        }
        let buffer;
        try {
          buffer = Buffer.from(args.base64, "base64");
        } catch (e) {
          return mkErr2(`\xC9rv\xE9nytelen base64 adat: ${String(e)}`);
        }
        if (buffer.length > MAX_SIZE_BYTES) {
          return mkErr2(`A k\xE9p m\xE9rete (${(buffer.length / 1024 / 1024).toFixed(1)} MB) meghaladja a 20 MB-os hat\xE1rt.`);
        }
        const detectedMime = detectMimeFromBytes(buffer);
        if (!detectedMime) {
          return mkErr2("A base64 adat nem felismerhet\u0151 k\xE9pform\xE1tum (JPEG, PNG vagy WebP sz\xFCks\xE9ges).");
        }
        if (detectedMime !== declaredMime) {
          return mkErr2(`A k\xE9p val\xF3di form\xE1tuma (${detectedMime}) nem egyezik a megadott mimeType \xE9rt\xE9kkel (${declaredMime}).`);
        }
        blob = new Blob([buffer], { type: declaredMime });
        const extMap = {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/webp": "webp"
        };
        filename = `upload.${extMap[declaredMime] ?? "bin"}`;
      }
      const formData = new FormData();
      formData.append("image", blob, filename);
      try {
        const result = await uploadMultipart("/api/v1/shop/my/images", formData, opts);
        return json2(result);
      } catch (e) {
        return mapApiError(e, "upload_image");
      }
    }
  );
  server.registerTool(
    "haszno_shop_suggest_from_photos",
    {
      title: "AI pre-fill ad from uploaded photos",
      description: "Sends uploaded image URLs to the Haszno AI to generate a suggested ad title, description, category, price, and category-specific attributes. Upload images first with haszno_shop_upload_image to get the URLs, then pass them here. The result is a suggestion only \u2014 review it before passing it to haszno_shop_create_ad.",
      inputSchema: {
        imageUrls: z12.array(z12.string().url()).min(1).max(5).describe(
          "Image URLs from haszno_shop_upload_image (1\u20135 URLs)"
        )
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const result = await post("/api/v1/shop/my/ads/suggest", { imageUrls: args.imageUrls }, opts);
        return json2(result);
      } catch (e) {
        return mapApiError(e, "suggest_from_photos");
      }
    }
  );
  server.registerTool(
    "haszno_shop_create_ad",
    {
      title: "Post a new marketplace ad",
      description: "Creates a new Haszno Hirdet\xE9si Piact\xE9r (marketplace) ad. This is a REAL action \u2014 the ad becomes immediately visible to all users on haszno.com. Only call this when the user has explicitly confirmed they want to post the ad. The Haszno Shop is completely free \u2014 there are no listing fees. Before calling this tool: (1) call haszno_shop_list_categories to find the right categoryId and its required attributes; (2) call haszno_shop_upload_image for each photo and collect the returned URLs; (3) call haszno_shop_price_hint to suggest a priceGross. This tool validates required category attributes before sending \u2014 if any are missing it will tell you exactly what is needed.",
      inputSchema: {
        title: z12.string().min(3).max(200).describe("Ad title (3\u2013200 characters)"),
        description: z12.string().max(5e3).optional().describe("Ad description (optional, max 5000 chars)"),
        priceGross: z12.number().int().min(1).describe("Asking price in HUF gross"),
        categoryId: z12.number().int().min(1).describe("Category ID from haszno_shop_list_categories"),
        attributes: z12.record(z12.string(), z12.unknown()).optional().describe(
          'Category-specific attributes (e.g. { "condition": "hasznalt", "brand": "Samsung" }). Required attributes depend on the category \u2014 call haszno_shop_list_categories to see them.'
        ),
        images: z12.array(z12.string().url()).max(10).optional().describe(
          "Image URLs from haszno_shop_upload_image (max 10)"
        ),
        phone: z12.string().max(50).optional().describe("Contact phone number"),
        showPhone: z12.boolean().optional().describe("Whether to display the phone number publicly (default false)"),
        confirm: z12.literal(true).describe(
          "Must be exactly true. This posts a real, public ad \u2014 only set this after the user confirms."
        )
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      const attrs = args.attributes ?? {};
      const validationError = await validateCategoryAttributes(args.categoryId, attrs, opts);
      if (validationError) {
        return mkErr2(validationError);
      }
      const body = {
        title: args.title,
        description: args.description,
        priceGross: args.priceGross,
        categoryId: args.categoryId,
        attributes: args.attributes,
        images: args.images,
        phone: args.phone,
        showPhone: args.showPhone
      };
      try {
        const result = await post("/api/v1/shop/my/ads", body, opts);
        return json2(result);
      } catch (e) {
        return mapApiError(e, "create_ad");
      }
    }
  );
  server.registerTool(
    "haszno_shop_update_ad",
    {
      title: "Update an existing ad",
      description: "Updates the fields of an existing Haszno marketplace ad. Only pass the fields you want to change \u2014 omitted fields remain unchanged. The ad must belong to the authenticated user. The Haszno Shop is free.",
      inputSchema: {
        id: z12.number().int().min(1).describe("Ad ID to update"),
        title: z12.string().min(3).max(200).optional(),
        description: z12.string().max(5e3).optional(),
        priceGross: z12.number().int().min(1).optional().describe("New asking price in HUF gross"),
        attributes: z12.record(z12.string(), z12.unknown()).optional(),
        images: z12.array(z12.string().url()).max(10).optional(),
        phone: z12.string().max(50).optional(),
        showPhone: z12.boolean().optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      const { id, ...body } = args;
      try {
        const result = await patch(`/api/v1/shop/my/ads/${id}`, body, opts);
        return json2(result);
      } catch (e) {
        return mapApiError(e, "update_ad");
      }
    }
  );
  server.registerTool(
    "haszno_shop_set_ad_status",
    {
      title: "Pause or activate an ad",
      description: `Changes an ad's visibility. "fuggeszetett" hides the ad from public search (paused); "aktiv" makes it visible again. The ad must belong to the authenticated user.`,
      inputSchema: {
        id: z12.number().int().min(1).describe("Ad ID"),
        status: z12.enum(["aktiv", "fuggeszetett"]).describe('"aktiv" to show, "fuggeszetett" to hide')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/my/ads/${args.id}/status`, { status: args.status }, opts);
        return json2(result);
      } catch (e) {
        return mapApiError(e, "set_ad_status");
      }
    }
  );
  server.registerTool(
    "haszno_shop_mark_sold",
    {
      title: "Mark an ad as sold",
      description: 'Marks an ad as sold ("eladva"), removing it from public search. This is IRREVERSIBLE \u2014 a sold ad cannot be re-activated. Only call this when the user confirms the item has been sold. Side effect: all open reservations for this ad become "elutasitva" (declined). The Haszno Shop is free \u2014 there are no sales fees.',
      inputSchema: {
        id: z12.number().int().min(1).describe("Ad ID"),
        soldPriceGross: z12.number().int().min(1).optional().describe(
          "Actual sale price in HUF gross (optional, for your records)"
        ),
        confirm: z12.literal(true).describe(
          "Must be exactly true. This permanently marks the ad as sold."
        )
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }
    },
    async (args) => {
      try {
        const body = {};
        if (args.soldPriceGross != null) body["soldPriceGross"] = args.soldPriceGross;
        const result = await post(`/api/v1/shop/my/ads/${args.id}/sold`, body, opts);
        return json2(result);
      } catch (e) {
        return mapApiError(e, "mark_sold");
      }
    }
  );
  server.registerTool(
    "haszno_shop_renew_ad",
    {
      title: "Renew / bump an ad",
      description: "Renews an ad, resetting its expiry timer and bumping it back to the top of search results. Use this for ads that are about to expire or have fallen in ranking. The Haszno Shop is free \u2014 renewal has no cost.",
      inputSchema: {
        id: z12.number().int().min(1).describe("Ad ID to renew")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/my/ads/${args.id}/renew`, {}, opts);
        return json2(result);
      } catch (e) {
        return mapApiError(e, "renew_ad");
      }
    }
  );
  server.registerTool(
    "haszno_shop_send_inquiry",
    {
      title: "Send an inquiry to the seller",
      description: "Sends a message or question to the seller of an ad. The seller will be notified and can respond through Haszno. The Haszno Shop is free.",
      inputSchema: {
        adId: z12.number().int().min(1).describe("Ad ID to send the inquiry to"),
        message: z12.string().min(1).max(2e3).describe("Your message or question for the seller")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/ads/${args.adId}/inquiries`, { message: args.message }, opts);
        return json2(result);
      } catch (e) {
        return mapApiError(e, "send_inquiry");
      }
    }
  );
  server.registerTool(
    "haszno_shop_set_favorite",
    {
      title: "Save or remove a favorite",
      description: "Saves or removes an ad from your favorites list. Set save=true to add to favorites, save=false to remove. The Haszno Shop is free.",
      inputSchema: {
        adId: z12.number().int().min(1).describe("Ad ID"),
        save: z12.boolean().describe("true to save as favorite, false to remove")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async (args) => {
      try {
        let result;
        if (args.save) {
          result = await post(`/api/v1/shop/ads/${args.adId}/favorites`, {}, opts);
        } else {
          result = await del(`/api/v1/shop/ads/${args.adId}/favorites`, opts);
        }
        return json2(result);
      } catch (e) {
        return mapApiError(e, "set_favorite");
      }
    }
  );
  server.registerTool(
    "haszno_shop_reserve_ad",
    {
      title: "Place a reservation on an ad",
      description: "Places a reservation on a Haszno marketplace ad. This is a REAL action visible to the seller immediately \u2014 only call this when the user has explicitly confirmed they want to reserve this item. IMPORTANT: Reserving is NOT paying. Payment and handover happen directly between buyer and seller outside Haszno \u2014 the platform only facilitates the initial contact. The Haszno Shop is completely free \u2014 no reservation fees. You may optionally include a message, a counter-offer price (offerPriceGross), and your phone number. The seller will accept or decline the reservation. Returns error 409 if you already have an open reservation for this ad.",
      inputSchema: {
        adId: z12.number().int().min(1).describe("Ad ID to reserve"),
        message: z12.string().max(1e3).optional().describe("Optional message to the seller (max 1000 chars)"),
        offerPriceGross: z12.number().int().min(1).optional().describe(
          "Counter-offer price in HUF gross (optional \u2014 omit to accept the listed price)"
        ),
        phone: z12.string().max(50).optional().describe(
          "Your phone number (optional; revealed to the seller only if they accept)"
        ),
        confirm: z12.literal(true).describe(
          "Must be exactly true. This sends a real reservation request to the seller."
        )
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      const body = {};
      if (args.message) body["message"] = args.message;
      if (args.offerPriceGross != null) body["offerPriceGross"] = args.offerPriceGross;
      if (args.phone) body["phone"] = args.phone;
      try {
        const result = await post(`/api/v1/shop/ads/${args.adId}/reservations`, body, opts);
        return json2(result);
      } catch (e) {
        return mapApiError(e, "reserve_ad");
      }
    }
  );
  server.registerTool(
    "haszno_shop_respond_reservation",
    {
      title: "Accept or decline a reservation (seller)",
      description: `Accepts or declines a pending reservation on one of your ads (seller action). action="accept": marks the reservation as "elfogadva" (accepted); the buyer's contact details become visible to you in the reservation. You may optionally set a heldUntil deadline (ISO-8601) by which the buyer must complete the purchase. action="decline": marks the reservation as "elutasitva" (declined); the ad remains active for other buyers. The Haszno Shop is free \u2014 accepting a reservation does NOT create a payment.`,
      inputSchema: {
        id: z12.number().int().min(1).describe("Reservation ID"),
        action: z12.enum(["accept", "decline"]).describe('"accept" or "decline"'),
        heldUntil: z12.string().datetime().optional().nullable().describe(
          "Optional ISO-8601 deadline for the buyer to complete the deal (accept only)"
        )
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const path3 = `/api/v1/shop/my/reservations/${args.id}/${args.action}`;
        const body = {};
        if (args.action === "accept" && args.heldUntil !== void 0) {
          body["heldUntil"] = args.heldUntil;
        }
        const result = await post(path3, body, opts);
        return json2(result);
      } catch (e) {
        return mapApiError(e, `respond_reservation(${args.action})`);
      }
    }
  );
  server.registerTool(
    "haszno_shop_cancel_reservation",
    {
      title: "Cancel your reservation (buyer)",
      description: 'Cancels a reservation you placed as a buyer (status becomes "lemondva"). Only pending ("fuggoben") or accepted ("elfogadva") reservations can be cancelled. The Haszno Shop is free \u2014 cancellation has no cost.',
      inputSchema: {
        id: z12.number().int().min(1).describe("Reservation ID to cancel")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/my/reservations/${args.id}/cancel`, {}, opts);
        return json2(result);
      } catch (e) {
        return mapApiError(e, "cancel_reservation");
      }
    }
  );
  server.registerTool(
    "haszno_shop_complete_reservation",
    {
      title: "Complete a reservation (seller)",
      description: 'Marks a reservation as completed ("teljesitve"), confirming that the item has changed hands. This is a REAL, IRREVERSIBLE action \u2014 only call it when the user confirms the sale is done. Side effects: (1) the ad status changes to "eladva" (sold) and disappears from search; (2) all other open reservations for the same ad are automatically declined. Optionally record the actual sold price (soldPriceGross) for your records \u2014 it is not shared publicly. REMINDER: Payment and handover happen directly between buyer and seller \u2014 Haszno does not process payments. The Haszno Shop is free \u2014 no commission on completed deals.',
      inputSchema: {
        id: z12.number().int().min(1).describe("Reservation ID"),
        soldPriceGross: z12.number().int().min(1).optional().nullable().describe(
          "Actual sale price in HUF gross (optional, for your records only)"
        ),
        confirm: z12.literal(true).describe(
          "Must be exactly true. This irreversibly marks the ad as sold."
        )
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }
    },
    async (args) => {
      const body = {};
      if (args.soldPriceGross !== void 0) body["soldPriceGross"] = args.soldPriceGross;
      try {
        const result = await post(`/api/v1/shop/my/reservations/${args.id}/complete`, body, opts);
        return json2(result);
      } catch (e) {
        return mapApiError(e, "complete_reservation");
      }
    }
  );
}

// src/index.ts
function readHasznoConfig() {
  const candidates = [
    path2.join(os2.homedir(), ".config", "haszno", "config.json"),
    path2.join(os2.homedir(), ".config", "arfutar", "config.json")
  ];
  for (const file of candidates) {
    try {
      if (fs3.existsSync(file)) {
        return JSON.parse(fs3.readFileSync(file, "utf8"));
      }
    } catch {
    }
  }
  return {};
}
async function main() {
  const envApiKey = process.env["HASZNO_API_TOKEN"] ?? process.env["HASZNO_API_KEY"] ?? process.env["ARFUTAR_API_KEY"];
  const envApiUrl = process.env["HASZNO_API_URL"] ?? process.env["ARFUTAR_API_URL"];
  const envBasic = process.env["HASZNO_BASIC"] ?? process.env["ARFUTAR_BASIC"];
  let apiKey = envApiKey;
  let apiUrl = envApiUrl;
  let basicAuth = envBasic;
  if (!apiKey && !basicAuth) {
    const config = readHasznoConfig();
    if (!apiKey) apiKey = config.apiKey;
    if (!basicAuth) basicAuth = config.basicAuth;
    if (!apiUrl) apiUrl = config.apiUrl;
  }
  const httpOpts = { apiKey, basicAuth, baseUrl: apiUrl };
  const client = createClient(httpOpts);
  const server = new McpServer({
    name: "haszno",
    version: "0.1.0"
  });
  registerCatalogTools(server, client);
  registerProductsTools(server, client);
  registerProposalsTools(server, client);
  registerRulesTools(server, client);
  registerOrdersTools(server, client);
  registerIdeasTools(server, client);
  registerFeedsTools(server, client);
  registerAccountTools(server, client);
  registerCatalogueTools(server, client);
  registerConnectionsTools(server, client);
  registerPeersTools(server, client);
  registerBlogTools(server, client);
  registerShopTools(server, httpOpts);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main().catch((err2) => {
  console.error("haszno-mcp fatal error:", err2);
  process.exit(1);
});
//# sourceMappingURL=index.js.map