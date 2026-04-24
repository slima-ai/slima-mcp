/**
 * Script Studio write-protection awareness at the Tool layer.
 *
 * Every write tool (create_file / edit_file / write_file / delete_file /
 * append_to_file) must mention the Script Studio rule in its description or
 * `path` parameter description, otherwise the AI has no way to learn the
 * allowlist except by trial-and-error HTTP 400s.
 *
 * These tests capture the arguments passed to `server.tool()` so we can
 * assert the strings without running the MCP protocol end-to-end.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SlimaApiClient } from '../../src/core/api/client.js';
import { registerFileTools } from '../../src/core/tools/files.js';
import { registerBetaReaderTools } from '../../src/core/tools/beta-reader.js';

type ToolRegistration = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
};

function captureRegistrations(
  register: (server: McpServer, client: SlimaApiClient) => void
): ToolRegistration[] {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const registered: ToolRegistration[] = [];

  vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
    // Signature: tool(name, description, schema, annotations?, handler)
    const [name, description, schema] = args as [string, string, Record<string, unknown>];
    registered.push({ name, description, schema });
    return server;
  });

  register(server, {} as SlimaApiClient);
  return registered;
}

describe('file write tools — Script Studio awareness', () => {
  let registered: ToolRegistration[];

  beforeEach(() => {
    registered = captureRegistrations(registerFileTools);
  });

  const writeToolNames = ['create_file', 'write_file', 'edit_file', 'delete_file', 'append_to_file'];

  for (const toolName of writeToolNames) {
    describe(toolName, () => {
      it('has Script Studio section in tool description', () => {
        const tool = registered.find((t) => t.name === toolName);
        expect(tool, `${toolName} should be registered`).toBeDefined();
        expect(tool!.description).toMatch(/script studio/i);
        expect(tool!.description).toContain('.script_studio/planning');
      });

      it('references book_type on the description so the AI knows to check first', () => {
        const tool = registered.find((t) => t.name === toolName);
        expect(tool!.description).toMatch(/book_type/i);
      });
    });
  }

  it('read_file description stays unchanged (reads are unrestricted)', () => {
    const readTool = registered.find((t) => t.name === 'read_file');
    expect(readTool).toBeDefined();
    expect(readTool!.description).not.toMatch(/script studio/i);
  });

  it('search_content explains the default structured-file exclusion for script books', () => {
    const searchTool = registered.find((t) => t.name === 'search_content');
    expect(searchTool).toBeDefined();
    expect(searchTool!.description).toMatch(/script studio/i);
    expect(searchTool!.description).toContain('include_structured');
  });
});

describe('analyze_chapter — Script Studio awareness', () => {
  it('description mentions Script Studio is not supported', () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const registered: ToolRegistration[] = [];
    vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
      const [name, description, schema] = args as [string, string, Record<string, unknown>];
      registered.push({ name, description, schema });
      return server;
    });
    registerBetaReaderTools(server, {} as SlimaApiClient);

    const analyzeTool = registered.find((t) => t.name === 'analyze_chapter');
    expect(analyzeTool).toBeDefined();
    expect(analyzeTool!.description).toMatch(/script studio/i);
    expect(analyzeTool!.description).toMatch(/not (yet )?supported|not available/i);
  });
});
