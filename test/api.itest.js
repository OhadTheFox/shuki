// End-to-end API test against `wrangler dev --local` with a fake Claude.
// Run: node test/api.itest.js   (starts and stops everything itself)
import './fetch-retry.js';
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

const STATE = '/tmp/shuki-test/shuki-itest';
const PORT = 8787, MOCK = 8799;
rmSync(STATE, { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply shuki --local --persist-to ${STATE}`, { stdio: 'ignore' });
execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --file test/fixture-house.sql`, { stdio: 'ignore' });
execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --command "INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999), ('222222', 2, 9999999999999)"`, { stdio: 'ignore' });

// ---- fake Claude: returns the next scripted tool input
const script = [];
let lastRequest = null;
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    lastRequest = JSON.parse(body);
    const input = script.shift() || { reply: 'ok', face: 'happy' };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'tool_use', name: 'respond', input }], usage: { input_tokens: 1000, output_tokens: 100 } }));
  });
}).listen(MOCK);

const dev = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(PORT), '--persist-to', STATE,
  '--var', `ANTHROPIC_URL:http://127.0.0.1:${MOCK}/v1/messages`, '--var', 'ANTHROPIC_API_KEY:test'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = ''; dev.stdout.on('data', (d) => (log += d)); dev.stderr.on('data', (d) => (log += d));

const base = `http://127.0.0.1:${PORT}`;
async function waitUp() { for (let i = 0; i < 60; i++) { try { await fetch(base + '/'); return; } catch { await new Promise((r) => setTimeout(r, 500)); } } throw new Error('dev server did not start\n' + log); }
const call = async (token, method, path, body) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json() };
};

let ok = 0; const step = async (name, fn) => { await fn(); ok++; console.log('✓', name); };

