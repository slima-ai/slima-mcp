/**
 * get_chapter — reading is delegated to Rails' /mcp/files/read.
 *
 * This file previously tested a second, independent reading implementation
 * (list commits → walk the snapshot → download the blob by hash). That path
 * bypassed the team-skill audit trail and daily read budget, could not see
 * `contentWithheld` / `throttled`, and needed two endpoints a narrowly-scoped
 * mcp:books token cannot reach — so the tests were pinning a shortcut around
 * the server's own rules.
 *
 * What survives is the part that was genuinely useful: resolving a loose
 * reference (bare filename, token, missing extension) to one real path. That
 * now decides *which* file to ask for, and the read itself still goes through
 * the audited endpoint.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../../src/api/client.js';
import { registerContentTools } from '../../src/tools/content.js';
import { NotFoundError, SlimaApiError } from '../../src/utils/errors.js';

type Handler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

const SNAPSHOT = [
  { token: 'fl_folder', name: 'chapters', kind: 'folder', position: 0 },
  {
    token: 'fl_ch1',
    name: '01-introduction.md',
    kind: 'file',
    parentToken: 'fl_folder',
    position: 0,
    blobHash: 'sha256:abc',
    wordCount: 500,
  },
];

describe('Content Tools', () => {
  let server: McpServer;
  let mockClient: Partial<SlimaApiClient>;
  let handlers: Map<string, Handler>;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '1.0.0' });
    mockClient = { readFile: vi.fn(), listCommits: vi.fn(), downloadBlobs: vi.fn() };
    handlers = new Map();
    vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
      handlers.set(args[0] as string, args[args.length - 1] as Handler);
      return server;
    });
    registerContentTools(server, mockClient as SlimaApiClient);
  });

  const get = (file_path: string) => handlers.get('get_chapter')!({ book_token: 'bk_test', file_path });

  const readOk = (path: string, content: string) => ({
    file: { name: path.split('/').pop(), path, wordCount: 500, fileType: 'md' },
    content,
  });

  describe('registerContentTools', () => {
    it('registers get_chapter', () => {
      expect(handlers.has('get_chapter')).toBe(true);
    });
  });

  describe('reading by exact path', () => {
    it('returns the content without touching commits or blobs', async () => {
      (mockClient.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        readOk('chapters/01-introduction.md', '# Introduction\n\nHello.')
      );

      const result = await get('chapters/01-introduction.md');

      expect(result.content[0].text).toContain('Introduction');
      expect(mockClient.listCommits).not.toHaveBeenCalled();
      expect(mockClient.downloadBlobs).not.toHaveBeenCalled();
    });

    it('accepts a leading slash', async () => {
      (mockClient.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        readOk('chapters/01-introduction.md', 'body')
      );

      await get('/chapters/01-introduction.md');

      expect(mockClient.readFile).toHaveBeenCalledWith('bk_test', 'chapters/01-introduction.md');
    });
  });

  describe('resolving a loose reference', () => {
    beforeEach(() => {
      (mockClient.readFile as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new NotFoundError('File not found'))
        .mockResolvedValueOnce(readOk('chapters/01-introduction.md', 'resolved'));
      (mockClient.listCommits as ReturnType<typeof vi.fn>).mockResolvedValue([
        { token: 'cmt_1', filesSnapshot: SNAPSHOT },
      ]);
    });

    it.each([
      ['bare filename', '01-introduction.md'],
      ['file token', 'fl_ch1'],
      ['name without extension', '01-introduction'],
    ])('resolves a %s and reads the resolved path', async (_label, reference) => {
      const result = await get(reference);

      expect(mockClient.readFile).toHaveBeenNthCalledWith(2, 'bk_test', 'chapters/01-introduction.md');
      expect(result.content[0].text).toContain('resolved');
    });
  });

  describe('when the file cannot be found', () => {
    it('lists what is available instead of a bare not-found', async () => {
      (mockClient.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(new NotFoundError('nope'));
      (mockClient.listCommits as ReturnType<typeof vi.fn>).mockResolvedValue([
        { token: 'cmt_1', filesSnapshot: SNAPSHOT },
      ]);

      const result = await get('nonexistent.md');

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('File not found: nonexistent.md');
      expect(result.content[0].text).toContain('chapters/01-introduction.md');
    });

    it('handles an empty book', async () => {
      (mockClient.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(new NotFoundError('nope'));
      (mockClient.listCommits as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await get('anything.md');

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('File not found');
    });
  });

  describe('errors other than not-found', () => {
    it('does not attempt a fallback resolution', async () => {
      (mockClient.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
        new SlimaApiError(500, 'INTERNAL_ERROR', 'Network error')
      );

      const result = await get('chapters/01-introduction.md');

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Network error');
      expect(mockClient.listCommits).not.toHaveBeenCalled();
    });
  });
});
