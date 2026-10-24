/**
 * Field-level operations on Slima's structured file types.
 *
 * ## Why these exist at all
 *
 * `.beats` / `.timeline` / `.script` are documents with a schema and a
 * reconciliation semantics, not text. Writing one whole-file means the model
 * has to send back every part of it — including the parts it was never given
 * and cannot see. That failure is silent: the file still parses, it just has
 * less of the author's work in it (a beat board loses its chapter cards; a
 * relationship map loses a character). These tools take one change at a time,
 * so the parts the model cannot see are parts it cannot drop.
 *
 * ## Why three tools and not forty-two
 *
 * Tool descriptions are sent on EVERY request, including the conversations
 * that only read a chapter. The individual operations for these three types
 * come to ~33KB of schema; batched, they are ~17KB, and the shape is one the
 * models have already been through Gemini/Grok's schema subset with. Each tool
 * takes `operations[]` — send one to make one change.
 *
 * ## Why the names start with a verb
 *
 * The desktop agent decides whether to ask a human by looking for a verb
 * prefix on the tool name. `beats_batch` does not read as a write, so it would
 * not prompt. `update_beat_board` does.
 * (NOTE: this is second-hand — confirm against the desktop agent's source
 * before treating the prefix list as exhaustive.)
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SlimaApiClient } from '../api/client.js';
import type { McpStructuredResponse } from '../api/types.js';
import { formatErrorForMcp } from '../utils/errors.js';

/** One entry per structured type that has a server-side executor. */
interface StructuredType {
  /** MCP tool name — MUST start with a verb (see file header). */
  tool: string;
  extension: string;
  /** What the author calls it. */
  noun: string;
  /**
   * One line right after the opening sentence, for a type whose extension says the
   * wrong thing: `.map` reads like a geographic map but is the relationship graph (d11).
   */
  what?: string;
  /** The operations this type accepts, for the description. */
  ops: string;
  /** A concrete batch, in this type's language. */
  example: string;
  /** Rules that belong to this type alone. Omit when the shared ones are enough. */
  extra?: string;
}

const TYPES: StructuredType[] = [
  {
    tool: 'update_beat_board',
    extension: '.beats',
    noun: 'beat board',
    ops: 'add_act, update_act, remove_act, add_beat, update_beat, remove_beat, move_beat',
    example:
      '{"op": "add_act", "name": "Act Two", "op_ref": "A2"}, ' +
      '{"op": "add_beat", "title": "The turn", "act_id": "@A2"}',
  },
  {
    tool: 'update_timeline',
    extension: '.timeline',
    noun: 'timeline',
    ops: 'add_entry, update_entry, remove_entry, set_config',
    example: '{"op": "add_entry", "title": "The siege begins", "time_mode": "label", "time_label": "Winter"}',
  },
  {
    tool: 'update_script',
    extension: '.script',
    noun: 'screenplay',
    ops: 'add_scene, update_scene_heading, remove_scene, add_element, update_element, remove_element',
    example:
      '{"op": "add_scene", "interior": true, "location": "HARBOUR", "op_ref": "S1"}, ' +
      '{"op": "add_element", "scene_id": "@S1", "type": "action", "text": "The fog lifts."}',
  },
  {
    tool: 'update_relationship_map',
    extension: '.map',
    noun: 'relationship map',
    what:
      '**This is the character relationship graph (關係圖) — not a geographic map.** A world map\n' +
      '(地圖) is `.geomap`, changed with `update_world_map`.',
    ops:
      'add_node, update_node, move_node, remove_node, add_edge, update_edge, remove_edge, ' +
      'add_group, update_group, remove_group, set_meta',
    example:
      '{"op": "add_node", "label": "Lin Shuang", "op_ref": "N1", ' +
      '"position": {"near_id": "<id of Shen Yan>", "direction": "right"}}, ' +
      '{"op": "add_edge", "source_id": "<id of Shen Yan>", "target_id": "@N1", "label": "mentor"}',
    extra:
      '**Position is content here, not layout.** `update_node` will not move anything — that is\n' +
      '`move_node`, so that "I moved her next to him" is its own reviewable change. Prefer\n' +
      '`{near_id, direction}` over computing numbers. Existing nodes never move; the final\n' +
      'coordinates come back in the notes. Group boxes are computed from `member_ids` — never\n' +
      'send x/y/width/height. Removing a node removes its edges, and you are told so.',
  },
  {
    tool: 'update_world_map',
    extension: '.geomap',
    noun: 'world map',
    what:
      '**This is the geographic world map (地圖).** A character relationship graph (關係圖) is\n' +
      '`.map`, changed with `update_relationship_map`.',
    ops:
      'add_place, update_place, add_label, update_label, remove_element, add_river, ' +
      'add_border, paint_region, set_meta',
    example:
      '{"op": "add_place", "x": 210, "y": 96, "name": "Starhaven", "tier": "port"}, ' +
      '{"op": "add_label", "x": 240, "y": 60, "text": "The Cold Sea", "size": "large"}',
    extra:
      '**Coordinates are grid cells, not pixels**: x 0-519, y 0-363. `read_file` gives you the\n' +
      'map with its three terrain grids replaced by a note — they are machine-encoded and you\n' +
      'do not need them; `paint_region` works in cells. `remove_element` takes any element id\n' +
      '(`pl_` place, `lb_` label, `rv_` river, `bd_` border). Terrain has no undo: paint over it\n' +
      'instead. Move a place with `update_place`, never by removing and re-adding it. An unknown\n' +
      'place `tier` is refused with the full list of real ones — read the error, do not guess.',
  },
];

