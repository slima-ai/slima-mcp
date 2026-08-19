/**
 * Teaching tools.
 *
 * Slima's operating knowledge — how commits work, what a manuscript file is,
 * which file types an AI may write — is authored and served by Rails, not
 * carried in this package. Users pin versions of this client; the
 * `X-Slima-MCP-Upgrade-Hint` machinery exists because they do. Guidance shipped
 * here would go stale in the field, silently, and would keep telling an AI to do
 * things the server no longer supports.
 *
 * So these tools are deliberately thin: they fetch and hand over text. The
 * judgement about what to say lives with the system being described.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SlimaApiClient } from '../api/client.js';
import { formatErrorForMcp } from '../utils/errors.js';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

function text(body: string) {
  return { content: [{ type: 'text' as const, text: body }] };
}

function failure(error: unknown) {
  return { content: [{ type: 'text' as const, text: formatErrorForMcp(error) }], isError: true };
}

export function registerTeachingTools(server: McpServer, client: SlimaApiClient): void {
  // === get_capabilities ===
  server.tool(
    'get_capabilities',
    `What this Slima server supports: which file extensions an AI may write, the content types, the available tools, and the guide index.

Call this once at the start of a Slima session, before writing anything. Every field is derived from the contract the server actually enforces, so it cannot drift from real behaviour the way a written description can.`,
    {},
    READ_ONLY,
    async () => {
      try {
        return text(JSON.stringify(await client.getCapabilities(), null, 2));
      } catch (error) {
        return failure(error);
      }
    }
  );

  // === list_guides ===
  server.tool(
    'list_guides',
    `List the available Slima guides: titles and one-line summaries of when to load each.

Guides teach how to operate Slima — file structure, version control, team knowledge bases, the relationship-map format. Load one with \`load_guide\` when you are about to do the thing it covers.`,
    {},
    READ_ONLY,
    async () => {
      try {
        const result = await client.listGuides();
        const rows = result.guides.map((g) => `- **${g.slug}** — ${g.title}\n  ${g.summary}`);
        return text(`## Slima guides\n\n${rows.join('\n')}`);
      } catch (error) {
        return failure(error);
      }
    }
  );

  // === load_guide ===
  server.tool(
    'load_guide',
    `Load one Slima guide in full.

Read \`book-structure\` before creating files, \`version-control-basics\` before a large rewrite, \`team-knowledge-base\` when working in a publisher's team, \`beta-reader\` before spending the author's credits on a report. \`list_guides\` has the current set.`,
    {
      slug: z.string().describe('Guide slug, e.g. "book-structure" (from list_guides)'),
    },
    READ_ONLY,
    async ({ slug }) => {
      try {
        const guide = await client.loadGuide(slug);
        return text(`# ${guide.title}\n\n${guide.body}`);
      } catch (error) {
        // The server answers an unknown slug with the list of real ones, so the
        // error is itself usable — passing it through beats replacing it with
        // "not found".
        return failure(error);
      }
    }
  );

  // === list_writing_skills ===
  server.tool(
    'list_writing_skills',
    `List Slima's writing skills — the craft procedures the in-app coach follows for tasks like developing a character, revising a scene, or diagnosing pacing.

Use these when the task is about the WRITING. Use \`list_guides\` when the task is about operating Slima.`,
    {},
    READ_ONLY,
    async () => {
      try {
        const result = await client.listWritingSkills();
        const rows = result.skills.map((s) => `- **${s.key}** — ${s.name}: ${s.description}`);
        return text(`## Writing skills\n\n${rows.join('\n')}`);
      } catch (error) {
        return failure(error);
      }
    }
  );

  // === load_writing_skill ===
  server.tool(
    'load_writing_skill',
    `Load one writing skill in full — a step-by-step procedure plus the questions a coach would ask.

Follow it rather than summarising it at the author.`,
    {
      key: z.string().describe('Skill key, e.g. "character_develop" (from list_writing_skills)'),
    },
    READ_ONLY,
    async ({ key }) => {
      try {
        const skill = await client.loadWritingSkill(key);
        return text(`# ${skill.name}\n\n${skill.body}`);
      } catch (error) {
        return failure(error);
      }
    }
  );
}
