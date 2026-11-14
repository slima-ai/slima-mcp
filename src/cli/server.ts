/**
 * Slima MCP Server (CLI/stdio)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../core/api/client.js';
import { registerAllTools } from '../core/tools/index.js';
import { registerBookSchemaResource } from '../core/resources/index.js';
import { SERVER_INSTRUCTIONS } from '../core/server-instructions.js';
import { logger } from '../core/utils/logger.js';
import { readFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';

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
  // Only the local (stdio) build can read the author's files and must check DNS: it runs on their
  // machine, where a public-looking name can resolve to their router (iss_8ra4aqwgliryabow).
  registerAllTools(server, client, logger, {
    images: {
      readLocalFile: async (path) => new Uint8Array(await readFile(path)),
      resolveHost: async (host) => (await lookup(host, { all: true })).map((a) => a.address),
    },
  });

  // Register resources (per-book schema via URI template)
  registerBookSchemaResource(server, client);

  logger.info('Slima MCP Server initialized');
  logger.info(`API endpoint: ${config.baseUrl || 'https://api.slima.ai'}`);

  return server;
}
