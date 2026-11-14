/**
 * MCP tools — Állásajánlatok / Job applications (Haszno Jobs).
 *
 * All endpoints use the /api/v1 prefix.
 * Auth is passed through opts (Bearer haszno_ token or legacy key/Basic).
 *
 * Job-seeker (applicant) side:
 *   haszno_shop_job_profile_get       — GET  /shop/jobs/profile
 *   haszno_shop_job_profile_save      — PUT  /shop/jobs/profile
 *   haszno_shop_job_cv_upload         — PUT  /shop/jobs/profile/cv (raw PDF)
 *   haszno_shop_job_matches           — GET  /shop/jobs/matches
 *   haszno_shop_job_apply             — POST /shop/ads/{adId}/applications
 *   haszno_shop_job_my_applications   — GET  /shop/my/applications
 *   haszno_shop_job_withdraw          — POST /shop/my/applications/{id}/withdraw
 *
 * Advertiser (employer) side:
 *   haszno_shop_job_applicants_list   — GET   /shop/my/job-applications
 *   haszno_shop_job_applicant_update  — PATCH /shop/my/job-applications/{id}
 *   haszno_shop_job_applicant_cv_download — GET /shop/my/job-applications/{id}/cv
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { get, post, put, patch, type HttpOptions, SHOP_TOKEN_PREFIX } from '../client/http.js'
import { HasznoApiError } from '../client/error.js'

// ── Shared helpers ─────────────────────────────────────────────────────────────

function json(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

function mkErr(message: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

/** Map HasznoApiError to a helpful message based on status code. */
function mapApiError(e: unknown, context: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  if (e instanceof HasznoApiError) {
    const extra =
      e.status === 400 ? ' (érvénytelen kérés — ellenőrizd a kötelező mezőket)' :
      e.status === 401 ? ' (hitelesítés szükséges — ellenőrizd a tokenedet)' :
      e.status === 403 ? ' (nincs jogosultságod ehhez a művelethez)' :
      e.status === 404 ? ' (nem található)' :
      e.status === 409 ? ' (ütközés — olvass rá a hibaüzenetre)' :
      e.status === 422 ? ' (feldolgozási hiba)' :
      e.status === 429 ? ' (túl sok kérés — próbáld újra később)' : ''
    return mkErr(`${context}: [${e.status}] ${e.message}${extra}`)
  }
  return mkErr(`${context}: ${String(e)}`)
}

/**
 * Error mapper specifically for the apply tool — maps job-specific error codes
 * to clear agent-readable messages with actionable next steps.
 */
function mapApplyError(e: unknown): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  if (e instanceof HasznoApiError) {
    const code = e.code ?? ''
    if (code === 'auto_apply_disabled' || e.status === 403) {
      return mkErr(
        'apply: Az automatikus jelentkezés (ügynök által) nincs engedélyezve. ' +
        'A felhasználónak be kell kapcsolnia az „Automatikus jelentkezés ügynökkel" opciót. ' +
        'Ezt megteheti a Haszno webes felületen (https://haszno.com/shop/oneletrajzom), ' +
        'vagy explicit felhasználói kérés esetén a haszno_shop_job_profile_save hívással (autoApply: true). ' +
        `API válasz: [${e.status}] ${e.message}`
      )
    }
    if (code === 'profile_required' || e.status === 409) {
      // Could also be already_applied (409) — check the code
      if (code === 'already_applied') {
        return mkErr(
          `apply: Már jelentkeztél erre a hirdetésre (adId). Ugyanarra a hirdetésre csak egyszer lehet jelentkezni. [${e.status}] ${e.message}`
        )
      }
      return mkErr(
        'apply: A jelentkezéshez teljes önéletrajz-profil szükséges (consent: true és feltöltött PDF önéletrajz). ' +
        'Hozz létre profilt a haszno_shop_job_profile_save eszközzel (consent: true), ' +
        'majd töltsd fel az önéletrajzat PDF-ben a haszno_shop_job_cv_upload eszközzel, és próbáld újra. ' +
        `API válasz: [${e.status}] ${e.message}`
      )
    }
    if (e.status === 429) {
      return mkErr(
        `apply: Elérted a napi 20 jelentkezési limitet. Holnap újra próbálhatod. [${e.status}] ${e.message}`
      )
    }
    if (e.status === 404) {
      return mkErr(`apply: Ez a hirdetés nem állásajánlat vagy nem található. [${e.status}] ${e.message}`)
    }
    if (e.status === 400) {
      return mkErr(`apply: Érvénytelen kérés. [${e.status}] ${e.message}`)
    }
    if (e.status === 401) {
      return mkErr(`apply: Hitelesítés szükséges. Ellenőrizd a tokenedet. [${e.status}] ${e.message}`)
    }
    return mkErr(`apply: [${e.status}] ${e.message}`)
  }
  return mkErr(`apply: ${String(e)}`)
}

