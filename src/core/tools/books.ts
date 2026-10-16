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
  if (book.bookType === 'script') return '📝 Script Studio';
  // A team's shared knowledge base used to fall through to "Writing Studio",
  // which hid both that it is team-owned and that some of its files may be
  // present-but-withheld.
  if (book.bookType === 'knowledge') return '📚 Team Knowledge Base';
  return '📖 Writing Studio';
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
    'List the books in your Slima library. Results are paginated; if the response says more books exist, call again with the next `page` before concluding a book is not there.',
    {
      page: z.number().optional().describe('Page number (default 1). Only needed when the response says more books exist.'),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ page }) => {
      try {
        const { books, meta } = await client.listBooks({ page });

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
            // The book itself — what counts toward the author's word count.
            const words = book.manuscriptWordCount?.toLocaleString() || '0';
            return `- **${book.title}** (${book.token}) — ${studioLabel(book)}\n  Author: ${book.authorName || 'N/A'} | Words: ${words}`;
          })
          .join('\n\n');

        // Never present a page as the whole library (CLAUDE.md Gotcha #12: a
        // silent truncation reads as "that book does not exist"). Rails caps an
        // un-paginated /books at 100 and reports the real total in meta.
        //
        // "Are there more?" is meta.page < meta.totalPages — NOT total >
        // books.length. The latter is also true on the LAST page (37 of 137),
        // where it sent the AI to fetch a page 3 that does not exist.
        const currentPage = meta.page ?? 1;
        const totalPages = meta.totalPages;
        const hasMore = totalPages !== undefined && currentPage < totalPages;
        const header = hasMore
          ? `Showing ${books.length} of ${meta.total} book(s) — page ${currentPage} of ${totalPages}. Call list_books again with \`page: ${currentPage + 1}\` for the rest.`
          : meta.total !== undefined && meta.total > books.length
            ? `Showing ${books.length} of ${meta.total} book(s) — page ${currentPage} of ${totalPages ?? '?'} (this is the last page).`
            : `Found ${books.length} book(s):`;

        return {
          content: [
            {
              type: 'text',
              text: `${header}\n\n${formatted}\n\n_📝 Script Studio books have write restrictions via MCP (see \`get_book\` or resource \`slima://books/{token}/schema\`). 📖 Writing Studio books are fully writable._`,
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
- **Total Words**: ${book.wordCount?.toLocaleString() || '0'}
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
    `Get word-count totals for a book.

Reports the book's authoritative totals only. Do NOT compute "progress", "words
written today", or a writing streak from commit history — Slima prunes intra-day
commits after 30 days, so any delta derived from "the last N commits" silently
changes span over time and will not match what the author sees in the app. Those
figures are account-level and are not exposed here.`,
    {
      book_token: z.string().describe('Book token'),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ book_token }) => {
      try {
        const book = await client.getBook(book_token);

        const text = `# Writing Stats: ${book.title}

- **Total Words**: ${book.wordCount?.toLocaleString() || '0'}
- **Manuscript Words**: ${book.manuscriptWordCount?.toLocaleString() || '0'} (the book itself — what counts toward the author's word count)
- **Reference Words**: ${book.referenceWordCount?.toLocaleString() || '0'} (notes, worldbuilding — never counted)
- **Language**: ${book.language || 'N/A'}
- **Last updated**: ${book.updatedAt}

_Daily word count, writing streak and rest protection are account-level in Slima and are not available through this tool. Do not estimate them from commit history — the figure would not match the author's._`;

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