/**
 * Shared rules. Kept in one string because they are the same rules for every
 * type, and three drifting copies is how the `.map` policy ended up being
 * taught three different ways for months.
 */
const SHARED_RULES = `
**Read the file first.** Every id you send must come from that read — never
invent one, never retype one from memory. An unknown id is refused with the
list of real ones, so a mistake costs a round trip, not the author's data.

**One operation per change.** Each operation takes only its own arguments; a
field belonging to a different operation is refused rather than ignored.

**\`op_ref\` chains within one batch.** Label what an operation creates with
\`op_ref: "A2"\`, then a LATER operation can point at it as \`"@A2"\`. Backward
references only, and only inside this one batch — a later call must use the
real id, which comes back in \`applied\`.

**The batch is all-or-nothing.** If one operation fails nothing is written, so
you never have to work out how far it got.

**Unlike the in-app assistant, there is no review panel here.** What you send
lands in the author's version history immediately. Say what you changed, not
"please confirm it".`;

function describe(type: StructuredType): string {
  return `Change a Slima ${type.noun} (\`${type.extension}\`) one field at a time.${type.what ? `\n\n${type.what}` : ''}

This is the ONLY way to write this file type — \`write_file\` and \`edit_file\`
are refused for it, because a whole-file write would drop the parts of the
document you were never shown.

Operations: ${type.ops}
Example \`operations\`: [${type.example}]
${SHARED_RULES}${type.extra ? `\n\n${type.extra}` : ''}`;
}

function render(type: StructuredType, result: McpStructuredResponse): string {
  const lines = [`Applied ${result.applied.length} change(s) to the ${type.noun}.`, ''];

  const created = result.applied.filter((a) => a.id);
  if (created.length > 0) {
    lines.push('**New ids** (use these in later calls — do not re-read just for them):');
    for (const a of created) lines.push(`- \`${a.op}\` → ${a.id}${a.op_ref ? ` (was @${a.op_ref})` : ''}`);
    lines.push('');
  }

  // Side effects the model did not ask for. These are the whole reason the
  // server returns notes: the author will see them, so the author must be told.
  if (result.notes.length > 0) {
    lines.push('**Also happened, tell the author:**');
    for (const note of result.notes) lines.push(`- ${note}`);
    lines.push('');
  }

  lines.push(`**Commit:** ${result.commit.token}`);
  return lines.join('\n');
}

export function registerStructuredTools(server: McpServer, client: SlimaApiClient): void {
  for (const type of TYPES) {
    server.tool(
      type.tool,
      describe(type),
      {
        book_token: z.string().describe('Book token (e.g., bk_abc123)'),
        path: z.string().describe(`Path to the ${type.extension} file (e.g., "plan/board${type.extension}")`),
        intent: z
          .string()
          .describe(
            "One line in the author's own language saying what this batch does — it becomes the " +
              'commit message they read later. Not "batch update".'
          ),
        operations: z
          .array(z.record(z.string(), z.unknown()))
          .describe(
            'The changes, in order. Each is a flat object: `op` names the operation and the other ' +
              'keys are that operation\'s arguments. There is no nested `args`.'
          ),
      },
      // Each call can remove or overwrite cards, nodes and fields (remove_* / update_* operations), so
      // by the MCP spec it is destructive, not merely additive.
      { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      async ({ book_token, path, intent, operations }) => {
        try {
          const result = await client.applyStructuredOps(book_token, {
            path,
            intent,
            operations: operations as Array<Record<string, unknown>>,
          });
          return { content: [{ type: 'text', text: render(type, result) }] };
        } catch (error) {
          // Rails' messages for these already say what went wrong AND what to do
          // next (they list the real ids, name which operation owns a field), so
          // pass them through verbatim rather than summarising them away.
          return { content: [{ type: 'text', text: formatErrorForMcp(error) }], isError: true };
        }
      }
    );
  }
}
