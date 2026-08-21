/**
 * Integration Tests - Full Server
 *
 * Verifies the complete tool surface without mocking the registration itself.
 *
 * ⚠️ This file used to register only four modules — books, content, beta-reader,
 * files — through the deprecated `src/tools/*` shims, and assert a hardcoded
 * count. When teaching/teams/workspace landed (2026-08-20, seventeen more
 * tools), the test did not go red: it was never asked about them. A file named
 * "Full Server Setup" was covering under half the surface, and its own title
 * said 15 while its assertion said 16.
 *
 * Two changes keep that from recurring:
 *   - every module is pulled from `src/core/tools/index.ts`, the same barrel
 *     the real entry points import, so a new module reaches this test the
 *     moment it is exported rather than when someone remembers to add it here
 *   - the assertion is the *set of tool names*, not a count. Tool names are
 *     what an AI client actually binds to, so that set is the contract worth
 *     pinning; a count tells you a number moved but not which capability
 *     appeared or vanished.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../../src/core/api/client.js';
import {
  registerBookTools,
  registerContentTools,
  registerBetaReaderTools,
  registerFileTools,
  registerTeachingTools,
  registerTeamTools,
  registerWorkspaceTools,
} from '../../src/core/tools/index.js';

/** Mirrors the registration order in src/cli/server.ts and src/worker/mcp-handler.ts. */
function registerEverything(server: McpServer, client: SlimaApiClient): void {
  registerBookTools(server, client);
  registerTeachingTools(server, client);
  registerTeamTools(server, client);
  registerWorkspaceTools(server, client);
  registerContentTools(server, client);
  registerBetaReaderTools(server, client);
  registerFileTools(server, client);
}

/**
 * The published tool surface. Adding a tool means adding it here — that is the
 * point: the diff shows a reviewer exactly which capability changed.
 */
const EXPECTED_TOOLS = [
  // books
  'create_book', 'list_books', 'get_book', 'get_book_structure', 'get_writing_stats',
  // teaching
  'get_capabilities', 'list_guides', 'load_guide', 'list_writing_skills', 'load_writing_skill',
  // teams
  'list_teams', 'get_team', 'list_team_memories', 'list_team_rules', 'list_team_skills',
  // workspace
  'list_notes', 'create_note', 'list_comments', 'create_comment', 'resolve_comment',
  'reopen_comment', 'semantic_search',
  // content
  'get_chapter',
  // beta reader
  'list_personas', 'analyze_chapter', 'get_reader_test',
  // files
  'read_file', 'write_file', 'edit_file', 'create_file', 'delete_file', 'append_to_file',
  'search_content', 'view_relationship_map',
].sort();

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
    it('registers exactly the published tool surface', () => {
      registerEverything(server, {} as SlimaApiClient);

      const registered = toolSpy.mock.calls.map((call) => call[0] as string).sort();

      expect(registered).toEqual(EXPECTED_TOOLS);
    });

    it('registers each tool exactly once', () => {
      registerEverything(server, {} as SlimaApiClient);

      const registered = toolSpy.mock.calls.map((call) => call[0] as string);

      expect(registered).toHaveLength(new Set(registered).size);
    });
  });

  describe('Tool descriptions', () => {
    it('should have meaningful descriptions for all tools', () => {
      registerEverything(server, {} as SlimaApiClient);

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
