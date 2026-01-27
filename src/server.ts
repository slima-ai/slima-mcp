/**
 * Slima MCP Server
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from './api/client.js';
import { registerBookTools } from './tools/books.js';
import { registerContentTools } from './tools/content.js';
import { registerBetaReaderTools } from './tools/beta-reader.js';
import { registerFileTools } from './tools/files.js';
import { logger } from './utils/logger.js';

declare const __VERSION__: string;

export interface ServerConfig {
  apiToken: string;
  baseUrl?: string;
}

/**
 * 建立 Slima MCP Server
 */
export function createSlimaServer(config: ServerConfig): McpServer {
  const client = new SlimaApiClient({
    token: config.apiToken,
    baseUrl: config.baseUrl || 'https://api.slima.ai',
  });

  const server = new McpServer({
    name: 'slima',
    version: __VERSION__,
  });

  // 註冊工具
  registerBookTools(server, client);
  registerContentTools(server, client);
  registerBetaReaderTools(server, client);
  registerFileTools(server, client);

  logger.info('Slima MCP Server initialized');
  logger.info(`API endpoint: ${config.baseUrl || 'https://api.slima.ai'}`);

  return server;
}
