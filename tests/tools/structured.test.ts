/**
 * Structured-file tools.
 *
 * These three are the only write path for `.beats` / `.timeline` / `.script`,
 * so the things worth pinning are not "does it call the client" but:
 *   - the names start with a verb (the desktop agent's write detection)
 *   - the new ids come back (otherwise the model re-reads the file to learn
 *     what it just made)
 *   - side effects the model did not ask for are surfaced, not swallowed
 *   - a server error reaches the model verbatim (Rails' messages already say
 *     what to do next; summarising them away is what makes a model retry)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerStructuredTools } from '../../src/core/tools/structured.js';
import type { SlimaApiClient } from '../../src/core/api/client.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

describe('Structured file tools', () => {
  let server: McpServer;
  let registered: Map<string, { description: string; handler: ToolHandler }>;
  let client: { applyStructuredOps: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '1.0.0' });
    registered = new Map();

    vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
      const [name, description, , , handler] = args as [string, string, unknown, unknown, ToolHandler];
      registered.set(name, { description, handler });
      return undefined as never;
    });

    client = { applyStructuredOps: vi.fn() };
    registerStructuredTools(server, client as unknown as SlimaApiClient);
  });

  const ok = (over: Partial<{ applied: unknown[]; notes: string[] }> = {}) => ({
    commit: { token: 'cmt_1' },
    applied: over.applied ?? [{ op: 'add_act', id: 'a1' }],
    notes: over.notes ?? [],
  });

  it('registers one tool per structured type', () => {
    expect([...registered.keys()]).toEqual([
      'update_beat_board',
      'update_timeline',
      'update_script',
      'update_relationship_map',
      'update_world_map',
    ]);
  });

  // The desktop agent decides whether to ask a human by the verb prefix.
  // `beats_batch` would not read as a write — that is why these are not named
  // after the in-app tool group.
  it('names every tool with a write verb the desktop agent recognises', () => {
    const VERBS = /^(write|create|edit|append|delete|update|remove|move|rename|restore)_/;
    for (const name of registered.keys()) expect(name).toMatch(VERBS);
  });

  it('tells the model this is the only write path for the type', () => {
    const description = registered.get('update_beat_board')!.description;
    expect(description).toMatch(/ONLY way to write this file type/i);
    expect(description).toMatch(/`write_file` and `edit_file`\s*\n?are refused/i);
  });

  // MCP has no review panel. Reusing the in-app wording ("confirm it in the
  // review panel") would be a plain lie here.
  it('does not promise a review panel that does not exist over MCP', () => {
    for (const { description } of registered.values()) {
      // 「有一個審查面板等你確認」是站內的話術，在 MCP 是假的 —— 變更直接落 commit。
      expect(description).not.toMatch(/confirm it in the review panel/i);
      expect(description).toMatch(/no review panel/i);
    }
  });

  it('sends the operations through untouched', async () => {
    client.applyStructuredOps.mockResolvedValue(ok());
    const operations = [{ op: 'add_act', name: 'Act Two', op_ref: 'A2' }];

    await registered.get('update_beat_board')!.handler({
      book_token: 'bk_1',
      path: 'plan/board.beats',
      intent: 'split act two out',
      operations,
    });

    expect(client.applyStructuredOps).toHaveBeenCalledWith('bk_1', {
      path: 'plan/board.beats',
      intent: 'split act two out',
      operations,
    });
  });

  it('reports the new ids so the model does not have to re-read the file', async () => {
    client.applyStructuredOps.mockResolvedValue(
      ok({ applied: [{ op: 'add_act', id: 'a1', op_ref: 'A2' }, { op: 'add_beat', id: 'r1' }] })
    );

    const result = await registered.get('update_beat_board')!.handler({
      book_token: 'bk_1',
      path: 'b.beats',
      intent: 'x',
      operations: [],
    });

    expect(result.content[0]!.text).toContain('a1');
    expect(result.content[0]!.text).toContain('r1');
    expect(result.content[0]!.text).toContain('@A2');
  });

  // The model only knows about the operations it sent. The author sees the rest.
  it('surfaces side effects the model did not ask for', async () => {
    client.applyStructuredOps.mockResolvedValue(
      ok({ applied: [{ op: 'remove_act' }], notes: ['removed act a1: 3 beat(s) are now unassigned'] })
    );

    const result = await registered.get('update_beat_board')!.handler({
      book_token: 'bk_1',
      path: 'b.beats',
      intent: 'x',
      operations: [],
    });

    expect(result.content[0]!.text).toMatch(/tell the author/i);
    expect(result.content[0]!.text).toContain('3 beat(s) are now unassigned');
  });

  it('stays quiet when there is nothing extra to report', async () => {
    client.applyStructuredOps.mockResolvedValue(ok());
    const result = await registered.get('update_timeline')!.handler({
      book_token: 'bk_1',
      path: 'main.timeline',
      intent: 'x',
      operations: [],
    });

    expect(result.content[0]!.text).not.toMatch(/tell the author/i);
  });

  // Rails' errors for these already list the real ids and name which operation
  // owns a field. Summarising them is what turns one round trip into three.
  it('passes a server error through verbatim', async () => {
    client.applyStructuredOps.mockRejectedValue(
      new Error('no beat with id `nope` in this file. Existing beat ids: r1, r2.')
    );

    const result = await registered.get('update_beat_board')!.handler({
      book_token: 'bk_1',
      path: 'b.beats',
      intent: 'x',
      operations: [],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('r1, r2');
  });
});
