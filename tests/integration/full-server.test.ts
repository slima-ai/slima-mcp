/**
 * Integration Tests - Full Server
 *
 * These tests verify the complete server setup without mocking,
 * ensuring all tools are properly registered and configured.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../../src/api/client.js';
import { registerBookTools } from '../../src/tools/books.js';
import { registerContentTools } from '../../src/tools/content.js';
import { registerBetaReaderTools } from '../../src/tools/beta-reader.js';
import { registerFileTools } from '../../src/tools/files.js';

describe('Integration: Full Server Setup', () => {
  let server: McpServer;
  let toolSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    server = new McpServer({
      name: 'slima-test',
      version: '1.0.0',
    });
    toolSpy = vi.spyOn(server, 'tool');
  });

  describe('All tools registration', () => {
    it('should register all 15 tools across all modules', () => {
      const mockClient = {} as SlimaApiClient;

      // Register all tool groups
      registerBookTools(server, mockClient);
      registerContentTools(server, mockClient);
      registerBetaReaderTools(server, mockClient);
      registerFileTools(server, mockClient);

      // Expected total: 5 (books) + 1 (content) + 2 (beta-reader) + 7 (files) = 15
      expect(toolSpy).toHaveBeenCalledTimes(15);
    });

    it('should have all expected tool names', () => {
      const mockClient = {} as SlimaApiClient;

      registerBookTools(server, mockClient);
      registerContentTools(server, mockClient);
      registerBetaReaderTools(server, mockClient);
      registerFileTools(server, mockClient);

      const toolNames = toolSpy.mock.calls.map((call) => call[0]);

      // Book tools
      expect(toolNames).toContain('create_book');
      expect(toolNames).toContain('list_books');
      expect(toolNames).toContain('get_book');
      expect(toolNames).toContain('get_book_structure');
      expect(toolNames).toContain('get_writing_stats');

      // Content tools
      expect(toolNames).toContain('get_chapter');

      // Beta reader tools
      expect(toolNames).toContain('list_personas');
      expect(toolNames).toContain('analyze_chapter');

      // File tools
      expect(toolNames).toContain('read_file');
      expect(toolNames).toContain('write_file');
      expect(toolNames).toContain('edit_file');
      expect(toolNames).toContain('create_file');
      expect(toolNames).toContain('delete_file');
      expect(toolNames).toContain('append_to_file');
      expect(toolNames).toContain('search_content');
    });
  });

  describe('Tool descriptions', () => {
    it('should have meaningful descriptions for all tools', () => {
      const mockClient = {} as SlimaApiClient;

      registerBookTools(server, mockClient);
      registerContentTools(server, mockClient);
      registerBetaReaderTools(server, mockClient);
      registerFileTools(server, mockClient);

      // Each tool call should have a description (second argument)
      for (const call of toolSpy.mock.calls) {
        const [name, description] = call;
        expect(description).toBeDefined();
        expect(typeof description).toBe('string');
        expect(description.length).toBeGreaterThan(10);
      }
    });
  });

  describe('Tool parameters', () => {
    it('should have proper parameter schemas for file tools', () => {
      const mockClient = {} as SlimaApiClient;

      registerFileTools(server, mockClient);

      const fileToolCalls = toolSpy.mock.calls;

      // read_file should have book_token and path
      const readFile = fileToolCalls.find((c) => c[0] === 'read_file');
      expect(readFile?.[2]).toHaveProperty('book_token');
      expect(readFile?.[2]).toHaveProperty('path');

      // search_content should have book_token, query, file_types, limit
      const searchContent = fileToolCalls.find((c) => c[0] === 'search_content');
      expect(searchContent?.[2]).toHaveProperty('book_token');
      expect(searchContent?.[2]).toHaveProperty('query');
      expect(searchContent?.[2]).toHaveProperty('file_types');
      expect(searchContent?.[2]).toHaveProperty('limit');

      // write_file should have book_token, path, content, commit_message
      const writeFile = fileToolCalls.find((c) => c[0] === 'write_file');
      expect(writeFile?.[2]).toHaveProperty('book_token');
      expect(writeFile?.[2]).toHaveProperty('path');
      expect(writeFile?.[2]).toHaveProperty('content');
      expect(writeFile?.[2]).toHaveProperty('commit_message');
    });
  });
});

describe('Integration: API Client Methods', () => {
  it('should have all required methods for MCP file operations', () => {
    const client = new SlimaApiClient({
      token: 'test',
      baseUrl: 'http://localhost:3000',
    });

    // Verify all file operation methods exist
    expect(typeof client.readFile).toBe('function');
    expect(typeof client.createFile).toBe('function');
    expect(typeof client.updateFile).toBe('function');
    expect(typeof client.deleteFile).toBe('function');
    expect(typeof client.appendToFile).toBe('function');
    expect(typeof client.searchFiles).toBe('function');

    // Verify existing methods still work
    expect(typeof client.listBooks).toBe('function');
    expect(typeof client.getBook).toBe('function');
    expect(typeof client.listCommits).toBe('function');
    expect(typeof client.downloadBlobs).toBe('function');
    expect(typeof client.listPersonas).toBe('function');
    expect(typeof client.createReaderTest).toBe('function');
  });
});
