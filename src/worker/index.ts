/**
 * Slima MCP Server (Cloudflare Worker)
 *
 * Provides remote MCP access via Streamable HTTP transport
 * with OAuth 2.0 + PKCE authentication.
 */

import { Hono, Context, Next } from 'hono';
import { cors } from 'hono/cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient, Logger } from '../core/api/client.js';
import {
  registerBookTools,
  registerContentTools,
  registerBetaReaderTools,
  registerFileTools,
} from '../core/tools/index.js';
import { createOAuthRoutes, getTokenFromSession, Env } from './oauth.js';

const VERSION = '0.1.0';

// Simple logger for Worker environment
const workerLogger: Logger = {
  debug: (message: string, ...args: unknown[]) => console.debug(`[DEBUG] ${message}`, ...args),
  info: (message: string, ...args: unknown[]) => console.info(`[INFO] ${message}`, ...args),
  warn: (message: string, ...args: unknown[]) => console.warn(`[WARN] ${message}`, ...args),
  error: (message: string, error?: unknown) => console.error(`[ERROR] ${message}`, error),
};

// Create MCP server with tools
function createMcpServer(getToken: () => Promise<string>, baseUrl: string): McpServer {
  const client = new SlimaApiClient({
    baseUrl,
    getToken,
    logger: workerLogger,
  });

  const server = new McpServer({
    name: 'slima',
    version: VERSION,
  });

  // Register all tools
  registerBookTools(server, client);
  registerContentTools(server, client);
  registerBetaReaderTools(server, client, workerLogger);
  registerFileTools(server, client);

  return server;
}

// Authentication middleware for MCP endpoints
async function requireAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const token = await getTokenFromSession(c);
  if (!token) {
    return c.json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Authentication required. Please visit /auth/login to authenticate.',
      },
      id: null,
    }, 401);
  }
  // Store token in context for later use
  c.set('apiToken', token);
  await next();
}

// Create the Hono app
const app = new Hono<{ Bindings: Env; Variables: { apiToken: string } }>();

// CORS for MCP endpoints
app.use('/mcp/*', cors({
  origin: '*', // MCP clients may come from various origins
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id'],
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

// MCP endpoint - Streamable HTTP transport
app.post('/mcp', requireAuth, async (c) => {
  const token = c.get('apiToken');

  try {
    const body = await c.req.json();
    const server = createMcpServer(
      async () => token,
      c.env.SLIMA_API_URL
    );

    // Handle the JSON-RPC request
    // Note: This is a simplified implementation.
    // In production, you'd use the MCP SDK's transport handler
    // or Cloudflare's official MCP integration package.

    const { method, params, id } = body;

    // List available tools
    if (method === 'tools/list') {
      const tools = server.getTools?.() || [];
      return c.json({
        jsonrpc: '2.0',
        result: { tools },
        id,
      });
    }

    // Call a tool
    if (method === 'tools/call') {
      const { name, arguments: args } = params;
      try {
        const result = await server.callTool?.(name, args);
        return c.json({
          jsonrpc: '2.0',
          result,
          id,
        });
      } catch (error) {
        return c.json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : 'Tool execution failed',
          },
          id,
        }, 500);
      }
    }

    // Server info
    if (method === 'initialize' || method === 'server/info') {
      return c.json({
        jsonrpc: '2.0',
        result: {
          serverInfo: {
            name: 'slima',
            version: VERSION,
          },
          capabilities: {
            tools: {},
          },
        },
        id,
      });
    }

    // Unknown method
    return c.json({
      jsonrpc: '2.0',
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
      id,
    }, 404);
  } catch (error) {
    workerLogger.error('MCP request error', error);
    return c.json({
      jsonrpc: '2.0',
      error: {
        code: -32700,
        message: 'Parse error',
      },
      id: null,
    }, 400);
  }
});

// MCP info endpoint (for discovery)
app.get('/mcp', (c) => {
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
