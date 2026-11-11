/**
 * Every place that tells a person where to get their API token must name the page the app
 * actually has.
 *
 * app.slima.ai has no top-level /settings route; the token page is /account/api-tokens
 * (slima_vue src/router/index.ts). Checked on production 2026-11-12: /account/api-tokens opens
 * the Authorized Apps page, while /settings, /settings/api and /settings/api-tokens all show the
 * app's 404. server.json (official MCP Registry) and gemini-extension.json (Gemini gallery)
 * carried /settings-style links, and a Registry entry cannot be taken back once published.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const TOKEN_PAGE = 'https://app.slima.ai/account/api-tokens';
const FILES = ['server.json', 'gemini-extension.json', '.env.example', 'README.md', 'src/cli/index.ts'];

const appUrls = (file: string): string[] =>
  readFileSync(file, 'utf-8').match(/https:\/\/app\.slima\.ai\/[^\s)"'`>\]]*/g) ?? [];

describe('token page links', () => {
  it.each(['server.json', 'gemini-extension.json', '.env.example'])(
    '%s sends people to the real token page',
    (file) => {
      const urls = appUrls(file);
      expect(urls, `${file} should link the token page`).toContain(TOKEN_PAGE);
    }
  );

  it.each(FILES)('%s has no link into the nonexistent /settings tree', (file) => {
    const bad = appUrls(file).filter((u) => /^https:\/\/app\.slima\.ai\/settings(\/|$)/.test(u));
    expect(bad).toEqual([]);
  });
});
