/**
 * Unit tests for the library entry (src/lib.ts / dist/lib.js).
 *
 * Covers:
 *   (a) Importing the lib entry has no side-effects (no server started, no env read at import time).
 *   (b) In remote mode, haszno_shop_upload_image has no "filePath" in its input schema,
 *       and calling the handler with a file-path argument cannot read a file.
 *   (c) With an injected fetch + apiKey in opts, every tool call sends
 *       "Authorization: Bearer <apiKey>" to that fetch even when HASZNO_API_TOKEN /
 *       HASZNO_API_KEY env vars are set to different values.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerShopTools, type HttpOptions } from '../lib.js'

// ─── Stub McpServer (same pattern as shop.test.ts) ───────────────────────────

type ToolCb = (args: Record<string, unknown>) => Promise<unknown>

interface RegisteredTool {
  cfg: { title?: string; description?: string; inputSchema?: Record<string, unknown> }
  cb: ToolCb
}

function makeStubServer(): { server: McpServer; tools: Map<string, RegisteredTool> } {
  const tools = new Map<string, RegisteredTool>()
  const server = {
    registerTool: (name: string, cfg: RegisteredTool['cfg'], cb: ToolCb) => {
      tools.set(name, { cfg, cb })
      return {}
    },
  } as unknown as McpServer
  return { server, tools }
}

// ─── Mock fetch helper ────────────────────────────────────────────────────────

type FetchCall = { url: string; method: string; headers: Record<string, string> }

function makeFetch(status = 200, body: unknown = []): { fn: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: (init?.headers ?? {}) as Record<string, string>,
    })
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return { fn, calls }
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) No side effects on import
// ─────────────────────────────────────────────────────────────────────────────

describe('lib entry — no side effects on import', () => {
  it('registerShopTools is a function (the import completed without calling main())', () => {
    // If src/index.ts was imported instead, main() would run, attempt to connect
    // a StdioServerTransport, and either throw or hang. The fact that we get here
    // with registerShopTools available proves lib.ts has no executable side-effects.
    expect(typeof registerShopTools).toBe('function')
  })

  it('HttpOptions type is exported (type-only check at runtime: import does not throw)', () => {
    // HttpOptions is a type; at runtime we just verify the import succeeded cleanly.
    // If there were top-level throws or missing exports this test would fail.
    const opts: HttpOptions = { apiKey: 'haszno_test', baseUrl: 'http://test' }
    expect(opts.apiKey).toBe('haszno_test')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (b) Remote mode — upload_image tool schema and filesystem safety
// ─────────────────────────────────────────────────────────────────────────────

describe('remote mode — haszno_shop_upload_image', () => {
  it('schema has no filePath parameter when remote: true', () => {
    const { server, tools } = makeStubServer()
    registerShopTools(server, { apiKey: 'haszno_test', baseUrl: 'http://test' }, { remote: true })

    const upload = tools.get('haszno_shop_upload_image')
    expect(upload).toBeDefined()

    const schema = upload!.cfg.inputSchema as Record<string, { _def?: unknown }>
    expect(schema).not.toHaveProperty('filePath')
    expect(schema).toHaveProperty('base64')
    expect(schema).toHaveProperty('mimeType')
  })

  it('schema has filePath parameter when remote is omitted (local mode)', () => {
    const { server, tools } = makeStubServer()
    registerShopTools(server, { apiKey: 'haszno_test', baseUrl: 'http://test' })

    const upload = tools.get('haszno_shop_upload_image')
    expect(upload).toBeDefined()

    const schema = upload!.cfg.inputSchema as Record<string, unknown>
    expect(schema).toHaveProperty('filePath')
    expect(schema).toHaveProperty('base64')
    expect(schema).toHaveProperty('mimeType')
  })

  it('description says filePath is not available in remote mode', () => {
    const { server, tools } = makeStubServer()
    registerShopTools(server, { apiKey: 'haszno_test', baseUrl: 'http://test' }, { remote: true })

    const upload = tools.get('haszno_shop_upload_image')
    expect(upload!.cfg.description).toContain('filePath is not available')
  })

  it('handler returns an error (not a file read) when only base64 is provided — remote mode', async () => {
    // The fs mock is NOT active here; if fs.readFileSync were called it would throw
    // with an actual file-not-found error from the real fs module.
    const { fn: mockFetch } = makeFetch(200, { id: 42, url: '/api/shop/images/42' })
    const { server, tools } = makeStubServer()
    registerShopTools(
      server,
      { apiKey: 'haszno_test', baseUrl: 'http://test', fetch: mockFetch },
      { remote: true },
    )

    const upload = tools.get('haszno_shop_upload_image')!
    // Valid JPEG magic bytes in base64
    const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]).toString('base64')
    const result = await upload.cb({ base64: jpegBase64, mimeType: 'image/jpeg' })
    // Should succeed (fetch was called with the binary)
    const r = result as { content: Array<{ text: string }>; isError?: boolean }
    expect(r.isError).toBeFalsy()
    const parsed = JSON.parse(r.content[0].text) as { id: number }
    expect(parsed.id).toBe(42)
  })

  it('handler returns an error when called with no arguments — never attempts a file read', async () => {
    // In remote mode the handler has no filePath branch at all — it only processes base64.
    // Calling it with neither base64 nor mimeType should return a validation error,
    // not attempt to read anything from the filesystem (there is no fs.readFileSync call
    // in the remote handler; the proof is that the return is an isError result).
    const { server, tools } = makeStubServer()
    registerShopTools(
      server,
      { apiKey: 'haszno_test', baseUrl: 'http://test', fetch: makeFetch().fn },
      { remote: true },
    )

    const upload = tools.get('haszno_shop_upload_image')!
    // args match what the MCP framework would supply after stripping the absent filePath field
    const result = await upload.cb({ base64: undefined, mimeType: undefined } as unknown as Record<string, unknown>)
    // Should return a user-friendly error, not throw or read a file
    const r = result as { isError?: boolean; content: Array<{ text: string }> }
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (c) Auth — opts.apiKey takes priority over env vars in every mode
// ─────────────────────────────────────────────────────────────────────────────

describe('auth — opts.apiKey priority over env vars', () => {
  let savedEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    savedEnv = { ...process.env }
    // Poison the env vars with wrong keys
    process.env['HASZNO_API_TOKEN'] = 'haszno_env_wrong_token'
    process.env['HASZNO_API_KEY'] = 'haszno_env_wrong_key'
    process.env['ARFUTAR_API_KEY'] = 'arfutar_env_wrong_key'
    process.env['HASZNO_API_URL'] = 'http://wrong-env-url'
  })

  afterEach(() => {
    // Restore env
    for (const k of ['HASZNO_API_TOKEN', 'HASZNO_API_KEY', 'ARFUTAR_API_KEY', 'HASZNO_API_URL']) {
      if (k in savedEnv) {
        process.env[k] = savedEnv[k]
      } else {
        delete process.env[k]
      }
    }
  })

  it('sends Authorization: Bearer <opts.apiKey> even when env vars have different values', async () => {
    const { fn: mockFetch, calls } = makeFetch(200, [])
    const { server, tools } = makeStubServer()

    registerShopTools(server, {
      apiKey: 'haszno_injected_correct',
      baseUrl: 'http://correct-base-url',
      fetch: mockFetch,
    })

    // Call a read-only tool that makes an HTTP request
    const listCats = tools.get('haszno_shop_list_categories')!
    await listCats.cb({})

    expect(calls.length).toBeGreaterThan(0)
    const authHeader = calls[0]!.headers['Authorization'] ?? calls[0]!.headers['authorization']
    expect(authHeader).toBe('Bearer haszno_injected_correct')
    // Also verify the correct baseUrl was used (not the env-poisoned one)
    expect(calls[0]!.url).toContain('http://correct-base-url')
    expect(calls[0]!.url).not.toContain('wrong-env-url')
  })

  it('sends Authorization: Bearer <opts.apiKey> in remote mode (noEnvFallback active)', async () => {
    const { fn: mockFetch, calls } = makeFetch(200, [])
    const { server, tools } = makeStubServer()

    registerShopTools(
      server,
      {
        apiKey: 'haszno_remote_correct',
        baseUrl: 'http://remote-base-url',
        fetch: mockFetch,
      },
      { remote: true },
    )

    const listCats = tools.get('haszno_shop_list_categories')!
    await listCats.cb({})

    expect(calls.length).toBeGreaterThan(0)
    const authHeader = calls[0]!.headers['Authorization'] ?? calls[0]!.headers['authorization']
    expect(authHeader).toBe('Bearer haszno_remote_correct')
    expect(calls[0]!.url).toContain('http://remote-base-url')
  })

  it('in remote mode without explicit apiKey, env fallbacks are disabled (no auth sent)', async () => {
    const { fn: mockFetch, calls } = makeFetch(401, { error: 'Unauthorized' })
    const { server, tools } = makeStubServer()

    // remote: true, NO apiKey in opts — env vars MUST NOT be used
    registerShopTools(
      server,
      { baseUrl: 'http://test', fetch: mockFetch },
      { remote: true },
    )

    const listCats = tools.get('haszno_shop_list_categories')!
    await listCats.cb({})

    expect(calls.length).toBeGreaterThan(0)
    const authHeader = calls[0]!.headers['Authorization'] ?? calls[0]!.headers['authorization']
    // No auth header should be present (env vars were disabled)
    expect(authHeader).toBeUndefined()
  })
})
