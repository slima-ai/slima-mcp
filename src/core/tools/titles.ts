/**
 * Display names for every tool, in one place.
 *
 * Why a table instead of a `title` next to each `server.tool(...)`: the SDK's
 * `server.tool()` has no `title` argument (only `registerTool` does), and the
 * annotation block is a different object in every file. One table is one place
 * to read all 39 names side by side, and `withToolTitles` makes a tool without
 * an entry fail at startup instead of reaching a directory review without a title.
 *
 * Why it matters: Anthropic's connector review rejects tools that lack a title
 * (claude.com/docs/connectors/building/review-criteria, "Provide tool
 * annotations", checked 2026-10-22). The title is set both as the top-level
 * `title` and as `annotations.title`, because clients read one or the other.
 *
 * Titles are English and written for the person approving the call, not for the
 * model: they are what appears in a permission prompt.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const TOOL_TITLES = {
  // Teaching
  get_capabilities: 'Get Slima Capabilities',
  list_guides: 'List Guides',
  load_guide: 'Load Guide',
  list_writing_skills: 'List Writing Skills',
  load_writing_skill: 'Load Writing Skill',
  // Books
  create_book: 'Create Book',
  list_books: 'List Books',
  get_book: 'Get Book Details',
  get_book_structure: 'Get Book Structure',
  get_writing_stats: 'Get Writing Stats',
  // Teams
  list_teams: 'List Teams',
  get_team: 'Get Team Details',
  list_team_rules: 'List Team Rules',
  list_team_memories: 'List Team Memories',
  list_team_skills: 'List Team Skills',
  // Notes, comments, search by meaning
  list_notes: 'List Notes',
  create_note: 'Create Note',
  semantic_search: 'Search Book by Meaning',
  list_comments: 'List Comments',
  create_comment: 'Create Comment',
  resolve_comment: 'Resolve Comment',
  reopen_comment: 'Reopen Comment',
  // Chapters
  get_chapter: 'Get Chapter',
  // AI Beta Reader
  list_personas: 'List Reader Personas',
  analyze_chapter: 'Run Beta Reader on Chapter',
  get_reader_test: 'Get Beta Reader Report',
  // Files
  read_file: 'Read File',
  write_file: 'Replace File Content',
  edit_file: 'Edit File',
  create_file: 'Create File',
  delete_file: 'Delete File',
  append_to_file: 'Append to File',
  view_relationship_map: 'View Relationship Map',
  search_content: 'Search Book Text',
  // Structured file types (field-level writes)
  update_beat_board: 'Update Beat Board',
  update_timeline: 'Update Timeline',
  update_script: 'Update Script',
  update_relationship_map: 'Update Relationship Map',
  update_world_map: 'Update World Map',
} as const satisfies Record<string, string>;

type Annotations = Record<string, unknown>;

/**
 * Make `server.tool(...)` stamp each tool with its title from TOOL_TITLES.
 *
 * Every tool in this repo is registered as (name, description, schema,
 * annotations, handler). An unlisted name, or a registration without an
 * annotation block, throws: a tool that reaches the directory without a title
 * or a readOnlyHint is the failure this exists to prevent.
 *
 * Call before any `register*Tools`, on the server instance.
 */
export function withToolTitles(server: McpServer): McpServer {
  const register = server.tool.bind(server) as (...args: unknown[]) => { update(u: { title: string }): void };

  (server as unknown as { tool: (...args: unknown[]) => unknown }).tool = (...args: unknown[]) => {
    const name = args[0] as string;
    const title = (TOOL_TITLES as Record<string, string>)[name];
    if (!title) throw new Error(`Tool "${name}" has no entry in TOOL_TITLES (src/core/tools/titles.ts)`);

    const annotationsAt = args.length - 2; // (…, annotations, handler)
    const annotations = args[annotationsAt] as Annotations | undefined;
    if (annotations === null || typeof annotations !== 'object' || typeof annotations.readOnlyHint !== 'boolean') {
      throw new Error(`Tool "${name}" must be registered with annotations that state readOnlyHint`);
    }

    const withTitle = [...args];
    withTitle[annotationsAt] = { ...annotations, title };
    const registered = register(...withTitle);
    registered.update({ title });
    return registered;
  };

  return server;
}
