/**
 * `list_books` must not silently truncate.
 *
 * Rails caps an un-paginated /books at Book::MAX_BOOKS_PER_USER (100) and
 * returns `meta.total` / `meta.totalPages` alongside the page. The API is
 * therefore honest — but `SlimaApiClient.request()` returns `json.data` and
 * discards the envelope, so the tool printed "Found 100 book(s)" for an account
 * with more and the AI had no way to know books were missing.
 *
 * `accessible_by` spans personal + team + collaborator books, so exceeding 100
 * is reachable without any one user owning 100 books.
 *
 * CLAUDE.md Gotcha #12: never silently truncate a batch — either serve it all,
 * refuse loudly, or state what was left out. This is the third option.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../../src/core/api/client.js';
import { registerBookTools } from '../../src/core/tools/books.js';

type Handler = (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

const page = (count: number, meta: Record<string, number>) => ({
  books: Array.from({ length: count }, (_, i) => ({
    token: `bk_${i}`,
    title: `Book ${i}`,
    bookType: 'book' as const,
    wordCount: 1000, manuscriptWordCount: 1000,
    createdAt: '',
    updatedAt: '',
  })),
  meta,
});

describe('list_books pagination honesty', () => {
  let handlers: Map<string, Handler>;
  let schemas: Map<string, Record<string, unknown>>;
  let mockClient: Partial<SlimaApiClient>;

  beforeEach(() => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    handlers = new Map();
    schemas = new Map();
    vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
      handlers.set(args[0] as string, args[args.length - 1] as Handler);
      schemas.set(args[0] as string, args[2] as Record<string, unknown>);
      return server;
    });
    mockClient = { listBooks: vi.fn() };
    registerBookTools(server, mockClient as SlimaApiClient);
  });

  const list = (args: Record<string, unknown> = {}) => handlers.get('list_books')!(args);

  it('says how many were withheld when the account exceeds one page', async () => {
    (mockClient.listBooks as ReturnType<typeof vi.fn>).mockResolvedValue(
      page(100, { total: 137, page: 1, perPage: 100, totalPages: 2 })
    );

    const text = (await list()).content[0].text;

    expect(text).toContain('137');
    expect(text).toMatch(/showing 100|100 of 137/i);
  });

  it('tells the AI how to get the rest', async () => {
    (mockClient.listBooks as ReturnType<typeof vi.fn>).mockResolvedValue(
      page(100, { total: 137, page: 1, perPage: 100, totalPages: 2 })
    );

    expect((await list()).content[0].text).toMatch(/page/i);
  });

  it('accepts a page parameter and forwards it', async () => {
    (mockClient.listBooks as ReturnType<typeof vi.fn>).mockResolvedValue(
      page(37, { total: 137, page: 2, perPage: 100, totalPages: 2 })
    );

    await list({ page: 2 });

    expect(mockClient.listBooks).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
    expect(schemas.get('list_books')).toHaveProperty('page');
  });

  // Found in review: the "more pages" decision compared the grand total against
  // the CURRENT page's length, so the last page (37 of 137) still told the AI to
  // fetch a page that does not exist.
  it('does not send the AI after a page that does not exist', async () => {
    (mockClient.listBooks as ReturnType<typeof vi.fn>).mockResolvedValue(
      page(37, { total: 137, page: 2, perPage: 100, totalPages: 2 })
    );

    const text = (await list({ page: 2 })).content[0].text;

    expect(text).not.toMatch(/page: 3/);
    expect(text).toContain('137');
  });

  it('stays quiet about pagination when everything fits', async () => {
    (mockClient.listBooks as ReturnType<typeof vi.fn>).mockResolvedValue(
      page(3, { total: 3, page: 1, perPage: 100, totalPages: 1 })
    );

    const text = (await list()).content[0].text;

    expect(text).toContain('Found 3 book(s)');
    expect(text).not.toMatch(/more books|page 2/i);
  });

  it('still works when the server sends no meta at all', async () => {
    (mockClient.listBooks as ReturnType<typeof vi.fn>).mockResolvedValue(page(2, {}));

    const text = (await list()).content[0].text;

    expect(text).toContain('Found 2 book(s)');
  });

  it('handles an empty library', async () => {
    (mockClient.listBooks as ReturnType<typeof vi.fn>).mockResolvedValue(
      page(0, { total: 0, page: 1, perPage: 100, totalPages: 0 })
    );

    expect((await list()).content[0].text).toContain('No books found');
  });
});
