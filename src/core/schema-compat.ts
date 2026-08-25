/**
 * Tool-schema compatibility with Gemini's function-calling API.
 *
 * Gemini does NOT take JSON Schema for `functionDeclarations[].parameters`. It takes a
 * strict OpenAPI-3.0-subset **proto**, and an unknown field is not ignored — it is a hard
 * HTTP 400 for the ENTIRE request:
 *
 *     Invalid JSON payload received. Unknown name "$schema" at
 *     'tools[0].function_declarations[0].parameters': Cannot find field.
 *
 * One bad key therefore costs the client *every* tool we publish, not just the tool that
 * carried it — and the failure is invisible from our side: the MCP handshake succeeds,
 * `tools/list` returns 200 with the full catalogue, and only Gemini's own model layer
 * rejects it afterwards.
 *
 * 2026-08-25 incident: a user connected Slima to the Gemini app. OAuth completed, the
 * token was issued, every `POST /mcp` returned 200/202 with zero 4xx — and Gemini told
 * them "no Slima tools are registered" and answered book questions from web search.
 * `api_tokens.last_used_at` stayed NULL for all three of their tokens: not one tool call
 * ever reached Rails. The whole cause was `$schema` + `additionalProperties`, which the
 * SDK's zod-to-json-schema emits automatically on every single tool.
 *
 * Both keys are pure metadata for tool-calling purposes — the server validates arguments
 * against the zod shape either way, so dropping them from the *advertised* schema changes
 * no behaviour. Verified against all three real APIs with our actual tool catalogue:
 * Anthropic and OpenAI accept the schemas with or without them; Gemini only without.
 */

import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

/**
 * Keys Gemini's `parameters` proto rejects outright. Measured, not assumed — every key
 * here was fed to `generateContent` and came back as `Unknown name "<key>"` (2026-08-25,
 * gemini-3-flash-preview). Kept as data so the guard test below can stay a data check.
 */
export const GEMINI_REJECTED_SCHEMA_KEYS = [
  '$ref',
  '$schema',
  'additionalProperties',
  'const',
  'contains',
  'deprecated',
  'examples',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'multipleOf',
  'patternProperties',
  'readOnly',
  'uniqueItems',
  'writeOnly',
] as const;

/**
 * The subset we strip automatically.
 *
 * Deliberately only these two, NOT all of GEMINI_REJECTED_SCHEMA_KEYS. These two carry no
 * meaning a tool caller can act on, so removing them is lossless. The rest do carry
 * meaning — dropping a `$ref` leaves `{}` (a schema that describes nothing), dropping a
 * `const` silently widens an argument the tool actually constrains. Quietly mangling a
 * schema is worse than the 400 it avoids, so those stay unhandled on purpose and the
 * guard test in tests/worker/tool-schema-compat.test.ts turns red the day a tool starts
 * emitting one. Fix it at the zod shape then, not here.
 */
export const STRIPPED_SCHEMA_KEYS = ['$schema', 'additionalProperties'] as const;

const STRIPPED = new Set<string>(STRIPPED_SCHEMA_KEYS);

/** Recursively copy a JSON Schema without the keys Gemini refuses to parse. */
export function stripIncompatibleSchemaKeys<T>(node: T): T {
  if (Array.isArray(node)) {
    return node.map((item) => stripIncompatibleSchemaKeys(item)) as unknown as T;
  }
  if (node !== null && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (STRIPPED.has(key)) continue;
      out[key] = stripIncompatibleSchemaKeys(value);
    }
    return out as unknown as T;
  }
  return node;
}

interface ToolListResult {
  tools?: Array<Record<string, unknown>>;
}

/**
 * Sanitize a `tools/list` response in place of the raw one. Any other message passes
 * through untouched (identity, same object) so this stays free on the hot path.
 */
export function sanitizeOutgoingMessage(message: JSONRPCMessage): JSONRPCMessage {
  const result = (message as { result?: ToolListResult }).result;
  if (!result || !Array.isArray(result.tools)) return message;

  return {
    ...message,
    result: {
      ...result,
      tools: result.tools.map((tool) => {
        const sanitized: Record<string, unknown> = { ...tool };
        for (const field of ['inputSchema', 'outputSchema']) {
          if (sanitized[field]) sanitized[field] = stripIncompatibleSchemaKeys(sanitized[field]);
        }
        return sanitized;
      }),
    },
  } as JSONRPCMessage;
}

interface SendCapableTransport {
  send(message: JSONRPCMessage, options?: unknown): Promise<void>;
}

/**
 * Wrap a transport so every outgoing message goes through {@link sanitizeOutgoingMessage}.
 *
 * Hooking `send` rather than the `tools/list` request handler keeps this transport-shaped:
 * it covers JSON responses, SSE frames and stdio alike, and it does not reach into the
 * SDK's private handler registry. Call it BEFORE `server.connect(transport)`.
 */
export function withGeminiSchemaCompat<T extends SendCapableTransport>(transport: T): T {
  const send = transport.send.bind(transport);
  transport.send = (message: JSONRPCMessage, options?: unknown) =>
    send(sanitizeOutgoingMessage(message), options);
  return transport;
}
