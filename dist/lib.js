// src/tools/shop.ts
import * as fs from "fs";
import { z } from "zod";

// src/client/error.ts
var HasznoApiError = class extends Error {
  constructor(status, message, code, requestId) {
    super(message);
    this.status = status;
    this.name = "HasznoApiError";
    this.code = code;
    this.requestId = requestId;
  }
  status;
  /**
   * Machine-readable error code from the API error envelope
   * (e.g. "unauthenticated", "forbidden", "invalid_request", "conflict",
   * "rate_limited"). Undefined when the response body was not parseable.
   */
  code;
  /**
   * Request-ID echoed from the X-Request-Id response header or the
   * requestId field in the error envelope. Pass this to support when
   * reporting a problem. Undefined when not supplied by the server.
   */
  requestId;
};

// src/client/http.ts
var SHOP_TOKEN_PREFIX = "haszno_";
function isShopToken(key) {
  return !!key?.startsWith(SHOP_TOKEN_PREFIX);
}
function buildAuthHeader(opts) {
  const key = opts.noEnvFallback ? opts.apiKey : opts.apiKey ?? process.env["HASZNO_API_TOKEN"] ?? process.env["HASZNO_API_KEY"] ?? process.env["ARFUTAR_API_KEY"];
  if (key) {
    if (isShopToken(key)) return { Authorization: `Bearer ${key}` };
    return { "x-api-key": key };
  }
  const basic = opts.noEnvFallback ? opts.basicAuth : opts.basicAuth ?? process.env["HASZNO_BASIC"] ?? process.env["ARFUTAR_BASIC"];
  if (basic) {
    const encoded = Buffer.from(basic).toString("base64");
    return { Authorization: `Basic ${encoded}` };
  }
  return {};
}
async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function request(method, path, body, opts) {
  const baseUrl = (opts.baseUrl ?? (opts.noEnvFallback ? void 0 : process.env["HASZNO_API_URL"] ?? process.env["ARFUTAR_API_URL"]) ?? "https://haszno.com").replace(/\/$/, "");
  const url = `${baseUrl}${path}`;
  const fetchFn = opts.fetch ?? fetch;
  const maxRetries = opts.maxRetries ?? 3;
  const retryDelayMs = opts.retryDelayMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 3e4;
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "haszno-mcp/0.4.0",
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
    } catch (err) {
      lastError = err;
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
      let code;
      let requestId = response.headers.get("x-request-id") ?? void 0;
      try {
        const json2 = await response.json();
        if (json2.error) message = json2.error;
        if (json2.code) code = json2.code;
        if (json2.requestId) requestId = json2.requestId;
      } catch {
      }
      throw new HasznoApiError(response.status, message, code, requestId);
    }
    const text = await response.text();
    if (!text) return void 0;
    return JSON.parse(text);
  }
  if (lastError instanceof HasznoApiError) throw lastError;
  throw new Error(`Network error after ${maxRetries} attempts: ${String(lastError)}`);
}
function get(path, opts) {
  return request("GET", path, void 0, opts);
}
function post(path, body, opts) {
  return request("POST", path, body, opts);
}
function put(path, body, opts) {
  return request("PUT", path, body, opts);
}
function del(path, opts) {
  return request("DELETE", path, void 0, opts);
}

