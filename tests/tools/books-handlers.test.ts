/**
 * Book Tools Handler Tests
 *
 * Tests for the actual handler functions of book tools
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../../src/api/client.js';
import { registerBookTools } from '../../src/tools/books.js';
import { NotFoundError } from '../../src/utils/errors.js';

describe('Book Tools Handlers', () => {
  let server: McpServer;
  let mockClient: Partial<SlimaApiClient>;
  let handlers: Map<string, (params: Record<string, unknown>) => Promise<unknown>>;

  beforeEach(() => {
    server = new McpServer({
      name: 'test',
      version: '1.0.0',
    });
    handlers = new Map();

    // Capture handlers when tools are registered
    vi.spyOn(server, 'tool').mockImplementation(
      (name: string, _description: string, _schema: unknown, handler: unknown) => {
        handlers.set(name, handler as (params: Record<string, unknown>) => Promise<unknown>);
        return server;
      }
    );

    mockClient = {
      listBooks: vi.fn(),
      getBook: vi.fn(),
      listCommits: vi.fn(),
    };

    registerBookTools(server, mockClient as SlimaApiClient);
  });

  describe('list_books handler', () => {
    it('should return formatted book list', async () => {
      (mockClient.listBooks as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          token: 'bk_test1',
          title: 'My Novel',
          authorName: 'John Doe',
          totalWordCount: 50000,
        },
        {
          token: 'bk_test2',
          title: 'Another Book',
          authorName: 'Jane Doe',
          totalWordCount: 30000,
        },
      ]);

      const handler = handlers.get('list_books')!;
      const result = await handler({});

      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('Found 2 book(s)');
      expect(content[0].text).toContain('My Novel');
      expect(content[0].text).toContain('bk_test1');
      expect(content[0].text).toContain('John Doe');
      expect(content[0].text).toContain('50,000');
    });

    it('should handle empty library', async () => {
      (mockClient.listBooks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const handler = handlers.get('list_books')!;
      const result = await handler({});

      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('No books found');
    });

    it('should handle books without author name', async () => {
      (mockClient.listBooks as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          token: 'bk_test1',
          title: 'Untitled',
          totalWordCount: 0,
        },
      ]);

      const handler = handlers.get('list_books')!;
      const result = await handler({});

      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('N/A');
    });

    it('should handle API error', async () => {
      (mockClient.listBooks as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network error')
      );

      const handler = handlers.get('list_books')!;
      const result = await handler({});

      expect(result).toHaveProperty('isError', true);
    });
  });

  describe('get_book handler', () => {
    it('should return formatted book details', async () => {
      (mockClient.getBook as ReturnType<typeof vi.fn>).mockResolvedValue({
        token: 'bk_test',
        title: 'My Novel',
        authorName: 'John Doe',
        description: 'A great story',
        language: 'zh-TW',
        totalWordCount: 50000,
        manuscriptWordCount: 45000,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-15T00:00:00Z',
      });

      const handler = handlers.get('get_book')!;
      const result = await handler({ book_token: 'bk_test' });

      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('My Novel');
      expect(content[0].text).toContain('bk_test');
      expect(content[0].text).toContain('John Doe');
      expect(content[0].text).toContain('A great story');
      expect(content[0].text).toContain('50,000');
      expect(content[0].text).toContain('45,000');
    });

    it('should handle book not found', async () => {
      (mockClient.getBook as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('Book not found')
      );

      const handler = handlers.get('get_book')!;
      const result = await handler({ book_token: 'bk_invalid' });

      expect(result).toHaveProperty('isError', true);
    });
  });

  describe('get_book_structure handler', () => {
    it('should return formatted file tree', async () => {
      // Mock uses flat parentToken structure (as returned by API)
      (mockClient.listCommits as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          token: 'cmt_latest',
          filesSnapshot: [
            { token: 'f1', name: 'chapter-01.md', kind: 'file', wordCount: 1000, position: 0 },
            { token: 'f2', name: 'chapter-02.md', kind: 'file', wordCount: 1500, position: 1 },
            { token: 'f3', name: 'notes', kind: 'folder', position: 2 },
            { token: 'f4', name: 'characters.md', kind: 'file', wordCount: 500, position: 0, parentToken: 'f3' },
          ],
        },
      ]);

      const handler = handlers.get('get_book_structure')!;
      const result = await handler({ book_token: 'bk_test' });

      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('File structure');
      expect(content[0].text).toContain('chapter-01.md');
      expect(content[0].text).toContain('chapter-02.md');
      expect(content[0].text).toContain('notes');
      expect(content[0].text).toContain('characters.md');
    });

    it('should handle empty book (no commits)', async () => {
      (mockClient.listCommits as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const handler = handlers.get('get_book_structure')!;
      const result = await handler({ book_token: 'bk_test' });

      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('No commits found');
    });

    it('should show manuscript marker', async () => {
      // Mock uses flat parentToken structure (as returned by API)
      (mockClient.listCommits as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          token: 'cmt_latest',
          filesSnapshot: [
            { token: 'f1', name: 'chapter-01.md', kind: 'file', wordCount: 1000, position: 0, isManuscript: true },
          ],
        },
      ]);

      const handler = handlers.get('get_book_structure')!;
      const result = await handler({ book_token: 'bk_test' });

      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('[M]');
    });
  });

  describe('get_writing_stats handler', () => {
    it('should return writing stats with progress', async () => {
      (mockClient.getBook as ReturnType<typeof vi.fn>).mockResolvedValue({
        token: 'bk_test',
        title: 'My Novel',
        totalWordCount: 50000,
        manuscriptWordCount: 45000,
        language: 'zh-TW',
      });
      (mockClient.listCommits as ReturnType<typeof vi.fn>).mockResolvedValue([
        { token: 'cmt_1', totalWordCount: 50000 },
        { token: 'cmt_2', totalWordCount: 48000 },
        { token: 'cmt_3', totalWordCount: 45000 },
      ]);

      const handler = handlers.get('get_writing_stats')!;
      const result = await handler({ book_token: 'bk_test' });

      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('Writing Stats');
      expect(content[0].text).toContain('50,000');
      expect(content[0].text).toContain('+5,000'); // 50000 - 45000
      expect(content[0].text).toContain('3 commits');
    });

    it('should handle single commit (no progress)', async () => {
      (mockClient.getBook as ReturnType<typeof vi.fn>).mockResolvedValue({
        token: 'bk_test',
        title: 'New Book',
        totalWordCount: 1000,
        manuscriptWordCount: 1000,
      });
      (mockClient.listCommits as ReturnType<typeof vi.fn>).mockResolvedValue([
        { token: 'cmt_1', totalWordCount: 1000 },
      ]);

      const handler = handlers.get('get_writing_stats')!;
      const result = await handler({ book_token: 'bk_test' });

      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('not enough history');
    });

    it('should handle negative progress (deleted words)', async () => {
      (mockClient.getBook as ReturnType<typeof vi.fn>).mockResolvedValue({
        token: 'bk_test',
        title: 'Editing Book',
        totalWordCount: 40000,
        manuscriptWordCount: 40000,
      });
      (mockClient.listCommits as ReturnType<typeof vi.fn>).mockResolvedValue([
        { token: 'cmt_1', totalWordCount: 40000 },
        { token: 'cmt_2', totalWordCount: 50000 },
      ]);

      const handler = handlers.get('get_writing_stats')!;
      const result = await handler({ book_token: 'bk_test' });

      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('-10,000');
    });

    it('should handle API error', async () => {
      (mockClient.getBook as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('Book not found')
      );

      const handler = handlers.get('get_writing_stats')!;
      const result = await handler({ book_token: 'bk_invalid' });

      expect(result).toHaveProperty('isError', true);
    });
  });
});
