/**
 * File Tools Handler Tests
 *
 * Tests for the actual handler functions of file tools
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../../src/api/client.js';
import { registerFileTools } from '../../src/tools/files.js';
import { NotFoundError, SlimaApiError } from '../../src/utils/errors.js';

describe('File Tools Handlers', () => {
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
      readFile: vi.fn(),
      createFile: vi.fn(),
      updateFile: vi.fn(),
      deleteFile: vi.fn(),
      appendToFile: vi.fn(),
      searchFiles: vi.fn(),
    };

    registerFileTools(server, mockClient as SlimaApiClient);
  });

  describe('read_file handler', () => {
    it('should return formatted file content', async () => {
      (mockClient.readFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        file: {
          name: 'chapter-01.md',
          path: 'chapters/chapter-01.md',
          wordCount: 500,
          fileType: 'markdown',
        },
        content: '# Chapter 1\n\nOnce upon a time...',
      });

      const handler = handlers.get('read_file')!;
      const result = await handler({ book_token: 'bk_test', path: 'chapters/chapter-01.md' });

      expect(result).toHaveProperty('content');
      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('chapter-01.md');
      expect(content[0].text).toContain('500');
      expect(content[0].text).toContain('Once upon a time');
    });

    it('should handle empty file', async () => {
      (mockClient.readFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        file: {
          name: 'empty.md',
          path: 'empty.md',
          wordCount: 0,
          fileType: 'markdown',
        },
        content: '',
      });

      const handler = handlers.get('read_file')!;
      const result = await handler({ book_token: 'bk_test', path: 'empty.md' });

      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('(empty file)');
    });

    it('should handle file not found error', async () => {
      (mockClient.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('File not found: nonexistent.md')
      );

      const handler = handlers.get('read_file')!;
      const result = await handler({ book_token: 'bk_test', path: 'nonexistent.md' });

      expect(result).toHaveProperty('isError', true);
      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('not found');
    });
  });

  describe('write_file handler', () => {
    it('should return success message with commit info', async () => {
      (mockClient.updateFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        commit: {
          token: 'cmt_abc123',
          name: 'Update chapter-01.md',
          message: 'Update chapter-01.md',
        },
      });

      const handler = handlers.get('write_file')!;
      const result = await handler({
        book_token: 'bk_test',
        path: 'chapter-01.md',
        content: 'New content',
        commit_message: 'Update chapter',
      });

      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('updated successfully');
      expect(content[0].text).toContain('cmt_abc123');
    });

    it('should handle update error', async () => {
      (mockClient.updateFile as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('File not found')
      );

      const handler = handlers.get('write_file')!;
      const result = await handler({
        book_token: 'bk_test',
        path: 'nonexistent.md',
        content: 'New content',
      });

      expect(result).toHaveProperty('isError', true);
    });
  });

  describe('edit_file handler', () => {
    it('should successfully edit file with search and replace', async () => {
      (mockClient.readFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        file: { name: 'chapter-01.md', path: 'chapter-01.md', wordCount: 100 },
        content: 'The quick brown fox jumps over the lazy dog.',
      });
      (mockClient.updateFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        commit: { token: 'cmt_edit123', name: 'Edit chapter-01.md' },
      });

      const handler = handlers.get('edit_file')!;
      const result = await handler({
        book_token: 'bk_test',
        path: 'chapter-01.md',
        old_string: 'brown fox',
        new_string: 'red fox',
      });

      expect(mockClient.updateFile).toHaveBeenCalledWith('bk_test', {
        path: 'chapter-01.md',
        content: 'The quick red fox jumps over the lazy dog.',
        commitMessage: 'Edit chapter-01.md',
      });

      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('✅ File edited successfully');
      expect(content[0].text).toContain('cmt_edit123');
    });

    it('should fail when old_string not found', async () => {
      (mockClient.readFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        file: { name: 'chapter-01.md', path: 'chapter-01.md', wordCount: 100 },
        content: 'Hello world',
      });

      const handler = handlers.get('edit_file')!;
      const result = await handler({
        book_token: 'bk_test',
        path: 'chapter-01.md',
        old_string: 'goodbye',
        new_string: 'hello',
      });

      expect(result).toHaveProperty('isError', true);
      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('Could not find the specified text');
    });

    it('should fail when multiple matches found (without replace_all)', async () => {
      (mockClient.readFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        file: { name: 'chapter-01.md', path: 'chapter-01.md', wordCount: 100 },
        content: 'The cat sat on the mat. The cat was happy.',
      });

      const handler = handlers.get('edit_file')!;
      const result = await handler({
        book_token: 'bk_test',
        path: 'chapter-01.md',
        old_string: 'cat',
        new_string: 'dog',
      });

      expect(result).toHaveProperty('isError', true);
      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('2 occurrences');
    });

    it('should replace all occurrences when replace_all is true', async () => {
      (mockClient.readFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        file: { name: 'chapter-01.md', path: 'chapter-01.md', wordCount: 100 },
        content: 'The cat sat on the mat. The cat was happy.',
      });
      (mockClient.updateFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        commit: { token: 'cmt_edit456', name: 'Edit chapter-01.md' },
      });

      const handler = handlers.get('edit_file')!;
      const result = await handler({
        book_token: 'bk_test',
        path: 'chapter-01.md',
        old_string: 'cat',
        new_string: 'dog',
        replace_all: true,
      });

      expect(mockClient.updateFile).toHaveBeenCalledWith('bk_test', {
        path: 'chapter-01.md',
        content: 'The dog sat on the mat. The dog was happy.',
        commitMessage: 'Edit chapter-01.md',
      });

      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('Replacements:** 2');
    });

    it('should handle file not found error', async () => {
      (mockClient.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('File not found')
      );

      const handler = handlers.get('edit_file')!;
      const result = await handler({
        book_token: 'bk_test',
        path: 'nonexistent.md',
        old_string: 'foo',
        new_string: 'bar',
      });

      expect(result).toHaveProperty('isError', true);
    });
  });

  describe('create_file handler', () => {
    it('should return success message with file token and commit', async () => {
      (mockClient.createFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        commit: {
          token: 'cmt_new123',
          name: 'Create new-file.md',
        },
        fileToken: 'fl_newfile',
      });

      const handler = handlers.get('create_file')!;
      const result = await handler({
        book_token: 'bk_test',
        path: 'new-file.md',
        content: 'Initial content',
      });

      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('created successfully');
      expect(content[0].text).toContain('fl_newfile');
      expect(content[0].text).toContain('cmt_new123');
    });

    it('should handle file already exists error', async () => {
      (mockClient.createFile as ReturnType<typeof vi.fn>).mockRejectedValue(
        new SlimaApiError(409, 'FILE_EXISTS', 'File already exists')
      );

      const handler = handlers.get('create_file')!;
      const result = await handler({
        book_token: 'bk_test',
        path: 'existing.md',
      });

      expect(result).toHaveProperty('isError', true);
    });

    it('should pass through parent folder not found error message from API', async () => {
      (mockClient.createFile as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('Parent folder not found: meta')
      );

      const handler = handlers.get('create_file')!;
      const result = await handler({
        book_token: 'bk_test',
        path: 'meta/overview.md',
      });

      expect(result).toHaveProperty('isError', true);
      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('Parent folder not found: meta');
    });
  });

  describe('delete_file handler', () => {
    it('should return success message with commit', async () => {
      (mockClient.deleteFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        commit: {
          token: 'cmt_del123',
          name: 'Delete old-file.md',
        },
      });

      const handler = handlers.get('delete_file')!;
      const result = await handler({
        book_token: 'bk_test',
        path: 'old-file.md',
      });

      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('deleted successfully');
      expect(content[0].text).toContain('cmt_del123');
    });

    it('should handle file not found error', async () => {
      (mockClient.deleteFile as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('File not found')
      );

      const handler = handlers.get('delete_file')!;
      const result = await handler({
        book_token: 'bk_test',
        path: 'nonexistent.md',
      });

      expect(result).toHaveProperty('isError', true);
    });
  });

  describe('append_to_file handler', () => {
    it('should return success message', async () => {
      (mockClient.appendToFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        commit: {
          token: 'cmt_app123',
          name: 'Append to notes.md',
        },
      });

      const handler = handlers.get('append_to_file')!;
      const result = await handler({
        book_token: 'bk_test',
        path: 'notes.md',
        content: '\n\nNew paragraph',
      });

      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('appended successfully');
      expect(content[0].text).toContain('cmt_app123');
    });
  });

  describe('search_content handler', () => {
    it('should return formatted search results', async () => {
      (mockClient.searchFiles as ReturnType<typeof vi.fn>).mockResolvedValue({
        matches: [
          {
            file: {
              path: 'chapter-01.md',
              wordCount: 500,
            },
            snippets: [
              { text: '...她有藍色眼睛和金色頭髮...' },
              { text: '...藍色眼睛閃爍著光芒...' },
            ],
            matchCount: 2,
          },
          {
            file: {
              path: 'characters.md',
              wordCount: 200,
            },
            snippets: [{ text: '...主角：藍色眼睛...' }],
            matchCount: 1,
          },
        ],
        query: '藍色眼睛',
      });

      const handler = handlers.get('search_content')!;
      const result = await handler({
        book_token: 'bk_test',
        query: '藍色眼睛',
      });

      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('Search Results');
      expect(content[0].text).toContain('藍色眼睛');
      expect(content[0].text).toContain('chapter-01.md');
      expect(content[0].text).toContain('characters.md');
      expect(content[0].text).toContain('2 file(s)');
    });

    it('should return no matches message when empty', async () => {
      (mockClient.searchFiles as ReturnType<typeof vi.fn>).mockResolvedValue({
        matches: [],
        query: 'xyz123',
      });

      const handler = handlers.get('search_content')!;
      const result = await handler({
        book_token: 'bk_test',
        query: 'xyz123',
      });

      const content = (result as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toContain('No matches found');
      expect(content[0].text).toContain('xyz123');
    });

    it('should handle search error', async () => {
      (mockClient.searchFiles as ReturnType<typeof vi.fn>).mockRejectedValue(
        new SlimaApiError(500, 'INTERNAL_ERROR', 'Search failed')
      );

      const handler = handlers.get('search_content')!;
      const result = await handler({
        book_token: 'bk_test',
        query: 'test',
      });

      expect(result).toHaveProperty('isError', true);
    });
  });
});
