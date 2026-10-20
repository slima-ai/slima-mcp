/**
 * append_to_file: reply says what was written, a retry can be made safe with base_version,
 * and the description tells the model to read before resending. Plus the openWorldHint
 * definition for the author's own workspace tools.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SlimaApiClient } from '../../src/api/client.js';
import { registerFileTools } from '../../src/tools/files.js';
import {
  registerBookTools,
  registerContentTools,
  registerStructuredTools,
  registerTeachingTools,
  registerTeamTools,
  registerWorkspaceTools,
} from '../../src/core/tools/index.js';

type Handler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

interface Registered {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  annotations: { openWorldHint?: boolean } | undefined;
  handler: Handler;
}

function capture(server: McpServer): Map<string, Registered> {
  const tools = new Map<string, Registered>();
  vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
    const name = args[0] as string;
    const description = typeof args[1] === 'string' ? args[1] : '';
    const schema = (args.find((a, i) => i > 0 && typeof a === 'object' && a !== null && !('readOnlyHint' in (a as object))) ??
      {}) as Record<string, unknown>;
    const annotations = args.find(
      (a) => typeof a === 'object' && a !== null && ('readOnlyHint' in (a as object) || 'openWorldHint' in (a as object))
    ) as Registered['annotations'];
    tools.set(name, { name, description, schema, annotations, handler: args[args.length - 1] as Handler });
    return server;
  });
  return tools;
}

describe('append_to_file', () => {
  let tools: Map<string, Registered>;
  let client: { readFile: ReturnType<typeof vi.fn>; appendToFile: ReturnType<typeof vi.fn> };
  const COMMIT = { commit: { token: 'cmt_new', name: 'Append to notes.md' } };

  beforeEach(() => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    tools = capture(server);
    client = { readFile: vi.fn(), appendToFile: vi.fn().mockResolvedValue(COMMIT) };
    registerFileTools(server, client as unknown as SlimaApiClient);
  });

  const run = (params: Record<string, unknown>) =>
    tools.get('append_to_file')!.handler({ book_token: 'bk_t', path: 'notes.md', ...params });

  it('reply says how many characters were appended, how long the file is now, and its new version', async () => {
    client.readFile.mockResolvedValue({
      file: { path: 'notes.md', wordCount: 321, blobHash: 'h_after' },
      content: '前面的內容。\n\n新的一段',
    });
    const result = await run({ content: '\n\n新的一段' });
    const text = result.content[0]!.text;
    expect(result.isError).toBeUndefined();
    expect(text).toContain('Content appended successfully.');
    expect(text).toContain('cmt_new');
    expect(text).toContain('Appended: 6 characters');
    expect(text).toContain('File now: 12 characters (Slima word count: 321)');
    expect(text).toContain('Version: h_after');
    expect(text).toContain('base_version');
  });

  it('counts emoji and Chinese as one character each, not as UTF-16 units', async () => {
    client.readFile.mockResolvedValue({ file: { wordCount: 1, blobHash: 'h' }, content: '😀' });
    const result = await run({ content: '😀字' });
    expect(result.content[0]!.text).toContain('Appended: 2 characters');
    expect(result.content[0]!.text).toContain('File now: 1 characters');
  });

  it('the append already happened: a failed read-back does not turn the reply into an error', async () => {
    client.readFile.mockRejectedValue(new Error('network'));
    const result = await run({ content: 'abc' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('Content appended successfully.');
    expect(result.content[0]!.text).toContain('Could not read the file back');
    expect(client.appendToFile).toHaveBeenCalledTimes(1);
  });

  it('no base_version: appends without checking first (one read, after the append)', async () => {
    client.readFile.mockResolvedValue({ file: { blobHash: 'h' }, content: 'x' });
    await run({ content: 'abc' });
    expect(client.appendToFile).toHaveBeenCalledTimes(1);
    expect(client.readFile).toHaveBeenCalledTimes(1);
  });

  it('base_version still matches: appends', async () => {
    client.readFile.mockResolvedValue({ file: { blobHash: 'h_same' }, content: 'x' });
    const result = await run({ content: 'abc', base_version: 'h_same' });
    expect(client.appendToFile).toHaveBeenCalledTimes(1);
    expect(result.content[0]!.text).toContain('Content appended successfully.');
  });

  it('file already newer than base_version: nothing appended, told to read_file first', async () => {
    client.readFile.mockResolvedValue({ file: { blobHash: 'h_newer' }, content: 'x' });
    const result = await run({ content: 'abc', base_version: 'h_old' });
    expect(client.appendToFile).not.toHaveBeenCalled();
    const text = result.content[0]!.text;
    expect(text).toContain('Nothing was appended.');
    expect(text).toContain('h_old');
    expect(text).toContain('h_newer');
    expect(text).toContain('read_file');
    expect(result.isError).toBeUndefined();
  });

  it('base_version given but the file has no version to compare (e.g. withheld): appends as before', async () => {
    client.readFile.mockResolvedValue({ file: { blobHash: null }, content: null });
    await run({ content: 'abc', base_version: 'h_old' });
    expect(client.appendToFile).toHaveBeenCalledTimes(1);
  });

  it('the check itself failing (file missing) is reported as an error and nothing is appended', async () => {
    client.readFile.mockRejectedValue(new Error('File not found: notes.md'));
    const result = await run({ content: 'abc', base_version: 'h_old' });
    expect(result.isError).toBe(true);
    expect(client.appendToFile).not.toHaveBeenCalled();
  });

  it('description tells the model to read_file before resending when blocked or unsure; base_version is optional', () => {
    const tool = tools.get('append_to_file')!;
    expect(tool.description).toMatch(/blocked/);
    expect(tool.description).toMatch(/read_file/);
    expect(tool.description).toMatch(/base_version/);
    expect(tool.schema).toHaveProperty('base_version');
    const field = tool.schema.base_version as { isOptional?: () => boolean };
    expect(field.isOptional?.()).toBe(true);
  });
});

describe('read_file shows the version', () => {
  it('prints the version so it can be passed as base_version; omitted when the server gives none', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = capture(server);
    const client = { readFile: vi.fn() };
    registerFileTools(server, client as unknown as SlimaApiClient);
    const read = tools.get('read_file')!.handler;
    client.readFile.mockResolvedValue({ file: { name: 'a.md', path: 'a.md', wordCount: 1, blobHash: 'h_1' }, content: 'x' });
    expect((await read({ book_token: 'bk', path: 'a.md' })).content[0]!.text).toContain('**Version:** h_1');
    client.readFile.mockResolvedValue({ file: { name: 'a.md', path: 'a.md', wordCount: 1 }, content: 'x' });
    expect((await read({ book_token: 'bk', path: 'a.md' })).content[0]!.text).not.toContain('Version:');
  });
});

describe('openWorldHint', () => {
  it("the author's own workspace tools say they do not reach the open world; shared team and guide tools are left as they were", () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = capture(server);
    const client = {} as SlimaApiClient;
    registerBookTools(server, client);
    registerContentTools(server, client);
    registerFileTools(server, client);
    registerStructuredTools(server, client);
    registerWorkspaceTools(server, client);
    expect(tools.size).toBeGreaterThan(10);
    for (const tool of tools.values()) {
      expect(tool.annotations?.openWorldHint, tool.name).toBe(false);
    }

    const shared = new McpServer({ name: 'test', version: '1.0.0' });
    const sharedTools = capture(shared);
    registerTeamTools(shared, client);
    registerTeachingTools(shared, client);
    for (const tool of sharedTools.values()) {
      expect(tool.annotations?.openWorldHint, tool.name).toBe(true);
    }
  });
});
