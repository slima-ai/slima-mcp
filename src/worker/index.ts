/**
 * Slima MCP Server (Cloudflare Worker)
 *
 * Provides remote MCP access via Streamable HTTP transport
 * with OAuth 2.0 + PKCE authentication.
 *
 * Uses:
 * - @cloudflare/workers-oauth-provider for OAuth handling
 * - @modelcontextprotocol/sdk for MCP protocol
 */

import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { SlimaApiClient } from '../core/api/client.js';
import {
  registerBookTools,
  registerContentTools,
  registerBetaReaderTools,
  registerFileTools,
} from '../core/tools/index.js';
import SlimaOAuthHandler from './oauth-handler.js';
import type { Logger } from '../core/api/client.js';

const VERSION = '0.1.0';

export interface Env {
  SLIMA_API_URL: string;
  OAUTH_CLIENT_ID: string;
  OAUTH_KV: KVNamespace;
}

// Simple logger for Worker environment
const workerLogger: Logger = {
  debug: (message: string, ...args: unknown[]) => console.debug(`[DEBUG] ${message}`, ...args),
  info: (message: string, ...args: unknown[]) => console.info(`[INFO] ${message}`, ...args),
  warn: (message: string, ...args: unknown[]) => console.warn(`[WARN] ${message}`, ...args),
  error: (message: string, error?: unknown) => console.error(`[ERROR] ${message}`, error),
};

/**
 * MCP API Handler
 *
 * Handles authenticated MCP requests. The accessToken from OAuth
 * is available in this.ctx.props.accessToken
 */
class McpApiHandler extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Only handle /mcp endpoint
    if (!url.pathname.startsWith('/mcp')) {
      return new Response('Not Found', { status: 404 });
    }

    // Get the access token from OAuth context
    // @ts-expect-error - ctx.props is set by workers-oauth-provider
    const accessToken = this.ctx?.props?.accessToken;

    if (!accessToken) {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Authentication required' },
          id: null,
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'WWW-Authenticate': `Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource"`,
          },
        }
      );
    }

    // Create API client with the authenticated token
    const client = new SlimaApiClient({
      baseUrl: this.env.SLIMA_API_URL,
      getToken: async () => accessToken,
      logger: workerLogger,
    });

    // Create MCP server and register tools
    const server = new McpServer({
      name: 'slima',
      version: VERSION,
    });

    registerBookTools(server, client);
    registerContentTools(server, client);
    registerBetaReaderTools(server, client, workerLogger);
    registerFileTools(server, client);

    // Create transport in stateless mode with JSON responses
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
      enableJsonResponse: true, // Return JSON instead of SSE
    });

    // Connect and handle request
    await server.connect(transport);

    try {
      return await transport.handleRequest(request);
    } finally {
      await transport.close();
    }
  }
}

// Export the OAuthProvider-wrapped Worker
export default new OAuthProvider({
  // API route - requests here require authentication
  apiRoute: '/mcp',

  // Handler for authenticated API requests
  apiHandler: McpApiHandler,

  // Default handler for non-API requests (authorization flow)
  defaultHandler: SlimaOAuthHandler,

  // OAuth endpoints - proxy to Rails
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',

  // Supported scopes
  scopesSupported: ['read', 'write'],

  // Token settings
  refreshTokenTTL: 30 * 24 * 60 * 60, // 30 days

  // Error handler
  onError({ code, description, status }) {
    workerLogger.error(`OAuth error: ${status} ${code} - ${description}`);
    return undefined; // Use default error response
  },
});
