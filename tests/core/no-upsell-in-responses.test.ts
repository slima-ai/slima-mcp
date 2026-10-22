/**
 * Nothing the MCP layer says to the model may sell: no "upgrade", no "subscribe",
 * no "top up", no pricing or checkout link. When a limit is hit, the message states
 * the fact (what ran out, what to do next inside the same plan) and stops.
 *
 * Why it is a rule: connector directories review the text a server returns, and a
 * tool result that steers an AI toward a purchase is a rejection reason for them
 * (Anthropic's review criteria forbid tool text that promotes products or services
 * unrelated to the tool's function). It is also the right behaviour: the model
 * relays what it reads to the author, and an upsell relayed by an assistant is an ad.
 *
 * This file covers the text this package owns: error messages and the tool catalogue
 * the model reads. Text that Rails sends back and this package passes through is
 * outside what a unit test here can see; the Rails side is tracked separately.
 */

import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSlimaServer } from '../../src/cli/server.js';
import {
  AuthenticationError,
  InsufficientCreditsError,
  NotFoundError,
  RateLimitedError,
  RequestTimeoutError,
  SlimaApiError,
  formatErrorForMcp,
} from '../../src/core/utils/errors.js';

const SELLING = /upgrad|subscri|top[\s-]?up|buy\b|purchas|pricing|checkout|billing|\bpay(ment)?\b|\bplan\b.*\b(pro|team|starter)\b/i;
const SELLING_URL = /https?:\/\/\S*(plans|pricing|billing|checkout|subscribe|upgrade)/i;

describe('error messages the model reads', () => {
  const errors: Array<[string, unknown]> = [
    ['insufficient credits', new InsufficientCreditsError()],
    ['unauthorised', new AuthenticationError()],
    ['not found', new NotFoundError()],
    ['rate limited', new RateLimitedError(30)],
    ['timeout', new RequestTimeoutError(30000)],
    ['token expired', new SlimaApiError(401, 'TOKEN_EXPIRED', 'x')],
    ['token revoked', new SlimaApiError(401, 'TOKEN_REVOKED', 'x')],
    ['unknown', new Error('boom')],
  ];

  for (const [name, error] of errors) {
    it(`${name}: no selling words, no pricing links`, () => {
      const text = formatErrorForMcp(error);
      expect(text).not.toMatch(SELLING);
      expect(text).not.toMatch(SELLING_URL);
    });
  }

  it('says only what happened when credits run out', () => {
    const text = formatErrorForMcp(new InsufficientCreditsError());

    expect(text).toMatch(/insufficient credits/i);
    expect(text.length).toBeLessThan(120);
  });

  it('does not repeat Rails\' own wording for a 402 (the status alone decides the message)', () => {
    // Rails words its 402s for people in the app, and some of them offer a purchase.
    // InsufficientCreditsError is built without the server text on purpose.
    const error = new InsufficientCreditsError();

    expect(error.message).not.toMatch(SELLING);
  });
});

describe('tool catalogue the model reads', () => {
  it('has no selling words or pricing links in any title or description', async () => {
    const server = createSlimaServer({ apiToken: 'test_token', baseUrl: 'http://127.0.0.1:1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'upsell-guard', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const { tools } = await client.listTools();
    await client.close();

    expect(tools.length).toBeGreaterThanOrEqual(39);
    for (const tool of tools) {
      const text = `${tool.title}\n${tool.description}`;
      expect(text, `${tool.name} text`).not.toMatch(SELLING);
      expect(text, `${tool.name} link`).not.toMatch(SELLING_URL);
    }
  });
});
