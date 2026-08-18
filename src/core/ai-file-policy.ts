/**
 * The AI file-type policy, as ONE list.
 *
 * Ultimate source of truth is slima_vue `src/services/fileTypeRegistry.ts`
 * (`aiPolicy`), mirrored server-side in Rails
 * `Conversations::SystemPromptBuilder::AI_FILE_POLICY`. This file is the third
 * mirror, and it exists as data rather than prose specifically because CLAUDE.md
 * Gotcha #17 records what happens otherwise: `.map` was AI-readonly from day one,
 * but the policy was restated in three separate places and one of them said
 * "write: Yes" for months, so users burned credits on writes that could never
 * land. Two copies inside THIS repo — the tool-description warning and the
 * per-book schema resource — had already started down that road.
 */

/** Generic write / edit / create / delete are allowed. */
export const AI_WRITABLE_EXTENSIONS = ['.md', '.markdown', '.txt'] as const;

/**
 * Generic write tools are blocked. `.geomap` is `structured` in the frontend
 * registry (writable only through its own field-level tools) — MCP has no such
 * tools, so here it is effectively read-only, and saying "read-only" is the
 * honest thing to tell an agent that has no other way in.
 */
export const AI_READONLY_EXTENSIONS = [
  '.map',
  '.geomap',
  '.script',
  '.timeline',
  '.character',
  '.location',
  '.json',
  '.yaml',
  '.yml',
] as const;

/** Tools that CAN read a structured type usefully, keyed by extension. */
export const AI_STRUCTURED_VIEWERS: Record<string, string> = {
  '.map': 'view_relationship_map — renders the graph as an image plus a cast/relationship summary',
};
