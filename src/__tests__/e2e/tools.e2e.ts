/**
 * End-to-end tool audit: calls every client method against a live API and
 * classifies the result.
 *
 * Run conditions:
 *   HASZNO_E2E_URL must be set (e.g. http://localhost:3000).
 *   Normal `pnpm test` skips this file entirely because HASZNO_E2E_URL is unset.
 *
 * Seeding:
 *   The test self-seeds by registering a fresh user and issuing a write-scope
 *   shop token (haszno_…) using that session. If HASZNO_E2E_API_TOKEN is set,
 *   registration is skipped and that token is used directly.
 *
 * Classification:
 *   OK             — HTTP 2xx
 *   SKIP-WRITE     — write tool, skipped to avoid side-effects
 *   NOT-SUPPORTED  — ShopTokenNotSupportedError / LegacyKeyNotSupportedError
 *   4xx-VALIDATION — HTTP 400/422 (endpoint exists, body/params wrong)
 *   404-OR-405     — endpoint not registered in the API
 *   5xx            — server error
 */

import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { createClient, HasznoApiError, ShopTokenNotSupportedError, LegacyKeyNotSupportedError } from '../../client/index.js'

const E2E_URL = process.env['HASZNO_E2E_URL']
const PRESET_TOKEN = process.env['HASZNO_E2E_API_TOKEN']

// ─── Skip guard ───────────────────────────────────────────────────────────────

