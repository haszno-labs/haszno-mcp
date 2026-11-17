/**
 * Unit tests for src/client/tool-context.ts and the X-Haszno-Tool header
 * injected by src/client/http.ts.
 *
 * Tests verify:
 *  1. patchForToolContext wraps handlers in the AsyncLocalStorage context.
 *  2. currentToolName() returns the tool name inside a tool call.
 *  3. currentToolName() returns undefined outside a tool call.
 *  4. Names that violate the header pattern are rejected by currentToolName().
 *  5. patchForToolContext is idempotent (double-patching does not double-wrap).
 *  6. http.ts adds X-Haszno-Tool when a tool name is in context.
 *  7. http.ts omits X-Haszno-Tool when no tool name is in context.
 *
 * No live network calls are made.
 */
import { describe, it, expect } from 'vitest'
import {
  toolNameStorage,
  currentToolName,
  patchForToolContext,
} from '../client/tool-context.js'
import { request } from '../client/http.js'

// ── 1–5: tool-context module ──────────────────────────────────────────────────

describe('currentToolName', () => {
  it('returns undefined outside a tool call', () => {
    expect(currentToolName()).toBeUndefined()
  })

  it('returns the tool name inside toolNameStorage.run()', async () => {
    let captured: string | undefined
    await toolNameStorage.run('haszno_products_list', async () => {
      captured = currentToolName()
    })
    expect(captured).toBe('haszno_products_list')
    // Back outside the context it is gone.
    expect(currentToolName()).toBeUndefined()
  })

  it('rejects names that exceed 80 characters', async () => {
    const longName = 'x'.repeat(81)
    let captured: string | undefined
    await toolNameStorage.run(longName, async () => {
      captured = currentToolName()
    })
    expect(captured).toBeUndefined()
  })

  it('rejects names with disallowed characters', async () => {
    let captured: string | undefined
    await toolNameStorage.run('bad!name', async () => {
      captured = currentToolName()
    })
    expect(captured).toBeUndefined()
  })

  it('allows names with the full permitted character set', async () => {
    const name = 'cli webshop theme:set - v1.0'
    let captured: string | undefined
    await toolNameStorage.run(name, async () => {
      captured = currentToolName()
    })
    expect(captured).toBe(name)
  })
})

describe('patchForToolContext', () => {
  it('wraps handlers so the tool name is available in context', async () => {
    const captured = new Map<string, string | undefined>()
    type Cb = (args: Record<string, unknown>) => Promise<unknown>
    const tools = new Map<string, Cb>()
    const server = {
      registerTool(_name: string, _schema: unknown, cb: Cb) {
        tools.set(_name, cb)
      },
    }

    patchForToolContext(server)
    server.registerTool('haszno_foo_bar', {}, async () => {
      captured.set('haszno_foo_bar', currentToolName())
    })

    await tools.get('haszno_foo_bar')!({})
    expect(captured.get('haszno_foo_bar')).toBe('haszno_foo_bar')
    // Outside the handler the context is gone.
    expect(currentToolName()).toBeUndefined()
  })

  it('also wraps handlers registered through server.tool()', async () => {
    type Cb = (args: Record<string, unknown>) => Promise<unknown>
    const tools = new Map<string, Cb>()
    const server = {
      registerTool(_name: string, _schema: unknown, _cb: Cb) {},
      tool(...args: unknown[]) {
        tools.set(args[0] as string, args[args.length - 1] as Cb)
      },
    }
    patchForToolContext(server)
    let seen: string | undefined
    server.tool('haszno_legacy_tool', 'description', {}, async () => {
      seen = currentToolName()
    })
    await tools.get('haszno_legacy_tool')!({})
    expect(seen).toBe('haszno_legacy_tool')
  })

  it('is idempotent — double-patching does not double-wrap', async () => {
    let callCount = 0
    type Cb = (args: Record<string, unknown>) => Promise<unknown>
    const tools = new Map<string, Cb>()
    const server = {
      registerTool(_name: string, _schema: unknown, cb: Cb) {
        tools.set(_name, cb)
      },
    }

    patchForToolContext(server)
    patchForToolContext(server) // second call must be a no-op
    server.registerTool('haszno_double', {}, async () => {
      callCount++
    })

    await tools.get('haszno_double')!({})
    expect(callCount).toBe(1)
  })
})

// ── 6–7: X-Haszno-Tool header in http.ts ─────────────────────────────────────

describe('http.ts X-Haszno-Tool header', () => {
  it('adds X-Haszno-Tool when a tool name is in context', async () => {
    const capturedHeaders: Record<string, string> = {}
    const mockFetch = async (
      _url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
        capturedHeaders[k] = v
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }

    await toolNameStorage.run('haszno_products_list', () =>
      request('GET', '/api/ping', undefined, {
        baseUrl: 'https://test.haszno.hu',
        apiKey: 'haszno_test123',
        fetch: mockFetch as typeof fetch,
        maxRetries: 1,
        noEnvFallback: true,
      }),
    )

    expect(capturedHeaders['X-Haszno-Tool']).toBe('haszno_products_list')
  })

  it('omits X-Haszno-Tool when no tool name is in context', async () => {
    const capturedHeaders: Record<string, string> = {}
    const mockFetch = async (
      _url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
        capturedHeaders[k] = v
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }

    // Run outside any toolNameStorage context.
    await request('GET', '/api/ping', undefined, {
      baseUrl: 'https://test.haszno.hu',
      apiKey: 'haszno_test123',
      fetch: mockFetch as typeof fetch,
      maxRetries: 1,
      noEnvFallback: true,
    })

    expect(capturedHeaders['X-Haszno-Tool']).toBeUndefined()
  })
})
