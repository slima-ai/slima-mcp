/**
 * MCP File Operations Tools
 *
 * Provides tools for AI to read, write, create, delete, and search files in books.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SlimaApiClient } from '../api/client.js';
import { formatErrorForMcp } from '../utils/errors.js';

// Studio-aware write rules shown on every write tool description + path param.
// Rails (`Mcp::FileOperationService#validate_studio_write_path!`) enforces this
// as the ground truth; duplicating it here lets the AI plan correctly instead
// of bouncing off HTTP 400 INVALID_PATH.
const SCRIPT_STUDIO_WRITE_WARNING = `
**IMPORTANT — Script Studio books (\`book_type: "script"\`):**
Writes are restricted to \`.script_studio/planning/**/*\` only.
Structured files (\`series.json\`, \`*.character\`, \`*.scene\`, \`*.storyline\`, \`*.note\`, \`*.location\`, \`season.json\`, \`episode.json\`) are READ-ONLY via MCP — structural edits must go through the Script Studio UI.
The sentinel file \`.script_studio/planning/.initialized\` is also read-only (frontend bootstrap marker).
Attempting to write outside \`planning/\` returns HTTP 400 with code \`INVALID_PATH\`.
For per-book details, read resource \`slima://books/{book_token}/schema\`.

For Writing Studio books (\`book_type: "book"\`), all paths remain writable.
Always check \`book_type\` via \`list_books\` or \`get_book\` before writing to an unfamiliar book.`;

const PATH_PARAM_HINT =
  'File path relative to book root. ' +
  'For Script Studio books: MUST be under ".script_studio/planning/" (e.g., ".script_studio/planning/references/outline.md"). ' +
  'For Writing Studio books: any path (e.g., "characters/protagonist.md").';

// Structured file extensions owned by Script Studio. Read access still works;
// search_content filters them by default (override with include_structured: true).
const SCRIPT_STRUCTURED_EXTENSIONS = ['character', 'scene', 'storyline', 'note', 'location'];

/**
 * Register file operation tools
 */
