/**
 * /callback → AI client hand-off.
 *
 * Unlike oauth.test.ts (which re-implements pieces of the flow), these drive the real
 * routes: /authorize stores the state, /callback consumes it.
 *
 * Why this file exists: /callback used to answer 302 → client. The Rails consent page is
 * a form POST, and Chromium applies that page's CSP `form-action` to every hop of the
 * redirect chain after the submission — so the hop from this Worker to claude.ai was
 * dropped AFTER the state had been consumed. Prod, 2026-09-14 → 10-05: 59 tokens minted,
 * 0 ever used; the user saw "The authorization session has expired" on the second press.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import {
  createOAuthRoutes,
  clientRedirectResponse,
  isPageNavigable,
  redirectUriRegistered,
  type Env,
} from '../../src/worker/oauth.js';

const CLIENT_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const ORIGIN = 'https://mcp.slima.ai';

function createKV() {
  const store = new Map<string, string>();
  return {
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    store,
  };
}

function setup() {
  const kv = createKV();
  const env = {
    SLIMA_API_URL: 'https://api.slima.ai',
    OAUTH_CLIENT_ID: 'slima-mcp-worker',
    OAUTH_KV: kv,
  } as unknown as Env;
  const app = new Hono<{ Bindings: Env }>();
  createOAuthRoutes(app);
  return { app, env, kv };
}

/** Runs /authorize like an AI client would and returns the internal state Rails echoes back. */
async function startFlow(
  app: Hono<{ Bindings: Env }>,
  env: Env,
  redirectUri = CLIENT_REDIRECT,
  clientState = 'client-state-1'
): Promise<string> {
  const query = new URLSearchParams({
    client_id: 'client-abc',
    redirect_uri: redirectUri,
    response_type: 'code',
    state: clientState,
    code_challenge: 'challenge',
    code_challenge_method: 'S256',
  });
  const res = await app.request(`${ORIGIN}/authorize?${query}`, {}, env);
  expect(res.status).toBe(302);
  const internalState = new URL(res.headers.get('Location')!).searchParams.get('state');
  expect(internalState).toBeTruthy();
  return internalState!;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * A stand-in for the Rails API, routed by URL — the Worker now makes two kinds of call
 * (client lookup, token), and a stub that answers everything the same way hides which one
 * a test is really exercising.
 */
function fakeApi(options: {
  clients?: Record<string, string[]>;
  clientLookup?: 'missing-route' | 'down' | 'error';
  token?: (body: Record<string, string>) => Response;
} = {}) {
  const clients = options.clients ?? { 'client-abc': [CLIENT_REDIRECT] };
  const calls: { url: string; body?: Record<string, string> }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, string>) : undefined;
    calls.push({ url, body });

    if (url.includes('/api/v1/oauth/clients/')) {
      if (options.clientLookup === 'down') throw new Error('network down');
      if (options.clientLookup === 'error') return json({ error: 'boom' }, 500);
      // What an API without the route answers: a 404 that is NOT `error: invalid_client`.
      if (options.clientLookup === 'missing-route') return json({ error: { code: 'NOT_FOUND' } }, 404);
      const id = decodeURIComponent(url.split('/api/v1/oauth/clients/')[1]);
      return clients[id]
        ? json({ client_id: id, client_name: 'Test Client', redirect_uris: clients[id] })
        : json({ error: 'invalid_client', error_description: 'Unknown client' }, 404);
    }
    if (url.endsWith('/api/v1/oauth/token')) {
      return options.token
        ? options.token(body ?? {})
        : json({ access_token: 'slima_rails_token', refresh_token: 'slima_rt_from_rails', expires_in: 31536000 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

async function authorize(
  app: Hono<{ Bindings: Env }>,
  env: Env,
  overrides: Record<string, string> = {}
): Promise<Response> {
  const query = new URLSearchParams({
    client_id: 'client-abc',
    redirect_uri: CLIENT_REDIRECT,
    response_type: 'code',
    state: 'client-state-1',
    code_challenge: 'challenge',
    code_challenge_method: 'S256',
    ...overrides,
  });
  return app.request(`${ORIGIN}/authorize?${query}`, {}, env);
}

async function postToken(app: Hono<{ Bindings: Env }>, env: Env, form: Record<string, string>): Promise<Response> {
  return app.request(
    `${ORIGIN}/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    },
    env
  );
}

describe('/callback hand-off to the AI client', () => {
  beforeEach(() => {
    fakeApi();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers 200 with a page that navigates to the registered redirect_uri — not a 302', async () => {
    const { app, env, kv } = setup();
    const state = await startFlow(app, env);

    const res = await app.request(`${ORIGIN}/callback?code=rails-code&state=${state}`, {}, env);

    // The whole fix: a 302 here is the hop Chromium drops under the consent page's form-action.
    expect(res.status).toBe(200);
    expect(res.headers.get('Location')).toBeNull();

    const html = await res.text();
    const workerCode = [...kv.store.keys()].find((k) => k.startsWith('auth_code:'))!.slice('auth_code:'.length);
    // `iss` (RFC 9207) is this Worker's origin — the same value as `issuer` in its metadata.
    const expected = `${CLIENT_REDIRECT}?code=${workerCode}&state=client-state-1&iss=${encodeURIComponent(ORIGIN)}`;

    // Positive evidence, three ways in: script, no-JS meta refresh, and a link to click.
    expect(html).toContain(`window.location.replace(${JSON.stringify(expected).replace(/&/g, '\\u0026')});`);
    expect(html).toContain(`<noscript><meta http-equiv="refresh" content="0;url=${expected.replace(/&/g, '&amp;')}"></noscript>`);
    expect(html).toContain(`<a id="continue" href="${expected.replace(/&/g, '&amp;')}"`);
  });

  it('sends headers that keep the code out of caches and referrers, and a CSP that lets its own script run', async () => {
    const { app, env } = setup();
    const state = await startFlow(app, env);

    const res = await app.request(`${ORIGIN}/callback?code=rails-code&state=${state}`, {}, env);
    const html = await res.text();

    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');

    const csp = res.headers.get('Content-Security-Policy')!;
    const nonce = csp.match(/script-src 'nonce-([A-Za-z0-9_-]+)'/)?.[1];
    expect(nonce).toBeTruthy();
    // The page must not block itself: the nonce in the header is the one on the script tag.
    expect(html).toContain(`<script nonce="${nonce}">`);
    // And it must not carry a form-action of its own to trip over.
    expect(csp).not.toContain('form-action');
  });

  it('only ever targets the redirect_uri stored for this state, whatever the callback URL says', async () => {
    const { app, env } = setup();
    const state = await startFlow(app, env);

    const res = await app.request(
      `${ORIGIN}/callback?code=rails-code&state=${state}&redirect_uri=https://evil.example/steal`,
      {},
      env
    );
    const html = await res.text();

    expect(html).toContain(CLIENT_REDIRECT);
    expect(html).not.toContain('evil.example');
  });

  it('escapes a hostile client state for both HTML and script context', async () => {
    const { app, env } = setup();
    const hostile = `"></script><script>alert(1)</script>`;
    const state = await startFlow(app, env, CLIENT_REDIRECT, hostile);

    const res = await app.request(`${ORIGIN}/callback?code=rails-code&state=${state}`, {}, env);
    const html = await res.text();

    expect(res.status).toBe(200);
    // Exactly one script element: the hostile state did not open a second one.
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).not.toContain('alert(1)</script>');
  });

  it('carries a Rails error back to the client through the same page', async () => {
    const { app, env } = setup();
    const state = await startFlow(app, env);

    const res = await app.request(`${ORIGIN}/callback?error=access_denied&state=${state}`, {}, env);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain(
      `${CLIENT_REDIRECT}?error=access_denied&amp;state=client-state-1&amp;iss=${encodeURIComponent(ORIGIN)}`
    );
  });

  describe('a second arrival on the same state', () => {
    it('says the authorization was already used — not that a session expired — and issues nothing new', async () => {
      const { app, env, kv } = setup();
      const state = await startFlow(app, env);
      const url = `${ORIGIN}/callback?code=rails-code&state=${state}`;

      const first = await app.request(url, {}, env);
      expect(first.status).toBe(200);
      const codesAfterFirst = [...kv.store.keys()].filter((k) => k.startsWith('auth_code:'));
      expect(codesAfterFirst).toHaveLength(1);

      const second = await app.request(url, {}, env);
      const html = await second.text();

      expect(second.status).toBe(400);
      expect(html).toContain('This authorization was already used');
      expect(html).toContain('click Connect again');
      expect(html).not.toContain('authorization session has expired');
      // No replay: no second code, and no redirect target on the page.
      expect([...kv.store.keys()].filter((k) => k.startsWith('auth_code:'))).toEqual(codesAfterFirst);
      expect(html).not.toContain(CLIENT_REDIRECT);
    });

    it('keeps nothing secret in the marker it leaves behind', async () => {
      const { app, env, kv } = setup();
      const state = await startFlow(app, env);

      await app.request(`${ORIGIN}/callback?code=rails-code&state=${state}`, {}, env);

      expect(kv.store.get(`oauth_done:${state}`)).toBe('1');
    });

    it('still reports an expired session for a state it has never seen', async () => {
      const { app, env } = setup();

      const res = await app.request(`${ORIGIN}/callback?code=x&state=never-issued`, {}, env);

      expect(res.status).toBe(400);
      expect(await res.text()).toContain('The authorization session has expired');
    });
  });
});

