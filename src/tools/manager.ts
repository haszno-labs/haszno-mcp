/**
 * MCP tools — Haszno Menedzser (napi piaci jelentés + agent-műveletek javaslata).
 *
 * Domain: manager
 * Endpoints used (all require a valid Bearer per-shop token via Authorization header):
 *   GET  /api/daily-reports               → haszno_daily_report (list; web-UI route, no Bearer needed)
 *   GET  /api/agent/daily-report          → haszno_daily_report (latest; Bearer-authenticated agent route)
 *   GET  /api/agent/daily-report/:day     → haszno_daily_report (by day; Bearer-authenticated agent route)
 *   GET  /api/agent/research-brief        → haszno_research_brief (Bearer-authenticated agent route)
 *   POST /api/agent/daily-report/:day/findings → haszno_post_findings (Bearer write scope required)
 *   GET  /api/agent/actions               → haszno_list_actions
 *   POST /api/agent/actions               → haszno_propose_action
 *
 * JÓVÁHAGYÁS A BOLT TULAJDONOSÁÉ: approve / undo / autopilot-write eszközök
 * szándékosan HIÁNYOZNAK — ezek a műveletek az emberi döntést igényelnek, és
 * a Haszno felületén végezhetők el.
 *
 * Antitrust: minden eszköz kizárólag ennek a boltnak az adatait és nyilvános
 * piaci árakat használ. Másik viszonteladó árát, szabályait vagy költségeit
 * semmilyen eszköz nem ad át és nem veszi alapul.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { HasznoClient } from '../client/index.js'

/** YYYY-MM-DD regex. */
const DAY_REGEX = /^\d{4}-\d{2}-\d{2}$/

/** Validate that a string is YYYY-MM-DD. */
function isValidDay(day: string): boolean {
  if (!DAY_REGEX.test(day)) return false
  const d = new Date(day)
  return !isNaN(d.getTime())
}

/** Validate that a URL is http(s). */
function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

// Zod schema for a single FindingInput item — mirrors the contract.
const FindingInputSchema = z.object({
  kind: z
    .enum(['ar_emelkedes', 'ar_csokkenes', 'trend', 'hir', 'keszlet', 'top_eladas', 'lehetoseg'])
    .describe(
      'Az elem fajtája: ar_emelkedes (ár emelkedés), ar_csokkenes (ár csökkenes), ' +
      'trend, hir (piaci hír), keszlet (készlethiány), top_eladas, lehetoseg',
    ),
  title: z
    .string()
    .min(5)
    .max(140)
    .describe('Rövid cím (5–140 karakter)'),
  body: z
    .string()
    .min(10)
    .max(1200)
    .describe('Részletes szöveg (10–1200 karakter); plain text, nem HTML'),
  changePct: z
    .number()
    .nullable()
    .optional()
    .describe('Százalékos változás (pl. 12.5 = +12,5 %; negatív = csökkenes)'),
  keyword: z
    .string()
    .nullable()
    .optional()
    .describe('Kapcsolódó termék/kulcsszó (opcionális)'),
  productId: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe('A bolt termékazonosítója, ha az elem egy konkrét termékre vonatkozik'),
  sourceName: z
    .string()
    .nullable()
    .optional()
    .describe('Forrás neve (pl. "Reuters", "PS Blog"; opcionális)'),
  sourceUrl: z
    .string()
    .nullable()
    .optional()
    .describe('Forrás URL — csak http(s) engedélyezett; opcionális'),
  suggestedAction: z
    .union([
      z.object({ type: z.literal('felvetel'), productId: z.number().int().positive() }),
      z.object({ type: z.literal('levetel'), productId: z.number().int().positive() }),
      z.object({
        type: z.literal('ar'),
        productId: z.number().int().positive(),
        priceGross: z.number().positive(),
      }),
      z.object({ type: z.literal('import'), networkProductId: z.number().int().positive() }),
    ])
    .nullable()
    .optional()
    .describe(
      'Javasolt egykattintásos művelet (opcionális). ' +
      'A jóváhagyás a bolt tulajdonosáé a Haszno felületén.',
    ),
})

