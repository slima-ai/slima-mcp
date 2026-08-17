/**
 * `read_file` must tell the truth about a withheld or throttled file.
 *
 * Rails already answers correctly: a confidential team skill returns
 * `{ content: null, contentWithheld: true, withheldReason }` with wordCount
 * intact, and an over-budget read returns `{ throttled: true }`
 * (Phase KP §4.1/§4.4). This client declared neither field and rendered
 * `content || '(empty file)'`, so the model saw
 *
 *     **Words:** 1832
 *     ---
 *     (empty file)
 *
 * and reasonably concluded the file was broken — then tried to "fix" it by
 * writing to it, which is forbidden, so it retried. The whole "usable, not
 * readable" design was invisible on this side.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../../src/core/api/client.js';
import { registerFileTools } from '../../src/core/tools/files.js';

type Handler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}>;

describe('read_file on a withheld or throttled file', () => {
  let handlers: Map<string, Handler>;
  let mockClient: Partial<SlimaApiClient>;

  beforeEach(() => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    handlers = new Map();
    vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
      handlers.set(args[0] as string, args[args.length - 1] as Handler);
      return server;
    });
    mockClient = { readFile: vi.fn() };
    registerFileTools(server, mockClient as SlimaApiClient);
  });

  const read = () =>
    handlers.get('read_file')!({ book_token: 'bk_x', path: '.slima/skills/house-style.md' });

  const withheldResponse = {
    file: {
      name: 'house-style.md',
      path: '.slima/skills/house-style.md',
      wordCount: 1832,
      fileType: 'md',
      blobHash: null,
    },
    content: null,
    contentWithheld: true,
    withheldReason: 'confidential_skill',
  };

  it('says the content is withheld on purpose, never "(empty file)"', async () => {
    (mockClient.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(withheldResponse);

    const text = (await read()).content[0].text!;

    expect(text).not.toContain('(empty file)');
    expect(text).toMatch(/withheld|confidential/i);
  });

  it('tells the model not to try to repair it (that is what caused the retry loop)', async () => {
    (mockClient.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(withheldResponse);

    const text = (await read()).content[0].text!;

    expect(text).toMatch(/not an error|intentional|by design/i);
    expect(text).toMatch(/do not/i);
  });

  it('keeps the word count visible — a withheld file is not an empty one', async () => {
    (mockClient.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(withheldResponse);

    expect((await read()).content[0].text).toContain('1832');
  });

  it('is not an error result — the AI can still USE the skill, just not read it', async () => {
    (mockClient.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(withheldResponse);

    expect((await read()).isError).toBeFalsy();
  });

  it('reports a throttled read as a budget limit, not as missing content', async () => {
    (mockClient.readFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      file: { name: 'house-style.md', path: '.slima/skills/house-style.md', wordCount: 900 },
      content: null,
      throttled: true,
      throttledReason: 'daily_read_limit',
    });

    const text = (await read()).content[0].text!;

    expect(text).not.toContain('(empty file)');
    expect(text).toContain('daily_read_limit');
    expect(text).toMatch(/later|limit/i);
  });

  it('still renders a genuinely empty file as empty (regression)', async () => {
    (mockClient.readFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      file: { name: 'stub.md', path: 'stub.md', wordCount: 0, fileType: 'md' },
      content: '',
    });

    expect((await read()).content[0].text).toContain('(empty file)');
  });
});
