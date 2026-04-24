/**
 * Resource: slima://books/{token}/schema
 *
 * Asserts the JSON content is correctly shaped for both Writing Studio and
 * Script Studio books, so AI clients can rely on stable keys when deciding
 * where to write.
 */

import { describe, it, expect } from 'vitest';
import { buildBookSchema } from '../../src/core/resources/book_schema.js';
import type { Book } from '../../src/core/api/types.js';

function makeBook(overrides: Partial<Book>): Book {
  return {
    token: 'bk_test',
    title: 'Test',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('buildBookSchema — Writing Studio', () => {
  const book = makeBook({ token: 'bk_writing', bookType: 'book', title: 'My Novel' });

  it('marks all paths as writable and lists no structured files', () => {
    const schema = buildBookSchema(book) as {
      book_type: string;
      studio_label: string;
      mcp_capabilities: {
        writable_paths: string[];
        readonly_paths: string[];
        reserved_sentinels: string[];
      };
      structured_file_types: Record<string, string>;
    };

    expect(schema.book_type).toBe('book');
    expect(schema.studio_label).toBe('Writing Studio');
    expect(schema.mcp_capabilities.writable_paths).toEqual(['**/*']);
    expect(schema.mcp_capabilities.readonly_paths).toEqual([]);
    expect(schema.mcp_capabilities.reserved_sentinels).toEqual([]);
    expect(Object.keys(schema.structured_file_types)).toHaveLength(0);
  });
});

describe('buildBookSchema — Script Studio', () => {
  const book = makeBook({ token: 'bk_script', bookType: 'script', title: 'My Script' });

  it('restricts writes to planning/ and flags the sentinel', () => {
    const schema = buildBookSchema(book) as {
      book_type: string;
      studio_label: string;
      mcp_capabilities: {
        writable_paths: string[];
        writable_exceptions: string[];
        readonly_paths: string[];
        reserved_sentinels: string[];
      };
    };

    expect(schema.book_type).toBe('script');
    expect(schema.studio_label).toBe('Script Studio');
    expect(schema.mcp_capabilities.writable_paths).toEqual(['.script_studio/planning/**/*']);
    expect(schema.mcp_capabilities.writable_exceptions).toContain(
      '.script_studio/planning/.initialized'
    );
    expect(schema.mcp_capabilities.reserved_sentinels).toContain(
      '.script_studio/planning/.initialized'
    );

    // Structured readonly paths should cover every file type users own via the UI.
    const expectReadonlyPattern = (pattern: string): void => {
      expect(schema.mcp_capabilities.readonly_paths).toContain(pattern);
    };
    expectReadonlyPattern('.script_studio/series.json');
    expectReadonlyPattern('.script_studio/characters/**/*.character');
    expectReadonlyPattern('.script_studio/storylines/**/*.storyline');
    expectReadonlyPattern('.script_studio/planning/.initialized');
  });

  it('catalogues structured file types', () => {
    const schema = buildBookSchema(book) as {
      structured_file_types: Record<string, string>;
    };
    const keys = Object.keys(schema.structured_file_types);
    for (const expected of ['series.json', '*.scene', '*.character', '*.storyline', '*.note']) {
      expect(keys).toContain(expected);
    }
  });
});

describe('buildBookSchema — defaults', () => {
  it('treats undefined bookType as Writing Studio (safe default)', () => {
    const book = makeBook({ bookType: undefined });
    const schema = buildBookSchema(book) as { book_type: string; studio_label: string };
    expect(schema.book_type).toBe('book');
    expect(schema.studio_label).toBe('Writing Studio');
  });
});
