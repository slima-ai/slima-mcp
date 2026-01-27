/**
 * API Client Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SlimaApiClient } from '../../src/api/client.js';
import {
  AuthenticationError,
  NotFoundError,
  InsufficientCreditsError,
} from '../../src/utils/errors.js';

describe('SlimaApiClient', () => {
  let client: SlimaApiClient;

  beforeEach(() => {
    client = new SlimaApiClient({
      token: 'test_token',
      baseUrl: 'https://api.test.com',
    });
    vi.resetAllMocks();
  });

  describe('listBooks', () => {
    it('should return books on success', async () => {
      const mockBooks = [
        { token: 'bk_test1', title: 'Book 1' },
        { token: 'bk_test2', title: 'Book 2' },
      ];

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockBooks }),
      });

      const books = await client.listBooks();

      expect(books).toHaveLength(2);
      expect(books[0].title).toBe('Book 1');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/v1/books',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test_token',
          }),
        })
      );
    });

    it('should throw AuthenticationError on 401', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({
            error: { code: 'UNAUTHORIZED', message: 'Invalid token' },
          }),
      });

      await expect(client.listBooks()).rejects.toThrow(AuthenticationError);
    });
  });

  describe('getBook', () => {
    it('should return book details', async () => {
      const mockBook = {
        token: 'bk_test',
        title: 'Test Book',
        authorName: 'Test Author',
        totalWordCount: 10000,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockBook }),
      });

      const book = await client.getBook('bk_test');

      expect(book.title).toBe('Test Book');
      expect(book.authorName).toBe('Test Author');
      expect(book.totalWordCount).toBe(10000);
    });

    it('should throw NotFoundError on 404', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () =>
          Promise.resolve({
            error: { code: 'NOT_FOUND', message: 'Book not found' },
          }),
      });

      await expect(client.getBook('bk_invalid')).rejects.toThrow(NotFoundError);
    });
  });

  describe('listCommits', () => {
    it('should return commits with limit', async () => {
      const mockCommits = [
        {
          token: 'cmt_1',
          name: 'Commit 1',
          filesSnapshot: [],
        },
      ];

      // API 回傳格式: { data: { commits: [...] } }
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { commits: mockCommits } }),
      });

      const commits = await client.listCommits('bk_test', 5);

      expect(commits).toHaveLength(1);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/v1/books/bk_test/commits?limit=5',
        expect.any(Object)
      );
    });
  });

  describe('downloadBlobs', () => {
    it('should download blob content', async () => {
      const mockBlobs = [
        { hash: 'sha256:abc', content: 'Hello World', size: 11 },
      ];

      // API 回傳格式: { data: { blobs: [...], notFound: [], truncated: 0 } }
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: { blobs: mockBlobs, notFound: [], truncated: 0 }
        }),
      });

      const blobs = await client.downloadBlobs('bk_test', ['sha256:abc']);

      expect(blobs).toHaveLength(1);
      expect(blobs[0].content).toBe('Hello World');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/v1/books/bk_test/blobs/download',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ hashes: ['sha256:abc'] }),
        })
      );
    });
  });

  describe('listPersonas', () => {
    it('should list all personas', async () => {
      const mockPersonas = [
        { token: 'psn_1', slug: 'young-reader' },
        { token: 'psn_2', slug: 'critic' },
      ];

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockPersonas }),
      });

      const personas = await client.listPersonas();

      expect(personas).toHaveLength(2);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/v1/personas',
        expect.any(Object)
      );
    });

    it('should filter by genre', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

      await client.listPersonas('fantasy');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/v1/personas?genre=fantasy',
        expect.any(Object)
      );
    });
  });

  describe('createReaderTest', () => {
    it('should create a reader test', async () => {
      const mockTest = {
        token: 'rpt_test',
        status: 'pending',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockTest }),
      });

      const test = await client.createReaderTest('bk_test', {
        personaTokens: ['psn_1'],
        commitToken: 'cmt_1',
        content: 'Chapter content...',
      });

      expect(test.token).toBe('rpt_test');
      expect(test.status).toBe('pending');
    });

    it('should throw InsufficientCreditsError on 402', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 402,
        json: () =>
          Promise.resolve({
            error: { code: 'INSUFFICIENT_CREDITS', message: 'Not enough credits' },
          }),
      });

      await expect(
        client.createReaderTest('bk_test', {
          personaTokens: ['psn_1'],
          content: 'test',
        })
      ).rejects.toThrow(InsufficientCreditsError);
    });
  });

  describe('error handling', () => {
    it('should handle network errors', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      await expect(client.listBooks()).rejects.toThrow('Network error');
    });

    it('should handle invalid JSON response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      await expect(client.listBooks()).rejects.toThrow();
    });
  });

  // === MCP File Operations ===

  describe('readFile', () => {
    it('should read file content', async () => {
      const mockResponse = {
        file: {
          token: 'fl_test',
          name: 'chapter-01.md',
          path: 'chapter-01.md',
          kind: 'chapter',
          fileType: 'markdown',
          wordCount: 100,
        },
        content: '# Chapter 1\n\nContent here...',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockResponse }),
      });

      const result = await client.readFile('bk_test', 'chapter-01.md');

      expect(result.file.name).toBe('chapter-01.md');
      expect(result.content).toBe('# Chapter 1\n\nContent here...');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/v1/books/bk_test/mcp/files/read',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ path: 'chapter-01.md' }),
        })
      );
    });

    it('should throw NotFoundError when file not found', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () =>
          Promise.resolve({
            error: { code: 'FILE_NOT_FOUND', message: 'File not found' },
          }),
      });

      await expect(client.readFile('bk_test', 'nonexistent.md')).rejects.toThrow(NotFoundError);
    });
  });

  describe('createFile', () => {
    it('should create a new file', async () => {
      const mockResponse = {
        commit: {
          token: 'cmt_new',
          name: 'Create file: test.md',
        },
        fileToken: 'fl_new',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockResponse }),
      });

      const result = await client.createFile('bk_test', {
        path: 'test.md',
        content: 'Hello World',
        commitMessage: 'Add test file',
      });

      expect(result.fileToken).toBe('fl_new');
      expect(result.commit.token).toBe('cmt_new');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/v1/books/bk_test/mcp/files/create',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            path: 'test.md',
            content: 'Hello World',
            parent_path: undefined,
            commit_message: 'Add test file',
          }),
        })
      );
    });
  });

  describe('updateFile', () => {
    it('should update file content', async () => {
      const mockResponse = {
        commit: {
          token: 'cmt_update',
          name: 'Update file: test.md',
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockResponse }),
      });

      const result = await client.updateFile('bk_test', {
        path: 'test.md',
        content: 'Updated content',
        commitMessage: 'Update test file',
      });

      expect(result.commit.token).toBe('cmt_update');
    });
  });

  describe('deleteFile', () => {
    it('should delete a file', async () => {
      const mockResponse = {
        commit: {
          token: 'cmt_delete',
          name: 'Delete file: test.md',
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockResponse }),
      });

      const result = await client.deleteFile('bk_test', {
        path: 'test.md',
      });

      expect(result.commit.token).toBe('cmt_delete');
    });
  });

  describe('appendToFile', () => {
    it('should append content to file', async () => {
      const mockResponse = {
        commit: {
          token: 'cmt_append',
          name: 'Append to file: test.md',
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockResponse }),
      });

      const result = await client.appendToFile('bk_test', {
        path: 'test.md',
        content: '\n\nAppended content',
      });

      expect(result.commit.token).toBe('cmt_append');
    });
  });

  describe('searchFiles', () => {
    it('should search files and return matches', async () => {
      const mockResponse = {
        matches: [
          {
            file: { token: 'fl_1', name: 'chapter-01.md', path: 'chapter-01.md', wordCount: 100 },
            snippets: [{ text: '...blue eyes...', highlightStart: 3, highlightEnd: 12 }],
            matchCount: 1,
          },
        ],
        query: 'blue eyes',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockResponse }),
      });

      const result = await client.searchFiles('bk_test', {
        query: 'blue eyes',
        limit: 10,
      });

      expect(result.matches).toHaveLength(1);
      expect(result.query).toBe('blue eyes');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/v1/books/bk_test/mcp/files/search',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            query: 'blue eyes',
            file_types: undefined,
            limit: 10,
          }),
        })
      );
    });

    it('should return empty matches when no results', async () => {
      const mockResponse = {
        matches: [],
        query: 'xyz123',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockResponse }),
      });

      const result = await client.searchFiles('bk_test', { query: 'xyz123' });

      expect(result.matches).toHaveLength(0);
    });
  });
});
