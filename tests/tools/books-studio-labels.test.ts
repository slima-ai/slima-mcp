/**
 * list_books and get_book must visually distinguish Script Studio (📝) from
 * Writing Studio (📖) so the user — and the AI — can spot at a glance which
 * books have write restrictions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SlimaApiClient } from '../../src/core/api/client.js';
import { registerBookTools } from '../../src/core/tools/books.js';

describe('Studio labels — list_books and get_book', () => {
  let server: McpServer;
  let handlers: Map<string, (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>>;
  let mockClient: {
    listBooks: ReturnType<typeof vi.fn>;
    getBook: ReturnType<typeof vi.fn>;
    listCommits: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    handlers = new Map();
    mockClient = {
      listBooks: vi.fn(),
      getBook: vi.fn(),
      listCommits: vi.fn(),
    };

    vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
      const name = args[0] as string;
      const h = args[args.length - 1] as (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;
      handlers.set(name, h);
      return server;
    });

    registerBookTools(server, mockClient as unknown as SlimaApiClient);
  });

  describe('list_books', () => {
    it('tags script books with 📝 Script Studio and book-type books with 📖 Writing Studio', async () => {
      mockClient.listBooks.mockResolvedValue([
        { token: 'bk_s', title: 'Script', bookType: 'script', createdAt: '', updatedAt: '' },
        { token: 'bk_b', title: 'Novel', bookType: 'book', createdAt: '', updatedAt: '' },
      ]);

      const result = await handlers.get('list_books')!({});
      const text = result.content[0].text;

      expect(text).toContain('📝 Script Studio');
      expect(text).toContain('📖 Writing Studio');
    });

    it('defaults to Writing Studio when bookType is missing', async () => {
      mockClient.listBooks.mockResolvedValue([
        { token: 'bk_x', title: 'Old', createdAt: '', updatedAt: '' },
      ]);

      const result = await handlers.get('list_books')!({});
      const text = result.content[0].text;

      // The book line itself must use Writing Studio. The trailing legend
      // mentions Script Studio once as an explainer — OK, not a mislabel.
      const bookLine = text.split('\n').find((line) => line.includes('bk_x'));
      expect(bookLine, 'book line should exist for bk_x').toBeDefined();
      expect(bookLine!).toContain('📖 Writing Studio');
      expect(bookLine!).not.toContain('📝 Script Studio');
    });
  });

  describe('get_book', () => {
    it('adds a write-restriction block for Script Studio books', async () => {
      mockClient.getBook.mockResolvedValue({
        token: 'bk_s',
        title: 'Script',
        bookType: 'script',
        createdAt: '',
        updatedAt: '',
      });

      const result = await handlers.get('get_book')!({ book_token: 'bk_s' });
      const text = result.content[0].text;

      expect(text).toContain('📝 Script Studio');
      expect(text).toMatch(/Write Restrictions/);
      expect(text).toContain('.script_studio/planning');
      expect(text).toContain('slima://books/bk_s/schema');
    });

    it('does NOT add the write-restriction block for Writing Studio books', async () => {
      mockClient.getBook.mockResolvedValue({
        token: 'bk_b',
        title: 'Novel',
        bookType: 'book',
        createdAt: '',
        updatedAt: '',
      });

      const result = await handlers.get('get_book')!({ book_token: 'bk_b' });
      const text = result.content[0].text;

      expect(text).toContain('📖 Writing Studio');
      expect(text).not.toMatch(/Write Restrictions/);
    });
  });
});
