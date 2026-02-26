/**
 * OAuth Client for Slima MCP Worker
 *
 * Implements OAuth 2.0 Authorization Code flow with PKCE
 * for secure authentication without client secrets.
 *
 * The Worker acts as an OAuth Authorization Server proxy:
 * - Exposes standard OAuth endpoints at same domain (for AI client compatibility)
 * - Internally delegates authentication to Rails API
 * - Manages PKCE flow between client and Rails
 */

/// <reference types="@cloudflare/workers-types" />

import { Hono, Context } from 'hono';
import { cors } from 'hono/cors';
import type { OAuthRequestContext, AuthCodeData, OAuthError } from './types.js';

export interface Env {
  SLIMA_API_URL: string;
  OAUTH_CLIENT_ID: string;
  OAUTH_KV: KVNamespace;
}

/** Hono app type with Env bindings (used across oauth routes) */
export type OAuthApp = Hono<{ Bindings: Env }>;

// Simple logger for Worker environment
const logger = {
  debug: (message: string, ...args: unknown[]) => console.debug(`[OAuth] ${message}`, ...args),
  info: (message: string, ...args: unknown[]) => console.info(`[OAuth] ${message}`, ...args),
  warn: (message: string, ...args: unknown[]) => console.warn(`[OAuth] ${message}`, ...args),
  error: (message: string, error?: unknown) => console.error(`[OAuth] ${message}`, error),
};

// PKCE utility functions
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(hash));
}

