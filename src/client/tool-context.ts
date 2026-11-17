/**
 * AsyncLocalStorage-based tool name context for the MCP server.
 *
 * Usage:
 *   1. Call patchForToolContext(server) once after new McpServer() and before
 *      any register*Tools() calls.
 *   2. http.ts reads currentToolName() to populate the X-Haszno-Tool header.
 *
 * Works for both the stdio binary (src/index.ts) and the hosted library entry
 * (src/lib.ts) because the patch happens at the McpServer instance level.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

/** Holds the MCP tool name for the duration of a tool invocation. */
export const toolNameStorage = new AsyncLocalStorage<string>()

/** Pattern from the API contract: /^[a-zA-Z0-9_.:\- ]{1,80}$/ */
const TOOL_HEADER_RE = /^[a-zA-Z0-9_.:\- ]{1,80}$/

/**
 * Returns the tool name stored in the current async context if it matches the
 * X-Haszno-Tool header contract, or undefined when outside a tool call.
 */
export function currentToolName(): string | undefined {
  const name = toolNameStorage.getStore()
  if (name !== undefined && TOOL_HEADER_RE.test(name)) return name
  return undefined
}

// Minimal interface — avoids a deep import of the SDK type while still being
// type-safe for patching.
interface ServerWithRegisterTool {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerTool(name: string, schema: any, handler: (...args: any[]) => any, ...rest: any[]): unknown
}

/**
 * Patches server.registerTool so every registered handler runs inside
 * toolNameStorage.run(toolName, handler), making the tool name available
 * anywhere down the async call chain (including http.ts).
 *
 * Call once right after `new McpServer(...)`, before registering any tools.
 * Safe to call multiple times — the patch is idempotent because it checks
 * for the __toolContextPatched marker.
 */
export function patchForToolContext(server: ServerWithRegisterTool): void {
  if ((server as { __toolContextPatched?: boolean }).__toolContextPatched) return

  const original = server.registerTool.bind(server)
  server.registerTool = function (
    name: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (...args: any[]) => any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...rest: any[]
  ): unknown {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = (...args: any[]) =>
      toolNameStorage.run(name, () => handler(...args))
    return original(name, schema, wrapped, ...rest)
  }
  ;(server as { __toolContextPatched?: boolean }).__toolContextPatched = true
}
