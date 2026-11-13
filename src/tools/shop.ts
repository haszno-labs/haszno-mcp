/**
 * MCP tools — Hirdetési piactér (shop / marketplace).
 *
 * All new endpoints use the /api/v1 prefix.
 * Auth is passed through opts (Bearer haszno_ token or legacy key/Basic).
 *
 * Read tools:
 *   haszno_shop_list_categories    — category taxonomy
 *   haszno_shop_search_ads         — search public ads
 *   haszno_shop_get_ad             — single ad detail (includes reserved flag)
 *   haszno_shop_price_hint         — suggested price for a category
 *   haszno_shop_list_my_ads        — my own ads (authenticated)
 *   haszno_shop_list_inquiries     — inquiries on my ads (authenticated)
 *   haszno_shop_list_favorites     — my saved favorites (authenticated)
 *   haszno_shop_list_reservations  — reservations as buyer or seller
 *
 * Write tools:
 *   haszno_shop_upload_image          — upload image file/base64, get URL back
 *   haszno_shop_suggest_from_photos   — AI pre-fill from uploaded image URLs
 *   haszno_shop_create_ad             — post a new ad (validates required category attrs)
 *   haszno_shop_update_ad             — edit an existing ad
 *   haszno_shop_set_ad_status         — pause or reactivate an ad
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
import { get, post, patch, del, type HttpOptions, SHOP_TOKEN_PREFIX } from '../client/http.js'
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

// ── Multipart upload helper ───────────────────────────────────────────────────

/**
 * Build auth headers matching http.ts buildAuthHeader, without Content-Type
 * (fetch sets it automatically with the FormData boundary).
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

async function uploadMultipart<T>(
  path: string,
  formData: FormData,
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
    headers: buildBearerHeaders(opts),
    body: formData,
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

interface CategoryAttribute {
  name: string
  required?: boolean
  type?: string
  options?: string[]
}

interface ShopCategory {
  id: number
  name: string
  slug?: string
  parentId?: number | null
  attributes?: CategoryAttribute[]
}

/**
 * Fetches categories and validates that all required attributes for `categoryId`
 * are present in `suppliedAttributes`.
 * Returns null on success, or an error string listing what is missing.
 * Skips validation (returns null) if the category fetch itself fails.
 */
