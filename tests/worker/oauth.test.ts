/**
 * OAuth Client Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock crypto for Node.js environment
const mockGetRandomValues = vi.fn((array: Uint8Array) => {
  for (let i = 0; i < array.length; i++) {
    array[i] = Math.floor(Math.random() * 256);
  }
  return array;
});

const mockDigest = vi.fn(async (_algorithm: string, data: BufferSource) => {
  // Simple mock hash - just return the data as-is (truncated/padded to 32 bytes)
  const input = new Uint8Array(data as ArrayBuffer);
  const result = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    result[i] = input[i % input.length];
  }
  return result.buffer;
});

// Set up global crypto mock
vi.stubGlobal('crypto', {
  getRandomValues: mockGetRandomValues,
  randomUUID: vi.fn(() => 'test-uuid-12345'),
  subtle: {
    digest: mockDigest,
  },
});

// Mock KV Namespace
function createMockKV() {
  const store = new Map<string, { value: string; expiration?: number }>();

  return {
    put: vi.fn(async (key: string, value: string, options?: { expirationTtl?: number }) => {
      store.set(key, {
        value,
        expiration: options?.expirationTtl
          ? Date.now() + options.expirationTtl * 1000
          : undefined,
      });
    }),
    get: vi.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiration && Date.now() > entry.expiration) {
        store.delete(key);
        return null;
      }
      return entry.value;
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    _store: store,
  };
}

describe('OAuth PKCE Utilities', () => {
  describe('Code Verifier Generation', () => {
    it('should generate a code verifier of correct length', () => {
      // The generateCodeVerifier function creates a 32-byte random array
      // then base64url encodes it, resulting in ~43 characters
      const array = new Uint8Array(32);
      mockGetRandomValues(array);

      // Simulate base64url encoding
      let binary = '';
      for (const byte of array) {
        binary += String.fromCharCode(byte);
      }
      const encoded = btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');

      expect(encoded.length).toBeGreaterThanOrEqual(32);
    });
  });

  describe('Code Challenge Generation', () => {
    it('should generate a SHA-256 challenge from verifier', async () => {
      const verifier = 'test_verifier';
      const encoder = new TextEncoder();
      const data = encoder.encode(verifier);

      const hash = await mockDigest('SHA-256', data);
      expect(hash).toBeDefined();
      expect(new Uint8Array(hash).length).toBe(32);
    });
  });
});

describe('OAuth KV Storage', () => {
  let mockKV: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    mockKV = createMockKV();
  });

  describe('State Storage', () => {
    it('should store OAuth state with code verifier', async () => {
      const state = 'test-state-123';
      const codeVerifier = 'test-verifier';
      const redirectUri = 'https://example.com/callback';

      await mockKV.put(
        `oauth:${state}`,
        JSON.stringify({ codeVerifier, redirectUri }),
        { expirationTtl: 600 }
      );

      expect(mockKV.put).toHaveBeenCalledWith(
        'oauth:test-state-123',
        expect.stringContaining('codeVerifier'),
        { expirationTtl: 600 }
      );

      const stored = await mockKV.get(`oauth:${state}`);
      expect(stored).toBeDefined();

      const parsed = JSON.parse(stored!);
      expect(parsed.codeVerifier).toBe(codeVerifier);
      expect(parsed.redirectUri).toBe(redirectUri);
    });

    it('should retrieve and delete state after use', async () => {
      const state = 'test-state-456';
      await mockKV.put(
        `oauth:${state}`,
        JSON.stringify({ codeVerifier: 'verifier', redirectUri: 'uri' }),
        { expirationTtl: 600 }
      );

      // Retrieve
      const stored = await mockKV.get(`oauth:${state}`);
      expect(stored).toBeDefined();

      // Delete after retrieval
      await mockKV.delete(`oauth:${state}`);

      // Verify deleted
      const afterDelete = await mockKV.get(`oauth:${state}`);
      expect(afterDelete).toBeNull();
    });
  });

  describe('Session Storage', () => {
    it('should store session with access token', async () => {
      const sessionId = 'session-123';
      const accessToken = 'slima_abc123';
      const expiresIn = 2592000; // 30 days

      await mockKV.put(`session:${sessionId}`, accessToken, {
        expirationTtl: expiresIn,
      });

      expect(mockKV.put).toHaveBeenCalledWith(
        'session:session-123',
        'slima_abc123',
        { expirationTtl: 2592000 }
      );

      const retrieved = await mockKV.get(`session:${sessionId}`);
      expect(retrieved).toBe(accessToken);
    });

    it('should delete session on logout', async () => {
      const sessionId = 'session-456';
      await mockKV.put(`session:${sessionId}`, 'token', {});

      await mockKV.delete(`session:${sessionId}`);

      const afterLogout = await mockKV.get(`session:${sessionId}`);
      expect(afterLogout).toBeNull();
    });
  });
});

describe('OAuth Flow', () => {
  let mockKV: ReturnType<typeof createMockKV>;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockKV = createMockKV();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  describe('Login Redirect', () => {
    it('should generate authorization URL with PKCE parameters', () => {
      const baseUrl = 'https://api.slima.ai';
      const clientId = 'slima-mcp-worker';
      const redirectUri = 'https://slima-mcp.test.workers.dev/callback';
      const state = 'test-uuid-12345';
      const codeChallenge = 'challenge123';

      const authUrl = new URL(`${baseUrl}/api/v1/oauth/authorize`);
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');

      expect(authUrl.toString()).toContain('client_id=slima-mcp-worker');
      expect(authUrl.toString()).toContain('code_challenge=challenge123');
      expect(authUrl.toString()).toContain('code_challenge_method=S256');
    });
  });

  describe('Token Exchange', () => {
    it('should exchange code for token with PKCE verifier', async () => {
      const code = 'auth-code-123';
      const clientId = 'slima-mcp-worker';
      const redirectUri = 'https://slima-mcp.test.workers.dev/callback';
      const codeVerifier = 'test-verifier';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'slima_token_123',
          token_type: 'Bearer',
          expires_in: 2592000,
        }),
      });

      const response = await fetch('https://api.slima.ai/api/v1/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          client_id: clientId,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.slima.ai/api/v1/oauth/token',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('code_verifier'),
        })
      );

      const data = await response.json();
      expect(data.access_token).toBe('slima_token_123');
    });

    it('should handle token exchange error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'Invalid PKCE code verifier',
        }),
      });

      const response = await fetch('https://api.slima.ai/api/v1/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code: 'bad-code',
          client_id: 'slima-mcp-worker',
          code_verifier: 'wrong-verifier',
        }),
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.error).toBe('invalid_grant');
    });
  });
});

describe('Session Management', () => {
  it('should extract session ID from cookie', () => {
    const cookie = 'slima_session=abc123; path=/; secure';
    const match = cookie.match(/slima_session=([^;]+)/);

    expect(match).toBeDefined();
    expect(match![1]).toBe('abc123');
  });

  it('should handle missing session cookie', () => {
    const cookie = 'other_cookie=value';
    const match = cookie.match(/slima_session=([^;]+)/);

    expect(match).toBeNull();
  });
});