describe('clientRedirectResponse', () => {
  it('uses the page for https and loopback http', () => {
    expect(isPageNavigable('https://claude.ai/api/mcp/auth_callback?code=1')).toBe(true);
    expect(isPageNavigable('http://localhost:33418/callback')).toBe(true);
    expect(isPageNavigable('http://127.0.0.1:8976/cb')).toBe(true);
  });

  // A 302 to these is inert; a page that navigates to them is script on mcp.slima.ai.
  it.each(['javascript:alert(document.domain)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x'])(
    'never puts %s on a page — it keeps the plain 302',
    async (target) => {
      expect(isPageNavigable(target)).toBe(false);

      const res = clientRedirectResponse(target);

      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe(target);
      expect(await res.text()).toBe('');
    }
  );

  it('keeps the 302 for plain http to a non-loopback host and for app schemes', () => {
    expect(clientRedirectResponse('http://example.com/cb').status).toBe(302);
    expect(clientRedirectResponse('cursor://anysphere.cursor-mcp/oauth/callback?code=1').status).toBe(302);
  });
});

// Until 2026-10 /authorize accepted ANY redirect_uri: a crafted link showed the genuine Slima
// consent page, then delivered the code to whatever URL the link named.
describe('/authorize checks redirect_uri against the client registration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lets a registered redirect_uri through to the consent page', async () => {
    fakeApi();
    const { app, env } = setup();

    const res = await authorize(app, env);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('https://api.slima.ai/api/v1/oauth/authorize');
  });

  it('refuses a redirect_uri the client never registered — and does not redirect to it', async () => {
    fakeApi();
    const { app, env, kv } = setup();

    const res = await authorize(app, env, { redirect_uri: 'https://evil.example/steal' });

    expect(res.status).toBe(400);
    expect(res.headers.get('Location')).toBeNull();
    expect(await res.json()).toMatchObject({ error: 'invalid_request' });
    // No state was stored: there is nothing for a later /callback to complete.
    expect([...kv.store.keys()]).toEqual([]);
  });

  it('refuses a client_id that was never registered', async () => {
    fakeApi();
    const { app, env, kv } = setup();

    const res = await authorize(app, env, { client_id: 'mcp_never_registered' });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_client' });
    expect([...kv.store.keys()]).toEqual([]);
  });

  // Claude registered this exact URI long before the check existed; it must keep working.
  it('accepts the redirect_uri of a client registered before this check existed', async () => {
    fakeApi({ clients: { mcp_registered_in_august: ['https://claude.ai/api/mcp/auth_callback'] } });
    const { app, env } = setup();

    const res = await authorize(app, env, { client_id: 'mcp_registered_in_august' });

    expect(res.status).toBe(302);
  });

  describe('loopback redirects (Claude Code, Gemini CLI) match on any port — RFC 8252 §7.3', () => {
    it.each([
      ['http://localhost/callback', 'http://localhost:3118/callback'],
      ['http://127.0.0.1/callback', 'http://127.0.0.1:51234/callback'],
      ['http://localhost:7777/oauth/callback', 'http://localhost:40123/oauth/callback'],
    ])('registered %s accepts %s', (registered, requested) => {
      expect(redirectUriRegistered(requested, [registered])).toBe(true);
    });

    it.each([
      ['a different path', 'http://localhost/callback', 'http://localhost:3118/other'],
      ['localhost vs 127.0.0.1', 'http://localhost/callback', 'http://127.0.0.1:3118/callback'],
      ['https on loopback', 'http://localhost/callback', 'https://localhost:3118/callback'],
      ['a non-loopback host on another port', 'https://claude.ai/cb', 'https://claude.ai:8443/cb'],
      ['a look-alike host', 'http://localhost/callback', 'http://localhost.evil.example:3118/callback'],
      ['an added query', 'http://localhost/callback', 'http://localhost:3118/callback?next=evil'],
    ])('does not stretch to %s', (_label, registered, requested) => {
      expect(redirectUriRegistered(requested, [registered])).toBe(false);
    });
  });

  describe('when the API cannot answer', () => {
    it('refuses with 503 if the lookup fails — a check that passes when its backend is down is not a check', async () => {
      fakeApi({ clientLookup: 'down' });
      const { app, env, kv } = setup();

      const res = await authorize(app, env);

      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ error: 'temporarily_unavailable' });
      expect([...kv.store.keys()]).toEqual([]);
    });

    it('refuses with 503 on an API error', async () => {
      fakeApi({ clientLookup: 'error' });
      const { app, env } = setup();

      expect((await authorize(app, env)).status).toBe(503);
    });

    // The one deliberate gap: this Worker deployed ahead of an API that has no lookup route.
    it('proceeds only when the API has no such route at all (Worker deployed first)', async () => {
      fakeApi({ clientLookup: 'missing-route' });
      const { app, env } = setup();

      expect((await authorize(app, env)).status).toBe(302);
    });
  });
});

