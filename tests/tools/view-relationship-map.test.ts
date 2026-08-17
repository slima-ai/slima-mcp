/**
 * view_relationship_map handler tests
 *
 * The invariant under test is "the summary always stands alone": image content
 * blocks are dropped by some MCP clients (claude.ai / Claude Desktop remote
 * connectors — anthropics/claude-ai-mcp#238), so a reply whose only payload is
 * a picture would be an empty turn there.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../../src/core/api/client.js';
import { registerFileTools } from '../../src/core/tools/files.js';
import { NotFoundError } from '../../src/core/utils/errors.js';

type Handler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}>;

describe('view_relationship_map', () => {
  let handlers: Map<string, Handler>;
  let mockClient: Partial<SlimaApiClient>;

  beforeEach(() => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    handlers = new Map();
    vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
      handlers.set(args[0] as string, args[args.length - 1] as Handler);
      return server;
    });
    mockClient = { visualizeFile: vi.fn() };
    registerFileTools(server, mockClient as SlimaApiClient);
  });

  const call = () =>
    handlers.get('view_relationship_map')!({ book_token: 'bk_x', path: 'world/relations.map' });

  it('returns the summary first, then the image', async () => {
    (mockClient.visualizeFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      file: { name: 'relations.map', path: 'world/relations.map' },
      format: 'png',
      image: 'aGVsbG8=',
      summary: '# 關係圖：主線\n- 林小雨 —青梅竹馬→ 陳醫生',
      stats: { nodes: 2, edges: 1, groups: 0 },
    });

    const result = await call();

    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('林小雨 —青梅竹馬→ 陳醫生');
    expect(result.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' });
  });

  it('still returns the summary when the server could not rasterise', async () => {
    (mockClient.visualizeFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      file: { name: 'relations.map', path: 'world/relations.map' },
      format: 'none',
      summary: '# 關係圖：主線',
      imageUnavailable: true,
      imageError: 'Vips::Error: blocked',
    });

    const result = await call();

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('關係圖');
    expect(result.content.some((c) => c.text?.includes('could not be rendered'))).toBe(true);
    expect(result.content.some((c) => c.type === 'image')).toBe(false);
  });

  it('explains a withheld confidential skill instead of showing an empty map', async () => {
    (mockClient.visualizeFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      file: { name: 'secret.map', path: '.slima/skills/secret.map' },
      format: 'none',
      contentWithheld: true,
      withheldReason: 'confidential_skill',
    });

    const result = await call();

    expect(result.content[0].text).toContain('🔒');
    expect(result.content[0].text).toContain('confidential');
    expect(result.content[0].text).not.toContain('empty');
  });

  it('explains a throttled read rather than reporting an empty file', async () => {
    (mockClient.visualizeFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      file: { name: 'secret.map', path: '.slima/skills/secret.map' },
      format: 'none',
      throttled: true,
      throttledReason: 'daily_read_limit',
    });

    const result = await call();

    expect(result.content[0].text).toContain('⏳');
    expect(result.content[0].text).toContain('daily_read_limit');
  });

  it('surfaces a not-found error as an error result', async () => {
    (mockClient.visualizeFile as ReturnType<typeof vi.fn>).mockRejectedValue(new NotFoundError('nope'));

    const result = await call();

    expect(result.isError).toBe(true);
  });
});