try {
  await waitUp();
  let avi, michal;
  await step('pairing issues device tokens; codes are single-use', async () => {
    const a = await call(null, 'POST', '/api/pair', { code: '111111', name: 'iPhone' });
    assert.equal(a.status, 200); avi = a.data.token; assert.equal(a.data.user.name, 'אבי');
    assert.equal((await call(null, 'POST', '/api/pair', { code: '111111' })).status, 400);
    michal = (await call(null, 'POST', '/api/pair', { code: '222222' })).data.token;
    assert.equal((await call('0'.repeat(64), 'GET', '/api/state')).status, 401);
  });

  let milk, tomato;
  await step('create products via actions; basic below target lands on the list', async () => {
    const r = await call(avi, 'POST', '/api/actions', { actions: [
      { kind: 'create', product: { name: 'חלב 3%', category_id: 'מוצרי חלב, גבינות וביצים', location_id: 'מקרר', count_type: 'units', unit: 'קרטון', qty: 1, is_basic: true, target: 2, shelf_days: 7 } },
      { kind: 'create', product: { name: 'עגבניות', category_id: 'ירקות ופירות', location_id: 'מקרר', count_type: 'level', level: 'plenty', is_basic: true, store: 'greengrocer', store2: 'super' } },
    ] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const s = (await call(avi, 'GET', '/api/state')).data;
    milk = s.products.find((p) => p.name === 'חלב 3%'); tomato = s.products.find((p) => p.name === 'עגבניות');
    assert.equal(milk.missing, true); assert.equal(tomato.missing, false);
    assert.equal(s.list.length, 1); assert.equal(s.list[0].product_id, milk.id); assert.equal(s.list[0].source, 'auto');
    assert.ok(milk.next_expiry > Date.now());
  });

  await step('Michal reports low tomatoes; journal speaks Hebrew with her gender', async () => {
    await call(michal, 'POST', '/api/actions', { actions: [{ kind: 'op', product_id: tomato.id, op: { type: 'low' } }] });
    const s = (await call(michal, 'GET', '/api/state')).data;
    assert.equal(s.list.length, 2);
    assert.match(s.journal[0].summary, /^מיכל סימנה שכמעט נגמרו עגבניות/);
  });

  await step('undo restores the last action of that user only', async () => {
    const u = await call(michal, 'POST', '/api/undo');
    assert.equal(u.status, 200);
    const s = (await call(michal, 'GET', '/api/state')).data;
    assert.equal(s.products.find((p) => p.id === tomato.id).level, 'plenty');
    assert.equal(s.list.length, 1);
  });

  await step('checking an item buys it; replay with the same op_id is ignored (offline sync)', async () => {
    let s = (await call(avi, 'GET', '/api/state')).data;
    const item = s.list[0];
    const body = { op_id: 'offline-1', context: 'shopping', actions: [{ kind: 'check', item_id: item.id, amount: 1 }] };
    await call(avi, 'POST', '/api/actions', body);
    const again = await call(avi, 'POST', '/api/actions', body);
    assert.equal(again.data.replay, true);
    s = (await call(avi, 'GET', '/api/state')).data;
    assert.equal(s.products.find((p) => p.id === milk.id).qty, 2);
    assert.equal(s.list[0].status, 'checked');
    await call(avi, 'POST', '/api/actions', { actions: [{ kind: 'finish', store: 'super' }] });
    s = (await call(avi, 'GET', '/api/state')).data;
    assert.equal(s.list.length, 0);
    assert.equal(s.offListThisMonth, 0);
  });

  await step('chat: Shuki proposes, nothing changes until approval', async () => {
    script.push({ reply: 'נגמר החלב? לעדכן?', face: 'happy', actions: [{ kind: 'op', product_id: milk.id, op: { type: 'out' } }] });
    const r = await call(avi, 'POST', '/api/chat', { text: 'נגמר החלב' });
    assert.equal(r.status, 200); assert.ok(r.data.proposal?.id, JSON.stringify(r.data));
    assert.match(r.data.proposal.lines[0].text, /^לסמן שנגמר החלב 3%( ולהוסיף לרשימה)?\?$/);
    assert.match(JSON.stringify(lastRequest.system), /חלב 3%/);
    let s = (await call(avi, 'GET', '/api/state')).data;
    assert.equal(s.products.find((p) => p.id === milk.id).qty, 2);
    const ap = await call(avi, 'POST', `/api/proposals/${r.data.proposal.id}/apply`, {});
    assert.equal(ap.data.status, 'applied');
    s = (await call(avi, 'GET', '/api/state')).data;
    assert.equal(s.products.find((p) => p.id === milk.id).qty, 0);
    assert.equal(s.list.length, 1);
    const h = (await call(avi, 'GET', '/api/chat')).data.messages;
    assert.equal(h.at(-1).content.status, 'applied');
  });

  await step('chat: questions do not create proposals; bought-new product counts as off-list', async () => {
    script.push({ reply: 'יש 0 קרטונים 🙃', face: 'neutral' });
    const q = await call(michal, 'POST', '/api/chat', { text: 'יש לנו חלב?' });
    assert.equal(q.data.proposal, undefined);
    script.push({ reply: 'רכז רימונים! להוסיף למלאי?', face: 'excited', actions: [{ kind: 'create', bought: true, product: { name: 'רכז רימונים', count_type: 'units', qty: 1, category_id: 'שימורים ורטבים', location_id: 'מזווה' } }] });
    const r = await call(michal, 'POST', '/api/chat', { text: 'קניתי רכז רימונים במבצע' });
    await call(michal, 'POST', `/api/proposals/${r.data.proposal.id}/apply`, {});
    const s = (await call(michal, 'GET', '/api/state')).data;
    assert.equal(s.offListThisMonth, 1);
    assert.ok(s.products.find((p) => p.name === 'רכז רימונים'));
  });

  await step('discard: a moment of crying in the app, not a sad day (decision 131)', async () => {
    await call(avi, 'POST', '/api/actions', { actions: [{ kind: 'op', product_id: tomato.id, op: { type: 'discard' } }] });
    const s = (await call(avi, 'GET', '/api/state')).data;
    assert.notEqual(s.mood.mood, 'sad');
  });

  await step('one-off list item and export', async () => {
    await call(avi, 'POST', '/api/actions', { actions: [{ kind: 'list_add', text: 'חלק לכיור', store: 'super' }] });
    const s = (await call(avi, 'GET', '/api/state')).data;
    assert.ok(s.list.find((i) => i.text === 'חלק לכיור'));
    const r = await fetch(base + '/api/export', { headers: { authorization: `Bearer ${avi}` } });
    const dump = await r.json();
    assert.ok(dump.products.length >= 3 && dump.events.length > 5);
  });

  console.log(`\n${ok} steps passed`);
} catch (e) {
  console.error('✗', e.message, '\n--- wrangler log tail ---\n', log.slice(-3000));
  process.exitCode = 1;
} finally {
  try { process.kill(-dev.pid, 'SIGKILL'); } catch { /* already gone */ } mock.close();
  setTimeout(() => process.exit(), 500);
}