// The Worker's refresh grant used to hand the SAME access token back and never ask Rails for
// a new one — so once that token expired, no amount of refreshing helped.
describe('/token', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function codeFor(app: Hono<{ Bindings: Env }>, env: Env, kv: ReturnType<typeof createKV>) {
    const res = await authorize(app, env, { code_challenge: await s256('verifier-1') });
    const state = new URL(res.headers.get('Location')!).searchParams.get('state')!;
    await app.request(`${ORIGIN}/callback?code=rails-code&state=${state}`, {}, env);
    return [...kv.store.keys()].find((k) => k.startsWith('auth_code:'))!.slice('auth_code:'.length);
  }

  async function s256(verifier: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  it('returns the refresh token Rails issued, and mints none of its own', async () => {
    fakeApi();
    const { app, env, kv } = setup();
    const code = await codeFor(app, env, kv);

    const res = await postToken(app, env, { grant_type: 'authorization_code', code, code_verifier: 'verifier-1' });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      access_token: 'slima_rails_token',
      refresh_token: 'slima_rt_from_rails',
      token_type: 'bearer',
    });
    expect([...kv.store.keys()].filter((k) => k.startsWith('refresh:'))).toEqual([]);
  });

  it('still mints a KV refresh token when the API returned none (API older than this Worker)', async () => {
    fakeApi({ token: () => json({ access_token: 'slima_rails_token', expires_in: 31536000 }) });
    const { app, env, kv } = setup();
    const code = await codeFor(app, env, kv);

    const res = await postToken(app, env, { grant_type: 'authorization_code', code, code_verifier: 'verifier-1' });
    const body = (await res.json()) as { refresh_token: string };

    expect(res.status).toBe(200);
    expect(kv.store.has(`refresh:${body.refresh_token}`)).toBe(true);
  });

  describe('grant_type=refresh_token', () => {
    it('asks Rails for a new pair and returns exactly what Rails returned', async () => {
      const { calls } = fakeApi({
        token: (body) =>
          body.grant_type === 'refresh_token'
            ? json({ access_token: 'slima_new_access', refresh_token: 'slima_rt_rotated', expires_in: 31536000 })
            : json({ error: 'unexpected' }, 400),
      });
      const { app, env } = setup();

      const res = await postToken(app, env, { grant_type: 'refresh_token', refresh_token: 'slima_rt_from_rails' });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        access_token: 'slima_new_access',
        token_type: 'bearer',
        expires_in: 31536000,
        scope: 'read write',
        refresh_token: 'slima_rt_rotated',
      });
      // It went to Rails as the Worker's own client — the AI client's client_id is not Rails' business.
      expect(calls.at(-1)).toEqual({
        url: 'https://api.slima.ai/api/v1/oauth/token',
        body: { grant_type: 'refresh_token', refresh_token: 'slima_rt_from_rails', client_id: 'slima-mcp-worker' },
      });
    });

    it('answers invalid_grant when Rails rejects the token, so the client re-authorizes', async () => {
      fakeApi({ token: () => json({ error: 'invalid_grant' }, 400) });
      const { app, env } = setup();

      const res = await postToken(app, env, { grant_type: 'refresh_token', refresh_token: 'slima_rt_revoked' });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid_grant' });
    });

    // invalid_grant here would make the client throw away a connection that is perfectly fine.
    it('answers 503 — not invalid_grant — when the API is failing', async () => {
      fakeApi({ token: () => json({ error: 'boom' }, 500) });
      const { app, env } = setup();

      const res = await postToken(app, env, { grant_type: 'refresh_token', refresh_token: 'slima_rt_x' });

      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ error: 'temporarily_unavailable' });
    });

    // People connected before this change hold a Worker-minted token that lives only in KV.
    it('keeps honouring a legacy KV refresh token without asking Rails — nobody is signed out', async () => {
      const { calls } = fakeApi();
      const { app, env, kv } = setup();
      kv.store.set('refresh:legacy-uuid', JSON.stringify({ accessToken: 'slima_old_access', expiresIn: 31536000 }));

      const res = await postToken(app, env, { grant_type: 'refresh_token', refresh_token: 'legacy-uuid' });
      const body = (await res.json()) as { access_token: string; refresh_token: string };

      expect(res.status).toBe(200);
      expect(body.access_token).toBe('slima_old_access');
      expect(kv.store.has(`refresh:${body.refresh_token}`)).toBe(true);
      expect(kv.store.has('refresh:legacy-uuid')).toBe(false);
      expect(calls).toEqual([]);
    });
  });
});

// Clients that validate `iss` (Gemini CLI rejects a callback without it) look for this flag,
// and compare the parameter against `issuer`. Both come from the same origin here.
describe('authorization server metadata', () => {
  it.each(['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp'])(
    '%s advertises iss support with the origin as issuer',
    async (path) => {
      const { default: worker } = await import('../../src/worker/index.js');
      const { env } = setup();

      const res = await worker.request(`${ORIGIN}${path}`, {}, env);
      const metadata = (await res.json()) as Record<string, unknown>;

      expect(metadata.issuer).toBe(ORIGIN);
      expect(metadata.authorization_response_iss_parameter_supported).toBe(true);
      expect(metadata.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
    }
  );
});
