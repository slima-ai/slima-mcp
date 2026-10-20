/**
 * Team tools — read-only.
 *
 * Governance (enabling a skill, authoring a rule, changing the roster) is not
 * on the server's MCP surface for any role, so there is nothing to expose here.
 * Enabling a skill is what turns an unvetted file into something the AI applies
 * for the whole team; that stays a human decision.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SlimaApiClient } from '../api/client.js';
import { formatErrorForMcp } from '../utils/errors.js';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function json(body: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(body, null, 2) }] };
}

function failure(error: unknown) {
  return { content: [{ type: 'text' as const, text: formatErrorForMcp(error) }], isError: true };
}

const TEAM_TOKEN = z.string().describe('Team token (from list_teams)');

export function registerTeamTools(server: McpServer, client: SlimaApiClient): void {
  server.tool(
    'list_teams',
    `List the teams this account belongs to — publishers, studios, writing groups.

A team book carries house rules and shared knowledge that change how you should write for it. If a book belongs to a team, read \`list_team_rules\` before writing.`,
    {},
    READ_ONLY,
    async () => {
      try {
        return json(await client.listTeams());
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.tool(
    'get_team',
    'Get one team: its members and their roles.',
    { team_token: TEAM_TOKEN },
    READ_ONLY,
    async ({ team_token }) => {
      try {
        return json(await client.getTeam(team_token));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.tool(
    'list_team_rules',
    `The team's coaching rules — its house style — each marked mandatory or advisory.

Read these BEFORE writing for a team book, not after a draft is rejected. Mandatory rules are not suggestions: prose that ignores one gets re-edited by a person, which is worse than not writing it.`,
    { team_token: TEAM_TOKEN },
    READ_ONLY,
    async ({ team_token }) => {
      try {
        return json(await client.listTeamRules(team_token));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.tool(
    'list_team_memories',
    `What the team has established over time: recurring characters, naming conventions, continuity spanning books, decisions already argued through.

Treat these as settled. If one contradicts a book's text, say so rather than picking a side.`,
    { team_token: TEAM_TOKEN },
    READ_ONLY,
    async ({ team_token }) => {
      try {
        return json(await client.listTeamMemories(team_token));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.tool(
    'list_team_skills',
    `The team's own writing procedures.

Some are marked \`confidential: true\` and come back WITHOUT a source path; their file contents are withheld from this connection. That is deliberate, and it does not stop the skill working — the server applies it on the team's behalf. Do not try to reconstruct one, reproduce it verbatim, or reach its contents by another route: those routes are closed and audited. Read the \`team-knowledge-base\` guide before working in a team knowledge base.`,
    { team_token: TEAM_TOKEN },
    READ_ONLY,
    async ({ team_token }) => {
      try {
        return json(await client.listTeamSkills(team_token));
      } catch (error) {
        return failure(error);
      }
    }
  );
}
