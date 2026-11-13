import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

interface HttpOptions {
    baseUrl?: string;
    apiKey?: string;
    basicAuth?: string;
    /** fetch implementation; defaults to global fetch */
    fetch?: typeof fetch;
    /** initial retry delay ms (doubles each attempt) */
    retryDelayMs?: number;
    /** max retry attempts */
    maxRetries?: number;
    /** request timeout ms */
    timeoutMs?: number;
    /**
     * When true, disables ALL process.env fallbacks for auth credentials and baseUrl.
     * Required for hosted/remote MCP endpoints where every credential must be supplied
     * explicitly in opts — never read from the host server's environment.
     */
    noEnvFallback?: boolean;
}

declare function registerShopTools(server: McpServer, opts: HttpOptions, flags?: {
    remote?: boolean;
}): void;

export { type HttpOptions, registerShopTools };
