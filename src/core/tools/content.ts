/**
 * Content Access Tools
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SlimaApiClient } from '../api/client.js';
import { formatErrorForMcp } from '../utils/errors.js';
import type { FileSnapshot } from '../api/types.js';

/**
 * Register content access tools
 */
export function registerContentTools(
  server: McpServer,
  client: SlimaApiClient
): void {
  // === get_chapter ===
  server.tool(
    'get_chapter',
    'Read the content of a chapter or file from a book',
    {
      book_token: z.string().describe('Book token (e.g., bk_abc123)'),
      file_path: z.string().describe('File path (e.g., /chapters/01.md or chapter-01)'),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ book_token, file_path }) => {
      try {
        // 1. Get latest commit
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

        // 2. Find file in snapshot
        const file = findFileInSnapshot(commits[0].filesSnapshot, file_path);

        if (!file) {
          // List available files
          const availableFiles = listAllFiles(commits[0].filesSnapshot);
          const fileList = availableFiles.slice(0, 10).join('\n- ');
          const moreText =
            availableFiles.length > 10
              ? `\n... and ${availableFiles.length - 10} more files`
              : '';

          return {
            content: [
              {
                type: 'text',
                text: `File not found: ${file_path}\n\nAvailable files:\n- ${fileList}${moreText}\n\nTip: Use get_book_structure to see the full file tree.`,
              },
            ],
            isError: true,
          };
        }

        if (file.kind === 'folder') {
          return {
            content: [
              {
                type: 'text',
                text: `"${file_path}" is a folder, not a file. Please specify a file path.`,
              },
            ],
            isError: true,
          };
        }

        if (!file.blobHash) {
          return {
            content: [
              {
                type: 'text',
                text: `File "${file_path}" has no content (empty file).`,
              },
            ],
          };
        }

        // 3. Download blob content
        const blobs = await client.downloadBlobs(book_token, [file.blobHash]);

        if (blobs.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'Could not retrieve file content. The blob may be missing.',
              },
            ],
            isError: true,
          };
        }

        const content = blobs[0].content;
        const wordInfo = file.wordCount ? ` (${file.wordCount} words)` : '';

        return {
          content: [
            {
              type: 'text',
              text: `# ${file.name}${wordInfo}\n\n${content}`,
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
}

/**
 * Find file in snapshot
 * Supports multiple path formats:
 * - Full path: /chapters/01.md
 * - Relative path: chapters/01.md
 * - Filename: 01.md
 * - Token: chapter-01
 */
function findFileInSnapshot(
  files: FileSnapshot[],
  path: string
): FileSnapshot | null {
  // Normalize path
  const normalizedPath = path.replace(/^\//, '').toLowerCase();
  const pathParts = normalizedPath.split('/');

  // Recursive search
  function search(
    items: FileSnapshot[],
    remainingParts: string[]
  ): FileSnapshot | null {
    for (const item of items) {
      const itemNameLower = item.name.toLowerCase();
      const itemTokenLower = item.token.toLowerCase();

      // Full path match
      if (remainingParts.length === 1) {
        const target = remainingParts[0];
        if (
          itemNameLower === target ||
          itemTokenLower === target ||
          itemNameLower.replace(/\.[^.]+$/, '') === target.replace(/\.[^.]+$/, '')
        ) {
          return item;
        }
      }

      // Folder match, continue searching
      if (item.kind === 'folder' && item.children) {
        if (
          itemNameLower === remainingParts[0] ||
          itemTokenLower === remainingParts[0]
        ) {
          const result = search(item.children, remainingParts.slice(1));
          if (result) return result;
        }

        // Also try searching in subfolders directly
        const result = search(item.children, remainingParts);
        if (result) return result;
      }
    }

    return null;
  }

  // Try full path first
  let result = search(files, pathParts);
  if (result) return result;

  // Then try searching by filename only
  result = searchByName(files, pathParts[pathParts.length - 1]);
  return result;
}

/**
 * Search by filename only
 */
function searchByName(
  files: FileSnapshot[],
  name: string
): FileSnapshot | null {
  const nameLower = name.toLowerCase();

  for (const item of files) {
    const itemNameLower = item.name.toLowerCase();
    const itemTokenLower = item.token.toLowerCase();

    if (
      itemNameLower === nameLower ||
      itemTokenLower === nameLower ||
      itemNameLower.replace(/\.[^.]+$/, '') === nameLower.replace(/\.[^.]+$/, '')
    ) {
      return item;
    }

    if (item.kind === 'folder' && item.children) {
      const result = searchByName(item.children, name);
      if (result) return result;
    }
  }

  return null;
}

/**
 * List all file paths
 */
function listAllFiles(files: FileSnapshot[], prefix = ''): string[] {
  const result: string[] = [];

  for (const item of files) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;

    if (item.kind === 'file') {
      result.push(path);
    } else if (item.children) {
      result.push(...listAllFiles(item.children, path));
    }
  }

  return result;
}
