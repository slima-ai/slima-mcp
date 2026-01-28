/**
 * Slima OAuth Handler
 *
 * Integrates workers-oauth-provider with Rails OAuth Provider.
 * Rails handles user authentication, this handler proxies authorization.
 *
 * Flow:
 * 1. MCP client connects to /mcp
 * 2. Worker returns 401 with WWW-Authenticate
 * 3. Client discovers OAuth endpoints via /.well-known/
 * 4. Client initiates OAuth flow
 * 5. This handler redirects to Rails for user authorization
 * 6. Rails callback returns to Worker
 * 7. Worker completes authorization and stores token
 */

import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';

export interface Env {
  SLIMA_API_URL: string;
  OAUTH_CLIENT_ID: string;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
}

/**
 * HTML escape to prevent XSS
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * Success page HTML
 */
function getSuccessHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connected - Slima</title>
  <link rel="icon" href="https://app.slima.ai/favicon.ico">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>tailwind.config = { theme: { extend: { colors: { 'slima-bg': '#FBFBFA' } } } }</script>
  <script>setTimeout(() => window.close(), 3000);</script>
</head>
<body class="bg-slima-bg min-h-screen grid place-items-center p-4 font-sans">
  <div class="w-full max-w-sm bg-white rounded-xl shadow-md overflow-hidden text-center">
    <div class="px-6 py-8">
      <img src="https://app.slima.ai/icons/slima-black.svg" alt="Slima" class="h-8 mx-auto mb-6" />
      <div class="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center bg-green-50">
        <svg class="w-6 h-6 text-green-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path>
        </svg>
      </div>
      <h1 class="text-lg font-semibold text-gray-900 mb-2">Connected to Slima</h1>
      <p class="text-sm text-gray-500">Slima MCP is now connected to your account.</p>
    </div>
    <div class="px-6 py-4 bg-gray-50 border-t border-gray-100">
      <p class="text-xs text-gray-400">This window will close automatically...</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Error page HTML
 */
