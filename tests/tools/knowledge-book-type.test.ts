/**
 * A team knowledge book is a THIRD book_type, and this client only knew two.
 *
 * `Book::BOOK_TYPES` is `book | script | knowledge`. With `'knowledge'` missing
 * from BookType, a team's shared knowledge base fell through every
 * `bookType === 'script'` check into the Writing Studio branch — so it was
 * labelled "📖 Writing Studio" and its schema resource told the model
 * `writable_paths: ['**\/*']`, with no hint that confidential team skills exist
 * or that an editor cannot write at all.
 */
import { describe, it, expect } from 'vitest';
import { buildBookSchema } from '../../src/core/resources/book_schema.js';
import type { Book } from '../../src/core/api/types.js';

const knowledgeBook: Book = {
  token: 'bk_know',
  title: 'Acme Team Knowledge',
  bookType: 'knowledge',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('knowledge book schema', () => {
  it('does not claim to be a Writing Studio book', () => {
    const schema = buildBookSchema(knowledgeBook) as { studio_label: string; book_type: string };

    expect(schema.book_type).toBe('knowledge');
    expect(schema.studio_label).not.toContain('Writing Studio');
    expect(schema.studio_label).toMatch(/knowledge/i);
  });

  it('warns that some files may be readable-but-withheld', () => {
    const schema = buildBookSchema(knowledgeBook) as { notes: string };

    expect(schema.notes).toMatch(/confidential/i);
  });

  it('says write access depends on team role rather than "everything is writable"', () => {
    const schema = buildBookSchema(knowledgeBook) as {
      mcp_capabilities: { writable_paths: string[]; write_access_note?: string };
    };

    expect(schema.mcp_capabilities.write_access_note).toMatch(/editor/i);
  });

  it('leaves an ordinary Writing Studio book unchanged (regression)', () => {
    const schema = buildBookSchema({ ...knowledgeBook, bookType: 'book' }) as {
      studio_label: string;
      mcp_capabilities: { writable_paths: string[] };
    };

    expect(schema.studio_label).toContain('Writing Studio');
    expect(schema.mcp_capabilities.writable_paths).toEqual(['**/*']);
  });
});
