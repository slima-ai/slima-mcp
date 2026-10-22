/**
 * Slima MCP Server (CLI/stdio)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../core/api/client.js';
import { registerAllTools } from '../core/tools/index.js';
import { registerBookSchemaResource } from '../core/resources/index.js';
import { SERVER_INSTRUCTIONS } from '../core/server-instructions.js';
import { logger } from '../core/utils/logger.js';

declare const __VERSION__: string;

export interface ServerConfig {
  apiToken: string;
  baseUrl?: string;
}

/**
 * Create Slima MCP Server
 */
export function createSlimaServer(config: ServerConfig): McpServer {
  // Create API Client with static token getter (for CLI)
  const client = new SlimaApiClient({
    baseUrl: config.baseUrl || 'https://api.slima.ai',
    getToken: async () => config.apiToken,
    logger,
  });

  const server = new McpServer(
    {
      name: 'slima',
      version: __VERSION__,
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  // Register tools (one shared list for CLI and Worker; attaches titles)
  registerAllTools(server, client, logger);

  // Register resources (per-book schema via URI template)
  registerBookSchemaResource(server, client);

  logger.info('Slima MCP Server initialized');
  logger.info(`API endpoint: ${config.baseUrl || 'https://api.slima.ai'}`);

  return server;
}