// ── Raw binary PUT helper (CV upload) ─────────────────────────────────────────

/**
 * Build auth headers for raw binary requests (no Content-Type — caller sets it).
 * Mirrors the logic in shop.ts buildBearerHeaders.
 */
function buildAuthHeaders(opts: HttpOptions): Record<string, string> {
  const key = opts.noEnvFallback
    ? opts.apiKey
    : (opts.apiKey ??
       process.env['HASZNO_API_TOKEN'] ??
       process.env['HASZNO_API_KEY'] ??
       process.env['ARFUTAR_API_KEY'])

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'haszno-mcp/0.5.0',
  }

  if (key) {
    if (key.startsWith(SHOP_TOKEN_PREFIX)) headers['Authorization'] = `Bearer ${key}`
    else headers['x-api-key'] = key
  } else {
    const basic = opts.noEnvFallback
      ? opts.basicAuth
      : (opts.basicAuth ?? process.env['HASZNO_BASIC'] ?? process.env['ARFUTAR_BASIC'])
    if (basic) {
      headers['Authorization'] = `Basic ${Buffer.from(basic).toString('base64')}`
    }
  }
  return headers
}

function resolveBaseUrl(opts: HttpOptions): string {
  return (
    opts.baseUrl ??
    (opts.noEnvFallback ? undefined : (process.env['HASZNO_API_URL'] ?? process.env['ARFUTAR_API_URL'])) ??
    'https://haszno.com'
  ).replace(/\/$/, '')
}

/**
 * PUT raw binary bytes to a path with optional extra headers.
 * Used for CV upload (PUT /api/v1/shop/jobs/profile/cv).
 */
async function putRawBinary<T>(
  apiPath: string,
  bytes: Buffer,
  mimeType: string,
  extraHeaders: Record<string, string>,
  opts: HttpOptions,
): Promise<T> {
  const baseUrl = resolveBaseUrl(opts)
  const fetchFn = opts.fetch ?? fetch

  const response = await fetchFn(`${baseUrl}${apiPath}`, {
    method: 'PUT',
    headers: {
      ...buildAuthHeaders(opts),
      'Content-Type': mimeType,
      ...extraHeaders,
    },
    body: bytes,
  })

  if (!response.ok) {
    let message = `HTTP ${response.status}`
    let code: string | undefined
    try {
      const data = (await response.json()) as { error?: string; code?: string }
      if (data.error) message = data.error
      if (data.code) code = data.code
    } catch {
      // ignore parse errors
    }
    throw new HasznoApiError(response.status, message, code)
  }

  const text = await response.text()
  if (!text) return undefined as unknown as T
  return JSON.parse(text) as T
}

/**
 * GET binary response (e.g. a PDF file) from an API path.
 * Returns the raw Buffer.
 */
