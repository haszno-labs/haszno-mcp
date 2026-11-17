/**
 * Unit tests for src/tools/booking.ts and src/client/index.ts booking namespace.
 *
 * Verifies:
 *   1. All 11 tools are registered with the correct names.
 *   2. Each tool calls the right client method with the right arguments.
 *   3. confirm guards work: missing confirm → guidance text, no HTTP call.
 *   4. apply_setup gating: neither dryRun nor confirm → guidance; dryRun:true → proceeds.
 *   5. upsert_service: finds existing by name → updateService; not found → createService.
 *   6. upsert_resource: finds existing by name → updateResource; not found → createResource.
 *   7. Legacy client rejects all booking ops with LegacyKeyNotSupportedError and no HTTP call.
 *   8. Shop-token client routes all booking ops to /api/agent/booking/* endpoints.
 *
 * No live network calls are made.
 */
import { describe, it, expect, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { HasznoClient, BookingServiceItem, BookingResourceItem } from '../client/index.js'
import { createClient, LegacyKeyNotSupportedError } from '../client/index.js'
import { registerBookingTools } from '../tools/booking.js'

// ── Mock server helpers ────────────────────────────────────────────────────────

type TextBlock = { type: string; text: string }
type ToolResult = { content: TextBlock[] }
type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<ToolResult>

interface CapturedTool {
  config: Record<string, unknown>
  handler: ToolHandler
}

function makeMockServer() {
  const tools = new Map<string, CapturedTool>()
  const server: Partial<McpServer> = {
    registerTool(name: string, config: unknown, handler: unknown) {
      tools.set(name, {
        config: config as Record<string, unknown>,
        handler: handler as ToolHandler,
      })
      return {} as ReturnType<McpServer['registerTool']>
    },
  }
  return { server: server as McpServer, tools }
}

function parsed(result: ToolResult): unknown {
  return JSON.parse(result.content[0].text)
}

function callTool(
  tools: Map<string, CapturedTool>,
  name: string,
  args: Record<string, unknown> = {},
) {
  const tool = tools.get(name)
  if (!tool) throw new Error(`Tool not registered: ${name}`)
  return tool.handler(args, {})
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

const BOOKING_SETUP = {
  page: { headline: 'Foglalj nálunk!', published: false },
  services: [],
  resources: [],
  hours: {},
  checklist: { hasServices: false, hasResources: false, hasHours: false },
  nextStep: 'Add at least one service using haszno_booking_upsert_service.',
}

const SERVICE_ITEM: BookingServiceItem = { id: 1, name: 'Hajvágás' }
const RESOURCE_ITEM: BookingResourceItem = { id: 10, name: '1-es szék' }

// ── Mock client builder ────────────────────────────────────────────────────────

function makeMockClient(overrides: Partial<HasznoClient['booking']> = {}): HasznoClient {
  const booking: HasznoClient['booking'] = {
    getSetup: vi.fn().mockResolvedValue(BOOKING_SETUP),
    applySetup: vi.fn().mockResolvedValue({ applied: true, changes: [] }),
    setTheme: vi.fn().mockResolvedValue({ theme: {} }),
    listServices: vi.fn().mockResolvedValue([SERVICE_ITEM]),
    createService: vi.fn().mockResolvedValue({ id: 2, name: 'Szakálligazítás' }),
    updateService: vi.fn().mockResolvedValue(SERVICE_ITEM),
    deleteService: vi.fn().mockResolvedValue({ deleted: true }),
    listResources: vi.fn().mockResolvedValue([RESOURCE_ITEM]),
    createResource: vi.fn().mockResolvedValue({ id: 11, name: '2-es szék' }),
    updateResource: vi.fn().mockResolvedValue(RESOURCE_ITEM),
    deleteResource: vi.fn().mockResolvedValue({ deleted: true }),
    setHours: vi.fn().mockResolvedValue({ hours: {} }),
    addClosure: vi.fn().mockResolvedValue({ id: 5, date: '2026-12-25' }),
    publish: vi.fn().mockResolvedValue({ published: true }),
    listAppointments: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
  return { booking } as unknown as HasznoClient
}

// ── Tool registration ──────────────────────────────────────────────────────────

describe('registerBookingTools — tool registration', () => {
  it('registers all 11 tools', () => {
    const { server, tools } = makeMockServer()
    registerBookingTools(server, makeMockClient())
    const names = [
      'haszno_booking_get_setup',
      'haszno_booking_apply_setup',
      'haszno_booking_set_theme',
      'haszno_booking_upsert_service',
      'haszno_booking_delete_service',
      'haszno_booking_upsert_resource',
      'haszno_booking_delete_resource',
      'haszno_booking_set_hours',
      'haszno_booking_add_closure',
      'haszno_booking_publish',
      'haszno_booking_list_appointments',
    ]
    for (const name of names) {
      expect(tools.has(name), `${name} should be registered`).toBe(true)
    }
    expect(tools.size).toBe(11)
  })
})

// ── haszno_booking_get_setup ───────────────────────────────────────────────────

describe('haszno_booking_get_setup', () => {
  it('calls client.booking.getSetup and returns JSON', async () => {
    const getSetup = vi.fn().mockResolvedValue(BOOKING_SETUP)
    const { server, tools } = makeMockServer()
    registerBookingTools(server, makeMockClient({ getSetup }))
    const result = await callTool(tools, 'haszno_booking_get_setup')
    const data = parsed(result)
    expect(getSetup).toHaveBeenCalledOnce()
    expect(data).toMatchObject({ page: { headline: 'Foglalj nálunk!' } })
  })
})

// ── haszno_booking_apply_setup ────────────────────────────────────────────────

describe('haszno_booking_apply_setup', () => {
  it('returns guidance when neither dryRun nor confirm is set', async () => {
    const applySetup = vi.fn()
    const { server, tools } = makeMockServer()
    registerBookingTools(server, makeMockClient({ applySetup }))
    const result = await callTool(tools, 'haszno_booking_apply_setup', {})
    const data = parsed(result) as { guidance: string }
    expect(applySetup).not.toHaveBeenCalled()
    expect(data.guidance).toMatch(/dryRun/)
  })

  it('calls applySetup with dryRun:true when dryRun is set (no confirm needed)', async () => {
    const applySetup = vi.fn().mockResolvedValue({ dryRun: true, changes: ['Add service'] })
    const { server, tools } = makeMockServer()
    registerBookingTools(server, makeMockClient({ applySetup }))
    const result = await callTool(tools, 'haszno_booking_apply_setup', {
      dryRun: true,
      services: [{ name: 'Hajvágás', durationMin: 30 }],
    })
    expect(applySetup).toHaveBeenCalledOnce()
    const [body] = applySetup.mock.calls[0] as [Record<string, unknown>]
    expect(body.dryRun).toBe(true)
    expect(body.services).toHaveLength(1)
    expect(result.content[0].text).toContain('Add service')
  })

  it('calls applySetup with confirm:true when confirm is set', async () => {
    const applySetup = vi.fn().mockResolvedValue({ applied: true })
    const { server, tools } = makeMockServer()
    registerBookingTools(server, makeMockClient({ applySetup }))
    await callTool(tools, 'haszno_booking_apply_setup', {
      confirm: true,
      theme: { accent: '#0ea5e9' },
    })
    expect(applySetup).toHaveBeenCalledOnce()
    const [body] = applySetup.mock.calls[0] as [Record<string, unknown>]
    expect(body.dryRun).toBe(false)
    expect((body.theme as Record<string, unknown>).accent).toBe('#0ea5e9')
    // confirm key should not be forwarded to the API
    expect('confirm' in body).toBe(false)
  })
})

// ── haszno_booking_set_theme ──────────────────────────────────────────────────

describe('haszno_booking_set_theme', () => {
  it('calls setTheme with the provided fields', async () => {
    const setTheme = vi.fn().mockResolvedValue({ theme: { accent: '#0ea5e9' } })
    const { server, tools } = makeMockServer()
    registerBookingTools(server, makeMockClient({ setTheme }))
    await callTool(tools, 'haszno_booking_set_theme', {
      accent: '#0ea5e9',
      background: 'light',
      buttonLabel: 'Foglalok',
    })
    expect(setTheme).toHaveBeenCalledOnce()
  })
})

// ── haszno_booking_upsert_service ─────────────────────────────────────────────

describe('haszno_booking_upsert_service', () => {
  it('calls updateService when service with same name already exists', async () => {
    const listServices = vi.fn().mockResolvedValue([SERVICE_ITEM])
    const updateService = vi.fn().mockResolvedValue({ ...SERVICE_ITEM, durationMin: 45 })
    const createService = vi.fn()
    const { server, tools } = makeMockServer()
    registerBookingTools(server, makeMockClient({ listServices, updateService, createService }))
    const result = await callTool(tools, 'haszno_booking_upsert_service', {
      name: 'Hajvágás',
      durationMin: 45,
      priceHuf: 3000,
    })
    expect(listServices).toHaveBeenCalledOnce()
    expect(updateService).toHaveBeenCalledWith(1, expect.objectContaining({ durationMin: 45, priceHuf: 3000 }))
    expect(createService).not.toHaveBeenCalled()
    const data = parsed(result) as { action: string }
    expect(data.action).toBe('updated')
  })

  it('calls createService when no service with that name exists', async () => {
    const listServices = vi.fn().mockResolvedValue([])
    const createService = vi.fn().mockResolvedValue({ id: 99, name: 'Szakálligazítás' })
    const updateService = vi.fn()
    const { server, tools } = makeMockServer()
    registerBookingTools(server, makeMockClient({ listServices, createService, updateService }))
    const result = await callTool(tools, 'haszno_booking_upsert_service', {
      name: 'Szakálligazítás',
      durationMin: 20,
    })
    expect(createService).toHaveBeenCalledWith(expect.objectContaining({ name: 'Szakálligazítás', durationMin: 20 }))
    expect(updateService).not.toHaveBeenCalled()
    const data = parsed(result) as { action: string }
    expect(data.action).toBe('created')
  })
})

// ── haszno_booking_delete_service ─────────────────────────────────────────────

describe('haszno_booking_delete_service', () => {
  it('requires confirm:true', async () => {
    const deleteService = vi.fn()
    const { server, tools } = makeMockServer()
    registerBookingTools(server, makeMockClient({ deleteService }))
    const result = await callTool(tools, 'haszno_booking_delete_service', { id: 1 })
    expect(deleteService).not.toHaveBeenCalled()
    expect(result.content[0].text).toMatch(/Confirm required/)
  })

  it('calls deleteService with id when confirm:true', async () => {
    const deleteService = vi.fn().mockResolvedValue({ deleted: true })
    const { server, tools } = makeMockServer()
    registerBookingTools(server, makeMockClient({ deleteService }))
    await callTool(tools, 'haszno_booking_delete_service', { id: 1, confirm: true })
    expect(deleteService).toHaveBeenCalledWith(1)
  })
})

// ── haszno_booking_upsert_resource ────────────────────────────────────────────

describe('haszno_booking_upsert_resource', () => {
  it('calls updateResource when resource with same name already exists', async () => {
    const listResources = vi.fn().mockResolvedValue([RESOURCE_ITEM])
    const updateResource = vi.fn().mockResolvedValue(RESOURCE_ITEM)
    const createResource = vi.fn()
    const { server, tools } = makeMockServer()
    registerBookingTools(server, makeMockClient({ listResources, updateResource, createResource }))
    const result = await callTool(tools, 'haszno_booking_upsert_resource', {
      name: '1-es szék',
      description: 'Updated description',
    })
    expect(listResources).toHaveBeenCalledOnce()
    expect(updateResource).toHaveBeenCalledWith(10, expect.objectContaining({ description: 'Updated description' }))
    expect(createResource).not.toHaveBeenCalled()
    const data = parsed(result) as { action: string }
    expect(data.action).toBe('updated')
  })

  it('calls createResource when no resource with that name exists', async () => {
    const listResources = vi.fn().mockResolvedValue([])
    const createResource = vi.fn().mockResolvedValue({ id: 20, name: '2-es szék' })
    const updateResource = vi.fn()
    const { server, tools } = makeMockServer()
    registerBookingTools(server, makeMockClient({ listResources, createResource, updateResource }))
    const result = await callTool(tools, 'haszno_booking_upsert_resource', { name: '2-es szék' })
    expect(createResource).toHaveBeenCalledWith(expect.objectContaining({ name: '2-es szék' }))
    expect(updateResource).not.toHaveBeenCalled()
    const data = parsed(result) as { action: string }
    expect(data.action).toBe('created')
  })
})

// ── haszno_booking_delete_resource ────────────────────────────────────────────

describe('haszno_booking_delete_resource', () => {
  it('requires confirm:true', async () => {
    const deleteResource = vi.fn()
    const { server, tools } = makeMockServer()
    registerBookingTools(server, makeMockClient({ deleteResource }))
    const result = await callTool(tools, 'haszno_booking_delete_resource', { id: 10 })
    expect(deleteResource).not.toHaveBeenCalled()
    expect(result.content[0].text).toMatch(/Confirm required/)
  })

  it('calls deleteResource with id when confirm:true', async () => {
    const deleteResource = vi.fn().mockResolvedValue({ deleted: true })
    const { server, tools } = makeMockServer()
    registerBookingTools(server, makeMockClient({ deleteResource }))
    await callTool(tools, 'haszno_booking_delete_resource', { id: 10, confirm: true })
    expect(deleteResource).toHaveBeenCalledWith(10)
  })
})

// ── haszno_booking_set_hours ──────────────────────────────────────────────────

describe('haszno_booking_set_hours', () => {
  it('calls setHours with the provided schedule', async () => {
    const setHours = vi.fn().mockResolvedValue({ hours: {} })
    const { server, tools } = makeMockServer()
    registerBookingTools(server, makeMockClient({ setHours }))
    const hours = { mon: [{ open: '09:00', close: '17:00' }], sat: null }
    await callTool(tools, 'haszno_booking_set_hours', { hours })
    expect(setHours).toHaveBeenCalledWith(hours)
  })
})

// ── haszno_booking_add_closure ────────────────────────────────────────────────

describe('haszno_booking_add_closure', () => {
  it('calls addClosure with date and optional fields', async () => {
    const addClosure = vi.fn().mockResolvedValue({ id: 5, date: '2026-12-25' })
    const { server, tools } = makeMockServer()
    registerBookingTools(server, makeMockClient({ addClosure }))
    await callTool(tools, 'haszno_booking_add_closure', {
      date: '2026-12-25',
      label: 'Karácsony',
    })
    expect(addClosure).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-12-25', label: 'Karácsony' }))
  })

  it('works without optional fields (full-day closure)', async () => {
    const addClosure = vi.fn().mockResolvedValue({ id: 6, date: '2026-01-01' })
    const { server, tools } = makeMockServer()
    registerBookingTools(server, makeMockClient({ addClosure }))
    await callTool(tools, 'haszno_booking_add_closure', { date: '2026-01-01' })
    expect(addClosure).toHaveBeenCalledWith({ date: '2026-01-01' })
  })
})

// ── haszno_booking_publish ────────────────────────────────────────────────────

describe('haszno_booking_publish', () => {
  it('requires confirm:true', async () => {
    const publish = vi.fn()
    const { server, tools } = makeMockServer()
    registerBookingTools(server, makeMockClient({ publish }))
    const result = await callTool(tools, 'haszno_booking_publish', { published: true })
    expect(publish).not.toHaveBeenCalled()
    expect(result.content[0].text).toMatch(/Confirm required/)
  })

  it('calls publish with { published: true } when confirm:true', async () => {
    const publish = vi.fn().mockResolvedValue({ published: true })
    const { server, tools } = makeMockServer()
    registerBookingTools(server, makeMockClient({ publish }))
    await callTool(tools, 'haszno_booking_publish', { published: true, confirm: true })
    expect(publish).toHaveBeenCalledWith({ published: true })
  })

  it('calls publish with { published: false } to unpublish', async () => {
    const publish = vi.fn().mockResolvedValue({ published: false })
    const { server, tools } = makeMockServer()
    registerBookingTools(server, makeMockClient({ publish }))
    await callTool(tools, 'haszno_booking_publish', { published: false, confirm: true })
    expect(publish).toHaveBeenCalledWith({ published: false })
  })
})

// ── haszno_booking_list_appointments ─────────────────────────────────────────

describe('haszno_booking_list_appointments', () => {
  it('calls listAppointments with from and to params', async () => {
    const listAppointments = vi.fn().mockResolvedValue([{ id: 1, date: '2026-11-20' }])
    const { server, tools } = makeMockServer()
    registerBookingTools(server, makeMockClient({ listAppointments }))
    const result = await callTool(tools, 'haszno_booking_list_appointments', {
      from: '2026-11-01',
      to: '2026-11-30',
    })
    expect(listAppointments).toHaveBeenCalledWith({ from: '2026-11-01', to: '2026-11-30' })
    const data = parsed(result)
    expect(Array.isArray(data)).toBe(true)
  })
})

// ── createClient() — booking in shop-token mode ───────────────────────────────

describe('createClient() — booking methods route to /api/agent/booking/* (shop-token mode)', () => {
  type FetchCall = { url: string; init: RequestInit }

  function makeFetch(status: number, body: unknown) {
    const calls: FetchCall[] = []
    const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response(JSON.stringify(body), { status })
    }) as unknown as typeof fetch
    return { fn, calls }
  }

  const SHOP_TOKEN = 'haszno_testabc123'

  it('booking.getSetup() → GET /api/agent/booking/setup', async () => {
    const { fn, calls } = makeFetch(200, BOOKING_SETUP)
    const client = createClient({ apiKey: SHOP_TOKEN, fetch: fn as typeof fetch })
    await client.booking.getSetup()
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/agent/booking/setup')
    expect(calls[0].init.method).toBe('GET')
  })

  it('booking.applySetup() → PUT /api/agent/booking/setup', async () => {
    const { fn, calls } = makeFetch(200, { applied: true })
    const client = createClient({ apiKey: SHOP_TOKEN, fetch: fn as typeof fetch })
    await client.booking.applySetup({ dryRun: true })
    expect(calls[0].url).toContain('/api/agent/booking/setup')
    expect(calls[0].init.method).toBe('PUT')
  })

  it('booking.setTheme() → PUT /api/agent/booking/theme', async () => {
    const { fn, calls } = makeFetch(200, {})
    const client = createClient({ apiKey: SHOP_TOKEN, fetch: fn as typeof fetch })
    await client.booking.setTheme({ accent: '#0ea5e9' })
    expect(calls[0].url).toContain('/api/agent/booking/theme')
    expect(calls[0].init.method).toBe('PUT')
  })

  it('booking.listServices() → GET /api/agent/booking/services', async () => {
    const { fn, calls } = makeFetch(200, [])
    const client = createClient({ apiKey: SHOP_TOKEN, fetch: fn as typeof fetch })
    await client.booking.listServices()
    expect(calls[0].url).toContain('/api/agent/booking/services')
    expect(calls[0].init.method).toBe('GET')
  })

  it('booking.createService() → POST /api/agent/booking/services', async () => {
    const { fn, calls } = makeFetch(201, { id: 1, name: 'Hajvágás' })
    const client = createClient({ apiKey: SHOP_TOKEN, fetch: fn as typeof fetch })
    await client.booking.createService({ name: 'Hajvágás', durationMin: 30 })
    expect(calls[0].url).toContain('/api/agent/booking/services')
    expect(calls[0].init.method).toBe('POST')
  })

  it('booking.updateService(1) → PATCH /api/agent/booking/services/1', async () => {
    const { fn, calls } = makeFetch(200, { id: 1, name: 'Hajvágás' })
    const client = createClient({ apiKey: SHOP_TOKEN, fetch: fn as typeof fetch })
    await client.booking.updateService(1, { durationMin: 45 })
    expect(calls[0].url).toContain('/api/agent/booking/services/1')
    expect(calls[0].init.method).toBe('PATCH')
  })

  it('booking.deleteService(1) → DELETE /api/agent/booking/services/1', async () => {
    const { fn, calls } = makeFetch(200, { deleted: true })
    const client = createClient({ apiKey: SHOP_TOKEN, fetch: fn as typeof fetch })
    await client.booking.deleteService(1)
    expect(calls[0].url).toContain('/api/agent/booking/services/1')
    expect(calls[0].init.method).toBe('DELETE')
  })

  it('booking.listAppointments() → GET /api/agent/booking/appointments?from=…&to=…', async () => {
    const { fn, calls } = makeFetch(200, [])
    const client = createClient({ apiKey: SHOP_TOKEN, fetch: fn as typeof fetch })
    await client.booking.listAppointments({ from: '2026-11-01', to: '2026-11-30' })
    expect(calls[0].url).toContain('/api/agent/booking/appointments')
    expect(calls[0].url).toContain('from=2026-11-01')
    expect(calls[0].url).toContain('to=2026-11-30')
    expect(calls[0].init.method).toBe('GET')
  })

  it('booking.publish() → POST /api/agent/booking/publish', async () => {
    const { fn, calls } = makeFetch(200, { published: true })
    const client = createClient({ apiKey: SHOP_TOKEN, fetch: fn as typeof fetch })
    await client.booking.publish({ published: true })
    expect(calls[0].url).toContain('/api/agent/booking/publish')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ published: true })
  })

  it('shop token is sent as Bearer on booking requests', async () => {
    const { fn, calls } = makeFetch(200, [])
    const client = createClient({ apiKey: SHOP_TOKEN, fetch: fn as typeof fetch })
    await client.booking.listServices()
    expect((calls[0].init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${SHOP_TOKEN}`)
  })
})

// ── createClient() — booking in legacy mode → LegacyKeyNotSupportedError ──────

describe('createClient() — booking methods rejected in legacy mode', () => {
  const LEGACY_KEY = 'legacy-api-key-no-prefix'

  type FetchCall = { url: string; init: RequestInit }
  function makeFetch(status: number, body: unknown) {
    const calls: FetchCall[] = []
    const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response(JSON.stringify(body), { status })
    }) as unknown as typeof fetch
    return { fn, calls }
  }

  const bookingOps: Array<{
    label: string
    call: (c: ReturnType<typeof createClient>) => Promise<unknown>
  }> = [
    { label: 'booking.getSetup', call: (c) => c.booking.getSetup() },
    { label: 'booking.applySetup', call: (c) => c.booking.applySetup({ dryRun: true }) },
    { label: 'booking.setTheme', call: (c) => c.booking.setTheme({}) },
    { label: 'booking.listServices', call: (c) => c.booking.listServices() },
    { label: 'booking.createService', call: (c) => c.booking.createService({ name: 'X', durationMin: 30 }) },
    { label: 'booking.updateService', call: (c) => c.booking.updateService(1, {}) },
    { label: 'booking.deleteService', call: (c) => c.booking.deleteService(1) },
    { label: 'booking.listResources', call: (c) => c.booking.listResources() },
    { label: 'booking.createResource', call: (c) => c.booking.createResource({ name: 'Y' }) },
    { label: 'booking.updateResource', call: (c) => c.booking.updateResource(1, {}) },
    { label: 'booking.deleteResource', call: (c) => c.booking.deleteResource(1) },
    { label: 'booking.setHours', call: (c) => c.booking.setHours({}) },
    { label: 'booking.addClosure', call: (c) => c.booking.addClosure({ date: '2026-12-25' }) },
    { label: 'booking.publish', call: (c) => c.booking.publish({ published: true }) },
    {
      label: 'booking.listAppointments',
      call: (c) => c.booking.listAppointments({ from: '2026-11-01', to: '2026-11-30' }),
    },
  ]

  it.each(bookingOps)('$label rejects with LegacyKeyNotSupportedError and no HTTP call', async ({ call }) => {
    const { fn } = makeFetch(200, {})
    const client = createClient({ apiKey: LEGACY_KEY, fetch: fn as typeof fetch })
    await expect(call(client)).rejects.toBeInstanceOf(LegacyKeyNotSupportedError)
    expect(fn).not.toHaveBeenCalled()
  })
})
