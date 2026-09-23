/**
 * `.map` is a character relationship graph (關係圖); `.geomap` is the world map (地圖).
 *
 * Tim 2026-09-24 (d11, HQ decisions/2026-09-24-tim-artifact-rulings.md): write it down
 * plainly. The extension reads like "map" in the geographic sense, so a model asked for
 * a 地圖 reaches for `.map`, and one asked for a 關係圖 has no word in the descriptions
 * that says `.map` is where it goes.
 *
 * Also pins the other half of the drift: `view_relationship_map` still said `.map` was
 * read-only to AI, which stopped being true on 2026-09-06 (`update_relationship_map`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../../src/core/api/client.js';
import { registerFileTools } from '../../src/core/tools/files.js';
import { registerStructuredTools } from '../../src/core/tools/structured.js';

describe('.map is the relationship graph, .geomap is the world map', () => {
  let descriptions: Map<string, string>;

  beforeEach(() => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    descriptions = new Map();
    vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
      descriptions.set(args[0] as string, args[1] as string);
      return server;
    });
    registerFileTools(server, {} as SlimaApiClient);
    registerStructuredTools(server, {} as SlimaApiClient);
  });

  it('says so in the policy note every write tool carries', () => {
    const note = descriptions.get('write_file')!;

    expect(note).toMatch(/`\.map`[^.]*relationship graph/i);
    expect(note).toMatch(/not a geographic map/i);
    expect(note).toMatch(/`\.geomap`[^.]*world map/i);
  });

  it('says so in update_relationship_map, and points a geographic request at .geomap', () => {
    const description = descriptions.get('update_relationship_map')!;

    expect(description).toMatch(/relationship graph/i);
    expect(description).toMatch(/not a geographic map/i);
    expect(description).toContain('.geomap');
  });

  it('says so in update_world_map', () => {
    expect(descriptions.get('update_world_map')!).toMatch(/geographic/i);
  });

  it('no longer tells the model a .map is read-only', () => {
    const description = descriptions.get('view_relationship_map')!;

    expect(description).not.toMatch(/read-only/i);
    expect(description).toContain('update_relationship_map');
  });
});
