/**
 * Content Tools Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../../src/api/client.js';
import { registerContentTools } from '../../src/tools/content.js';

describe('Content Tools', () => {
  let server: McpServer;
  let mockClient: {
    listCommits: ReturnType<typeof vi.fn>;
    downloadBlobs: ReturnType<typeof vi.fn>;
  };
  let toolHandlers: Map<string, Function>;

  beforeEach(() => {
    server = new McpServer({
      name: 'test',
      version: '1.0.0',
    });

    mockClient = {
      listCommits: vi.fn(),
      downloadBlobs: vi.fn(),
    };

    // Capture tool handlers
    toolHandlers = new Map();
    vi.spyOn(server, 'tool').mockImplementation(
      (name: string, _desc: string, _schema: unknown, handler: Function) => {
        toolHandlers.set(name, handler);
        return server;
      }
    );

    registerContentTools(server, mockClient as unknown as SlimaApiClient);
  });

  describe('registerContentTools', () => {
    it('should register get_chapter tool', () => {
      expect(toolHandlers.has('get_chapter')).toBe(true);
    });
  });

  describe('get_chapter handler', () => {
    const mockFilesSnapshot = [
      {
        token: 'chapters',
        name: 'Chapters',
        kind: 'folder',
        position: 0,
        children: [
          {
            token: 'ch01',
            name: '01-introduction.md',
            kind: 'file',
            position: 0,
            blobHash: 'sha256:abc123',
            wordCount: 500,
          },
          {
            token: 'ch02',
            name: '02-beginning.md',
            kind: 'file',
            position: 1,
            blobHash: 'sha256:def456',
            wordCount: 800,
          },
        ],
      },
      {
        token: 'notes',
        name: 'notes.md',
        kind: 'file',
        position: 1,
        blobHash: 'sha256:notes',
        wordCount: 100,
      },
    ];

    it('should return chapter content successfully', async () => {
      mockClient.listCommits.mockResolvedValue([
        { token: 'cmt_1', filesSnapshot: mockFilesSnapshot },
      ]);
      mockClient.downloadBlobs.mockResolvedValue([
        { hash: 'sha256:abc123', content: 'Chapter 1 content here.' },
      ]);

      const handler = toolHandlers.get('get_chapter')!;
      const result = await handler({
        book_token: 'bk_test',
        file_path: '01-introduction.md',
      });

      expect(result.content[0].text).toContain('01-introduction.md');
      expect(result.content[0].text).toContain('500 words');
      expect(result.content[0].text).toContain('Chapter 1 content here.');
      expect(result.isError).toBeUndefined();
    });

    it('should find file by full path', async () => {
      mockClient.listCommits.mockResolvedValue([
        { token: 'cmt_1', filesSnapshot: mockFilesSnapshot },
      ]);
      mockClient.downloadBlobs.mockResolvedValue([
        { hash: 'sha256:abc123', content: 'Content' },
      ]);

      const handler = toolHandlers.get('get_chapter')!;
      const result = await handler({
        book_token: 'bk_test',
        file_path: '/Chapters/01-introduction.md',
      });

      expect(result.isError).toBeUndefined();
      expect(mockClient.downloadBlobs).toHaveBeenCalledWith('bk_test', ['sha256:abc123']);
    });

    it('should find file by token', async () => {
      mockClient.listCommits.mockResolvedValue([
        { token: 'cmt_1', filesSnapshot: mockFilesSnapshot },
      ]);
      mockClient.downloadBlobs.mockResolvedValue([
        { hash: 'sha256:abc123', content: 'Content' },
      ]);

      const handler = toolHandlers.get('get_chapter')!;
      const result = await handler({
        book_token: 'bk_test',
        file_path: 'ch01',
      });

      expect(result.isError).toBeUndefined();
    });

    it('should find file by name without extension', async () => {
      mockClient.listCommits.mockResolvedValue([
        { token: 'cmt_1', filesSnapshot: mockFilesSnapshot },
      ]);
      mockClient.downloadBlobs.mockResolvedValue([
        { hash: 'sha256:abc123', content: 'Content' },
      ]);

      const handler = toolHandlers.get('get_chapter')!;
      const result = await handler({
        book_token: 'bk_test',
        file_path: '01-introduction',
      });

      expect(result.isError).toBeUndefined();
    });

    it('should return error when no commits found', async () => {
      mockClient.listCommits.mockResolvedValue([]);

      const handler = toolHandlers.get('get_chapter')!;
      const result = await handler({
        book_token: 'bk_test',
        file_path: 'chapter.md',
      });

      expect(result.content[0].text).toContain('No commits found');
    });

    it('should return error when file not found and list available files', async () => {
      mockClient.listCommits.mockResolvedValue([
        { token: 'cmt_1', filesSnapshot: mockFilesSnapshot },
      ]);

      const handler = toolHandlers.get('get_chapter')!;
      const result = await handler({
        book_token: 'bk_test',
        file_path: 'nonexistent.md',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('File not found: nonexistent.md');
      expect(result.content[0].text).toContain('Available files');
      expect(result.content[0].text).toContain('01-introduction.md');
    });

    it('should return error when trying to read a folder', async () => {
      mockClient.listCommits.mockResolvedValue([
        { token: 'cmt_1', filesSnapshot: mockFilesSnapshot },
      ]);

      const handler = toolHandlers.get('get_chapter')!;
      const result = await handler({
        book_token: 'bk_test',
        file_path: 'Chapters',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('is a folder');
    });

    it('should handle empty file (no blobHash)', async () => {
      const snapshotWithEmptyFile = [
        {
          token: 'empty',
          name: 'empty.md',
          kind: 'file',
          position: 0,
          blobHash: null,
        },
      ];

      mockClient.listCommits.mockResolvedValue([
        { token: 'cmt_1', filesSnapshot: snapshotWithEmptyFile },
      ]);

      const handler = toolHandlers.get('get_chapter')!;
      const result = await handler({
        book_token: 'bk_test',
        file_path: 'empty.md',
      });

      expect(result.content[0].text).toContain('has no content');
    });

    it('should handle blob download failure', async () => {
      mockClient.listCommits.mockResolvedValue([
        { token: 'cmt_1', filesSnapshot: mockFilesSnapshot },
      ]);
      mockClient.downloadBlobs.mockResolvedValue([]);

      const handler = toolHandlers.get('get_chapter')!;
      const result = await handler({
        book_token: 'bk_test',
        file_path: '01-introduction.md',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Could not retrieve file content');
    });

    it('should handle API errors gracefully', async () => {
      mockClient.listCommits.mockRejectedValue(new Error('Network error'));

      const handler = toolHandlers.get('get_chapter')!;
      const result = await handler({
        book_token: 'bk_test',
        file_path: 'chapter.md',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Network error');
    });

    it('should handle case-insensitive path matching', async () => {
      mockClient.listCommits.mockResolvedValue([
        { token: 'cmt_1', filesSnapshot: mockFilesSnapshot },
      ]);
      mockClient.downloadBlobs.mockResolvedValue([
        { hash: 'sha256:abc123', content: 'Content' },
      ]);

      const handler = toolHandlers.get('get_chapter')!;
      const result = await handler({
        book_token: 'bk_test',
        file_path: 'CHAPTERS/01-INTRODUCTION.MD',
      });

      expect(result.isError).toBeUndefined();
    });
  });
});