function getErrorHtml(message: string): string {
  const safeMessage = escapeHtml(message);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Error - Slima</title>
  <link rel="icon" href="https://app.slima.ai/favicon.ico">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>tailwind.config = { theme: { extend: { colors: { 'slima-bg': '#FBFBFA' } } } }</script>
</head>
<body class="bg-slima-bg min-h-screen grid place-items-center p-4 font-sans">
  <div class="w-full max-w-sm bg-white rounded-xl shadow-md overflow-hidden text-center">
    <div class="px-6 py-8">
      <img src="https://app.slima.ai/icons/slima-black.svg" alt="Slima" class="h-8 mx-auto mb-6" />
      <div class="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center bg-red-50">
        <svg class="w-6 h-6 text-red-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
      </div>
      <h1 class="text-lg font-semibold text-gray-900 mb-2">Something went wrong</h1>
      <p class="text-sm text-gray-500">${safeMessage}</p>
    </div>
    <div class="px-6 py-4 bg-gray-50 border-t border-gray-100">
      <p class="text-xs text-gray-400">Please close this window and try again.</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * OAuth Handler for Slima
 *
 * This class handles the authorization flow by:
 * 1. Parsing incoming OAuth requests
 * 2. Redirecting to Rails for user authentication
 * 3. Handling Rails callback and completing authorization
 */
export default class SlimaOAuthHandler {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const oauthProvider = env.OAUTH_PROVIDER;

    // Handle Rails callback (after user authorizes in Rails)
    if (url.pathname === '/callback') {
      return this.handleCallback(request, env, oauthProvider);
    }

    // Handle authorization request - redirect to Rails
    if (url.pathname === '/authorize') {
      return this.handleAuthorize(request, env, oauthProvider);
    }

    // Health check / info endpoint
    if (url.pathname === '/') {
      return new Response(JSON.stringify({
        name: 'Slima MCP Server',
        version: '0.1.0',
        status: 'ok',
        endpoints: {
          mcp: '/mcp',
          docs: 'https://docs.slima.ai/mcp',
        },
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Not found
    return new Response('Not Found', { status: 404 });
  }

  /**
   * Handle /authorize - redirect to Rails
   */
  private async handleAuthorize(
    request: Request,
    env: Env,
    oauthProvider: OAuthHelpers
  ): Promise<Response> {
    // Parse the incoming OAuth request
    const oauthReqInfo = await oauthProvider.parseAuthRequest(request);

    if (!oauthReqInfo.clientId) {
      return new Response(getErrorHtml('Invalid client'), {
        status: 400,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Store the OAuth request info in KV for later retrieval
    const state = crypto.randomUUID();
    await env.OAUTH_KV.put(
      `oauth_request:${state}`,
      JSON.stringify({
        oauthReqInfo: {
          clientId: oauthReqInfo.clientId,
          redirectUri: oauthReqInfo.redirectUri,
          scope: oauthReqInfo.scope,
          state: oauthReqInfo.state,
          codeChallenge: oauthReqInfo.codeChallenge,
          codeChallengeMethod: oauthReqInfo.codeChallengeMethod,
        },
      }),
      { expirationTtl: 600 } // 10 minutes
    );

    // Build Rails authorize URL
    const railsAuthUrl = new URL(`${env.SLIMA_API_URL}/api/v1/oauth/authorize`);
    railsAuthUrl.searchParams.set('client_id', env.OAUTH_CLIENT_ID);
    railsAuthUrl.searchParams.set('redirect_uri', `${new URL(request.url).origin}/callback`);
    railsAuthUrl.searchParams.set('state', state);
    railsAuthUrl.searchParams.set('response_type', 'code');

    // Forward PKCE if present
    if (oauthReqInfo.codeChallenge) {
      railsAuthUrl.searchParams.set('code_challenge', oauthReqInfo.codeChallenge);
      railsAuthUrl.searchParams.set('code_challenge_method', oauthReqInfo.codeChallengeMethod || 'S256');
    }

    return Response.redirect(railsAuthUrl.toString(), 302);
  }

  /**
   * Handle /callback - process Rails callback and complete authorization
   */
  private async handleCallback(
    request: Request,
    env: Env,
    oauthProvider: OAuthHelpers
  ): Promise<Response> {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    // Handle error from Rails
    if (error) {
      return new Response(getErrorHtml(
        error === 'access_denied'
          ? 'You denied access to your Slima account.'
          : `Authorization failed: ${error}`
      ), {
        status: 400,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    if (!state || !code) {
      return new Response(getErrorHtml('Invalid callback parameters'), {
        status: 400,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Retrieve stored OAuth request info
    const storedData = await env.OAUTH_KV.get(`oauth_request:${state}`);
    if (!storedData) {
      return new Response(getErrorHtml('Session expired. Please try again.'), {
        status: 400,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    const { oauthReqInfo } = JSON.parse(storedData);
    await env.OAUTH_KV.delete(`oauth_request:${state}`);

    // Exchange code for token with Rails
    const tokenResponse = await fetch(`${env.SLIMA_API_URL}/api/v1/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: env.OAUTH_CLIENT_ID,
        redirect_uri: `${url.origin}/callback`,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({})) as { error_description?: string };
      return new Response(getErrorHtml(
        errorData.error_description || 'Failed to exchange authorization code.'
      ), {
        status: 400,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    const { access_token } = await tokenResponse.json() as { access_token: string };

    // Complete authorization using workers-oauth-provider
    // This will issue our own token to the MCP client
    const { redirectTo } = await oauthProvider.completeAuthorization({
      request: oauthReqInfo,
      userId: access_token.substring(0, 20), // Use part of token as user ID
      metadata: { createdAt: new Date().toISOString() },
      scope: oauthReqInfo.scope || [],
      props: {
        accessToken: access_token, // Store Rails token for API calls
      },
    });

    // Show success page and redirect
    return new Response(getSuccessHtml(), {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'Refresh': `0; url=${redirectTo}`,
      },
    });
  }
}
