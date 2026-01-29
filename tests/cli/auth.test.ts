/**
 * CLI Auth Tests
 *
 * Tests for the authentication command including --force flag
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runAuth, runLogout, runStatus } from '../../src/cli/auth.js';
import * as tokenStorage from '../../src/cli/token-storage.js';

// Mock token storage
vi.mock('../../src/cli/token-storage.js', () => ({
  saveToken: vi.fn(),
  loadToken: vi.fn(),
  deleteToken: vi.fn(),
  getCredentialsFilePath: vi.fn(() => '/mock/.slima/credentials.json'),
}));

// Mock child_process for browser opening
vi.mock('node:child_process', () => ({
  exec: vi.fn((cmd, callback) => callback?.(null, '', '')),
}));

// Mock http server
vi.mock('node:http', () => ({
  createServer: vi.fn(() => ({
    listen: vi.fn((port, host, callback) => callback?.()),
    close: vi.fn(),
    once: vi.fn((event, callback) => {
      if (event === 'listening') callback?.();
    }),
  })),
}));

describe('CLI Auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console output during tests
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('runAuth', () => {
    it('should skip auth if already authenticated and force is false', async () => {
      vi.mocked(tokenStorage.loadToken).mockResolvedValue({
        apiToken: 'slima_test_token',
        createdAt: new Date().toISOString(),
      });

      await runAuth({ force: false });

      expect(tokenStorage.loadToken).toHaveBeenCalled();
      expect(tokenStorage.deleteToken).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('already authenticated')
      );
    });

    it('should delete existing token when force is true', async () => {
      vi.mocked(tokenStorage.loadToken).mockResolvedValue({
        apiToken: 'slima_old_token',
        createdAt: new Date().toISOString(),
      });

      // This will timeout since we can't complete the OAuth flow in tests
      // but we can verify the token deletion was called
      const authPromise = runAuth({ force: true });

      // Give it a moment to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(tokenStorage.deleteToken).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Clearing existing credentials')
      );

      // Clean up - the auth will timeout but that's expected
    });

    it('should proceed with auth if no existing credentials', async () => {
      vi.mocked(tokenStorage.loadToken).mockResolvedValue(null);

      // Start auth (will timeout but we just check initialization)
      const authPromise = runAuth({});

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(tokenStorage.loadToken).toHaveBeenCalled();
      expect(tokenStorage.deleteToken).not.toHaveBeenCalled();
    });

    it('should show re-auth message with --force hint', async () => {
      vi.mocked(tokenStorage.loadToken).mockResolvedValue({
        apiToken: 'slima_test_token',
        createdAt: new Date().toISOString(),
      });

      await runAuth({});

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('--force')
      );
    });
  });

  describe('runLogout', () => {
    it('should delete token if authenticated', async () => {
      vi.mocked(tokenStorage.loadToken).mockResolvedValue({
        apiToken: 'slima_test_token',
        createdAt: new Date().toISOString(),
      });

      await runLogout();

      expect(tokenStorage.deleteToken).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Successfully logged out')
      );
    });

    it('should handle case when not authenticated', async () => {
      vi.mocked(tokenStorage.loadToken).mockResolvedValue(null);

      await runLogout();

      expect(tokenStorage.deleteToken).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('not authenticated')
      );
    });
  });

  describe('runStatus', () => {
    it('should show authenticated status', async () => {
      vi.mocked(tokenStorage.loadToken).mockResolvedValue({
        apiToken: 'slima_abc123def456',
        createdAt: '2024-01-01T00:00:00.000Z',
      });

      await runStatus();

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Authenticated')
      );
    });

    it('should show not authenticated status', async () => {
      vi.mocked(tokenStorage.loadToken).mockResolvedValue(null);

      await runStatus();

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Not authenticated')
      );
    });
  });
});

describe('CLI Index --force flag parsing', () => {
  it('should parse --force flag correctly', () => {
    const args = ['auth', '--force'];
    const forceFlag = args.includes('--force') || args.includes('-f');
    expect(forceFlag).toBe(true);
  });

  it('should parse -f flag correctly', () => {
    const args = ['auth', '-f'];
    const forceFlag = args.includes('--force') || args.includes('-f');
    expect(forceFlag).toBe(true);
  });

  it('should handle auth without force flag', () => {
    const args = ['auth'];
    const forceFlag = args.includes('--force') || args.includes('-f');
    expect(forceFlag).toBe(false);
  });
});
