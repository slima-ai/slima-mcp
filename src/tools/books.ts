/**
 * 書籍相關 Tools
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SlimaApiClient } from '../api/client.js';
import { formatErrorForMcp } from '../utils/errors.js';
import type { FileSnapshot } from '../api/types.js';

/**
 * 註冊書籍相關工具
 */
export function registerBookTools(
  server: McpServer,
  client: SlimaApiClient
): void {
  // === create_book ===
  server.tool(
    'create_book',
    'Create a new book in your Slima library',
    {
      title: z.string().describe('Book title (required)'),
      author_name: z.string().optional().describe('Author name (optional)'),
      description: z.string().optional().describe('Book description (optional)'),
    },
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
            return `- **${book.title}** (${book.token})\n  Author: ${book.authorName || 'N/A'} | Words: ${words}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${books.length} book(s):\n\n${formatted}`,
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
    async ({ book_token }) => {
      try {
        const book = await client.getBook(book_token);

        const text = `# ${book.title}

- **Token**: ${book.token}
- **Author**: ${book.authorName || 'N/A'}
- **Description**: ${book.description || 'N/A'}
- **Language**: ${book.language || 'N/A'}
- **Total Words**: ${book.totalWordCount?.toLocaleString() || '0'}
- **Manuscript Words**: ${book.manuscriptWordCount?.toLocaleString() || '0'}
- **Created**: ${book.createdAt}
- **Updated**: ${book.updatedAt}`;

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
    async ({ book_token }) => {
      try {
        const commits = await client.listCommits(book_token, 1);

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

        const snapshot = commits[0].filesSnapshot;
        const tree = formatFileTree(snapshot);

        return {
          content: [
            {
              type: 'text',
              text: `File structure for book ${book_token}:\n\n${tree}`,
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
    async ({ book_token }) => {
      try {
        const [book, commits] = await Promise.all([
          client.getBook(book_token),
          client.listCommits(book_token, 10),
        ]);

        // 計算最近的寫作進度
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

/**
 * 格式化檔案樹
 */
function formatFileTree(files: FileSnapshot[], indent = 0): string {
  return files
    .sort((a, b) => a.position - b.position)
    .map((f) => {
      const prefix = '  '.repeat(indent);
      const icon = f.kind === 'folder' ? '📁' : '📄';
      const words = f.kind === 'file' && f.wordCount ? ` (${f.wordCount} words)` : '';
      const manuscript = f.isManuscript ? ' [M]' : '';
      let line = `${prefix}${icon} ${f.name}${words}${manuscript}`;

      if (f.children && f.children.length > 0) {
        line += '\n' + formatFileTree(f.children, indent + 1);
      }

      return line;
    })
    .join('\n');
}
