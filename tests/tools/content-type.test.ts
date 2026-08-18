/**
 * `create_file` must be able to say "this is manuscript prose".
 *
 * Slima splits every file into manuscript vs reference (plus the intrinsic
 * planner labels). Only manuscript counts toward the author's word count,
 * streak, Beta Reader chapter picker and manuscript export. A new file inherits
 * its folder and defaults to `reference` at the root — which is right for notes
 * and wrong for the chapter an agent was just asked to write. Without a way to
 * declare it, "write chapter 3" produced words that never showed up anywhere the
 * author looks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../../src/core/api/client.js';
import { registerFileTools } from '../../src/core/tools/files.js';

type Handler = (params: Record<string, unknown>) => Promise<{ content: Array<{ text?: string }> }>;

describe('create_file content_type', () => {
  let handlers: Map<string, Handler>;
  let descriptions: Map<string, string>;
  let schemas: Map<string, Record<string, unknown>>;
  let mockClient: Partial<SlimaApiClient>;

  beforeEach(() => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    handlers = new Map();
    descriptions = new Map();
    schemas = new Map();
    vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
      const name = args[0] as string;
      handlers.set(name, args[args.length - 1] as Handler);
      descriptions.set(name, args[1] as string);
      schemas.set(name, args[2] as Record<string, unknown>);
      return server;
    });
    mockClient = { createFile: vi.fn().mockResolvedValue({ commit: { token: 'cmt_1' }, fileToken: 'fl_1' }) };
    registerFileTools(server, mockClient as SlimaApiClient);
  });

  it('exposes content_type as a parameter', () => {
    expect(schemas.get('create_file')).toHaveProperty('content_type');
  });

  it('forwards content_type to the server', async () => {
    await handlers.get('create_file')!({
      book_token: 'bk_x',
      path: 'chapters/ch03.md',
      content: 'prose',
      content_type: 'manuscript',
    });

    expect(mockClient.createFile).toHaveBeenCalledWith(
      'bk_x',
      expect.objectContaining({ contentType: 'manuscript' })
    );
  });

  it('omits it when the caller says nothing, so the server inherits the folder', async () => {
    await handlers.get('create_file')!({ book_token: 'bk_x', path: 'notes.md', content: 'n' });

    expect(mockClient.createFile).toHaveBeenCalledWith(
      'bk_x',
      expect.objectContaining({ contentType: undefined })
    );
  });

  it('tells the AI that manuscript is what counts toward the word count', () => {
    const description = descriptions.get('create_file')!;

    expect(description).toContain('manuscript');
    expect(description).toMatch(/word count|counts toward/i);
  });

  it('reports the resolved classification back so the AI can tell it landed', async () => {
    const result = await handlers.get('create_file')!({
      book_token: 'bk_x',
      path: 'chapters/ch03.md',
      content: 'prose',
      content_type: 'manuscript',
    });

    expect(result.content[0].text).toContain('manuscript');
  });
});
