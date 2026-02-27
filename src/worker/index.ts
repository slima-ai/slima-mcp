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
  const userAgent = c.req.header('User-Agent')?.slice(0, 50);
  workerLogger.info(`requireAuth: method=${c.req.method} path=${c.req.path} hasAuth=${!!authHeader} authPrefix=${authHeader?.slice(0, 20)} UA=${userAgent}`);

  const token = await getTokenFromSession(c);
  if (!token) {
    const baseUrl = new URL(c.req.url).origin;
    workerLogger.info(`requireAuth: 401 - no valid token found, returning WWW-Authenticate`);
    // RFC 9728 + RFC 6750: Include resource_metadata in WWW-Authenticate header
    // Per RFC 9728 Section 5.1, the metadata URL uses the path suffix of the resource:
    //   resource URL: https://mcp.slima.ai/mcp
    //   metadata URL: https://mcp.slima.ai/.well-known/oauth-protected-resource/mcp
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
          // RFC 9728 + RFC 6750: resource_metadata URL and scope for MCP auth discovery
          'WWW-Authenticate': `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource/mcp", scope="read write"`,
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
  // Note: Do NOT set credentials:true with origin:'*' - invalid per CORS spec.
  // Bearer tokens are sent via Authorization header, not cookies, so credentials mode is not needed.
}));

// CORS for OAuth and well-known endpoints
app.use('/.well-known/*', cors({ origin: '*' }));
app.use('/oauth/*', cors({ origin: '*' }));

// OAuth routes
createOAuthRoutes(app);

// Favicon - serve Slima logo for Google favicon crawler and browser tabs
// SVG favicon (modern browsers)
app.get('/favicon.svg', (c) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 53.4 50.6"><path fill="#363636" d="M48.2,26.6h-16c-0.8,0-1.2-0.5-1.4-0.9s-0.2-1.1,0.3-1.7l7.2-7.2c0.9-0.9,0.9-2.3,0-3.2c-0.9-0.9-2.3-0.9-3.2,0l-7.2,7.2c-0.5,0.5-1.2,0.5-1.7,0.3c-0.5-0.2-0.9-0.7-0.9-1.4V3.8c0-1.3-1-2.3-2.3-2.3c-1.3,0-2.3,1-2.3,2.3v15.9c0,0.8-0.5,1.2-0.9,1.4c-0.5,0.2-1.1,0.2-1.7-0.3l-7.2-7.2c-0.9-0.9-2.3-0.9-3.2,0C7.3,14,7,14.6,7,15.2s0.2,1.2,0.7,1.6l7.2,7.2c0.5,0.5,0.5,1.2,0.3,1.7s-0.7,0.9-1.4,0.9H9c-1.3,0-2.3,1-2.3,2.3c0,1.3,1,2.3,2.3,2.3h4.8c0.8,0,1.2,0.5,1.4,0.9s0.2,1.1-0.3,1.7L3.6,45C3.2,45.5,3,46,3,46.6c0,0.6,0.2,1.2,0.7,1.6c0.9,0.9,2.4,0.9,3.2,0L18.1,37c0.5-0.5,1.2-0.5,1.7-0.3c0.5,0.2,0.9,0.7,0.9,1.4v8.5c0,1.3,1,2.3,2.3,2.3c1.3,0,2.3-1,2.3-2.3v-8.5c0-0.8,0.5-1.2,0.9-1.4c0.5-0.2,1.1-0.2,1.7,0.3l11.4,11.4c0.4,0.4,1,0.7,1.6,0.7c0.6,0,1.2-0.2,1.6-0.7c0.4-0.4,0.7-1,0.7-1.6s-0.2-1.2-0.7-1.6L31.1,33.8c-0.5-0.5-0.5-1.2-0.3-1.7s0.7-0.9,1.4-0.9h16c1.3,0,2.3-1,2.3-2.3C50.5,27.6,49.4,26.6,48.2,26.6z"/></svg>`;
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400',
    },
  });
});
// ICO fallback - redirect to slima.ai for legacy browsers and Google favicon crawler
app.get('/favicon.ico', (c) => {
  return c.redirect('https://app.slima.ai/favicon.ico', 301);
});

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
// Supports HEAD, GET, POST, DELETE as per MCP Streamable HTTP spec
//
// Authentication model (per Claude.ai connector requirements):
// - HEAD: No auth (protocol version discovery)
// - POST initialize/notifications/initialized: No auth (capability discovery)
// - POST tools/list, tools/call, etc.: Auth required
// - GET: Auth required (SSE stream)
app.all('/mcp', async (c, next) => {
  // HEAD /mcp - Protocol version discovery (MCP Streamable HTTP spec)
  // No auth required - Claude.ai sends HEAD to discover protocol version before auth
  if (c.req.method === 'HEAD') {
    workerLogger.info(`HEAD /mcp - protocol discovery from ${c.req.header('User-Agent')?.slice(0, 50)}`);
    return new Response(null, {
      status: 200,
      headers: {
        'MCP-Protocol-Version': '2025-11-25',
        'Content-Type': 'application/json',
      },
    });
  }

  // For POST requests without auth, check if it's an initialize/initialized method
  // Claude.ai sends initialize WITHOUT Bearer token after OAuth (by design)
  // These methods only return capabilities/ack - no user data access needed
  if (c.req.method === 'POST') {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
      try {
        const clonedReq = c.req.raw.clone();
        const body = await clonedReq.json() as { method?: string };
        const method = body.method;
        if (method === 'initialize' || method === 'notifications/initialized') {
          workerLogger.info(`POST /mcp - unauthenticated ${method} allowed from ${c.req.header('User-Agent')?.slice(0, 50)}`);
          await next();
          return;
        }
      } catch {
        // Body parse failed - fall through to requireAuth
      }
    }
  }

  // All other methods/requests require authentication
  return requireAuth(c, next);
}, async (c) => {
  const token = tokenStore.get(c.req.raw);

  // token may be empty for unauthenticated initialize requests
  // This is fine - initialize only returns capabilities, doesn't call Rails API
  return handleMcpRequest(c.req.raw, {
    apiUrl: c.env.SLIMA_API_URL,
    getToken: async () => token || '',
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
// IMPORTANT: resource MUST be the MCP endpoint URL (not just the base domain)
// Per MCP Auth spec: "resource" identifies the protected MCP server endpoint
app.get('/.well-known/oauth-protected-resource', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  workerLogger.info(`well-known/oauth-protected-resource requested from ${c.req.header('User-Agent')?.slice(0, 50)}`);
  return c.json({
    resource: `${baseUrl}/mcp`,
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
