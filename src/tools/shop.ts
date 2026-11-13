/**
 * MCP tools — Hirdetési piactér (shop / marketplace).
 *
 * All endpoints use the /api/v1 prefix (which the server normalises to /api).
 * Auth is passed through opts (Bearer haszno_ token or legacy key/Basic).
 *
 * Read tools:
 *   haszno_shop_list_categories    — full category taxonomy
 *   haszno_shop_search_ads         — search public ads
 *   haszno_shop_get_ad             — single ad detail (includes reserved flag)
 *   haszno_shop_price_hint         — suggested price range for a category
 *   haszno_shop_list_my_ads        — my own ads (authenticated)
 *   haszno_shop_list_inquiries     — inquiries on my ads (authenticated)
 *   haszno_shop_list_favorites     — my saved favorites (authenticated)
 *   haszno_shop_list_reservations  — reservations as buyer or seller
 *
 * Write tools:
 *   haszno_shop_upload_image          — upload image file/base64, get id + URL back
 *   haszno_shop_suggest_from_photos   — AI pre-fill from uploaded image IDs
 *   haszno_shop_create_ad             — post a new ad (validates required category attrs)
 *   haszno_shop_update_ad             — edit an existing ad (fetches current then PUTs)
 *   haszno_shop_set_ad_status         — pause, reactivate, or delete an ad
 *   haszno_shop_mark_sold             — mark an ad as sold
 *   haszno_shop_renew_ad              — renew / bump an ad
 *   haszno_shop_send_inquiry          — send a question to the seller
 *   haszno_shop_set_favorite          — save / remove a favorite
 *   haszno_shop_reserve_ad            — place a reservation on an ad
 *   haszno_shop_respond_reservation   — accept or decline (seller)
 *   haszno_shop_cancel_reservation    — cancel own reservation (buyer)
 *   haszno_shop_complete_reservation  — mark a reservation fulfilled (seller)
 */
import * as fs from 'node:fs'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { get, post, put, del, type HttpOptions, SHOP_TOKEN_PREFIX } from '../client/http.js'
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

// ── Raw binary upload helper ──────────────────────────────────────────────────

/**
 * Build auth headers matching http.ts buildAuthHeader, without Content-Type
 * (caller sets Content-Type explicitly for the raw binary body).
 */
function buildBearerHeaders(opts: HttpOptions): Record<string, string> {
  const key =
    opts.apiKey ??
    process.env['HASZNO_API_TOKEN'] ??
    process.env['HASZNO_API_KEY'] ??
    process.env['ARFUTAR_API_KEY']

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'haszno-mcp/0.2.0',
  }

  if (key) {
    if (key.startsWith(SHOP_TOKEN_PREFIX)) headers['Authorization'] = `Bearer ${key}`
    else headers['x-api-key'] = key
  } else {
    const basic =
      opts.basicAuth ?? process.env['HASZNO_BASIC'] ?? process.env['ARFUTAR_BASIC']
    if (basic) {
      headers['Authorization'] = `Basic ${Buffer.from(basic).toString('base64')}`
    }
  }
  return headers
}

/**
 * Upload raw binary bytes to a path.
 * POST /api/v1/shop/images accepts raw body with Content-Type image/jpeg|png|webp.
 */
async function uploadRawBinary<T>(
  path: string,
  bytes: Buffer,
  mimeType: string,
  opts: HttpOptions,
): Promise<T> {
  const baseUrl = (
    opts.baseUrl ??
    process.env['HASZNO_API_URL'] ??
    process.env['ARFUTAR_API_URL'] ??
    'https://haszno.com'
  ).replace(/\/$/, '')

  const fetchFn = opts.fetch ?? fetch
  const response = await fetchFn(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      ...buildBearerHeaders(opts),
      'Content-Type': mimeType,
    },
    body: bytes,
  })

  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const data = (await response.json()) as { error?: string }
      if (data.error) message = data.error
    } catch {
      // ignore parse errors
    }
    throw new HasznoApiError(response.status, message)
  }

  const text = await response.text()
  if (!text) return undefined as unknown as T
  return JSON.parse(text) as T
}

// ─── Category attribute validation ───────────────────────────────────────────

interface AttrDef {
  key: string
  label: string
  required?: boolean
  type?: string
  options?: Array<{ value: string; label: string }>
}

interface TaxonomyCategory {
  key: string
  label: string
  subcategories: Array<{ key: string; label: string; attrs: string[] }>
  attrs: AttrDef[]
}

interface Taxonomy {
  categories: TaxonomyCategory[]
  conditions: Array<{ value: string; label: string }>
  counties: string[]
}

