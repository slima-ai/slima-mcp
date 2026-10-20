/**
 * Notes and comments — the author's working material around the manuscript.
 *
 * Destructive operations are absent because the server does not offer them to
 * MCP: a note is not version-controlled (unlike a file, there is no history to
 * recover it from), and accepting a suggested change applies an edit to the
 * manuscript, which is the author's decision rather than the agent's.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SlimaApiClient } from '../api/client.js';
import { formatErrorForMcp } from '../utils/errors.js';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const WRITES = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const BOOK_TOKEN = z.string().describe('Book token (bk_...)');

function json(body: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(body, null, 2) }] };
}

function failure(error: unknown) {
  return { content: [{ type: 'text' as const, text: formatErrorForMcp(error) }], isError: true };
}

export function registerWorkspaceTools(server: McpServer, client: SlimaApiClient): void {
  server.tool(
    'list_notes',
    "The author's margin notes on this book — book-level and chapter-level, including foreshadowing pairs.",
    { book_token: BOOK_TOKEN },
    READ_ONLY,
    async ({ book_token }) => {
      try {
        return json(await client.listNotes(book_token));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.tool(
    'create_note',
    `Leave a note beside the manuscript. Notes do not touch the prose or the word count.

Use \`note_type: "chapter"\` with the file's token in \`file_id\` to anchor it to one chapter; \`"book"\` for the work as a whole. Do not use notes as your own scratchpad — they appear in the author's interface as their own thinking. See the \`notes-and-foreshadowing\` guide.`,
    {
      book_token: BOOK_TOKEN,
      title: z.string().describe('Short title (required)'),
      content: z.string().optional().describe('Body, up to 50,000 characters'),
      note_type: z.enum(['book', 'chapter']).optional().describe('Defaults to "book"'),
      file_id: z.string().optional().describe('File token — required when note_type is "chapter"'),
      color: z.enum(['gray', 'red', 'blue', 'green', 'yellow', 'purple']).optional(),
    },
    WRITES,
    async ({ book_token, title, content, note_type, file_id, color }) => {
      try {
        // `client_id` is deliberately not exposed: it is the Slima app's local
        // primary key, the server mints one when it is absent, and a non-UUID
        // value is rejected. Nothing an agent could pass here would be better
        // than what the server generates.
        return json(
          await client.createNote(book_token, {
            title,
            content,
            note_type: note_type ?? 'book',
            file_id,
            color,
          })
        );
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.tool(
    'semantic_search',
    `Find passages by MEANING rather than by the words used.

\`search_content\` finds the word an author typed; this finds the passage they meant — "where does the mother's resentment surface?" returns the scene even when neither word appears in it. On a team knowledge base it is the difference between browsing and asking.

Costs a small embedding charge, unlike literal search. Returns §N paragraph anchors so you can quote them back precisely.`,
    {
      book_token: BOOK_TOKEN,
      query: z.string().describe('What you are looking for, in natural language'),
      limit: z.number().optional().describe('Max results (default 10, cap 50)'),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ book_token, query, limit }) => {
      try {
        return json(await client.semanticSearch(book_token, query, limit));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.tool(
    'list_comments',
    `Editorial comment threads on this book, open and resolved.

Read these before starting work on a book you have been handed — they are where an editor has already said what is wrong, and producing an independent list without reading them usually contradicts a decision someone already made.`,
    { book_token: BOOK_TOKEN },
    READ_ONLY,
    async ({ book_token }) => {
      try {
        return json(await client.listComments(book_token));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.tool(
    'create_comment',
    `Leave an editorial comment.

Comment when the change is a judgement call — pacing, whether a motivation lands, whether a scene earns its length. Edit the file instead when the author asked for the change. When unsure, comment: a comment costs ten seconds to dismiss, an unwanted rewrite costs the author a diff of their own prose.`,
    {
      book_token: BOOK_TOKEN,
      content: z.string().describe('The comment'),
      file_token: z.string().optional().describe('File this comment is about, if any'),
    },
    WRITES,
    async ({ book_token, content, file_token }) => {
      try {
        return json(await client.createComment(book_token, { content, file_token }));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.tool(
    'resolve_comment',
    `Mark a comment thread addressed.

Say what you did when you resolve one. A silent resolve tells the editor nothing about whether you understood the note.`,
    {
      book_token: BOOK_TOKEN,
      comment_token: z.string().describe('Comment token (from list_comments)'),
    },
    WRITES,
    async ({ book_token, comment_token }) => {
      try {
        return json(await client.resolveComment(book_token, comment_token));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.tool(
    'reopen_comment',
    'Reopen a comment thread that was resolved but should not have been.',
    {
      book_token: BOOK_TOKEN,
      comment_token: z.string().describe('Comment token (from list_comments)'),
    },
    WRITES,
    async ({ book_token, comment_token }) => {
      try {
        return json(await client.reopenComment(book_token, comment_token));
      } catch (error) {
        return failure(error);
      }
    }
  );
}