function base64UrlEncode(buffer: Uint8Array): string {
  let binary = '';
  for (const byte of buffer) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Validate PKCE code_verifier against code_challenge
 * Uses S256 method: BASE64URL(SHA256(code_verifier)) == code_challenge
 */
async function validatePKCE(codeVerifier: string, codeChallenge: string): Promise<boolean> {
  if (!codeVerifier || !codeChallenge) {
    return false;
  }
  const expectedChallenge = await generateCodeChallenge(codeVerifier);
  return expectedChallenge === codeChallenge;
}

/**
 * Create OAuth error response (RFC 6749 format)
 */
function oauthErrorResponse(
  error: string,
  description: string,
  status: number = 400
): Response {
  const body: OAuthError = {
    error,
    error_description: description,
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// XSS prevention: escape HTML special characters
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Page template following UIUX_SPEC.md design
// Note: All dynamic content is escaped to prevent XSS
function pageTemplate(options: {
  title: string;
  heading: string;
  message: string;
  isSuccess: boolean;
  autoClose?: boolean;
}): string {
  // Escape all user-controllable content
  const safeTitle = escapeHtml(options.title);
  const safeHeading = escapeHtml(options.heading);
  const safeMessage = escapeHtml(options.message);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <title>${safeTitle} - Slima</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="icon" href="https://app.slima.ai/favicon.ico">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
          colors: { 'slima-bg': '#FBFBFA' }
        }
      }
    }
  </script>
  ${options.autoClose ? '<script>setTimeout(() => window.close(), 3000);</script>' : ''}
</head>
<body class="bg-slima-bg min-h-screen grid place-items-center p-4 font-sans">
  <div class="w-full max-w-sm bg-white rounded-xl shadow-md overflow-hidden text-center">
    <div class="px-6 py-8">
      <img src="https://app.slima.ai/icons/slima-black.svg" alt="Slima" class="h-8 mx-auto mb-6" />
      <div class="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center ${options.isSuccess ? 'bg-green-50' : 'bg-red-50'}">
        ${options.isSuccess
          ? '<svg class="w-6 h-6 text-green-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>'
          : '<svg class="w-6 h-6 text-red-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg>'
        }
      </div>
      <h1 class="text-lg font-semibold text-gray-900 mb-2">${safeHeading}</h1>
      <p class="text-sm text-gray-500">${safeMessage}</p>
    </div>
    <div class="px-6 py-4 bg-gray-50 border-t border-gray-100">
      <p class="text-xs text-gray-400">
        ${options.autoClose ? 'This window will close automatically...' : 'You can close this window.'}
      </p>
    </div>
  </div>
</body>
</html>`;
}

export function createOAuthRoutes(app: OAuthApp) {
  // CORS configuration for AI platforms
  app.use('/auth/*', cors({
    origin: ['https://claude.ai', 'https://chat.openai.com'],
    credentials: true,
  }));

  // Start OAuth flow with PKCE
  app.get('/auth/login', async (c) => {
    const state = crypto.randomUUID();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const redirectUri = `${new URL(c.req.url).origin}/callback`;

    // Store state and code_verifier (required for PKCE)
    await c.env.OAUTH_KV.put(
      `oauth:${state}`,
      JSON.stringify({ codeVerifier, redirectUri }),
      { expirationTtl: 600 } // 10 minutes
    );

    // Check if force re-login is requested
    const forceLogin = c.req.query('prompt') === 'login';

    const authUrl = new URL(`${c.env.SLIMA_API_URL}/api/v1/oauth/authorize`);
    authUrl.searchParams.set('client_id', c.env.OAUTH_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    if (forceLogin) {
      authUrl.searchParams.set('prompt', 'login');
    }

    return c.redirect(authUrl.toString());
  });

  /**
   * OAuth callback handler
   *
   * Handles two different flows:
   * 1. /auth/login flow (browser-based): Sets cookie and shows success page
   * 2. /authorize flow (AI client): Returns authorization code to client redirect_uri
   *
   * The flow is determined by which KV key exists:
   * - oauth:{state} = /auth/login flow
   * - oauth_req:{state} = /authorize flow (AI client)
   */
  app.get('/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    const error = c.req.query('error');
    const errorDescription = c.req.query('error_description');

    // Handle OAuth errors
    if (error) {
      // Check if this is an AI client flow
      const oauthReqData = await c.env.OAUTH_KV.get(`oauth_req:${state}`);
      if (oauthReqData) {
        // AI client flow - redirect back with error
        const oauthReq: OAuthRequestContext = JSON.parse(oauthReqData);
        await c.env.OAUTH_KV.delete(`oauth_req:${state}`);

        const callbackUrl = new URL(oauthReq.redirectUri);
        callbackUrl.searchParams.set('error', error);
        if (errorDescription) {
          callbackUrl.searchParams.set('error_description', errorDescription);
        }
        callbackUrl.searchParams.set('state', oauthReq.originalState);
        return c.redirect(callbackUrl.toString());
      }

      // Browser flow - show error page
      return c.html(pageTemplate({
        title: 'Authorization Denied',
        heading: 'Authorization Denied',
        message: error === 'access_denied'
          ? 'You denied access to your Slima account.'
          : String(errorDescription || error),
        isSuccess: false,
      }), 400);
    }

    // Check which flow this is
    const oauthReqData = await c.env.OAUTH_KV.get(`oauth_req:${state}`);

    if (oauthReqData) {
      // ================================================================
      // AI Client Flow (/authorize -> /callback)
      // Exchange code, generate Worker auth code, redirect to client
      // ================================================================
      const oauthReq: OAuthRequestContext = JSON.parse(oauthReqData);
      await c.env.OAUTH_KV.delete(`oauth_req:${state}`);

      logger.info('AI client callback', {
        clientId: oauthReq.clientId,
        redirectUri: oauthReq.redirectUri,
        hasCodeChallenge: !!oauthReq.codeChallenge,
      });

      // Exchange code with Rails
      const baseUrl = new URL(c.req.url).origin;
      const tokenResponse = await fetch(`${c.env.SLIMA_API_URL}/api/v1/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          client_id: c.env.OAUTH_CLIENT_ID,
          redirect_uri: `${baseUrl}/callback`,
          code_verifier: oauthReq.internalVerifier,
        }),
      });

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json().catch(() => ({})) as { error?: string; error_description?: string };
        logger.error('Token exchange failed', errorData);

        const callbackUrl = new URL(oauthReq.redirectUri);
        callbackUrl.searchParams.set('error', errorData.error || 'server_error');
        callbackUrl.searchParams.set('error_description', errorData.error_description || 'Token exchange failed');
        callbackUrl.searchParams.set('state', oauthReq.originalState);
        return c.redirect(callbackUrl.toString());
      }

      const { access_token, expires_in } = await tokenResponse.json() as {
        access_token: string;
        expires_in: number;
      };

      // Generate Worker authorization code
      const workerCode = crypto.randomUUID();
      const authCodeData: AuthCodeData = {
        accessToken: access_token,
        clientId: oauthReq.clientId,
        redirectUri: oauthReq.redirectUri,
        codeChallenge: oauthReq.codeChallenge,
        codeChallengeMethod: oauthReq.codeChallengeMethod,
        resource: oauthReq.resource, // RFC 8707
        expiresIn: expires_in,
        createdAt: Date.now(),
      };

      await c.env.OAUTH_KV.put(
        `auth_code:${workerCode}`,
        JSON.stringify(authCodeData),
        { expirationTtl: 600 } // 10 minutes
      );

      logger.info('Authorization code issued', { code: workerCode.slice(0, 8) });

      // Redirect back to client with authorization code
      const callbackUrl = new URL(oauthReq.redirectUri);
      callbackUrl.searchParams.set('code', workerCode);
      callbackUrl.searchParams.set('state', oauthReq.originalState);

      return c.redirect(callbackUrl.toString());
    }

    // ================================================================
    // Browser Flow (/auth/login -> /callback)
    // Exchange code, set session cookie, show success page
    // ================================================================
    const storedData = await c.env.OAUTH_KV.get(`oauth:${state}`);
    if (!storedData) {
      return c.html(pageTemplate({
        title: 'Invalid Request',
        heading: 'Session Expired',
        message: 'The authorization session has expired. Please try again.',
        isSuccess: false,
      }), 400);
    }

    const { codeVerifier, redirectUri } = JSON.parse(storedData);
    await c.env.OAUTH_KV.delete(`oauth:${state}`);

    // Exchange code for token (with PKCE code_verifier)
    const tokenResponse = await fetch(`${c.env.SLIMA_API_URL}/api/v1/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: c.env.OAUTH_CLIENT_ID,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({})) as { error_description?: string };
      return c.html(pageTemplate({
        title: 'Authorization Failed',
        heading: 'Something went wrong',
        message: errorData.error_description || 'Failed to complete authorization. Please try again.',
        isSuccess: false,
      }), 400);
    }

    const { access_token, expires_in } = await tokenResponse.json() as {
      access_token: string;
      expires_in: number;
    };

    // Generate session ID and store token
    const sessionId = crypto.randomUUID();
    await c.env.OAUTH_KV.put(`session:${sessionId}`, access_token, {
      expirationTtl: expires_in,
    });

    // Set cookie via header (with HttpOnly for security) and show success page
    const cookieValue = `slima_session=${sessionId}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${expires_in}`;

    return new Response(
      pageTemplate({
        title: 'Connected',
        heading: 'Connected to Slima',
        message: 'Slima MCP is now connected to your account.',
        isSuccess: true,
        autoClose: true,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Set-Cookie': cookieValue,
        },
      }
    );
  });

  // Logout
  app.post('/auth/logout', async (c) => {
    const sessionId = c.req.header('Cookie')?.match(/slima_session=([^;]+)/)?.[1];
    if (sessionId) {
      await c.env.OAUTH_KV.delete(`session:${sessionId}`);
    }
    return c.json({ success: true });
  });

  // Check auth status
  app.get('/auth/status', async (c) => {
    const token = await getTokenFromSession(c);
    return c.json({
      authenticated: !!token,
    });
  });

  // ============================================================================
  // OAuth 2.0 Authorization Server Proxy Endpoints
  // These endpoints allow the Worker to act as an OAuth AS, while delegating
  // actual authentication to the Rails API. This is required because AI clients
  // (Claude.ai, ChatGPT) require all OAuth endpoints on the same domain.
  // ============================================================================

  // CORS for OAuth proxy endpoints
  app.use('/authorize', cors({ origin: '*' }));
  app.use('/token', cors({ origin: '*' }));
  app.use('/register', cors({ origin: '*' }));

  /**
   * GET /authorize - OAuth 2.0 Authorization Endpoint (RFC 6749)
   *
   * AI clients redirect users here to start the OAuth flow.
   * We store the client's OAuth context, generate internal PKCE credentials,
   * and redirect to Rails for actual authentication.
   */
  app.get('/authorize', async (c) => {
    const clientId = c.req.query('client_id');
    const redirectUri = c.req.query('redirect_uri');
    const responseType = c.req.query('response_type');
    const state = c.req.query('state');
    const codeChallenge = c.req.query('code_challenge');
    const codeChallengeMethod = c.req.query('code_challenge_method') || 'S256';
    const scope = c.req.query('scope') || 'read write';
    const resource = c.req.query('resource'); // RFC 8707 Resource Indicator
    const prompt = c.req.query('prompt'); // OAuth 2.0 prompt parameter (login, consent, none)

    logger.info('Authorization request', {
      clientId,
      redirectUri,
      state: state?.slice(0, 8),
      resource,
      prompt,
      responseType,
      codeChallengeMethod,
      hasCodeChallenge: !!codeChallenge,
      scope,
    });

    // Validate required parameters
    if (!clientId) {
      return oauthErrorResponse('invalid_request', 'Missing client_id parameter');
    }
    if (!redirectUri) {
      return oauthErrorResponse('invalid_request', 'Missing redirect_uri parameter');
    }
    if (responseType !== 'code') {
      return oauthErrorResponse('unsupported_response_type', 'Only response_type=code is supported');
    }
    if (!state) {
      return oauthErrorResponse('invalid_request', 'Missing state parameter');
    }
    if (!codeChallenge) {
      return oauthErrorResponse('invalid_request', 'Missing code_challenge parameter (PKCE required)');
    }
    if (codeChallengeMethod !== 'S256') {
      return oauthErrorResponse('invalid_request', 'Only S256 code_challenge_method is supported');
    }

    // Generate internal state and PKCE for Rails OAuth
    const internalState = crypto.randomUUID();
    const internalVerifier = generateCodeVerifier();
    const internalChallenge = await generateCodeChallenge(internalVerifier);
    const baseUrl = new URL(c.req.url).origin;

    // Store OAuth request context
    const oauthContext: OAuthRequestContext = {
      clientId,
      redirectUri,
      originalState: state,
      codeChallenge,
      codeChallengeMethod,
      scope,
      resource, // RFC 8707
      internalVerifier,
      createdAt: Date.now(),
    };

    await c.env.OAUTH_KV.put(
      `oauth_req:${internalState}`,
      JSON.stringify(oauthContext),
      { expirationTtl: 600 } // 10 minutes
    );

    logger.debug('Stored OAuth context', { internalState: internalState.slice(0, 8) });

    // Redirect to Rails authorize endpoint
    const railsAuthUrl = new URL(`${c.env.SLIMA_API_URL}/api/v1/oauth/authorize`);
    railsAuthUrl.searchParams.set('client_id', c.env.OAUTH_CLIENT_ID);
    railsAuthUrl.searchParams.set('redirect_uri', `${baseUrl}/callback`);
    railsAuthUrl.searchParams.set('response_type', 'code');
    railsAuthUrl.searchParams.set('state', internalState);
    railsAuthUrl.searchParams.set('code_challenge', internalChallenge);
    railsAuthUrl.searchParams.set('code_challenge_method', 'S256');
    // Pass prompt parameter to force re-login if requested
    if (prompt) {
      railsAuthUrl.searchParams.set('prompt', prompt);
    }

    return c.redirect(railsAuthUrl.toString());
  });

  /**
   * POST /token - OAuth 2.0 Token Endpoint (RFC 6749)
   *
   * AI clients exchange the authorization code for an access token.
   * We validate PKCE and return the stored Rails token.
   */
  app.post('/token', async (c) => {
    // Parse body (support both form-urlencoded and JSON)
    let body: Record<string, string>;
    const contentType = c.req.header('Content-Type') || '';

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await c.req.parseBody();
      body = Object.fromEntries(
        Object.entries(formData).map(([k, v]) => [k, String(v)])
      );
    } else if (contentType.includes('application/json')) {
      body = await c.req.json();
    } else {
      // Default to form parsing for compatibility
      const formData = await c.req.parseBody();
      body = Object.fromEntries(
        Object.entries(formData).map(([k, v]) => [k, String(v)])
      );
    }

    const grantType = body.grant_type;
    const code = body.code;
    const codeVerifier = body.code_verifier;
    const clientId = body.client_id;
    const redirectUri = body.redirect_uri;

    logger.info('Token request', { grantType, clientId, hasCode: !!code, hasVerifier: !!codeVerifier, redirectUri });

    // Validate grant_type
    if (grantType !== 'authorization_code') {
      return oauthErrorResponse('unsupported_grant_type', 'Only authorization_code grant is supported');
    }

    // Validate required parameters
    if (!code) {
      return oauthErrorResponse('invalid_request', 'Missing code parameter');
    }
    if (!codeVerifier) {
      return oauthErrorResponse('invalid_request', 'Missing code_verifier parameter');
    }

    // Get auth code data from KV
    const stored = await c.env.OAUTH_KV.get(`auth_code:${code}`);
    if (!stored) {
      logger.warn('Invalid or expired auth code', { code: code.slice(0, 8) });
      return oauthErrorResponse('invalid_grant', 'Invalid or expired authorization code');
    }

    const authData: AuthCodeData = JSON.parse(stored);

    // Delete the code immediately (one-time use)
    await c.env.OAUTH_KV.delete(`auth_code:${code}`);

    // Validate client_id
    if (clientId && authData.clientId !== clientId) {
      logger.warn('Client ID mismatch', { expected: authData.clientId, got: clientId });
      return oauthErrorResponse('invalid_client', 'Client ID mismatch');
    }

    // Validate redirect_uri
    if (redirectUri && authData.redirectUri !== redirectUri) {
      logger.warn('Redirect URI mismatch');
      return oauthErrorResponse('invalid_grant', 'Redirect URI mismatch');
    }

    // Validate PKCE
    const pkceValid = await validatePKCE(codeVerifier, authData.codeChallenge);
    if (!pkceValid) {
      logger.warn('PKCE verification failed');
      return oauthErrorResponse('invalid_grant', 'PKCE verification failed');
    }

    logger.info('Token issued successfully', {
      tokenPrefix: authData.accessToken?.slice(0, 10),
      expiresIn: authData.expiresIn,
      hasResource: !!authData.resource,
    });

    // Return the Rails token (RFC 8707: include resource if provided)
    const tokenResponse: Record<string, unknown> = {
      access_token: authData.accessToken,
      token_type: 'Bearer',
      expires_in: authData.expiresIn || 2592000, // 30 days default
      scope: 'read write',
    };

    // RFC 8707: Echo back the resource indicator if it was provided
    if (authData.resource) {
      tokenResponse.resource = authData.resource;
    }

    return c.json(tokenResponse);
  });

  /**
   * POST /register - Dynamic Client Registration (RFC 7591)
   *
   * AI clients register themselves to get client credentials.
   * We proxy this to the Rails DCR endpoint.
   */
  app.post('/register', async (c) => {
    try {
      const body = await c.req.json();
      logger.info('DCR registration request', {
        clientName: body.client_name,
        redirectUris: body.redirect_uris,
        grantTypes: body.grant_types,
        responseTypes: body.response_types,
        tokenEndpointAuthMethod: body.token_endpoint_auth_method,
      });

      // Proxy to Rails DCR endpoint
      const response = await fetch(`${c.env.SLIMA_API_URL}/api/v1/oauth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        logger.warn('DCR registration failed', { status: response.status, data });
      } else {
        logger.info('DCR registration successful', { clientId: (data as { client_id?: string }).client_id });
      }

      return c.json(data, response.status as 200 | 201 | 400);
    } catch (error) {
      logger.error('DCR registration error', error);
      return oauthErrorResponse('server_error', 'Failed to register client', 500);
    }
  });
}

// Get token from session or Authorization header (middleware helper)
// Supports:
// 1. Bearer token (Claude.ai, ChatGPT style): Authorization: Bearer <token>
//    - Slima API tokens (slima_xxx) are used directly
//    - OAuth access tokens are looked up in KV to get the actual API token
// 2. Cookie session (browser style): slima_session=uuid
export async function getTokenFromSession(c: Context<{ Bindings: Env }>): Promise<string | null> {
  // First, check Authorization header (for MCP clients like Claude.ai)
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      // Slima API tokens can be used directly
      if (token.startsWith('slima_')) {
        return token;
      }
      // OAuth access tokens: the token IS the Rails API token
      // (returned by our /token endpoint after OAuth flow)
      // Let Rails API validate it - don't filter by prefix here
      logger.debug('Bearer token received (non-slima_ prefix)', { tokenPrefix: token.slice(0, 8) });
      return token;
    }
  }

  // Fall back to cookie session (for browser-based flows)
  const sessionId = c.req.header('Cookie')?.match(/slima_session=([^;]+)/)?.[1];
  if (!sessionId) return null;
  return await c.env.OAUTH_KV.get(`session:${sessionId}`);
}
