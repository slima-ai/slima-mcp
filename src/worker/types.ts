/**
 * Cloudflare Worker Environment Types
 */

// Re-export Env from oauth.ts for consistency
export type { Env } from './oauth.js';

/**
 * OAuth Request Context
 * Stored in KV during the authorization flow (TTL: 600s)
 * Key format: oauth_req:{internalState}
 */
export interface OAuthRequestContext {
  /** Original client_id from the AI client */
  clientId: string;
  /** Original redirect_uri from the AI client */
  redirectUri: string;
  /** Original state from the AI client (passed back unchanged) */
  originalState: string;
  /** PKCE code_challenge from the AI client */
  codeChallenge: string;
  /** PKCE code_challenge_method (always S256) */
  codeChallengeMethod: string;
  /** Requested scopes */
  scope: string;
  /** RFC 8707 Resource Indicator (optional) */
  resource?: string;
  /** Internal PKCE code_verifier for Rails OAuth */
  internalVerifier: string;
  /** Timestamp when the request was created */
  createdAt: number;
}

/**
 * Authorization Code Data
 * Stored in KV after successful Rails callback (TTL: 600s)
 * Key format: auth_code:{workerCode}
 */
export interface AuthCodeData {
  /** Rails access token (may be slima_xxx format or OAuth token) */
  accessToken: string;
  /** Rails refresh token (if provided) */
  refreshToken?: string;
  /** Client ID for validation */
  clientId: string;
  /** Redirect URI for validation */
  redirectUri: string;
  /** PKCE code_challenge for verification */
  codeChallenge: string;
  /** PKCE code_challenge_method */
  codeChallengeMethod: string;
  /** RFC 8707 Resource Indicator (optional) */
  resource?: string;
  /** Token expiration in seconds */
  expiresIn: number;
  /** Timestamp when the code was created */
  createdAt: number;
}

/**
 * OAuth Error Response (RFC 6749)
 */
export interface OAuthError {
  error: string;
  error_description?: string;
  error_uri?: string;
}
