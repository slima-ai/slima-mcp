/**
 * Read one file through Rails' audited `mcp/files/read`, accepting the loose forms an
 * agent actually types (exact path, bare filename, file token, name without extension).
 *
 * Shared by `get_chapter` and `analyze_chapter` so neither re-implements reading:
 * the old `analyze_chapter` walked commits and downloaded the blob by hash, which skipped
 * the confidential-skill audit trail and daily read budget, never saw
 * `contentWithheld` / `throttled`, and needed `blobs/download` — an endpoint nothing else
 * used and that an `mcp:books` token should not have to reach.
 */

import type { SlimaApiClient } from '../api/client.js';
import { NotFoundError } from '../utils/errors.js';
import type { FileSnapshot, McpFileReadResponse } from '../api/types.js';

export type ResolvedRead =
  | { kind: 'read'; result: McpFileReadResponse }
  | { kind: 'not_found'; availablePaths: string[] };

/**
 * Exact path first. Only when Rails says "not found" does it look at the file tree
 * (one `listCommits`) to resolve a loose reference, and the resolved path is then read
 * through the same audited endpoint — resolution decides *which* file, it never becomes
 * a second way to read one. Any other error propagates unchanged.
 */
export async function readFileResolving(
  client: SlimaApiClient,
  bookToken: string,
  path: string
): Promise<ResolvedRead> {
  const normalized = path.replace(/^\//, '');

  try {
    return { kind: 'read', result: await client.readFile(bookToken, normalized) };
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
    // Fall through: the path may have been a bare filename.
  }

  const { resolvedPath, availablePaths } = await resolveFromStructure(client, bookToken, normalized);
  if (!resolvedPath) return { kind: 'not_found', availablePaths };

  return { kind: 'read', result: await client.readFile(bookToken, resolvedPath) };
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
export async function resolveFromStructure(
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



