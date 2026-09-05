/**
 * The AI file-type policy has to reach the MODEL, not just the server.
 *
 * ⚠️ 2026-09-06 — the premise of this file changed and the assertions with it.
 *
 * The old header said "Rails does not (yet) refuse a write to a `.map` /
 * `.geomap` / `.character`, so these descriptions are the only thing standing
 * between an external agent and a corrupted graph". **Rails enforces now**
 * (`Mcp::FileOperationService#validate_ai_writable!`), so the descriptions are
 * no longer the last line of defence — they are there to stop the model wasting
 * a call, and to stop it concluding a capability does not exist.
 *
 * The other thing that changed: structured types are no longer one bucket.
 * `.beats` / `.timeline` / `.script` have field-level MCP tools, `.map` takes a
 * whole document, `.geomap` really is read-only. The old test asserted all of
 * them appeared in a single `readonly` list — which is exactly how this client
 * came to describe `.map` as unwritable for weeks after it became writable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../../src/core/api/client.js';
import { registerFileTools } from '../../src/core/tools/files.js';
import { buildBookSchema } from '../../src/core/resources/book_schema.js';
import type { Book } from '../../src/core/api/types.js';

const WRITE_TOOLS = ['write_file', 'edit_file', 'create_file', 'delete_file', 'append_to_file'];
/** Genuinely unwritable by any tool — `.geomap`'s terrain is machine-encoded. */
const READONLY_EXTENSIONS = ['.geomap', '.character', '.location', '.json'];
/** Writable, but only through the named field-level tool. */
const FIELD_LEVEL = { '.beats': 'update_beat_board', '.timeline': 'update_timeline', '.script': 'update_script' };
/** Writable, but only as a complete document. */
const WHOLE_FILE_EXTENSIONS = ['.map'];

describe('AI file-type policy is visible to the model', () => {
  let descriptions: Map<string, string>;

  beforeEach(() => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    descriptions = new Map();
    vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
      descriptions.set(args[0] as string, args[1] as string);
      return server;
    });
    registerFileTools(server, {} as SlimaApiClient);
  });

  it.each(WRITE_TOOLS)('%s names the types no tool may write', (tool) => {
    const description = descriptions.get(tool)!;

    expect(description).toBeDefined();
    for (const ext of READONLY_EXTENSIONS) {
      expect(description).toContain(ext);
    }
  });

  // The failure this replaces: a single "read-only" list cannot say
  // "writable, through this other tool", so a capability the author paid for
  // gets described as impossible.
  it.each(WRITE_TOOLS)('%s points at the field-level tool rather than calling the type read-only', (tool) => {
    const description = descriptions.get(tool)!;

    for (const [ext, expectedTool] of Object.entries(FIELD_LEVEL)) {
      expect(description).toContain(ext);
      expect(description).toContain(expectedTool);
    }
  });

  it.each(WRITE_TOOLS)('%s says .map takes a whole document rather than a partial edit', (tool) => {
    const description = descriptions.get(tool)!;

    for (const ext of WHOLE_FILE_EXTENSIONS) expect(description).toContain(ext);
    expect(description).toMatch(/whole document/i);
  });

  // The client ships with the app; Rails deploys on its own clock. When the two
  // disagree the server is right, and the model needs to be told where to ask.
  it.each(WRITE_TOOLS)('%s names get_capabilities as the authority', (tool) => {
    expect(descriptions.get(tool)).toContain('get_capabilities');
  });

  it('does not put the write warning on read-only tools', () => {
    // read_file / search_content must stay lean — they cannot corrupt anything,
    // and every token here is paid on every request.
    expect(descriptions.get('search_content')).not.toContain('Not every file type takes a generic write');
  });

  it('read_file steers .map traffic to the viewer', () => {
    expect(descriptions.get('read_file')).toContain('view_relationship_map');
  });
});

describe('book schema resource carries the same policy', () => {
  const book = (bookType: 'book' | 'script'): Book => ({
    token: 'bk_test',
    title: 'T',
    bookType,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });

  it.each(['book', 'script'] as const)('declares ai_file_policy for a %s book', (bookType) => {
    const schema = buildBookSchema(book(bookType)) as {
      ai_file_policy: {
        readonly: string[];
        writable: string[];
        whole_file_only: string[];
        field_level_tools: Record<string, string>;
        authority: string;
        viewers: Record<string, string>;
      };
    };

    expect(schema.ai_file_policy.writable).toContain('.md');
    for (const ext of READONLY_EXTENSIONS) {
      expect(schema.ai_file_policy.readonly).toContain(ext);
    }

    // The three buckets must stay separate — merging them back is the drift.
    expect(schema.ai_file_policy.field_level_tools).toEqual(FIELD_LEVEL);
    expect(schema.ai_file_policy.whole_file_only).toEqual(WHOLE_FILE_EXTENSIONS);
    for (const ext of [...Object.keys(FIELD_LEVEL), ...WHOLE_FILE_EXTENSIONS]) {
      expect(schema.ai_file_policy.readonly).not.toContain(ext);
    }

    expect(schema.ai_file_policy.authority).toBe('get_capabilities');
    expect(schema.ai_file_policy.viewers['.map']).toContain('view_relationship_map');
  });
});
