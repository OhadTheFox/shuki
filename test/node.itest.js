// The same app on plain Node.js + SQLite (server/node.js): setup, people, products, the list, a chat card, backup, restart.
// Run: node --disable-warning=ExperimentalWarning test/node.itest.js
import './fetch-retry.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DIR = '/tmp/shuki-test/shuki-node'; rmSync(DIR, { recursive: true, force: true });
const PORT = 8766, MOCK = 8767;
const script = [];
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { const b = Buffer.concat(parts).toString('utf8'); // bytes first: a Hebrew letter can be split between chunks (question 29)

  const input = script.shift() || { reply: 'ok', face: 'happy' };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'tool_use', id: 'tu1', name: 'respond', input }], usage: { input_tokens: 10, output_tokens: 1 } }));
}); }).listen(MOCK);
const start = (extra = {}) => spawn('node', ['--disable-warning=ExperimentalWarning', 'server/node.js'], { env: { ...process.env, PORT: String(PORT), DB_PATH: `${DIR}/shuki.db`, ANTHROPIC_URL: `http://127.0.0.1:${MOCK}/v1/messages`, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
let srv = start({ ANTHROPIC_API_KEY: 'sk-ant-test' });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
const up = async () => { for (let i = 0; i < 160; i++) { try { await fetch(base + '/'); return; } catch { await new Promise((r) => setTimeout(r, 250)); } } };
const call = async (t, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const txt = await r.text(); let data = null; try { data = JSON.parse(txt); } catch { /* text */ } return { status: r.status, data, text: txt }; };
const results = [];
async function check(id, name, fn) {
  try { const note = await fn(); results.push({ id, name, ok: true, note: note || '' }); console.log('✓', id, name, note ? `— ${note}` : ''); }
  catch (e) { results.push({ id, name, ok: false, error: e.message.slice(0, 400) }); console.log('✗', id, name, '\n   ', e.message.slice(0, 400)); }
}
let a, b, adminTok;
try {
  await up();
  await check('N1', 'עולה, מריץ את כל המיגרציות, מדפיס קוד הקמה, ולא מגיש קבצים מחוץ לתיקייה', async () => {
    assert.match(log, /migration 0007_household\.sql/); const m = log.match(/[Ss]etup code (\d{8})/); assert.ok(m, log);
    assert.equal((await fetch(base + '/')).status, 200); assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
    const r = await call(null, 'POST', '/api/setup', { code: m[1], house: 'בית בדיקה', name: 'דנה', gender: 'f', key: 'sk-ant-api03-' + 'y'.repeat(40) });
    assert.equal(r.status, 200, r.text); a = r.data.token;
    const chat = (await call(a, 'GET', '/api/chat')).data.messages;
    // decisions 150, 179: four bubbles of who Shuki is; the last one starts the first meeting
    assert.equal(chat.length, 4, JSON.stringify(chat)); assert.match(chat[0].content.reply, /^אני שוקי, הרובוט החמוד שעוזר לכם/); assert.match(chat[3].content.reply, /מי מנהל את האפליקציה/);
    // "later": the meeting waits, and the chat is the usual one (the model)
    const later = (await call(a, 'POST', '/api/chat', { text: 'אחר כך' })).data;
    assert.match(later.bubbles ? JSON.stringify(later) : later.reply || '', /נמשיך להכיר/, JSON.stringify(later));
    return m[1];
  });
  await check('N2', 'בני בית, מוצר בסיסי שנכנס לרשימה, סימון, ביטול', async () => {
    const add = await call(a, 'POST', '/api/members', { add: { name: 'יואב', gender: 'm' } });
    b = (await call(null, 'POST', '/api/pair', { code: add.data.code })).data.token; assert.ok(b);
    const r = await call(a, 'POST', '/api/actions', { actions: [{ kind: 'create', product: { name: 'חלב', count_type: 'units', qty: 0, is_basic: 1, target: 2 } }] });
    assert.equal(r.status, 200, r.text);
    let s = (await call(b, 'GET', '/api/state')).data; const milk = s.products.find((p) => p.name === 'חלב');
    const it = s.list.find((i) => i.product_id === milk.id); assert.ok(it, 'basic on the list');
    await call(b, 'POST', '/api/actions', { actions: [{ kind: 'check', item_id: it.id, amount: 2 }] });
    s = (await call(a, 'GET', '/api/state')).data; assert.equal(s.products.find((p) => p.name === 'חלב').qty, 2);
    assert.equal((await call(b, 'POST', '/api/undo')).status, 200);
    s = (await call(a, 'GET', '/api/state')).data; assert.equal(s.products.find((p) => p.name === 'חלב').qty, 0, 'undo');
    assert.equal(s.keyFrom, 'app'); assert.match(s.vapid, /^[A-Za-z0-9_-]{80,}$/);
    return s.users.map((u) => u.name).join(', ');
  });
  await check('N3', 'צ\'אט עם כרטיס ואישור, וגיבוי בלי סודות', async () => {
    const s = (await call(a, 'GET', '/api/state')).data; const milk = s.products.find((p) => p.name === 'חלב');
    script.push({ reply: 'לעדכן?', face: 'happy', actions: [{ kind: 'op', product_id: milk.id, op: { type: 'purchase', amount: 3 } }] });
    const c = (await call(a, 'POST', '/api/chat', { text: 'קניתי 3 חלב' })).data;
    assert.ok(c.proposal, JSON.stringify(c));
    assert.equal((await call(a, 'POST', `/api/proposals/${c.proposal.id}/apply`, {})).data.status, 'applied');
    assert.equal((await call(a, 'GET', '/api/state')).data.products.find((p) => p.name === 'חלב').qty, 3);
    const exp = await call(a, 'GET', '/api/export'); assert.equal(exp.status, 200); assert.ok(!exp.text.includes('sk-ant') && !exp.text.includes('privateJwk'));
    return 'ok';
  });
  let backup;
  await check('N5a', 'גיבוי: כולל את בני הבית, ובלי סודות', async () => {
    backup = (await call(a, 'GET', '/api/export')).data;
    assert.deepEqual(backup.users.map((u) => u.name).sort(), ['דנה', 'יואב']); assert.ok(!('token_hash' in backup.users[0]));
    return `${backup.products.length} מוצרים`;
  });
  await check('N4', 'הפעלה מחדש: הנתונים נשארים, המיגרציות לא רצות שוב, ואין קוד הקמה', async () => {
    srv.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 800));
    srv = start(); let l2 = ''; srv.stdout.on('data', (d) => (l2 += d));
    await up(); await new Promise((r) => setTimeout(r, 300));
    const s = (await call(a, 'GET', '/api/state')).data;
    assert.equal(s.products.find((p) => p.name === 'חלב').qty, 3); assert.doesNotMatch(l2, /migration 0001/); assert.doesNotMatch(l2, /[Ss]etup code/);
    const db = new DatabaseSync(`${DIR}/shuki.db`, { readOnly: true });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM d1_migrations').get().n, (await import('node:fs')).readdirSync('migrations').filter((f) => f.endsWith('.sql')).length); db.close();
    return 'ok';
  });
  await check('N5', 'שחזור מגיבוי בבית חדש (שרת אחר): המלאי, הרשימה ובני הבית חוזרים, ומי שמקים הוא המנהל', async () => {
    srv.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 800));
    rmSync(`${DIR}-2`, { recursive: true, force: true });
    srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/node.js'], { env: { ...process.env, PORT: String(PORT), DB_PATH: `${DIR}-2/shuki.db`, SETUP_CODE: '24681357', ANTHROPIC_URL: `http://127.0.0.1:${MOCK}/v1/messages` }, stdio: ['ignore', 'pipe', 'pipe'] });
    await up(); await new Promise((r) => setTimeout(r, 300));
    // a file from before stage 5 (b01): the house had a child's chat off, child_chat:<child> = '0'
    backup.users.push({ id: 99, name: 'נוני', gender: 'm', role: 'child', active: 1, created: 0 }); (backup.settings ||= []).push({ key: 'child_chat:99', value: '0' });
    const r = await call(null, 'POST', '/api/setup', { code: '24681357', name: 'יואב', gender: 'm', backup });
    assert.equal(r.status, 200, r.text); adminTok = r.data.token; assert.equal(r.data.restored.products, backup.products.length);
    const s = (await call(r.data.token, 'GET', '/api/state')).data;
    assert.equal(s.products.find((p) => p.name === 'חלב').qty, 3); assert.equal(s.house, 'בית בדיקה');
    assert.equal(s.me.name, 'יואב'); assert.equal(s.me.role, 'admin'); assert.deepEqual(s.users.map((u) => u.name).sort(), ['דנה', 'יואב', 'נוני']); // נוני: the child added to the file below
    assert.ok(s.journal.length > 2, 'the journal came back');
    const chat = (await call(r.data.token, 'GET', '/api/chat')).data.messages; assert.ok(!chat.some((m) => /נכיר\?/.test(m.content?.reply || '')), 'no hello for a restored house');
    const db2 = new DatabaseSync(`${DIR}-2/shuki.db`, { readOnly: true });
    const cc = db2.prepare("SELECT key, value FROM settings WHERE key LIKE 'child_chat:%' ORDER BY key").all().map((x) => `${x.key}=${x.value}`); db2.close();
    const adults = s.users.filter((u) => u.role !== 'child').map((u) => `child_chat:${u.id}:99=0`).sort();
    assert.deepEqual(cc, adults, 'the old child_chat:<child> of the file is each grown-up\'s now (b01)');
    return JSON.stringify(r.data.restored);
  });
  await check('N6', 'גיבוי יומי ושחזור ליום קודם גם על Node + SQLite', async () => {
    srv.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 800));
    srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/node.js'], { env: { ...process.env, PORT: String(PORT), DB_PATH: `${DIR}-2/shuki.db`, RUN_SCHEDULE_ON_START: '1', ANTHROPIC_URL: `http://127.0.0.1:${MOCK}/v1/messages` }, stdio: ['ignore', 'pipe', 'pipe'] });
    let l3 = ''; srv.stdout.on('data', (d) => (l3 += d)); srv.stderr.on('data', (d) => (l3 += d));
    await up(); await new Promise((r) => setTimeout(r, 1200));
    const t = adminTok; // the same database: the phone from N5 is still paired
    const days = (await call(t, 'GET', '/api/backups')).data.backups; assert.equal(days.length, 1, l3);
    let s = (await call(t, 'GET', '/api/state')).data; const milk = s.products.find((p) => p.name === 'חלב');
    await call(t, 'POST', '/api/actions', { actions: [{ kind: 'delete', product_id: milk.id }, { kind: 'create', product: { name: 'טחינה', count_type: 'units', qty: 1 } }] });
    const r = await call(t, 'POST', '/api/backups/restore', { day: days[0].day }); assert.equal(r.status, 200, r.text);
    s = (await call(t, 'GET', '/api/state')).data;
    assert.equal(s.products.find((p) => p.name === 'חלב')?.qty, 3); assert.ok(!s.products.some((p) => p.name === 'טחינה'));
    return days[0].day;
  });
} finally {
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} node checks passed`);
  (await import('node:fs')).writeFileSync('test/node-results.json', JSON.stringify(results, null, 1));
  try { srv.kill('SIGKILL'); } catch { /* gone */ }
  mock.close(); process.exit(ok === results.length ? 0 : 1);
}
