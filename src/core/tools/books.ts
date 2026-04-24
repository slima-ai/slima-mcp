/**
 * Book Tools
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SlimaApiClient } from '../api/client.js';
import type { Book } from '../api/types.js';
import { formatErrorForMcp } from '../utils/errors.js';
import { buildFileTree, formatFileTree } from '../utils/file-tree.js';
import type { FlatFileSnapshot } from '../utils/file-tree.js';

// Shared Studio presentation helpers. Kept here because they're only useful
// for books.ts' markdown output formatting; other tools use bookType directly.
function studioLabel(book: Pick<Book, 'bookType'>): string {
  return book.bookType === 'script' ? '📝 Script Studio' : '📖 Writing Studio';
}

function scriptStudioWriteRulesBlock(book: Pick<Book, 'token'>): string {
  return `### 🔒 Write Restrictions (Script Studio)

This book uses **structured schemas**. Via MCP you can:
- ✅ **Read** any file (series.json, *.character, *.scene, etc.)
- ✅ **Write / Edit / Delete** under \`.script_studio/planning/**/*\` only (free-form reference tree)
- ❌ **Cannot modify** structured files (\`series.json\`, \`season.json\`, \`episode.json\`, \`*.character\`, \`*.location\`, \`*.scene\`, \`*.storyline\`, \`*.note\`)
- ❌ **Cannot modify** \`.script_studio/planning/.initialized\` (frontend bootstrap sentinel)

To add characters / scenes / storylines, use the Script Studio UI in the Slima app.

For full per-book details, read the MCP resource: \`slima://books/${book.token}/schema\`.`;
}

/**
 * Register book-related tools
 */
export function registerBookTools(
  server: McpServer,
  client: SlimaApiClient
): void {
  // === create_book ===
  server.tool(
    'create_book',
    `Create a new **Writing Studio** book in your Slima library.

Only Writing Studio (free-form novels / long-form prose) books can be created via MCP.
To create a **Script Studio** book (screenwriting with structured series/seasons/episodes/scenes),
please use the Slima app UI — MCP does not yet support Script Studio scaffolding.`,
    {
      title: z.string().describe('Book title (required)'),
      author_name: z.string().optional().describe('Author name (optional)'),
      description: z.string().optional().describe('Book description (optional)'),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async ({ title, author_name, description }) => {
      try {
        const book = await client.createBook({
          title,
          authorName: author_name,
          description,
        });

        return {
          content: [
            {
              type: 'text',
              text: `✅ Book created successfully!\n\n- **Title**: ${book.title}\n- **Token**: ${book.token}\n- **Author**: ${book.authorName || 'N/A'}\n\nYou can now add files using create_file with book_token: ${book.token}`,
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

  // === list_books ===
  server.tool(
    'list_books',
    'List all books in your Slima library',
    {},
    { readOnlyHint: true, openWorldHint: true },
    async () => {
      try {
        const books = await client.listBooks();

        if (books.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No books found in your library.',
              },
            ],
          };
        }

        const formatted = books
          .map((book) => {
            const words = book.totalWordCount?.toLocaleString() || '0';
            return `- **${book.title}** (${book.token}) — ${studioLabel(book)}\n  Author: ${book.authorName || 'N/A'} | Words: ${words}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${books.length} book(s):\n\n${formatted}\n\n_📝 Script Studio books have write restrictions via MCP (see \`get_book\` or resource \`slima://books/{token}/schema\`). 📖 Writing Studio books are fully writable._`,
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

  // === get_book ===
  server.tool(
    'get_book',
    'Get details of a specific book',
    {
      book_token: z.string().describe('Book token (e.g., bk_abc123)'),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ book_token }) => {
      try {
        const book = await client.getBook(book_token);

        const header = `# ${studioLabel(book)} — ${book.title}

- **Token**: ${book.token}
- **Author**: ${book.authorName || 'N/A'}
- **Description**: ${book.description || 'N/A'}
- **Language**: ${book.language || 'N/A'}
- **Total Words**: ${book.totalWordCount?.toLocaleString() || '0'}
- **Manuscript Words**: ${book.manuscriptWordCount?.toLocaleString() || '0'}
- **Reference Words**: ${book.referenceWordCount?.toLocaleString() || '0'}
- **Created**: ${book.createdAt}
- **Updated**: ${book.updatedAt}`;

        const text =
          book.bookType === 'script'
            ? `${header}\n\n${scriptStudioWriteRulesBlock(book)}`
            : header;

        return {
          content: [{ type: 'text', text }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatErrorForMcp(error) }],
          isError: true,
        };
      }
    }
  );

  // === get_book_structure ===
  server.tool(
    'get_book_structure',
    'Get the file/folder structure of a book',
    {
      book_token: z.string().describe('Book token'),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ book_token }) => {
      try {
        const [book, commits] = await Promise.all([
          client.getBook(book_token),
          client.listCommits(book_token, 1),
        ]);

        if (commits.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No commits found. The book may be empty.',
              },
            ],
          };
        }

        // API returns flat structure with parentToken, convert to nested for display
        const flatSnapshot = commits[0].filesSnapshot as unknown as FlatFileSnapshot[];
        const nestedTree = buildFileTree(flatSnapshot);
        const tree = formatFileTree(nestedTree);

        const footer =
          book.bookType === 'script'
            ? `\n\n_📝 This is a Script Studio book. Via MCP, writes are restricted to \`.script_studio/planning/**/*\`. For the full write-restriction spec, read resource \`slima://books/${book.token}/schema\`._`
            : '';

        return {
          content: [
            {
              type: 'text',
              text: `File structure for ${studioLabel(book)} — ${book.title} (${book_token}):\n\n${tree}${footer}`,
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

  // === get_writing_stats ===
  server.tool(
    'get_writing_stats',
    'Get writing statistics for a book',
    {
      book_token: z.string().describe('Book token'),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ book_token }) => {
      try {
        const [book, commits] = await Promise.all([
          client.getBook(book_token),
          client.listCommits(book_token, 10),
        ]);

        // Calculate recent progress
        let wordChange = 0;
        if (commits.length > 1) {
          const latest = commits[0].totalWordCount || 0;
          const oldest = commits[commits.length - 1].totalWordCount || 0;
          wordChange = latest - oldest;
        }

        const sign = wordChange >= 0 ? '+' : '';
        const progressText =
          commits.length > 1
            ? `${sign}${wordChange.toLocaleString()} words (last ${commits.length} commits)`
            : 'N/A (not enough history)';

        const text = `# Writing Stats: ${book.title}

- **Total Words**: ${book.totalWordCount?.toLocaleString() || '0'}
- **Manuscript Words**: ${book.manuscriptWordCount?.toLocaleString() || '0'}
- **Reference Words**: ${book.referenceWordCount?.toLocaleString() || '0'}
- **Recent Progress**: ${progressText}
- **Commits Analyzed**: ${commits.length}
- **Language**: ${book.language || 'N/A'}`;

        return {
          content: [{ type: 'text', text }],
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