/**
 * Fetches the taxonomy and validates that all required attributes for `categoryKey`
 * are present in `suppliedAttrs`.
 * Returns null on success, or an error string listing what is missing.
 * Skips validation (returns null) if the taxonomy fetch itself fails.
 */
async function validateCategoryAttributes(
  categoryKey: string,
  suppliedAttrs: Record<string, unknown>,
  opts: HttpOptions,
): Promise<string | null> {
  let taxonomy: Taxonomy
  try {
    taxonomy = await get<Taxonomy>('/api/v1/shop/taxonomy', opts)
  } catch {
    // Taxonomy fetch failed — skip validation, let the server decide
    return null
  }

  if (!taxonomy || !Array.isArray(taxonomy.categories)) return null

  const cat = taxonomy.categories.find((c) => c.key === categoryKey)
  if (!cat || !Array.isArray(cat.attrs)) return null

  const missing = cat.attrs
    .filter((a) => a.required && !(a.key in suppliedAttrs))
    .map((a) => a.key)

  if (missing.length === 0) return null

  return (
    `Hiányzó kötelező kategória-attribútumok a "${cat.label}" kategóriához: ` +
    missing.join(', ') +
    '. Töltsd ki ezeket az attrs mezőbe, majd próbáld újra.'
  )
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerShopTools(server: McpServer, opts: HttpOptions): void {

  // ─── haszno_shop_list_categories ──────────────────────────────────────────

  server.registerTool(
    'haszno_shop_list_categories',
    {
      title: 'List shop categories (taxonomy)',
      description:
        'Returns the full category taxonomy of the Haszno Hirdetési Piactér (marketplace). ' +
        'Each category has a "key" (string slug), "label" (Hungarian name), "subcategories" (array with key/label/attrs), ' +
        'and "attrs" — the attribute definitions (key, label, type, required, options) for ads in that category. ' +
        'Also returns "conditions" (product conditions) and "counties" (valid Hungarian county names). ' +
        'Call this before haszno_shop_create_ad to identify the correct category.key and required attr keys. ' +
        'The Haszno Shop is completely free — there are no listing or usage fees.',
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => {
      try {
        const result = await get('/api/v1/shop/taxonomy', opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, 'list_categories')
      }
    },
  )

  // ─── haszno_shop_search_ads ────────────────────────────────────────────────

  server.registerTool(
    'haszno_shop_search_ads',
    {
      title: 'Search public ads',
      description:
        'Searches the public Haszno Hirdetési Piactér (marketplace) for second-hand ads. ' +
        'Returns a paginated list of ads including their id, title, priceGross (HUF), status, images, ' +
        'and a "reserved" flag (true when an accepted reservation exists for the ad). ' +
        'The Shop is free — no fees for browsing or contacting sellers. ' +
        'Filter by category with cat (category key string from haszno_shop_list_categories), ' +
        'full-text search with q, price range with min/max (HUF). ' +
        'Sort: "uj" (newest, default), "ar_nov" (price ascending), "ar_csokk" (price descending).',
      inputSchema: {
        q: z.string().optional().describe('Full-text search query'),
        cat: z.string().optional().describe('Filter by category key (e.g. "jarmuvek", "elektronika")'),
        sub: z.string().optional().describe('Filter by subcategory key (e.g. "szemelyauto")'),
        min: z.number().int().min(0).optional().describe('Minimum price in HUF gross'),
        max: z.number().int().min(0).optional().describe('Maximum price in HUF gross'),
        county: z.string().optional().describe('Filter by county name (from taxonomy counties list)'),
        city: z.string().optional().describe('Filter by city name'),
        cond: z.enum(['uj', 'ujszeru', 'hasznalt', 'serult']).optional().describe('Product condition filter'),
        sort: z.enum(['uj', 'ar_nov', 'ar_csokk']).optional().describe('"uj" (newest), "ar_nov" (price asc), "ar_csokk" (price desc)'),
        page: z.number().int().min(1).optional().describe('Page number (default 1, page size 24)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args) => {
      try {
        const qs = new URLSearchParams()
        if (args.q) qs.set('q', args.q)
        if (args.cat) qs.set('cat', args.cat)
        if (args.sub) qs.set('sub', args.sub)
        if (args.min != null) qs.set('min', String(args.min))
        if (args.max != null) qs.set('max', String(args.max))
        if (args.county) qs.set('county', args.county)
        if (args.city) qs.set('city', args.city)
        if (args.cond) qs.set('cond', args.cond)
        if (args.sort) qs.set('sort', args.sort)
        if (args.page != null) qs.set('page', String(args.page))
        const suffix = qs.toString() ? `?${qs}` : ''
        const result = await get(`/api/v1/shop/ads${suffix}`, opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, 'search_ads')
      }
    },
  )

  // ─── haszno_shop_get_ad ────────────────────────────────────────────────────

  server.registerTool(
    'haszno_shop_get_ad',
    {
      title: 'Get a single ad',
      description:
        'Fetches the full detail of a Haszno marketplace ad by its ID. ' +
        'Returns all fields including images, attributes (attrs), seller info, and the "reserved" flag ' +
        '(true when an accepted reservation exists). ' +
        'The Shop is free — browsing and contacting sellers costs nothing.',
      inputSchema: {
        id: z.number().int().min(1).describe('Ad ID'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args) => {
      try {
        const result = await get(`/api/v1/shop/ads/${args.id}`, opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, 'get_ad')
      }
    },
  )

  // ─── haszno_shop_price_hint ────────────────────────────────────────────────

  server.registerTool(
    'haszno_shop_price_hint',
    {
      title: 'Get a suggested price hint',
      description:
        'Returns a suggested asking price range (p25–p75 percentile) for a category, ' +
        'based on at least 5 distinct sellers\' active listings. Returns null when there is not enough data. ' +
        'Use this before calling haszno_shop_create_ad to set a realistic priceGross. ' +
        'Pass cat (category key from haszno_shop_list_categories) and optionally sub (subcategory key).',
      inputSchema: {
        cat: z.string().describe('Category key (e.g. "jarmuvek", "elektronika") from haszno_shop_list_categories'),
        sub: z.string().optional().describe('Subcategory key to narrow the hint'),
        q: z.string().optional().describe('Item description or keywords (accepted but ignored by the server)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args) => {
      try {
        const qs = new URLSearchParams()
        qs.set('cat', args.cat)
        if (args.sub) qs.set('sub', args.sub)
        if (args.q) qs.set('q', args.q)
        const result = await get(`/api/v1/shop/assist/price-hint?${qs}`, opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, 'price_hint')
      }
    },
  )

  // ─── haszno_shop_list_my_ads ───────────────────────────────────────────────

  server.registerTool(
    'haszno_shop_list_my_ads',
    {
      title: "List my own ads",
      description:
        "Returns the authenticated user's own marketplace ads (all non-deleted). " +
        'Each entry includes id, title, priceGross, status (aktiv/szunetel/eladva), images, reserved flag, ' +
        'and stats (views, inquiries, favorites). ' +
        'Requires authentication (Bearer token). ' +
        'Status values: "aktiv" (live), "szunetel" (paused), "eladva" (sold).',
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => {
      try {
        const result = await get('/api/v1/shop/my/ads', opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, 'list_my_ads')
      }
    },
  )

  // ─── haszno_shop_list_inquiries ────────────────────────────────────────────

  server.registerTool(
    'haszno_shop_list_inquiries',
    {
      title: 'List inquiries on my ads',
      description:
        'Returns messages/questions sent to your ads by potential buyers. ' +
        'Optionally filter by adId to see inquiries for a specific ad. ' +
        'Pagination: use limit (1–200, default 50) and offset (default 0). ' +
        'Requires authentication.',
      inputSchema: {
        adId: z.number().int().min(1).optional().describe('Filter by a specific ad ID'),
        limit: z.number().int().min(1).max(200).optional().describe('Page size (default 50, max 200)'),
        offset: z.number().int().min(0).optional().describe('Skip this many items (default 0)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args) => {
      try {
        const qs = new URLSearchParams()
        if (args.adId != null) qs.set('adId', String(args.adId))
        if (args.limit != null) qs.set('limit', String(args.limit))
        if (args.offset != null) qs.set('offset', String(args.offset))
        const suffix = qs.toString() ? `?${qs}` : ''
        const result = await get(`/api/v1/shop/my/inquiries${suffix}`, opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, 'list_inquiries')
      }
    },
  )

  // ─── haszno_shop_list_favorites ────────────────────────────────────────────

  server.registerTool(
    'haszno_shop_list_favorites',
    {
      title: 'List my saved favorites',
      description:
        'Returns the active ads the authenticated user has saved as favorites. ' +
        'Requires authentication.',
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => {
      try {
        const result = await get('/api/v1/shop/my/favorites', opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, 'list_favorites')
      }
    },
  )

  // ─── haszno_shop_list_reservations ────────────────────────────────────────

  server.registerTool(
    'haszno_shop_list_reservations',
    {
      title: 'List my reservations',
      description:
        'Returns reservations for the authenticated user. ' +
        'Use role="buyer" (default) to list reservations YOU placed on other people\'s ads. ' +
        'Use role="seller" to list reservations buyers placed on YOUR ads. ' +
        'Status values: "fuggoben" (pending), "elfogadva" (accepted), "elutasitva" (declined/auto-declined), ' +
        '"visszavonva" (cancelled by buyer), "teljesitve" (completed), "lejart" (hold expired). ' +
        'Contact fields (phone, email) are only filled in when status is "elfogadva" or "teljesitve". ' +
        'Reserving is not paying — payment and handover happen directly between buyer and seller.',
      inputSchema: {
        role: z.enum(['buyer', 'seller']).optional().describe('Whose perspective: "buyer" (default) or "seller"'),
        status: z.string().optional().describe('Filter by reservation status'),
        page: z.number().int().min(1).optional().describe('Page number (default 1)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args) => {
      try {
        const qs = new URLSearchParams()
        if (args.role) qs.set('role', args.role)
        if (args.status) qs.set('status', args.status)
        if (args.page != null) qs.set('page', String(args.page))
        const suffix = qs.toString() ? `?${qs}` : ''
        const result = await get(`/api/v1/shop/my/reservations${suffix}`, opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, 'list_reservations')
      }
    },
  )

  // ─── haszno_shop_upload_image ──────────────────────────────────────────────

  server.registerTool(
    'haszno_shop_upload_image',
    {
      title: 'Upload an ad image',
      description:
        'Uploads an image for use in a Haszno marketplace ad. ' +
        'Provide either an absolute local file path ("filePath") OR a base64-encoded image with its MIME type ("base64" + "mimeType"). ' +
        'Returns an object with "id" (numeric image ID) and "url" (path like /api/shop/images/<id>). ' +
        '— Pass url in the "images" array of haszno_shop_create_ad or haszno_shop_update_ad. ' +
        '— Pass id in the "imageIds" array of haszno_shop_suggest_from_photos. ' +
        'Supported MIME types: image/jpeg, image/png, image/webp. Maximum size: 700 KB. ' +
        'The Haszno Shop is free — no fees for uploading images.',
      inputSchema: {
        filePath: z.string().optional().describe(
          'Absolute path to a local image file (e.g. /home/user/photo.jpg). Provide this OR base64/mimeType.',
        ),
        base64: z.string().optional().describe(
          'Base64-encoded image data (without the data: URI prefix). Provide together with mimeType.',
        ),
        mimeType: z.string().optional().describe(
          'MIME type for base64 input: image/jpeg, image/png, or image/webp.',
        ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      if (!args.filePath && !args.base64) {
        return mkErr('Adj meg vagy filePath-t (abszolút fájlútvonal) vagy base64 + mimeType párt.')
      }
      if (args.base64 && !args.mimeType) {
        return mkErr('base64 megadásakor mimeType is szükséges (pl. image/jpeg).')
      }

      // ── Security constants ────────────────────────────────────────────────
      const ALLOWED_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp'])
      const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])
      const MAX_SIZE_BYTES = 700 * 1024 // 700 KB — matches the server limit

      // Magic-byte signatures for JPEG, PNG, and WebP.
      function detectMimeFromBytes(buf: Buffer): string | null {
        if (buf.length < 4) return null
        if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
        if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
        // WebP: bytes 0-3 = 'RIFF', bytes 8-11 = 'WEBP'
        if (buf.length >= 12 &&
            buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
            buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
          return 'image/webp'
        }
        return null
      }

      let buffer: Buffer
      let detectedMime: string

      if (args.filePath) {
        // Extension whitelist — reject anything not in the allowed set early.
        const ext = args.filePath.split('.').pop()?.toLowerCase() ?? ''
        if (!ALLOWED_EXTS.has(ext)) {
          return mkErr(`Csak JPEG, PNG és WebP fájlok tölthetők fel (kapott kiterjesztés: .${ext || 'ismeretlen'}).`)
        }

        try {
          buffer = fs.readFileSync(args.filePath)
        } catch (e) {
          return mkErr(`Nem sikerült beolvasni a fájlt: ${String(e)}`)
        }

        // Size cap.
        if (buffer.length > MAX_SIZE_BYTES) {
          return mkErr(`A fájl mérete (${(buffer.length / 1024).toFixed(0)} KB) meghaladja a 700 KB-os határt.`)
        }

        // Magic-byte check — must match the declared extension.
        const mime = detectMimeFromBytes(buffer)
        if (!mime) {
          return mkErr('A fájl nem felismerhető képformátum (JPEG, PNG vagy WebP szükséges).')
        }
        const extMime: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
        if (mime !== extMime[ext]) {
          return mkErr(`A fájl tartalma (${mime}) nem egyezik a kiterjesztéssel (.${ext}).`)
        }
        detectedMime = mime
      } else {
        // base64 path (checked above: args.base64 is set, args.mimeType is set)
        const declaredMime = args.mimeType as string
        if (!ALLOWED_MIMES.has(declaredMime)) {
          return mkErr(`Nem támogatott MIME típus: ${declaredMime}. Csak image/jpeg, image/png és image/webp elfogadott.`)
        }

        try {
          buffer = Buffer.from(args.base64 as string, 'base64')
        } catch (e) {
          return mkErr(`Érvénytelen base64 adat: ${String(e)}`)
        }

        // Size cap.
        if (buffer.length > MAX_SIZE_BYTES) {
          return mkErr(`A kép mérete (${(buffer.length / 1024).toFixed(0)} KB) meghaladja a 700 KB-os határt.`)
        }

        // Magic-byte check — must match declared MIME type.
        const mime = detectMimeFromBytes(buffer)
        if (!mime) {
          return mkErr('A base64 adat nem felismerhető képformátum (JPEG, PNG vagy WebP szükséges).')
        }
        if (mime !== declaredMime) {
          return mkErr(`A kép valódi formátuma (${mime}) nem egyezik a megadott mimeType értékkel (${declaredMime}).`)
        }
        detectedMime = mime
      }

      try {
        // POST /api/shop/images — raw binary body, Content-Type = image/jpeg|png|webp
        const result = await uploadRawBinary<{ id: number; url: string }>(
          '/api/v1/shop/images',
          buffer,
          detectedMime,
          opts,
        )
        return json(result)
      } catch (e) {
        return mapApiError(e, 'upload_image')
      }
    },
  )

  // ─── haszno_shop_suggest_from_photos ──────────────────────────────────────

  server.registerTool(
    'haszno_shop_suggest_from_photos',
    {
      title: 'AI pre-fill ad from uploaded photos',
      description:
        'Sends uploaded image IDs to the Haszno AI to generate a suggested ad title, description, ' +
        'category, condition, and category-specific attributes. ' +
        'Upload images first with haszno_shop_upload_image to get the numeric "id" of each image, ' +
        'then pass those IDs here (1–3 images). ' +
        'The result is a suggestion only — review it before passing it to haszno_shop_create_ad. ' +
        'Returns error 503 when the AI feature is not enabled on this server.',
      inputSchema: {
        imageIds: z.array(z.number().int().min(1)).min(1).max(3).describe(
          'Numeric image IDs from haszno_shop_upload_image (1–3 IDs)',
        ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      try {
        const result = await post('/api/v1/shop/assist/from-photos', { imageIds: args.imageIds }, opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, 'suggest_from_photos')
      }
    },
  )

  // ─── haszno_shop_create_ad ─────────────────────────────────────────────────

  server.registerTool(
    'haszno_shop_create_ad',
    {
      title: 'Post a new marketplace ad',
      description:
        'Creates a new Haszno Hirdetési Piactér (marketplace) ad. ' +
        'This is a REAL action — the ad becomes immediately visible to all users on haszno.com. ' +
        'Only call this when the user has explicitly confirmed they want to post the ad. ' +
        'The Haszno Shop is completely free — there are no listing fees. ' +
        'Before calling this tool: ' +
        '(1) call haszno_shop_list_categories to get the category key, subcategory key, required attrs, and valid county names; ' +
        '(2) call haszno_shop_upload_image for each photo and collect the returned "url" values; ' +
        '(3) call haszno_shop_price_hint for a price suggestion. ' +
        'Image URLs must be in the format /api/shop/images/<id> (returned by haszno_shop_upload_image). ' +
        'This tool validates required category attributes before sending.',
      inputSchema: {
        category: z.string().describe('Category key (e.g. "jarmuvek") from haszno_shop_list_categories'),
        subcategory: z.string().optional().nullable().describe('Subcategory key (optional, e.g. "szemelya" for "jarmuvek")'),
        title: z.string().min(5).max(120).describe('Ad title (5–120 characters)'),
        description: z.string().max(5000).describe('Ad description (max 5000 chars)'),
        priceGross: z.number().int().min(1).max(2_000_000_000).nullable().describe('Asking price in HUF gross, or null for "price on request"'),
        negotiable: z.boolean().describe('Whether the price is negotiable'),
        condition: z.enum(['uj', 'ujszeru', 'hasznalt', 'serult']).describe(
          'Product condition: "uj" (new), "ujszeru" (like new), "hasznalt" (used), "serult" (damaged)',
        ),
        county: z.string().describe('Hungarian county name from haszno_shop_list_categories counties list'),
        city: z.string().min(1).max(80).describe('City name'),
        images: z.array(z.string()).max(10).optional().describe(
          'Image URLs from haszno_shop_upload_image (format: /api/shop/images/<id>, max 10)',
        ),
        attrs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe(
          'Category-specific attributes (e.g. { "allapot": "hasznalt", "marka": "Samsung" }). ' +
          'Required attributes depend on the category — call haszno_shop_list_categories to see them.',
        ),
        contactName: z.string().min(1).max(80).describe('Seller contact name'),
        contactPhone: z.string().optional().nullable().describe('Contact phone number (optional)'),
        contactEmail: z.string().email().describe('Seller contact e-mail address'),
        showPhone: z.boolean().describe('Whether to display the phone number publicly'),
        resellable: z.boolean().describe('Allow partner shops to list this ad in their own webshops'),
        partnerCommissionPct: z.number().min(0).max(30).describe('Commission % to offer partner shops (0–30)'),
        confirm: z.literal(true).describe(
          'Must be exactly true. This posts a real, public ad — only set this after the user confirms.',
        ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      // Validate category attributes before sending
      const attrs = (args.attrs ?? {}) as Record<string, unknown>
      const validationError = await validateCategoryAttributes(args.category, attrs, opts)
      if (validationError) {
        return mkErr(validationError)
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
        partnerCommissionPct: args.partnerCommissionPct,
      }

      try {
        const result = await post('/api/v1/shop/ads', body, opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, 'create_ad')
      }
    },
  )

  // ─── haszno_shop_update_ad ─────────────────────────────────────────────────

  server.registerTool(
    'haszno_shop_update_ad',
    {
      title: 'Update an existing ad',
      description:
        'Updates an existing Haszno marketplace ad (PUT — the server replaces the full ad). ' +
        'This tool first fetches the current ad values, merges in only the fields you provide, ' +
        'then sends the complete updated body. Only pass the fields you want to change. ' +
        'The ad must belong to the authenticated user. ' +
        'Image URLs must be in the format /api/shop/images/<id>. ' +
        'The Haszno Shop is free.',
      inputSchema: {
        id: z.number().int().min(1).describe('Ad ID to update'),
        category: z.string().optional().describe('Category key'),
        subcategory: z.string().optional().nullable(),
        title: z.string().min(5).max(120).optional(),
        description: z.string().max(5000).optional(),
        priceGross: z.number().int().min(1).max(2_000_000_000).nullable().optional().describe('New asking price in HUF gross, or null for "price on request"'),
        negotiable: z.boolean().optional(),
        condition: z.enum(['uj', 'ujszeru', 'hasznalt', 'serult']).optional(),
        county: z.string().optional(),
        city: z.string().min(1).max(80).optional(),
        images: z.array(z.string()).max(10).optional().describe('Image URLs (/api/shop/images/<id> format)'),
        attrs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
        contactName: z.string().min(1).max(80).optional(),
        contactPhone: z.string().optional().nullable(),
        contactEmail: z.string().email().optional(),
        showPhone: z.boolean().optional(),
        resellable: z.boolean().optional(),
        partnerCommissionPct: z.number().min(0).max(30).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      const { id, ...updates } = args

      // Fetch current ad to build the full PUT body
      let current: Record<string, unknown>
      try {
        current = await get<Record<string, unknown>>(`/api/v1/shop/my/ads/${id}`, opts)
      } catch (e) {
        return mapApiError(e, `update_ad (fetch current state for id=${id})`)
      }

      // Merge caller-supplied fields over current values
      const body: Record<string, unknown> = {
        category: updates.category ?? current['category'],
        subcategory: 'subcategory' in updates ? updates.subcategory : current['subcategory'],
        title: updates.title ?? current['title'],
        description: updates.description ?? current['description'],
        priceGross: 'priceGross' in updates ? updates.priceGross : current['priceGross'],
        negotiable: updates.negotiable ?? current['negotiable'],
        condition: updates.condition ?? current['condition'],
        county: updates.county ?? current['county'],
        city: updates.city ?? current['city'],
        images: updates.images ?? current['images'],
        attrs: updates.attrs ?? current['attrs'],
        contactName: updates.contactName ?? current['contactName'],
        contactPhone: 'contactPhone' in updates ? updates.contactPhone : current['contactPhone'],
        contactEmail: updates.contactEmail ?? current['contactEmail'],
        showPhone: updates.showPhone ?? current['showPhone'],
        resellable: updates.resellable ?? current['resellable'],
        partnerCommissionPct: updates.partnerCommissionPct ?? current['partnerCommissionPct'],
      }

      try {
        const result = await put(`/api/v1/shop/ads/${id}`, body, opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, 'update_ad')
      }
    },
  )

  // ─── haszno_shop_set_ad_status ─────────────────────────────────────────────

  server.registerTool(
    'haszno_shop_set_ad_status',
    {
      title: 'Change ad status (pause, reactivate, or delete)',
      description:
        'Changes an ad\'s status. ' +
        '"szunetel" hides the ad from public search (paused); ' +
        '"aktiv" makes it visible again (also resets the expiry timer); ' +
        '"torolve" soft-deletes the ad permanently (irreversible). ' +
        'The ad must belong to the authenticated user.',
      inputSchema: {
        id: z.number().int().min(1).describe('Ad ID'),
        status: z.enum(['aktiv', 'szunetel', 'torolve']).describe(
          '"aktiv" to show, "szunetel" to pause, "torolve" to permanently delete',
        ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/ads/${args.id}/status`, { status: args.status }, opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, 'set_ad_status')
      }
    },
  )

  // ─── haszno_shop_mark_sold ─────────────────────────────────────────────────

  server.registerTool(
    'haszno_shop_mark_sold',
    {
      title: 'Mark an ad as sold',
      description:
        'Marks an ad as sold ("eladva"), removing it from public search. ' +
        'This is IRREVERSIBLE — a sold ad cannot be re-activated. ' +
        'Only call this when the user confirms the item has been sold. ' +
        'Side effect: all open reservations for this ad become "elutasitva" (declined). ' +
        'The Haszno Shop is free — there are no sales fees.',
      inputSchema: {
        id: z.number().int().min(1).describe('Ad ID'),
        soldPriceGross: z.number().int().min(1).optional().nullable().describe(
          'Actual sale price in HUF gross (optional, for your records)',
        ),
        confirm: z.literal(true).describe(
          'Must be exactly true. This permanently marks the ad as sold.',
        ),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async (args) => {
      try {
        const body: Record<string, unknown> = {}
        if (args.soldPriceGross != null) body['soldPriceGross'] = args.soldPriceGross
        const result = await post(`/api/v1/shop/ads/${args.id}/sold`, body, opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, 'mark_sold')
      }
    },
  )

  // ─── haszno_shop_renew_ad ──────────────────────────────────────────────────

  server.registerTool(
    'haszno_shop_renew_ad',
    {
      title: 'Renew / bump an ad',
      description:
        'Renews an ad, resetting its 60-day expiry timer and bumping it back to the top of search results. ' +
        'Use this for ads that are about to expire or have fallen in ranking. ' +
        'The Haszno Shop is free — renewal has no cost.',
      inputSchema: {
        id: z.number().int().min(1).describe('Ad ID to renew'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/ads/${args.id}/renew`, {}, opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, 'renew_ad')
      }
    },
  )

  // ─── haszno_shop_send_inquiry ──────────────────────────────────────────────

  server.registerTool(
    'haszno_shop_send_inquiry',
    {
      title: 'Send an inquiry to the seller',
      description:
        'Sends a message or question to the seller of an ad. ' +
        'The seller will be notified and can respond through Haszno. ' +
        'Requires name, email, and message (at least 5 characters). ' +
        'The Haszno Shop is free.',
      inputSchema: {
        adId: z.number().int().min(1).describe('Ad ID to send the inquiry to'),
        name: z.string().min(1).max(80).describe('Your name'),
        email: z.string().email().describe('Your e-mail address'),
        phone: z.string().max(50).optional().nullable().describe('Your phone number (optional)'),
        message: z.string().min(5).max(2000).describe('Your message or question for the seller (min 5 characters)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      try {
        const body: Record<string, unknown> = {
          name: args.name,
          email: args.email,
          message: args.message,
        }
        if (args.phone != null) body['phone'] = args.phone
        const result = await post(`/api/v1/shop/ads/${args.adId}/inquiries`, body, opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, 'send_inquiry')
      }
    },
  )

  // ─── haszno_shop_set_favorite ──────────────────────────────────────────────

  server.registerTool(
    'haszno_shop_set_favorite',
    {
      title: 'Save or remove a favorite',
      description:
        'Saves or removes an ad from your favorites list. ' +
        'Set save=true to add to favorites (PUT /favorite), save=false to remove (DELETE /favorite). ' +
        'The Haszno Shop is free.',
      inputSchema: {
        adId: z.number().int().min(1).describe('Ad ID'),
        save: z.boolean().describe('true to save as favorite, false to remove'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        let result: unknown
        if (args.save) {
          result = await put(`/api/v1/shop/ads/${args.adId}/favorite`, {}, opts)
        } else {
          result = await del(`/api/v1/shop/ads/${args.adId}/favorite`, opts)
        }
        return json(result)
      } catch (e) {
        return mapApiError(e, 'set_favorite')
      }
    },
  )

  // ─── haszno_shop_reserve_ad ────────────────────────────────────────────────

  server.registerTool(
    'haszno_shop_reserve_ad',
    {
      title: 'Place a reservation on an ad',
      description:
        'Places a reservation on a Haszno marketplace ad. ' +
        'This is a REAL action visible to the seller immediately — ' +
        'only call this when the user has explicitly confirmed they want to reserve this item. ' +
        'IMPORTANT: Reserving is NOT paying. Payment and handover happen directly between buyer and seller ' +
        'outside Haszno — the platform only facilitates the initial contact. ' +
        'The Haszno Shop is completely free — no reservation fees. ' +
        'You may optionally include a message, a counter-offer price (offerPriceGross), and your phone number. ' +
        'The seller will accept or decline the reservation. ' +
        'Returns error 409 if you already have an open reservation for this ad.',
      inputSchema: {
        adId: z.number().int().min(1).describe('Ad ID to reserve'),
        message: z.string().max(1000).optional().describe('Optional message to the seller (max 1000 chars)'),
        offerPriceGross: z.number().int().min(1).optional().describe(
          'Counter-offer price in HUF gross (optional — omit to accept the listed price)',
        ),
        phone: z.string().max(50).optional().describe(
          'Your phone number (optional; revealed to the seller only if they accept)',
        ),
        confirm: z.literal(true).describe(
          'Must be exactly true. This sends a real reservation request to the seller.',
        ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      const body: Record<string, unknown> = {}
      if (args.message) body['message'] = args.message
      if (args.offerPriceGross != null) body['offerPriceGross'] = args.offerPriceGross
      if (args.phone) body['phone'] = args.phone

      try {
        const result = await post(`/api/v1/shop/ads/${args.adId}/reservations`, body, opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, 'reserve_ad')
      }
    },
  )

  // ─── haszno_shop_respond_reservation ──────────────────────────────────────

  server.registerTool(
    'haszno_shop_respond_reservation',
    {
      title: 'Accept or decline a reservation (seller)',
      description:
        'Accepts or declines a pending reservation on one of your ads (seller action). ' +
        'action="accept": marks the reservation as "elfogadva" (accepted); ' +
        'the buyer\'s contact details become visible to you in the reservation. ' +
        'action="decline": marks the reservation as "elutasitva" (declined); ' +
        'the ad remains active for other buyers. ' +
        'The Haszno Shop is free — accepting a reservation does NOT create a payment.',
      inputSchema: {
        id: z.number().int().min(1).describe('Reservation ID'),
        action: z.enum(['accept', 'decline']).describe('"accept" or "decline"'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      try {
        const path = `/api/v1/shop/my/reservations/${args.id}/${args.action}`
        const result = await post(path, {}, opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, `respond_reservation(${args.action})`)
      }
    },
  )

  // ─── haszno_shop_cancel_reservation ───────────────────────────────────────

  server.registerTool(
    'haszno_shop_cancel_reservation',
    {
      title: 'Cancel your reservation (buyer)',
      description:
        'Cancels a reservation you placed as a buyer (status becomes "visszavonva"). ' +
        'Only pending ("fuggoben") or accepted ("elfogadva") reservations can be cancelled. ' +
        'The Haszno Shop is free — cancellation has no cost.',
      inputSchema: {
        id: z.number().int().min(1).describe('Reservation ID to cancel'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/my/reservations/${args.id}/cancel`, {}, opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, 'cancel_reservation')
      }
    },
  )

  // ─── haszno_shop_complete_reservation ─────────────────────────────────────

  server.registerTool(
    'haszno_shop_complete_reservation',
    {
      title: 'Complete a reservation (seller)',
      description:
        'Marks a reservation as completed ("teljesitve"), confirming that the item has changed hands. ' +
        'This is a REAL, IRREVERSIBLE action — only call it when the user confirms the sale is done. ' +
        'Side effects: ' +
        '(1) the ad status changes to "eladva" (sold) and disappears from search; ' +
        '(2) all other open reservations for the same ad are automatically declined. ' +
        'Optionally record the actual sold price (soldPriceGross) for your records — it is not shared publicly. ' +
        'REMINDER: Payment and handover happen directly between buyer and seller — Haszno does not process payments. ' +
        'The Haszno Shop is free — no commission on completed deals.',
      inputSchema: {
        id: z.number().int().min(1).describe('Reservation ID'),
        soldPriceGross: z.number().int().min(1).optional().nullable().describe(
          'Actual sale price in HUF gross (optional, for your records only)',
        ),
        confirm: z.literal(true).describe(
          'Must be exactly true. This irreversibly marks the ad as sold.',
        ),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async (args) => {
      const body: Record<string, unknown> = {}
      if (args.soldPriceGross !== undefined) body['soldPriceGross'] = args.soldPriceGross

      try {
        const result = await post(`/api/v1/shop/my/reservations/${args.id}/complete`, body, opts)
        return json(result)
      } catch (e) {
        return mapApiError(e, 'complete_reservation')
      }
    },
  )
}
