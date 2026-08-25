/**
 * Tool-schema compatibility tests.
 *
 * See src/core/schema-compat.ts for why these two keys are the difference between
 * "Gemini uses our tools" and "Gemini says the server has no tools".
 */

import { describe, it, expect, vi } from 'vitest';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import {
  stripIncompatibleSchemaKeys,
  sanitizeOutgoingMessage,
  withGeminiSchemaCompat,
  STRIPPED_SCHEMA_KEYS,
  GEMINI_REJECTED_SCHEMA_KEYS,
} from '../../src/core/schema-compat.js';

describe('stripIncompatibleSchemaKeys', () => {
  it('drops $schema and additionalProperties at every depth', () => {
    const schema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      properties: {
        nested: {
          type: 'object',
          additionalProperties: false,
          properties: { deep: { type: 'string' } },
        },
        list: {
          type: 'array',
          items: { type: 'object', additionalProperties: false, properties: {} },
        },
      },
      required: ['nested'],
    };

    expect(stripIncompatibleSchemaKeys(schema)).toEqual({
      type: 'object',
      properties: {
        nested: { type: 'object', properties: { deep: { type: 'string' } } },
        list: { type: 'array', items: { type: 'object', properties: {} } },
      },
      required: ['nested'],
    });
  });

  it('keeps everything else byte-for-byte, including keys Gemini does accept', () => {
    const schema = {
      type: 'object',
      properties: {
        page: { type: 'number', description: 'Page number', default: 1, minimum: 1 },
        mode: { type: 'string', enum: ['a', 'b'], title: 'Mode' },
      },
      required: ['mode'],
    };

    expect(stripIncompatibleSchemaKeys(schema)).toEqual(schema);
  });

  it('does not mutate the input', () => {
    const schema = { $schema: 'x', type: 'object', properties: {} };
    stripIncompatibleSchemaKeys(schema);
    expect(schema.$schema).toBe('x');
  });

  it('only strips the lossless subset — the rest must fail loud, not be mangled', () => {
    // $ref and const are rejected by Gemini too, but dropping them would leave a schema
    // that lies about the tool. They are deliberately NOT stripped; the guard test in
    // tests/worker/tool-schema-compat.test.ts is what catches them.
    const notStripped = GEMINI_REJECTED_SCHEMA_KEYS.filter(
      (key) => !(STRIPPED_SCHEMA_KEYS as readonly string[]).includes(key)
    );
    expect(notStripped).toContain('$ref');
    expect(notStripped).toContain('const');

    const schema = { type: 'object', properties: { a: { const: 'fixed' } } };
    expect(stripIncompatibleSchemaKeys(schema)).toEqual(schema);
  });
});

describe('sanitizeOutgoingMessage', () => {
  it('sanitizes inputSchema and outputSchema of every tool in a tools/list result', () => {
    const message = {
      jsonrpc: '2.0',
      id: 1,
      result: {
        tools: [
          {
            name: 'list_books',
            description: 'd',
            inputSchema: { $schema: 'x', type: 'object', properties: {} },
            outputSchema: { $schema: 'x', type: 'object', additionalProperties: false },
          },
        ],
      },
    } as unknown as JSONRPCMessage;

    const out = sanitizeOutgoingMessage(message) as unknown as {
      result: { tools: Array<Record<string, unknown>> };
    };

    expect(out.result.tools[0].inputSchema).toEqual({ type: 'object', properties: {} });
    expect(out.result.tools[0].outputSchema).toEqual({ type: 'object' });
    expect(out.result.tools[0].name).toBe('list_books');
  });

  it('passes every other message through untouched', () => {
    const message = {
      jsonrpc: '2.0',
      id: 2,
      result: { content: [{ type: 'text', text: 'hi' }] },
    } as unknown as JSONRPCMessage;

    expect(sanitizeOutgoingMessage(message)).toBe(message);
  });
});

describe('withGeminiSchemaCompat', () => {
  it('sanitizes what the transport actually sends, and forwards send options', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const transport = { send };

    withGeminiSchemaCompat(transport);

    const message = {
      jsonrpc: '2.0',
      id: 1,
      result: { tools: [{ name: 't', inputSchema: { $schema: 'x', type: 'object' } }] },
    } as unknown as JSONRPCMessage;

    await transport.send(message, { relatedRequestId: 7 });

    const [sent, options] = send.mock.calls[0];
    expect(sent.result.tools[0].inputSchema).toEqual({ type: 'object' });
    expect(options).toEqual({ relatedRequestId: 7 });
  });
});
