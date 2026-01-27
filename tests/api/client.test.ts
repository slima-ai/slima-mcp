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
});
