/**
 * Slima MCP Server - CLI Entry Point
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSlimaServer } from './server.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  // 從環境變數讀取設定
  const apiToken = process.env.SLIMA_API_TOKEN;
  const baseUrl = process.env.SLIMA_API_URL;

  if (!apiToken) {
    logger.error('SLIMA_API_TOKEN environment variable is required');
    logger.error('');
    logger.error('Usage:');
    logger.error('  SLIMA_API_TOKEN=your_token slima-mcp');
    logger.error('');
    logger.error('Get your API token from: https://app.slima.app/settings/api');
    process.exit(1);
  }

  try {
    const server = createSlimaServer({
      apiToken,
      baseUrl,
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info('Slima MCP Server running on stdio');

    // 優雅關閉
    process.on('SIGINT', async () => {
      logger.info('Shutting down...');
      await server.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Shutting down...');
      await server.close();
      process.exit(0);
    });
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
}

main();
