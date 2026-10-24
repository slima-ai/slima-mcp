/**
 * GET /mcp must answer 405, not open (and instantly close) an SSE stream.
 *
 * 2026-10-24 incident: one authenticated `claude-code/2.1.309` client hit `GET /mcp` about twice a
 * second for 24h+ and used up the account's whole free Workers quota (147,119 requests in a day;
 * mcp.slima.ai and test-mcp.slima.ai both went to Cloudflare 1027 / HTTP 429).
 *
 * Why: this Worker is stateless. The SDK transport answered GET with 200 + an SSE stream, and the
 * handler's `finally { transport.close() }` ended that stream at once. The client saw "200, then the
 * stream ended", took it for a dropped connection and reconnected; every reconnect "succeeded", so its
 * back-off never grew. A server that does not offer a GET SSE stream must say 405 (MCP Streamable HTTP
 * spec, "Listening for Messages from the Server"); the SDK client then stops trying
 * (client/streamableHttp.js: "405 indicates that the server does not offer an SSE stream at GET endpoint").
 *
 * An UNAUTHENTICATED GET keeps its 401 + WWW-Authenticate: some clients use it to discover the OAuth
 * metadata, and a client without a token does not loop (it goes off to authorize).
 */
import { describe, it, expect, vi } from 'vitest';
import app from '../../src/worker/index.js';

vi.mock('../../src/core/api/client.js', () => ({
  SlimaApiClient: vi.fn().mockImplementation(() => ({})),
}));

const env = {
  SLIMA_API_URL: 'https://api.slima.ai',
  OAUTH_CLIENT_ID: 'slima-mcp-worker',
  OAUTH_KV: { get: vi.fn(async () => null), put: vi.fn(async () => undefined), delete: vi.fn(async () => undefined) },
} as never;

const sse = { Accept: 'text/event-stream', Authorization: 'Bearer slima_test_token' };
const rpcHeaders = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

async function rpc(method: string, params: unknown = {}, withAuth = true) {
  const res = await app.request(
    'https://mcp.slima.ai/mcp',
    {
      method: 'POST',
      headers: withAuth ? { ...rpcHeaders, Authorization: 'Bearer slima_test_token' } : rpcHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    },
    env
  );
  return res;
}

describe('GET /mcp', () => {
  it('answers an authenticated GET with 405 and an Allow header that does not list GET', async () => {
    const res = await app.request('https://mcp.slima.ai/mcp', { method: 'GET', headers: sse }, env);

    expect(res.status).toBe(405);
    const allow = (res.headers.get('Allow') ?? '').split(',').map((m) => m.trim().toUpperCase());
    expect(allow).toContain('POST');
    expect(allow).not.toContain('GET');
    expect(res.headers.get('Content-Type') ?? '').not.toContain('text/event-stream');
  });

  it('does not depend on the Accept header (a GET that asks for JSON is refused the same way)', async () => {
    const res = await app.request(
      'https://mcp.slima.ai/mcp',
      { method: 'GET', headers: { Accept: 'application/json', Authorization: 'Bearer slima_test_token' } },
      env
    );
    expect(res.status).toBe(405);
  });

  it('keeps 401 + WWW-Authenticate for a GET with no credentials (OAuth discovery)', async () => {
    const res = await app.request('https://mcp.slima.ai/mcp', { method: 'GET', headers: { Accept: 'text/event-stream' } }, env);

    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('resource_metadata=');
  });
});

describe('everything else on /mcp is unchanged', () => {
  it('HEAD still answers 200 with the protocol version', async () => {
    const res = await app.request('https://mcp.slima.ai/mcp', { method: 'HEAD' }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('MCP-Protocol-Version')).toBeTruthy();
  });

  it('POST initialize (no token) still works', async () => {
    const res = await rpc(
      'initialize',
      { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } },
      false
    );
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toContain('serverInfo');
  });

  it('POST tools/list (with token) still lists the tools', async () => {
    const res = await rpc('tools/list');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result?: { tools?: unknown[] } };
    expect(body.result?.tools?.length).toBeGreaterThan(30);
  });

  it('POST tools/list without a token is still 401', async () => {
    const res = await rpc('tools/list', {}, false);
    expect(res.status).toBe(401);
  });

  it('the OAuth discovery documents and /mcp/info are untouched', async () => {
    for (const path of [
      '/mcp/info',
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
    ]) {
      const res = await app.request(`https://mcp.slima.ai${path}`, { method: 'GET' }, env);
      expect(res.status, path).toBe(200);
    }
  });

  it('/authorize and /token are still routed (they are not 405)', async () => {
    const authorize = await app.request('https://mcp.slima.ai/authorize', { method: 'GET' }, env);
    const token = await app.request('https://mcp.slima.ai/token', { method: 'POST', body: '' }, env);
    expect(authorize.status).not.toBe(405);
    expect(token.status).not.toBe(405);
  });
});
