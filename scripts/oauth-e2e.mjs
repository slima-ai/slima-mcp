/**
 * End-to-end drive of the remote-MCP OAuth flow, with a real browser.
 *
 * Plays the part of an AI client (Claude Code / Gemini CLI style: dynamic registration,
 * PKCE, a loopback redirect) against a real Worker and a real API, and uses a real Chromium
 * to do what the person does — land on the consent page and press Allow.
 *
 * Why a browser: this flow broke twice in ways every server-side test passed. The Worker
 * and the API each returned success at every step; the browser dropped a redirect hop.
 *
 *   MCP_BASE=http://localhost:8787 \
 *   LOGIN_URL='http://localhost:3000/dev/qa_login?user_id=…&qa_token=…' \
 *   node scripts/oauth-e2e.mjs
 *
 * LOGIN_URL is any URL that leaves the browser signed in at the API (optional if the
 * profile is already signed in). Nothing here prints a code or a token.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import WebSocket from 'ws';

const MCP_BASE = (process.env.MCP_BASE ?? 'http://localhost:8787').replace(/\/$/, '');
const LOGIN_URL = process.env.LOGIN_URL;
const READ_ONLY_TOOL = process.env.READ_ONLY_TOOL ?? 'list_books';
const CHROMIUM =
  process.env.CHROMIUM_BIN ??
  ['chromium-browser', 'chromium', 'google-chrome']
    .map((bin) => {
      try {
        return execSync(`which ${bin}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      } catch {
        return '';
      }
    })
    .find(Boolean);

const results = [];
function check(label, ok, detail = '') {
  results.push({ label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  return ok;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

// ---- the "AI client": a loopback server that receives the authorization response ----
let callbackQuery = null;
let callbackHits = 0;
const clientServer = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/callback') {
    callbackHits += 1;
    callbackQuery = Object.fromEntries(url.searchParams);
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<p id="client">CLIENT-RECEIVED</p>');
});
await new Promise((resolve) => clientServer.listen(0, '127.0.0.1', resolve));
const clientPort = clientServer.address().port;
// Registered WITHOUT a port; requested WITH one — the Worker must match loopback on any port.
const registeredRedirect = 'http://localhost/callback';
const redirectUri = `http://localhost:${clientPort}/callback`;

// ---- a minimal DevTools-protocol driver (no browser-automation dependency) ----
// A snap-packaged Chromium cannot write under /tmp; point E2E_PROFILE_BASE at a directory
// in your home in that case.
const profile = mkdtempSync(join(process.env.E2E_PROFILE_BASE ?? tmpdir(), 'slima-oauth-e2e-'));
const browser = spawn(
  CHROMIUM,
  ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: 'ignore' }
);
async function devtoolsSocket() {
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i += 1) await sleep(100);
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return ws;
}
let ws;
let seq = 0;
const waiting = new Map();
function cdp(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => waiting.set(id, resolve));
}
async function evaluate(expression) {
  const reply = await cdp('Runtime.evaluate', { expression, returnByValue: true });
  return reply.result?.result?.value;
}
async function waitFor(expression, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await evaluate(expression);
      if (value) return value;
    } catch {
      /* navigating */
    }
    await sleep(200);
  }
  return null;
}

