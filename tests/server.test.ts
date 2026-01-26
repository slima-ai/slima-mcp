/**
 * Server Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSlimaServer } from '../src/server.js';

// Mock the tool registration functions
vi.mock('../src/tools/books.js', () => ({
  registerBookTools: vi.fn(),
}));
vi.mock('../src/tools/content.js', () => ({
  registerContentTools: vi.fn(),
}));
vi.mock('../src/tools/beta-reader.js', () => ({
  registerBetaReaderTools: vi.fn(),
}));

import { registerBookTools } from '../src/tools/books.js';
import { registerContentTools } from '../src/tools/content.js';
import { registerBetaReaderTools } from '../src/tools/beta-reader.js';

describe('createSlimaServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create an MCP server instance', () => {
    const server = createSlimaServer({
      apiToken: 'test_token',
    });

    expect(server).toBeDefined();
    expect(server).toHaveProperty('tool');
    expect(server).toHaveProperty('connect');
  });

  it('should register all tool groups', () => {
    createSlimaServer({
      apiToken: 'test_token',
    });

    expect(registerBookTools).toHaveBeenCalledTimes(1);
    expect(registerContentTools).toHaveBeenCalledTimes(1);
    expect(registerBetaReaderTools).toHaveBeenCalledTimes(1);
  });

  it('should pass API client to all tool registrations', () => {
    createSlimaServer({
      apiToken: 'my_api_token',
      baseUrl: 'https://custom.api.com',
    });

    // Verify all registrations received the server and client
    expect(registerBookTools).toHaveBeenCalledWith(
      expect.anything(), // server
      expect.objectContaining({}) // client (instance check)
    );
    expect(registerContentTools).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({})
    );
    expect(registerBetaReaderTools).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({})
    );
  });

  it('should use default API URL when not provided', () => {
    const server = createSlimaServer({
      apiToken: 'test_token',
    });

    // Server should be created successfully with default URL
    expect(server).toBeDefined();
  });

  it('should accept custom API URL', () => {
    const server = createSlimaServer({
      apiToken: 'test_token',
      baseUrl: 'http://localhost:3000',
    });

    expect(server).toBeDefined();
  });
});
