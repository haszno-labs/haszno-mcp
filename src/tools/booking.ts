/**
 * MCP tools — Időpontfoglalás / Booking (booking module configuration).
 *
 * Domain: booking
 * Tools:
 *   haszno_booking_get_setup        — read current booking config (page, services, resources, hours, checklist)
 *   haszno_booking_apply_setup      — bulk-apply setup; dryRun returns a change-list; confirm:true writes
 *   haszno_booking_set_theme        — partial theme update (accent, background, radius, font, logo, cover, headline, button)
 *   haszno_booking_upsert_service   — create or update a service (GET-then-match-by-name)
 *   haszno_booking_delete_service   — soft-delete a service by id (confirm required)
 *   haszno_booking_upsert_resource  — create or update a resource (GET-then-match-by-name)
 *   haszno_booking_delete_resource  — soft-delete a resource by id (confirm required)
 *   haszno_booking_set_hours        — replace the full weekly schedule
 *   haszno_booking_add_closure      — add a date exception / closure
 *   haszno_booking_publish          — publish or unpublish the booking page (confirm required; 422 if incomplete)
 *   haszno_booking_list_appointments — list appointments for a date range (from+to required, max 31 days)
 *
 * Auth model (all tools):
 *   Requires a shop Bearer token (haszno_…). Read tools require read scope;
 *   write tools require write scope. Legacy API keys are not supported — all booking
 *   operations call /api/agent/booking/* which require Authorization: Bearer.
 *
 * Recommended workflow for a new booking setup:
 *   1. haszno_booking_get_setup              — inspect current state + checklist
 *   2. haszno_booking_apply_setup dryRun:true — preview what changes will be made
 *   3. Show the preview to the user and confirm
 *   4. haszno_booking_apply_setup confirm:true — apply the changes
 *   5. haszno_booking_publish confirm:true     — go live (only after services+resources+hours are set)
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { HasznoClient } from '../client/index.js'

// ── Shared sub-schemas ─────────────────────────────────────────────────────────

const TimeRangeSchema = z.object({
  open: z.string().describe('Opening time (HH:MM), e.g. "09:00".'),
  close: z.string().describe('Closing time (HH:MM), e.g. "17:00".'),
})

const HoursMapSchema = z.record(
  z.string(),
  z.union([z.array(TimeRangeSchema), z.null()]),
).describe(
  'Weekly schedule keyed by day (mon, tue, wed, thu, fri, sat, sun). ' +
  'Each value is an array of {open, close} time ranges or null for a closed day. ' +
  'Example: { "mon": [{"open":"09:00","close":"17:00"}], "sat": null }',
)

const ServiceBodySchema = z.object({
  name: z.string().describe('Service name, e.g. "Hajvágás". Used to match existing services.'),
  durationMin: z.number().int().positive().describe('Duration in minutes, e.g. 30.'),
  priceHuf: z.number().int().nonnegative().optional().describe('Price in HUF (whole forints). 0 = free.'),
  description: z.string().optional().describe('Short description shown to customers.'),
})

const ResourceBodySchema = z.object({
  name: z.string().describe('Resource name, e.g. "1-es szék". Used to match existing resources.'),
  description: z.string().optional().describe('Optional note, e.g. "Ground floor, accessible".'),
})

const ThemeBodySchema = z.object({
  accent: z.string().optional().describe('Brand hex color, e.g. "#0ea5e9".'),
  background: z.enum(['light', 'soft', 'dark']).optional().describe('Page background tone.'),
  radius: z.enum(['sharp', 'soft', 'round']).optional().describe('Button / card corner radius style.'),
  font: z.enum(['inter', 'serif', 'rounded']).optional().describe('Typography preset.'),
  logoUrl: z.string().optional().describe('Full https:// URL for the shop logo image, or empty string to clear.'),
  coverUrl: z.string().optional().describe('Full https:// URL for the page cover image, or empty string to clear.'),
  headline: z.string().max(80).optional().describe('Short headline shown on the booking page (max 80 chars).'),
  buttonLabel: z.string().max(40).optional().describe('Call-to-action button label, e.g. "Foglalok" (max 40 chars).'),
})

// ── registerBookingTools ───────────────────────────────────────────────────────

export function registerBookingTools(server: McpServer, client: HasznoClient): void {
  // ── haszno_booking_get_setup ───────────────────────────────────────────────

  server.registerTool(
    'haszno_booking_get_setup',
    {
      title: 'Get booking setup',
      description:
        'Returns the full booking configuration for this shop: page settings, services, resources, ' +
        'weekly hours, closures, checklist (what is still missing), and nextStep hint. ' +
        'Call this first before any write operation so you understand the current state. ' +
        'Read-only. Requires a shop Bearer token (haszno_…) with read scope.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {},
    },
    async () => {
      const result = await client.booking.getSetup()
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    },
  )

  // ── haszno_booking_apply_setup ─────────────────────────────────────────────

  server.registerTool(
    'haszno_booking_apply_setup',
    {
      title: 'Apply booking setup',
      description:
        'Bulk-apply a booking setup in one call. ' +
        'RECOMMENDED WORKFLOW: (1) call haszno_booking_get_setup to see current state, ' +
        '(2) call this tool with dryRun:true to see what would change, ' +
        '(3) show the diff to the user and ask for confirmation, ' +
        '(4) call again with confirm:true to write. ' +
        'Either dryRun:true OR confirm:true is required (not both). ' +
        'Omitting both returns guidance without making any change. ' +
        'Requires write scope.',
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        dryRun: z
          .boolean()
          .optional()
          .describe('true = return a list of changes without writing (no confirm needed).'),
        confirm: z
          .literal(true)
          .optional()
          .describe('Must be exactly true to apply changes (required unless dryRun is true).'),
        page: z
          .object({
            headline: z.string().max(80).optional().describe('Page headline (max 80 chars).'),
            published: z.boolean().optional().describe('true = visible to customers; false = hidden.'),
          })
          .optional()
          .describe('Page-level settings to update.'),
        services: z
          .array(ServiceBodySchema)
          .optional()
          .describe(
            'Services to create or update (matched by name). ' +
            'Services not in this list are left untouched.',
          ),
        resources: z
          .array(ResourceBodySchema)
          .optional()
          .describe(
            'Resources to create or update (matched by name). ' +
            'Resources not in this list are left untouched.',
          ),
        hours: HoursMapSchema.optional(),
        theme: ThemeBodySchema.optional(),
      },
    },
    async (args) => {
      if (!args.dryRun && args.confirm !== true) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  guidance:
                    'Pass dryRun:true to preview changes without writing, ' +
                    'or confirm:true to apply. ' +
                    'Recommended: preview first (dryRun), show the user, then confirm.',
                },
                null,
                2,
              ),
            },
          ],
        }
      }

      const { dryRun, confirm: _confirm, ...body } = args
      const result = await client.booking.applySetup({
        dryRun: dryRun ?? false,
        ...body,
      })
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    },
  )

  // ── haszno_booking_set_theme ───────────────────────────────────────────────

  server.registerTool(
    'haszno_booking_set_theme',
    {
      title: 'Set booking page theme',
      description:
        'Partially update the visual theme of the booking page. ' +
        'Only the fields you pass are changed; omitted fields keep their current values. ' +
        'Theme contract: accent (hex), background (light/soft/dark), radius (sharp/soft/round), ' +
        'font (inter/serif/rounded), logoUrl, coverUrl, headline (80 chars), buttonLabel (40 chars). ' +
        'Requires write scope.',
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: ThemeBodySchema.shape,
    },
    async (args) => {
      const result = await client.booking.setTheme(args as Record<string, unknown>)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    },
  )

  // ── haszno_booking_upsert_service ─────────────────────────────────────────

  server.registerTool(
    'haszno_booking_upsert_service',
    {
      title: 'Upsert a booking service',
      description:
        'Create or update a service. The service is matched by name: ' +
        'if a service with the same name already exists it is updated (PATCH); ' +
        'otherwise a new one is created (POST). ' +
        'Returns the created or updated service with its id. ' +
        'Requires write scope.',
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: ServiceBodySchema.shape,
    },
    async (args) => {
      const services = await client.booking.listServices()
      const existing = services.find((s) => s.name === args.name)
      let result
      if (existing) {
        result = await client.booking.updateService(existing.id, {
          durationMin: args.durationMin,
          ...(args.priceHuf !== undefined ? { priceHuf: args.priceHuf } : {}),
          ...(args.description !== undefined ? { description: args.description } : {}),
        })
      } else {
        result = await client.booking.createService({
          name: args.name,
          durationMin: args.durationMin,
          ...(args.priceHuf !== undefined ? { priceHuf: args.priceHuf } : {}),
          ...(args.description !== undefined ? { description: args.description } : {}),
        })
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { action: existing ? 'updated' : 'created', service: result },
              null,
              2,
            ),
          },
        ],
      }
    },
  )

  // ── haszno_booking_delete_service ─────────────────────────────────────────

  server.registerTool(
    'haszno_booking_delete_service',
    {
      title: 'Delete a booking service',
      description:
        'Soft-delete a service by its id. ' +
        'The service is hidden from the booking page but its appointment history is preserved. ' +
        'Use haszno_booking_get_setup to discover service ids before calling this. ' +
        'Requires confirm:true and write scope.',
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        id: z.number().int().positive().describe('Service id (from haszno_booking_get_setup or haszno_booking_upsert_service).'),
        confirm: z.literal(true).optional().describe('Must be exactly true (safety gate).'),
      },
    },
    async (args) => {
      if (args.confirm !== true) {
        return {
          content: [{ type: 'text', text: 'Confirm required: set confirm:true to delete the service.' }],
        }
      }
      const result = await client.booking.deleteService(args.id)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    },
  )

  // ── haszno_booking_upsert_resource ────────────────────────────────────────

  server.registerTool(
    'haszno_booking_upsert_resource',
    {
      title: 'Upsert a booking resource',
      description:
        'Create or update a bookable resource (a physical space, seat, or equipment slot). ' +
        'Matched by name: if a resource with the same name exists it is updated; otherwise created. ' +
        'Returns the created or updated resource with its id. ' +
        'Requires write scope.',
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: ResourceBodySchema.shape,
    },
    async (args) => {
      const resources = await client.booking.listResources()
      const existing = resources.find((r) => r.name === args.name)
      let result
      if (existing) {
        result = await client.booking.updateResource(existing.id, {
          ...(args.description !== undefined ? { description: args.description } : {}),
        })
      } else {
        result = await client.booking.createResource({
          name: args.name,
          ...(args.description !== undefined ? { description: args.description } : {}),
        })
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { action: existing ? 'updated' : 'created', resource: result },
              null,
              2,
            ),
          },
        ],
      }
    },
  )

  // ── haszno_booking_delete_resource ────────────────────────────────────────

  server.registerTool(
    'haszno_booking_delete_resource',
    {
      title: 'Delete a booking resource',
      description:
        'Soft-delete a bookable resource by its id. ' +
        'The resource is removed from future availability but history is preserved. ' +
        'Use haszno_booking_get_setup to discover resource ids. ' +
        'Requires confirm:true and write scope.',
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        id: z.number().int().positive().describe('Resource id (from haszno_booking_get_setup or haszno_booking_upsert_resource).'),
        confirm: z.literal(true).optional().describe('Must be exactly true (safety gate).'),
      },
    },
    async (args) => {
      if (args.confirm !== true) {
        return {
          content: [{ type: 'text', text: 'Confirm required: set confirm:true to delete the resource.' }],
        }
      }
      const result = await client.booking.deleteResource(args.id)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    },
  )

  // ── haszno_booking_set_hours ──────────────────────────────────────────────

  server.registerTool(
    'haszno_booking_set_hours',
    {
      title: 'Set booking hours',
      description:
        'Replace the full weekly opening-hours schedule. ' +
        'The entire schedule is replaced — include all days you want configured. ' +
        'Days omitted from the map default to closed (null). ' +
        'Example: { "mon": [{"open":"09:00","close":"17:00"}], "wed": null, "sat": null }. ' +
        'Requires write scope.',
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        hours: HoursMapSchema,
      },
    },
    async (args) => {
      const result = await client.booking.setHours(args.hours as Record<string, unknown>)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    },
  )

  // ── haszno_booking_add_closure ────────────────────────────────────────────

  server.registerTool(
    'haszno_booking_add_closure',
    {
      title: 'Add a booking closure / exception',
      description:
        'Add a date exception (closure or partial closure). ' +
        'For a full-day closure, omit startTime and endTime. ' +
        'For a partial closure, provide both startTime and endTime (HH:MM). ' +
        'Requires write scope.',
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
          .describe('Date of the closure (YYYY-MM-DD).'),
        label: z
          .string()
          .optional()
          .describe('Human-readable label, e.g. "Karácsonyi szünet" or "Lunch break".'),
        startTime: z
          .string()
          .optional()
          .describe('Partial closure start (HH:MM). Omit for a full-day closure.'),
        endTime: z
          .string()
          .optional()
          .describe('Partial closure end (HH:MM). Omit for a full-day closure.'),
      },
    },
    async (args) => {
      const result = await client.booking.addClosure({
        date: args.date,
        ...(args.label !== undefined ? { label: args.label } : {}),
        ...(args.startTime !== undefined ? { startTime: args.startTime } : {}),
        ...(args.endTime !== undefined ? { endTime: args.endTime } : {}),
      })
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    },
  )

  // ── haszno_booking_publish ────────────────────────────────────────────────

  server.registerTool(
    'haszno_booking_publish',
    {
      title: 'Publish or unpublish the booking page',
      description:
        'Publish (published:true) or unpublish (published:false) the booking page. ' +
        'Publishing fails with 422 if the checklist is incomplete (no services, no resources, or no hours). ' +
        'Call haszno_booking_get_setup first to verify the checklist before publishing. ' +
        'Requires confirm:true and write scope.',
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        published: z.boolean().describe('true = visible to customers; false = hidden draft.'),
        confirm: z.literal(true).optional().describe('Must be exactly true (safety gate).'),
      },
    },
    async (args) => {
      if (args.confirm !== true) {
        return {
          content: [
            {
              type: 'text',
              text: 'Confirm required: set confirm:true to publish or unpublish the booking page.',
            },
          ],
        }
      }
      const result = await client.booking.publish({ published: args.published })
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    },
  )

  // ── haszno_booking_list_appointments ─────────────────────────────────────

  server.registerTool(
    'haszno_booking_list_appointments',
    {
      title: 'List booking appointments',
      description:
        'List customer appointments for a date range. ' +
        'Both from and to are required (YYYY-MM-DD format, inclusive). ' +
        'Maximum range: 31 days. ' +
        'Returns appointment id, service, resource, customer, date/time, status, and notes. ' +
        'Read-only. Requires read scope.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
          .describe('Start date (YYYY-MM-DD, inclusive).'),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
          .describe('End date (YYYY-MM-DD, inclusive). Maximum 31 days after `from`.'),
      },
    },
    async (args) => {
      const result = await client.booking.listAppointments({ from: args.from, to: args.to })
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    },
  )
}
