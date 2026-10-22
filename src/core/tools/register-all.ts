import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SlimaApiClient, Logger } from '../api/client.js';
import { registerBookTools } from './books.js';
import { registerTeachingTools } from './teaching.js';
import { registerTeamTools } from './teams.js';
import { registerWorkspaceTools } from './workspace.js';
import { registerContentTools } from './content.js';
import { registerBetaReaderTools } from './beta-reader.js';
import { registerFileTools } from './files.js';
import { registerStructuredTools } from './structured.js';
import { withToolTitles } from './titles.js';

/**
 * The one list of tool groups. The CLI (stdio) and the Worker (HTTP) both call this,
 * so they cannot drift apart and neither can forget to attach titles.
 */
export function registerAllTools(server: McpServer, client: SlimaApiClient, logger: Logger): void {
  withToolTitles(server);

  // Teaching first: it is what an AI should reach for before anything else,
  // and tool order is the only ordering signal the protocol carries.
  registerTeachingTools(server, client);
  registerBookTools(server, client);
  registerTeamTools(server, client);
  registerWorkspaceTools(server, client);
  registerContentTools(server, client);
  registerBetaReaderTools(server, client, logger);
  registerFileTools(server, client);
  registerStructuredTools(server, client);
}
