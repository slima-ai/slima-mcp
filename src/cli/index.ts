/**
 * Slima MCP Server - CLI Entry Point
 *
 * Usage:
 *   slima-mcp           - Start MCP server (requires SLIMA_API_TOKEN or prior auth)
 *   slima-mcp auth      - Authenticate with Slima (opens browser)
 *   slima-mcp logout    - Remove saved credentials
 *   slima-mcp status    - Show authentication status
 *   slima-mcp --help    - Show help
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSlimaServer } from './server.js';
import { logger } from '../core/utils/logger.js';
import { loadToken, getCredentialsFilePath } from './token-storage.js';
import { runAuth, runLogout, runStatus } from './auth.js';

declare const __VERSION__: string;
const VERSION = __VERSION__;

function showHelp(): void {
  console.log(`
Slima MCP v${VERSION}
MCP Server for Slima - AI Writing IDE for Novel Authors

USAGE:
  slima-mcp [command]

COMMANDS:
  (none)    Start the MCP server
  auth      Authenticate with Slima (opens browser)
  logout    Remove saved credentials
  status    Show authentication status
  --help    Show this help message
  --version Show version

AUTHENTICATION:
  1. Run: slima-mcp auth
  2. Complete authentication in browser
  3. Token is automatically saved

  Or set SLIMA_API_TOKEN environment variable.

EXAMPLES:
  slima-mcp auth              # Authenticate with browser
  slima-mcp status            # Check auth status
  SLIMA_API_TOKEN=xxx slima-mcp   # Use env var

CONFIGURATION (for AI tools):
  Claude Desktop, Cursor, etc.:
    {
      "mcpServers": {
        "slima": {
          "command": "npx",
          "args": ["-y", "slima-mcp"]
        }
      }
    }

MORE INFO:
  https://github.com/slima-ai/slima-mcp
`);
}

function showVersion(): void {
  console.log(`slima-mcp v${VERSION}`);
}

async function startServer(): Promise<void> {
  // Use env var first, then stored token
  let apiToken = process.env.SLIMA_API_TOKEN;
  let baseUrl = process.env.SLIMA_API_URL;

  if (!apiToken) {
    const credentials = await loadToken();
    if (credentials) {
      apiToken = credentials.apiToken;
      baseUrl = baseUrl || credentials.baseUrl;
    }
  }

  if (!apiToken) {
    logger.error('Not authenticated and SLIMA_API_TOKEN not set');
    logger.error('');
    logger.error('To authenticate, run:');
    logger.error('  slima-mcp auth');
    logger.error('');
    logger.error('Or set environment variable:');
    logger.error('  SLIMA_API_TOKEN=your_token slima-mcp');
    logger.error('');
    logger.error('Get your API token from: https://app.slima.ai/settings/api-tokens');
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

    // Graceful shutdown
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'auth':
      await runAuth();
      break;

    case 'logout':
      await runLogout();
      break;

    case 'status':
      await runStatus();
      break;

    case '--help':
    case '-h':
    case 'help':
      showHelp();
      break;

    case '--version':
    case '-v':
      showVersion();
      break;

    case undefined:
      // Default: start MCP server
      await startServer();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run `slima-mcp --help` for usage.');
      process.exit(1);
  }
}

main();
