/**
 * Directory-listing guard: every tool the server advertises must carry what
 * Anthropic's connector review checks (claude.com/docs/connectors/building/
 * review-criteria, "Provide tool annotations" and "Separate read and write
 * tools"; checked 2026-10-22):
 *
 *   - a human-readable `title`
 *   - a `readOnlyHint`, and for tools that change data an explicit `destructiveHint`
 *   - a name of 64 characters or fewer
 *   - no catch-all tool that takes an HTTP `method`
 *
 * The check reads `tools/list` through a real MCP client, so it sees exactly what
 * the directory portal sees, and it covers every tool group. A new tool that is
 * registered without a title fails here (and fails at startup, see titles.ts).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createSlimaServer } from '../../src/cli/server.js';
import { TOOL_TITLES } from '../../src/core/tools/titles.js';

let tools: Tool[];
let client: Client;

beforeAll(async () => {
  const server = createSlimaServer({ apiToken: 'test_token', baseUrl: 'http://127.0.0.1:1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'listing-guard', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  tools = (await client.listTools()).tools;
});

afterAll(async () => {
  await client.close();
});

describe('tools/list as the directory portal reads it', () => {
  it('lists the full tool catalogue (guards against checking an empty list)', () => {
    expect(tools.length).toBeGreaterThanOrEqual(39);
  });

  it('gives every tool a human-readable title, top-level and in annotations', () => {
    for (const tool of tools) {
      expect(tool.title, `${tool.name}: title`).toBeTruthy();
      expect(tool.annotations?.title, `${tool.name}: annotations.title`).toBe(tool.title);
      // A title is for people: not the snake_case tool name in disguise.
      expect(tool.title, `${tool.name}: title must not be the tool name`).not.toMatch(/_/);
      expect(tool.title!.trim(), `${tool.name}: title has stray whitespace`).toBe(tool.title);
    }
  });

  it('gives every tool an explicit readOnlyHint', () => {
    for (const tool of tools) {
      expect(typeof tool.annotations?.readOnlyHint, `${tool.name}: readOnlyHint`).toBe('boolean');
    }
  });

  it('never marks a read-only tool destructive, and states destructiveHint for every writer', () => {
    for (const tool of tools) {
      const a = tool.annotations!;
      if (a.readOnlyHint) {
        expect(a.destructiveHint ?? false, `${tool.name}: read-only but destructive`).toBe(false);
      } else {
        expect(typeof a.destructiveHint, `${tool.name}: writer must state destructiveHint`).toBe('boolean');
      }
    }
  });

  it('marks destructiveHint truthfully: only tools that purely ADD are false, anything that overwrites, deletes or changes existing state is true', () => {
    // MCP spec: destructiveHint=false means the tool only performs additive updates.
    // Maintainer ruling 2026-10-22: update_*, delete_*, whole-file writes and edits, and the
    // comment status changes are true. Claude may ask the author once more before calling
    // them; that is accepted, and an honest annotation is what the directory review checks.
    // To add a tool to the additive list, it has to really leave existing content untouched.
    const ADDITIVE = new Set(['create_book', 'create_file', 'append_to_file', 'create_note', 'create_comment', 'analyze_chapter']);

    const writers = tools.filter((t) => !t.annotations?.readOnlyHint);
    expect(writers.length).toBeGreaterThanOrEqual(16);
    for (const tool of writers) {
      const expected = !ADDITIVE.has(tool.name);
      expect(tool.annotations?.destructiveHint, `${tool.name}: destructiveHint`).toBe(expected);
    }
  });

  it('keeps tool names within the 64-character limit', () => {
    for (const tool of tools) {
      expect(tool.name.length, tool.name).toBeLessThanOrEqual(64);
    }
  });

  it('has no catch-all tool that takes an HTTP method (reads and writes stay separate tools)', () => {
    for (const tool of tools) {
      const props = Object.keys((tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {});
      expect(props, `${tool.name}: has a method parameter`).not.toContain('method');
      expect(props, `${tool.name}: has an http_method parameter`).not.toContain('http_method');
    }
  });
});

describe('TOOL_TITLES', () => {
  it('names exactly the tools that are registered (no stale or missing entry)', () => {
    expect(Object.keys(TOOL_TITLES).sort()).toEqual(tools.map((t) => t.name).sort());
  });

  it('is applied by one shared registration used by both the CLI and the Worker', () => {
    for (const file of ['src/cli/server.ts', 'src/worker/mcp-handler.ts']) {
      const source = readFileSync(file, 'utf-8');
      expect(source, `${file} must call registerAllTools`).toMatch(/registerAllTools\(/);
      expect(source, `${file} registers a tool group directly`).not.toMatch(/register(Book|Teaching|Team|Workspace|Content|BetaReader|File|Structured)Tools\(/);
    }
  });
});
