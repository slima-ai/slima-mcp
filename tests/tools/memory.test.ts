/**
 * Coach memory over MCP (iss_vxkolpj3ykes4cgu).
 *
 * What is worth pinning here is not "does it call the client" but:
 *   - account memory and book memory are printed apart, and an account `goals` entry carries the
 *     legacy note (Rails 6rdop9om: an old account goal was called "this book's goal")
 *   - field names come back in the form add_memory accepts (Rails camelCases the read)
 *   - every write goes to the right endpoint for its layer, and book memory demands a book
 *   - server refusals reach the model verbatim (they say what to do next)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMemoryTools, renderMemory, LEGACY_GOAL_NOTE, toFieldName } from '../../src/core/tools/memory.js';
import { memoryBase, type SlimaApiClient } from '../../src/core/api/client.js';

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;

describe('Coach memory tools', () => {
  let tools: Map<string, Handler>;
  let client: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    tools = new Map();
    vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
      tools.set(args[0] as string, args[4] as Handler);
      return undefined as never;
    });
    client = {
      getAccountMemory: vi.fn(),
      getBookMemory: vi.fn(),
      addMemory: vi.fn(),
      editMemory: vi.fn(),
      deleteMemory: vi.fn(),
      restoreMemory: vi.fn(),
    };
    registerMemoryTools(server, client as unknown as SlimaApiClient);
  });

  it('registers the five tools', () => {
    expect([...tools.keys()].sort()).toEqual(
      ['add_memory', 'delete_memory', 'edit_memory', 'get_ai_memory', 'restore_memory'].sort()
    );
  });

  it('prints account memory and book memory under separate headings, with the legacy goal note', () => {
    const out = renderMemory(
      { writingStudio: { writingStyle: [{ id: 'a1', text: '偏好短句' }], goals: [{ id: 'a2', text: '六月前完成初稿' }] } },
      { worldRules: [{ id: 'b1', text: '魔法有代價' }] }
    );

    const [accountPart, bookPart] = out.split('## This book');
    expect(accountPart).toContain('Account memory');
    expect(accountPart).toContain('偏好短句');
    expect(accountPart).toContain(`六月前完成初稿${LEGACY_GOAL_NOTE}`);
    expect(bookPart).toContain('魔法有代價');
    expect(bookPart).not.toContain('偏好短句');
  });

  it('shows field names the way add_memory accepts them', () => {
    expect(toFieldName('worldRules')).toBe('world_rules');
    expect(renderMemory({}, { characterVoices: [{ id: 'x', text: 't' }] })).toContain('### character_voices');
  });

  it('marks deleted entries as restorable', () => {
    const out = renderMemory({}, { decisions: [{ id: 'd1', text: '不寫配角視角', deletedAt: '2026-11-15T00:00:00Z' }] });
    expect(out).toMatch(/restore_memory/);
  });

  it('get_ai_memory reads both layers', async () => {
    client.getAccountMemory!.mockResolvedValue({});
    client.getBookMemory!.mockResolvedValue({ worldRules: [{ id: 'b1', text: '魔法有代價' }] });

    const res = await tools.get('get_ai_memory')!({ book_token: 'bk_1' });

    expect(client.getBookMemory).toHaveBeenCalledWith('bk_1', undefined);
    expect(res.content[0]!.text).toContain('魔法有代價');
  });

  it('add_memory passes layer / book / field / text through', async () => {
    client.addMemory!.mockResolvedValue({ id: 'n1', text: '魔法有代價' });

    const res = await tools.get('add_memory')!({ layer: 'book', book_token: 'bk_1', field: 'world_rules', text: '魔法有代價' });

    expect(client.addMemory).toHaveBeenCalledWith({ layer: 'book', bookToken: 'bk_1', field: 'world_rules', text: '魔法有代價' });
    expect(res.content[0]!.text).toContain('[n1]');
  });

  it('passes a refusal through verbatim', async () => {
    client.addMemory!.mockRejectedValue(new Error('world_rules already has 10 entries. Delete or merge one first'));

    const res = await tools.get('add_memory')!({ layer: 'book', book_token: 'bk_1', field: 'world_rules', text: 'x' });

    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('Delete or merge one first');
  });

  it('routes each layer to its own endpoint, and book memory needs a book', () => {
    expect(memoryBase({ layer: 'account' })).toBe('/api/v1/users/me/ai-memory');
    expect(memoryBase({ layer: 'book', bookToken: 'bk_1' })).toBe('/api/v1/books/bk_1/ai-memory');
    expect(() => memoryBase({ layer: 'book' })).toThrow(/book_token/);
  });
});