if (!E2E_URL) {
  describe.skip('e2e tools audit (HASZNO_E2E_URL not set)', () => {
    it.skip('skipped', () => {})
  })
  // Vitest requires at least one describe block even when skip is applied
} else {

// ─── Seed helpers ─────────────────────────────────────────────────────────────

type SeedResult = { token: string }

async function seedUser(baseUrl: string): Promise<SeedResult> {
  const email = `e2e-test-${Date.now()}-${Math.random().toString(36).slice(2)}@e2e.haszno.local`
  const password = 'E2eTestPass1@haszno'

  // 1. Register — creates session cookie in the response
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'haszno-mcp-e2e/0.6.0' },
    body: JSON.stringify({
      email,
      password,
      name: 'E2E Test User',
      shopName: 'E2E Test Shop',
      sellerType: 'maganszemely',
      aszfAccepted: true,
      adatkezelesAccepted: true,
    }),
  })
  if (!regRes.ok) {
    const body = await regRes.text()
    throw new Error(`Register failed (${regRes.status}): ${body}`)
  }

  // Extract session cookie
  const rawCookies = regRes.headers.getSetCookie?.() ?? []
  const cookie = rawCookies
    .map((c) => c.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ')

  if (!cookie) throw new Error('Register succeeded but no session cookie returned')

  // 2. Create a write-scope shop token
  const tokenRes = await fetch(`${baseUrl}/api/auth/tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie,
      'User-Agent': 'haszno-mcp-e2e/0.6.0',
    },
    body: JSON.stringify({ name: 'e2e-audit', scope: 'write' }),
  })
  if (!tokenRes.ok) {
    const body = await tokenRes.text()
    throw new Error(`Token creation failed (${tokenRes.status}): ${body}`)
  }
  const { token } = (await tokenRes.json()) as { token: string }
  if (!token || !token.startsWith('haszno_')) {
    throw new Error(`Unexpected token format: ${token}`)
  }
  return { token }
}

// ─── Classifier ───────────────────────────────────────────────────────────────

type Classification = 'OK' | 'SKIP-WRITE' | 'NOT-SUPPORTED' | '4xx-VALIDATION' | '404-OR-405' | '5xx' | 'ERROR'

interface ToolResult {
  domain: string
  method: string
  classification: Classification
  status?: number
  note?: string
}

async function classify(
  domain: string,
  method: string,
  fn: () => Promise<unknown>,
  skipWrite = false,
): Promise<ToolResult> {
  if (skipWrite) {
    return { domain, method, classification: 'SKIP-WRITE' }
  }
  try {
    await fn()
    return { domain, method, classification: 'OK' }
  } catch (err) {
    if (err instanceof ShopTokenNotSupportedError || err instanceof LegacyKeyNotSupportedError) {
      return { domain, method, classification: 'NOT-SUPPORTED', note: err.name }
    }
    if (err instanceof HasznoApiError) {
      const s = err.status
      if (s === 404 || s === 405) return { domain, method, classification: '404-OR-405', status: s }
      if (s >= 400 && s < 500) return { domain, method, classification: '4xx-VALIDATION', status: s, note: err.message.slice(0, 120) }
      if (s >= 500) return { domain, method, classification: '5xx', status: s, note: err.message.slice(0, 120) }
    }
    return { domain, method, classification: 'ERROR', note: String(err).slice(0, 120) }
  }
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('e2e tools audit', { timeout: 60_000 }, () => {
  let client: ReturnType<typeof createClient>
  const results: ToolResult[] = []

  beforeAll(async () => {
    const token = PRESET_TOKEN ?? (await seedUser(E2E_URL!)).token
    client = createClient({ baseUrl: E2E_URL, apiKey: token })
  })

  afterAll(() => {
    // Print classification table
    const pad = (s: string, n: number) => s.padEnd(n)
    const col1 = Math.max(10, ...results.map((r) => r.domain.length)) + 2
    const col2 = Math.max(10, ...results.map((r) => r.method.length)) + 2
    const col3 = 18

    const header = `${pad('DOMAIN', col1)}${pad('METHOD', col2)}${pad('STATUS', col3)}NOTE`
    const divider = '-'.repeat(header.length)
    const rows = results.map((r) =>
      `${pad(r.domain, col1)}${pad(r.method, col2)}${pad(r.classification + (r.status ? ` (${r.status})` : ''), col3)}${r.note ?? ''}`,
    )
    console.log('\n=== haszno-mcp e2e classification table ===\n')
    console.log(header)
    console.log(divider)
    rows.forEach((r) => console.log(r))

    const counts = results.reduce<Record<string, number>>((acc, r) => {
      acc[r.classification] = (acc[r.classification] ?? 0) + 1
      return acc
    }, {})
    console.log(`\nSummary: ${JSON.stringify(counts)}`)
  })

  // ── health ─────────────────────────────────────────────────────────────────

  it('health.check', async () => {
    const r = await classify('health', 'check', () => client.health.check())
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  // ── auth ───────────────────────────────────────────────────────────────────

  it('auth.me', async () => {
    const r = await classify('auth', 'me', () => client.auth.me())
    results.push(r)
    expect(['OK', '4xx-VALIDATION']).toContain(r.classification)
  })

  // revokeCurrentToken is skipped — it would invalidate the test token
  it('auth.revokeCurrentToken', async () => {
    results.push({ domain: 'auth', method: 'revokeCurrentToken', classification: 'SKIP-WRITE', note: 'would invalidate test token' })
  })

  // ── settings ───────────────────────────────────────────────────────────────

  it('settings.get', async () => {
    const r = await classify('settings', 'get', () => client.settings.get())
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  it('settings.update', async () => {
    results.push({ domain: 'settings', method: 'update', classification: 'SKIP-WRITE' })
  })

  // ── products ──────────────────────────────────────────────────────────────

  it('products.list', async () => {
    const r = await classify('products', 'list', () => client.products.list())
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  it('products.update', async () => {
    results.push({ domain: 'products', method: 'update', classification: 'SKIP-WRITE' })
  })

  it('products.setListing', async () => {
    results.push({ domain: 'products', method: 'setListing', classification: 'SKIP-WRITE' })
  })

  it('products.generateAiDescription', async () => {
    // Uses real product ID 1 — expects 404 record-level or OK
    const r = await classify('products', 'generateAiDescription', () =>
      client.products.generateAiDescription(1),
    )
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  it('products.applyPrices', async () => {
    results.push({ domain: 'products', method: 'applyPrices', classification: 'SKIP-WRITE' })
  })

  // ── stats ─────────────────────────────────────────────────────────────────

  it('stats.get', async () => {
    const r = await classify('stats', 'get', () => client.stats.get())
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  it('stats.getImpact', async () => {
    const r = await classify('stats', 'getImpact', () => client.stats.getImpact())
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  // ── suppliers ─────────────────────────────────────────────────────────────

  it('suppliers.list', async () => {
    const r = await classify('suppliers', 'list', () => client.suppliers.list())
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  // ── feeds ─────────────────────────────────────────────────────────────────

  it('feeds.importFeed', async () => {
    results.push({ domain: 'feeds', method: 'importFeed', classification: 'SKIP-WRITE' })
  })

  it('feeds.importMarketPrices', async () => {
    results.push({ domain: 'feeds', method: 'importMarketPrices', classification: 'SKIP-WRITE' })
  })

  // ── orders ────────────────────────────────────────────────────────────────

  it('orders.list', async () => {
    const r = await classify('orders', 'list', () => client.orders.list())
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  it('orders.receiveOrder', async () => {
    results.push({ domain: 'orders', method: 'receiveOrder', classification: 'SKIP-WRITE' })
  })

  it('orders.ship', async () => {
    // Record-level: order 999999 won't exist → 404 (4xx-validation, endpoint exists)
    const r = await classify('orders', 'ship', () => client.orders.ship(999999))
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  it('orders.createDemo', async () => {
    results.push({ domain: 'orders', method: 'createDemo', classification: 'SKIP-WRITE' })
  })

  // ── recommendations ───────────────────────────────────────────────────────

  it('recommendations.get', async () => {
    const r = await classify('recommendations', 'get', () => client.recommendations.get())
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  it('recommendations.getAiShortlist', async () => {
    results.push({ domain: 'recommendations', method: 'getAiShortlist', classification: 'SKIP-WRITE' })
  })

  it('recommendations.fillTrendKeywords', async () => {
    results.push({ domain: 'recommendations', method: 'fillTrendKeywords', classification: 'SKIP-WRITE' })
  })

  // ── rules ────────────────────────────────────────────────────────────────

  it('rules.listTemplates', async () => {
    const r = await classify('rules', 'listTemplates', () => client.rules.listTemplates())
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  it('rules.list', async () => {
    const r = await classify('rules', 'list', () => client.rules.list())
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  it('rules.create', async () => {
    results.push({ domain: 'rules', method: 'create', classification: 'SKIP-WRITE' })
  })

  it('rules.update', async () => {
    results.push({ domain: 'rules', method: 'update', classification: 'SKIP-WRITE' })
  })

  it('rules.delete', async () => {
    results.push({ domain: 'rules', method: 'delete', classification: 'SKIP-WRITE' })
  })

  it('rules.run', async () => {
    results.push({ domain: 'rules', method: 'run', classification: 'SKIP-WRITE' })
  })

  it('rules.runAll', async () => {
    results.push({ domain: 'rules', method: 'runAll', classification: 'SKIP-WRITE' })
  })

  it('rules.trigger', async () => {
    results.push({ domain: 'rules', method: 'trigger', classification: 'SKIP-WRITE' })
  })

  it('rules.listRuns', async () => {
    const r = await classify('rules', 'listRuns', () => client.rules.listRuns())
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  it('rules.undoUnlists', async () => {
    results.push({ domain: 'rules', method: 'undoUnlists', classification: 'SKIP-WRITE' })
  })

  // ── proposals ────────────────────────────────────────────────────────────

  it('proposals.list', async () => {
    const r = await classify('proposals', 'list', () => client.proposals.list())
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  it('proposals.approve', async () => {
    results.push({ domain: 'proposals', method: 'approve', classification: 'SKIP-WRITE' })
  })

  it('proposals.reject', async () => {
    results.push({ domain: 'proposals', method: 'reject', classification: 'SKIP-WRITE' })
  })

  it('proposals.rollback', async () => {
    results.push({ domain: 'proposals', method: 'rollback', classification: 'SKIP-WRITE' })
  })

  it('proposals.propose', async () => {
    // Submits a proposal via POST /api/agent/proposals — write, but useful to verify the endpoint exists.
    // The endpoint returns 404 when productId does not belong to the shop (security-by-design: same 404
    // for "not yours" and "not found" to prevent product-id probing across shops). In a fresh e2e shop
    // there are no products, so 404-OR-405 is expected and must be accepted here.
    const r = await classify('proposals', 'propose', () =>
      client.proposals.propose({
        productId: 1,
        proposedPriceGross: 1000,
        reason: 'e2e test',
        nonce: `e2e-${Date.now()}`,
      }),
    )
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION', '404-OR-405']).toContain(r.classification)
  })

  // ── automation ───────────────────────────────────────────────────────────

  it('automation.get', async () => {
    const r = await classify('automation', 'get', () => client.automation.get())
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  it('automation.set', async () => {
    results.push({ domain: 'automation', method: 'set', classification: 'SKIP-WRITE' })
  })

  // ── network ──────────────────────────────────────────────────────────────

  it('network.listSuppliers', async () => {
    const r = await classify('network', 'listSuppliers', () => client.network.listSuppliers())
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  it('network.getSupplierProducts', async () => {
    // Supplier 1 may not exist in e2e DB → 404 record-level → 4xx-validation
    const r = await classify('network', 'getSupplierProducts', () =>
      client.network.getSupplierProducts(1),
    )
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  it('network.connect', async () => {
    results.push({ domain: 'network', method: 'connect', classification: 'SKIP-WRITE' })
  })

  it('network.disconnect', async () => {
    results.push({ domain: 'network', method: 'disconnect', classification: 'SKIP-WRITE' })
  })

  it('network.sync', async () => {
    results.push({ domain: 'network', method: 'sync', classification: 'SKIP-WRITE' })
  })

  it('network.getSupplierView', async () => {
    // Supplier 1 may not exist → 404 record-level → 4xx-validation
    const r = await classify('network', 'getSupplierView', () =>
      client.network.getSupplierView(1),
    )
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  // ── catalogue ────────────────────────────────────────────────────────────

  it('catalogue.search', async () => {
    const r = await classify('catalogue', 'search', () => client.catalogue.search({ q: 'test' }))
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  // ── importList ───────────────────────────────────────────────────────────

  it('importList.list', async () => {
    const r = await classify('importList', 'list', () => client.importList.list())
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  it('importList.add', async () => {
    results.push({ domain: 'importList', method: 'add', classification: 'SKIP-WRITE' })
  })

  it('importList.push', async () => {
    results.push({ domain: 'importList', method: 'push', classification: 'SKIP-WRITE' })
  })

  // ── connections ──────────────────────────────────────────────────────────

  it('connections.list', async () => {
    const r = await classify('connections', 'list', () => client.connections.list())
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  it('connections.get', async () => {
    // Connection 1 may not exist → record-level 404 → 4xx-validation
    const r = await classify('connections', 'get', () => client.connections.get(1))
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  // ── peers ────────────────────────────────────────────────────────────────

  it('peers.createInvite', async () => {
    results.push({ domain: 'peers', method: 'createInvite', classification: 'SKIP-WRITE' })
  })

  it('peers.listInvites', async () => {
    const r = await classify('peers', 'listInvites', () => client.peers.listInvites())
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  it('peers.revokeInvite', async () => {
    results.push({ domain: 'peers', method: 'revokeInvite', classification: 'SKIP-WRITE' })
  })

  it('peers.acceptInvite', async () => {
    results.push({ domain: 'peers', method: 'acceptInvite', classification: 'SKIP-WRITE' })
  })

  it('peers.listLinks', async () => {
    const r = await classify('peers', 'listLinks', () => client.peers.listLinks())
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  it('peers.removeLink', async () => {
    results.push({ domain: 'peers', method: 'removeLink', classification: 'SKIP-WRITE' })
  })

  it('peers.setVisibility', async () => {
    results.push({ domain: 'peers', method: 'setVisibility', classification: 'SKIP-WRITE' })
  })

  // ── blog ─────────────────────────────────────────────────────────────────

  it('blog.list', async () => {
    const r = await classify('blog', 'list', () => client.blog.list())
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  it('blog.get', async () => {
    // Slug doesn't need to exist — just tests routing
    const r = await classify('blog', 'get', () => client.blog.get('e2e-test-nonexistent-post'))
    results.push(r)
    // 404 from blog.get means record-level not found → 4xx-validation (endpoint exists)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  // ── manager ──────────────────────────────────────────────────────────────

  it('manager.listReports', async () => {
    const r = await classify('manager', 'listReports', () => client.manager.listReports())
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  it('manager.getReport (latest)', async () => {
    const r = await classify('manager', 'getReport(latest)', () =>
      client.manager.getReport('latest'),
    )
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  it('manager.getResearchBrief', async () => {
    const r = await classify('manager', 'getResearchBrief', () =>
      client.manager.getResearchBrief(),
    )
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  it('manager.postFindings', async () => {
    results.push({ domain: 'manager', method: 'postFindings', classification: 'SKIP-WRITE' })
  })

  it('manager.listActions', async () => {
    const r = await classify('manager', 'listActions', () => client.manager.listActions())
    results.push(r)
    expect(['OK', 'NOT-SUPPORTED', '4xx-VALIDATION']).toContain(r.classification)
  })

  it('manager.proposeAction', async () => {
    results.push({ domain: 'manager', method: 'proposeAction', classification: 'SKIP-WRITE' })
  })

  it('manager.rejectAction', async () => {
    results.push({ domain: 'manager', method: 'rejectAction', classification: 'SKIP-WRITE' })
  })

  // ── modules ──────────────────────────────────────────────────────────────

  it('modules.listPrices', async () => {
    const r = await classify('modules', 'listPrices', () => client.modules.listPrices())
    results.push(r)
    expect(['OK', '4xx-VALIDATION']).toContain(r.classification)
  })

  it('modules.listMy', async () => {
    const r = await classify('modules', 'listMy', () => client.modules.listMy())
    results.push(r)
    expect(['OK', '4xx-VALIDATION', 'NOT-SUPPORTED']).toContain(r.classification)
  })

  it('modules.activate', async () => {
    // Activation triggers payment flow — SKIP-WRITE to avoid creating payment records
    results.push({ domain: 'modules', method: 'activate', classification: 'SKIP-WRITE', note: 'triggers payment' })
  })

  it('modules.cancel', async () => {
    results.push({ domain: 'modules', method: 'cancel', classification: 'SKIP-WRITE' })
  })

  it('modules.resume', async () => {
    results.push({ domain: 'modules', method: 'resume', classification: 'SKIP-WRITE' })
  })

  // ── final assertion ──────────────────────────────────────────────────────

  it('no 404-OR-405 results', () => {
    // proposals.propose returns 404 in a fresh shop (product 1 does not belong to the new shop —
    // the API deliberately returns the same 404 for "not yours" and "not found" to prevent
    // cross-shop probing). Exclude it from the routing-audit assertion.
    const knownResourceNotFound = new Set(['proposals.propose'])
    const broken = results.filter(
      (r) =>
        r.classification === '404-OR-405' &&
        !knownResourceNotFound.has(`${r.domain}.${r.method}`),
    )
    if (broken.length > 0) {
      const list = broken.map((r) => `  ${r.domain}.${r.method} (${r.status})`).join('\n')
      throw new Error(`${broken.length} endpoint(s) returned 404/405:\n${list}`)
    }
    expect(broken).toHaveLength(0)
  })
})

} // end else block for E2E_URL guard
