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
import {
  AI_READONLY_EXTENSIONS,
  AI_STRUCTURED_TOOLS,
  AI_STRUCTURED_VIEWERS,
  AI_WRITABLE_EXTENSIONS,
} from '../ai-file-policy.js';

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
  const isKnowledge = book.bookType === 'knowledge';

  return {
    book_token: book.token,
    book_title: book.title,
    book_type: book.bookType ?? 'book',
    studio_label: isScript
      ? 'Script Studio'
      : isKnowledge
        ? 'Team Knowledge Base'
        : 'Writing Studio',
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
      // Path allowlists are not the whole story on a team book: the server also
      // checks the caller's ROLE. An editor gets 403 on every write no matter
      // which path, so "writable_paths" above is an upper bound, not a promise.
      write_access_note: isKnowledge
        ? 'Team knowledge base: owner / admin / seated writer may write; an editor is read-only ' +
          '(every write returns 403). Files under .slima/skills/ may be enabled as team skills by a manager.'
        : 'Personal books: the owner and writer collaborators may write; editor collaborators are read-only.',
    },
    // AI file-type policy — mirrors slima_vue `fileTypeRegistry.ts` (`aiPolicy`).
    // Applies to BOTH studio types; the Script Studio path allowlist above is a
    // separate, additional restriction.
    ai_file_policy: {
      writable: [...AI_WRITABLE_EXTENSIONS],
      // Structured types are not one bucket. Collapsing them into `readonly`
      // is what made this resource tell the model `.map` could not be written
      // for weeks after it could, and never mention `.beats` at all.
      field_level_tools: AI_STRUCTURED_TOOLS,
      readonly: [...AI_READONLY_EXTENSIONS],
      readonly_note:
        'Read-only means the AI must not write these via write_file / edit_file / create_file / ' +
        'append_to_file / delete_file. Slima owns their structure; overwriting one corrupts it for the ' +
        'author. Recommend changes in words and point the author at that file type\'s editor.',
      field_level_note:
        'These take one change at a time through the tool named above. Every generic write is refused ' +
        '(write_file / edit_file / append_to_file), because a whole-document write drops the parts of ' +
        'the file you were never shown — a beat board loses its chapter cards, a relationship map loses ' +
        'a character, and nothing reports it. create_file works: it writes an empty document of the ' +
        'right shape and ignores the content you send, so you then fill it in with the tool.',
      // ⚠️ This block ships with the client and can lag a Rails deploy.
      // `get_capabilities` is derived from the contract Rails enforces; when the
      // two disagree, that one is right.
      authority: 'get_capabilities',
      viewers: AI_STRUCTURED_VIEWERS,
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
      : isKnowledge
        ? 'Team knowledge base. Free-form paths, but two team rules apply: writes follow team role ' +
          '(see write_access_note), and a file marked confidential is returned WITHOUT its content — ' +
          'read_file reports it as withheld rather than empty. That is intentional: the AI may use ' +
          'such a skill without reading it. Never try to rewrite a withheld file.'
        : 'Writing Studio books are free-form. No schema restrictions; any path is writable.',
    policy_source: 'Rails: Mcp::FileOperationService#validate_studio_write_path!',
  };
}
