/**
 * `get_writing_stats` must not invent a progress metric.
 *
 * It reported "Recent Progress" as
 *   latest commit totalWordCount − oldest-of-the-last-10 totalWordCount
 * which is a third word-count algorithm, agreeing with neither the backend's
 * authoritative WritingStats::QueryService (today's delta, computed from commits
 * with cleanup-safe baselines) nor the frontend's. Worse, it is not stable:
 * CommitCleanupJob prunes intra-day auto commits older than 30 days, so "the
 * last 10 commits" covers a different span every time it is asked and the same
 * book yields a different "progress" week to week.
 *
 * The book's own totals ARE authoritative (Rails computes them from the head
 * snapshot). Daily words / streak are account-level and simply not available
 * here, so the tool says so instead of approximating.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../../src/core/api/client.js';
import { registerBookTools } from '../../src/core/tools/books.js';

type Handler = (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

describe('get_writing_stats', () => {
  let handlers: Map<string, Handler>;
  let descriptions: Map<string, string>;
  let mockClient: Partial<SlimaApiClient>;

  beforeEach(() => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    handlers = new Map();
    descriptions = new Map();
    vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
      handlers.set(args[0] as string, args[args.length - 1] as Handler);
      descriptions.set(args[0] as string, args[1] as string);
      return server;
    });
    mockClient = {
      getBook: vi.fn().mockResolvedValue({
        token: 'bk_x',
        title: '姑娘廟',
        bookType: 'book',
        language: 'zh-TW',
        totalWordCount: 52000,
        manuscriptWordCount: 48000,
        referenceWordCount: 4000,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-08-18T00:00:00Z',
      }),
      listCommits: vi.fn().mockResolvedValue([
        { token: 'cmt_10', totalWordCount: 52000, createdAt: '2026-08-18T00:00:00Z' },
        { token: 'cmt_1', totalWordCount: 30000, createdAt: '2026-05-01T00:00:00Z' },
      ]),
    };
    registerBookTools(server, mockClient as SlimaApiClient);
  });

  const stats = () => handlers.get('get_writing_stats')!({ book_token: 'bk_x' });

  it('reports the authoritative totals', async () => {
    const text = (await stats()).content[0].text;

    expect(text).toContain('52,000');
    expect(text).toContain('48,000');
  });

  it('does not report a made-up "recent progress" delta', async () => {
    const text = (await stats()).content[0].text;

    // 52000 - 30000: the invented number.
    expect(text).not.toContain('22,000');
    expect(text).not.toMatch(/recent progress/i);
  });

  it('says plainly that daily words and streak are not available here', async () => {
    const text = (await stats()).content[0].text;

    expect(text).toMatch(/streak/i);
    expect(text).toMatch(/not available|account-level/i);
  });

  it('does not spend a commits round-trip it no longer needs', async () => {
    await stats();

    expect(mockClient.listCommits).not.toHaveBeenCalled();
  });

  it('warns the AI in the description not to compute progress from commits', () => {
    expect(descriptions.get('get_writing_stats')).toMatch(/do not|never/i);
  });
});
