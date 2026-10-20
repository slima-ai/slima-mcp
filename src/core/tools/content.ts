/**
 * Content Access Tools
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SlimaApiClient } from '../api/client.js';
import { formatErrorForMcp, NotFoundError } from '../utils/errors.js';
import { renderFileRead } from './file-read-rendering.js';
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
    'Read a chapter or file from a book. Accepts a full path, or just a filename if you are not sure of the folder. If you already know the exact path, `read_file` is equivalent and more direct.',
    {
      book_token: z.string().describe('Book token (e.g., bk_abc123)'),
      file_path: z.string().describe('File path (e.g., /chapters/01.md) or just a filename (e.g., 01.md)'),
    },
    { readOnlyHint: true, openWorldHint: false },
    async ({ book_token, file_path }) => {
      const normalized = file_path.replace(/^\//, '');

      try {
        // Straight through Rails' audited read. This tool used to reimplement
        // reading — list commits, scan the snapshot, download the blob by hash —
        // which skipped the team-skill audit trail and daily read budget
        // entirely, never saw contentWithheld/throttled, and needed two
        // endpoints a narrowly-scoped mcp:books token cannot reach.
        const result = await client.readFile(book_token, normalized);
        return { content: [{ type: 'text', text: renderFileRead(result) }] };
      } catch (error) {
        if (!(error instanceof NotFoundError)) {
          return {
            content: [{ type: 'text', text: formatErrorForMcp(error) }],
            isError: true,
          };
        }
        // Fall through: the path may have been a bare filename.
      }

      try {
        // One listCommits for both the resolution AND the not-found hint: the
        // hint used to re-fetch the identical snapshot, doubling the cost of the
        // exact case (a miss) that is already the slow path.
        const { resolvedPath, availablePaths } = await resolveFromStructure(client, book_token, normalized);

        if (!resolvedPath) {
          const available = availablePaths;
          const hint = available.length
            ? `\n\nAvailable files:\n- ${available.slice(0, 10).join('\n- ')}${available.length > 10 ? `\n... and ${available.length - 10} more` : ''}`
            : '';
          return {
            content: [
              {
                type: 'text',
                text: `File not found: ${file_path}${hint}\n\nTip: use get_book_structure to see the full file tree.`,
              },
            ],
            isError: true,
          };
        }

        // Read the RESOLVED path through the same audited endpoint — resolution
        // decides *which* file, it never becomes a second way to read one.
        const result = await client.readFile(book_token, resolvedPath);
        return { content: [{ type: 'text', text: renderFileRead(result) }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatErrorForMcp(error) }],
          isError: true,
        };
      }
    }
  );
}

/** Full path of a snapshot entry, walking parentToken up to the root. */
function fullPathOf(entry: FileSnapshot, byToken: Map<string, FileSnapshot>): string {
  const parts = [entry.name];
  let current: FileSnapshot | undefined = entry;
  let depth = 0;

  while (current) {
    const parentToken = (current as unknown as { parentToken?: string }).parentToken;
    if (!parentToken) break;
    const parent: FileSnapshot | undefined = byToken.get(parentToken);
    if (!parent || depth++ > byToken.size) break;
    parts.unshift(parent.name);
    current = parent;
  }

  return parts.join('/');
}

function flatten(files: FileSnapshot[]): FileSnapshot[] {
  // Snapshots are flat (parentToken) in current data, but older ones nested
  // children — handle both rather than silently seeing half the tree.
  return files.flatMap((f) => [f, ...(f.children ? flatten(f.children) : [])]);
}

/**
 * Resolve a loose reference (bare filename, partial path, case-insensitive) to
 * one real path, AND return every available path for the not-found hint — both
 * from a single snapshot fetch.
 */
async function resolveFromStructure(
  client: SlimaApiClient,
  bookToken: string,
  needle: string
): Promise<{ resolvedPath: string | null; availablePaths: string[] }> {
  const commits = await client.listCommits(bookToken, 1);
  if (commits.length === 0) return { resolvedPath: null, availablePaths: [] };

  const entries = flatten((commits[0].filesSnapshot ?? []) as FileSnapshot[]);
  const byToken = new Map(entries.map((e) => [e.token, e]));
  const wanted = needle.toLowerCase();

  const stripExt = (value: string) => value.replace(/\.[^./]+$/, '');
  const candidates = entries.filter((e) => e.kind !== 'folder');

  // Same set of loose forms the previous implementation accepted (exact path,
  // bare name, file token, name without extension) — narrowing it here would be
  // a silent capability regression for anyone whose prompts rely on it.
  const match =
    candidates.find((e) => fullPathOf(e, byToken).toLowerCase() === wanted) ??
    candidates.find((e) => e.name.toLowerCase() === wanted) ??
    candidates.find((e) => e.token.toLowerCase() === wanted) ??
    candidates.find((e) => fullPathOf(e, byToken).toLowerCase().endsWith(`/${wanted}`)) ??
    candidates.find((e) => stripExt(e.name.toLowerCase()) === stripExt(wanted));

  return {
    resolvedPath: match ? fullPathOf(match, byToken) : null,
    availablePaths: candidates.map((e) => fullPathOf(e, byToken)),
  };
}



