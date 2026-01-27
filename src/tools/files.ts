/**
 * MCP File Operations Tools
 *
 * Provides tools for AI to read, write, create, delete, and search files in books.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SlimaApiClient } from '../api/client.js';
import { formatErrorForMcp } from '../utils/errors.js';

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
    'Replace the entire content of an existing file (creates a new commit)',
    {
      book_token: z.string().describe('Book token (e.g., bk_abc123)'),
      path: z.string().describe('File path (e.g., "characters/protagonist.md")'),
      content: z.string().describe('New content to write'),
      commit_message: z.string().optional().describe('Commit message (optional, auto-generated if not provided)'),
    },
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

  // === create_file ===
  server.tool(
    'create_file',
    'Create a new file in a book (creates a new commit)',
    {
      book_token: z.string().describe('Book token (e.g., bk_abc123)'),
      path: z.string().describe('File path including parent folders (e.g., "characters/new-character.md")'),
      content: z.string().optional().describe('Initial content (optional, defaults to empty)'),
      commit_message: z.string().optional().describe('Commit message (optional, auto-generated if not provided)'),
    },
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
    'Delete a file from a book (creates a new commit)',
    {
      book_token: z.string().describe('Book token (e.g., bk_abc123)'),
      path: z.string().describe('File path to delete (e.g., "old-notes.md")'),
      commit_message: z.string().optional().describe('Commit message (optional, auto-generated if not provided)'),
    },
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
    'Append content to the end of an existing file (creates a new commit)',
    {
      book_token: z.string().describe('Book token (e.g., bk_abc123)'),
      path: z.string().describe('File path (e.g., "notes.md")'),
      content: z.string().describe('Content to append'),
      commit_message: z.string().optional().describe('Commit message (optional, auto-generated if not provided)'),
    },
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
    'Search for content across all files in a book',
    {
      book_token: z.string().describe('Book token (e.g., bk_abc123)'),
      query: z.string().describe('Search query (e.g., "blue eyes" or "protagonist name")'),
      file_types: z.array(z.string()).optional().describe('Filter by file types (e.g., ["markdown", "txt"])'),
      limit: z.number().optional().describe('Maximum number of matches to return (default: 20)'),
    },
    async ({ book_token, query, file_types, limit }) => {
      try {
        const result = await client.searchFiles(book_token, {
          query,
          fileTypes: file_types,
          limit,
        });

        if (result.matches.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No matches found for "${query}".`,
              },
            ],
          };
        }

        const output: string[] = [
          `# Search Results for "${query}"`,
          '',
          `Found ${result.matches.length} file(s) with matches:`,
          '',
        ];

        for (const match of result.matches) {
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
