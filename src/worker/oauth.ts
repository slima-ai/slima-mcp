/**
 * OAuth Client for Slima MCP Worker
 *
 * Implements OAuth 2.0 Authorization Code flow with PKCE
 * for secure authentication without client secrets.
 */

import { Hono, Context } from 'hono';
import { cors } from 'hono/cors';

export interface Env {
  SLIMA_API_URL: string;
  OAUTH_CLIENT_ID: string;
  OAUTH_KV: KVNamespace;
}

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

export function createOAuthRoutes(app: Hono<{ Bindings: Env }>) {
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

    const authUrl = new URL(`${c.env.SLIMA_API_URL}/api/v1/oauth/authorize`);
    authUrl.searchParams.set('client_id', c.env.OAUTH_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    return c.redirect(authUrl.toString());
  });

  // OAuth callback (with PKCE verification)
  app.get('/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    const error = c.req.query('error');

    if (error) {
      return c.html(pageTemplate({
        title: 'Authorization Denied',
        heading: 'Authorization Denied',
        message: error === 'access_denied'
          ? 'You denied access to your Slima account.'
          : String(error),
        isSuccess: false,
      }), 400);
    }

    // Validate state and get code_verifier
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
}

// Get token from session or Authorization header (middleware helper)
// Supports:
// 1. Bearer token (Claude.ai, ChatGPT style): Authorization: Bearer slima_xxx
// 2. Cookie session (browser style): slima_session=uuid
export async function getTokenFromSession(c: Context<{ Bindings: Env }>): Promise<string | null> {
  // First, check Authorization header (for MCP clients like Claude.ai)
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7); // Remove 'Bearer ' prefix
    // If it's a Slima API token, return it directly
    if (token.startsWith('slima_')) {
      return token;
    }
  }

  // Fall back to cookie session (for browser-based flows)
  const sessionId = c.req.header('Cookie')?.match(/slima_session=([^;]+)/)?.[1];
  if (!sessionId) return null;
  return await c.env.OAUTH_KV.get(`session:${sessionId}`);
}
