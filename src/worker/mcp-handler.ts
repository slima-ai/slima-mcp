/**
 * MCP Handler Module
 *
 * Uses the official MCP SDK WebStandardStreamableHTTPServerTransport
 * for proper protocol handling with Cloudflare Workers.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { SlimaApiClient, Logger } from '../core/api/client.js';
import {
  registerBookTools,
  registerContentTools,
  registerBetaReaderTools,
  registerFileTools,
} from '../core/tools/index.js';

const VERSION = '0.1.0';

export interface McpHandlerOptions {
  apiUrl: string;
  getToken: () => Promise<string>;
  logger: Logger;
}

/**
 * Handle an MCP request using the proper SDK transport.
 *
 * This creates a new McpServer and transport for each request,
 * which is appropriate for stateless Cloudflare Workers.
 */
export async function handleMcpRequest(
  request: Request,
  options: McpHandlerOptions
): Promise<Response> {
  const { apiUrl, getToken, logger } = options;

  // Create API client with token getter
  const client = new SlimaApiClient({
    baseUrl: apiUrl,
    getToken,
    logger,
  });

  // Create MCP server
  const server = new McpServer({
    name: 'slima',
    version: VERSION,
  });

  // Register all tools
  registerBookTools(server, client);
  registerContentTools(server, client);
  registerBetaReaderTools(server, client, logger);
  registerFileTools(server, client);

  // Create transport in stateless mode (appropriate for Workers)
  // enableJsonResponse: true makes responses simpler for testing and stateless operation
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless mode
    enableJsonResponse: true, // Return JSON instead of SSE streams
  });

  // Connect server to transport
  await server.connect(transport);

  try {
    // Handle the request through the SDK transport
    return await transport.handleRequest(request);
  } finally {
    // Clean up transport
    await transport.close();
  }
}
