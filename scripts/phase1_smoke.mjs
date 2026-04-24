/**
 * Real Phase 1 smoke test against a running Rails + the v0.2.0 MCP CLI.
 *
 * Spawns the CLI as a child process (exactly the way Claude Desktop
 * spawns it), runs the MCP JSON-RPC handshake over stdio, and verifies
 * each advertised Script Studio behavior actually materializes:
 *   - initialize instructions mention Script Studio
 *   - 5 write tools advertise the allowlist in their descriptions
 *   - read_file does NOT carry the Studio restriction text
 *   - search_content exposes include_structured
 *   - resources/templates/list advertises slima://books/{book_token}/schema
 *   - resources/read returns correct JSON for both book types
 *   - create_file on a script book's structured path → isError
 *   - create_file on .script_studio/planning/** → success
 *   - list_books / get_book show 📝 / 📖 Studio labels
 *   - analyze_chapter short-circuits on script books
 *
 * Usage (requires a logged-in user token + one of each book type):
 *
 *   SLIMA_API_TOKEN=slima_xxx \
 *   SLIMA_API_URL=http://localhost:3000 \
 *   SCRIPT_BOOK_TOKEN=bk_... \
 *   WRITING_BOOK_TOKEN=bk_... \
 *   node scripts/phase1_smoke.mjs
 *
 * Exits non-zero on any failure so CI can enforce.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const TOKEN = process.env.SLIMA_API_TOKEN;
const API_URL = process.env.SLIMA_API_URL || 'http://localhost:3000';
const SCRIPT_BOOK = process.env.SCRIPT_BOOK_TOKEN;
const WRITING_BOOK = process.env.WRITING_BOOK_TOKEN;

if (!TOKEN || !SCRIPT_BOOK || !WRITING_BOOK) {
  console.error('Missing env: SLIMA_API_TOKEN, SCRIPT_BOOK_TOKEN, WRITING_BOOK_TOKEN required');
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: 'node',
  args: ['/home/ineeudisabel/projects/slima-mcp-server/dist/index.js'],
  env: { ...process.env, SLIMA_API_TOKEN: TOKEN, SLIMA_API_URL: API_URL },
});

const client = new Client(
  { name: 'phase1-smoke', version: '0.0.1' },
  { capabilities: { tools: {}, resources: {} } }
);

await client.connect(transport);

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// 1. initialize surfaces instructions
const instructions = client.getInstructions?.() ?? '';
record(
  'initialize instructions mention Script Studio',
  /script studio/i.test(instructions) && instructions.includes('.script_studio/planning'),
  instructions.length > 0 ? `${instructions.length} chars` : 'EMPTY'
);

// 2. tools/list: 5 write tools carry the allowlist
const { tools } = await client.listTools();
const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
for (const name of ['write_file', 'edit_file', 'create_file', 'delete_file', 'append_to_file']) {
  const desc = byName[name]?.description ?? '';
  record(
    `${name} description mentions Script Studio`,
    /script studio/i.test(desc) && desc.includes('.script_studio/planning')
  );
}
record(
  'read_file description does NOT mention Script Studio',
  !/script studio/i.test(byName['read_file']?.description ?? '')
);
record(
  'search_content exposes include_structured',
  Boolean(byName['search_content']?.inputSchema?.properties?.include_structured)
);

// 3. resources/templates/list advertises the schema template
const { resourceTemplates } = await client.listResourceTemplates();
const tmpl = resourceTemplates.find((t) => t.uriTemplate.startsWith('slima://books/'));
record(
  'resources/templates/list advertises slima://books/{book_token}/schema',
  Boolean(tmpl) && tmpl.uriTemplate === 'slima://books/{book_token}/schema'
);

// 4. resources/read for the script book
const schemaRes = await client.readResource({
  uri: `slima://books/${SCRIPT_BOOK}/schema`,
});
const schema = JSON.parse(schemaRes.contents[0].text);
record(
  'schema Resource for script book — writable_paths = .script_studio/planning/**/*',
  JSON.stringify(schema.mcp_capabilities?.writable_paths) === JSON.stringify(['.script_studio/planning/**/*'])
);
record(
  'schema Resource for script book — readonly_paths includes series.json',
  Array.isArray(schema.mcp_capabilities?.readonly_paths) &&
    schema.mcp_capabilities.readonly_paths.some((p) => p.includes('series.json'))
);
record(
  'schema Resource book_type=script',
  schema.book_type === 'script'
);

// 5. resources/read for writing book
const wSchemaRes = await client.readResource({
  uri: `slima://books/${WRITING_BOOK}/schema`,
});
const wSchema = JSON.parse(wSchemaRes.contents[0].text);
record(
  'schema Resource for writing book — writable_paths = **/*',
  JSON.stringify(wSchema.mcp_capabilities?.writable_paths) === JSON.stringify(['**/*'])
);

// 6. tools/call create_file on script series.json → isError + Script Studio message
const blocked = await client.callTool({
  name: 'create_file',
  arguments: {
    book_token: SCRIPT_BOOK,
    path: '.script_studio/series.json',
    content: '{"title":"evil"}',
  },
});
const blockedText = blocked.content[0]?.text ?? '';
record(
  'create_file on series.json → isError + Script Studio msg',
  blocked.isError === true && /script studio/i.test(blockedText)
);

// 7. tools/call create_file on planning/ → success (file should commit)
const okPath = `.script_studio/planning/references/mcp_smoke_${Date.now()}.md`;
const ok = await client.callTool({
  name: 'create_file',
  arguments: {
    book_token: SCRIPT_BOOK,
    path: okPath,
    content: '# MCP smoke test\n\nIf you see this, the planning/ allowlist works.',
  },
});
record(
  `create_file on ${okPath} → success`,
  !ok.isError
);

// 8. list_books shows Studio labels
const listed = await client.callTool({ name: 'list_books', arguments: {} });
const listedText = listed.content[0]?.text ?? '';
record('list_books shows 📝 Script Studio', listedText.includes('📝 Script Studio'));
record('list_books shows 📖 Writing Studio', listedText.includes('📖 Writing Studio'));

// 9. get_book on script book — Write Restrictions block
const getScript = await client.callTool({
  name: 'get_book',
  arguments: { book_token: SCRIPT_BOOK },
});
const getScriptText = getScript.content[0]?.text ?? '';
record(
  'get_book on script shows Write Restrictions block',
  /Write Restrictions/.test(getScriptText) && getScriptText.includes('slima://books/')
);
record(
  'get_book on script — 📝 label',
  getScriptText.includes('📝 Script Studio')
);

// 10. get_book on writing book — NO restrictions block
const getWriting = await client.callTool({
  name: 'get_book',
  arguments: { book_token: WRITING_BOOK },
});
const getWritingText = getWriting.content[0]?.text ?? '';
record(
  'get_book on writing book does NOT show Write Restrictions block',
  !/Write Restrictions/.test(getWritingText)
);

// 11. analyze_chapter on script book short-circuits with isError
const analyze = await client.callTool({
  name: 'analyze_chapter',
  arguments: {
    book_token: SCRIPT_BOOK,
    file_path: 'some-scene.scene',
    persona_token: 'psn_test',
  },
});
const analyzeText = analyze.content[0]?.text ?? '';
record(
  'analyze_chapter on script → isError + not-available message',
  analyze.isError === true && /not available/i.test(analyzeText)
);

await client.close();

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log('');
console.log(`=== ${passed}/${results.length} passed, ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);
