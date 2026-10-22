/**
 * The files each directory reads must agree with package.json and with each other.
 *
 * server.json is what the official MCP Registry publishes (`mcp-publisher publish`);
 * it sat at 0.2.0 while npm was at 0.3.2, so the registry listing described a
 * release that no longer existed. gemini-extension.json is what Gemini CLI's
 * extension gallery crawls (geminicli.com/docs/extensions/releasing/, checked
 * 2026-10-22): it must be at the repo root and carry a name, version and description.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const read = (file: string) => JSON.parse(readFileSync(file, 'utf-8'));
const pkg = read('package.json');
const serverJson = read('server.json');
const geminiExtension = read('gemini-extension.json');

describe('server.json (official MCP Registry)', () => {
  it('has the same version as package.json, at the top and in the npm package entry', () => {
    expect(serverJson.version).toBe(pkg.version);
    const npm = serverJson.packages.find((p: { registryType: string }) => p.registryType === 'npm');
    expect(npm.version).toBe(pkg.version);
  });

  it('declares environment variables with the registry schema field names (isRequired / isSecret)', () => {
    // 2025-12-11 server.schema.json: an Input has `isRequired` and `isSecret`. `required` is not a
    // field there, so the token was published as optional and not secret. A registry entry cannot
    // be taken back once published, which is why this is checked before, not after.
    const npm = serverJson.packages.find((p: { registryType: string }) => p.registryType === 'npm');
    const token = npm.environmentVariables.find((e: { name: string }) => e.name === 'SLIMA_API_TOKEN');
    expect(token.isRequired).toBe(true);
    expect(token.isSecret).toBe(true);
    for (const env of npm.environmentVariables) {
      expect(Object.keys(env), `${env.name}: use isRequired, not required`).not.toContain('required');
    }
  });

  it('names the same npm package and MCP name as package.json', () => {
    const npm = serverJson.packages.find((p: { registryType: string }) => p.registryType === 'npm');
    expect(npm.identifier).toBe(pkg.name);
    expect(serverJson.name).toBe(pkg.mcpName);
  });
});

describe('gemini-extension.json (Gemini CLI extension gallery)', () => {
  it('has a lowercase-dashes name, a description, and the same version as package.json', () => {
    expect(geminiExtension.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(geminiExtension.description).toBeTruthy();
    expect(geminiExtension.version).toBe(pkg.version);
  });

  it('starts the published npm package over stdio, split into command and args', () => {
    const server = geminiExtension.mcpServers.slima;
    expect(server.command).toBe('npx');
    expect(server.args).toContain(pkg.name + '@0');
    // The manifest asks for `command` and `args` separately, never one joined string.
    expect(server.command).not.toMatch(/\s/);
  });

  it('declares SLIMA_API_TOKEN as a sensitive setting so the CLI passes it to the server', () => {
    const token = geminiExtension.settings.find((s: { envVar: string }) => s.envVar === 'SLIMA_API_TOKEN');
    expect(token).toBeDefined();
    expect(token.sensitive).toBe(true);
  });
});