async function rpc(token, body) {
  const res = await fetch(`${MCP_BASE}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  // Streamable HTTP may answer as JSON or as a single SSE event.
  const payload = text.startsWith('{') ? text : (text.split('\n').find((l) => l.startsWith('data:')) ?? '').slice(5);
  let parsed = null;
  try {
    parsed = JSON.parse(payload);
  } catch {
    /* leave null */
  }
  return { status: res.status, headers: res.headers, json: parsed };
}

async function token(form) {
  const res = await fetch(`${MCP_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

try {
  console.log(`MCP_BASE=${MCP_BASE}  chromium=${CHROMIUM}`);

  // 1. Discovery, the way a client finds us.
  const unauth = await rpc(null, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const challenge = unauth.headers.get('www-authenticate') ?? '';
  check('unauthenticated /mcp answers 401 with a resource_metadata pointer', unauth.status === 401 && challenge.includes('resource_metadata='));
  const metadata = await (await fetch(`${MCP_BASE}/.well-known/oauth-authorization-server`)).json();
  check('metadata: issuer is the origin and iss support is advertised', metadata.issuer === MCP_BASE && metadata.authorization_response_iss_parameter_supported === true);

  // 2. Dynamic client registration.
  const registration = await fetch(`${MCP_BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'oauth-e2e (scripted)',
      redirect_uris: [registeredRedirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  const client = await registration.json();
  if (!check('dynamic client registration', registration.status === 201 && !!client.client_id, `status ${registration.status}`)) {
    throw new Error('cannot continue without a client');
  }

  // 3. /authorize refuses what was not registered — before any browser is involved.
  const verifier = b64url(randomBytes(48));
  const codeChallenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));
  const authorizeUrl = (overrides = {}) =>
    `${MCP_BASE}/authorize?${new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      ...overrides,
    })}`;
  const evil = await fetch(authorizeUrl({ redirect_uri: 'https://evil.example/steal' }), { redirect: 'manual' });
  check('/authorize refuses an unregistered redirect_uri without redirecting', evil.status === 400 && !evil.headers.get('location'), `status ${evil.status}`);
  const stranger = await fetch(authorizeUrl({ client_id: 'mcp_never_registered' }), { redirect: 'manual' });
  check('/authorize refuses an unknown client_id', stranger.status === 400, `status ${stranger.status}`);

  // 4. The person's part, in a real browser.
  ws = await devtoolsSocket();
  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.id && waiting.has(message.id)) {
      waiting.get(message.id)(message);
      waiting.delete(message.id);
    }
  });
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  if (LOGIN_URL) {
    await cdp('Page.navigate', { url: LOGIN_URL });
    await sleep(3000);
  }
  await cdp('Page.navigate', { url: authorizeUrl() });
  const onConsent = await waitFor(`!!document.querySelector('form[action="/api/v1/oauth/authorize"] button[type=submit]')`);
  if (!check('browser reaches the consent page', !!onConsent, onConsent ? '' : `stuck at ${await evaluate('location.href.split("?")[0]')}`)) {
    throw new Error('not signed in at the API? pass LOGIN_URL');
  }
  const notice = await evaluate(`document.getElementById('redirect-notice')?.innerText.trim()`);
  check('consent page does not name the Worker as the destination', !!notice && !/localhost:8787|mcp\.slima\.ai/.test(notice), notice ?? 'no notice');

  await evaluate(`document.querySelector('form[action="/api/v1/oauth/authorize"] button[type=submit]').click()`);
  for (let i = 0; i < 75 && !callbackQuery; i += 1) await sleep(200);
  if (!check('after Allow, the browser arrives at the client redirect_uri', !!callbackQuery, callbackQuery ? '' : `browser stayed at ${await evaluate('location.href.split("?")[0]')}`)) {
    throw new Error('the hand-off never reached the client');
  }
  check('callback carries code, the original state, and iss = issuer',
    !!callbackQuery.code && callbackQuery.state === state && callbackQuery.iss === MCP_BASE,
    `state ${callbackQuery.state === state ? 'ok' : 'MISMATCH'}, iss ${callbackQuery.iss}`);
  await sleep(1500);
  check('the client was called exactly once', callbackHits === 1, `${callbackHits} hits`);

  // 5. Code → tokens.
  const first = await token({ grant_type: 'authorization_code', code: callbackQuery.code, code_verifier: verifier, client_id: client.client_id, redirect_uri: redirectUri });
  if (!check('code exchanges for an access token and a refresh token', first.status === 200 && !!first.json.access_token && !!first.json.refresh_token, `status ${first.status}`)) {
    throw new Error('no token');
  }
  check('the refresh token is one the API issued (not a Worker UUID)', String(first.json.refresh_token).startsWith('slima_rt_'));
  const reuse = await token({ grant_type: 'authorization_code', code: callbackQuery.code, code_verifier: verifier, client_id: client.client_id, redirect_uri: redirectUri });
  check('the authorization code is single-use', reuse.status === 400 && reuse.json.error === 'invalid_grant');

  // 6. Use it.
  await rpc(first.json.access_token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'oauth-e2e', version: '0' } } });
  const tools = await rpc(first.json.access_token, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = (tools.json?.result?.tools ?? []).map((t) => t.name);
  check('tools/list works with the access token', tools.status === 200 && names.length > 0, `${names.length} tools`);
  const call = await rpc(first.json.access_token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: READ_ONLY_TOOL, arguments: {} } });
  check(`a read-only tool call succeeds (${READ_ONLY_TOOL})`, call.status === 200 && !call.json?.error && call.json?.result?.isError !== true,
    call.json?.error?.message ?? (call.json?.result?.isError ? 'tool returned isError' : ''));

  // 7. Refresh — the part that used to hand the same token back.
  const refreshed = await token({ grant_type: 'refresh_token', refresh_token: first.json.refresh_token, client_id: client.client_id });
  check('refresh returns a NEW access token and a NEW refresh token',
    refreshed.status === 200 && !!refreshed.json.access_token && refreshed.json.access_token !== first.json.access_token && refreshed.json.refresh_token !== first.json.refresh_token,
    `status ${refreshed.status}`);
  const afterRefresh = await rpc(refreshed.json.access_token, { jsonrpc: '2.0', id: 4, method: 'tools/list' });
  check('the new access token works', afterRefresh.status === 200 && (afterRefresh.json?.result?.tools ?? []).length > 0);
  const concurrent = await token({ grant_type: 'refresh_token', refresh_token: first.json.refresh_token, client_id: client.client_id });
  check('a second refresh with the same token seconds later is not treated as theft', concurrent.status === 200 && !!concurrent.json.access_token, `status ${concurrent.status}`);
  const garbage = await token({ grant_type: 'refresh_token', refresh_token: 'slima_rt_not_a_real_token', client_id: client.client_id });
  check('an unknown refresh token answers invalid_grant', garbage.status === 400 && garbage.json.error === 'invalid_grant', `status ${garbage.status}`);
} catch (error) {
  check(`aborted: ${error.message}`, false);
} finally {
  try {
    ws?.close();
  } catch {
    /* already closed */
  }
  browser.kill('SIGKILL');
  clientServer.close();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
