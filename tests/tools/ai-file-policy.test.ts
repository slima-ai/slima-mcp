/**
 * The AI file-type policy has to reach the MODEL, not just the server.
 *
 * Rails does not (yet) refuse a write to a `.map`/`.geomap`/`.character` on a
 * Writing Studio book — the enforcement gap is real and tracked separately. Until
 * it closes, these tool descriptions are the only thing standing between an
 * external agent and a corrupted relationship graph, so they are worth pinning:
 * a silent edit that drops the warning would be invisible in every other test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../../src/core/api/client.js';
import { registerFileTools } from '../../src/core/tools/files.js';
import { buildBookSchema } from '../../src/core/resources/book_schema.js';
import type { Book } from '../../src/core/api/types.js';

const WRITE_TOOLS = ['write_file', 'edit_file', 'create_file', 'delete_file', 'append_to_file'];
const READONLY_EXTENSIONS = ['.map', '.geomap', '.script', '.timeline', '.character', '.location', '.json'];

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

  it.each(WRITE_TOOLS)('%s warns about read-only file types', (tool) => {
    const description = descriptions.get(tool)!;

    expect(description).toBeDefined();
    for (const ext of READONLY_EXTENSIONS) {
      expect(description).toContain(ext);
    }
  });

  it.each(WRITE_TOOLS)('%s points at the viewer instead of just saying no', (tool) => {
    expect(descriptions.get(tool)).toContain('view_relationship_map');
  });

  it('does not put the write warning on read-only tools', () => {
    // read_file / search_content must stay lean — they cannot corrupt anything,
    // and every token here is paid on every request.
    expect(descriptions.get('search_content')).not.toContain('Do not write these file types');
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
      ai_file_policy: { readonly: string[]; writable: string[]; viewers: Record<string, string> };
    };

    expect(schema.ai_file_policy.writable).toContain('.md');
    for (const ext of READONLY_EXTENSIONS) {
      expect(schema.ai_file_policy.readonly).toContain(ext);
    }
    expect(schema.ai_file_policy.viewers['.map']).toContain('view_relationship_map');
  });
});
