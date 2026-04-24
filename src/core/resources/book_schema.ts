/**
 * Per-book MCP schema Resource.
 *
 * Registered at URI template `slima://books/{book_token}/schema`. AI clients
 * can read this on demand to learn which paths are writable / read-only for
 * a specific book, without that rule set bloating every tool description.
 *
 * This mirrors the canonical rule enforced by
 * `Mcp::FileOperationService#validate_studio_write_path!` on the Rails side —
 * Rails is the ground truth, this Resource is the ambient-context mirror.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SlimaApiClient } from '../api/client.js';
import type { Book } from '../api/types.js';

const BOOK_SCHEMA_URI_TEMPLATE = 'slima://books/{book_token}/schema';

export function registerBookSchemaResource(
  server: McpServer,
  client: SlimaApiClient
): void {
  server.resource(
    'slima-book-schema',
    new ResourceTemplate(BOOK_SCHEMA_URI_TEMPLATE, {
      // Intentionally no `list` callback — books may number in the hundreds, so
      // we expose only the URI template via `resources/templates/list` and let
      // clients call `resources/read` with a concrete token.
      list: undefined,
    }),
    {
      description:
        'Per-book MCP operation schema: which paths are readable/writable, which are structured (read-only), and the structured file catalog. Read this before planning writes on an unfamiliar book.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const rawToken = variables['book_token'];
      const bookToken = Array.isArray(rawToken) ? rawToken[0] : rawToken;

      if (!bookToken) {
        throw new Error(
          `Invalid Slima book schema URI: missing book_token in ${uri.toString()}`
        );
      }

      const book = await client.getBook(bookToken);
      const schema = buildBookSchema(book);

      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: 'application/json',
            text: JSON.stringify(schema, null, 2),
          },
        ],
      };
    }
  );
}

export function buildBookSchema(book: Book): Record<string, unknown> {
  const isScript = book.bookType === 'script';

  return {
    book_token: book.token,
    book_title: book.title,
    book_type: book.bookType ?? 'book',
    studio_label: isScript ? 'Script Studio' : 'Writing Studio',
    mcp_capabilities: {
      // Note: actual reads still go through validate_safe_path!
      // (blocks absolute paths, traversal, control chars) even though it's
      // not reflected in this allowlist.
      readable_paths:
        'Any path within the book tree (path-traversal and absolute paths still rejected).',
      writable_paths: isScript ? ['.script_studio/planning/**/*'] : ['**/*'],
      writable_exceptions: isScript ? ['.script_studio/planning/.initialized'] : [],
      readonly_paths: isScript
        ? [
            '.script_studio/series.json',
            '.script_studio/seasons/**/season.json',
            '.script_studio/seasons/**/episodes/**/episode.json',
            '.script_studio/seasons/**/scenes/*.scene',
            '.script_studio/characters/**/*.character',
            '.script_studio/locations/**/*.location',
            '.script_studio/storylines/**/*.storyline',
            '.script_studio/notes/**/*.note',
            '.script_studio/planning/.initialized',
          ]
        : [],
      reserved_sentinels: isScript ? ['.script_studio/planning/.initialized'] : [],
    },
    structured_file_types: isScript
      ? {
          'series.json': 'Series metadata (title, genre, logline, theme, synopsis, acts)',
          'season.json': 'Season metadata',
          'episode.json': 'Episode metadata',
          '*.scene': 'Scene content with scene-specific format',
          '*.character': 'Character definition with scope (series / season / episode)',
          '*.location': 'Location definition with scope',
          '*.storyline': 'Storyline with tier and ID linkage',
          '*.note': 'Note with scope',
        }
      : {},
    notes: isScript
      ? 'Structured files require schema-aware edits — use the Script Studio UI. MCP write access is restricted to planning/ (free-form reference tree) to prevent schema corruption.'
      : 'Writing Studio books are free-form. No schema restrictions; any path is writable.',
    policy_source: 'Rails: Mcp::FileOperationService#validate_studio_write_path!',
  };
}
