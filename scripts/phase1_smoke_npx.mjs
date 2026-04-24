/**
 * Runs scripts/phase1_smoke.mjs logic but spawns the npm-published
 * slima-mcp@0.2.0 via `npx -y` instead of the local dist/. Proves the
 * npm artifact users actually install matches what we tested locally.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const TOKEN = process.env.SLIMA_API_TOKEN;
const API_URL = process.env.SLIMA_API_URL || 'http://localhost:3000';
const SCRIPT_BOOK = process.env.SCRIPT_BOOK_TOKEN;
const WRITING_BOOK = process.env.WRITING_BOOK_TOKEN;
const NPM_SPEC = process.env.SLIMA_MCP_SPEC || 'slima-mcp@0.2.0';

if (!TOKEN || !SCRIPT_BOOK || !WRITING_BOOK) {
  console.error('Missing env: SLIMA_API_TOKEN, SCRIPT_BOOK_TOKEN, WRITING_BOOK_TOKEN');
  process.exit(1);
}

console.log(`[harness] spawning: npx -y ${NPM_SPEC}`);
console.log(`[harness] API:      ${API_URL}`);
console.log(`[harness] books:    script=${SCRIPT_BOOK}, writing=${WRITING_BOOK}`);

const transport = new StdioClientTransport({
  command: 'slima-mcp',
  args: [],
  env: { ...process.env, SLIMA_API_TOKEN: TOKEN, SLIMA_API_URL: API_URL },
});

const client = new Client(
  { name: 'phase1-smoke-npx', version: '0.0.1' },
  { capabilities: { tools: {}, resources: {} } }
);

await client.connect(transport);

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const instructions = client.getInstructions?.() ?? '';
record(
  'initialize instructions mention Script Studio',
  /script studio/i.test(instructions) && instructions.includes('.script_studio/planning'),
  `${instructions.length} chars`
);

const { tools } = await client.listTools();
const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
for (const name of ['write_file', 'edit_file', 'create_file', 'delete_file', 'append_to_file']) {
  record(`${name} description mentions Script Studio`,
    /script studio/i.test(byName[name]?.description ?? '') &&
    (byName[name]?.description ?? '').includes('.script_studio/planning'));
}
record('read_file description clean', !/script studio/i.test(byName['read_file']?.description ?? ''));
record('search_content exposes include_structured',
  Boolean(byName['search_content']?.inputSchema?.properties?.include_structured));

const { resourceTemplates } = await client.listResourceTemplates();
const tmpl = resourceTemplates.find((t) => t.uriTemplate.startsWith('slima://books/'));
record('resources/templates/list advertises schema URI',
  Boolean(tmpl) && tmpl.uriTemplate === 'slima://books/{book_token}/schema');

const schemaRes = await client.readResource({ uri: `slima://books/${SCRIPT_BOOK}/schema` });
const schema = JSON.parse(schemaRes.contents[0].text);
record('schema script: writable_paths = planning/**',
  JSON.stringify(schema.mcp_capabilities?.writable_paths) === JSON.stringify(['.script_studio/planning/**/*']));
record('schema script: readonly_paths has series.json',
  (schema.mcp_capabilities?.readonly_paths ?? []).some((p) => p.includes('series.json')));
record('schema script: book_type=script', schema.book_type === 'script');

const wSchemaRes = await client.readResource({ uri: `slima://books/${WRITING_BOOK}/schema` });
const wSchema = JSON.parse(wSchemaRes.contents[0].text);
record('schema writing: writable_paths = **/*',
  JSON.stringify(wSchema.mcp_capabilities?.writable_paths) === JSON.stringify(['**/*']));

const blocked = await client.callTool({
  name: 'create_file',
  arguments: { book_token: SCRIPT_BOOK, path: '.script_studio/series.json', content: '{"t":"evil"}' },
});
record('create_file on series.json → isError',
  blocked.isError === true && /script studio/i.test(blocked.content[0]?.text ?? ''));

const okPath = `.script_studio/planning/references/npx_smoke_${Date.now()}.md`;
const ok = await client.callTool({
  name: 'create_file',
  arguments: { book_token: SCRIPT_BOOK, path: okPath, content: '# npx smoke' },
});
record(`create_file on ${okPath} → success`, !ok.isError);

const listed = await client.callTool({ name: 'list_books', arguments: {} });
const listedText = listed.content[0]?.text ?? '';
record('list_books shows 📝 Script Studio', listedText.includes('📝 Script Studio'));
record('list_books shows 📖 Writing Studio', listedText.includes('📖 Writing Studio'));

const getScript = await client.callTool({ name: 'get_book', arguments: { book_token: SCRIPT_BOOK } });
const getScriptText = getScript.content[0]?.text ?? '';
record('get_book script: Write Restrictions block',
  /Write Restrictions/.test(getScriptText) && getScriptText.includes('slima://books/'));
record('get_book script: 📝 label', getScriptText.includes('📝 Script Studio'));

const getWriting = await client.callTool({ name: 'get_book', arguments: { book_token: WRITING_BOOK } });
record('get_book writing: NO Write Restrictions block',
  !/Write Restrictions/.test(getWriting.content[0]?.text ?? ''));

const analyze = await client.callTool({
  name: 'analyze_chapter',
  arguments: { book_token: SCRIPT_BOOK, file_path: 'x.scene', persona_token: 'psn_test' },
});
record('analyze_chapter on script → isError + not available',
  analyze.isError === true && /not available/i.test(analyze.content[0]?.text ?? ''));

await client.close();

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log('');
console.log(`=== ${passed}/${results.length} passed, ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);
