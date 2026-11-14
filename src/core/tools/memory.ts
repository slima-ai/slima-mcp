/**
 * The in-app coach's memory — read it, add to it, fix it (iss_vxkolpj3ykes4cgu).
 *
 * The author asked for this so an outside AI can work from the same "bible" the
 * coach uses (style, world rules, decisions) instead of building a second one.
 *
 * Two layers, and they must never be confused (Rails 6rdop9om): ACCOUNT memory is
 * shown in every book's conversations; BOOK memory belongs to one book. A goal
 * written to the account is what made the coach call an old goal "this book's
 * goal" — so the server refuses `goals` on the account, and get_ai_memory prints
 * the two layers under separate headings.
 *
 * Over MCP only the author's OWN books are reachable (not books they collaborate
 * on), and clearing a whole layer is not offered. Edits keep the previous text;
 * deletes can be undone for 30 days with restore_memory.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SlimaApiClient, MemoryEntry, MemoryLayer } from '../api/client.js';
import { formatErrorForMcp } from '../utils/errors.js';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITES = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const CHANGES_EXISTING = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const BOOK_TOKEN = z.string().describe('Book token (bk_...). It must be a book you own.');
const LAYER = z
  .enum(['book', 'account'])
  .describe(
    '"book" = this book only. "account" = shown in EVERY book (writing style, preferences) — never put ' +
      "a book's goals, plot or characters there."
  );
const ENTRY_ID = z.string().describe('The entry id shown by get_ai_memory');

/** Mirrors Rails AiMemoryService::LEGACY_GOAL_NOTE — account goals predate the rule that goals belong to a book. */
export const LEGACY_GOAL_NOTE = '（帳號層的舊目標，不一定屬於這本書——不要說成「這本書的目標」）';

function failure(error: unknown) {
  return { content: [{ type: 'text' as const, text: formatErrorForMcp(error) }], isError: true };
}

function text(lines: string[]) {
  return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
}

function entryLine(entry: MemoryEntry, note = ''): string {
  const flags = [
    entry.confidence === 'needs_review' ? 'not yet confirmed by the author' : null,
    entry.deletedAt ? `deleted ${entry.deletedAt} — restore_memory can bring it back` : null,
    entry.bookTitle ? `written in 《${entry.bookTitle}》` : null,
  ].filter(Boolean);
  return `- [${entry.id}] ${entry.text}${note}${flags.length ? `  (${flags.join('; ')})` : ''}`;
}

/**
 * Rails serializes the read with camelCase keys (`worldRules`), but add_memory takes the field
 * name as a VALUE, which no key transform touches — so `worldRules` would be refused as an
 * unknown field. Show the name the model has to send back.
 */
export function toFieldName(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function renderFields(fields: Record<string, MemoryEntry[]>, goalNote = ''): string[] {
  const lines: string[] = [];
  for (const [rawField, entries] of Object.entries(fields)) {
    const field = toFieldName(rawField);
    if (!Array.isArray(entries) || entries.length === 0) continue;
    lines.push(`### ${field}`);
    for (const e of entries) lines.push(entryLine(e, field === 'goals' ? goalNote : ''));
  }
  return lines;
}

/** Rails returns account memory by namespace (global / writingStudio / scriptStudio), book memory flat. */
export function renderMemory(account: MemoryLayer, book: Record<string, MemoryEntry[]>): string {
  const accountLines = Object.values(account).flatMap((ns) => renderFields(ns, LEGACY_GOAL_NOTE));
  const bookLines = renderFields(book);
  return [
    '## Account memory — shown in every book; it is NOT about this book',
    ...(accountLines.length ? accountLines : ['(empty)']),
    '',
    '## This book',
    ...(bookLines.length ? bookLines : ['(empty)']),
  ].join('\n');
}

export function registerMemoryTools(server: McpServer, client: SlimaApiClient): void {
  server.tool(
    'get_ai_memory',
    `Read what the in-app writing coach remembers: the author's account-wide memory and this book's memory,
printed under separate headings. Account memory appears in every book — never describe it as this book's.
Each entry shows its id, which edit_memory / delete_memory / restore_memory take.`,
    {
      book_token: BOOK_TOKEN,
      include_deleted: z.boolean().optional().describe('Also list deleted entries (restorable for 30 days)'),
    },
    READ_ONLY,
    async ({ book_token, include_deleted }) => {
      try {
        const [account, book] = await Promise.all([
          client.getAccountMemory(include_deleted),
          client.getBookMemory(book_token, include_deleted),
        ]);
        return text([renderMemory(account, book)]);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.tool(
    'add_memory',
    `Add one entry to the coach's memory. Same rules as the coach itself: only known fields; nothing that is
only true in this conversation ("currently editing…"); no duplicates. A full field is refused — delete or
merge an entry first. Goals go on the book, never the account. Entries you add wait for the author to confirm.`,
    {
      layer: LAYER,
      book_token: BOOK_TOKEN.optional().describe('Required when layer is "book"'),
      field: z
        .string()
        .describe(
          'Book: world_rules, character_voices, style_fingerprint, story_context, craft_patterns, structure_map, ' +
            'decisions, goals. Account: writing_style, preferences, strengths, growth_areas, pet_peeves.'
        ),
      text: z.string().describe('One fact, in the author’s language, that will still be true next week'),
    },
    WRITES,
    async ({ layer, book_token, field, text: value }) => {
      try {
        const entry = await client.addMemory({ layer, bookToken: book_token, field, text: value });
        return text([`Added to ${layer} memory (${field}): [${entry.id}] ${entry.text}`]);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.tool(
    'edit_memory',
    'Replace the text of one memory entry. The previous text is kept in the entry’s history.',
    { layer: LAYER, book_token: BOOK_TOKEN.optional(), entry_id: ENTRY_ID, text: z.string() },
    CHANGES_EXISTING,
    async ({ layer, book_token, entry_id, text: value }) => {
      try {
        await client.editMemory({ layer, bookToken: book_token, entryId: entry_id, text: value });
        return text([`Updated [${entry_id}]. The old text is kept in its history.`]);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.tool(
    'delete_memory',
    'Delete one memory entry. It can be brought back with restore_memory for 30 days. Tell the author what you deleted.',
    { layer: LAYER, book_token: BOOK_TOKEN.optional(), entry_id: ENTRY_ID },
    CHANGES_EXISTING,
    async ({ layer, book_token, entry_id }) => {
      try {
        await client.deleteMemory({ layer, bookToken: book_token, entryId: entry_id });
        return text([`Deleted [${entry_id}]. restore_memory brings it back within 30 days.`]);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.tool(
    'restore_memory',
    'Bring back a deleted memory entry (within 30 days of the delete). get_ai_memory with include_deleted lists them.',
    { layer: LAYER, book_token: BOOK_TOKEN.optional(), entry_id: ENTRY_ID },
    WRITES,
    async ({ layer, book_token, entry_id }) => {
      try {
        await client.restoreMemory({ layer, bookToken: book_token, entryId: entry_id });
        return text([`Restored [${entry_id}].`]);
      } catch (error) {
        return failure(error);
      }
    }
  );
}