async function validateCategoryAttributes(
  categoryId: number,
  suppliedAttributes: Record<string, unknown>,
  opts: HttpOptions,
): Promise<string | null> {
  let categories: ShopCategory[]
  try {
    categories = await get<ShopCategory[]>('/api/v1/shop/categories', opts)
  } catch {
    // Category fetch failed — skip validation, let the server decide
    return null
  }

  if (!Array.isArray(categories)) return null

  const cat = categories.find((c) => c.id === categoryId)
  if (!cat || !cat.attributes) return null

  const missing = cat.attributes
    .filter((a) => a.required && !(a.name in suppliedAttributes))
    .map((a) => a.name)

  if (missing.length === 0) return null

  return (
    `Hiányzó kötelező kategória-attribútumok a "${cat.name}" kategóriához: ` +
    missing.join(', ') +
    '. Töltsd ki ezeket az attributes mezőbe, majd próbáld újra.'
  )
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerShopTools(server: McpServer, opts: HttpOptions): void {

  // ─── haszno_shop_list_categories ──────────────────────────────────────────

  server.registerTool(
    'haszno_shop_list_categories',
    {
      title: 'List shop categories',
      description:
        'Returns the full category taxonomy of the Haszno Hirdetési Piactér (marketplace). ' +
        'Each category may include "attributes" — the fields required (or optional) when posting an ad in that category. ' +
        'Call this before haszno_shop_create_ad to identify the correct categoryId and required attribute keys. ' +
        'The Haszno Shop is completely free — there are no listing or usage fees.',
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => {
      try {
        const result = await get('/api/v1/shop/categories', opts)
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
        'Filter by category with categoryId, full-text search with q, price range with minPrice/maxPrice.',
      inputSchema: {
        q: z.string().optional().describe('Full-text search query'),
        categoryId: z.number().int().min(1).optional().describe('Filter by category ID'),
        minPrice: z.number().int().min(0).optional().describe('Minimum price in HUF gross'),
        maxPrice: z.number().int().min(0).optional().describe('Maximum price in HUF gross'),
        page: z.number().int().min(1).optional().describe('Page number (default 1, page size 20)'),
        sort: z.enum(['newest', 'price_asc', 'price_desc']).optional().describe('Sort order'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args) => {
      try {
        const qs = new URLSearchParams()
        if (args.q) qs.set('q', args.q)
        if (args.categoryId != null) qs.set('categoryId', String(args.categoryId))
        if (args.minPrice != null) qs.set('minPrice', String(args.minPrice))
        if (args.maxPrice != null) qs.set('maxPrice', String(args.maxPrice))
        if (args.page != null) qs.set('page', String(args.page))
        if (args.sort) qs.set('sort', args.sort)
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
        'Returns all fields including images, attributes, seller info, and the "reserved" flag ' +
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
        'Returns a suggested asking price for an item based on the category and optional keyword. ' +
        'The hint is derived from recent sold and active listings in the same category. ' +
        'Use this before calling haszno_shop_create_ad to set a realistic priceGross.',
      inputSchema: {
        categoryId: z.number().int().min(1).optional().describe('Category ID for the hint'),
        q: z.string().optional().describe('Item description or keywords to refine the hint'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args) => {
      try {
        const qs = new URLSearchParams()
        if (args.categoryId != null) qs.set('categoryId', String(args.categoryId))
        if (args.q) qs.set('q', args.q)
        const suffix = qs.toString() ? `?${qs}` : ''
        const result = await get(`/api/v1/shop/ads/price-hint${suffix}`, opts)
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
        "Returns the authenticated user's own marketplace ads. " +
        'Filter by status: "aktiv" (live), "fuggeszetett" (paused), "eladva" (sold), "lejart" (expired). ' +
        'Each entry includes id, title, priceGross, status, images, reserved flag, and stats (views, inquiries). ' +
        'Requires authentication (Bearer token or session).',
      inputSchema: {
        status: z.enum(['aktiv', 'fuggeszetett', 'eladva', 'lejart']).optional().describe('Filter by ad status'),
        page: z.number().int().min(1).optional().describe('Page number (default 1)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args) => {
      try {
        const qs = new URLSearchParams()
        if (args.status) qs.set('status', args.status)
        if (args.page != null) qs.set('page', String(args.page))
        const suffix = qs.toString() ? `?${qs}` : ''
        const result = await get(`/api/v1/shop/my/ads${suffix}`, opts)
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
        'Requires authentication.',
      inputSchema: {
        adId: z.number().int().min(1).optional().describe('Filter by a specific ad ID'),
        page: z.number().int().min(1).optional().describe('Page number (default 1)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args) => {
      try {
        const qs = new URLSearchParams()
        if (args.adId != null) qs.set('adId', String(args.adId))
        if (args.page != null) qs.set('page', String(args.page))
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
        'Returns the ads the authenticated user has saved as favorites. ' +
        'Requires authentication.',
      inputSchema: {
        page: z.number().int().min(1).optional().describe('Page number (default 1)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args) => {
      try {
        const qs = new URLSearchParams()
        if (args.page != null) qs.set('page', String(args.page))
        const suffix = qs.toString() ? `?${qs}` : ''
        const result = await get(`/api/v1/shop/my/favorites${suffix}`, opts)
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
        '"lemondva" (cancelled by buyer), "teljesitve" (completed), "lejart" (hold expired). ' +
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
        'Returns an "url" field — pass this URL in the "images" array of haszno_shop_create_ad or haszno_shop_update_ad. ' +
        'Supported MIME types: image/jpeg, image/png, image/webp. ' +
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
      const MAX_SIZE_BYTES = 20 * 1024 * 1024 // 20 MB

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

      let blob: Blob
      let filename: string

      if (args.filePath) {
        // Extension whitelist — reject anything not in the allowed set early.
        const ext = args.filePath.split('.').pop()?.toLowerCase() ?? ''
        if (!ALLOWED_EXTS.has(ext)) {
          return mkErr(`Csak JPEG, PNG és WebP fájlok tölthetők fel (kapott kiterjesztés: .${ext || 'ismeretlen'}).`)
        }

        let buffer: Buffer
        try {
          buffer = fs.readFileSync(args.filePath)
        } catch (e) {
          return mkErr(`Nem sikerült beolvasni a fájlt: ${String(e)}`)
        }

        // Size cap.
        if (buffer.length > MAX_SIZE_BYTES) {
          return mkErr(`A fájl mérete (${(buffer.length / 1024 / 1024).toFixed(1)} MB) meghaladja a 20 MB-os határt.`)
        }

        // Magic-byte check — must match the declared extension.
        const detectedMime = detectMimeFromBytes(buffer)
        if (!detectedMime) {
          return mkErr('A fájl nem felismerhető képformátum (JPEG, PNG vagy WebP szükséges).')
        }
        const extMime: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
        if (detectedMime !== extMime[ext]) {
          return mkErr(`A fájl tartalma (${detectedMime}) nem egyezik a kiterjesztéssel (.${ext}).`)
        }

        blob = new Blob([buffer], { type: detectedMime })
        filename = args.filePath.split('/').pop() ?? 'image'
      } else {
        // base64 path (checked above: args.base64 is set, args.mimeType is set)
        const declaredMime = args.mimeType as string
        if (!ALLOWED_MIMES.has(declaredMime)) {
          return mkErr(`Nem támogatott MIME típus: ${declaredMime}. Csak image/jpeg, image/png és image/webp elfogadott.`)
        }

        let buffer: Buffer
        try {
          buffer = Buffer.from(args.base64 as string, 'base64')
        } catch (e) {
          return mkErr(`Érvénytelen base64 adat: ${String(e)}`)
        }

        // Size cap.
        if (buffer.length > MAX_SIZE_BYTES) {
          return mkErr(`A kép mérete (${(buffer.length / 1024 / 1024).toFixed(1)} MB) meghaladja a 20 MB-os határt.`)
        }

        // Magic-byte check — must match declared MIME type.
        const detectedMime = detectMimeFromBytes(buffer)
        if (!detectedMime) {
          return mkErr('A base64 adat nem felismerhető képformátum (JPEG, PNG vagy WebP szükséges).')
        }
        if (detectedMime !== declaredMime) {
          return mkErr(`A kép valódi formátuma (${detectedMime}) nem egyezik a megadott mimeType értékkel (${declaredMime}).`)
        }

        blob = new Blob([buffer], { type: declaredMime })
        const extMap: Record<string, string> = {
          'image/jpeg': 'jpg',
          'image/png': 'png',
          'image/webp': 'webp',
        }
        filename = `upload.${extMap[declaredMime] ?? 'bin'}`
      }

      const formData = new FormData()
      formData.append('image', blob, filename)

      try {
        const result = await uploadMultipart<{ url: string }>('/api/v1/shop/my/images', formData, opts)
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
        'Sends uploaded image URLs to the Haszno AI to generate a suggested ad title, description, ' +
        'category, price, and category-specific attributes. ' +
        'Upload images first with haszno_shop_upload_image to get the URLs, then pass them here. ' +
        'The result is a suggestion only — review it before passing it to haszno_shop_create_ad.',
      inputSchema: {
        imageUrls: z.array(z.string().url()).min(1).max(5).describe(
          'Image URLs from haszno_shop_upload_image (1–5 URLs)',
        ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      try {
        const result = await post('/api/v1/shop/my/ads/suggest', { imageUrls: args.imageUrls }, opts)
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
        '(1) call haszno_shop_list_categories to find the right categoryId and its required attributes; ' +
        '(2) call haszno_shop_upload_image for each photo and collect the returned URLs; ' +
        '(3) call haszno_shop_price_hint to suggest a priceGross. ' +
        'This tool validates required category attributes before sending — if any are missing it will tell you exactly what is needed.',
      inputSchema: {
        title: z.string().min(3).max(200).describe('Ad title (3–200 characters)'),
        description: z.string().max(5000).optional().describe('Ad description (optional, max 5000 chars)'),
        priceGross: z.number().int().min(1).describe('Asking price in HUF gross'),
        categoryId: z.number().int().min(1).describe('Category ID from haszno_shop_list_categories'),
        attributes: z.record(z.string(), z.unknown()).optional().describe(
          'Category-specific attributes (e.g. { "condition": "hasznalt", "brand": "Samsung" }). ' +
          'Required attributes depend on the category — call haszno_shop_list_categories to see them.',
        ),
        images: z.array(z.string().url()).max(10).optional().describe(
          'Image URLs from haszno_shop_upload_image (max 10)',
        ),
        phone: z.string().max(50).optional().describe('Contact phone number'),
        showPhone: z.boolean().optional().describe('Whether to display the phone number publicly (default false)'),
        confirm: z.literal(true).describe(
          'Must be exactly true. This posts a real, public ad — only set this after the user confirms.',
        ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      // Validate category attributes before sending
      const attrs = (args.attributes ?? {}) as Record<string, unknown>
      const validationError = await validateCategoryAttributes(args.categoryId, attrs, opts)
      if (validationError) {
        return mkErr(validationError)
      }

      const body = {
        title: args.title,
        description: args.description,
        priceGross: args.priceGross,
        categoryId: args.categoryId,
        attributes: args.attributes,
        images: args.images,
        phone: args.phone,
        showPhone: args.showPhone,
      }

      try {
        const result = await post('/api/v1/shop/my/ads', body, opts)
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
        'Updates the fields of an existing Haszno marketplace ad. ' +
        'Only pass the fields you want to change — omitted fields remain unchanged. ' +
        'The ad must belong to the authenticated user. ' +
        'The Haszno Shop is free.',
      inputSchema: {
        id: z.number().int().min(1).describe('Ad ID to update'),
        title: z.string().min(3).max(200).optional(),
        description: z.string().max(5000).optional(),
        priceGross: z.number().int().min(1).optional().describe('New asking price in HUF gross'),
        attributes: z.record(z.string(), z.unknown()).optional(),
        images: z.array(z.string().url()).max(10).optional(),
        phone: z.string().max(50).optional(),
        showPhone: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      const { id, ...body } = args
      try {
        const result = await patch(`/api/v1/shop/my/ads/${id}`, body, opts)
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
      title: 'Pause or activate an ad',
      description:
        'Changes an ad\'s visibility. ' +
        '"fuggeszetett" hides the ad from public search (paused); "aktiv" makes it visible again. ' +
        'The ad must belong to the authenticated user.',
      inputSchema: {
        id: z.number().int().min(1).describe('Ad ID'),
        status: z.enum(['aktiv', 'fuggeszetett']).describe('"aktiv" to show, "fuggeszetett" to hide'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/my/ads/${args.id}/status`, { status: args.status }, opts)
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
        soldPriceGross: z.number().int().min(1).optional().describe(
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
        const result = await post(`/api/v1/shop/my/ads/${args.id}/sold`, body, opts)
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
        'Renews an ad, resetting its expiry timer and bumping it back to the top of search results. ' +
        'Use this for ads that are about to expire or have fallen in ranking. ' +
        'The Haszno Shop is free — renewal has no cost.',
      inputSchema: {
        id: z.number().int().min(1).describe('Ad ID to renew'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/my/ads/${args.id}/renew`, {}, opts)
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
        'The Haszno Shop is free.',
      inputSchema: {
        adId: z.number().int().min(1).describe('Ad ID to send the inquiry to'),
        message: z.string().min(1).max(2000).describe('Your message or question for the seller'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      try {
        const result = await post(`/api/v1/shop/ads/${args.adId}/inquiries`, { message: args.message }, opts)
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
        'Set save=true to add to favorites, save=false to remove. ' +
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
          result = await post(`/api/v1/shop/ads/${args.adId}/favorites`, {}, opts)
        } else {
          result = await del(`/api/v1/shop/ads/${args.adId}/favorites`, opts)
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
        'You may optionally set a heldUntil deadline (ISO-8601) by which the buyer must complete the purchase. ' +
        'action="decline": marks the reservation as "elutasitva" (declined); ' +
        'the ad remains active for other buyers. ' +
        'The Haszno Shop is free — accepting a reservation does NOT create a payment.',
      inputSchema: {
        id: z.number().int().min(1).describe('Reservation ID'),
        action: z.enum(['accept', 'decline']).describe('"accept" or "decline"'),
        heldUntil: z.string().datetime().optional().nullable().describe(
          'Optional ISO-8601 deadline for the buyer to complete the deal (accept only)',
        ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      try {
        const path = `/api/v1/shop/my/reservations/${args.id}/${args.action}`
        const body: Record<string, unknown> = {}
        if (args.action === 'accept' && args.heldUntil !== undefined) {
          body['heldUntil'] = args.heldUntil
        }
        const result = await post(path, body, opts)
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
        'Cancels a reservation you placed as a buyer (status becomes "lemondva"). ' +
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
