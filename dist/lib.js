// src/tools/shop.ts
import * as fs2 from "fs";
import { z as z2 } from "zod";

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
async function request(method, path2, body, opts) {
  const baseUrl = (opts.baseUrl ?? (opts.noEnvFallback ? void 0 : process.env["HASZNO_API_URL"] ?? process.env["ARFUTAR_API_URL"]) ?? "https://haszno.com").replace(/\/$/, "");
  const url = `${baseUrl}${path2}`;
  const fetchFn = opts.fetch ?? fetch;
  const maxRetries = opts.maxRetries ?? 3;
  const retryDelayMs = opts.retryDelayMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 3e4;
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "haszno-mcp/0.6.0",
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
        const json3 = await response.json();
        if (json3.error) message = json3.error;
        if (json3.code) code = json3.code;
        if (json3.requestId) requestId = json3.requestId;
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
function get(path2, opts) {
  return request("GET", path2, void 0, opts);
}
function post(path2, body, opts) {
  return request("POST", path2, body, opts);
}
function put(path2, body, opts) {
  return request("PUT", path2, body, opts);
}
function patch(path2, body, opts) {
  return request("PATCH", path2, body, opts);
}
function del(path2, opts) {
  return request("DELETE", path2, void 0, opts);
}

// src/tools/jobs.ts
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { z } from "zod";
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
function mapApplyError(e, adId) {
  if (e instanceof HasznoApiError) {
    const code = e.code ?? "";
    if (code === "auto_apply_disabled" || e.status === 403) {
      return mkErr(
        `apply: Az automatikus jelentkez\xE9s (\xFCgyn\xF6k \xE1ltal) nincs enged\xE9lyezve. A felhaszn\xE1l\xF3nak be kell kapcsolnia az \u201EAutomatikus jelentkez\xE9s \xFCgyn\xF6kkel" opci\xF3t. Ezt megteheti a Haszno webes fel\xFCleten (https://haszno.com/shop/oneletrajzom), vagy explicit felhaszn\xE1l\xF3i k\xE9r\xE9s eset\xE9n a haszno_shop_job_profile_save h\xEDv\xE1ssal (autoApply: true). API v\xE1lasz: [${e.status}] ${e.message}`
      );
    }
    if (e.status === 409) {
      if (code === "already_applied") {
        return mkErr(
          `apply: M\xE1r jelentkezt\xE9l erre a hirdet\xE9sre (adId: ${adId}). Ugyanarra a hirdet\xE9sre csak egyszer lehet jelentkezni. [${e.status}] ${e.message}`
        );
      }
      if (code === "profile_required") {
        return mkErr(
          `apply: A jelentkez\xE9shez teljes \xF6n\xE9letrajz-profil sz\xFCks\xE9ges (consent: true \xE9s felt\xF6lt\xF6tt PDF \xF6n\xE9letrajz). Hozz l\xE9tre profilt a haszno_shop_job_profile_save eszk\xF6zzel (consent: true), majd t\xF6ltsd fel az \xF6n\xE9letrajzat PDF-ben a haszno_shop_job_cv_upload eszk\xF6zzel, \xE9s pr\xF3b\xE1ld \xFAjra. API v\xE1lasz: [${e.status}] ${e.message}`
        );
      }
      return mkErr(`apply: [${e.status}] ${e.message} (code: ${code})`);
    }
    if (e.status === 429) {
      return mkErr(
        `apply: El\xE9rted a napi 20 jelentkez\xE9si limitet. Holnap \xFAjra pr\xF3b\xE1lhatod. [${e.status}] ${e.message}`
      );
    }
    if (e.status === 404) {
      return mkErr(`apply: Ez a hirdet\xE9s nem \xE1ll\xE1saj\xE1nlat vagy nem tal\xE1lhat\xF3. [${e.status}] ${e.message}`);
    }
    if (e.status === 400) {
      return mkErr(`apply: \xC9rv\xE9nytelen k\xE9r\xE9s. [${e.status}] ${e.message}`);
    }
    if (e.status === 401) {
      return mkErr(`apply: Hiteles\xEDt\xE9s sz\xFCks\xE9ges. Ellen\u0151rizd a tokenedet. [${e.status}] ${e.message}`);
    }
    return mkErr(`apply: [${e.status}] ${e.message}`);
  }
  return mkErr(`apply: ${String(e)}`);
}
function buildAuthHeaders(opts) {
  const key = opts.noEnvFallback ? opts.apiKey : opts.apiKey ?? process.env["HASZNO_API_TOKEN"] ?? process.env["HASZNO_API_KEY"] ?? process.env["ARFUTAR_API_KEY"];
  const headers = {
    Accept: "application/json",
    "User-Agent": "haszno-mcp/0.5.0"
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
function resolveBaseUrl(opts) {
  return (opts.baseUrl ?? (opts.noEnvFallback ? void 0 : process.env["HASZNO_API_URL"] ?? process.env["ARFUTAR_API_URL"]) ?? "https://haszno.com").replace(/\/$/, "");
}
async function putRawBinary(apiPath, bytes, mimeType, extraHeaders, opts) {
  const baseUrl = resolveBaseUrl(opts);
  const fetchFn = opts.fetch ?? fetch;
  const response = await fetchFn(`${baseUrl}${apiPath}`, {
    method: "PUT",
    headers: {
      ...buildAuthHeaders(opts),
      "Content-Type": mimeType,
      ...extraHeaders
    },
    body: bytes
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    let code;
    try {
      const data = await response.json();
      if (data.error) message = data.error;
      if (data.code) code = data.code;
    } catch {
    }
    throw new HasznoApiError(response.status, message, code);
  }
  const text = await response.text();
  if (!text) return void 0;
  return JSON.parse(text);
}
async function getRawBinary(apiPath, opts) {
  const baseUrl = resolveBaseUrl(opts);
  const fetchFn = opts.fetch ?? fetch;
  const response = await fetchFn(`${baseUrl}${apiPath}`, {
    method: "GET",
    headers: buildAuthHeaders(opts)
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    let code;
    try {
      const data = await response.json();
      if (data.error) message = data.error;
      if (data.code) code = data.code;
    } catch {
    }
    throw new HasznoApiError(response.status, message, code);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
var PDF_MAGIC = Buffer.from("%PDF-");
var MAX_CV_SIZE_BYTES = 4 * 1024 * 1024;
function isPdf(buf) {
  if (buf.length < 5) return false;
  return buf.subarray(0, 5).equals(PDF_MAGIC);
}
function registerJobTools(server, opts, flags = {}) {
  if (flags.remote) {
    opts = { ...opts, noEnvFallback: true };
  }
  const DESIRED_SECTORS = [
    "it",
    "ertekesites",
    "ugyfelszolgalat",
    "adminisztracio",
    "penzugy",
    "marketing",
    "vendeglatas",
    "epitoipar",
    "gyartas",
    "logisztika",
    "egeszsegugy",
    "oktatas",
    "mezogazdasag",
    "szepsegipar",
    "egyeb"
  ];
  server.registerTool(
    "haszno_shop_job_profile_get",
    {
      title: "Get job-seeker profile",
      description: "Returns the authenticated user's job-seeker profile, or null if no profile exists yet. The profile includes: fullName, email, phone, headline, about, skills, desiredSectors, cvFileName, cvSize, cvUpdatedAt, consentAt, autoApply, updatedAt. The PDF bytes of the CV are never returned here \u2014 use the web UI to view it, or haszno_shop_job_applicant_cv_download (advertiser side) to download an applicant's CV. CV content and personal data are sensitive \u2014 do not paste them into other services or logs.",
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async () => {
      try {
        const result = await get("/api/v1/shop/jobs/profile", opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "job_profile_get");
      }
    }
  );
  server.registerTool(
    "haszno_shop_job_profile_save",
    {
      title: "Save / update job-seeker profile",
      description: `Creates or updates the authenticated user's job-seeker profile. On the FIRST save, consent must be true (the user consents to sharing their data with advertisers when they apply). autoApply controls whether agent (token-authenticated) applications are allowed. The agent may set autoApply ONLY when the user explicitly asks for it in the conversation. If the API returns auto_apply_disabled (403) on a later apply call, tell the user to enable "Automatikus jelentkez\xE9s \xFCgyn\xF6kkel" at https://haszno.com/shop/oneletrajzom. PUT /api/v1/shop/jobs/profile \u2192 { profile }.`,
      inputSchema: {
        fullName: z.string().min(2).max(120).describe("Full name (2\u2013120 characters)"),
        email: z.string().email().describe("Contact e-mail address"),
        phone: z.string().optional().describe("Phone number (optional)"),
        headline: z.string().max(160).optional().describe("Short professional headline (\u2264160 characters)"),
        about: z.string().max(2e3).optional().describe("About / bio text (\u22642000 characters)"),
        skills: z.array(z.string().max(40)).max(30).optional().describe("List of skills (up to 30 items, each \u226440 characters)"),
        desiredSectors: z.array(z.enum(DESIRED_SECTORS)).optional().describe(
          "Desired job sectors. Valid values: it, ertekesites, ugyfelszolgalat, adminisztracio, penzugy, marketing, vendeglatas, epitoipar, gyartas, logisztika, egeszsegugy, oktatas, mezogazdasag, szepsegipar, egyeb"
        ),
        consent: z.boolean().describe(
          "Must be true: confirms the user consents to sharing their profile data with advertisers when applying for jobs. Required on the first save; must stay true on subsequent saves."
        ),
        autoApply: z.boolean().optional().describe(
          "When true, allows agent (token-authenticated) applications on the user's behalf. Set this ONLY when the user explicitly asks to enable automatic agent applications. Default: false."
        )
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async (args) => {
      try {
        const body = {
          fullName: args.fullName,
          email: args.email,
          consent: args.consent
        };
        if (args.phone !== void 0) body["phone"] = args.phone;
        if (args.headline !== void 0) body["headline"] = args.headline;
        if (args.about !== void 0) body["about"] = args.about;
        if (args.skills !== void 0) body["skills"] = args.skills;
        if (args.desiredSectors !== void 0) body["desiredSectors"] = args.desiredSectors;
        if (args.autoApply !== void 0) body["autoApply"] = args.autoApply;
        const result = await put("/api/v1/shop/jobs/profile", body, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "job_profile_save");
      }
    }
  );
  server.registerTool(
    "haszno_shop_job_profile_delete",
    {
      title: "Delete job-seeker profile",
      description: "Permanently deletes the authenticated user's job-seeker profile and uploaded CV. This action is irreversible: all profile data, the CV file, and the consent record are removed. Existing submitted applications are not deleted (they remain in the advertiser's view). Only call this when the user explicitly asks to delete their profile. DELETE /api/v1/shop/jobs/profile \u2192 { ok: true }.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }
    },
    async () => {
      try {
        const result = await del("/api/v1/shop/jobs/profile", opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "job_profile_delete");
      }
    }
  );
  if (flags.remote) {
    server.registerTool(
      "haszno_shop_job_cv_get",
      {
        title: "Download own CV (remote mode)",
        description: "Remote MCP mode: the CV cannot be streamed as bytes through the hosted MCP endpoint. To view or download your CV, open your profile page: https://haszno.com/shop/oneletrajzom. CV content is personal data \u2014 do not share it with other services.",
        annotations: { readOnlyHint: true, destructiveHint: false }
      },
      async () => {
        return json({
          notice: "Remote MCP mode: az \xF6n\xE9letrajz nem t\xF6lthet\u0151 le b\xE1jtonk\xE9nt a hosted MCP v\xE9gponton kereszt\xFCl. A PDF megtekint\xE9s\xE9hez nyisd meg a profil oldalt: https://haszno.com/shop/oneletrajzom"
        });
      }
    );
  } else {
    server.registerTool(
      "haszno_shop_job_cv_get",
      {
        title: "Download own CV to a local file",
        description: "Downloads the authenticated user's own CV PDF to a local file. Provide savePath for the destination (e.g. /tmp/my-cv.pdf). If savePath is omitted, the file is saved to the system temp directory. Returns the saved file path and size. CV content is personal data \u2014 do not paste it into other services or logs. GET /api/v1/shop/jobs/profile/cv \u2192 PDF (binary).",
        inputSchema: {
          savePath: z.string().optional().describe("Absolute path where the PDF will be saved (e.g. /tmp/my-cv.pdf). Defaults to a temp file.")
        },
        annotations: { readOnlyHint: true, destructiveHint: false }
      },
      async (args) => {
        try {
          const pdfBuffer = await getRawBinary("/api/v1/shop/jobs/profile/cv", opts);
          const dest = args.savePath ?? path.join(os.tmpdir(), "haszno-my-cv.pdf");
          try {
            fs.writeFileSync(dest, pdfBuffer);
          } catch (e) {
            return mkErr(`job_cv_get: Nem siker\xFClt menteni a f\xE1jlt (${dest}): ${String(e)}`);
          }
          return json({ savedPath: dest, sizeBytes: pdfBuffer.length });
        } catch (e) {
          return mapApiError(e, "job_cv_get");
        }
      }
    );
  }
  if (flags.remote) {
    server.registerTool(
      "haszno_shop_job_cv_upload",
      {
        title: "Upload CV (remote mode \u2014 base64 only)",
        description: "Uploads a PDF CV for the authenticated user's job-seeker profile. Remote MCP mode: only base64-encoded PDF data is accepted. The PDF must start with the %PDF- magic bytes. Maximum size: 4 MB. A profile with consent:true must already exist (create one with haszno_shop_job_profile_save first). Returns { profile } with updated cvFileName, cvSize, cvUpdatedAt. CV content is personal data \u2014 do not paste it into other services or logs.",
        inputSchema: {
          base64: z.string().describe("Base64-encoded PDF data (without the data: URI prefix)."),
          fileName: z.string().min(1).max(255).describe('File name for the CV (e.g. "cv.pdf").')
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
      },
      async (args) => {
        let buffer;
        try {
          buffer = Buffer.from(args.base64, "base64");
        } catch (e) {
          return mkErr(`cv_upload: \xC9rv\xE9nytelen base64 adat: ${String(e)}`);
        }
        if (!isPdf(buffer)) {
          return mkErr("cv_upload: A f\xE1jl nem PDF form\xE1tum\xFA (%PDF- m\xE1gikus b\xE1jtok hi\xE1nyoznak).");
        }
        if (buffer.length > MAX_CV_SIZE_BYTES) {
          return mkErr(`cv_upload: A f\xE1jl m\xE9rete (${(buffer.length / 1024 / 1024).toFixed(1)} MB) meghaladja a 4 MB-os hat\xE1rt.`);
        }
        try {
          const result = await putRawBinary(
            "/api/v1/shop/jobs/profile/cv",
            buffer,
            "application/pdf",
            { "X-File-Name": encodeURIComponent(args.fileName) },
            opts
          );
          return json(result);
        } catch (e) {
          return mapApiError(e, "cv_upload");
        }
      }
    );
  } else {
    server.registerTool(
      "haszno_shop_job_cv_upload",
      {
        title: "Upload CV (local or base64)",
        description: `Uploads a PDF CV for the authenticated user's job-seeker profile. Provide either an absolute local file path ("filePath") OR base64-encoded data ("base64" + "fileName"). The PDF must start with the %PDF- magic bytes. Maximum size: 4 MB. A profile with consent:true must already exist (create one with haszno_shop_job_profile_save first). Returns { profile } with updated cvFileName, cvSize, cvUpdatedAt. CV content is personal data \u2014 do not paste it into other services or logs.`,
        inputSchema: {
          filePath: z.string().optional().describe("Absolute path to a local PDF file (e.g. /home/user/cv.pdf). Provide this OR base64/fileName."),
          base64: z.string().optional().describe("Base64-encoded PDF data (without the data: URI prefix). Provide together with fileName."),
          fileName: z.string().min(1).max(255).optional().describe('File name for the CV when using base64 (e.g. "cv.pdf"). Also used as the display name when filePath is provided.')
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
      },
      async (args) => {
        let buffer;
        let displayName;
        if (!args.filePath && !args.base64) {
          return mkErr("cv_upload: Adj meg vagy filePath-t (abszol\xFAt PDF-\xFAtvonal) vagy base64 + fileName p\xE1rt.");
        }
        if (args.base64 && !args.fileName) {
          return mkErr("cv_upload: base64 megad\xE1sakor fileName is sz\xFCks\xE9ges.");
        }
        if (args.filePath) {
          try {
            buffer = fs.readFileSync(args.filePath);
          } catch (e) {
            return mkErr(`cv_upload: Nem siker\xFClt beolvasni a f\xE1jlt (${args.filePath}): ${String(e)}`);
          }
          displayName = args.fileName ?? path.basename(args.filePath);
        } else {
          try {
            buffer = Buffer.from(args.base64, "base64");
          } catch (e) {
            return mkErr(`cv_upload: \xC9rv\xE9nytelen base64 adat: ${String(e)}`);
          }
          displayName = args.fileName;
        }
        if (!isPdf(buffer)) {
          return mkErr("cv_upload: A f\xE1jl nem PDF form\xE1tum\xFA (%PDF- m\xE1gikus b\xE1jtok hi\xE1nyoznak).");
        }
        if (buffer.length > MAX_CV_SIZE_BYTES) {
          return mkErr(`cv_upload: A f\xE1jl m\xE9rete (${(buffer.length / 1024 / 1024).toFixed(1)} MB) meghaladja a 4 MB-os hat\xE1rt.`);
        }
        try {
          const result = await putRawBinary(
            "/api/v1/shop/jobs/profile/cv",
            buffer,
            "application/pdf",
            { "X-File-Name": encodeURIComponent(displayName) },
            opts
          );
          return json(result);
        } catch (e) {
          return mapApiError(e, "cv_upload");
        }
      }
    );
  }
  server.registerTool(
    "haszno_shop_job_matches",
    {
      title: "Get job matches for my profile",
      description: "Returns active Haszno job-offer ads scored against the authenticated user's profile. Excludes the user's own ads and ads already applied to. Each match includes: adId, title, sector, employment, workMode, location, wage, wagePeriod, wageType, excerpt, score (match score), matchedSkills, url (/shop/hirdetes/<id>), createdAt. Requires a profile to be set up first (haszno_shop_job_profile_save). GET /api/v1/shop/jobs/matches?limit=\u2026",
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional().describe("Number of matches to return (1\u201350, default 20)")
      },
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async (args) => {
      try {
        const qs = new URLSearchParams();
        if (args.limit != null) qs.set("limit", String(args.limit));
        const suffix = qs.toString() ? `?${qs}` : "";
        const result = await get(`/api/v1/shop/jobs/matches${suffix}`, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "job_matches");
      }
    }
  );
  server.registerTool(
    "haszno_shop_job_apply",
    {
      title: "Apply for a job ad",
      description: `Applies for a Haszno job-offer ad on behalf of the authenticated user. Sending an application forwards the user's stored CV and contact data to the advertiser \u2014 this is a write action in the user's name. 

Product rules:
- Apply only to jobs that genuinely match the user's profile and stated wishes. Never mass-apply.
- The daily limit is 20 applications per user per day.
- Each ad can only be applied to once per user.
- Report every application made back to the user.
- Token (agent) applications only work after the user has enabled "Automatikus jelentkez\xE9s \xFCgyn\xF6kkel" (autoApply). If the API returns auto_apply_disabled (403), stop and tell the user how to enable it at https://haszno.com/shop/oneletrajzom. Never try to work around this.
- The agent may set autoApply via haszno_shop_job_profile_save ONLY when the user explicitly asks.
- External remote jobs (Himalayas/Jobicy feed) cannot be applied to through Haszno.
POST /api/v1/shop/ads/{adId}/applications \u2192 201 { application }.`,
      inputSchema: {
        adId: z.number().int().positive().describe("ID of the Haszno job-offer ad to apply to"),
        message: z.string().max(2e3).optional().describe("Optional cover message to the advertiser (\u22642000 characters)")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const body = {};
        if (args.message !== void 0) body["message"] = args.message;
        const result = await post(`/api/v1/shop/ads/${args.adId}/applications`, body, opts);
        return json(result);
      } catch (e) {
        return mapApplyError(e, args.adId);
      }
    }
  );
  server.registerTool(
    "haszno_shop_job_my_applications",
    {
      title: "List my job applications",
      description: `Returns the authenticated user's submitted job applications. Each item includes: id, adId, adTitle, adStatus, status, message, via, createdAt, withdrawnAt, statusChangedAt, hasCv. Status values: "uj" (new/unread), "megnezve" (seen), "behivva" (invited), "elutasitva" (rejected), "felveve" (hired). GET /api/v1/shop/my/applications \u2192 { items: MyApplication[] }.`,
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async () => {
      try {
        const result = await get("/api/v1/shop/my/applications", opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "job_my_applications");
      }
    }
  );
  server.registerTool(
    "haszno_shop_job_withdraw",
    {
      title: "Withdraw a job application",
      description: "Withdraws (cancels) a previously submitted job application. POST /api/v1/shop/my/applications/{id}/withdraw \u2192 { application }. The application status will reflect the withdrawal.",
      inputSchema: {
        id: z.number().int().positive().describe("Application ID (from haszno_shop_job_my_applications)")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/my/applications/${args.id}/withdraw`, {}, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "job_withdraw");
      }
    }
  );
  server.registerTool(
    "haszno_shop_job_applicants_list",
    {
      title: "List applicants for my job ads",
      description: `Returns applications received for the authenticated user's job-offer ads. Filter by adId to see applicants for a specific ad, or by status to narrow results. Each item includes: id, adId, adTitle, name, email, phone, headline, message, status, employerNote, via ("web"|"agent"), hasCv, cvFileName, cvSize, createdAt, readAt, withdrawnAt, statusChangedAt. Also returns counts: { total, unread }. CV content and applicants' personal data (name, email, phone) are sensitive \u2014 do not paste them into other services or logs. GET /api/v1/shop/my/job-applications?adId=&status= \u2192 { items: ReceivedApplication[], counts }.`,
      inputSchema: {
        adId: z.number().int().positive().optional().describe("Filter by a specific job ad ID"),
        status: z.string().optional().describe('Filter by application status (e.g. "uj", "megnezve", "behivva", "elutasitva", "felveve")')
      },
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async (args) => {
      try {
        const qs = new URLSearchParams();
        if (args.adId != null) qs.set("adId", String(args.adId));
        if (args.status) qs.set("status", args.status);
        const suffix = qs.toString() ? `?${qs}` : "";
        const result = await get(`/api/v1/shop/my/job-applications${suffix}`, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "job_applicants_list");
      }
    }
  );
  server.registerTool(
    "haszno_shop_job_applicant_update",
    {
      title: "Update the status or note on an applicant",
      description: 'Updates the status and/or employer note on a received job application (advertiser side). Status values: "uj" (new), "megnezve" (seen), "behivva" (invited to interview), "elutasitva" (rejected), "felveve" (hired). employerNote is a private note visible only to the advertiser (\u22642000 characters). PATCH /api/v1/shop/my/job-applications/{id} \u2192 { application }.',
      inputSchema: {
        id: z.number().int().positive().describe("Application ID (from haszno_shop_job_applicants_list)"),
        status: z.enum(["uj", "megnezve", "behivva", "elutasitva", "felveve"]).optional().describe("New application status"),
        employerNote: z.string().max(2e3).optional().describe("Private employer note (\u22642000 characters, visible only to you)")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async (args) => {
      try {
        const body = {};
        if (args.status !== void 0) body["status"] = args.status;
        if (args.employerNote !== void 0) body["employerNote"] = args.employerNote;
        if (Object.keys(body).length === 0) {
          return mkErr("job_applicant_update: Adj meg legal\xE1bb egyet: status vagy employerNote.");
        }
        const result = await patch(`/api/v1/shop/my/job-applications/${args.id}`, body, opts);
        return json(result);
      } catch (e) {
        return mapApiError(e, "job_applicant_update");
      }
    }
  );
  if (flags.remote) {
    server.registerTool(
      "haszno_shop_job_applicant_cv_download",
      {
        title: "Download applicant CV (remote mode)",
        description: "Remote MCP mode: the applicant's CV cannot be streamed as bytes through the hosted MCP endpoint. To view or download the CV, open the application in the Haszno advertiser panel: https://haszno.com/shop/palyazatok. CV content and applicants' personal data are sensitive \u2014 do not share them with other services.",
        inputSchema: {
          id: z.number().int().positive().describe("Application ID (from haszno_shop_job_applicants_list)")
        },
        annotations: { readOnlyHint: true, destructiveHint: false }
      },
      async () => {
        return json({
          notice: "Remote MCP mode: a p\xE1ly\xE1z\xF3 \xF6n\xE9letrajza nem t\xF6lthet\u0151 le b\xE1jtonk\xE9nt a hosted MCP v\xE9gponton kereszt\xFCl. A PDF megtekint\xE9s\xE9hez nyisd meg a hirdet\u0151fel\xFCletet: https://haszno.com/shop/palyazatok"
        });
      }
    );
  } else {
    server.registerTool(
      "haszno_shop_job_applicant_cv_download",
      {
        title: "Download applicant CV to a local file",
        description: "Downloads a job applicant's CV PDF to a local file (advertiser side). Provide savePath for the destination (e.g. /tmp/applicant-cv.pdf). If savePath is omitted, the file is saved to the system temp directory. Returns the saved file path and size. CV content and applicants' personal data are sensitive \u2014 do not paste them into other services or logs. GET /api/v1/shop/my/job-applications/{id}/cv \u2192 PDF (binary).",
        inputSchema: {
          id: z.number().int().positive().describe("Application ID (from haszno_shop_job_applicants_list)"),
          savePath: z.string().optional().describe("Absolute path where the PDF will be saved (e.g. /tmp/cv.pdf). Defaults to a temp file.")
        },
        annotations: { readOnlyHint: true, destructiveHint: false }
      },
      async (args) => {
        try {
          const pdfBuffer = await getRawBinary(`/api/v1/shop/my/job-applications/${args.id}/cv`, opts);
          const dest = args.savePath ?? path.join(os.tmpdir(), `haszno-cv-${args.id}.pdf`);
          try {
            fs.writeFileSync(dest, pdfBuffer);
          } catch (e) {
            return mkErr(`job_applicant_cv_download: Nem siker\xFClt menteni a f\xE1jlt (${dest}): ${String(e)}`);
          }
          return json({ savedPath: dest, sizeBytes: pdfBuffer.length });
        } catch (e) {
          return mapApiError(e, "job_applicant_cv_download");
        }
      }
    );
  }
}

// src/tools/shop.ts
function json2(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
function mkErr2(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}
function mapApiError2(e, context) {
  if (e instanceof HasznoApiError) {
    const extra = e.status === 400 ? " (\xE9rv\xE9nytelen k\xE9r\xE9s \u2014 ellen\u0151rizd a k\xF6telez\u0151 mez\u0151ket)" : e.status === 401 ? " (hiteles\xEDt\xE9s sz\xFCks\xE9ges \u2014 ellen\u0151rizd a tokenedet)" : e.status === 403 ? " (nincs jogosults\xE1god ehhez a m\u0171velethez)" : e.status === 404 ? " (nem tal\xE1lhat\xF3)" : e.status === 409 ? " (\xFCtk\xF6z\xE9s \u2014 olvass r\xE1 a hiba\xFCzenetre)" : e.status === 422 ? " (feldolgoz\xE1si hiba)" : e.status === 429 ? " (t\xFAl sok k\xE9r\xE9s \u2014 pr\xF3b\xE1ld \xFAjra k\xE9s\u0151bb)" : "";
    return mkErr2(`${context}: [${e.status}] ${e.message}${extra}`);
  }
  return mkErr2(`${context}: ${String(e)}`);
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
async function uploadRawBinary(path2, bytes, mimeType, opts) {
  const baseUrl = (opts.baseUrl ?? (opts.noEnvFallback ? void 0 : process.env["HASZNO_API_URL"] ?? process.env["ARFUTAR_API_URL"]) ?? "https://haszno.com").replace(/\/$/, "");
  const fetchFn = opts.fetch ?? fetch;
  const response = await fetchFn(`${baseUrl}${path2}`, {
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
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "list_categories");
      }
    }
  );
  server.registerTool(
    "haszno_shop_search_ads",
    {
      title: "Search public ads",
      description: 'Searches the public Haszno Hirdet\xE9si Piact\xE9r (marketplace) for second-hand ads. Returns a paginated list of ads including their id, title, priceGross (HUF), status, images, and a "reserved" flag (true when an accepted reservation exists for the ad). The Shop is free \u2014 no fees for browsing or contacting sellers. Filter by category with cat (category key string from haszno_shop_list_categories), full-text search with q, price range with min/max (HUF). Sort: "uj" (newest, default), "ar_nov" (price ascending), "ar_csokk" (price descending).',
      inputSchema: {
        q: z2.string().optional().describe("Full-text search query"),
        cat: z2.string().optional().describe('Filter by category key (e.g. "auto", "elektronika")'),
        sub: z2.string().optional().describe('Filter by subcategory key (e.g. "szemelyauto")'),
        min: z2.number().int().min(0).optional().describe("Minimum price in HUF gross"),
        max: z2.number().int().min(0).optional().describe("Maximum price in HUF gross"),
        county: z2.string().optional().describe("Filter by county name (from taxonomy counties list)"),
        city: z2.string().optional().describe("Filter by city name"),
        cond: z2.enum(["uj", "ujszeru", "hasznalt", "serult"]).optional().describe("Product condition filter"),
        sort: z2.enum(["uj", "ar_nov", "ar_csokk"]).optional().describe('"uj" (newest), "ar_nov" (price asc), "ar_csokk" (price desc)'),
        page: z2.number().int().min(1).optional().describe("Page number (default 1, page size 24)")
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
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "search_ads");
      }
    }
  );
  server.registerTool(
    "haszno_shop_get_ad",
    {
      title: "Get a single ad",
      description: 'Fetches the full detail of a Haszno marketplace ad by its ID. Returns all fields including images, attributes (attrs), seller info, and the "reserved" flag (true when an accepted reservation exists). The Shop is free \u2014 browsing and contacting sellers costs nothing.',
      inputSchema: {
        id: z2.number().int().min(1).describe("Ad ID")
      },
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async (args) => {
      try {
        const result = await get(`/api/v1/shop/ads/${args.id}`, opts);
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "get_ad");
      }
    }
  );
  server.registerTool(
    "haszno_shop_price_hint",
    {
      title: "Get a suggested price hint",
      description: "Returns a suggested asking price range (p25\u2013p75 percentile) for a category, based on at least 5 distinct sellers' active listings. Returns null when there is not enough data. Use this before calling haszno_shop_create_ad to set a realistic priceGross. Pass cat (category key from haszno_shop_list_categories) and optionally sub (subcategory key).",
      inputSchema: {
        cat: z2.string().describe('Category key (e.g. "auto", "elektronika") from haszno_shop_list_categories'),
        sub: z2.string().optional().describe("Subcategory key to narrow the hint"),
        q: z2.string().optional().describe("Item description or keywords (accepted but ignored by the server)")
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
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "price_hint");
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
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "list_my_ads");
      }
    }
  );
  server.registerTool(
    "haszno_shop_list_inquiries",
    {
      title: "List inquiries on my ads",
      description: "Returns messages/questions sent to your ads by potential buyers. Optionally filter by adId to see inquiries for a specific ad. Pagination: use limit (1\u2013200, default 50) and offset (default 0). Requires authentication.",
      inputSchema: {
        adId: z2.number().int().min(1).optional().describe("Filter by a specific ad ID"),
        limit: z2.number().int().min(1).max(200).optional().describe("Page size (default 50, max 200)"),
        offset: z2.number().int().min(0).optional().describe("Skip this many items (default 0)")
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
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "list_inquiries");
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
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "list_favorites");
      }
    }
  );
  server.registerTool(
    "haszno_shop_list_reservations",
    {
      title: "List my reservations",
      description: `Returns reservations for the authenticated user. Use role="buyer" (default) to list reservations YOU placed on other people's ads. Use role="seller" to list reservations buyers placed on YOUR ads. Status values: "fuggoben" (pending), "elfogadva" (accepted), "elutasitva" (declined/auto-declined), "visszavonva" (cancelled by buyer), "teljesitve" (completed), "lejart" (hold expired). Contact fields (phone, email) are only filled in when status is "elfogadva" or "teljesitve". Price negotiation fields: offerPriceGross (buyer's last offer), counterPriceGross (seller's active counter-offer, null when none), agreedPriceGross (the mutually agreed price set at acceptance). After a reservation is "teljesitve", both parties can leave a review with haszno_shop_review. Reserving is not paying \u2014 payment and handover happen directly between buyer and seller.`,
      inputSchema: {
        role: z2.enum(["buyer", "seller"]).optional().describe('Whose perspective: "buyer" (default) or "seller"'),
        status: z2.string().optional().describe("Filter by reservation status"),
        page: z2.number().int().min(1).optional().describe("Page number (default 1)")
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
        return mapApiError2(e, "list_reservations");
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
      return mkErr2(`Nem t\xE1mogatott MIME t\xEDpus: ${mimeType}. Csak image/jpeg, image/png \xE9s image/webp elfogadott.`);
    }
    let buffer;
    try {
      buffer = Buffer.from(base64, "base64");
    } catch (e) {
      return mkErr2(`\xC9rv\xE9nytelen base64 adat: ${String(e)}`);
    }
    if (buffer.length > MAX_SIZE_BYTES_UPLOAD) {
      return mkErr2(`A k\xE9p m\xE9rete (${(buffer.length / 1024).toFixed(0)} KB) meghaladja a 700 KB-os hat\xE1rt.`);
    }
    const mime = detectMimeFromBytes(buffer);
    if (!mime) {
      return mkErr2("A base64 adat nem felismerhet\u0151 k\xE9pform\xE1tum (JPEG, PNG vagy WebP sz\xFCks\xE9ges).");
    }
    if (mime !== mimeType) {
      return mkErr2(`A k\xE9p val\xF3di form\xE1tuma (${mime}) nem egyezik a megadott mimeType \xE9rt\xE9kkel (${mimeType}).`);
    }
    try {
      const result = await uploadRawBinary("/api/v1/shop/images", buffer, mime, opts);
      return json2(result);
    } catch (e) {
      return mapApiError2(e, "upload_image");
    }
  }
  if (flags.remote) {
    server.registerTool(
      "haszno_shop_upload_image",
      {
        title: "Upload an ad image (remote mode \u2014 base64 only)",
        description: `Uploads an image for use in a Haszno marketplace ad. Remote MCP mode: only base64-encoded image data is accepted \u2014 filePath is not available because the server cannot access the client's local filesystem. Provide base64-encoded image data together with its MIME type. Returns an object with "id" (numeric image ID) and "url" (path like /api/shop/images/<id>). \u2014 Pass url in the "images" array of haszno_shop_create_ad or haszno_shop_update_ad. \u2014 Pass id in the "imageIds" array of haszno_shop_suggest_from_photos. Supported MIME types: image/jpeg, image/png, image/webp. Maximum size: 700 KB.`,
        inputSchema: {
          base64: z2.string().describe(
            "Base64-encoded image data (without the data: URI prefix)."
          ),
          mimeType: z2.string().describe(
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
          filePath: z2.string().optional().describe(
            "Absolute path to a local image file (e.g. /home/user/photo.jpg). Provide this OR base64/mimeType."
          ),
          base64: z2.string().optional().describe(
            "Base64-encoded image data (without the data: URI prefix). Provide together with mimeType."
          ),
          mimeType: z2.string().optional().describe(
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
        let buffer;
        let detectedMime;
        if (args.filePath) {
          const ext = args.filePath.split(".").pop()?.toLowerCase() ?? "";
          if (!ALLOWED_EXTS_UPLOAD.has(ext)) {
            return mkErr2(`Csak JPEG, PNG \xE9s WebP f\xE1jlok t\xF6lthet\u0151k fel (kapott kiterjeszt\xE9s: .${ext || "ismeretlen"}).`);
          }
          try {
            buffer = fs2.readFileSync(args.filePath);
          } catch (e) {
            return mkErr2(`Nem siker\xFClt beolvasni a f\xE1jlt: ${String(e)}`);
          }
          if (buffer.length > MAX_SIZE_BYTES_UPLOAD) {
            return mkErr2(`A f\xE1jl m\xE9rete (${(buffer.length / 1024).toFixed(0)} KB) meghaladja a 700 KB-os hat\xE1rt.`);
          }
          const mime = detectMimeFromBytes(buffer);
          if (!mime) {
            return mkErr2("A f\xE1jl nem felismerhet\u0151 k\xE9pform\xE1tum (JPEG, PNG vagy WebP sz\xFCks\xE9ges).");
          }
          const extMime = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
          if (mime !== extMime[ext]) {
            return mkErr2(`A f\xE1jl tartalma (${mime}) nem egyezik a kiterjeszt\xE9ssel (.${ext}).`);
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
          return json2(result);
        } catch (e) {
          return mapApiError2(e, "upload_image");
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
        imageIds: z2.array(z2.number().int().min(1)).min(1).max(3).describe(
          "Numeric image IDs from haszno_shop_upload_image (1\u20133 IDs)"
        )
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const result = await post("/api/v1/shop/assist/from-photos", { imageIds: args.imageIds }, opts);
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "suggest_from_photos");
      }
    }
  );
  server.registerTool(
    "haszno_shop_create_ad",
    {
      title: "Post a new marketplace ad",
      description: 'Creates a new Haszno Hirdet\xE9si Piact\xE9r (marketplace) ad. This is a REAL action \u2014 the ad becomes immediately visible to all users on haszno.com. Only call this when the user has explicitly confirmed they want to post the ad. The Haszno Shop is completely free \u2014 there are no listing fees. Before calling this tool: (1) call haszno_shop_list_categories to get the category key, subcategory key, required attrs, and valid county names; (2) call haszno_shop_upload_image for each photo and collect the returned "url" values; (3) call haszno_shop_price_hint for a price suggestion. Image URLs must be in the format /api/shop/images/<id> (returned by haszno_shop_upload_image). This tool validates required category attributes before sending.',
      inputSchema: {
        category: z2.string().describe('Category key (e.g. "auto") from haszno_shop_list_categories'),
        subcategory: z2.string().optional().nullable().describe('Subcategory key (optional, e.g. "szemelya" for "auto")'),
        title: z2.string().min(5).max(120).describe("Ad title (5\u2013120 characters)"),
        description: z2.string().max(5e3).describe("Ad description (max 5000 chars)"),
        priceGross: z2.number().int().min(1).max(2e9).nullable().describe('Asking price in HUF gross, or null for "price on request"'),
        negotiable: z2.boolean().describe("Whether the price is negotiable"),
        condition: z2.enum(["uj", "ujszeru", "hasznalt", "serult"]).describe(
          'Product condition: "uj" (new), "ujszeru" (like new), "hasznalt" (used), "serult" (damaged)'
        ),
        defects: z2.string().min(10).max(2e3).optional().nullable().describe(
          'Description of defects or damage (minimum 10 characters). REQUIRED when condition is "hasznalt" (used) or "serult" (damaged) \u2014 the API will return HTTP 422 if this field is missing for those conditions.'
        ),
        county: z2.string().describe("Hungarian county name from haszno_shop_list_categories counties list"),
        city: z2.string().min(1).max(80).describe("City name"),
        images: z2.array(z2.string()).max(10).optional().describe(
          "Image URLs from haszno_shop_upload_image (format: /api/shop/images/<id>, max 10)"
        ),
        attrs: z2.record(z2.string(), z2.union([z2.string(), z2.number(), z2.boolean()])).optional().describe(
          'Category-specific attributes (e.g. { "allapot": "hasznalt", "marka": "Samsung" }). Required attributes depend on the category \u2014 call haszno_shop_list_categories to see them.'
        ),
        contactName: z2.string().min(1).max(80).describe("Seller contact name"),
        contactPhone: z2.string().optional().nullable().describe("Contact phone number (optional)"),
        contactEmail: z2.string().email().describe("Seller contact e-mail address"),
        showPhone: z2.boolean().describe("Whether to display the phone number publicly"),
        resellable: z2.boolean().describe("Allow partner shops to list this ad in their own webshops"),
        partnerCommissionPct: z2.number().min(0).max(30).describe("Commission % to offer partner shops (0\u201330)"),
        confirm: z2.literal(true).describe(
          "Must be exactly true. This posts a real, public ad \u2014 only set this after the user confirms."
        )
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      const attrs = args.attrs ?? {};
      const validationError = await validateCategoryAttributes(args.category, attrs, opts);
      if (validationError) {
        return mkErr2(validationError);
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
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "create_ad");
      }
    }
  );
  server.registerTool(
    "haszno_shop_update_ad",
    {
      title: "Update an existing ad",
      description: "Updates an existing Haszno marketplace ad (PUT \u2014 the server replaces the full ad). This tool first fetches the current ad values, merges in only the fields you provide, then sends the complete updated body. Only pass the fields you want to change. The ad must belong to the authenticated user. Image URLs must be in the format /api/shop/images/<id>. The Haszno Shop is free.",
      inputSchema: {
        id: z2.number().int().min(1).describe("Ad ID to update"),
        category: z2.string().optional().describe("Category key"),
        subcategory: z2.string().optional().nullable(),
        title: z2.string().min(5).max(120).optional(),
        description: z2.string().max(5e3).optional(),
        priceGross: z2.number().int().min(1).max(2e9).nullable().optional().describe('New asking price in HUF gross, or null for "price on request"'),
        negotiable: z2.boolean().optional(),
        condition: z2.enum(["uj", "ujszeru", "hasznalt", "serult"]).optional(),
        county: z2.string().optional(),
        city: z2.string().min(1).max(80).optional(),
        images: z2.array(z2.string()).max(10).optional().describe("Image URLs (/api/shop/images/<id> format)"),
        attrs: z2.record(z2.string(), z2.union([z2.string(), z2.number(), z2.boolean()])).optional(),
        contactName: z2.string().min(1).max(80).optional(),
        contactPhone: z2.string().optional().nullable(),
        contactEmail: z2.string().email().optional(),
        showPhone: z2.boolean().optional(),
        resellable: z2.boolean().optional(),
        partnerCommissionPct: z2.number().min(0).max(30).optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      const { id, ...updates } = args;
      let current;
      try {
        current = await get(`/api/v1/shop/my/ads/${id}`, opts);
      } catch (e) {
        return mapApiError2(e, `update_ad (fetch current state for id=${id})`);
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
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "update_ad");
      }
    }
  );
  server.registerTool(
    "haszno_shop_set_ad_status",
    {
      title: "Change ad status (pause, reactivate, or delete)",
      description: `Changes an ad's status. "szunetel" hides the ad from public search (paused); "aktiv" makes it visible again (also resets the expiry timer); "torolve" soft-deletes the ad permanently (irreversible). The ad must belong to the authenticated user.`,
      inputSchema: {
        id: z2.number().int().min(1).describe("Ad ID"),
        status: z2.enum(["aktiv", "szunetel", "torolve"]).describe(
          '"aktiv" to show, "szunetel" to pause, "torolve" to permanently delete'
        )
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/ads/${args.id}/status`, { status: args.status }, opts);
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "set_ad_status");
      }
    }
  );
  server.registerTool(
    "haszno_shop_mark_sold",
    {
      title: "Mark an ad as sold",
      description: 'Marks an ad as sold ("eladva"), removing it from public search. This is IRREVERSIBLE \u2014 a sold ad cannot be re-activated. Only call this when the user confirms the item has been sold. Side effect: all open reservations for this ad become "elutasitva" (declined). The Haszno Shop is free \u2014 there are no sales fees.',
      inputSchema: {
        id: z2.number().int().min(1).describe("Ad ID"),
        soldPriceGross: z2.number().int().min(1).optional().nullable().describe(
          "Actual sale price in HUF gross (optional, for your records)"
        ),
        confirm: z2.literal(true).describe(
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
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "mark_sold");
      }
    }
  );
  server.registerTool(
    "haszno_shop_renew_ad",
    {
      title: "Renew / bump an ad",
      description: "Renews an ad, resetting its 60-day expiry timer and bumping it back to the top of search results. Use this for ads that are about to expire or have fallen in ranking. The Haszno Shop is free \u2014 renewal has no cost.",
      inputSchema: {
        id: z2.number().int().min(1).describe("Ad ID to renew")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/ads/${args.id}/renew`, {}, opts);
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "renew_ad");
      }
    }
  );
  server.registerTool(
    "haszno_shop_send_inquiry",
    {
      title: "Send an inquiry to the seller",
      description: "Sends a message or question to the seller of an ad. The seller will be notified and can respond through Haszno. Requires name, email, and message (at least 5 characters). The Haszno Shop is free.",
      inputSchema: {
        adId: z2.number().int().min(1).describe("Ad ID to send the inquiry to"),
        name: z2.string().min(1).max(80).describe("Your name"),
        email: z2.string().email().describe("Your e-mail address"),
        phone: z2.string().max(50).optional().nullable().describe("Your phone number (optional)"),
        message: z2.string().min(5).max(2e3).describe("Your message or question for the seller (min 5 characters)")
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
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "send_inquiry");
      }
    }
  );
  server.registerTool(
    "haszno_shop_set_favorite",
    {
      title: "Save or remove a favorite",
      description: "Saves or removes an ad from your favorites list. Set save=true to add to favorites (PUT /favorite), save=false to remove (DELETE /favorite). The Haszno Shop is free.",
      inputSchema: {
        adId: z2.number().int().min(1).describe("Ad ID"),
        save: z2.boolean().describe("true to save as favorite, false to remove")
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
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "set_favorite");
      }
    }
  );
  server.registerTool(
    "haszno_shop_reserve_ad",
    {
      title: "Place a reservation on an ad",
      description: "Places a reservation on a Haszno marketplace ad. This is a REAL action visible to the seller immediately \u2014 only call this when the user has explicitly confirmed they want to reserve this item. IMPORTANT: Reserving is NOT paying. Payment and handover happen directly between buyer and seller outside Haszno \u2014 the platform only facilitates the initial contact. The Haszno Shop is completely free \u2014 no reservation fees. You may optionally include a message, a counter-offer price (offerPriceGross), and your phone number. The seller will accept or decline the reservation. Returns error 409 if you already have an open reservation for this ad.",
      inputSchema: {
        adId: z2.number().int().min(1).describe("Ad ID to reserve"),
        message: z2.string().max(1e3).optional().describe("Optional message to the seller (max 1000 chars)"),
        offerPriceGross: z2.number().int().min(1).optional().describe(
          "Counter-offer price in HUF gross (optional \u2014 omit to accept the listed price)"
        ),
        phone: z2.string().max(50).optional().describe(
          "Your phone number (optional; revealed to the seller only if they accept)"
        ),
        confirm: z2.literal(true).describe(
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
        return mapApiError2(e, "reserve_ad");
      }
    }
  );
  server.registerTool(
    "haszno_shop_respond_reservation",
    {
      title: "Accept or decline a reservation (seller)",
      description: `Accepts or declines a pending reservation on one of your ads (seller action). action="accept": marks the reservation as "elfogadva" (accepted); the buyer's contact details become visible to you in the reservation. action="decline": marks the reservation as "elutasitva" (declined); the ad remains active for other buyers. Response includes counterPriceGross (seller's last counter-offer if any) and agreedPriceGross (agreed price). You can also send a counter-offer first with haszno_shop_counter_offer before accepting. The Haszno Shop is free \u2014 accepting a reservation does NOT create a payment.`,
      inputSchema: {
        id: z2.number().int().min(1).describe("Reservation ID"),
        action: z2.enum(["accept", "decline"]).describe('"accept" or "decline"')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const path2 = `/api/v1/shop/my/reservations/${args.id}/${args.action}`;
        const result = await post(path2, {}, opts);
        return json2(result);
      } catch (e) {
        return mapApiError2(e, `respond_reservation(${args.action})`);
      }
    }
  );
  server.registerTool(
    "haszno_shop_cancel_reservation",
    {
      title: "Cancel your reservation (buyer)",
      description: 'Cancels a reservation you placed as a buyer (status becomes "visszavonva"). Only pending ("fuggoben") or accepted ("elfogadva") reservations can be cancelled. The Haszno Shop is free \u2014 cancellation has no cost.',
      inputSchema: {
        id: z2.number().int().min(1).describe("Reservation ID to cancel")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/my/reservations/${args.id}/cancel`, {}, opts);
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "cancel_reservation");
      }
    }
  );
  server.registerTool(
    "haszno_shop_complete_reservation",
    {
      title: "Complete a reservation (seller)",
      description: 'Marks a reservation as completed ("teljesitve"), confirming that the item has changed hands. This is a REAL, IRREVERSIBLE action \u2014 only call it when the user confirms the sale is done. Side effects: (1) the ad status changes to "eladva" (sold) and disappears from search; (2) all other open reservations for the same ad are automatically declined. Optionally record the actual sold price (soldPriceGross) for your records \u2014 it is not shared publicly. The response includes agreedPriceGross (the mutually agreed price if the buyer accepted a counter-offer). After completion, both buyer and seller can leave a rating with haszno_shop_review (sellerRating is the aggregate of these). REMINDER: Payment and handover happen directly between buyer and seller \u2014 Haszno does not process payments. The Haszno Shop is free \u2014 no commission on completed deals.',
      inputSchema: {
        id: z2.number().int().min(1).describe("Reservation ID"),
        soldPriceGross: z2.number().int().min(1).optional().nullable().describe(
          "Actual sale price in HUF gross (optional, for your records only)"
        ),
        confirm: z2.literal(true).describe(
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
        return mapApiError2(e, "complete_reservation");
      }
    }
  );
  server.registerTool(
    "haszno_shop_counter_offer",
    {
      title: "Send a counter-offer on a reservation (seller)",
      description: 'Seller sends a counter-offer price on a pending ("fuggoben") reservation. The buyer will be notified by e-mail and can accept it with haszno_shop_accept_counter, or ignore it and proceed normally. Can only be called on a "fuggoben" reservation that belongs to your ads. Returns the updated reservation with counterPriceGross set. The Haszno Shop is free \u2014 counter-offers carry no fee.',
      inputSchema: {
        id: z2.number().int().min(1).describe("Reservation ID"),
        priceGross: z2.number().int().min(1).describe("Counter-offer price in HUF gross (must be a positive integer)")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/my/reservations/${args.id}/counter`, { priceGross: args.priceGross }, opts);
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "counter_offer");
      }
    }
  );
  server.registerTool(
    "haszno_shop_accept_counter",
    {
      title: "Accept the seller's counter-offer (buyer)",
      description: `Buyer accepts the seller's active counter-offer on a pending ("fuggoben") reservation. After acceptance: offerPriceGross is updated to the accepted counter price, counterPriceGross is cleared. The reservation remains "fuggoben" \u2014 the seller still needs to formally accept it. Returns error 409 when there is no active counter-offer on this reservation. The Haszno Shop is free \u2014 acceptance does NOT create a payment.`,
      inputSchema: {
        id: z2.number().int().min(1).describe("Reservation ID")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/my/reservations/${args.id}/accept-counter`, {}, opts);
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "accept_counter");
      }
    }
  );
  server.registerTool(
    "haszno_shop_list_messages",
    {
      title: "List messages on a reservation",
      description: 'Returns the message thread for a reservation. Only the buyer and the seller of that reservation may read the messages. Each message has: id, author ("buyer" or "seller"), body (free text, may contain contact details), createdAt. Messages are ordered oldest first (up to 500). Requires authentication.',
      inputSchema: {
        id: z2.number().int().min(1).describe("Reservation ID")
      },
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async (args) => {
      try {
        const result = await get(`/api/v1/shop/my/reservations/${args.id}/messages`, opts);
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "list_messages");
      }
    }
  );
  server.registerTool(
    "haszno_shop_send_message",
    {
      title: "Send a message on a reservation",
      description: "Sends a free-text message on a reservation thread. Both the buyer and the seller of that reservation may send messages. The other party will be notified by e-mail (message excerpt only). The body may contain contact details (Haszno does not filter message content). Rate-limited to 20 messages per hour. Requires authentication.",
      inputSchema: {
        id: z2.number().int().min(1).describe("Reservation ID"),
        body: z2.string().min(1).max(2e3).describe("Message text (1\u20132000 characters)")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/my/reservations/${args.id}/messages`, { body: args.body }, opts);
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "send_message");
      }
    }
  );
  server.registerTool(
    "haszno_shop_review",
    {
      title: "Leave a review on a completed reservation",
      description: `Leaves a review (rating 1\u20135 + optional comment) on a completed ("teljesitve") reservation. Both the buyer and the seller can each leave exactly one review per reservation. Returns error 409 when the reservation is not "teljesitve" or when already reviewed. The aggregate of a seller's received reviews forms their sellerRating. This is a REAL action \u2014 only call when the user confirms they want to submit the review. The Haszno Shop is free \u2014 reviews are voluntary.`,
      inputSchema: {
        id: z2.number().int().min(1).describe('Reservation ID (must be "teljesitve" / completed)'),
        rating: z2.number().int().min(1).max(5).describe("Rating from 1 (worst) to 5 (best)"),
        comment: z2.string().max(1e3).optional().describe("Optional review comment (max 1000 characters)"),
        confirm: z2.literal(true).describe(
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
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "review");
      }
    }
  );
  server.registerTool(
    "haszno_shop_reply_inquiry",
    {
      title: "Reply to an inquiry (seller)",
      description: "Seller replies to an inquiry (question) a potential buyer sent on one of their ads. The inquirer is notified by e-mail with the reply. Only the seller who owns the ad may reply. Each inquiry can have at most ONE reply. Returns error 409 when the inquiry already has a reply. The Haszno Shop is free.",
      inputSchema: {
        id: z2.number().int().min(1).describe("Inquiry ID (from haszno_shop_list_inquiries)"),
        message: z2.string().min(1).max(2e3).describe("Reply message (1\u20132000 characters)")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/my/inquiries/${args.id}/reply`, { message: args.message }, opts);
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "reply_inquiry");
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
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "list_saved_searches");
      }
    }
  );
  server.registerTool(
    "haszno_shop_save_search",
    {
      title: "Save a search with optional e-mail alerts",
      description: "Saves a search filter set so the user can be notified by e-mail when matching new ads appear. Maximum 20 saved searches per user; returns error 422 when the cap is reached. alertEnabled defaults to true \u2014 set to false to save without notifications. The filters object accepts the same fields as haszno_shop_search_ads. Returns the created SavedSearch with its id. Requires authentication. The Haszno Shop is free.",
      inputSchema: {
        name: z2.string().min(1).max(80).describe("Human-readable name for this saved search (max 80 chars)"),
        filters: z2.object({
          q: z2.string().optional().describe("Full-text search query"),
          cat: z2.string().optional().describe("Category key"),
          sub: z2.string().optional().describe("Subcategory key"),
          min: z2.number().int().min(0).optional().describe("Minimum price in HUF gross"),
          max: z2.number().int().min(0).optional().describe("Maximum price in HUF gross"),
          county: z2.string().optional().describe("County name"),
          cond: z2.enum(["uj", "ujszeru", "hasznalt", "serult"]).optional().describe("Product condition")
        }).describe("Search filter criteria (same fields as haszno_shop_search_ads)"),
        alertEnabled: z2.boolean().optional().describe("Send e-mail alerts when new matching ads appear (default true)")
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
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "save_search");
      }
    }
  );
  server.registerTool(
    "haszno_shop_delete_saved_search",
    {
      title: "Delete a saved search",
      description: "Deletes a saved search by its id. If the id does not exist or does not belong to the authenticated user, the deletion is a no-op (idempotent). Returns { ok: true } on success. Requires authentication.",
      inputSchema: {
        id: z2.number().int().min(1).describe("Saved search ID (from haszno_shop_list_saved_searches)")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
    },
    async (args) => {
      try {
        const result = await del(`/api/v1/shop/my/saved-searches/${args.id}`, opts);
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "delete_saved_search");
      }
    }
  );
  server.registerTool(
    "haszno_shop_watch_price",
    {
      title: "Subscribe to / unsubscribe from price-drop alerts for an ad",
      description: `Subscribes to (watch=true) or unsubscribes from (watch=false) price-drop e-mail alerts for a specific ad. When subscribed, the user gets an e-mail when the ad's price drops. watch=true: PUT /api/v1/shop/ads/:adId/watch \u2014 the ad must be "aktiv"; returns { watched: true }. watch=false: DELETE /api/v1/shop/ads/:adId/watch \u2014 idempotent; returns { watched: false }. Returns error 400 if the ad is not active (watch=true only). Requires authentication. The Haszno Shop is free.`,
      inputSchema: {
        adId: z2.number().int().min(1).describe("Ad ID to watch or unwatch"),
        watch: z2.boolean().describe("true to subscribe to price-drop alerts, false to unsubscribe")
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
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "watch_price");
      }
    }
  );
  server.registerTool(
    "haszno_shop_import_from_url",
    {
      title: "Extract ad data from an external URL (draft only \u2014 never posts)",
      description: "Fetches a product or classifieds listing page by URL and extracts its metadata (title, description, price, images) for use as a pre-filled ad draft. This tool NEVER creates or posts an ad \u2014 it only returns extracted data. You must still call haszno_shop_create_ad (with confirm:true) separately after reviewing the result. Facebook URLs are rejected with a helpful error (login wall). Returns: title?, description?, price?, images (array of strings), parsed (extracted car/item attributes). Rate-limited to 10 imports per hour. Requires authentication.",
      inputSchema: {
        url: z2.string().url().max(2048).describe("Public URL of the product or classifieds listing page to import from")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const result = await post("/api/v1/shop/assist/url-import", { url: args.url }, opts);
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "import_from_url");
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
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "get_draft");
      }
    }
  );
  server.registerTool(
    "haszno_shop_save_draft",
    {
      title: "Save or update the ad creation draft",
      description: "Saves or replaces the authenticated user's server-side ad creation draft (upsert). Pass any subset of ad fields (same structure as haszno_shop_create_ad, without confirm). The draft is kept until the user explicitly clears it (haszno_shop_clear_draft) or posts the ad (haszno_shop_create_ad clears the draft automatically). Maximum draft size is 64 KB. Image URLs must be in /api/shop/images/<id> format. Returns { payload: {...}, updatedAt: string }. Requires authentication.",
      inputSchema: {
        payload: z2.record(z2.string(), z2.unknown()).describe(
          "Partial ad fields to store in the draft. Any subset of haszno_shop_create_ad fields is accepted (e.g. { title, category, priceGross, description, images, attrs, \u2026 }). Image URLs must be in /api/shop/images/<id> format (from haszno_shop_upload_image)."
        )
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async (args) => {
      try {
        const result = await put("/api/v1/shop/my/draft", args.payload, opts);
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "save_draft");
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
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "clear_draft");
      }
    }
  );
  server.registerTool(
    "haszno_shop_set_seller_profile",
    {
      title: "Set seller type (one-time setup required before first ad)",
      description: `Sets the seller type for the authenticated user's shop. This is a ONE-TIME setup that MUST be completed before posting the first ad \u2014 without it, haszno_shop_create_ad returns HTTP 409 "Az elad\xF3i t\xEDpus megad\xE1sa k\xF6telez\u0151 az els\u0151 hirdet\xE9s felad\xE1s\xE1hoz". Two seller types are supported: "maganszemely" (private individual) and "kereskedo" (registered business/trader). For "kereskedo", companyName and companyAddress are required. The profile can be updated later; calling this again replaces the existing value. Returns the updated seller profile. Requires authentication.`,
      inputSchema: {
        sellerType: z2.enum(["maganszemely", "kereskedo"]).describe(
          '"maganszemely" = private individual, "kereskedo" = business/trader'
        ),
        companyName: z2.string().min(1).max(200).optional().describe(
          'Company name (required when sellerType is "kereskedo")'
        ),
        companyAddress: z2.string().min(1).max(400).optional().describe(
          'Company registered address (required when sellerType is "kereskedo")'
        ),
        companyRegNumber: z2.string().max(50).optional().nullable().describe(
          'Company registration number (optional, only for "kereskedo")'
        )
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async (args) => {
      if (args.sellerType === "kereskedo") {
        if (!args.companyName) return mkErr2("companyName megad\xE1sa k\xF6telez\u0151 kereskedo elad\xF3i t\xEDpushoz.");
        if (!args.companyAddress) return mkErr2("companyAddress megad\xE1sa k\xF6telez\u0151 kereskedo elad\xF3i t\xEDpushoz.");
      }
      const body = { sellerType: args.sellerType };
      if (args.sellerType === "kereskedo") {
        body["companyName"] = args.companyName;
        body["companyAddress"] = args.companyAddress;
        if (args.companyRegNumber != null) body["companyRegNumber"] = args.companyRegNumber;
      }
      try {
        const result = await put("/api/v1/shop/my/seller-profile", body, opts);
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "set_seller_profile");
      }
    }
  );
  server.registerTool(
    "haszno_shop_remove_background",
    {
      title: "Remove image background (AI)",
      description: "Processes an already-uploaded image through the AI background removal service. The original image is preserved; a NEW image row is created with the processed result. Returns { id, url } of the NEW background-removed image (use this id/url in your ad). The source image must exist and belong to the authenticated user's shop. Rate-limited to 10 calls per hour. Returns error 503 when the background removal feature is not enabled on this server.",
      inputSchema: {
        imageId: z2.number().int().min(1).describe("ID of an already-uploaded image (from haszno_shop_upload_image)")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/images/${args.imageId}/remove-bg`, {}, opts);
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "remove_background");
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
        return json2(profile);
      } catch (e) {
        return mapApiError2(e, "partner_profile_get");
      }
    }
  );
  server.registerTool(
    "haszno_shop_partner_profile_update",
    {
      title: "Update partner display name",
      description: "Updates the display name shown on the partner webshop's feed and embed widget.\n\nPUT /api/v1/shop/partner/profile \u2014 body: { displayName }.\n\nThe displayName must be 2\u201360 characters.\n\nIf the partner profile does not exist yet, call haszno_shop_partner_profile_get first \u2014 that call auto-creates it.\n\nRequires confirm: true.",
      inputSchema: {
        displayName: z2.string().min(2).max(60).describe("Display name shown on the partner feed (2\u201360 characters)."),
        confirm: z2.literal(true).describe("Must be exactly true (safety gate).")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async (args) => {
      try {
        const updated = await put("/api/v1/shop/partner/profile", { displayName: args.displayName }, opts);
        return json2(updated);
      } catch (e) {
        return mapApiError2(e, "partner_profile_update");
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
        return json2(syndications);
      } catch (e) {
        return mapApiError2(e, "partner_syndications_list");
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
        adId: z2.number().int().positive().describe("ID of the marketplace ad to syndicate."),
        markupPct: z2.number().min(0).max(100).describe(
          "Percentage markup on the original asking price (0\u2013100). E.g. 5 = 5% above the asking price."
        ),
        markupFt: z2.number().int().min(0).max(5e7).describe(
          "Flat gross HUF markup (0\u201350 000 000, integer). Added on top of the percentage markup."
        ),
        confirm: z2.literal(true).describe("Must be exactly true (safety gate).")
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
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "partner_syndication_upsert");
      }
    }
  );
  server.registerTool(
    "haszno_shop_partner_syndication_remove",
    {
      title: "Remove a syndicated ad from the partner feed",
      description: "Removes a marketplace ad from the shop's partner feed. The original ad is not affected \u2014 it remains listed on the marketplace.\n\nDELETE /api/v1/shop/partner/syndications/:adId \u2014 returns { ok: true }.\n\nRequires confirm: true.",
      inputSchema: {
        adId: z2.number().int().positive().describe("ID of the syndicated ad to remove from the feed."),
        confirm: z2.literal(true).describe("Must be exactly true (safety gate).")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async (args) => {
      try {
        const result = await del(`/api/v1/shop/partner/syndications/${args.adId}`, opts);
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "partner_syndication_remove");
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
        return json2(actions);
      } catch (e) {
        return mapApiError2(e, "moderation_list");
      }
    }
  );
  server.registerTool(
    "haszno_shop_moderation_appeal",
    {
      title: "Appeal a moderation decision",
      description: "Submits an appeal against a moderation decision. The appeal message is sent to the moderation team for review.\n\nPOST /api/v1/shop/my/moderation/:id/appeal \u2014 body: { message }.\n\nThe message must be 10\u20132000 characters. Appeals can only be submitted once per moderation action. Returns { ok: true } on success.\n\nRequires confirm: true.",
      inputSchema: {
        id: z2.number().int().positive().describe("Moderation action ID (from haszno_shop_moderation_list)."),
        message: z2.string().min(10).max(2e3).describe(
          "Appeal message explaining why the moderation decision should be reconsidered (10\u20132000 characters)."
        ),
        confirm: z2.literal(true).describe("Must be exactly true (safety gate).")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/my/moderation/${args.id}/appeal`, { message: args.message }, opts);
        return json2(result);
      } catch (e) {
        return mapApiError2(e, "moderation_appeal");
      }
    }
  );
  registerJobTools(server, opts, flags);
}

// src/tools/modules.ts
import { z as z3 } from "zod";
var MODULE_IDS = [
  "webshop",
  "dropshipping_supplier",
  "fitness",
  "booking_salon",
  "booking_clinic",
  "booking_other",
  "restaurant"
];
function registerModulesTools(server, client) {
  server.registerTool(
    "haszno_modules_list_prices",
    {
      title: "Module price list",
      description: "Returns the public price-list for all Haszno workspace modules: module id, monthly price in HUF, and whether it is billable (requires payment). Free modules (webshop, dropshipping_supplier, restaurant) have priceHuf = 0. No authentication required.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {}
    },
    async () => {
      const result = await client.modules.listPrices();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }
  );
  server.registerTool(
    "haszno_modules_list_my",
    {
      title: "My active modules",
      description: "Returns the workspace modules currently active (or pending activation) for this shop. Shows module id, subscription status (pending/active/cancelled/ended), billing period, and expiry. Requires a shop Bearer token (haszno_\u2026).",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {}
    },
    async () => {
      const result = await client.modules.listMy();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }
  );
  server.registerTool(
    "haszno_modules_activate",
    {
      title: "Activate a module",
      description: "Starts the activation flow for a Haszno workspace module. For free modules (webshop, dropshipping_supplier, restaurant) this activates immediately. For billable modules (fitness, booking_salon, booking_clinic, booking_other) it returns a checkoutUrl that the user must visit to complete the payment. IMPORTANT: If a checkoutUrl is returned, tell the user to open it and complete payment \u2014 do NOT report the module as active until payment is confirmed. Requires confirm: true (safety gate). Requires a write-scope shop Bearer token (haszno_\u2026) with ownership (tulajdonos) role.",
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        moduleId: z3.enum(MODULE_IDS).describe("The module to activate."),
        confirm: z3.literal(true).describe(
          "Must be exactly true. This may start a real payment flow \u2014 only set after the user confirms."
        )
      }
    },
    async (args) => {
      if (args.confirm !== true) {
        return {
          content: [
            {
              type: "text",
              text: "Confirm required: set confirm: true after the user has acknowledged this may trigger a payment."
            }
          ]
        };
      }
      const result = await client.modules.activate(args.moduleId);
      const lines = [`Module: ${args.moduleId}`, `Status: ${result.status}`];
      if (result.checkout?.redirectUrl) {
        lines.push(`Checkout URL: ${result.checkout.redirectUrl}`);
        lines.push(`Order ref: ${result.checkout.orderRef}`);
        lines.push(`Amount: ${result.checkout.amountHuf} HUF`);
        lines.push(
          "The user must visit the checkout URL to complete payment. The module will not be active until payment succeeds."
        );
      } else if (result.status === "active") {
        lines.push(result.message ?? "Module activated immediately (free module, no payment required).");
      }
      return {
        content: [{ type: "text", text: lines.join("\n") }]
      };
    }
  );
  server.registerTool(
    "haszno_modules_cancel",
    {
      title: "Cancel a module subscription",
      description: "Cancels a currently-active module subscription. The module remains accessible until the end of the current paid period (not an immediate shutdown). Requires confirm: true. Requires ownership (tulajdonos) role.",
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        moduleId: z3.enum(MODULE_IDS).describe("The module to cancel."),
        confirm: z3.literal(true).describe("Must be exactly true (safety gate).")
      }
    },
    async (args) => {
      if (args.confirm !== true) {
        return {
          content: [{ type: "text", text: "Confirm required: set confirm: true to cancel the module." }]
        };
      }
      const result = await client.modules.cancel(args.moduleId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }
  );
  server.registerTool(
    "haszno_modules_resume",
    {
      title: "Resume a cancelled module",
      description: "Resumes a module subscription that was cancelled but has not yet expired. Has no effect if the module is already active or if the period has already ended. Requires confirm: true. Requires ownership (tulajdonos) role.",
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        moduleId: z3.enum(MODULE_IDS).describe("The module to resume."),
        confirm: z3.literal(true).describe("Must be exactly true (safety gate).")
      }
    },
    async (args) => {
      if (args.confirm !== true) {
        return {
          content: [{ type: "text", text: "Confirm required: set confirm: true to resume the module." }]
        };
      }
      const result = await client.modules.resume(args.moduleId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }
  );
}

// src/tools/booking.ts
import { z as z4 } from "zod";
var TimeRangeSchema = z4.object({
  open: z4.string().describe('Opening time (HH:MM), e.g. "09:00".'),
  close: z4.string().describe('Closing time (HH:MM), e.g. "17:00".')
});
var HoursMapSchema = z4.record(
  z4.string(),
  z4.union([z4.array(TimeRangeSchema), z4.null()])
).describe(
  'Weekly schedule keyed by day (mon, tue, wed, thu, fri, sat, sun). Each value is an array of {open, close} time ranges or null for a closed day. Example: { "mon": [{"open":"09:00","close":"17:00"}], "sat": null }'
);
var ServiceBodySchema = z4.object({
  name: z4.string().describe('Service name, e.g. "Hajv\xE1g\xE1s". Used to match existing services.'),
  durationMin: z4.number().int().positive().describe("Duration in minutes, e.g. 30."),
  priceHuf: z4.number().int().nonnegative().optional().describe("Price in HUF (whole forints). 0 = free."),
  description: z4.string().optional().describe("Short description shown to customers.")
});
var ResourceBodySchema = z4.object({
  name: z4.string().describe('Resource name, e.g. "1-es sz\xE9k". Used to match existing resources.'),
  description: z4.string().optional().describe('Optional note, e.g. "Ground floor, accessible".')
});
var ThemeBodySchema = z4.object({
  accent: z4.string().optional().describe('Brand hex color, e.g. "#0ea5e9".'),
  background: z4.enum(["light", "soft", "dark"]).optional().describe("Page background tone."),
  radius: z4.enum(["sharp", "soft", "round"]).optional().describe("Button / card corner radius style."),
  font: z4.enum(["inter", "serif", "rounded"]).optional().describe("Typography preset."),
  logoUrl: z4.string().optional().describe("Full https:// URL for the shop logo image, or empty string to clear."),
  coverUrl: z4.string().optional().describe("Full https:// URL for the page cover image, or empty string to clear."),
  headline: z4.string().max(80).optional().describe("Short headline shown on the booking page (max 80 chars)."),
  buttonLabel: z4.string().max(40).optional().describe('Call-to-action button label, e.g. "Foglalok" (max 40 chars).')
});
function registerBookingTools(server, client) {
  server.registerTool(
    "haszno_booking_get_setup",
    {
      title: "Get booking setup",
      description: "Returns the full booking configuration for this shop: page settings, services, resources, weekly hours, closures, checklist (what is still missing), and nextStep hint. Call this first before any write operation so you understand the current state. Read-only. Requires a shop Bearer token (haszno_\u2026) with read scope.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {}
    },
    async () => {
      const result = await client.booking.getSetup();
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
  server.registerTool(
    "haszno_booking_apply_setup",
    {
      title: "Apply booking setup",
      description: "Bulk-apply a booking setup in one call. RECOMMENDED WORKFLOW: (1) call haszno_booking_get_setup to see current state, (2) call this tool with dryRun:true to see what would change, (3) show the diff to the user and ask for confirmation, (4) call again with confirm:true to write. Either dryRun:true OR confirm:true is required (not both). Omitting both returns guidance without making any change. Requires write scope.",
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        dryRun: z4.boolean().optional().describe("true = return a list of changes without writing (no confirm needed)."),
        confirm: z4.literal(true).optional().describe("Must be exactly true to apply changes (required unless dryRun is true)."),
        page: z4.object({
          headline: z4.string().max(80).optional().describe("Page headline (max 80 chars)."),
          published: z4.boolean().optional().describe("true = visible to customers; false = hidden.")
        }).optional().describe("Page-level settings to update."),
        services: z4.array(ServiceBodySchema).optional().describe(
          "Services to create or update (matched by name). Services not in this list are left untouched."
        ),
        resources: z4.array(ResourceBodySchema).optional().describe(
          "Resources to create or update (matched by name). Resources not in this list are left untouched."
        ),
        hours: HoursMapSchema.optional(),
        theme: ThemeBodySchema.optional()
      }
    },
    async (args) => {
      if (!args.dryRun && args.confirm !== true) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  guidance: "Pass dryRun:true to preview changes without writing, or confirm:true to apply. Recommended: preview first (dryRun), show the user, then confirm."
                },
                null,
                2
              )
            }
          ]
        };
      }
      const { dryRun, confirm: _confirm, ...body } = args;
      const result = await client.booking.applySetup({
        dryRun: dryRun ?? false,
        ...body
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
  server.registerTool(
    "haszno_booking_set_theme",
    {
      title: "Set booking page theme",
      description: "Partially update the visual theme of the booking page. Only the fields you pass are changed; omitted fields keep their current values. Theme contract: accent (hex), background (light/soft/dark), radius (sharp/soft/round), font (inter/serif/rounded), logoUrl, coverUrl, headline (80 chars), buttonLabel (40 chars). Requires write scope.",
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: ThemeBodySchema.shape
    },
    async (args) => {
      const result = await client.booking.setTheme(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
  server.registerTool(
    "haszno_booking_upsert_service",
    {
      title: "Upsert a booking service",
      description: "Create or update a service. The service is matched by name: if a service with the same name already exists it is updated (PATCH); otherwise a new one is created (POST). Returns the created or updated service with its id. Requires write scope.",
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: ServiceBodySchema.shape
    },
    async (args) => {
      const services = await client.booking.listServices();
      const existing = services.find((s) => s.name === args.name);
      let result;
      if (existing) {
        result = await client.booking.updateService(existing.id, {
          durationMin: args.durationMin,
          ...args.priceHuf !== void 0 ? { priceHuf: args.priceHuf } : {},
          ...args.description !== void 0 ? { description: args.description } : {}
        });
      } else {
        result = await client.booking.createService({
          name: args.name,
          durationMin: args.durationMin,
          ...args.priceHuf !== void 0 ? { priceHuf: args.priceHuf } : {},
          ...args.description !== void 0 ? { description: args.description } : {}
        });
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { action: existing ? "updated" : "created", service: result },
              null,
              2
            )
          }
        ]
      };
    }
  );
  server.registerTool(
    "haszno_booking_delete_service",
    {
      title: "Delete a booking service",
      description: "Soft-delete a service by its id. The service is hidden from the booking page but its appointment history is preserved. Use haszno_booking_get_setup to discover service ids before calling this. Requires confirm:true and write scope.",
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        id: z4.number().int().positive().describe("Service id (from haszno_booking_get_setup or haszno_booking_upsert_service)."),
        confirm: z4.literal(true).optional().describe("Must be exactly true (safety gate).")
      }
    },
    async (args) => {
      if (args.confirm !== true) {
        return {
          content: [{ type: "text", text: "Confirm required: set confirm:true to delete the service." }]
        };
      }
      const result = await client.booking.deleteService(args.id);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
  server.registerTool(
    "haszno_booking_upsert_resource",
    {
      title: "Upsert a booking resource",
      description: "Create or update a bookable resource (a physical space, seat, or equipment slot). Matched by name: if a resource with the same name exists it is updated; otherwise created. Returns the created or updated resource with its id. Requires write scope.",
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: ResourceBodySchema.shape
    },
    async (args) => {
      const resources = await client.booking.listResources();
      const existing = resources.find((r) => r.name === args.name);
      let result;
      if (existing) {
        result = await client.booking.updateResource(existing.id, {
          ...args.description !== void 0 ? { description: args.description } : {}
        });
      } else {
        result = await client.booking.createResource({
          name: args.name,
          ...args.description !== void 0 ? { description: args.description } : {}
        });
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { action: existing ? "updated" : "created", resource: result },
              null,
              2
            )
          }
        ]
      };
    }
  );
  server.registerTool(
    "haszno_booking_delete_resource",
    {
      title: "Delete a booking resource",
      description: "Soft-delete a bookable resource by its id. The resource is removed from future availability but history is preserved. Use haszno_booking_get_setup to discover resource ids. Requires confirm:true and write scope.",
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        id: z4.number().int().positive().describe("Resource id (from haszno_booking_get_setup or haszno_booking_upsert_resource)."),
        confirm: z4.literal(true).optional().describe("Must be exactly true (safety gate).")
      }
    },
    async (args) => {
      if (args.confirm !== true) {
        return {
          content: [{ type: "text", text: "Confirm required: set confirm:true to delete the resource." }]
        };
      }
      const result = await client.booking.deleteResource(args.id);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
  server.registerTool(
    "haszno_booking_set_hours",
    {
      title: "Set booking hours",
      description: 'Replace the full weekly opening-hours schedule. The entire schedule is replaced \u2014 include all days you want configured. Days omitted from the map default to closed (null). Example: { "mon": [{"open":"09:00","close":"17:00"}], "wed": null, "sat": null }. Requires write scope.',
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        hours: HoursMapSchema
      }
    },
    async (args) => {
      const result = await client.booking.setHours(args.hours);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
  server.registerTool(
    "haszno_booking_add_closure",
    {
      title: "Add a booking closure / exception",
      description: "Add a date exception (closure or partial closure). For a full-day closure, omit startTime and endTime. For a partial closure, provide both startTime and endTime (HH:MM). Requires write scope.",
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        date: z4.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").describe("Date of the closure (YYYY-MM-DD)."),
        label: z4.string().optional().describe('Human-readable label, e.g. "Kar\xE1csonyi sz\xFCnet" or "Lunch break".'),
        startTime: z4.string().optional().describe("Partial closure start (HH:MM). Omit for a full-day closure."),
        endTime: z4.string().optional().describe("Partial closure end (HH:MM). Omit for a full-day closure.")
      }
    },
    async (args) => {
      const result = await client.booking.addClosure({
        date: args.date,
        ...args.label !== void 0 ? { label: args.label } : {},
        ...args.startTime !== void 0 ? { startTime: args.startTime } : {},
        ...args.endTime !== void 0 ? { endTime: args.endTime } : {}
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
  server.registerTool(
    "haszno_booking_publish",
    {
      title: "Publish or unpublish the booking page",
      description: "Publish (published:true) or unpublish (published:false) the booking page. Publishing fails with 422 if the checklist is incomplete (no services, no resources, or no hours). Call haszno_booking_get_setup first to verify the checklist before publishing. Requires confirm:true and write scope.",
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        published: z4.boolean().describe("true = visible to customers; false = hidden draft."),
        confirm: z4.literal(true).optional().describe("Must be exactly true (safety gate).")
      }
    },
    async (args) => {
      if (args.confirm !== true) {
        return {
          content: [
            {
              type: "text",
              text: "Confirm required: set confirm:true to publish or unpublish the booking page."
            }
          ]
        };
      }
      const result = await client.booking.publish({ published: args.published });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
  server.registerTool(
    "haszno_booking_list_appointments",
    {
      title: "List booking appointments",
      description: "List customer appointments for a date range. Both from and to are required (YYYY-MM-DD format, inclusive). Maximum range: 31 days. Returns appointment id, service, resource, customer, date/time, status, and notes. Read-only. Requires read scope.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        from: z4.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").describe("Start date (YYYY-MM-DD, inclusive)."),
        to: z4.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").describe("End date (YYYY-MM-DD, inclusive). Maximum 31 days after `from`.")
      }
    },
    async (args) => {
      const result = await client.booking.listAppointments({ from: args.from, to: args.to });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
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
var LegacyKeyNotSupportedError = class extends Error {
  isLegacyKeyNotSupported = true;
  operation;
  constructor(operation) {
    super(
      `"${operation}" csak bolt API-tokennel (haszno_\u2026) \xE9rhet\u0151 el \u2014 a Napi jelent\xE9s \xE9s agent-eszk\xF6z\xF6k nem m\u0171k\xF6dnek sima API-kulccsal. Hozzon l\xE9tre bolt API-tokent itt: /app/api-kulcsok (Haszno webalkalmaz\xE1s). Shop token required: create one at /app/api-kulcsok in the Haszno web app.`
    );
    this.name = "LegacyKeyNotSupportedError";
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
function notSupportedLegacy(op) {
  return (..._args) => {
    return Promise.reject(new LegacyKeyNotSupportedError(op));
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
    auth: {
      me: () => get("/api/v1/auth/me", o),
      revokeCurrentToken: () => post("/api/v1/auth/tokens/revoke-current", null, o)
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
    },
    manager: {
      listReports: () => get("/api/daily-reports", o),
      getReport: (day) => day === "latest" ? get("/api/agent/daily-report", o) : get(`/api/agent/daily-report/${day}`, o),
      getResearchBrief: () => get("/api/agent/research-brief", o),
      postFindings: (day, body) => post(`/api/agent/daily-report/${day}/findings`, body, o),
      listActions: (params) => {
        const qs = new URLSearchParams();
        if (params?.status) qs.set("status", params.status);
        if (params?.limit != null) qs.set("limit", String(params.limit));
        const suffix = qs.toString() ? `?${qs.toString()}` : "";
        return get(`/api/agent/actions${suffix}`, o);
      },
      proposeAction: (body) => post("/api/agent/actions", body, o),
      rejectAction: (id) => post(`/api/agent/actions/${id}/reject`, null, o)
    },
    // /api/shop/modules/* — available in shop token mode (Bearer haszno_…)
    modules: {
      listPrices: () => get("/api/shop/modules/prices", o),
      listMy: () => get("/api/shop/modules/my", o),
      activate: (moduleId) => post(`/api/shop/modules/${moduleId}/activate`, null, o),
      cancel: (moduleId) => post(`/api/shop/modules/${moduleId}/cancel`, null, o),
      resume: (moduleId) => post(`/api/shop/modules/${moduleId}/resume`, null, o)
    },
    // /api/agent/booking/* — booking module; Bearer haszno_… required
    booking: {
      getSetup: () => get("/api/agent/booking/setup", o),
      applySetup: (body) => put("/api/agent/booking/setup", body, o),
      setTheme: (body) => put("/api/agent/booking/theme", body, o),
      listServices: () => get("/api/agent/booking/services", o),
      createService: (body) => post("/api/agent/booking/services", body, o),
      updateService: (id, body) => patch(`/api/agent/booking/services/${id}`, body, o),
      deleteService: (id) => del(`/api/agent/booking/services/${id}`, o),
      listResources: () => get("/api/agent/booking/resources", o),
      createResource: (body) => post("/api/agent/booking/resources", body, o),
      updateResource: (id, body) => patch(`/api/agent/booking/resources/${id}`, body, o),
      deleteResource: (id) => del(`/api/agent/booking/resources/${id}`, o),
      setHours: (body) => put("/api/agent/booking/hours", body, o),
      addClosure: (body) => post("/api/agent/booking/exceptions", body, o),
      publish: (body) => post("/api/agent/booking/publish", body, o),
      listAppointments: (params) => get(`/api/agent/booking/appointments?from=${params.from}&to=${params.to}`, o)
    }
  };
}
function createLegacyClient(opts) {
  const o = opts;
  return {
    health: {
      check: () => get("/api/health", o)
    },
    auth: {
      me: () => get("/api/v1/auth/me", o),
      revokeCurrentToken: () => post("/api/v1/auth/tokens/revoke-current", null, o)
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
    },
    // manager.* requires a shop token (haszno_…). In legacy mode these endpoints
    // either return synthetic demo data (GET /api/agent/actions → HTTP 200 with
    // fake rows) or 401. Both outcomes are wrong for a production agent.
    manager: {
      listReports: notSupportedLegacy("manager.listReports"),
      getReport: notSupportedLegacy("manager.getReport"),
      getResearchBrief: notSupportedLegacy("manager.getResearchBrief"),
      postFindings: notSupportedLegacy("manager.postFindings"),
      listActions: notSupportedLegacy("manager.listActions"),
      proposeAction: notSupportedLegacy("manager.proposeAction"),
      rejectAction: notSupportedLegacy("manager.rejectAction")
    },
    // modules.listPrices is public; modules.listMy + write ops require Bearer.
    // In legacy key mode (x-api-key) the shop/modules/* routes require a session
    // or Bearer token, so only listPrices works; write ops and listMy fail with 401.
    modules: {
      listPrices: () => get("/api/shop/modules/prices", o),
      listMy: () => get("/api/shop/modules/my", o),
      activate: (moduleId) => post(`/api/shop/modules/${moduleId}/activate`, null, o),
      cancel: (moduleId) => post(`/api/shop/modules/${moduleId}/cancel`, null, o),
      resume: (moduleId) => post(`/api/shop/modules/${moduleId}/resume`, null, o)
    },
    // booking.* requires a shop token (haszno_…). All /api/agent/booking/* routes
    // use requireBearerToken and do not accept x-api-key or Basic credentials.
    booking: {
      getSetup: notSupportedLegacy("booking.getSetup"),
      applySetup: notSupportedLegacy("booking.applySetup"),
      setTheme: notSupportedLegacy("booking.setTheme"),
      listServices: notSupportedLegacy("booking.listServices"),
      createService: notSupportedLegacy("booking.createService"),
      updateService: notSupportedLegacy("booking.updateService"),
      deleteService: notSupportedLegacy("booking.deleteService"),
      listResources: notSupportedLegacy("booking.listResources"),
      createResource: notSupportedLegacy("booking.createResource"),
      updateResource: notSupportedLegacy("booking.updateResource"),
      deleteResource: notSupportedLegacy("booking.deleteResource"),
      setHours: notSupportedLegacy("booking.setHours"),
      addClosure: notSupportedLegacy("booking.addClosure"),
      publish: notSupportedLegacy("booking.publish"),
      listAppointments: notSupportedLegacy("booking.listAppointments")
    }
  };
}
export {
  createClient,
  registerBookingTools,
  registerJobTools,
  registerModulesTools,
  registerShopTools
};
//# sourceMappingURL=lib.js.map