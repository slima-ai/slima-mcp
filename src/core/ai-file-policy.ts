/**
 * What an AI may write, as ONE list.
 *
 * The authority is slima_vue `src/services/fileTypeRegistry.ts` (`aiPolicy`),
 * mirrored server-side in `db/contracts/file_type_registry.v1.json`. This file
 * is the third mirror, and it exists as data rather than prose specifically
 * because CLAUDE.md Gotcha #17 records what happens otherwise: `.map` was
 * AI-readonly from day one, the policy was restated in three separate places,
 * and one of them said "write: Yes" for months — so users burned credits on
 * writes that could never land.
 *
 * ## It has already drifted once, in both directions at the same time
 *
 * As of 2026-08-25 this file still listed `.map` as read-only (it became
 * writable on 2026-08-22) and did not mention `.beats` at all. So it was
 * simultaneously hiding a capability the author had paid for AND failing to
 * warn about one that could corrupt a file. A comment saying "keep this in
 * sync" does not keep anything in sync.
 *
 * ## The real fix, not done yet
 *
 * `GET /api/v1/mcp/capabilities` already returns this table, derived from the
 * contract Rails enforces. This file should be a build-time artifact of that
 * endpoint with CI failing when the committed copy differs. Until then, the
 * only honest thing this file can do is say as little as possible and point at
 * the tools that DO work — and `get_capabilities` remains the authority a model
 * should consult, which is why the server instructions tell it to call that first.
 */

/** Generic write / edit / create / delete are allowed. */
export const AI_WRITABLE_EXTENSIONS = ['.md', '.markdown', '.txt'] as const;

/**
 * Structured types with field-level MCP tools — the generic write tools are
 * refused, and the tool named here is the only way in.
 *
 * These are NOT read-only: saying so would hide a capability (the failure this
 * file's header describes, in the direction that costs the author money).
 */
export const AI_STRUCTURED_TOOLS: Record<string, string> = {
  '.beats': 'update_beat_board',
  '.timeline': 'update_timeline',
  '.script': 'update_script',
};

/**
 * Structured types the server still takes as a WHOLE document.
 *
 * `.map` is writable (the author's ruling, 2026-08-22) but only whole-file:
 * `edit_file` and `append_to_file` are refused because a partial edit of JSON
 * breaks it. Send the complete document back, including every node id you read
 * — an omitted node is a deleted node, and the author sees a character vanish
 * with no error anywhere.
 */
export const AI_WHOLE_FILE_EXTENSIONS = ['.map'] as const;

/**
 * No write tool may touch these.
 *
 * `.geomap` is here because its terrain is machine-encoded (RLE+base64) and
 * hand-written JSON will not decode — that is a property of the format, not a
 * policy that might be relaxed. The rest are owned by Slima's own editors.
 */
export const AI_READONLY_EXTENSIONS = [
  '.geomap',
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

/**
 * The one paragraph the write tools carry. Deliberately short: it is paid for
 * on every request, including the conversations that never touch a file.
 */
export const AI_WRITE_POLICY_NOTE = `
**Not every file type takes a generic write.**
- Field-level tools only: ${Object.entries(AI_STRUCTURED_TOOLS)
  .map(([ext, tool]) => `\`${ext}\` → \`${tool}\``)
  .join(', ')}
- Whole document only (no \`edit_file\`, no \`append_to_file\`): ${AI_WHOLE_FILE_EXTENSIONS.map((e) => `\`${e}\``).join(', ')}
- Not writable at all: ${AI_READONLY_EXTENSIONS.map((e) => `\`${e}\``).join(', ')}

A refusal names the file type and what to do instead — it is information, not
an obstacle to route around. Call \`get_capabilities\` for the authoritative
table; this list ships with the client and can lag a deploy.`;
