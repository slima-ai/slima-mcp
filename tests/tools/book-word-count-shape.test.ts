/**
 * Book word counts, fed with the shape Rails actually sends (iss_vufyxakbn3wjh2m4).
 *
 * Rails' BookResource returns `wordCount`, `manuscriptWordCount` and
 * `referenceWordCount` — there is no `totalWordCount` on a book. The tools read
 * `book.totalWordCount`, got undefined and printed 0 for every book. The older
 * tests never noticed because their fixtures used the same non-existent field.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../../src/api/client.js';
import { registerBookTools } from '../../src/tools/books.js';

// Field names as serialized by slima_rails app/resources/book_resource.rb (camelCase).
const railsBook = {
  token: 'bk_real',
  title: 'Real Shape',
  authorName: 'Author',
  bookType: 'book',
  wordCount: 50000,
  manuscriptWordCount: 42000,
  referenceWordCount: 8000,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-16T00:00:00Z',
};

describe('book word counts with the Rails response shape', () => {
  let handlers: Map<string, (params: Record<string, unknown>) => Promise<unknown>>;

  beforeEach(() => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    handlers = new Map();
    vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
      handlers.set(args[0] as string, args[args.length - 1] as (p: Record<string, unknown>) => Promise<unknown>);
      return server;
    });
    const client = {
      listBooks: vi.fn().mockResolvedValue({ books: [railsBook], meta: {} }),
      getBook: vi.fn().mockResolvedValue(railsBook),
    };
    registerBookTools(server, client as unknown as SlimaApiClient);
  });

  const textOf = (result: unknown) =>
    (result as { content: Array<{ text: string }> }).content[0].text;

  it('list_books shows the manuscript word count, not 0', async () => {
    const text = textOf(await handlers.get('list_books')!({}));

    expect(text).toContain('Words: 42,000');
    expect(text).not.toContain('Words: 0');
  });

  it('get_book shows the book total from wordCount', async () => {
    const text = textOf(await handlers.get('get_book')!({ book_token: 'bk_real' }));

    expect(text).toContain('**Total Words**: 50,000');
    expect(text).toContain('**Manuscript Words**: 42,000');
  });

  it('get_writing_stats shows the book total from wordCount', async () => {
    const text = textOf(await handlers.get('get_writing_stats')!({ book_token: 'bk_real' }));

    expect(text).toContain('**Total Words**: 50,000');
  });
});
