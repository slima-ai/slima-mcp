/**
 * `get_chapter` must go through the same audited read path as `read_file`.
 *
 * It reimplemented reading: list commits → scan the snapshot → download the blob
 * by hash. Three consequences, none visible from the tool's output:
 *   - it skips Rails' /mcp/files/read entirely, so the team-skill audit trail
 *     (Teams::SkillAccessRecorder) and the daily read budget
 *     (Teams::ConfidentialReadThrottle) never fire for chapters read this way;
 *   - it therefore also never sees `contentWithheld` / `throttled`, so a
 *     confidential skill came back as "Could not retrieve file content";
 *   - it needs /commits and /blobs/download, which a narrowly-scoped mcp:books
 *     token cannot reach at all.
 *
 * Its one real feature — resolving a bare filename — is kept, but only as a
 * fallback after the direct read misses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../../src/core/api/client.js';
import { registerContentTools } from '../../src/core/tools/content.js';
import { NotFoundError } from '../../src/core/utils/errors.js';

type Handler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ text?: string }>;
  isError?: boolean;
}>;

describe('get_chapter delegates to the audited read path', () => {
  let handlers: Map<string, Handler>;
  let mockClient: Partial<SlimaApiClient>;

  beforeEach(() => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    handlers = new Map();
    vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
      handlers.set(args[0] as string, args[args.length - 1] as Handler);
      return server;
    });
    mockClient = { readFile: vi.fn(), listCommits: vi.fn(), downloadBlobs: vi.fn() };
    registerContentTools(server, mockClient as SlimaApiClient);
  });

  const get = (file_path: string) =>
    handlers.get('get_chapter')!({ book_token: 'bk_x', file_path });

  it('reads through /mcp/files/read, not commits + blobs', async () => {
    (mockClient.readFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      file: { name: 'ch01.md', path: 'chapters/ch01.md', wordCount: 900 },
      content: '第一章內容',
    });

    const result = await get('chapters/ch01.md');

    expect(mockClient.readFile).toHaveBeenCalledWith('bk_x', 'chapters/ch01.md');
    expect(mockClient.listCommits).not.toHaveBeenCalled();
    expect(mockClient.downloadBlobs).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('第一章內容');
  });

  it('explains a withheld confidential file instead of "could not retrieve"', async () => {
    (mockClient.readFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      file: { name: 'secret.md', path: '.slima/skills/secret.md', wordCount: 1832 },
      content: null,
      contentWithheld: true,
      withheldReason: 'confidential_skill',
    });

    const result = await get('.slima/skills/secret.md');

    expect(result.content[0].text).toMatch(/withheld|confidential/i);
    expect(result.content[0].text).not.toMatch(/could not retrieve/i);
    expect(result.content[0].text).toContain('1832');
  });

  it('reports a throttled read as a budget limit', async () => {
    (mockClient.readFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      file: { name: 'secret.md', path: '.slima/skills/secret.md', wordCount: 900 },
      content: null,
      throttled: true,
      throttledReason: 'daily_read_limit',
    });

    expect((await get('.slima/skills/secret.md')).content[0].text).toContain('daily_read_limit');
  });

  it('falls back to resolving a bare filename when the direct read misses', async () => {
    (mockClient.readFile as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new NotFoundError('File not found: ch01.md'))
      .mockResolvedValueOnce({
        file: { name: 'ch01.md', path: 'chapters/ch01.md', wordCount: 900 },
        content: 'resolved content',
      });
    (mockClient.listCommits as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        token: 'cmt_1',
        filesSnapshot: [
          { token: 'fl_1', name: 'chapters', kind: 'folder', position: 0 },
          { token: 'fl_2', name: 'ch01.md', kind: 'file', parentToken: 'fl_1', position: 0, blobHash: 'sha256:x' },
        ],
      },
    ]);

    const result = await get('ch01.md');

    // Second read is by the RESOLVED path, so the audited endpoint still runs.
    expect(mockClient.readFile).toHaveBeenNthCalledWith(2, 'bk_x', 'chapters/ch01.md');
    expect(mockClient.downloadBlobs).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('resolved content');
  });

  it('lists candidates when nothing matches, instead of a bare not-found', async () => {
    (mockClient.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
      new NotFoundError('File not found: nope.md')
    );
    (mockClient.listCommits as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        token: 'cmt_1',
        filesSnapshot: [{ token: 'fl_2', name: 'ch01.md', kind: 'file', position: 0 }],
      },
    ]);

    const result = await get('nope.md');

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('ch01.md');
  });
});
