/**
 * Server-level MCP `instructions` — injected into the `initialize` response
 * so AI clients (Claude Desktop, claude.ai, ChatGPT) see this at session
 * start before any tool call.
 *
 * Keep this SHORT. Per-book details belong in the `slima://books/{token}/schema`
 * Resource; per-tool rules belong in tool descriptions. This text is the
 * "welcome & map" that points at the right next step.
 */

export const SERVER_INSTRUCTIONS = `Slima is an AI writing IDE with two product lines, distinguished by the \`book_type\` field on every book:

1. **Writing Studio** (\`book_type: "book"\`) — free-form markdown file tree for novels and long-form prose. All paths are writable via MCP.

2. **Script Studio** (\`book_type: "script"\`) — structured schema for screenwriting with series / seasons / episodes / scenes / characters / locations / storylines / notes. Via MCP, only \`.script_studio/planning/**/*\` is writable; all structured files (series.json, *.character, *.scene, *.storyline, *.note, *.location, season.json, episode.json) and the \`.script_studio/planning/.initialized\` sentinel are READ-ONLY. Structural edits must happen through the Slima app UI.

**Before writing to a book you haven't inspected this session:** call \`list_books\` or \`get_book\` to see \`book_type\`. For per-book write rules, read the resource \`slima://books/{book_token}/schema\`.

Reads (\`read_file\`, \`search_content\`, \`get_book_structure\`) work the same way for both studio types — AI coaching, critique, and analysis are fully supported even on Script Studio books.`;
