/**
 * MCP Protocol-Level Integration Test
 *
 * Unlike the other "integration" specs in this repo, this one actually:
 *   1. boots a real McpServer with every tool + resource registered
 *   2. boots a real MCP Client over the SDK's InMemoryTransport
 *   3. stands up a tiny local HTTP server that plays the role of Rails —
 *      responding with real HTTP status codes + headers, including the
 *      `X-Slima-MCP-Upgrade-Hint` and `error.code=INVALID_PATH` shapes
 *      that Rails' Mcp::FilesController actually emits.
 *
 * What this proves that the unit tests do NOT:
 *   - `initialize` handshake surfaces the server-level `instructions`
 *   - `tools/list` includes our Script Studio language in descriptions
 *   - `resources/templates/list` advertises `slima://books/{book_token}/schema`
 *   - `resources/read` resolves the template → Rails → structured JSON
 *   - `tools/call create_file` on a blocked path returns `isError: true`
 *     with the Rails error message passed through
 *   - `tools/call create_file` on an allowed path succeeds
 *   - `tools/call analyze_chapter` on a script book short-circuits locally
 *     without ever hitting Rails
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'http';
import { AddressInfo } from 'net';

import { SlimaApiClient } from '../../src/core/api/client.js';
import {
  registerBookTools,
  registerContentTools,
  registerBetaReaderTools,
  registerFileTools,
} from '../../src/core/tools/index.js';
import { registerBookSchemaResource } from '../../src/core/resources/index.js';
import { SERVER_INSTRUCTIONS } from '../../src/core/server-instructions.js';

// ---------- Fake Rails HTTP server ----------

type FakeBook = {
  token: string;
  title: string;
  bookType: 'book' | 'script';
  authorName?: string;
  totalWordCount?: number;
  createdAt: string;
  updatedAt: string;
};

type WriteCall = {
  method: string;
  path: string;
  body: unknown;
};

interface FakeRailsState {
  books: FakeBook[];
  writeCalls: WriteCall[];
  // Set to true to simulate an outdated MCP client: Rails will tack on the
  // X-Slima-MCP-Upgrade-Hint header on every response.
  stalenessHintActive: boolean;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => {
      if (chunks.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function startFakeRails(state: FakeRailsState): Promise<{ server: HttpServer; baseUrl: string }> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    // Mirror Rails: staleness hint on every response when enabled
    if (state.stalenessHintActive) {
      res.setHeader(
        'X-Slima-MCP-Upgrade-Hint',
        'slima-mcp 0.2.0 available; current: 0.1.5'
      );
    }

    const bookTokenMatch = path.match(/^\/api\/v1\/books\/([^/]+)(?:\/(.+))?$/);

    // GET /api/v1/books?status=active
    if (req.method === 'GET' && path === '/api/v1/books') {
      return respond(res, 200, { data: state.books });
    }

    // GET /api/v1/books/:token (no trailing segment)
    if (req.method === 'GET' && bookTokenMatch && !bookTokenMatch[2]) {
      const book = state.books.find((b) => b.token === bookTokenMatch[1]);
      if (!book) return respond(res, 404, { error: { code: 'NOT_FOUND', message: 'Book not found' } });
      return respond(res, 200, { data: book });
    }

    // POST /api/v1/books/:token/mcp/files/create
    if (
      req.method === 'POST' &&
      bookTokenMatch &&
      bookTokenMatch[2] === 'mcp/files/create'
    ) {
      const body = (await readBody(req)) as { path?: string; parent_path?: string };
      const bookToken = bookTokenMatch[1];
      const book = state.books.find((b) => b.token === bookToken);
      state.writeCalls.push({ method: 'create', path: body?.path ?? '', body });

      if (!book) {
        return respond(res, 404, { error: { code: 'NOT_FOUND', message: 'Book not found' } });
      }

      const effective =
        body?.parent_path && body?.path
          ? `${body.parent_path}/${body.path.split('/').pop()}`
          : body?.path ?? '';

      if (book.bookType === 'script' && !isAllowedScriptWrite(effective)) {
        return respond(res, 400, {
          error: {
            code: 'INVALID_PATH',
            message:
              'Script Studio is read-only except for .script_studio/planning/. ' +
              'Structured files (series.json, *.character, *.scene, *.storyline, *.note, *.location, ' +
              `season.json, episode.json) cannot be modified via MCP. Attempted path: ${effective}`,
          },
        });
      }

      return respond(res, 201, {
        data: {
          commit: { token: 'cmt_fake', name: 'test', message: 'test', createdAt: new Date().toISOString() },
          fileToken: 'fl_fake',
        },
      });
    }

    // GET /api/v1/books/:token/commits?limit=1 — minimal response
    if (req.method === 'GET' && bookTokenMatch && bookTokenMatch[2]?.startsWith('commits')) {
      return respond(res, 200, { data: { commits: [] } });
    }

    // fall-through — unhandled route (fail loudly so we notice in tests)
    respond(res, 501, { error: { code: 'NOT_IMPLEMENTED', message: `fake-rails: ${req.method} ${path}` } });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function respond(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function isAllowedScriptWrite(effectivePath: string): boolean {
  const PLANNING = '.script_studio/planning';
  if (effectivePath === `${PLANNING}/.initialized`) return false; // sentinel
  if (effectivePath === PLANNING) return true;
  return effectivePath.startsWith(`${PLANNING}/`);
}

// ---------- Harness: real MCP Server <-> real MCP Client ----------

async function setupHarness(baseUrl: string): Promise<{
  client: Client;
  server: McpServer;
  cleanup: () => Promise<void>;
}> {
  const apiClient = new SlimaApiClient({
    baseUrl,
    getToken: async () => 'slima_test_token',
  });

  const server = new McpServer(
    { name: 'slima', version: '0.2.0-test' },
    { instructions: SERVER_INSTRUCTIONS }
  );

  registerBookTools(server, apiClient);
  registerContentTools(server, apiClient);
  registerBetaReaderTools(server, apiClient);
  registerFileTools(server, apiClient);
  registerBookSchemaResource(server, apiClient);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: 'test-client', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } }
  );

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    server,
    cleanup: async () => {
      await Promise.all([clientTransport.close(), serverTransport.close()]);
    },
  };
}

// ---------- Tests ----------

describe('MCP Protocol E2E — Script Studio Studio awareness', () => {
  let fakeRails: { server: HttpServer; baseUrl: string };
  let state: FakeRailsState;

  beforeAll(async () => {
    state = {
      books: [
        {
          token: 'bk_script1',
          title: 'My Screenplay',
          bookType: 'script',
          authorName: 'Jane',
          totalWordCount: 1000,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          token: 'bk_writing1',
          title: 'My Novel',
          bookType: 'book',
          authorName: 'John',
          totalWordCount: 50000,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      writeCalls: [],
      stalenessHintActive: false,
    };
    fakeRails = await startFakeRails(state);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => fakeRails.server.close(() => resolve()));
  });

  beforeEach(() => {
    state.writeCalls = [];
    state.stalenessHintActive = false;
  });

  describe('initialize handshake', () => {
    it('surfaces server-level instructions explaining Writing/Script Studio', async () => {
      const { client, cleanup } = await setupHarness(fakeRails.baseUrl);
      try {
        const instructions = client.getInstructions?.();
        expect(instructions).toBeDefined();
        expect(instructions!).toMatch(/writing studio/i);
        expect(instructions!).toMatch(/script studio/i);
        expect(instructions!).toContain('.script_studio/planning');
      } finally {
        await cleanup();
      }
    });
  });

  describe('tools/list', () => {
    it('write tools advertise the Script Studio restriction in their descriptions', async () => {
      const { client, cleanup } = await setupHarness(fakeRails.baseUrl);
      try {
        const { tools } = await client.listTools();
        const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

        for (const name of ['create_file', 'write_file', 'edit_file', 'delete_file', 'append_to_file']) {
          const desc = byName[name]?.description ?? '';
          expect(desc, `${name} description`).toMatch(/script studio/i);
          expect(desc, `${name} description`).toContain('.script_studio/planning');
        }

        expect(byName['read_file']?.description ?? '').not.toMatch(/script studio/i);
      } finally {
        await cleanup();
      }
    });

    it('search_content exposes include_structured parameter', async () => {
      const { client, cleanup } = await setupHarness(fakeRails.baseUrl);
      try {
        const { tools } = await client.listTools();
        const searchTool = tools.find((t) => t.name === 'search_content');
        expect(searchTool).toBeDefined();
        const schema = searchTool!.inputSchema as { properties?: Record<string, unknown> };
        expect(schema.properties?.['include_structured']).toBeDefined();
      } finally {
        await cleanup();
      }
    });
  });

  describe('resources/templates/list + resources/read', () => {
    it('advertises slima://books/{book_token}/schema as a URI template', async () => {
      const { client, cleanup } = await setupHarness(fakeRails.baseUrl);
      try {
        const { resourceTemplates } = await client.listResourceTemplates();
        const template = resourceTemplates.find((t) => t.uriTemplate.startsWith('slima://books/'));
        expect(template).toBeDefined();
        expect(template!.uriTemplate).toBe('slima://books/{book_token}/schema');
        expect(template!.mimeType).toBe('application/json');
      } finally {
        await cleanup();
      }
    });

    it('resolves schema URI for a script book to the correct JSON', async () => {
      const { client, cleanup } = await setupHarness(fakeRails.baseUrl);
      try {
        const result = await client.readResource({ uri: 'slima://books/bk_script1/schema' });
        expect(result.contents).toHaveLength(1);
        const body = JSON.parse(result.contents[0].text as string);
        expect(body.book_type).toBe('script');
        expect(body.studio_label).toBe('Script Studio');
        expect(body.mcp_capabilities.writable_paths).toEqual(['.script_studio/planning/**/*']);
        expect(body.mcp_capabilities.readonly_paths).toContain('.script_studio/series.json');
      } finally {
        await cleanup();
      }
    });

    it('resolves schema URI for a writing book to "all writable"', async () => {
      const { client, cleanup } = await setupHarness(fakeRails.baseUrl);
      try {
        const result = await client.readResource({ uri: 'slima://books/bk_writing1/schema' });
        const body = JSON.parse(result.contents[0].text as string);
        expect(body.book_type).toBe('book');
        expect(body.mcp_capabilities.writable_paths).toEqual(['**/*']);
        expect(body.mcp_capabilities.readonly_paths).toEqual([]);
      } finally {
        await cleanup();
      }
    });
  });

  describe('tools/call — Rails allowlist is respected end-to-end', () => {
    it('create_file on .script_studio/series.json → Rails 400 → isError surfaces', async () => {
      const { client, cleanup } = await setupHarness(fakeRails.baseUrl);
      try {
        const result = await client.callTool({
          name: 'create_file',
          arguments: {
            book_token: 'bk_script1',
            path: '.script_studio/series.json',
            content: '{"title":"evil"}',
          },
        });

        expect(result.isError, JSON.stringify(result)).toBe(true);
        const text = (result.content as Array<{ text: string }>)[0].text;
        expect(text).toMatch(/script studio/i);
        expect(text).toContain('.script_studio/planning');
      } finally {
        await cleanup();
      }
    });

    it('create_file on .script_studio/planning/references/foo.md → Rails 201 → success', async () => {
      const { client, cleanup } = await setupHarness(fakeRails.baseUrl);
      try {
        const result = await client.callTool({
          name: 'create_file',
          arguments: {
            book_token: 'bk_script1',
            path: '.script_studio/planning/references/foo.md',
            content: '# notes',
          },
        });

        expect(result.isError ?? false, JSON.stringify(result)).toBe(false);
      } finally {
        await cleanup();
      }
    });

    it('create_file on Writing Studio is unaffected — any path is allowed', async () => {
      const { client, cleanup } = await setupHarness(fakeRails.baseUrl);
      try {
        const result = await client.callTool({
          name: 'create_file',
          arguments: { book_token: 'bk_writing1', path: 'chapter1.md', content: 'hi' },
        });
        expect(result.isError ?? false, JSON.stringify(result)).toBe(false);
      } finally {
        await cleanup();
      }
    });
  });

  describe('tools/call analyze_chapter — short-circuits for script books', () => {
    it('returns isError without ever calling Rails write endpoints', async () => {
      const { client, cleanup } = await setupHarness(fakeRails.baseUrl);
      try {
        const beforeWrites = state.writeCalls.length;

        const result = await client.callTool({
          name: 'analyze_chapter',
          arguments: {
            book_token: 'bk_script1',
            file_path: '.script_studio/seasons/s1/episodes/e1/scenes/scene01.scene',
            persona_token: 'psn_test',
          },
        });

        expect(result.isError).toBe(true);
        const text = (result.content as Array<{ text: string }>)[0].text;
        expect(text).toMatch(/script studio/i);
        expect(text).toMatch(/not available/i);

        expect(state.writeCalls.length).toBe(beforeWrites);
      } finally {
        await cleanup();
      }
    });
  });
});
