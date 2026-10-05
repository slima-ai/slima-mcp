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

function railsTokenOk() {
  return vi.fn(async () =>
    new Response(JSON.stringify({ access_token: 'slima_rails_token', expires_in: 31536000 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

describe('/callback hand-off to the AI client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', railsTokenOk());
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
    const expected = `${CLIENT_REDIRECT}?code=${workerCode}&state=client-state-1`;

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
    expect(html).toContain(`${CLIENT_REDIRECT}?error=access_denied&amp;state=client-state-1`);
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
