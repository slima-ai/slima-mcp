/**
 * Books Tools Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../../src/api/client.js';
import { registerBookTools } from '../../src/tools/books.js';

describe('Book Tools', () => {
  let server: McpServer;
  let mockClient: {
    listBooks: ReturnType<typeof vi.fn>;
    getBook: ReturnType<typeof vi.fn>;
    listCommits: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    server = new McpServer({
      name: 'test',
      version: '1.0.0',
    });

    mockClient = {
      listBooks: vi.fn(),
      getBook: vi.fn(),
      listCommits: vi.fn(),
    };
  });

  describe('registerBookTools', () => {
    it('should register tools without error', () => {
      expect(() => {
        registerBookTools(server, mockClient as unknown as SlimaApiClient);
      }).not.toThrow();
    });

    it('should register all 4 book-related tools', () => {
      // The server.tool() method is called for each tool
      const toolSpy = vi.spyOn(server, 'tool');

      registerBookTools(server, mockClient as unknown as SlimaApiClient);

      expect(toolSpy).toHaveBeenCalledTimes(4);

      // Verify tool names
      const toolNames = toolSpy.mock.calls.map((call) => call[0]);
      expect(toolNames).toContain('list_books');
      expect(toolNames).toContain('get_book');
      expect(toolNames).toContain('get_book_structure');
      expect(toolNames).toContain('get_writing_stats');
    });

    it('should register list_books with correct description', () => {
      const toolSpy = vi.spyOn(server, 'tool');

      registerBookTools(server, mockClient as unknown as SlimaApiClient);

      const listBooksCall = toolSpy.mock.calls.find((call) => call[0] === 'list_books');
      expect(listBooksCall).toBeDefined();
      expect(listBooksCall?.[1]).toBe('List all books in your Slima library');
    });

    it('should register get_book with book_token parameter', () => {
      const toolSpy = vi.spyOn(server, 'tool');

      registerBookTools(server, mockClient as unknown as SlimaApiClient);

      const getBookCall = toolSpy.mock.calls.find((call) => call[0] === 'get_book');
      expect(getBookCall).toBeDefined();
      expect(getBookCall?.[2]).toHaveProperty('book_token');
    });

    it('should register get_book_structure with book_token parameter', () => {
      const toolSpy = vi.spyOn(server, 'tool');

      registerBookTools(server, mockClient as unknown as SlimaApiClient);

      const call = toolSpy.mock.calls.find((c) => c[0] === 'get_book_structure');
      expect(call).toBeDefined();
      expect(call?.[2]).toHaveProperty('book_token');
    });

    it('should register get_writing_stats with book_token parameter', () => {
      const toolSpy = vi.spyOn(server, 'tool');

      registerBookTools(server, mockClient as unknown as SlimaApiClient);

      const call = toolSpy.mock.calls.find((c) => c[0] === 'get_writing_stats');
      expect(call).toBeDefined();
      expect(call?.[2]).toHaveProperty('book_token');
    });
  });
});
