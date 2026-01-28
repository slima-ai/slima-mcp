/**
 * Slima MCP Server (Cloudflare Worker)
 *
 * Provides remote MCP access via Streamable HTTP transport
 * with OAuth 2.0 + PKCE authentication.
 *
 * Uses the official MCP SDK WebStandardStreamableHTTPServerTransport
 * for proper protocol handling.
 */

import { Hono, Context, Next } from 'hono';
import { cors } from 'hono/cors';
import { createOAuthRoutes, getTokenFromSession, Env } from './oauth.js';
import { handleMcpRequest } from './mcp-handler.js';
import type { Logger } from '../core/api/client.js';

const VERSION = '0.1.0';

// Simple logger for Worker environment
const workerLogger: Logger = {
  debug: (message: string, ...args: unknown[]) => console.debug(`[DEBUG] ${message}`, ...args),
  info: (message: string, ...args: unknown[]) => console.info(`[INFO] ${message}`, ...args),
  warn: (message: string, ...args: unknown[]) => console.warn(`[WARN] ${message}`, ...args),
  error: (message: string, error?: unknown) => console.error(`[ERROR] ${message}`, error),
};

// Authentication middleware for MCP endpoints
// RFC 9728: Must return WWW-Authenticate header with resource_metadata URL
async function requireAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const token = await getTokenFromSession(c);
  if (!token) {
    const baseUrl = new URL(c.req.url).origin;
    // RFC 9728: Include resource_metadata in WWW-Authenticate header
    // This tells the client where to discover OAuth endpoints
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'Authentication required',
        },
        id: null,
      }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
        },
      }
    );
  }
  // Store token in context for later use
  c.set('apiToken', token);
  await next();
}

// Create the Hono app
const app = new Hono<{ Bindings: Env; Variables: { apiToken: string } }>();

// CORS for MCP endpoints
app.use('/mcp', cors({
  origin: '*', // MCP clients may come from various origins
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id', 'Mcp-Protocol-Version'],
  exposeHeaders: ['Mcp-Session-Id'],
  credentials: true,
}));

// CORS for OAuth and well-known endpoints
app.use('/.well-known/*', cors({ origin: '*' }));
app.use('/oauth/*', cors({ origin: '*' }));

// OAuth routes
createOAuthRoutes(app);

// Health check
app.get('/', (c) => {
  return c.json({
    name: 'Slima MCP Server',
    version: VERSION,
    status: 'ok',
    endpoints: {
      mcp: '/mcp',
      auth: '/auth/login',
      docs: 'https://docs.slima.ai/mcp',
    },
  });
});

// MCP endpoint - using SDK's WebStandardStreamableHTTPServerTransport
// Supports GET, POST, DELETE as per MCP Streamable HTTP spec
app.all('/mcp', requireAuth, async (c) => {
  const token = c.get('apiToken');

  return handleMcpRequest(c.req.raw, {
    apiUrl: c.env.SLIMA_API_URL,
    getToken: async () => token,
    logger: workerLogger,
  });
});

// MCP info endpoint (for discovery - no auth required)
app.get('/mcp/info', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  return c.json({
    name: 'slima',
    version: VERSION,
    description: 'Slima MCP Server - AI writing assistant for long-form fiction',
    capabilities: {
      tools: true,
    },
    authentication: {
      type: 'oauth2',
      authorization_url: `${c.env.SLIMA_API_URL}/api/v1/oauth/authorize`,
      token_url: `${c.env.SLIMA_API_URL}/api/v1/oauth/token`,
      client_id: c.env.OAUTH_CLIENT_ID,
      scope: 'read write',
      pkce_required: true,
    },
  });
});

// OAuth 2.0 Authorization Server Metadata (RFC 8414)
// Claude.ai and ChatGPT use this to discover OAuth endpoints
app.get('/.well-known/oauth-authorization-server', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  return c.json({
    issuer: c.env.SLIMA_API_URL,
    authorization_endpoint: `${c.env.SLIMA_API_URL}/api/v1/oauth/authorize`,
    token_endpoint: `${c.env.SLIMA_API_URL}/api/v1/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,  // RFC 7591 DCR
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['read', 'write'],
  });
});

// RFC 9728 - OAuth 2.0 Protected Resource Metadata
// ChatGPT queries this to discover the authorization server
app.get('/.well-known/oauth-protected-resource', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  return c.json({
    resource: baseUrl,
    authorization_servers: [c.env.SLIMA_API_URL],
    scopes_supported: ['read', 'write'],
    bearer_methods_supported: ['header'],
  });
});

// RFC 7591 - Dynamic Client Registration
// Proxies registration requests to Rails API
app.post('/oauth/register', async (c) => {
  try {
    const body = await c.req.json();

    // Forward to Rails DCR endpoint
    const response = await fetch(`${c.env.SLIMA_API_URL}/api/v1/oauth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return c.json(data, response.status as 200 | 201 | 400);
  } catch (error) {
    workerLogger.error('DCR registration error', error);
    return c.json({
      error: 'server_error',
      error_description: 'Failed to register client',
    }, 500);
  }
});

// Export for Cloudflare Workers
export default app;
