/**
 * The README's "Available Tools" section is what a directory reviewer and a new user read
 * first. It listed 14 tools while the server registered 39, so the page undersold the
 * product and hid the tools a reviewer is told to test. This keeps the two equal.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { TOOL_TITLES } from '../../src/core/tools/titles.js';

const readme = readFileSync('README.md', 'utf-8');
const section = readme.slice(readme.indexOf('## Available Tools'), readme.indexOf('## Usage Examples'));
const listed = [...section.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]);

describe('README Available Tools', () => {
  it('lists every registered tool', () => {
    const missing = Object.keys(TOOL_TITLES).filter((name) => !listed.includes(name));
    expect(missing).toEqual([]);
  });

  it('lists no tool the server does not register', () => {
    const stale = listed.filter((name) => !(name in TOOL_TITLES));
    expect(stale).toEqual([]);
  });

  it('lists each tool once', () => {
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('states the real tool count when it states one', () => {
    const claim = readme.match(/\b(\d+) tools\b/);
    if (claim) expect(Number(claim[1])).toBe(Object.keys(TOOL_TITLES).length);
  });
});

describe('where the author manages tokens', () => {
  // app.slima.ai/settings/api-tokens is not a page; the list of connected apps is
  // Account settings -> "Authorized Apps" at /account/api-tokens (slima_vue router,
  // checked 2026-10-22). The README and the CLI both sent people to the old path.
  const files: Record<string, string> = {
    'README.md': readme,
    'src/cli/index.ts': readFileSync('src/cli/index.ts', 'utf-8'),
  };

  for (const [file, text] of Object.entries(files)) {
    it(`${file} does not point at the old settings/api-tokens path`, () => {
      expect(text).not.toContain('settings/api-tokens');
    });
  }

  it('README names the page the way the app does', () => {
    expect(readme).toContain('app.slima.ai/account/api-tokens');
    expect(readme).toContain('Authorized Apps');
  });
});
