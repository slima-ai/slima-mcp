/**
 * analyze_chapter rejects Script Studio books up-front.
 *
 * Even though Rails allows the request, AI Beta Reader doesn't parse .scene
 * or structured JSON; running it on a script book produces garbage. The MCP
 * server short-circuits with a friendly error before spending credits.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SlimaApiClient } from '../../src/core/api/client.js';
import { registerBetaReaderTools } from '../../src/core/tools/beta-reader.js';

describe('analyze_chapter — rejects Script Studio books', () => {
  let server: McpServer;
  let handler: (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
  let mockClient: {
    getBook: ReturnType<typeof vi.fn>;
    listCommits: ReturnType<typeof vi.fn>;
    createReaderTest: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    mockClient = {
      getBook: vi.fn(),
      listCommits: vi.fn(),
      createReaderTest: vi.fn(),
    };

    vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
      const name = args[0] as string;
      const h = args[args.length - 1] as typeof handler;
      if (name === 'analyze_chapter') handler = h;
      return server;
    });

    registerBetaReaderTools(server, mockClient as unknown as SlimaApiClient);
  });

  it('returns an isError response for book_type="script"', async () => {
    mockClient.getBook.mockResolvedValue({
      token: 'bk_script1',
      title: 'My Screenplay',
      bookType: 'script',
      createdAt: '',
      updatedAt: '',
    });

    const result = await handler({
      book_token: 'bk_script1',
      file_path: '.script_studio/seasons/s1/episodes/e1/scenes/scene01.scene',
      persona_token: 'psn_fantasy1',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/script studio/i);
    expect(result.content[0].text).toMatch(/not available/i);
  });

  it('does not spend a createReaderTest call when rejecting', async () => {
    mockClient.getBook.mockResolvedValue({
      token: 'bk_script1',
      title: 'S',
      bookType: 'script',
      createdAt: '',
      updatedAt: '',
    });

    await handler({ book_token: 'bk_script1', file_path: 'x.scene', persona_token: 'p' });

    expect(mockClient.createReaderTest).not.toHaveBeenCalled();
    expect(mockClient.listCommits).not.toHaveBeenCalled();
  });
});
