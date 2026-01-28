/**
 * MCP Integration Tests
 *
 * Tests the full MCP protocol flow using the Worker.
 * These tests verify that the MCP transport is correctly implemented.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleMcpRequest, McpHandlerOptions } from '../../src/worker/mcp-handler.js';

// Mock the API client
vi.mock('../../src/core/api/client.js', () => ({
  SlimaApiClient: vi.fn().mockImplementation(() => ({
    listBooks: vi.fn().mockResolvedValue([
      { token: 'bk_test1', title: 'Test Book 1', totalWordCount: 1000 },
    ]),
    getBook: vi.fn().mockResolvedValue({
      token: 'bk_test1',
      title: 'Test Book 1',
      totalWordCount: 1000,
    }),
    createBook: vi.fn().mockResolvedValue({
      token: 'bk_new',
      title: 'New Book',
    }),
  })),
}));

describe('MCP Integration Tests', () => {
  const mockOptions: McpHandlerOptions = {
    apiUrl: 'https://api.slima.ai',
    getToken: async () => 'slima_test_token',
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };

  // MCP Streamable HTTP requires these headers
  const mcpHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };

  describe('Initialize Request', () => {
    it('returns server info and capabilities', async () => {
      // Explicitly create headers to ensure proper case handling
      const headers = new Headers();
      headers.set('Content-Type', 'application/json');
      headers.set('Accept', 'application/json, text/event-stream');

      const request = new Request('https://mcp.slima.ai/mcp', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
          id: 1,
        }),
      });

      const response = await handleMcpRequest(request, mockOptions);

      expect(response.status).toBe(200);

      const text = await response.text();
      // Response should be JSON with server info
      expect(text).toContain('slima');
    });
  });

  describe('Tools List Request', () => {
    it('returns all registered tools', async () => {
      const headers = new Headers();
      headers.set('Content-Type', 'application/json');
      headers.set('Accept', 'application/json, text/event-stream');

      const request = new Request('https://mcp.slima.ai/mcp', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 2,
        }),
      });

      const response = await handleMcpRequest(request, mockOptions);

      expect(response.status).toBe(200);

      const text = await response.text();
      // Should contain tool names
      expect(text).toContain('list_books');
      expect(text).toContain('create_book');
    });
  });

  describe('Tools Call Request', () => {
    it('executes list_books tool', async () => {
      const headers = new Headers();
      headers.set('Content-Type', 'application/json');
      headers.set('Accept', 'application/json, text/event-stream');

      const request = new Request('https://mcp.slima.ai/mcp', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: 'list_books',
            arguments: {},
          },
          id: 3,
        }),
      });

      const response = await handleMcpRequest(request, mockOptions);

      expect(response.status).toBe(200);

      const text = await response.text();
      // Should contain book info from mock
      expect(text).toContain('Test Book 1');
    });

    it('returns error for unknown tool', async () => {
      const request = new Request('https://mcp.slima.ai/mcp', {
        method: 'POST',
        headers: mcpHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: 'nonexistent_tool',
            arguments: {},
          },
          id: 4,
        }),
      });

      const response = await handleMcpRequest(request, mockOptions);

      const text = await response.text();
      // Should contain error
      expect(text).toContain('error');
    });
  });

  describe('Error Handling', () => {
    it('handles invalid JSON gracefully', async () => {
      const request = new Request('https://mcp.slima.ai/mcp', {
        method: 'POST',
        headers: mcpHeaders,
        body: 'invalid json {{{',
      });

      const response = await handleMcpRequest(request, mockOptions);

      // Should return error response, not crash
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('handles missing method gracefully', async () => {
      const request = new Request('https://mcp.slima.ai/mcp', {
        method: 'POST',
        headers: mcpHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 5,
        }),
      });

      const response = await handleMcpRequest(request, mockOptions);

      const text = await response.text();
      expect(text).toContain('error');
    });
  });

  describe('HTTP Methods', () => {
    it('handles GET request for SSE stream', async () => {
      const request = new Request('https://mcp.slima.ai/mcp', {
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
        },
      });

      const response = await handleMcpRequest(request, mockOptions);

      // GET without session should return error or start SSE
      expect([200, 400]).toContain(response.status);
    });

    it('handles DELETE request for session termination', async () => {
      const request = new Request('https://mcp.slima.ai/mcp', {
        method: 'DELETE',
      });

      const response = await handleMcpRequest(request, mockOptions);

      // DELETE in stateless mode should return appropriate response
      expect(response.status).toBeGreaterThanOrEqual(200);
    });
  });
});

describe('Tool Registration', () => {
  const mockOptions: McpHandlerOptions = {
    apiUrl: 'https://api.slima.ai',
    getToken: async () => 'slima_test_token',
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };

  it('registers at least 14 tools', async () => {
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('Accept', 'application/json, text/event-stream');

    const request = new Request('https://mcp.slima.ai/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
      }),
    });

    const response = await handleMcpRequest(request, mockOptions);
    expect(response.status).toBe(200);

    const text = await response.text();

    // Count tool occurrences (each tool should have a "name" field)
    const toolNames = [
      'create_book',
      'list_books',
      'get_book',
      'get_book_structure',
      'get_writing_stats',
      'get_chapter',
      'list_personas',
      'analyze_chapter',
      'read_file',
      'write_file',
      'edit_file',
      'create_file',
      'delete_file',
      'append_to_file',
      'search_content',
    ];

    let foundCount = 0;
    for (const name of toolNames) {
      if (text.includes(name)) {
        foundCount++;
      }
    }

    expect(foundCount).toBeGreaterThanOrEqual(14);
  });
});