// src/tools/shop.ts
function json(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
function mkErr(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}
function mapApiError(e, context) {
  if (e instanceof HasznoApiError) {
    const extra = e.status === 400 ? " (\xE9rv\xE9nytelen k\xE9r\xE9s \u2014 ellen\u0151rizd a k\xF6telez\u0151 mez\u0151ket)" : e.status === 401 ? " (hiteles\xEDt\xE9s sz\xFCks\xE9ges \u2014 ellen\u0151rizd a tokenedet)" : e.status === 403 ? " (nincs jogosults\xE1god ehhez a m\u0171velethez)" : e.status === 404 ? " (nem tal\xE1lhat\xF3)" : e.status === 409 ? " (\xFCtk\xF6z\xE9s \u2014 olvass r\xE1 a hiba\xFCzenetre)" : e.status === 422 ? " (feldolgoz\xE1si hiba)" : e.status === 429 ? " (t\xFAl sok k\xE9r\xE9s \u2014 pr\xF3b\xE1ld \xFAjra k\xE9s\u0151bb)" : "";
    return mkErr(`${context}: [${e.status}] ${e.message}${extra}`);
  }
  return mkErr(`${context}: ${String(e)}`);
}
function buildBearerHeaders(opts) {
  const key = opts.noEnvFallback ? opts.apiKey : opts.apiKey ?? process.env["HASZNO_API_TOKEN"] ?? process.env["HASZNO_API_KEY"] ?? process.env["ARFUTAR_API_KEY"];
  const headers = {
    Accept: "application/json",
    "User-Agent": "haszno-mcp/0.4.0"
  };
  if (key) {
    if (key.startsWith(SHOP_TOKEN_PREFIX)) headers["Authorization"] = `Bearer ${key}`;
    else headers["x-api-key"] = key;
  } else {
    const basic = opts.noEnvFallback ? opts.basicAuth : opts.basicAuth ?? process.env["HASZNO_BASIC"] ?? process.env["ARFUTAR_BASIC"];
    if (basic) {
      headers["Authorization"] = `Basic ${Buffer.from(basic).toString("base64")}`;
    }
  }
  return headers;
}
async function uploadRawBinary(path, bytes, mimeType, opts) {
  const baseUrl = (opts.baseUrl ?? (opts.noEnvFallback ? void 0 : process.env["HASZNO_API_URL"] ?? process.env["ARFUTAR_API_URL"]) ?? "https://haszno.com").replace(/\/$/, "");
  const fetchFn = opts.fetch ?? fetch;
  const response = await fetchFn(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      ...buildBearerHeaders(opts),
      "Content-Type": mimeType
    },
    body: bytes
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
async function validateCategoryAttributes(categoryKey, suppliedAttrs, opts) {
  let taxonomy;
  try {
    taxonomy = await get("/api/v1/shop/taxonomy", opts);
  } catch {
    return null;
  }
  if (!taxonomy || !Array.isArray(taxonomy.categories)) return null;
  const cat = taxonomy.categories.find((c) => c.key === categoryKey);
  if (!cat || !Array.isArray(cat.attrs)) return null;
  const missing = cat.attrs.filter((a) => a.required && !(a.key in suppliedAttrs)).map((a) => a.key);
  if (missing.length === 0) return null;
  return `Hi\xE1nyz\xF3 k\xF6telez\u0151 kateg\xF3ria-attrib\xFAtumok a "${cat.label}" kateg\xF3ri\xE1hoz: ` + missing.join(", ") + ". T\xF6ltsd ki ezeket az attrs mez\u0151be, majd pr\xF3b\xE1ld \xFAjra.";
}
function registerShopTools(server, opts, flags = {}) {
  if (flags.remote) {
    opts = { ...opts, noEnvFallback: true };
  }
  server.registerTool(
    "haszno_shop_list_categories",
    {
      title: "List shop categories (taxonomy)",
      description: 'Returns the full category taxonomy of the Haszno Hirdet\xE9si Piact\xE9r (marketplace). Each category has a "key" (string slug), "label" (Hungarian name), "subcategories" (array with key/label/attrs), and "attrs" \u2014 the attribute definitions (key, label, type, required, options) for ads in that category. Also returns "conditions" (product conditions) and "counties" (valid Hungarian county names). Call this before haszno_shop_create_ad to identify the correct category.key and required attr keys. The Haszno Shop is completely free \u2014 there are no listing or usage fees.',
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async () => {
      try {
        const result = await get("/api/v1/shop/taxonomy", opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "list_categories");
      }
    }
  );
  server.registerTool(
    "haszno_shop_search_ads",
    {
      title: "Search public ads",
      description: 'Searches the public Haszno Hirdet\xE9si Piact\xE9r (marketplace) for second-hand ads. Returns a paginated list of ads including their id, title, priceGross (HUF), status, images, and a "reserved" flag (true when an accepted reservation exists for the ad). The Shop is free \u2014 no fees for browsing or contacting sellers. Filter by category with cat (category key string from haszno_shop_list_categories), full-text search with q, price range with min/max (HUF). Sort: "uj" (newest, default), "ar_nov" (price ascending), "ar_csokk" (price descending).',
      inputSchema: {
        q: z.string().optional().describe("Full-text search query"),
        cat: z.string().optional().describe('Filter by category key (e.g. "auto", "elektronika")'),
        sub: z.string().optional().describe('Filter by subcategory key (e.g. "szemelyauto")'),
        min: z.number().int().min(0).optional().describe("Minimum price in HUF gross"),
        max: z.number().int().min(0).optional().describe("Maximum price in HUF gross"),
        county: z.string().optional().describe("Filter by county name (from taxonomy counties list)"),
        city: z.string().optional().describe("Filter by city name"),
        cond: z.enum(["uj", "ujszeru", "hasznalt", "serult"]).optional().describe("Product condition filter"),
        sort: z.enum(["uj", "ar_nov", "ar_csokk"]).optional().describe('"uj" (newest), "ar_nov" (price asc), "ar_csokk" (price desc)'),
        page: z.number().int().min(1).optional().describe("Page number (default 1, page size 24)")
      },
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async (args) => {
      try {
        const qs = new URLSearchParams();
        if (args.q) qs.set("q", args.q);
        if (args.cat) qs.set("cat", args.cat);
        if (args.sub) qs.set("sub", args.sub);
        if (args.min != null) qs.set("min", String(args.min));
        if (args.max != null) qs.set("max", String(args.max));
        if (args.county) qs.set("county", args.county);
        if (args.city) qs.set("city", args.city);
        if (args.cond) qs.set("cond", args.cond);
        if (args.sort) qs.set("sort", args.sort);
        if (args.page != null) qs.set("page", String(args.page));
        const suffix = qs.toString() ? `?${qs}` : "";
        const result = await get(`/api/v1/shop/ads${suffix}`, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "search_ads");
      }
    }
  );
  server.registerTool(
    "haszno_shop_get_ad",
    {
      title: "Get a single ad",
      description: 'Fetches the full detail of a Haszno marketplace ad by its ID. Returns all fields including images, attributes (attrs), seller info, and the "reserved" flag (true when an accepted reservation exists). The Shop is free \u2014 browsing and contacting sellers costs nothing.',
      inputSchema: {
        id: z.number().int().min(1).describe("Ad ID")
      },
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async (args) => {
      try {
        const result = await get(`/api/v1/shop/ads/${args.id}`, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "get_ad");
      }
    }
  );
  server.registerTool(
    "haszno_shop_price_hint",
    {
      title: "Get a suggested price hint",
      description: "Returns a suggested asking price range (p25\u2013p75 percentile) for a category, based on at least 5 distinct sellers' active listings. Returns null when there is not enough data. Use this before calling haszno_shop_create_ad to set a realistic priceGross. Pass cat (category key from haszno_shop_list_categories) and optionally sub (subcategory key).",
      inputSchema: {
        cat: z.string().describe('Category key (e.g. "auto", "elektronika") from haszno_shop_list_categories'),
        sub: z.string().optional().describe("Subcategory key to narrow the hint"),
        q: z.string().optional().describe("Item description or keywords (accepted but ignored by the server)")
      },
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async (args) => {
      try {
        const qs = new URLSearchParams();
        qs.set("cat", args.cat);
        if (args.sub) qs.set("sub", args.sub);
        if (args.q) qs.set("q", args.q);
        const result = await get(`/api/v1/shop/assist/price-hint?${qs}`, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "price_hint");
      }
    }
  );
  server.registerTool(
    "haszno_shop_list_my_ads",
    {
      title: "List my own ads",
      description: `Returns the authenticated user's own marketplace ads (all non-deleted). Each entry includes id, title, priceGross, status (aktiv/szunetel/eladva), images, reserved flag, and stats (views, inquiries, favorites). Requires authentication (Bearer token). Status values: "aktiv" (live), "szunetel" (paused), "eladva" (sold).`,
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async () => {
      try {
        const result = await get("/api/v1/shop/my/ads", opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "list_my_ads");
      }
    }
  );
  server.registerTool(
    "haszno_shop_list_inquiries",
    {
      title: "List inquiries on my ads",
      description: "Returns messages/questions sent to your ads by potential buyers. Optionally filter by adId to see inquiries for a specific ad. Pagination: use limit (1\u2013200, default 50) and offset (default 0). Requires authentication.",
      inputSchema: {
        adId: z.number().int().min(1).optional().describe("Filter by a specific ad ID"),
        limit: z.number().int().min(1).max(200).optional().describe("Page size (default 50, max 200)"),
        offset: z.number().int().min(0).optional().describe("Skip this many items (default 0)")
      },
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async (args) => {
      try {
        const qs = new URLSearchParams();
        if (args.adId != null) qs.set("adId", String(args.adId));
        if (args.limit != null) qs.set("limit", String(args.limit));
        if (args.offset != null) qs.set("offset", String(args.offset));
        const suffix = qs.toString() ? `?${qs}` : "";
        const result = await get(`/api/v1/shop/my/inquiries${suffix}`, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "list_inquiries");
      }
    }
  );
  server.registerTool(
    "haszno_shop_list_favorites",
    {
      title: "List my saved favorites",
      description: "Returns the active ads the authenticated user has saved as favorites. Requires authentication.",
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async () => {
      try {
        const result = await get("/api/v1/shop/my/favorites", opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "list_favorites");
      }
    }
  );
  server.registerTool(
    "haszno_shop_list_reservations",
    {
      title: "List my reservations",
      description: `Returns reservations for the authenticated user. Use role="buyer" (default) to list reservations YOU placed on other people's ads. Use role="seller" to list reservations buyers placed on YOUR ads. Status values: "fuggoben" (pending), "elfogadva" (accepted), "elutasitva" (declined/auto-declined), "visszavonva" (cancelled by buyer), "teljesitve" (completed), "lejart" (hold expired). Contact fields (phone, email) are only filled in when status is "elfogadva" or "teljesitve". Price negotiation fields: offerPriceGross (buyer's last offer), counterPriceGross (seller's active counter-offer, null when none), agreedPriceGross (the mutually agreed price set at acceptance). After a reservation is "teljesitve", both parties can leave a review with haszno_shop_review. Reserving is not paying \u2014 payment and handover happen directly between buyer and seller.`,
      inputSchema: {
        role: z.enum(["buyer", "seller"]).optional().describe('Whose perspective: "buyer" (default) or "seller"'),
        status: z.string().optional().describe("Filter by reservation status"),
        page: z.number().int().min(1).optional().describe("Page number (default 1)")
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
        return json(result);
      } catch (e) {
        return mapApiError(e, "list_reservations");
      }
    }
  );
  const ALLOWED_EXTS_UPLOAD = /* @__PURE__ */ new Set(["jpg", "jpeg", "png", "webp"]);
  const ALLOWED_MIMES_UPLOAD = /* @__PURE__ */ new Set(["image/jpeg", "image/png", "image/webp"]);
  const MAX_SIZE_BYTES_UPLOAD = 700 * 1024;
  function detectMimeFromBytes(buf) {
    if (buf.length < 4) return null;
    if (buf[0] === 255 && buf[1] === 216 && buf[2] === 255) return "image/jpeg";
    if (buf[0] === 137 && buf[1] === 80 && buf[2] === 78 && buf[3] === 71) return "image/png";
    if (buf.length >= 12 && buf[0] === 82 && buf[1] === 73 && buf[2] === 70 && buf[3] === 70 && buf[8] === 87 && buf[9] === 69 && buf[10] === 66 && buf[11] === 80) {
      return "image/webp";
    }
    return null;
  }
  async function uploadBase64(base64, mimeType) {
    if (!ALLOWED_MIMES_UPLOAD.has(mimeType)) {
      return mkErr(`Nem t\xE1mogatott MIME t\xEDpus: ${mimeType}. Csak image/jpeg, image/png \xE9s image/webp elfogadott.`);
    }
    let buffer;
    try {
      buffer = Buffer.from(base64, "base64");
    } catch (e) {
      return mkErr(`\xC9rv\xE9nytelen base64 adat: ${String(e)}`);
    }
    if (buffer.length > MAX_SIZE_BYTES_UPLOAD) {
      return mkErr(`A k\xE9p m\xE9rete (${(buffer.length / 1024).toFixed(0)} KB) meghaladja a 700 KB-os hat\xE1rt.`);
    }
    const mime = detectMimeFromBytes(buffer);
    if (!mime) {
      return mkErr("A base64 adat nem felismerhet\u0151 k\xE9pform\xE1tum (JPEG, PNG vagy WebP sz\xFCks\xE9ges).");
    }
    if (mime !== mimeType) {
      return mkErr(`A k\xE9p val\xF3di form\xE1tuma (${mime}) nem egyezik a megadott mimeType \xE9rt\xE9kkel (${mimeType}).`);
    }
    try {
      const result = await uploadRawBinary("/api/v1/shop/images", buffer, mime, opts);
      return json(result);
    } catch (e) {
      return mapApiError(e, "upload_image");
    }
  }
  if (flags.remote) {
    server.registerTool(
      "haszno_shop_upload_image",
      {
        title: "Upload an ad image (remote mode \u2014 base64 only)",
        description: `Uploads an image for use in a Haszno marketplace ad. Remote MCP mode: only base64-encoded image data is accepted \u2014 filePath is not available because the server cannot access the client's local filesystem. Provide base64-encoded image data together with its MIME type. Returns an object with "id" (numeric image ID) and "url" (path like /api/shop/images/<id>). \u2014 Pass url in the "images" array of haszno_shop_create_ad or haszno_shop_update_ad. \u2014 Pass id in the "imageIds" array of haszno_shop_suggest_from_photos. Supported MIME types: image/jpeg, image/png, image/webp. Maximum size: 700 KB.`,
        inputSchema: {
          base64: z.string().describe(
            "Base64-encoded image data (without the data: URI prefix)."
          ),
          mimeType: z.string().describe(
            "MIME type: image/jpeg, image/png, or image/webp."
          )
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
      },
      async (args) => {
        return uploadBase64(args.base64, args.mimeType);
      }
    );
  } else {
    server.registerTool(
      "haszno_shop_upload_image",
      {
        title: "Upload an ad image",
        description: 'Uploads an image for use in a Haszno marketplace ad. Provide either an absolute local file path ("filePath") OR a base64-encoded image with its MIME type ("base64" + "mimeType"). Returns an object with "id" (numeric image ID) and "url" (path like /api/shop/images/<id>). \u2014 Pass url in the "images" array of haszno_shop_create_ad or haszno_shop_update_ad. \u2014 Pass id in the "imageIds" array of haszno_shop_suggest_from_photos. Supported MIME types: image/jpeg, image/png, image/webp. Maximum size: 700 KB. The Haszno Shop is free \u2014 no fees for uploading images.',
        inputSchema: {
          filePath: z.string().optional().describe(
            "Absolute path to a local image file (e.g. /home/user/photo.jpg). Provide this OR base64/mimeType."
          ),
          base64: z.string().optional().describe(
            "Base64-encoded image data (without the data: URI prefix). Provide together with mimeType."
          ),
          mimeType: z.string().optional().describe(
            "MIME type for base64 input: image/jpeg, image/png, or image/webp."
          )
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
      },
      async (args) => {
        if (!args.filePath && !args.base64) {
          return mkErr("Adj meg vagy filePath-t (abszol\xFAt f\xE1jl\xFAtvonal) vagy base64 + mimeType p\xE1rt.");
        }
        if (args.base64 && !args.mimeType) {
          return mkErr("base64 megad\xE1sakor mimeType is sz\xFCks\xE9ges (pl. image/jpeg).");
        }
        let buffer;
        let detectedMime;
        if (args.filePath) {
          const ext = args.filePath.split(".").pop()?.toLowerCase() ?? "";
          if (!ALLOWED_EXTS_UPLOAD.has(ext)) {
            return mkErr(`Csak JPEG, PNG \xE9s WebP f\xE1jlok t\xF6lthet\u0151k fel (kapott kiterjeszt\xE9s: .${ext || "ismeretlen"}).`);
          }
          try {
            buffer = fs.readFileSync(args.filePath);
          } catch (e) {
            return mkErr(`Nem siker\xFClt beolvasni a f\xE1jlt: ${String(e)}`);
          }
          if (buffer.length > MAX_SIZE_BYTES_UPLOAD) {
            return mkErr(`A f\xE1jl m\xE9rete (${(buffer.length / 1024).toFixed(0)} KB) meghaladja a 700 KB-os hat\xE1rt.`);
          }
          const mime = detectMimeFromBytes(buffer);
          if (!mime) {
            return mkErr("A f\xE1jl nem felismerhet\u0151 k\xE9pform\xE1tum (JPEG, PNG vagy WebP sz\xFCks\xE9ges).");
          }
          const extMime = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
          if (mime !== extMime[ext]) {
            return mkErr(`A f\xE1jl tartalma (${mime}) nem egyezik a kiterjeszt\xE9ssel (.${ext}).`);
          }
          detectedMime = mime;
        } else {
          return uploadBase64(args.base64, args.mimeType);
        }
        try {
          const result = await uploadRawBinary(
            "/api/v1/shop/images",
            buffer,
            detectedMime,
            opts
          );
          return json(result);
        } catch (e) {
          return mapApiError(e, "upload_image");
        }
      }
    );
  }
  server.registerTool(
    "haszno_shop_suggest_from_photos",
    {
      title: "AI pre-fill ad from uploaded photos",
      description: 'Sends uploaded image IDs to the Haszno AI to generate a suggested ad title, description, category, condition, and category-specific attributes. Upload images first with haszno_shop_upload_image to get the numeric "id" of each image, then pass those IDs here (1\u20133 images). The result is a suggestion only \u2014 review it before passing it to haszno_shop_create_ad. Returns error 503 when the AI feature is not enabled on this server.',
      inputSchema: {
        imageIds: z.array(z.number().int().min(1)).min(1).max(3).describe(
          "Numeric image IDs from haszno_shop_upload_image (1\u20133 IDs)"
        )
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const result = await post("/api/v1/shop/assist/from-photos", { imageIds: args.imageIds }, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "suggest_from_photos");
      }
    }
  );
  server.registerTool(
    "haszno_shop_create_ad",
    {
      title: "Post a new marketplace ad",
      description: 'Creates a new Haszno Hirdet\xE9si Piact\xE9r (marketplace) ad. This is a REAL action \u2014 the ad becomes immediately visible to all users on haszno.com. Only call this when the user has explicitly confirmed they want to post the ad. The Haszno Shop is completely free \u2014 there are no listing fees. Before calling this tool: (1) call haszno_shop_list_categories to get the category key, subcategory key, required attrs, and valid county names; (2) call haszno_shop_upload_image for each photo and collect the returned "url" values; (3) call haszno_shop_price_hint for a price suggestion. Image URLs must be in the format /api/shop/images/<id> (returned by haszno_shop_upload_image). This tool validates required category attributes before sending.',
      inputSchema: {
        category: z.string().describe('Category key (e.g. "auto") from haszno_shop_list_categories'),
        subcategory: z.string().optional().nullable().describe('Subcategory key (optional, e.g. "szemelya" for "auto")'),
        title: z.string().min(5).max(120).describe("Ad title (5\u2013120 characters)"),
        description: z.string().max(5e3).describe("Ad description (max 5000 chars)"),
        priceGross: z.number().int().min(1).max(2e9).nullable().describe('Asking price in HUF gross, or null for "price on request"'),
        negotiable: z.boolean().describe("Whether the price is negotiable"),
        condition: z.enum(["uj", "ujszeru", "hasznalt", "serult"]).describe(
          'Product condition: "uj" (new), "ujszeru" (like new), "hasznalt" (used), "serult" (damaged)'
        ),
        defects: z.string().min(10).max(2e3).optional().nullable().describe(
          'Description of defects or damage (minimum 10 characters). REQUIRED when condition is "hasznalt" (used) or "serult" (damaged) \u2014 the API will return HTTP 422 if this field is missing for those conditions.'
        ),
        county: z.string().describe("Hungarian county name from haszno_shop_list_categories counties list"),
        city: z.string().min(1).max(80).describe("City name"),
        images: z.array(z.string()).max(10).optional().describe(
          "Image URLs from haszno_shop_upload_image (format: /api/shop/images/<id>, max 10)"
        ),
        attrs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe(
          'Category-specific attributes (e.g. { "allapot": "hasznalt", "marka": "Samsung" }). Required attributes depend on the category \u2014 call haszno_shop_list_categories to see them.'
        ),
        contactName: z.string().min(1).max(80).describe("Seller contact name"),
        contactPhone: z.string().optional().nullable().describe("Contact phone number (optional)"),
        contactEmail: z.string().email().describe("Seller contact e-mail address"),
        showPhone: z.boolean().describe("Whether to display the phone number publicly"),
        resellable: z.boolean().describe("Allow partner shops to list this ad in their own webshops"),
        partnerCommissionPct: z.number().min(0).max(30).describe("Commission % to offer partner shops (0\u201330)"),
        confirm: z.literal(true).describe(
          "Must be exactly true. This posts a real, public ad \u2014 only set this after the user confirms."
        )
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      const attrs = args.attrs ?? {};
      const validationError = await validateCategoryAttributes(args.category, attrs, opts);
      if (validationError) {
        return mkErr(validationError);
      }
      const body = {
        category: args.category,
        subcategory: args.subcategory ?? null,
        title: args.title,
        description: args.description,
        priceGross: args.priceGross,
        negotiable: args.negotiable,
        condition: args.condition,
        county: args.county,
        city: args.city,
        images: args.images ?? [],
        attrs: args.attrs ?? {},
        contactName: args.contactName,
        contactPhone: args.contactPhone ?? null,
        contactEmail: args.contactEmail,
        showPhone: args.showPhone,
        resellable: args.resellable,
        partnerCommissionPct: args.partnerCommissionPct
      };
      if (args.defects != null) body["defects"] = args.defects;
      try {
        const result = await post("/api/v1/shop/ads", body, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "create_ad");
      }
    }
  );
  server.registerTool(
    "haszno_shop_update_ad",
    {
      title: "Update an existing ad",
      description: "Updates an existing Haszno marketplace ad (PUT \u2014 the server replaces the full ad). This tool first fetches the current ad values, merges in only the fields you provide, then sends the complete updated body. Only pass the fields you want to change. The ad must belong to the authenticated user. Image URLs must be in the format /api/shop/images/<id>. The Haszno Shop is free.",
      inputSchema: {
        id: z.number().int().min(1).describe("Ad ID to update"),
        category: z.string().optional().describe("Category key"),
        subcategory: z.string().optional().nullable(),
        title: z.string().min(5).max(120).optional(),
        description: z.string().max(5e3).optional(),
        priceGross: z.number().int().min(1).max(2e9).nullable().optional().describe('New asking price in HUF gross, or null for "price on request"'),
        negotiable: z.boolean().optional(),
        condition: z.enum(["uj", "ujszeru", "hasznalt", "serult"]).optional(),
        county: z.string().optional(),
        city: z.string().min(1).max(80).optional(),
        images: z.array(z.string()).max(10).optional().describe("Image URLs (/api/shop/images/<id> format)"),
        attrs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
        contactName: z.string().min(1).max(80).optional(),
        contactPhone: z.string().optional().nullable(),
        contactEmail: z.string().email().optional(),
        showPhone: z.boolean().optional(),
        resellable: z.boolean().optional(),
        partnerCommissionPct: z.number().min(0).max(30).optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      const { id, ...updates } = args;
      let current;
      try {
        current = await get(`/api/v1/shop/my/ads/${id}`, opts);
      } catch (e) {
        return mapApiError(e, `update_ad (fetch current state for id=${id})`);
      }
      const body = {
        category: updates.category ?? current["category"],
        subcategory: "subcategory" in updates ? updates.subcategory : current["subcategory"],
        title: updates.title ?? current["title"],
        description: updates.description ?? current["description"],
        priceGross: "priceGross" in updates ? updates.priceGross : current["priceGross"],
        negotiable: updates.negotiable ?? current["negotiable"],
        condition: updates.condition ?? current["condition"],
        county: updates.county ?? current["county"],
        city: updates.city ?? current["city"],
        images: updates.images ?? current["images"],
        attrs: updates.attrs ?? current["attrs"],
        contactName: updates.contactName ?? current["contactName"],
        contactPhone: "contactPhone" in updates ? updates.contactPhone : current["contactPhone"],
        contactEmail: updates.contactEmail ?? current["contactEmail"],
        showPhone: updates.showPhone ?? current["showPhone"],
        resellable: updates.resellable ?? current["resellable"],
        partnerCommissionPct: updates.partnerCommissionPct ?? current["partnerCommissionPct"]
      };
      try {
        const result = await put(`/api/v1/shop/ads/${id}`, body, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "update_ad");
      }
    }
  );
  server.registerTool(
    "haszno_shop_set_ad_status",
    {
      title: "Change ad status (pause, reactivate, or delete)",
      description: `Changes an ad's status. "szunetel" hides the ad from public search (paused); "aktiv" makes it visible again (also resets the expiry timer); "torolve" soft-deletes the ad permanently (irreversible). The ad must belong to the authenticated user.`,
      inputSchema: {
        id: z.number().int().min(1).describe("Ad ID"),
        status: z.enum(["aktiv", "szunetel", "torolve"]).describe(
          '"aktiv" to show, "szunetel" to pause, "torolve" to permanently delete'
        )
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/ads/${args.id}/status`, { status: args.status }, opts);
        return json(result);
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
        id: z.number().int().min(1).describe("Ad ID"),
        soldPriceGross: z.number().int().min(1).optional().nullable().describe(
          "Actual sale price in HUF gross (optional, for your records)"
        ),
        confirm: z.literal(true).describe(
          "Must be exactly true. This permanently marks the ad as sold."
        )
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }
    },
    async (args) => {
      try {
        const body = {};
        if (args.soldPriceGross != null) body["soldPriceGross"] = args.soldPriceGross;
        const result = await post(`/api/v1/shop/ads/${args.id}/sold`, body, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "mark_sold");
      }
    }
  );
  server.registerTool(
    "haszno_shop_renew_ad",
    {
      title: "Renew / bump an ad",
      description: "Renews an ad, resetting its 60-day expiry timer and bumping it back to the top of search results. Use this for ads that are about to expire or have fallen in ranking. The Haszno Shop is free \u2014 renewal has no cost.",
      inputSchema: {
        id: z.number().int().min(1).describe("Ad ID to renew")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/ads/${args.id}/renew`, {}, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "renew_ad");
      }
    }
  );
  server.registerTool(
    "haszno_shop_send_inquiry",
    {
      title: "Send an inquiry to the seller",
      description: "Sends a message or question to the seller of an ad. The seller will be notified and can respond through Haszno. Requires name, email, and message (at least 5 characters). The Haszno Shop is free.",
      inputSchema: {
        adId: z.number().int().min(1).describe("Ad ID to send the inquiry to"),
        name: z.string().min(1).max(80).describe("Your name"),
        email: z.string().email().describe("Your e-mail address"),
        phone: z.string().max(50).optional().nullable().describe("Your phone number (optional)"),
        message: z.string().min(5).max(2e3).describe("Your message or question for the seller (min 5 characters)")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const body = {
          name: args.name,
          email: args.email,
          message: args.message
        };
        if (args.phone != null) body["phone"] = args.phone;
        const result = await post(`/api/v1/shop/ads/${args.adId}/inquiries`, body, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "send_inquiry");
      }
    }
  );
  server.registerTool(
    "haszno_shop_set_favorite",
    {
      title: "Save or remove a favorite",
      description: "Saves or removes an ad from your favorites list. Set save=true to add to favorites (PUT /favorite), save=false to remove (DELETE /favorite). The Haszno Shop is free.",
      inputSchema: {
        adId: z.number().int().min(1).describe("Ad ID"),
        save: z.boolean().describe("true to save as favorite, false to remove")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async (args) => {
      try {
        let result;
        if (args.save) {
          result = await put(`/api/v1/shop/ads/${args.adId}/favorite`, {}, opts);
        } else {
          result = await del(`/api/v1/shop/ads/${args.adId}/favorite`, opts);
        }
        return json(result);
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
        adId: z.number().int().min(1).describe("Ad ID to reserve"),
        message: z.string().max(1e3).optional().describe("Optional message to the seller (max 1000 chars)"),
        offerPriceGross: z.number().int().min(1).optional().describe(
          "Counter-offer price in HUF gross (optional \u2014 omit to accept the listed price)"
        ),
        phone: z.string().max(50).optional().describe(
          "Your phone number (optional; revealed to the seller only if they accept)"
        ),
        confirm: z.literal(true).describe(
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
        return json(result);
      } catch (e) {
        return mapApiError(e, "reserve_ad");
      }
    }
  );
  server.registerTool(
    "haszno_shop_respond_reservation",
    {
      title: "Accept or decline a reservation (seller)",
      description: `Accepts or declines a pending reservation on one of your ads (seller action). action="accept": marks the reservation as "elfogadva" (accepted); the buyer's contact details become visible to you in the reservation. action="decline": marks the reservation as "elutasitva" (declined); the ad remains active for other buyers. Response includes counterPriceGross (seller's last counter-offer if any) and agreedPriceGross (agreed price). You can also send a counter-offer first with haszno_shop_counter_offer before accepting. The Haszno Shop is free \u2014 accepting a reservation does NOT create a payment.`,
      inputSchema: {
        id: z.number().int().min(1).describe("Reservation ID"),
        action: z.enum(["accept", "decline"]).describe('"accept" or "decline"')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const path = `/api/v1/shop/my/reservations/${args.id}/${args.action}`;
        const result = await post(path, {}, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, `respond_reservation(${args.action})`);
      }
    }
  );
  server.registerTool(
    "haszno_shop_cancel_reservation",
    {
      title: "Cancel your reservation (buyer)",
      description: 'Cancels a reservation you placed as a buyer (status becomes "visszavonva"). Only pending ("fuggoben") or accepted ("elfogadva") reservations can be cancelled. The Haszno Shop is free \u2014 cancellation has no cost.',
      inputSchema: {
        id: z.number().int().min(1).describe("Reservation ID to cancel")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/my/reservations/${args.id}/cancel`, {}, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "cancel_reservation");
      }
    }
  );
  server.registerTool(
    "haszno_shop_complete_reservation",
    {
      title: "Complete a reservation (seller)",
      description: 'Marks a reservation as completed ("teljesitve"), confirming that the item has changed hands. This is a REAL, IRREVERSIBLE action \u2014 only call it when the user confirms the sale is done. Side effects: (1) the ad status changes to "eladva" (sold) and disappears from search; (2) all other open reservations for the same ad are automatically declined. Optionally record the actual sold price (soldPriceGross) for your records \u2014 it is not shared publicly. The response includes agreedPriceGross (the mutually agreed price if the buyer accepted a counter-offer). After completion, both buyer and seller can leave a rating with haszno_shop_review (sellerRating is the aggregate of these). REMINDER: Payment and handover happen directly between buyer and seller \u2014 Haszno does not process payments. The Haszno Shop is free \u2014 no commission on completed deals.',
      inputSchema: {
        id: z.number().int().min(1).describe("Reservation ID"),
        soldPriceGross: z.number().int().min(1).optional().nullable().describe(
          "Actual sale price in HUF gross (optional, for your records only)"
        ),
        confirm: z.literal(true).describe(
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
        return json(result);
      } catch (e) {
        return mapApiError(e, "complete_reservation");
      }
    }
  );
  server.registerTool(
    "haszno_shop_counter_offer",
    {
      title: "Send a counter-offer on a reservation (seller)",
      description: 'Seller sends a counter-offer price on a pending ("fuggoben") reservation. The buyer will be notified by e-mail and can accept it with haszno_shop_accept_counter, or ignore it and proceed normally. Can only be called on a "fuggoben" reservation that belongs to your ads. Returns the updated reservation with counterPriceGross set. The Haszno Shop is free \u2014 counter-offers carry no fee.',
      inputSchema: {
        id: z.number().int().min(1).describe("Reservation ID"),
        priceGross: z.number().int().min(1).describe("Counter-offer price in HUF gross (must be a positive integer)")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/my/reservations/${args.id}/counter`, { priceGross: args.priceGross }, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "counter_offer");
      }
    }
  );
  server.registerTool(
    "haszno_shop_accept_counter",
    {
      title: "Accept the seller's counter-offer (buyer)",
      description: `Buyer accepts the seller's active counter-offer on a pending ("fuggoben") reservation. After acceptance: offerPriceGross is updated to the accepted counter price, counterPriceGross is cleared. The reservation remains "fuggoben" \u2014 the seller still needs to formally accept it. Returns error 409 when there is no active counter-offer on this reservation. The Haszno Shop is free \u2014 acceptance does NOT create a payment.`,
      inputSchema: {
        id: z.number().int().min(1).describe("Reservation ID")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/my/reservations/${args.id}/accept-counter`, {}, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "accept_counter");
      }
    }
  );
  server.registerTool(
    "haszno_shop_list_messages",
    {
      title: "List messages on a reservation",
      description: 'Returns the message thread for a reservation. Only the buyer and the seller of that reservation may read the messages. Each message has: id, author ("buyer" or "seller"), body (free text, may contain contact details), createdAt. Messages are ordered oldest first (up to 500). Requires authentication.',
      inputSchema: {
        id: z.number().int().min(1).describe("Reservation ID")
      },
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async (args) => {
      try {
        const result = await get(`/api/v1/shop/my/reservations/${args.id}/messages`, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "list_messages");
      }
    }
  );
  server.registerTool(
    "haszno_shop_send_message",
    {
      title: "Send a message on a reservation",
      description: "Sends a free-text message on a reservation thread. Both the buyer and the seller of that reservation may send messages. The other party will be notified by e-mail (message excerpt only). The body may contain contact details (Haszno does not filter message content). Rate-limited to 20 messages per hour. Requires authentication.",
      inputSchema: {
        id: z.number().int().min(1).describe("Reservation ID"),
        body: z.string().min(1).max(2e3).describe("Message text (1\u20132000 characters)")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/my/reservations/${args.id}/messages`, { body: args.body }, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "send_message");
      }
    }
  );
  server.registerTool(
    "haszno_shop_review",
    {
      title: "Leave a review on a completed reservation",
      description: `Leaves a review (rating 1\u20135 + optional comment) on a completed ("teljesitve") reservation. Both the buyer and the seller can each leave exactly one review per reservation. Returns error 409 when the reservation is not "teljesitve" or when already reviewed. The aggregate of a seller's received reviews forms their sellerRating. This is a REAL action \u2014 only call when the user confirms they want to submit the review. The Haszno Shop is free \u2014 reviews are voluntary.`,
      inputSchema: {
        id: z.number().int().min(1).describe('Reservation ID (must be "teljesitve" / completed)'),
        rating: z.number().int().min(1).max(5).describe("Rating from 1 (worst) to 5 (best)"),
        comment: z.string().max(1e3).optional().describe("Optional review comment (max 1000 characters)"),
        confirm: z.literal(true).describe(
          "Must be exactly true. This submits a real, permanent review."
        )
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      const body = { rating: args.rating };
      if (args.comment) body["comment"] = args.comment;
      try {
        const result = await post(`/api/v1/shop/my/reservations/${args.id}/review`, body, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "review");
      }
    }
  );
  server.registerTool(
    "haszno_shop_reply_inquiry",
    {
      title: "Reply to an inquiry (seller)",
      description: "Seller replies to an inquiry (question) a potential buyer sent on one of their ads. The inquirer is notified by e-mail with the reply. Only the seller who owns the ad may reply. Each inquiry can have at most ONE reply. Returns error 409 when the inquiry already has a reply. The Haszno Shop is free.",
      inputSchema: {
        id: z.number().int().min(1).describe("Inquiry ID (from haszno_shop_list_inquiries)"),
        message: z.string().min(1).max(2e3).describe("Reply message (1\u20132000 characters)")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/my/inquiries/${args.id}/reply`, { message: args.message }, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "reply_inquiry");
      }
    }
  );
  server.registerTool(
    "haszno_shop_list_saved_searches",
    {
      title: "List my saved searches",
      description: "Returns all saved searches for the authenticated user, newest first. Each entry has: id, name, filters (q, cat, sub, min, max, county, cond, attrs), alertEnabled (whether e-mail alerts are on), lastAlertSentAt, createdAt. Create a new one with haszno_shop_save_search; delete with haszno_shop_delete_saved_search. Requires authentication.",
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async () => {
      try {
        const result = await get("/api/v1/shop/my/saved-searches", opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "list_saved_searches");
      }
    }
  );
  server.registerTool(
    "haszno_shop_save_search",
    {
      title: "Save a search with optional e-mail alerts",
      description: "Saves a search filter set so the user can be notified by e-mail when matching new ads appear. Maximum 20 saved searches per user; returns error 422 when the cap is reached. alertEnabled defaults to true \u2014 set to false to save without notifications. The filters object accepts the same fields as haszno_shop_search_ads. Returns the created SavedSearch with its id. Requires authentication. The Haszno Shop is free.",
      inputSchema: {
        name: z.string().min(1).max(80).describe("Human-readable name for this saved search (max 80 chars)"),
        filters: z.object({
          q: z.string().optional().describe("Full-text search query"),
          cat: z.string().optional().describe("Category key"),
          sub: z.string().optional().describe("Subcategory key"),
          min: z.number().int().min(0).optional().describe("Minimum price in HUF gross"),
          max: z.number().int().min(0).optional().describe("Maximum price in HUF gross"),
          county: z.string().optional().describe("County name"),
          cond: z.enum(["uj", "ujszeru", "hasznalt", "serult"]).optional().describe("Product condition")
        }).describe("Search filter criteria (same fields as haszno_shop_search_ads)"),
        alertEnabled: z.boolean().optional().describe("Send e-mail alerts when new matching ads appear (default true)")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const result = await post("/api/v1/shop/my/saved-searches", {
          name: args.name,
          filters: args.filters,
          alertEnabled: args.alertEnabled
        }, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "save_search");
      }
    }
  );
  server.registerTool(
    "haszno_shop_delete_saved_search",
    {
      title: "Delete a saved search",
      description: "Deletes a saved search by its id. If the id does not exist or does not belong to the authenticated user, the deletion is a no-op (idempotent). Returns { ok: true } on success. Requires authentication.",
      inputSchema: {
        id: z.number().int().min(1).describe("Saved search ID (from haszno_shop_list_saved_searches)")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
    },
    async (args) => {
      try {
        const result = await del(`/api/v1/shop/my/saved-searches/${args.id}`, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "delete_saved_search");
      }
    }
  );
  server.registerTool(
    "haszno_shop_watch_price",
    {
      title: "Subscribe to / unsubscribe from price-drop alerts for an ad",
      description: `Subscribes to (watch=true) or unsubscribes from (watch=false) price-drop e-mail alerts for a specific ad. When subscribed, the user gets an e-mail when the ad's price drops. watch=true: PUT /api/v1/shop/ads/:adId/watch \u2014 the ad must be "aktiv"; returns { watched: true }. watch=false: DELETE /api/v1/shop/ads/:adId/watch \u2014 idempotent; returns { watched: false }. Returns error 400 if the ad is not active (watch=true only). Requires authentication. The Haszno Shop is free.`,
      inputSchema: {
        adId: z.number().int().min(1).describe("Ad ID to watch or unwatch"),
        watch: z.boolean().describe("true to subscribe to price-drop alerts, false to unsubscribe")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async (args) => {
      try {
        let result;
        if (args.watch) {
          result = await put(`/api/v1/shop/ads/${args.adId}/watch`, {}, opts);
        } else {
          result = await del(`/api/v1/shop/ads/${args.adId}/watch`, opts);
        }
        return json(result);
      } catch (e) {
        return mapApiError(e, "watch_price");
      }
    }
  );
  server.registerTool(
    "haszno_shop_import_from_url",
    {
      title: "Extract ad data from an external URL (draft only \u2014 never posts)",
      description: "Fetches a product or classifieds listing page by URL and extracts its metadata (title, description, price, images) for use as a pre-filled ad draft. This tool NEVER creates or posts an ad \u2014 it only returns extracted data. You must still call haszno_shop_create_ad (with confirm:true) separately after reviewing the result. Facebook URLs are rejected with a helpful error (login wall). Returns: title?, description?, price?, images (array of strings), parsed (extracted car/item attributes). Rate-limited to 10 imports per hour. Requires authentication.",
      inputSchema: {
        url: z.string().url().max(2048).describe("Public URL of the product or classifieds listing page to import from")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const result = await post("/api/v1/shop/assist/url-import", { url: args.url }, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "import_from_url");
      }
    }
  );
  server.registerTool(
    "haszno_shop_get_draft",
    {
      title: "Get the current ad creation draft",
      description: "Returns the authenticated user's current server-side ad creation draft, or null if none exists. The draft is a partial ad payload saved across sessions. Returns { payload: {...}, updatedAt: string } or null. Save or update with haszno_shop_save_draft; discard with haszno_shop_clear_draft. Requires authentication.",
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async () => {
      try {
        const result = await get("/api/v1/shop/my/draft", opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "get_draft");
      }
    }
  );
  server.registerTool(
    "haszno_shop_save_draft",
    {
      title: "Save or update the ad creation draft",
      description: "Saves or replaces the authenticated user's server-side ad creation draft (upsert). Pass any subset of ad fields (same structure as haszno_shop_create_ad, without confirm). The draft is kept until the user explicitly clears it (haszno_shop_clear_draft) or posts the ad (haszno_shop_create_ad clears the draft automatically). Maximum draft size is 64 KB. Image URLs must be in /api/shop/images/<id> format. Returns { payload: {...}, updatedAt: string }. Requires authentication.",
      inputSchema: {
        payload: z.record(z.string(), z.unknown()).describe(
          "Partial ad fields to store in the draft. Any subset of haszno_shop_create_ad fields is accepted (e.g. { title, category, priceGross, description, images, attrs, \u2026 }). Image URLs must be in /api/shop/images/<id> format (from haszno_shop_upload_image)."
        )
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async (args) => {
      try {
        const result = await put("/api/v1/shop/my/draft", args.payload, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "save_draft");
      }
    }
  );
  server.registerTool(
    "haszno_shop_clear_draft",
    {
      title: "Discard the ad creation draft",
      description: "Deletes the authenticated user's current ad creation draft. Idempotent \u2014 no error if no draft exists. Returns { ok: true }. Requires authentication.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
    },
    async () => {
      try {
        const result = await del("/api/v1/shop/my/draft", opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "clear_draft");
      }
    }
  );
  server.registerTool(
    "haszno_shop_set_seller_profile",
    {
      title: "Set seller type (one-time setup required before first ad)",
      description: `Sets the seller type for the authenticated user's shop. This is a ONE-TIME setup that MUST be completed before posting the first ad \u2014 without it, haszno_shop_create_ad returns HTTP 409 "Az elad\xF3i t\xEDpus megad\xE1sa k\xF6telez\u0151 az els\u0151 hirdet\xE9s felad\xE1s\xE1hoz". Two seller types are supported: "maganszemely" (private individual) and "kereskedo" (registered business/trader). For "kereskedo", companyName and companyAddress are required. The profile can be updated later; calling this again replaces the existing value. Returns the updated seller profile. Requires authentication.`,
      inputSchema: {
        sellerType: z.enum(["maganszemely", "kereskedo"]).describe(
          '"maganszemely" = private individual, "kereskedo" = business/trader'
        ),
        companyName: z.string().min(1).max(200).optional().describe(
          'Company name (required when sellerType is "kereskedo")'
        ),
        companyAddress: z.string().min(1).max(400).optional().describe(
          'Company registered address (required when sellerType is "kereskedo")'
        ),
        companyRegNumber: z.string().max(50).optional().nullable().describe(
          'Company registration number (optional, only for "kereskedo")'
        )
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async (args) => {
      if (args.sellerType === "kereskedo") {
        if (!args.companyName) return mkErr("companyName megad\xE1sa k\xF6telez\u0151 kereskedo elad\xF3i t\xEDpushoz.");
        if (!args.companyAddress) return mkErr("companyAddress megad\xE1sa k\xF6telez\u0151 kereskedo elad\xF3i t\xEDpushoz.");
      }
      const body = { sellerType: args.sellerType };
      if (args.sellerType === "kereskedo") {
        body["companyName"] = args.companyName;
        body["companyAddress"] = args.companyAddress;
        if (args.companyRegNumber != null) body["companyRegNumber"] = args.companyRegNumber;
      }
      try {
        const result = await put("/api/v1/shop/my/seller-profile", body, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "set_seller_profile");
      }
    }
  );
  server.registerTool(
    "haszno_shop_remove_background",
    {
      title: "Remove image background (AI)",
      description: "Processes an already-uploaded image through the AI background removal service. The original image is preserved; a NEW image row is created with the processed result. Returns { id, url } of the NEW background-removed image (use this id/url in your ad). The source image must exist and belong to the authenticated user's shop. Rate-limited to 10 calls per hour. Returns error 503 when the background removal feature is not enabled on this server.",
      inputSchema: {
        imageId: z.number().int().min(1).describe("ID of an already-uploaded image (from haszno_shop_upload_image)")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/images/${args.imageId}/remove-bg`, {}, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "remove_background");
      }
    }
  );
  server.registerTool(
    "haszno_shop_partner_profile_get",
    {
      title: "Get partner (reseller) profile",
      description: "Returns the shop's partner (reseller webshop) profile. The partner profile is created automatically on the first call if it does not exist yet.\n\nReturns: refCode (unique code used in feed URLs), displayName, feedJsonUrl (GET to fetch the JSON product feed), feedXmlUrl (Google Merchant XML feed), embedUrl.\n\nThe feed URLs are public \u2014 no auth required. Partner webshops embed or poll them to list the ads the shop has syndicated.\n\nGET /api/v1/shop/partner/profile.",
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async () => {
      try {
        const profile = await get("/api/v1/shop/partner/profile", opts);
        return json(profile);
      } catch (e) {
        return mapApiError(e, "partner_profile_get");
      }
    }
  );
  server.registerTool(
    "haszno_shop_partner_profile_update",
    {
      title: "Update partner display name",
      description: "Updates the display name shown on the partner webshop's feed and embed widget.\n\nPUT /api/v1/shop/partner/profile \u2014 body: { displayName }.\n\nThe displayName must be 2\u201360 characters.\n\nIf the partner profile does not exist yet, call haszno_shop_partner_profile_get first \u2014 that call auto-creates it.\n\nRequires confirm: true.",
      inputSchema: {
        displayName: z.string().min(2).max(60).describe("Display name shown on the partner feed (2\u201360 characters)."),
        confirm: z.literal(true).describe("Must be exactly true (safety gate).")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async (args) => {
      try {
        const updated = await put("/api/v1/shop/partner/profile", { displayName: args.displayName }, opts);
        return json(updated);
      } catch (e) {
        return mapApiError(e, "partner_profile_update");
      }
    }
  );
  server.registerTool(
    "haszno_shop_partner_syndications_list",
    {
      title: "List syndicated partner ads",
      description: "Returns the list of marketplace ads the shop has syndicated into its partner feed.\n\nEach entry includes: adId (the original ad's ID), markupPct (gross markup %), markupFt (flat markup in HUF), and the computed partnerPriceGross.\n\nThe markup is only shown to the authenticated partner shop that owns it \u2014 it is never visible to the original seller or other shops (antitrust / privacy).\n\nGET /api/v1/shop/partner/syndications.",
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async () => {
      try {
        const syndications = await get("/api/v1/shop/partner/syndications", opts);
        return json(syndications);
      } catch (e) {
        return mapApiError(e, "partner_syndications_list");
      }
    }
  );
  server.registerTool(
    "haszno_shop_partner_syndication_upsert",
    {
      title: "Add or update a syndicated ad",
      description: `Adds a marketplace ad to the shop's partner feed, or updates an existing syndication.

**Requires the shop to be a registered trader (sellerType = "kereskedo")**. Private-person shops (maganszemely) cannot syndicate ads \u2014 the server returns 403 with code "seller_type_required". Use haszno_account_whoami to verify your role.

The partner price is computed as: max(adAskingPrice, adAskingPrice \xD7 (1 + markupPct/100) + markupFt).

PUT /api/v1/shop/partner/syndications/:adId \u2014 body: { markupPct, markupFt }.

markupPct: 0\u2013100 (percentage markup on the ad's asking price). markupFt: 0\u201350 000 000 (flat HUF markup, integer). Requires confirm: true.`,
      inputSchema: {
        adId: z.number().int().positive().describe("ID of the marketplace ad to syndicate."),
        markupPct: z.number().min(0).max(100).describe(
          "Percentage markup on the original asking price (0\u2013100). E.g. 5 = 5% above the asking price."
        ),
        markupFt: z.number().int().min(0).max(5e7).describe(
          "Flat gross HUF markup (0\u201350 000 000, integer). Added on top of the percentage markup."
        ),
        confirm: z.literal(true).describe("Must be exactly true (safety gate).")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async (args) => {
      try {
        const result = await put(
          `/api/v1/shop/partner/syndications/${args.adId}`,
          { markupPct: args.markupPct, markupFt: args.markupFt },
          opts
        );
        return json(result);
      } catch (e) {
        return mapApiError(e, "partner_syndication_upsert");
      }
    }
  );
  server.registerTool(
    "haszno_shop_partner_syndication_remove",
    {
      title: "Remove a syndicated ad from the partner feed",
      description: "Removes a marketplace ad from the shop's partner feed. The original ad is not affected \u2014 it remains listed on the marketplace.\n\nDELETE /api/v1/shop/partner/syndications/:adId \u2014 returns { ok: true }.\n\nRequires confirm: true.",
      inputSchema: {
        adId: z.number().int().positive().describe("ID of the syndicated ad to remove from the feed."),
        confirm: z.literal(true).describe("Must be exactly true (safety gate).")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async (args) => {
      try {
        const result = await del(`/api/v1/shop/partner/syndications/${args.adId}`, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "partner_syndication_remove");
      }
    }
  );
  server.registerTool(
    "haszno_shop_moderation_list",
    {
      title: "List moderation actions on my ads",
      description: "Returns the moderation decisions (actions taken by moderators) on the authenticated shop's ads.\n\nEach entry includes: id, adId, reason (ModerationReasonCode), action taken, createdAt, and whether an appeal is still possible.\n\nUse this to audit which ads were moderated and understand the reason codes. If an action is still appealable, use haszno_shop_moderation_appeal.\n\nGET /api/v1/shop/my/moderation.",
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async () => {
      try {
        const actions = await get("/api/v1/shop/my/moderation", opts);
        return json(actions);
      } catch (e) {
        return mapApiError(e, "moderation_list");
      }
    }
  );
  server.registerTool(
    "haszno_shop_moderation_appeal",
    {
      title: "Appeal a moderation decision",
      description: "Submits an appeal against a moderation decision. The appeal message is sent to the moderation team for review.\n\nPOST /api/v1/shop/my/moderation/:id/appeal \u2014 body: { message }.\n\nThe message must be 10\u20132000 characters. Appeals can only be submitted once per moderation action. Returns { ok: true } on success.\n\nRequires confirm: true.",
      inputSchema: {
        id: z.number().int().positive().describe("Moderation action ID (from haszno_shop_moderation_list)."),
        message: z.string().min(10).max(2e3).describe(
          "Appeal message explaining why the moderation decision should be reconsidered (10\u20132000 characters)."
        ),
        confirm: z.literal(true).describe("Must be exactly true (safety gate).")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/my/moderation/${args.id}/appeal`, { message: args.message }, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "moderation_appeal");
      }
    }
  );
}
export {
  registerShopTools
};
//# sourceMappingURL=lib.js.map