export function registerFileTools(
  server: McpServer,
  client: SlimaApiClient
): void {
  // === read_file ===
  server.tool(
    'read_file',
    'Read the content of any file in a book by its path',
    {
      book_token: z.string().describe('Book token (e.g., bk_abc123)'),
      path: z.string().describe('File path (e.g., "characters/protagonist.md" or "chapter-01.md")'),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ book_token, path }) => {
      try {
        const result = await client.readFile(book_token, path);

        const fileInfo = [
          `# ${result.file.name}`,
          '',
          `**Path:** ${result.file.path}`,
          `**Words:** ${result.file.wordCount}`,
          `**Type:** ${result.file.fileType || 'unknown'}`,
          '',
          '---',
          '',
          result.content || '(empty file)',
        ].join('\n');

        return {
          content: [{ type: 'text', text: fileInfo }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatErrorForMcp(error) }],
          isError: true,
        };
      }
    }
  );

  // === write_file ===
  server.tool(
    'write_file',
    `Replace the entire content of an existing file (creates a new commit).
${SCRIPT_STUDIO_WRITE_WARNING}`,
    {
      book_token: z.string().describe('Book token (e.g., bk_abc123)'),
      path: z.string().describe(PATH_PARAM_HINT),
      content: z.string().describe('New content to write'),
      commit_message: z.string().optional().describe('Commit message (optional, auto-generated if not provided)'),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    async ({ book_token, path, content, commit_message }) => {
      try {
        const result = await client.updateFile(book_token, {
          path,
          content,
          commitMessage: commit_message,
        });

        return {
          content: [
            {
              type: 'text',
              text: `File updated successfully.\n\nCommit: ${result.commit.token}\nMessage: ${result.commit.name || result.commit.message}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatErrorForMcp(error) }],
          isError: true,
        };
      }
    }
  );

  // === edit_file ===
  server.tool(
    'edit_file',
    `Edit a file by replacing a specific text segment (search and replace). Use this for precise edits instead of rewriting the entire file.
${SCRIPT_STUDIO_WRITE_WARNING}`,
    {
      book_token: z.string().describe('Book token (e.g., bk_abc123)'),
      path: z.string().describe(PATH_PARAM_HINT),
      old_string: z.string().describe('The exact text to find and replace (must match exactly, including whitespace)'),
      new_string: z.string().describe('The new text to replace it with'),
      replace_all: z.boolean().optional().describe('Replace all occurrences (default: false, replaces only first match)'),
      commit_message: z.string().optional().describe('Commit message (optional, auto-generated if not provided)'),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    async ({ book_token, path, old_string, new_string, replace_all, commit_message }) => {
      try {
        // 1. Read current content
        const fileData = await client.readFile(book_token, path);
        const currentContent = fileData.content || '';

        // 2. Check if old_string exists
        if (!currentContent.includes(old_string)) {
          return {
            content: [
              {
                type: 'text',
                text: `❌ Edit failed: Could not find the specified text in the file.\n\n**Looking for:**\n\`\`\`\n${old_string.slice(0, 200)}${old_string.length > 200 ? '...' : ''}\n\`\`\`\n\n**Tip:** Make sure the text matches exactly, including whitespace and line breaks.`,
              },
            ],
            isError: true,
          };
        }

        // 3. Check for uniqueness (if not replace_all)
        if (!replace_all) {
          const occurrences = currentContent.split(old_string).length - 1;
          if (occurrences > 1) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ Edit failed: Found ${occurrences} occurrences of the text. Please provide a more specific/longer text segment to ensure a unique match, or set replace_all: true to replace all occurrences.`,
                },
              ],
              isError: true,
            };
          }
        }

        // 4. Perform replacement
        const newContent = replace_all
          ? currentContent.split(old_string).join(new_string)
          : currentContent.replace(old_string, new_string);

        // 5. Write back
        const result = await client.updateFile(book_token, {
          path,
          content: newContent,
          commitMessage: commit_message || `Edit ${path}`,
        });

        const replacementCount = replace_all
          ? currentContent.split(old_string).length - 1
          : 1;

        return {
          content: [
            {
              type: 'text',
              text: `✅ File edited successfully.\n\n**Replacements:** ${replacementCount}\n**Commit:** ${result.commit.token}\n**Message:** ${result.commit.name || result.commit.message}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatErrorForMcp(error) }],
          isError: true,
        };
      }
    }
  );

  // === create_file ===
  server.tool(
    'create_file',
    `Create a new file in a book (creates a new commit).
${SCRIPT_STUDIO_WRITE_WARNING}`,
    {
      book_token: z.string().describe('Book token (e.g., bk_abc123)'),
      path: z.string().describe(
        `${PATH_PARAM_HINT} Parent folders are auto-created (mkdir -p behavior).`
      ),
      content: z.string().optional().describe('Initial content (optional, defaults to empty)'),
      commit_message: z.string().optional().describe('Commit message (optional, auto-generated if not provided)'),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async ({ book_token, path, content, commit_message }) => {
      try {
        const result = await client.createFile(book_token, {
          path,
          content: content || '',
          commitMessage: commit_message,
        });

        return {
          content: [
            {
              type: 'text',
              text: `File created successfully.\n\nFile Token: ${result.fileToken}\nCommit: ${result.commit.token}\nMessage: ${result.commit.name || result.commit.message}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatErrorForMcp(error) }],
          isError: true,
        };
      }
    }
  );

  // === delete_file ===
  server.tool(
    'delete_file',
    `Delete a file from a book (creates a new commit).
${SCRIPT_STUDIO_WRITE_WARNING}`,
    {
      book_token: z.string().describe('Book token (e.g., bk_abc123)'),
      path: z.string().describe(PATH_PARAM_HINT),
      commit_message: z.string().optional().describe('Commit message (optional, auto-generated if not provided)'),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    async ({ book_token, path, commit_message }) => {
      try {
        const result = await client.deleteFile(book_token, {
          path,
          commitMessage: commit_message,
        });

        return {
          content: [
            {
              type: 'text',
              text: `File deleted successfully.\n\nCommit: ${result.commit.token}\nMessage: ${result.commit.name || result.commit.message}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatErrorForMcp(error) }],
          isError: true,
        };
      }
    }
  );

  // === append_to_file ===
  server.tool(
    'append_to_file',
    `Append content to the end of an existing file (creates a new commit).
${SCRIPT_STUDIO_WRITE_WARNING}`,
    {
      book_token: z.string().describe('Book token (e.g., bk_abc123)'),
      path: z.string().describe(PATH_PARAM_HINT),
      content: z.string().describe('Content to append'),
      commit_message: z.string().optional().describe('Commit message (optional, auto-generated if not provided)'),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async ({ book_token, path, content, commit_message }) => {
      try {
        const result = await client.appendToFile(book_token, {
          path,
          content,
          commitMessage: commit_message,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Content appended successfully.\n\nCommit: ${result.commit.token}\nMessage: ${result.commit.name || result.commit.message}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatErrorForMcp(error) }],
          isError: true,
        };
      }
    }
  );

  // === search_content ===
  server.tool(
    'search_content',
    `Search for content across all files in a book.

**Script Studio behavior:** By default, structured files (\`*.character\`, \`*.scene\`, \`*.storyline\`, \`*.note\`, \`*.location\`, and \`*.json\` under \`.script_studio/\`) are **excluded** from search results — their raw JSON is noisy and not useful for full-text search.
Pass \`include_structured: true\` to search those files too.
Writing Studio books are unaffected by this filter.`,
    {
      book_token: z.string().describe('Book token (e.g., bk_abc123)'),
      query: z.string().describe('Search query (e.g., "blue eyes" or "protagonist name")'),
      file_types: z.array(z.string()).optional().describe('Filter by file types (e.g., ["markdown", "txt"])'),
      limit: z.number().optional().describe('Maximum number of matches to return (default: 20)'),
      include_structured: z
        .boolean()
        .optional()
        .describe(
          'Script Studio only: set to true to include structured files (*.character / *.scene / etc.) in search results. Default: false (excluded).'
        ),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ book_token, query, file_types, limit, include_structured }) => {
      try {
        // Only fetch the book when we actually need to decide about filtering.
        // For Writing Studio books the extra round-trip is wasted work.
        let bookType: string | undefined;
        if (!include_structured) {
          try {
            const book = await client.getBook(book_token);
            bookType = book.bookType;
          } catch {
            // If we can't load the book (eg. network hiccup), fall through without filtering.
            // The downstream search call will surface any real permission / not-found errors.
          }
        }

        const result = await client.searchFiles(book_token, {
          query,
          fileTypes: file_types,
          limit,
        });

        const shouldFilter = !include_structured && bookType === 'script';
        const filteredMatches = shouldFilter
          ? result.matches.filter((m) => !isStructuredScriptFile(m.file.path))
          : result.matches;

        if (filteredMatches.length === 0) {
          const suffix =
            shouldFilter && result.matches.length > 0
              ? ` (${result.matches.length} match(es) in structured files were excluded — pass include_structured: true to see them)`
              : '';
          return {
            content: [
              {
                type: 'text',
                text: `No matches found for "${query}"${suffix}.`,
              },
            ],
          };
        }

        const output: string[] = [
          `# Search Results for "${query}"`,
          '',
          `Found ${filteredMatches.length} file(s) with matches:`,
          '',
        ];

        if (shouldFilter && filteredMatches.length < result.matches.length) {
          const excluded = result.matches.length - filteredMatches.length;
          output.push(
            `_Note: excluded ${excluded} Script Studio structured file(s). Pass include_structured: true to include them._`
          );
          output.push('');
        }

        for (const match of filteredMatches) {
          output.push(`## ${match.file.path}`);
          output.push(`Words: ${match.file.wordCount} | Matches: ${match.matchCount}`);
          output.push('');

          for (const snippet of match.snippets) {
            output.push(`> ${snippet.text}`);
            output.push('');
          }
        }

        return {
          content: [{ type: 'text', text: output.join('\n') }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatErrorForMcp(error) }],
          isError: true,
        };
      }
    }
  );
}

// Internal: path-based Script Studio structured file check.
// Matches files with structured extensions OR any .json under .script_studio/.
function isStructuredScriptFile(path: string): boolean {
  if (!path) return false;
  const lower = path.toLowerCase();
  if (lower.startsWith('.script_studio/') && lower.endsWith('.json')) return true;
  const ext = lower.split('.').pop();
  if (!ext) return false;
  return SCRIPT_STRUCTURED_EXTENSIONS.includes(ext);
}
