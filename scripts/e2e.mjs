/**
 * End-to-end drive of the real slima-mcp client over stdio against a real Rails.
 *
 * Not a unit test: this speaks the actual MCP wire protocol to the actual built
 * client binary, which talks to the actual server. It is the only way to catch
 * the class of bug where every layer's own tests are green and the seam between
 * two of them is wrong (a param the controller never permitted, a tool that was
 * never registered, an error the client swallows).
 */
import { spawn } from 'node:child_process';

const BOOK = process.env.BOOK;
const CLIENT = process.env.CLIENT ?? '/home/ineeudisabel/projects/slima-mcp-server/dist/index.js';

const child = spawn('node', [CLIENT], {
  env: { ...process.env, SLIMA_API_TOKEN: process.env.TOKEN, SLIMA_API_URL: process.env.API_URL },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buffer = '';
const pending = new Map();
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

let nextId = 1;
function send(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    setTimeout(() => reject(new Error(`timeout: ${method} ${JSON.stringify(params?.name ?? '')}`)), 30000);
  });
}

const results = [];
function record(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

async function call(tool, args) {
  const res = await send('tools/call', { name: tool, arguments: args });
  const text = (res.result?.content ?? []).map((c) => c.text ?? `[${c.type}]`).join('\n');
  return { isError: !!res.result?.isError, text, raw: res };
}

async function main() {
  await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'e2e', version: '1' },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  // ── discovery ──────────────────────────────────────────────────────
  const listed = await send('tools/list', {});
  const tools = (listed.result?.tools ?? []).map((t) => t.name);
  record('tools/list answers', tools.length > 0, `${tools.length} tools`);
  for (const expected of ['update_beat_board', 'update_timeline', 'update_script',
    'update_relationship_map', 'update_world_map']) {
    record(`tool registered: ${expected}`, tools.includes(expected));
  }

  // Gemini rejects the whole catalogue over one bad key — worth checking on the
  // real advertised schemas, not just the ones a unit test constructs.
  const BANNED = ['$schema', 'additionalProperties', 'oneOf', 'anyOf', '$ref'];
  const dirty = [];
  const scan = (node, path, toolName) => {
    if (Array.isArray(node)) return node.forEach((n, i) => scan(n, `${path}[${i}]`, toolName));
    if (!node || typeof node !== 'object') return;
    for (const key of Object.keys(node)) {
      if (BANNED.includes(key)) dirty.push(`${toolName}${path}.${key}`);
      scan(node[key], `${path}.${key}`, toolName);
    }
  };
  for (const t of listed.result?.tools ?? []) scan(t.inputSchema, '', t.name);
  record('no schema key Gemini rejects', dirty.length === 0, dirty.slice(0, 3).join(', '));

  // ── teaching ───────────────────────────────────────────────────────
  const caps = await call('get_capabilities', {});
  record('get_capabilities', !caps.isError && caps.text.includes('filePolicy'));
  const guides = await call('list_guides', {});
  record('list_guides', !guides.isError && guides.text.includes('format-beats'));
  const guide = await call('load_guide', { slug: 'format-beats' });
  record('load_guide', !guide.isError && guide.text.includes('beat'));

  // ── books ──────────────────────────────────────────────────────────
  const books = await call('list_books', {});
  record('list_books sees the test book', !books.isError && books.text.includes(BOOK));

  // ── prose CRUD ─────────────────────────────────────────────────────
  const created = await call('create_file', {
    book_token: BOOK, path: 'chapters/ch01.md', content: '第一章 霧', content_type: 'manuscript',
  });
  record('create_file (.md)', !created.isError, created.text.split('\n')[0]);

  const read = await call('read_file', { book_token: BOOK, path: 'chapters/ch01.md' });
  record('read_file returns what was written', !read.isError && read.text.includes('第一章 霧'));

  const edited = await call('edit_file', {
    book_token: BOOK, path: 'chapters/ch01.md', old_string: '霧', new_string: '雨',
  });
  record('edit_file', !edited.isError && edited.text.includes('Replacements'));

  const appended = await call('append_to_file', {
    book_token: BOOK, path: 'chapters/ch01.md', content: '\n\n門開了。',
  });
  record('append_to_file', !appended.isError);

  const searched = await call('search_content', { book_token: BOOK, query: '門開了' });
  record('search_content finds it', !searched.isError && searched.text.includes('ch01.md'));

  // ── structured: the whole point of this batch ──────────────────────
  const madeBoard = await call('create_file', {
    book_token: BOOK, path: 'plan/board.beats', content: '{"rows":[{"id":"forged"}]}',
  });
  record('create_file (.beats) makes a skeleton', !madeBoard.isError);
  record('create_file says the content was not stored',
    madeBoard.text.toLowerCase().includes('not stored'), madeBoard.text.split('\n').slice(-2).join(' '));

  const batch = await call('update_beat_board', {
    book_token: BOOK, path: 'plan/board.beats', intent: '把第一幕搭起來',
    operations: [
      { op: 'add_act', name: '第一幕', op_ref: 'A1' },
      { op: 'add_beat', title: '開場', act_id: '@A1', op_ref: 'B1' },
      { op: 'add_beat', title: '轉折', act_id: '@A1' },
    ],
  });
  record('update_beat_board applies a batch', !batch.isError, batch.text.split('\n')[0]);
  record('update_beat_board reports new ids', batch.text.includes('New ids'));
  record('op_ref resolved across operations', batch.text.includes('@A1'));

  const boardAfter = await call('read_file', { book_token: BOOK, path: 'plan/board.beats' });
  const board = JSON.parse(boardAfter.text.split('---')[1].trim());
  record('board really has the two beats', board.rows?.length === 2, JSON.stringify(board.rows?.map((r) => r.title)));
  record('files[] survived untouched', Array.isArray(board.files) && board.files.length === 0);

  const beatId = board.rows[0].id;
  const removed = await call('update_beat_board', {
    book_token: BOOK, path: 'plan/board.beats', intent: '拿掉開場',
    operations: [{ op: 'remove_beat', id: beatId }],
  });
  record('remove_beat works', !removed.isError);

  // Errors an agent has to be able to act on.
  const badId = await call('update_beat_board', {
    book_token: BOOK, path: 'plan/board.beats', intent: 'x',
    operations: [{ op: 'update_beat', id: 'definitely-not-real', title: 'x' }],
  });
  record('unknown id is refused', badId.isError);
  record('unknown id error lists the real ones', badId.text.includes('Existing beat ids'));

  const strayField = await call('update_beat_board', {
    book_token: BOOK, path: 'plan/board.beats', intent: 'x',
    operations: [{ op: 'update_act', id: 'a', title: 'wrong field' }],
  });
  record('field from another operation is refused', strayField.isError);
  record('and it names whose field it is', strayField.text.includes('belongs to'));

  const forward = await call('update_beat_board', {
    book_token: BOOK, path: 'plan/board.beats', intent: 'x',
    operations: [{ op: 'add_beat', title: 'x', act_id: '@LATER' }],
  });
  record('forward op_ref is refused', forward.isError && /EARLIER/i.test(forward.text));

  const wrongType = await call('update_timeline', {
    book_token: BOOK, path: 'plan/board.beats', intent: 'x',
    operations: [{ op: 'add_entry', title: 'x' }],
  });
  record('a timeline batch aimed at a .beats is refused', wrongType.isError);

  // ── timeline ───────────────────────────────────────────────────────
  await call('create_file', { book_token: BOOK, path: 'chrono/main.timeline' });
  const tl = await call('update_timeline', {
    book_token: BOOK, path: 'chrono/main.timeline', intent: '補兩個事件',
    operations: [
      { op: 'set_config', mode: 'calendar', calendar: { name: '帝國曆', epoch_year: 1, months: [{ name: '初月', days: 30 }] } },
      { op: 'add_entry', title: '開戰', time_mode: 'date', date: { year: 2, month: 1, day: 5 } },
      { op: 'add_entry', title: '停戰', time_mode: 'label', time_label: '三年後' },
    ],
  });
  record('update_timeline with a calendar', !tl.isError, tl.text.split('\n')[0]);

  const badMonth = await call('update_timeline', {
    book_token: BOOK, path: 'chrono/main.timeline', intent: 'x',
    operations: [{ op: 'add_entry', title: 'x', time_mode: 'date', date: { year: 1, month: 13 } }],
  });
  record('a month this world does not have is refused', badMonth.isError && /has 1 month/.test(badMonth.text));

  const linked = await call('update_timeline', {
    book_token: BOOK, path: 'chrono/main.timeline', intent: 'x',
    operations: [{ op: 'add_entry', title: 'x', note_id: 'nt_1' }],
  });
  record('the AI may not link an entry', linked.isError && /author|editor/i.test(linked.text));

  // ── script ─────────────────────────────────────────────────────────
  await call('create_file', { book_token: BOOK, path: 'scripts/ep01.script' });
  const sc = await call('update_script', {
    book_token: BOOK, path: 'scripts/ep01.script', intent: '寫第一場',
    operations: [
      { op: 'add_scene', interior: false, location: '星港碼頭', time_of_day: 'night', op_ref: 'S1' },
      { op: 'add_element', scene_id: '@S1', type: 'action', text: '霧從海面漫上來。' },
      { op: 'add_element', scene_id: '@S1', type: 'character', name: '阿凱' },
      { op: 'add_element', scene_id: '@S1', type: 'dialogue', text: '船要開了 快上來' },
    ],
  });
  record('update_script writes a scene', !sc.isError, sc.text.split('\n')[0]);

  const scRead = await call('read_file', { book_token: BOOK, path: 'scripts/ep01.script' });
  const script = JSON.parse(scRead.text.split('---')[1].trim());
  record('scene numbering is the app\'s', script.scenes?.[0]?.sceneNumber === 1);
  record('scene stats were recomputed', (script.scenes?.[0]?.stats?.wordCount ?? 0) > 0,
    `wordCount=${script.scenes?.[0]?.stats?.wordCount}`);
  record('character element is never linked', script.scenes[0].elements.find((e) => e.type === 'character')?.characterId === null);

  // ── .map: field-level, and every generic write refused ─────────────
  const madeMap = await call('create_file', {
    book_token: BOOK, path: 'world/relations.map', content: '{"nodes":[{"id":"forged"}]}',
  });
  record('create_file (.map) makes a skeleton', !madeMap.isError);
  record('.map create says the content was not stored', madeMap.text.toLowerCase().includes('not stored'));

  const mapBatch = await call('update_relationship_map', {
    book_token: BOOK, path: 'world/relations.map', intent: '放進兩個人和他們的關係',
    operations: [
      { op: 'add_node', label: '沈硯', op_ref: 'N1' },
      { op: 'add_node', label: '林霜', op_ref: 'N2', position: { near_id: '@N1', direction: 'right' } },
      { op: 'add_edge', source_id: '@N1', target_id: '@N2', label: '師徒' },
      { op: 'add_group', label: '書院', member_ids: ['@N1', '@N2'] },
    ],
  });
  record('update_relationship_map applies a batch', !mapBatch.isError, mapBatch.text.split('\n')[0]);
  record('.map reports where it placed each node', /placed at \(/.test(mapBatch.text));

  const mapRead = await call('read_file', { book_token: BOOK, path: 'world/relations.map' });
  const mapDoc = JSON.parse(mapRead.text.split('---')[1].trim());
  record('.map group box is computed from its members',
    (mapDoc.groups?.[0]?.width ?? 0) > 0, `width=${mapDoc.groups?.[0]?.width}`);
  record('.map coordinates are written as JS numbers',
    !/"x": -?\d+\.0[,\n]/.test(mapRead.text), 'no trailing .0');

  const mapMoveViaUpdate = await call('update_relationship_map', {
    book_token: BOOK, path: 'world/relations.map', intent: 'x',
    operations: [{ op: 'update_node', id: mapDoc.nodes[0].id, position: { x: 5, y: 5 } }],
  });
  record('.map update_node refuses to move', mapMoveViaUpdate.isError && /move_node/.test(mapMoveViaUpdate.text));

  const mapCascade = await call('update_relationship_map', {
    book_token: BOOK, path: 'world/relations.map', intent: '刪掉一個人',
    operations: [{ op: 'remove_node', id: mapDoc.nodes[0].id }],
  });
  record('.map removing a node takes its edges', !mapCascade.isError && /edge\(s\) removed/.test(mapCascade.text));

  for (const [tool, args] of [
    ['write_file', { content: '{"version":"1.0","nodes":[],"edges":[]}' }],
    ['append_to_file', { content: 'x' }],
    ['edit_file', { old_string: 'nodes', new_string: 'x' }],
  ]) {
    const refused = await call(tool, { book_token: BOOK, path: 'world/relations.map', ...args });
    record(`.map ${tool} is refused`, refused.isError);
    record(`.map ${tool} names update_relationship_map`, refused.text.includes('update_relationship_map'));
  }

  // ── .geomap: the type that used to be flatly read-only ─────────────
  const madeGeo = await call('create_file', { book_token: BOOK, path: 'world/atlas.geomap', content: '{}' });
  record('create_file (.geomap) makes a skeleton', !madeGeo.isError, madeGeo.text.split('\n')[0]);

  const geoBatch = await call('update_world_map', {
    book_token: BOOK, path: 'world/atlas.geomap', intent: '放一個港口、一條河、一片山',
    operations: [
      { op: 'add_place', x: 210, y: 96, name: '星港', tier: 'port' },
      { op: 'add_label', x: 240, y: 60, text: '寒海', size: 'large' },
      { op: 'add_river', pts: [[100, 50], [140, 90], [210, 95]] },
      { op: 'paint_region', layer: 'base', value: 'mount', shape: { type: 'circle', cx: 300, cy: 200, r: 8 } },
      { op: 'set_meta', title: '北境' },
    ],
  });
  record('update_world_map applies a batch', !geoBatch.isError, geoBatch.text.split('\n')[0]);
  record('.geomap says how many cells it painted', /painted \d+ cell/.test(geoBatch.text));
  record('.geomap says the river was smoothed', /smoothed into/.test(geoBatch.text));

  const geoRead = await call('read_file', { book_token: BOOK, path: 'world/atlas.geomap' });
  record('.geomap read omits the terrain grids', /terrain grid, omitted/.test(geoRead.text));
  record('.geomap read still shows the places', geoRead.text.includes('星港'));

  const badTier = await call('update_world_map', {
    book_token: BOOK, path: 'world/atlas.geomap', intent: 'x',
    operations: [{ op: 'add_place', x: 10, y: 10, tier: 'city' }],
  });
  record('.geomap unknown tier is refused', badTier.isError);
  record('.geomap refusal lists the real tiers', /village/.test(badTier.text) && /dragon/.test(badTier.text));

  const offGrid = await call('update_world_map', {
    book_token: BOOK, path: 'world/atlas.geomap', intent: 'x',
    operations: [{ op: 'add_place', x: 900, y: 10, tier: 'town' }],
  });
  record('.geomap out-of-grid coordinate is refused', offGrid.isError && /cells, not pixels/.test(offGrid.text));

  const geoWrite = await call('write_file', {
    book_token: BOOK, path: 'world/atlas.geomap', content: '{"format":"slima-geomap"}',
  });
  record('.geomap write_file is refused', geoWrite.isError && geoWrite.text.includes('update_world_map'));

  // ── a type that really has no write path ───────────────────────────
  const characterWrite = await call('create_file', {
    book_token: BOOK, path: 'cast/hero.character', content: '{}',
  });
  record('.character create is refused', characterWrite.isError);
  record('.character refusal is the type, not a missing tool',
    /not AI-writable|editor/i.test(characterWrite.text));

  // ── the map viewer ─────────────────────────────────────────────────
  const viz = await call('view_relationship_map', { book_token: BOOK, path: 'world/relations.map' });
  record('view_relationship_map answers', !viz.isError, viz.text.split('\n')[0]);

  // ── delete ─────────────────────────────────────────────────────────
  const deleted = await call('delete_file', { book_token: BOOK, path: 'chapters/ch01.md' });
  record('delete_file', !deleted.isError);

  child.kill();
  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    console.log('\nFAILURES:');
    for (const f of failed) console.log(`  ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('E2E harness error:', e.message);
  child.kill();
  process.exit(2);
});