async function getRawBinary(
  apiPath: string,
  opts: HttpOptions,
): Promise<Buffer> {
  const baseUrl = resolveBaseUrl(opts)
  const fetchFn = opts.fetch ?? fetch

  const response = await fetchFn(`${baseUrl}${apiPath}`, {
    method: 'GET',
    headers: buildAuthHeaders(opts),
  })

  if (!response.ok) {
    let message = `HTTP ${response.status}`
    let code: string | undefined
    try {
      const data = (await response.json()) as { error?: string; code?: string }
      if (data.error) message = data.error
      if (data.code) code = data.code
    } catch {
      // ignore parse errors
    }
    throw new HasznoApiError(response.status, message, code)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

// ── PDF validation ─────────────────────────────────────────────────────────────

const PDF_MAGIC = Buffer.from('%PDF-')
const MAX_CV_SIZE_BYTES = 4 * 1024 * 1024 // 4 MB

function isPdf(buf: Buffer): boolean {
  if (buf.length < 5) return false
  return buf.subarray(0, 5).equals(PDF_MAGIC)
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerJobTools(
  server: McpServer,
  opts: HttpOptions,
  flags: { remote?: boolean } = {},
): void {
  if (flags.remote) {
    opts = { ...opts, noEnvFallback: true }
  }

  const DESIRED_SECTORS = [
    'it', 'ertekesites', 'ugyfelszolgalat', 'adminisztracio', 'penzugy',
    'marketing', 'vendeglatas', 'epitoipar', 'gyartas', 'logisztika',
    'egeszsegugy', 'oktatas', 'mezogazdasag', 'szepsegipar', 'egyeb',
  ] as const

  // ─── haszno_shop_job_profile_get ──────────────────────────────────────────

  server.registerTool(
    'haszno_shop_job_profile_get',
    {
      title: 'Get job-seeker profile',
      description:
        'Returns the authenticated user\'s job-seeker profile, or null if no profile exists yet. ' +
        'The profile includes: fullName, email, phone, headline, about, skills, desiredSectors, ' +
        'cvFileName, cvSize, cvUpdatedAt, consentAt, autoApply, updatedAt. ' +
        'The PDF bytes of the CV are never returned here — use the web UI to view it, ' +
        'or haszno_shop_job_applicant_cv_download (advertiser side) to download an applicant\'s CV. ' +
        'CV content and personal data are sensitive — do not paste them into other services or logs.',
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => {
      try {
        const result = await get('/api/v1/shop/jobs/profile', opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, 'job_profile_get')
      }
    },
  )

  // ─── haszno_shop_job_profile_save ─────────────────────────────────────────

  server.registerTool(
    'haszno_shop_job_profile_save',
    {
      title: 'Save / update job-seeker profile',
      description:
        'Creates or updates the authenticated user\'s job-seeker profile. ' +
        'On the FIRST save, consent must be true (the user consents to sharing their data with advertisers when they apply). ' +
        'autoApply controls whether agent (token-authenticated) applications are allowed. ' +
        'The agent may set autoApply ONLY when the user explicitly asks for it in the conversation. ' +
        'If the API returns auto_apply_disabled (403) on a later apply call, ' +
        'tell the user to enable "Automatikus jelentkezés ügynökkel" at https://haszno.com/shop/oneletrajzom. ' +
        'PUT /api/v1/shop/jobs/profile → { profile }.',
      inputSchema: {
        fullName: z.string().min(2).max(120).describe('Full name (2–120 characters)'),
        email: z.string().email().describe('Contact e-mail address'),
        phone: z.string().optional().describe('Phone number (optional)'),
        headline: z.string().max(160).optional().describe('Short professional headline (≤160 characters)'),
        about: z.string().max(2000).optional().describe('About / bio text (≤2000 characters)'),
        skills: z.array(z.string().max(40)).max(30).optional().describe('List of skills (up to 30 items, each ≤40 characters)'),
        desiredSectors: z.array(z.enum(DESIRED_SECTORS)).optional().describe(
          'Desired job sectors. Valid values: it, ertekesites, ugyfelszolgalat, adminisztracio, penzugy, ' +
          'marketing, vendeglatas, epitoipar, gyartas, logisztika, egeszsegugy, oktatas, mezogazdasag, szepsegipar, egyeb',
        ),
        consent: z.boolean().describe(
          'Must be true: confirms the user consents to sharing their profile data with advertisers when applying for jobs. ' +
          'Required on the first save; must stay true on subsequent saves.',
        ),
        autoApply: z.boolean().optional().describe(
          'When true, allows agent (token-authenticated) applications on the user\'s behalf. ' +
          'Set this ONLY when the user explicitly asks to enable automatic agent applications. ' +
          'Default: false.',
        ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const body: Record<string, unknown> = {
          fullName: args.fullName,
          email: args.email,
          consent: args.consent,
        }
        if (args.phone !== undefined) body['phone'] = args.phone
        if (args.headline !== undefined) body['headline'] = args.headline
        if (args.about !== undefined) body['about'] = args.about
        if (args.skills !== undefined) body['skills'] = args.skills
        if (args.desiredSectors !== undefined) body['desiredSectors'] = args.desiredSectors
        if (args.autoApply !== undefined) body['autoApply'] = args.autoApply
        const result = await put('/api/v1/shop/jobs/profile', body, opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, 'job_profile_save')
      }
    },
  )

  // ─── haszno_shop_job_cv_upload ────────────────────────────────────────────

  if (flags.remote) {
    // Remote/hosted mode: filePath absent; only base64 accepted.
    server.registerTool(
      'haszno_shop_job_cv_upload',
      {
        title: 'Upload CV (remote mode — base64 only)',
        description:
          'Uploads a PDF CV for the authenticated user\'s job-seeker profile. ' +
          'Remote MCP mode: only base64-encoded PDF data is accepted. ' +
          'The PDF must start with the %PDF- magic bytes. Maximum size: 4 MB. ' +
          'A profile with consent:true must already exist (create one with haszno_shop_job_profile_save first). ' +
          'Returns { profile } with updated cvFileName, cvSize, cvUpdatedAt. ' +
          'CV content is personal data — do not paste it into other services or logs.',
        inputSchema: {
          base64: z.string().describe('Base64-encoded PDF data (without the data: URI prefix).'),
          fileName: z.string().min(1).max(255).describe('File name for the CV (e.g. "cv.pdf").'),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      },
      async (args) => {
        let buffer: Buffer
        try {
          buffer = Buffer.from(args.base64 as string, 'base64')
        } catch (e) {
          return mkErr(`cv_upload: Érvénytelen base64 adat: ${String(e)}`)
        }
        if (!isPdf(buffer)) {
          return mkErr('cv_upload: A fájl nem PDF formátumú (%PDF- mágikus bájtok hiányoznak).')
        }
        if (buffer.length > MAX_CV_SIZE_BYTES) {
          return mkErr(`cv_upload: A fájl mérete (${(buffer.length / 1024 / 1024).toFixed(1)} MB) meghaladja a 4 MB-os határt.`)
        }
        try {
          const result = await putRawBinary(
            '/api/v1/shop/jobs/profile/cv',
            buffer,
            'application/pdf',
            { 'X-File-Name': encodeURIComponent(args.fileName as string) },
            opts,
          )
          return json(result)
        } catch (e) {
          return mapApiError(e, 'cv_upload')
        }
      },
    )
  } else {
    // Local/stdio mode: filePath OR base64+fileName accepted.
    server.registerTool(
      'haszno_shop_job_cv_upload',
      {
        title: 'Upload CV (local or base64)',
        description:
          'Uploads a PDF CV for the authenticated user\'s job-seeker profile. ' +
          'Provide either an absolute local file path ("filePath") OR base64-encoded data ("base64" + "fileName"). ' +
          'The PDF must start with the %PDF- magic bytes. Maximum size: 4 MB. ' +
          'A profile with consent:true must already exist (create one with haszno_shop_job_profile_save first). ' +
          'Returns { profile } with updated cvFileName, cvSize, cvUpdatedAt. ' +
          'CV content is personal data — do not paste it into other services or logs.',
        inputSchema: {
          filePath: z.string().optional().describe('Absolute path to a local PDF file (e.g. /home/user/cv.pdf). Provide this OR base64/fileName.'),
          base64: z.string().optional().describe('Base64-encoded PDF data (without the data: URI prefix). Provide together with fileName.'),
          fileName: z.string().min(1).max(255).optional().describe('File name for the CV when using base64 (e.g. "cv.pdf"). Also used as the display name when filePath is provided.'),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      },
      async (args) => {
        let buffer: Buffer
        let displayName: string

        if (!args.filePath && !args.base64) {
          return mkErr('cv_upload: Adj meg vagy filePath-t (abszolút PDF-útvonal) vagy base64 + fileName párt.')
        }
        if (args.base64 && !args.fileName) {
          return mkErr('cv_upload: base64 megadásakor fileName is szükséges.')
        }

        if (args.filePath) {
          try {
            buffer = fs.readFileSync(args.filePath as string)
          } catch (e) {
            return mkErr(`cv_upload: Nem sikerült beolvasni a fájlt (${args.filePath}): ${String(e)}`)
          }
          displayName = args.fileName ?? path.basename(args.filePath as string)
        } else {
          try {
            buffer = Buffer.from(args.base64 as string, 'base64')
          } catch (e) {
            return mkErr(`cv_upload: Érvénytelen base64 adat: ${String(e)}`)
          }
          displayName = args.fileName as string
        }

        if (!isPdf(buffer)) {
          return mkErr('cv_upload: A fájl nem PDF formátumú (%PDF- mágikus bájtok hiányoznak).')
        }
        if (buffer.length > MAX_CV_SIZE_BYTES) {
          return mkErr(`cv_upload: A fájl mérete (${(buffer.length / 1024 / 1024).toFixed(1)} MB) meghaladja a 4 MB-os határt.`)
        }

        try {
          const result = await putRawBinary(
            '/api/v1/shop/jobs/profile/cv',
            buffer,
            'application/pdf',
            { 'X-File-Name': encodeURIComponent(displayName) },
            opts,
          )
          return json(result)
        } catch (e) {
          return mapApiError(e, 'cv_upload')
        }
      },
    )
  }

  // ─── haszno_shop_job_matches ──────────────────────────────────────────────

  server.registerTool(
    'haszno_shop_job_matches',
    {
      title: 'Get job matches for my profile',
      description:
        'Returns active Haszno job-offer ads scored against the authenticated user\'s profile. ' +
        'Excludes the user\'s own ads and ads already applied to. ' +
        'Each match includes: adId, title, sector, employment, workMode, location, wage, wagePeriod, wageType, ' +
        'excerpt, score (match score), matchedSkills, url (/shop/hirdetes/<id>), createdAt. ' +
        'Requires a profile to be set up first (haszno_shop_job_profile_save). ' +
        'GET /api/v1/shop/jobs/matches?limit=…',
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional().describe('Number of matches to return (1–50, default 20)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args) => {
      try {
        const qs = new URLSearchParams()
        if (args.limit != null) qs.set('limit', String(args.limit))
        const suffix = qs.toString() ? `?${qs}` : ''
        const result = await get(`/api/v1/shop/jobs/matches${suffix}`, opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, 'job_matches')
      }
    },
  )

  // ─── haszno_shop_job_apply ────────────────────────────────────────────────

  server.registerTool(
    'haszno_shop_job_apply',
    {
      title: 'Apply for a job ad',
      description:
        'Applies for a Haszno job-offer ad on behalf of the authenticated user. ' +
        'Sending an application forwards the user\'s stored CV and contact data to the advertiser — ' +
        'this is a write action in the user\'s name. ' +
        '\n\nProduct rules:\n' +
        '- Apply only to jobs that genuinely match the user\'s profile and stated wishes. ' +
        'Never mass-apply.\n' +
        '- The daily limit is 20 applications per user per day.\n' +
        '- Each ad can only be applied to once per user.\n' +
        '- Report every application made back to the user.\n' +
        '- Token (agent) applications only work after the user has enabled "Automatikus jelentkezés ügynökkel" ' +
        '(autoApply). If the API returns auto_apply_disabled (403), stop and tell the user how to enable it ' +
        'at https://haszno.com/shop/oneletrajzom. Never try to work around this.\n' +
        '- The agent may set autoApply via haszno_shop_job_profile_save ONLY when the user explicitly asks.\n' +
        '- External remote jobs (Himalayas/Jobicy feed) cannot be applied to through Haszno.\n' +
        'POST /api/v1/shop/ads/{adId}/applications → 201 { application }.',
      inputSchema: {
        adId: z.number().int().positive().describe('ID of the Haszno job-offer ad to apply to'),
        message: z.string().max(2000).optional().describe('Optional cover message to the advertiser (≤2000 characters)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      try {
        const body: Record<string, unknown> = {}
        if (args.message !== undefined) body['message'] = args.message
        const result = await post(`/api/v1/shop/ads/${args.adId}/applications`, body, opts)
        return json(result)
      } catch (e) {
        return mapApplyError(e)
      }
    },
  )

  // ─── haszno_shop_job_my_applications ─────────────────────────────────────

  server.registerTool(
    'haszno_shop_job_my_applications',
    {
      title: 'List my job applications',
      description:
        'Returns the authenticated user\'s submitted job applications. ' +
        'Each item includes: id, adId, adTitle, adStatus, status, message, via, createdAt, withdrawnAt, statusChangedAt, hasCv. ' +
        'Status values: "uj" (new/unread), "megnezve" (seen), "behivva" (invited), "elutasitva" (rejected), "felveve" (hired). ' +
        'GET /api/v1/shop/my/applications → { items: MyApplication[] }.',
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => {
      try {
        const result = await get('/api/v1/shop/my/applications', opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, 'job_my_applications')
      }
    },
  )

  // ─── haszno_shop_job_withdraw ─────────────────────────────────────────────

  server.registerTool(
    'haszno_shop_job_withdraw',
    {
      title: 'Withdraw a job application',
      description:
        'Withdraws (cancels) a previously submitted job application. ' +
        'POST /api/v1/shop/my/applications/{id}/withdraw → { application }. ' +
        'The application status will reflect the withdrawal.',
      inputSchema: {
        id: z.number().int().positive().describe('Application ID (from haszno_shop_job_my_applications)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/my/applications/${args.id}/withdraw`, {}, opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, 'job_withdraw')
      }
    },
  )

  // ══════════════════════════════════════════════════════════════════════════════
  // Advertiser (employer) side
  // ══════════════════════════════════════════════════════════════════════════════

  // ─── haszno_shop_job_applicants_list ──────────────────────────────────────

  server.registerTool(
    'haszno_shop_job_applicants_list',
    {
      title: 'List applicants for my job ads',
      description:
        'Returns applications received for the authenticated user\'s job-offer ads. ' +
        'Filter by adId to see applicants for a specific ad, or by status to narrow results. ' +
        'Each item includes: id, adId, adTitle, name, email, phone, headline, message, status, employerNote, ' +
        'via ("web"|"agent"), hasCv, cvFileName, cvSize, createdAt, readAt, withdrawnAt, statusChangedAt. ' +
        'Also returns counts: { total, unread }. ' +
        'CV content and applicants\' personal data (name, email, phone) are sensitive — ' +
        'do not paste them into other services or logs. ' +
        'GET /api/v1/shop/my/job-applications?adId=&status= → { items: ReceivedApplication[], counts }.',
      inputSchema: {
        adId: z.number().int().positive().optional().describe('Filter by a specific job ad ID'),
        status: z.string().optional().describe('Filter by application status (e.g. "uj", "megnezve", "behivva", "elutasitva", "felveve")'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args) => {
      try {
        const qs = new URLSearchParams()
        if (args.adId != null) qs.set('adId', String(args.adId))
        if (args.status) qs.set('status', args.status)
        const suffix = qs.toString() ? `?${qs}` : ''
        const result = await get(`/api/v1/shop/my/job-applications${suffix}`, opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, 'job_applicants_list')
      }
    },
  )

  // ─── haszno_shop_job_applicant_update ─────────────────────────────────────

  server.registerTool(
    'haszno_shop_job_applicant_update',
    {
      title: 'Update the status or note on an applicant',
      description:
        'Updates the status and/or employer note on a received job application (advertiser side). ' +
        'Status values: "uj" (new), "megnezve" (seen), "behivva" (invited to interview), ' +
        '"elutasitva" (rejected), "felveve" (hired). ' +
        'employerNote is a private note visible only to the advertiser (≤2000 characters). ' +
        'PATCH /api/v1/shop/my/job-applications/{id} → { application }.',
      inputSchema: {
        id: z.number().int().positive().describe('Application ID (from haszno_shop_job_applicants_list)'),
        status: z.enum(['uj', 'megnezve', 'behivva', 'elutasitva', 'felveve']).optional().describe('New application status'),
        employerNote: z.string().max(2000).optional().describe('Private employer note (≤2000 characters, visible only to you)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const body: Record<string, unknown> = {}
        if (args.status !== undefined) body['status'] = args.status
        if (args.employerNote !== undefined) body['employerNote'] = args.employerNote
        if (Object.keys(body).length === 0) {
          return mkErr('job_applicant_update: Adj meg legalább egyet: status vagy employerNote.')
        }
        const result = await patch(`/api/v1/shop/my/job-applications/${args.id}`, body, opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, 'job_applicant_update')
      }
    },
  )

  // ─── haszno_shop_job_applicant_cv_download ────────────────────────────────

  if (flags.remote) {
    // Remote/hosted mode: cannot stream binary to the client — return a notice.
    server.registerTool(
      'haszno_shop_job_applicant_cv_download',
      {
        title: 'Download applicant CV (remote mode)',
        description:
          'Remote MCP mode: the applicant\'s CV cannot be streamed as bytes through the hosted MCP endpoint. ' +
          'To view or download the CV, open the application in the Haszno advertiser panel: https://haszno.com/shop/palyazatok. ' +
          'CV content and applicants\' personal data are sensitive — do not share them with other services.',
        inputSchema: {
          id: z.number().int().positive().describe('Application ID (from haszno_shop_job_applicants_list)'),
        },
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      async () => {
        return json({
          notice:
            'Remote MCP mode: a pályázó önéletrajza nem tölthető le bájtonként a hosted MCP végponton keresztül. ' +
            'A PDF megtekintéséhez nyisd meg a hirdetőfelületet: https://haszno.com/shop/palyazatok',
        })
      },
    )
  } else {
    // Local/stdio mode: download the PDF and save it to savePath.
    server.registerTool(
      'haszno_shop_job_applicant_cv_download',
      {
        title: 'Download applicant CV to a local file',
        description:
          'Downloads a job applicant\'s CV PDF to a local file (advertiser side). ' +
          'Provide savePath for the destination (e.g. /tmp/applicant-cv.pdf). ' +
          'If savePath is omitted, the file is saved to the system temp directory. ' +
          'Returns the saved file path and size. ' +
          'CV content and applicants\' personal data are sensitive — do not paste them into other services or logs. ' +
          'GET /api/v1/shop/my/job-applications/{id}/cv → PDF (binary).',
        inputSchema: {
          id: z.number().int().positive().describe('Application ID (from haszno_shop_job_applicants_list)'),
          savePath: z.string().optional().describe('Absolute path where the PDF will be saved (e.g. /tmp/cv.pdf). Defaults to a temp file.'),
        },
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      async (args) => {
        try {
          const pdfBuffer = await getRawBinary(`/api/v1/shop/my/job-applications/${args.id}/cv`, opts)
          const dest = (args.savePath as string | undefined) ?? path.join(os.tmpdir(), `haszno-cv-${args.id}.pdf`)
          try {
            fs.writeFileSync(dest, pdfBuffer)
          } catch (e) {
            return mkErr(`job_applicant_cv_download: Nem sikerült menteni a fájlt (${dest}): ${String(e)}`)
          }
          return json({ savedPath: dest, sizeBytes: pdfBuffer.length })
        } catch (e) {
          return mapApiError(e, 'job_applicant_cv_download')
        }
      },
    )
  }
}
