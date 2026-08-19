/**
 * The teaching, team and workspace tools.
 *
 * These are thin by design — they fetch text Rails authored and hand it over —
 * so what is worth testing is not their formatting but the three things that
 * would quietly make them useless: calling the wrong endpoint, swallowing the
 * server's error (which for these endpoints carries the answer), and dropping
 * the behavioural rules from the descriptions an AI reads before deciding what
 * to call.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../../src/api/client.js';
import { registerTeachingTools } from '../../src/core/tools/teaching.js';
import { registerTeamTools } from '../../src/core/tools/teams.js';
import { registerWorkspaceTools } from '../../src/core/tools/workspace.js';
import { SlimaApiError } from '../../src/utils/errors.js';

type Handler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ text: string }>;
  isError?: boolean;
}>;

describe('teaching, team and workspace tools', () => {
  let server: McpServer;
  let handlers: Map<string, Handler>;
  let descriptions: Map<string, string>;
  let mockClient: Partial<SlimaApiClient>;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '1.0.0' });
    handlers = new Map();
    descriptions = new Map();

    vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
      handlers.set(args[0] as string, args[args.length - 1] as Handler);
      descriptions.set(args[0] as string, args[1] as string);
      return server;
    });

    mockClient = {
      getCapabilities: vi.fn().mockResolvedValue({ contractVersion: 1 }),
      listGuides: vi.fn().mockResolvedValue({
        guides: [{ slug: 'book-structure', title: 'Files', summary: 'How files work' }],
      }),
      loadGuide: vi.fn().mockResolvedValue({ slug: 'book-structure', title: 'Files', body: 'BODY' }),
      listWritingSkills: vi.fn().mockResolvedValue({
        skills: [{ key: 'character_develop', name: 'Character', description: 'Deepen a character' }],
      }),
      loadWritingSkill: vi.fn().mockResolvedValue({ key: 'character_develop', name: 'Character', body: 'STEPS' }),
      listTeams: vi.fn().mockResolvedValue([]),
      getTeam: vi.fn().mockResolvedValue({}),
      listTeamSkills: vi.fn().mockResolvedValue([]),
      listTeamMemories: vi.fn().mockResolvedValue({}),
      listTeamRules: vi.fn().mockResolvedValue({}),
      listNotes: vi.fn().mockResolvedValue({}),
      createNote: vi.fn().mockResolvedValue({}),
      listComments: vi.fn().mockResolvedValue({}),
      createComment: vi.fn().mockResolvedValue({}),
      resolveComment: vi.fn().mockResolvedValue({}),
      reopenComment: vi.fn().mockResolvedValue({}),
    };

    registerTeachingTools(server, mockClient as SlimaApiClient);
    registerTeamTools(server, mockClient as SlimaApiClient);
    registerWorkspaceTools(server, mockClient as SlimaApiClient);
  });

  describe('teaching', () => {
    it('returns the guide body, not a summary of it', async () => {
      const result = await handlers.get('load_guide')!({ slug: 'book-structure' });

      expect(mockClient.loadGuide).toHaveBeenCalledWith('book-structure');
      expect(result.content[0].text).toContain('BODY');
    });

    it('passes the server error through on an unknown slug', async () => {
      // Rails answers an unknown slug with the list of real ones. Replacing that
      // with a generic "not found" would throw away the only part of the
      // response that helps the AI get it right next call.
      (mockClient.loadGuide as ReturnType<typeof vi.fn>).mockRejectedValue(
        new SlimaApiError(404, 'GUIDE_NOT_FOUND', 'Unknown guide `nope`. Available: getting-started')
      );

      const result = await handlers.get('load_guide')!({ slug: 'nope' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('getting-started');
    });

    it('lists guides with the summary that says when to load each', async () => {
      const result = await handlers.get('list_guides')!({});

      expect(result.content[0].text).toContain('book-structure');
      expect(result.content[0].text).toContain('How files work');
    });

    it('separates writing skills from operating guides in its own description', async () => {
      // The two catalogues are easy to confuse, and an AI that loads the wrong
      // one gets plausible, useless text.
      expect(descriptions.get('list_writing_skills')).toMatch(/about the WRITING/);
      expect(descriptions.get('list_writing_skills')).toMatch(/list_guides/);
    });

    it('returns a skill body', async () => {
      const result = await handlers.get('load_writing_skill')!({ key: 'character_develop' });

      expect(result.content[0].text).toContain('STEPS');
    });
  });

  describe('teams', () => {
    it('reads rules for the requested team', async () => {
      await handlers.get('list_team_rules')!({ team_token: 'tm_1' });

      expect(mockClient.listTeamRules).toHaveBeenCalledWith('tm_1');
    });

    it('tells the AI mandatory rules are not suggestions', async () => {
      expect(descriptions.get('list_team_rules')).toMatch(/BEFORE writing/);
      expect(descriptions.get('list_team_rules')).toMatch(/not suggestions/i);
    });

    it('tells the AI not to route around a withheld confidential skill', async () => {
      // The withholding is enforced server-side, but an agent that treats it as
      // an obstacle will burn the author's turns trying older commits and blob
      // hashes — all of them closed, all of them audited.
      const description = descriptions.get('list_team_skills')!;

      expect(description).toMatch(/confidential/);
      expect(description).toMatch(/does not stop the skill working|applies it on the team's behalf/);
      expect(description).toMatch(/audited/);
    });

    it('registers no team write tool', () => {
      // Governance is not on the server's surface for any role. A tool here
      // would be a 403 an AI has to discover by trying.
      const teamTools = [...handlers.keys()].filter((name) => name.includes('team'));

      expect(teamTools.every((name) => name.startsWith('list_') || name.startsWith('get_'))).toBe(true);
    });
  });

  describe('workspace', () => {
    it('creates a note without inventing a client_id', async () => {
      // client_id is the Slima app's local primary key. The server mints one;
      // a value an agent made up is either rejected (non-UUID) or a collision
      // risk against the app's own records.
      await handlers.get('create_note')!({ book_token: 'bk_1', title: 'T', content: 'C' });

      const payload = (mockClient.createNote as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(payload).not.toHaveProperty('client_id');
      expect(payload.note_type).toBe('book');
    });

    it('resolves a comment on the right book', async () => {
      await handlers.get('resolve_comment')!({ book_token: 'bk_1', comment_token: 'cm_1' });

      expect(mockClient.resolveComment).toHaveBeenCalledWith('bk_1', 'cm_1');
    });

    it('offers no way to accept a suggested change', async () => {
      // Accepting applies an edit to the manuscript. An agent that can both
      // suggest and accept has approval over its own work.
      expect([...handlers.keys()]).not.toContain('accept_comment');
      expect([...handlers.keys()]).not.toContain('reject_comment');
    });

    it('offers no way to delete a note', () => {
      // A note is not version-controlled — there is no history to recover it
      // from, unlike a file.
      expect([...handlers.keys()]).not.toContain('delete_note');
    });

    it('tells the AI when to comment instead of editing', async () => {
      expect(descriptions.get('create_comment')).toMatch(/judgement call/i);
      expect(descriptions.get('create_comment')).toMatch(/When unsure, comment/);
    });
  });
});
