/**
 * File Tools Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../../src/api/client.js';
import { registerFileTools } from '../../src/tools/files.js';

describe('File Tools', () => {
  let server: McpServer;
  let mockClient: {
    readFile: ReturnType<typeof vi.fn>;
    createFile: ReturnType<typeof vi.fn>;
    updateFile: ReturnType<typeof vi.fn>;
    deleteFile: ReturnType<typeof vi.fn>;
    appendToFile: ReturnType<typeof vi.fn>;
    searchFiles: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    server = new McpServer({
      name: 'test',
      version: '1.0.0',
    });

    mockClient = {
      readFile: vi.fn(),
      createFile: vi.fn(),
      updateFile: vi.fn(),
      deleteFile: vi.fn(),
      appendToFile: vi.fn(),
      searchFiles: vi.fn(),
    };
  });

  describe('registerFileTools', () => {
    it('should register tools without error', () => {
      expect(() => {
        registerFileTools(server, mockClient as unknown as SlimaApiClient);
      }).not.toThrow();
    });

    it('should register all 8 file-related tools', () => {
      const toolSpy = vi.spyOn(server, 'tool');

      registerFileTools(server, mockClient as unknown as SlimaApiClient);

      expect(toolSpy).toHaveBeenCalledTimes(8);

      const toolNames = toolSpy.mock.calls.map((call) => call[0]);
      expect(toolNames).toContain('read_file');
      expect(toolNames).toContain('write_file');
      expect(toolNames).toContain('edit_file');
      expect(toolNames).toContain('create_file');
      expect(toolNames).toContain('delete_file');
      expect(toolNames).toContain('append_to_file');
      expect(toolNames).toContain('search_content');
      expect(toolNames).toContain('view_relationship_map');
    });

    it('should register read_file with correct parameters', () => {
      const toolSpy = vi.spyOn(server, 'tool');

      registerFileTools(server, mockClient as unknown as SlimaApiClient);

      const call = toolSpy.mock.calls.find((c) => c[0] === 'read_file');
      expect(call).toBeDefined();
      expect(call?.[2]).toHaveProperty('book_token');
      expect(call?.[2]).toHaveProperty('path');
    });

    it('should register write_file with correct parameters', () => {
      const toolSpy = vi.spyOn(server, 'tool');

      registerFileTools(server, mockClient as unknown as SlimaApiClient);

      const call = toolSpy.mock.calls.find((c) => c[0] === 'write_file');
      expect(call).toBeDefined();
      expect(call?.[2]).toHaveProperty('book_token');
      expect(call?.[2]).toHaveProperty('path');
      expect(call?.[2]).toHaveProperty('content');
      expect(call?.[2]).toHaveProperty('commit_message');
    });

    it('should register edit_file with correct parameters', () => {
      const toolSpy = vi.spyOn(server, 'tool');

      registerFileTools(server, mockClient as unknown as SlimaApiClient);

      const call = toolSpy.mock.calls.find((c) => c[0] === 'edit_file');
      expect(call).toBeDefined();
      expect(call?.[2]).toHaveProperty('book_token');
      expect(call?.[2]).toHaveProperty('path');
      expect(call?.[2]).toHaveProperty('old_string');
      expect(call?.[2]).toHaveProperty('new_string');
      expect(call?.[2]).toHaveProperty('replace_all');
      expect(call?.[2]).toHaveProperty('commit_message');
    });

    it('should register create_file with correct parameters', () => {
      const toolSpy = vi.spyOn(server, 'tool');

      registerFileTools(server, mockClient as unknown as SlimaApiClient);

      const call = toolSpy.mock.calls.find((c) => c[0] === 'create_file');
      expect(call).toBeDefined();
      expect(call?.[2]).toHaveProperty('book_token');
      expect(call?.[2]).toHaveProperty('path');
      expect(call?.[2]).toHaveProperty('content');
      expect(call?.[2]).toHaveProperty('commit_message');
    });

    it('should register delete_file with correct parameters', () => {
      const toolSpy = vi.spyOn(server, 'tool');

      registerFileTools(server, mockClient as unknown as SlimaApiClient);

      const call = toolSpy.mock.calls.find((c) => c[0] === 'delete_file');
      expect(call).toBeDefined();
      expect(call?.[2]).toHaveProperty('book_token');
      expect(call?.[2]).toHaveProperty('path');
      expect(call?.[2]).toHaveProperty('commit_message');
      // Without this param the server's refusal has no escape hatch and the
      // model cannot delete a folder at all — the controller reads it, so a
      // client that never sends it makes the whole feature unreachable.
      expect(call?.[2]).toHaveProperty('recursive');
    });

    // The model asked to delete one path; several may have gone. Swallowing
    // that is the "formally succeeded, quietly did more" shape.
    it('tells the model when a folder delete took things with it', async () => {
      const toolSpy = vi.spyOn(server, 'tool');
      mockClient.deleteFile = vi.fn().mockResolvedValue({
        commit: { token: 'cmt_1', name: 'Delete folder' },
        deletedDescendants: 12,
      });

      registerFileTools(server, mockClient as unknown as SlimaApiClient);
      const handler = toolSpy.mock.calls.find((c) => c[0] === 'delete_file')?.[4] as (
        args: Record<string, unknown>
      ) => Promise<{ content: Array<{ text: string }> }>;
      const result = await handler({ book_token: 'bk_1', path: 'world', recursive: true });

      expect(result.content[0]!.text).toContain('12 item(s)');
      expect(result.content[0]!.text).toMatch(/tell the author/i);
      expect(mockClient.deleteFile).toHaveBeenCalledWith('bk_1', expect.objectContaining({ recursive: true }));
    });

    it('stays quiet when a plain file is deleted', async () => {
      const toolSpy = vi.spyOn(server, 'tool');
      mockClient.deleteFile = vi.fn().mockResolvedValue({
        commit: { token: 'cmt_1', name: 'Delete file' },
        deletedDescendants: 0,
      });

      registerFileTools(server, mockClient as unknown as SlimaApiClient);
      const handler = toolSpy.mock.calls.find((c) => c[0] === 'delete_file')?.[4] as (
        args: Record<string, unknown>
      ) => Promise<{ content: Array<{ text: string }> }>;
      const result = await handler({ book_token: 'bk_1', path: 'a.md' });

      expect(result.content[0]!.text).not.toMatch(/item\(s\) inside/);
    });

    it('should register append_to_file with correct parameters', () => {
      const toolSpy = vi.spyOn(server, 'tool');

      registerFileTools(server, mockClient as unknown as SlimaApiClient);

      const call = toolSpy.mock.calls.find((c) => c[0] === 'append_to_file');
      expect(call).toBeDefined();
      expect(call?.[2]).toHaveProperty('book_token');
      expect(call?.[2]).toHaveProperty('path');
      expect(call?.[2]).toHaveProperty('content');
      expect(call?.[2]).toHaveProperty('commit_message');
    });

    it('should register search_content with correct parameters', () => {
      const toolSpy = vi.spyOn(server, 'tool');

      registerFileTools(server, mockClient as unknown as SlimaApiClient);

      const call = toolSpy.mock.calls.find((c) => c[0] === 'search_content');
      expect(call).toBeDefined();
      expect(call?.[2]).toHaveProperty('book_token');
      expect(call?.[2]).toHaveProperty('query');
      expect(call?.[2]).toHaveProperty('file_types');
      expect(call?.[2]).toHaveProperty('limit');
    });
  });
});