export function registerManagerTools(server: McpServer, client: HasznoClient): void {
  // ---- haszno_daily_report -------------------------------------------------------
  server.registerTool(
    'haszno_daily_report',
    {
      title: 'Napi piaci jelentés lekérése',
      description:
        'Visszaadja a bolt napi piaci jelentését. ' +
        'Ha `day` nincs megadva (vagy "latest"), a legutóbbi elérhető nap jelentése jön. ' +
        'Ha a listát kéred (list: true), az utolsó 30 nap összefoglalóit adja vissza. ' +
        'A jelentés tartalmaz rendszerből generált elemeket (árváltozások, trendelők, ' +
        'készlethiányok, top eladások, lehetőségek) és agent által beküldött kutatási ' +
        'eredményeket. ' +
        'Visszatér: DailyReport (vagy DailyReportSummary[], ha list=true).\n\n' +
        'Mezők — DailyReport: { id, day, headline, summary, items[] }.\n' +
        'Mezők — ReportItem: { id, origin ("rendszer"|"agent"), kind, title, body, ' +
        'changePct, keyword, productId, productName, sourceName, sourceUrl, ' +
        'suggestedAction, action }.\n\n' +
        'Az „action" mező mutatja, ha az elemből már javaslat keletkezett.\n' +
        'A jóváhagyás és a visszavonás a bolt tulajdonosáé a Haszno felületén.',
      inputSchema: {
        day: z
          .string()
          .optional()
          .describe(
            'YYYY-MM-DD formátumú dátum, "latest", vagy üresen hagyva = legutóbbi. ' +
            'Ha list=true, ez a paraméter nem érvényes.',
          ),
        list: z
          .boolean()
          .optional()
          .describe(
            'true → az utolsó 30 nap rövid összefoglalóit adja vissza (DailyReportSummary[]); ' +
            'false/üresen = teljes napi jelentés.',
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      if (args.list) {
        const reports = await client.manager.listReports()
        return { content: [{ type: 'text' as const, text: JSON.stringify({ reports }) }] }
      }

      const day = args.day ?? 'latest'
      if (day !== 'latest' && !isValidDay(day)) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: `Érvénytelen dátum formátum: "${day}". Használj YYYY-MM-DD-t.` }),
          }],
        }
      }

      const report = await client.manager.getReport(day)
      if (report === null) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ report: null, message: 'Ehhez a naphoz még nem készült jelentés.' }),
          }],
        }
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify({ report }) }] }
    },
  )

  // ---- haszno_research_brief -----------------------------------------------------
  server.registerTool(
    'haszno_research_brief',
    {
      title: 'Kutatási brief lekérése',
      description:
        'Visszaadja a mai napra vonatkozó kutatási briefet, amit az AI ügynök felhasznál ' +
        'a napi piaci kutatáshoz. ' +
        'A brief tartalmazza: a bolt aktuális fókuszkeyword-jeit és termékeit árral és ' +
        'trend-jelzőkkel, Magyar nyelvű kutatási kérdéseket, és azt az URL-t, ahová a ' +
        'kutatási eredményeket be kell küldeni (postTo).\n\n' +
        'Workflow: (1) hívd meg ezt az eszközt a brief lekéréséhez, ' +
        '(2) végezz piaci kutatást a shopFocus és questions alapján, ' +
        '(3) küldd be az eredményeket a haszno_post_findings eszközzel a postTo URL napjára.\n\n' +
        'Visszatér: ResearchBrief { day, shopFocus[], questions[], postTo }.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const brief = await client.manager.getResearchBrief()
      return { content: [{ type: 'text' as const, text: JSON.stringify(brief) }] }
    },
  )

  // ---- haszno_post_findings -------------------------------------------------------
  server.registerTool(
    'haszno_post_findings',
    {
      title: 'Kutatási eredmények beküldése',
      description:
        'Az AI ügynök ezzel az eszközzel adja hozzá a napi piaci kutatás eredményeit ' +
        'a jelentéshez. Az elemek origin=\'agent\'-ként kerülnek a napi jelentésbe, ' +
        'és a bolt tulajdonosa látja őket.\n\n' +
        'A `day` csak a mai vagy a tegnapi nap (UTC) lehet.\n' +
        'Egyszerre legfeljebb 20 elem küldhető be; naponta összesen max. 60 agent-elem ' +
        'engedélyezett egy napon.\n\n' +
        'Mezők validálása:\n' +
        '- title: 5–140 karakter\n' +
        '- body: 10–1200 karakter (plain text, nem HTML)\n' +
        '- sourceUrl: csak http(s) engedélyezett\n' +
        '- suggestedAction: felvetel/levetel/ar/import — a jóváhagyás mindig a ' +
        'bolt tulajdonosáé a Haszno felületén\n\n' +
        'Visszatér: a frissített DailyReport.',
      inputSchema: {
        day: z
          .string()
          .describe('A nap YYYY-MM-DD formátumban. Csak mai vagy tegnapi nap (UTC) fogadható el.'),
        headline: z
          .string()
          .max(140)
          .optional()
          .describe('A nap rövid összefoglalója (opcionális, max. 140 karakter)'),
        summary: z
          .string()
          .max(800)
          .optional()
          .describe('Hosszabb összefoglaló szöveg (opcionális, max. 800 karakter)'),
        items: z
          .array(FindingInputSchema)
          .min(1)
          .max(20)
          .describe('A kutatási eredmények listája (1–20 elem)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      if (!isValidDay(args.day)) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: `Érvénytelen dátum formátum: "${args.day}". Használj YYYY-MM-DD-t.`,
            }),
          }],
        }
      }

      // Validate sourceUrl fields
      for (const item of args.items) {
        if (item.sourceUrl && !isHttpUrl(item.sourceUrl)) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                error: `Érvénytelen sourceUrl: "${item.sourceUrl}". Csak http(s) engedélyezett.`,
              }),
            }],
          }
        }
      }

      const body = {
        ...(args.headline != null ? { headline: args.headline } : {}),
        ...(args.summary != null ? { summary: args.summary } : {}),
        items: args.items,
      }

      const report = await client.manager.postFindings(args.day, body)
      return { content: [{ type: 'text' as const, text: JSON.stringify({ report }) }] }
    },
  )

  // ---- haszno_list_actions --------------------------------------------------------
  server.registerTool(
    'haszno_list_actions',
    {
      title: 'Agent-műveletek listázása',
      description:
        'Visszaadja a bolt agent-műveleteinek listáját (javasolt, végrehajtott, ' +
        'visszavont, hiba státuszban lévők). ' +
        'Szűrhető státusz szerint; alapértelmezett limit: 50, maximum: 200.\n\n' +
        'Visszatér: AgentAction[] (legújabbtól a legrégebbi felé).\n\n' +
        'Mezők — AgentAction: { id, action, reason, status, origin, autoApproved, ' +
        'reportItemId, target { name, sku, imageUrl }, ' +
        'preview { oldPriceGross, newPriceGross, floorGross, marginPct }, ' +
        'error, canUndo, createdAt, decidedAt, executedAt }.\n\n' +
        'Státuszok: javasolt | vegrehajtva | elutasitva | hiba | visszavonva.\n' +
        'A jóváhagyás és a visszavonás a bolt tulajdonosáé a Haszno felületén.',
      inputSchema: {
        status: z
          .enum(['javasolt', 'vegrehajtva', 'elutasitva', 'hiba', 'visszavonva'])
          .optional()
          .describe('Szűrés státusz szerint (opcionális; üresen = minden státusz)'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('Visszaadott elemek száma (alapértelmezett: 50, max: 200)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const actions = await client.manager.listActions({
        status: args.status,
        limit: args.limit,
      })
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ actions, count: actions.length }),
        }],
      }
    },
  )

  // ---- haszno_propose_action ------------------------------------------------------
  server.registerTool(
    'haszno_propose_action',
    {
      title: 'Agent-művelet javaslata',
      description:
        'Az AI ügynök ezzel az eszközzel javasol egy műveletet a bolt tulajdonosának. ' +
        'A javasolt művelet NEM hajtódik végre azonnal — a bolt tulajdonosá erősíti ' +
        'meg vagy utasítja el a Haszno felületén.\n\n' +
        'Kivétel: ha az autopilot be van kapcsolva és a művelet típusa engedélyezett ' +
        'az automatikus végrehajtáshoz, a szerver esetleg azonnal végrehajtja — ' +
        'ez a Haszno autopilot beállításaitól függ, nem az ügynök döntése.\n\n' +
        'Művelettípusok:\n' +
        '- felvetel: katalógustermék feltüntetése a boltban\n' +
        '- levetel: termék levétele a boltból\n' +
        '- ar: termék árának módosítása (az abszolút ár-padlót a szerver ellenőrzi; ' +
        '  ismeretlen bekerülési árú termék nem árazható újra agenttel)\n' +
        '- import: hálózati termék importlistára tétele\n\n' +
        'Visszatér: AgentAction (status: "javasolt" vagy esetleg "vegrehajtva" ha az ' +
        'autopilot azonnal futtatta).\n\n' +
        'FONTOS: a jóváhagyás a bolt tulajdonosáé a Haszno felületén. Az ügynök ' +
        'nem hagyhat jóvá saját maga által javasolt műveletet.',
      inputSchema: {
        type: z
          .enum(['felvetel', 'levetel', 'ar', 'import'])
          .describe('Művelettípus'),
        productId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'A bolt termékazonosítója (kötelező: felvetel, levetel, ar típusoknál)',
          ),
        networkProductId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Hálózati termékazonosító (kötelező: import típusnál)'),
        priceGross: z
          .number()
          .positive()
          .optional()
          .describe(
            'Javasolt bruttó ár forintban (kötelező: ar típusnál). ' +
            'A szerver ellenőrzi, hogy >= az abszolút ár-padlónak.',
          ),
        reason: z
          .string()
          .min(5)
          .max(500)
          .describe('Miért javasolja az ügynök ezt a műveletet? (5–500 karakter)'),
        reportItemId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Ha a javaslat egy napi jelentés eleméből ered, az elem azonosítója'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      // Build the ActionInput from args based on type.
      type ActionInput =
        | { type: 'felvetel'; productId: number }
        | { type: 'levetel'; productId: number }
        | { type: 'ar'; productId: number; priceGross: number }
        | { type: 'import'; networkProductId: number }

      let actionInput: ActionInput

      if (args.type === 'felvetel') {
        if (args.productId == null) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ error: 'felvetel típushoz productId kötelező.' }),
            }],
          }
        }
        actionInput = { type: 'felvetel', productId: args.productId }
      } else if (args.type === 'levetel') {
        if (args.productId == null) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ error: 'levetel típushoz productId kötelező.' }),
            }],
          }
        }
        actionInput = { type: 'levetel', productId: args.productId }
      } else if (args.type === 'ar') {
        if (args.productId == null || args.priceGross == null) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ error: 'ar típushoz productId és priceGross kötelező.' }),
            }],
          }
        }
        actionInput = { type: 'ar', productId: args.productId, priceGross: args.priceGross }
      } else {
        // import
        if (args.networkProductId == null) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ error: 'import típushoz networkProductId kötelező.' }),
            }],
          }
        }
        actionInput = { type: 'import', networkProductId: args.networkProductId }
      }

      const body = {
        ...actionInput,
        reason: args.reason,
        ...(args.reportItemId != null ? { reportItemId: args.reportItemId } : {}),
      }

      const action = await client.manager.proposeAction(body)
      return { content: [{ type: 'text' as const, text: JSON.stringify({ action }) }] }
    },
  )
}
