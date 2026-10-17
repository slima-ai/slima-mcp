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
      (...args: unknown[]) => {
        const name = args[0] as string;
        const handler = args[args.length - 1] as (params: Record<string, unknown>) => Promise<unknown>;
        handlers.set(name, handler);
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
      (mockClient.listBooks as ReturnType<typeof vi.fn>).mockResolvedValue({ books: [
        {
          token: 'bk_test1',
          title: 'My Novel',
          authorName: 'John Doe',
          wordCount: 50000, manuscriptWordCount: 50000,
        },
        {
          token: 'bk_test2',
          title: 'Another Book',
          authorName: 'Jane Doe',
          wordCount: 30000, manuscriptWordCount: 30000,
        },
      ], meta: {} });

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
      (mockClient.listBooks as ReturnType<typeof vi.fn>).mockResolvedValue({ books: [], meta: {} });

      const handler = handlers.get('list_books')!;
      const result = await handler({});

      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('No books found');
    });

    it('should handle books without author name', async () => {
      (mockClient.listBooks as ReturnType<typeof vi.fn>).mockResolvedValue({
        books: [
          {
            token: 'bk_test1',
            title: 'Untitled',
            wordCount: 0, manuscriptWordCount: 0,
          },
        ],
        meta: {},
      });

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
        wordCount: 50000,
        manuscriptWordCount: 45000,
        referenceWordCount: 5000,
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
      expect(content[0].text).toContain('Reference Words');
      expect(content[0].text).toContain('5,000');
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
    // get_book_structure now fetches the book to tag output with Studio label
    // and a Resource-URI footer for Script Studio books.
    const writingBook = { token: 'bk_test', title: 'Test Book', bookType: 'book' as const, createdAt: '', updatedAt: '' };

    it('should return formatted file tree', async () => {
      (mockClient.getBook as ReturnType<typeof vi.fn>).mockResolvedValue(writingBook);
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
      (mockClient.getBook as ReturnType<typeof vi.fn>).mockResolvedValue(writingBook);
      (mockClient.listCommits as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const handler = handlers.get('get_book_structure')!;
      const result = await handler({ book_token: 'bk_test' });

      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('No commits found');
    });

    it('should show manuscript marker', async () => {
      (mockClient.getBook as ReturnType<typeof vi.fn>).mockResolvedValue(writingBook);
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
    // These used to assert a "Recent Progress" delta computed from the last N
    // commits — a third word-count algorithm agreeing with neither the backend's
    // authoritative WritingStats::QueryService nor the frontend's, and unstable
    // because CommitCleanupJob prunes intra-day commits after 30 days (so the
    // same book yields a different "progress" over time). Rewritten to assert
    // the totals, which ARE authoritative, and the absence of the invention.
    const book = {
      token: 'bk_test',
      title: 'My Novel',
      wordCount: 50000,
      manuscriptWordCount: 45000,
      referenceWordCount: 5000,
      language: 'zh-TW',
      updatedAt: '2026-08-18T00:00:00Z',
    };

    it('returns the authoritative totals', async () => {
      (mockClient.getBook as ReturnType<typeof vi.fn>).mockResolvedValue(book);

      const result = await handlers.get('get_writing_stats')!({ book_token: 'bk_test' });

      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('50,000');
      expect(content[0].text).toContain('45,000');
      expect(content[0].text).toContain('5,000');
    });

    it('does not derive any progress figure from commit history', async () => {
      (mockClient.getBook as ReturnType<typeof vi.fn>).mockResolvedValue(book);
      (mockClient.listCommits as ReturnType<typeof vi.fn>).mockResolvedValue([
        { token: 'cmt_1', totalWordCount: 50000 },
        { token: 'cmt_3', totalWordCount: 45000 },
      ]);

      const result = await handlers.get('get_writing_stats')!({ book_token: 'bk_test' });

      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).not.toMatch(/recent progress/i);
      expect(content[0].text).not.toContain('+5,000');
      expect(mockClient.listCommits).not.toHaveBeenCalled();
    });

    it('tells the reader that daily words and streak live elsewhere', async () => {
      (mockClient.getBook as ReturnType<typeof vi.fn>).mockResolvedValue(book);

      const result = await handlers.get('get_writing_stats')!({ book_token: 'bk_test' });

      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toMatch(/streak/i);
      expect(content[0].text).toMatch(/not available/i);
    });

    it('should handle API error', async () => {
      (mockClient.getBook as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('Book not found')
      );

      const handler = handlers.get('get_writing_stats')!;
      const result = await handler({ book_token: 'bk_invalid' });

      expect(result).toHaveProperty('isError', true);
    });

    // The description carries the instruction the output cannot: an AI that has
    // commit history in front of it will happily compute a delta unless told not
    // to. Pinned here because a silent edit dropping it is invisible otherwise.
    it('warns in its description against deriving progress from commits', () => {
      const server = new McpServer({ name: 'test', version: '1.0.0' });
      const spy = vi.spyOn(server, 'tool');
      registerBookTools(server, mockClient as unknown as SlimaApiClient);

      const call = spy.mock.calls.find((c) => c[0] === 'get_writing_stats');
      expect(call?.[1]).toMatch(/do not|never/i);
    });
  });
});
