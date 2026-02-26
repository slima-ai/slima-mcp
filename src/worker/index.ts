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
import { createOAuthRoutes, getTokenFromSession, Env, OAuthApp } from './oauth.js';
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

// Create the Hono app (using OAuthApp type for compatibility with OAuth routes)
const app: OAuthApp = new Hono<{ Bindings: Env }>();

// Store for authenticated tokens (request-scoped)
const tokenStore = new WeakMap<Request, string>();

// Authentication middleware for MCP endpoints
// RFC 9728: Must return WWW-Authenticate header with resource_metadata URL
// RFC 6750: Should include scope parameter
async function requireAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const authHeader = c.req.header('Authorization');
  workerLogger.debug(`requireAuth: method=${c.req.method} path=${c.req.path} hasAuth=${!!authHeader} authPrefix=${authHeader?.slice(0, 20)}`);

  const token = await getTokenFromSession(c);
  if (!token) {
    const baseUrl = new URL(c.req.url).origin;
    workerLogger.info(`requireAuth: 401 - no valid token found, returning WWW-Authenticate`);
    // RFC 9728 + RFC 6750: Include resource_metadata and scope in WWW-Authenticate header
    // This tells the client where to discover OAuth endpoints and required scopes
    // Note: resource_metadata points to the base URL (without /mcp suffix)
    // per RFC 9728 Section 5.1 - clients construct the full path themselves
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
          // Use the resource-specific metadata URL for the /mcp endpoint
          'WWW-Authenticate': `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
        },
      }
    );
  }
  workerLogger.debug(`requireAuth: token resolved, prefix=${token.slice(0, 10)}...`);
  // Store token using WeakMap keyed by request
  tokenStore.set(c.req.raw, token);
  await next();
}

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
  const baseUrl = new URL(c.req.url).origin;
  return c.json({
    name: 'Slima MCP Server',
    version: VERSION,
    status: 'ok',
    endpoints: {
      mcp: '/mcp',
      authorize: '/authorize',
      token: '/token',
      register: '/register',
      auth: '/auth/login',
      discovery: '/.well-known/oauth-authorization-server',
      docs: 'https://docs.slima.ai/mcp',
    },
  });
});

// MCP endpoint - using SDK's WebStandardStreamableHTTPServerTransport
// Supports GET, POST, DELETE as per MCP Streamable HTTP spec
app.all('/mcp', requireAuth, async (c) => {
  const token = tokenStore.get(c.req.raw);
  if (!token) {
    // This should never happen since requireAuth already checked
    return new Response('Unauthorized', { status: 401 });
  }

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
      authorization_url: `${baseUrl}/authorize`,
      token_url: `${baseUrl}/token`,
      registration_url: `${baseUrl}/register`,
      scope: 'read write',
      pkce_required: true,
    },
  });
});

// OAuth 2.0 Authorization Server Metadata (RFC 8414)
// Claude.ai and ChatGPT use this to discover OAuth endpoints
// IMPORTANT: All endpoints point to Worker (same domain) for AI client compatibility
app.get('/.well-known/oauth-authorization-server', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  workerLogger.info(`well-known/oauth-authorization-server requested from ${c.req.header('User-Agent')?.slice(0, 50)}`);
  return c.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    scopes_supported: ['read', 'write'],
  });
});

// RFC 8414 - Authorization Server Metadata with path suffix
// ChatGPT queries /.well-known/oauth-authorization-server/mcp for the /mcp resource
app.get('/.well-known/oauth-authorization-server/:path', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  const path = c.req.param('path');
  workerLogger.info(`well-known/oauth-authorization-server/${path} requested`);
  return c.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    scopes_supported: ['read', 'write'],
  });
});

// RFC 9728 - OAuth 2.0 Protected Resource Metadata
// ChatGPT queries this to discover the authorization server
// IMPORTANT: authorization_servers points to self (Worker acts as OAuth AS proxy)
app.get('/.well-known/oauth-protected-resource', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  workerLogger.info(`well-known/oauth-protected-resource requested from ${c.req.header('User-Agent')?.slice(0, 50)}`);
  return c.json({
    resource: baseUrl,
    authorization_servers: [baseUrl],
    scopes_supported: ['read', 'write'],
    bearer_methods_supported: ['header'],
  });
});

// RFC 9728 - Protected Resource Metadata with path suffix
// Claude.ai queries /.well-known/oauth-protected-resource/mcp for the /mcp resource
app.get('/.well-known/oauth-protected-resource/:path', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  const resourcePath = c.req.param('path');
  workerLogger.info(`well-known/oauth-protected-resource/${resourcePath} requested`);
  return c.json({
    resource: `${baseUrl}/${resourcePath}`,
    authorization_servers: [baseUrl],
    scopes_supported: ['read', 'write'],
    bearer_methods_supported: ['header'],
  });
});

// OpenID Connect Discovery (for Claude.ai compatibility)
// Some clients query this endpoint instead of oauth-authorization-server
app.get('/.well-known/openid-configuration', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  return c.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    scopes_supported: ['read', 'write', 'openid'],
    subject_types_supported: ['public'],
  });
});

// OpenID Connect Discovery with path suffix
app.get('/.well-known/openid-configuration/:path', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  return c.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    scopes_supported: ['read', 'write', 'openid'],
    subject_types_supported: ['public'],
  });
});

// Export for Cloudflare Workers
export default app;
