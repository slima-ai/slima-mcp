/**
 * `edit_file` must delegate to Rails, not do read-modify-write in this process.
 *
 * The old client-side implementation read the file, ran String.replace locally,
 * then blind-wrote the WHOLE file back — so "✅ Replacements: 1" was a number this
 * process made up, unrelated to what the server stored. Two concurrent edits both
 * read the same stale content, the second overwrote the first, and both callers
 * were told they succeeded. Rails' `POST /mcp/files/edit` re-reads inside the
 * branch lock and returns the count it actually applied (iss_gkqwnovhajzl7xvz).
 *
 * These tests pin the delegation itself: if anyone reintroduces a local
 * read-modify-write, `readFile`/`updateFile` start being called again and the
 * reported count stops coming from the server.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../../src/core/api/client.js';
import { registerFileTools } from '../../src/core/tools/files.js';
import { SlimaApiError } from '../../src/core/utils/errors.js';

type Handler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}>;

describe('edit_file delegates to the server', () => {
  let handlers: Map<string, Handler>;
  let mockClient: Partial<SlimaApiClient>;

  beforeEach(() => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    handlers = new Map();
    vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
      handlers.set(args[0] as string, args[args.length - 1] as Handler);
      return server;
    });
    mockClient = {
      editFile: vi.fn(),
      readFile: vi.fn(),
      updateFile: vi.fn(),
    };
    registerFileTools(server, mockClient as SlimaApiClient);
  });

  const edit = (args: Record<string, unknown> = {}) =>
    handlers.get('edit_file')!({
      book_token: 'bk_x',
      path: 'chapters/ch01.md',
      old_string: 'old',
      new_string: 'new',
      ...args,
    });

  it('calls the edit endpoint and never reads-then-writes locally', async () => {
    (mockClient.editFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      commit: { token: 'cmt_1', name: 'Edit' },
      replacements: 1,
    });

    await edit();

    expect(mockClient.editFile).toHaveBeenCalledWith('bk_x', {
      path: 'chapters/ch01.md',
      oldString: 'old',
      newString: 'new',
      replaceAll: undefined,
      commitMessage: undefined,
    });
    expect(mockClient.readFile).not.toHaveBeenCalled();
    expect(mockClient.updateFile).not.toHaveBeenCalled();
  });

  it("reports the SERVER's replacement count, not a locally computed one", async () => {
    (mockClient.editFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      commit: { token: 'cmt_1', name: 'Edit' },
      replacements: 7,
    });

    const result = await edit({ replace_all: true });

    expect(result.content[0].text).toContain('7');
    expect(result.content[0].text).toContain('cmt_1');
  });

  it('passes replace_all through instead of deciding locally', async () => {
    (mockClient.editFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      commit: { token: 'cmt_1' },
      replacements: 3,
    });

    await edit({ replace_all: true, commit_message: 'tidy' });

    expect(mockClient.editFile).toHaveBeenCalledWith(
      'bk_x',
      expect.objectContaining({ replaceAll: true, commitMessage: 'tidy' })
    );
  });

  // Rails' messages for these are already written for an AI reader ("read it
  // again — another write may have changed it since"). Passing them through beats
  // any wording invented here, so the test pins the pass-through, not a rewrite.
  it.each([
    ['EDIT_STRING_NOT_FOUND', 'Could not find the specified text in chapters/ch01.md. If you read this file earlier, read it again — another write may have changed it since.'],
    ['EDIT_STRING_AMBIGUOUS', 'Found 4 occurrences of the text in chapters/ch01.md. Provide a longer, unique segment or set replace_all.'],
    ['INVALID_EDIT_ARGUMENTS', 'new_string is required (pass an empty string to delete)'],
  ])('surfaces the server message for %s', async (code, message) => {
    (mockClient.editFile as ReturnType<typeof vi.fn>).mockRejectedValue(
      new SlimaApiError(422, code, message)
    );

    const result = await edit();

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(message);
  });
});
