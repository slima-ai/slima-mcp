/**
 * Architecture guard: everything we publish in tools/list must be parseable by Gemini.
 *
 * This drives the REAL handler with the REAL tool registrations, so it fails the day
 * someone adds a tool whose zod shape compiles to a construct Gemini's `parameters` proto
 * rejects (z.literal() → const, a reused schema → $ref, .positive() → exclusiveMinimum …).
 *
 * It has to be an end-to-end assertion rather than a unit test of the sanitizer: the
 * 2026-08-25 outage was invisible to every signal we had — handshake fine, tools/list 200,
 * full catalogue in the body — and only Gemini's own model layer rejected it. Nothing
 * short of inspecting the bytes we actually emit would have caught it.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleMcpRequest, McpHandlerOptions } from '../../src/worker/mcp-handler.js';
import { GEMINI_REJECTED_SCHEMA_KEYS } from '../../src/core/schema-compat.js';

vi.mock('../../src/core/api/client.js', () => ({
  SlimaApiClient: vi.fn().mockImplementation(() => ({})),
}));

const options: McpHandlerOptions = {
  apiUrl: 'https://api.slima.ai',
  getToken: async () => 'slima_test_token',
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
};

async function listTools(): Promise<Array<{ name: string; inputSchema?: unknown }>> {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'application/json, text/event-stream');

  const response = await handleMcpRequest(
    new Request('https://mcp.slima.ai/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }),
    options
  );

  const body = (await response.json()) as { result?: { tools?: Array<{ name: string }> } };
  return (body.result?.tools ?? []) as Array<{ name: string; inputSchema?: unknown }>;
}

function keysIn(node: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) {
    node.forEach((item) => keysIn(item, found));
  } else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      found.add(key);
      keysIn(value, found);
    }
  }
  return found;
}

describe('published tool schemas are Gemini-compatible', () => {
  it('publishes a non-empty catalogue (guards against the assertion below passing vacuously)', async () => {
    expect((await listTools()).length).toBeGreaterThan(0);
  });

  it('emits no key that Gemini refuses to parse', async () => {
    const offenders: string[] = [];

    for (const tool of await listTools()) {
      for (const key of keysIn(tool.inputSchema)) {
        if ((GEMINI_REJECTED_SCHEMA_KEYS as readonly string[]).includes(key)) {
          offenders.push(`${tool.name}: ${key}`);
        }
      }
    }

    // If this fails on $schema / additionalProperties, the transport is no longer wrapped
    // in withGeminiSchemaCompat. If it fails on anything else, a new tool's zod shape
    // emits a construct that CANNOT be stripped without lying about the tool — change the
    // shape (e.g. z.enum() instead of z.literal()), do not widen the strip list.
    expect(offenders).toEqual([]);
  });
});
