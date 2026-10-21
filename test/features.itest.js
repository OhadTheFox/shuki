// Shopping mode, learning and growth (server side). Run: node test/features.itest.js
import './fetch-retry.js';
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';

const STATE = '/tmp/shuki-test/shuki-feat';
const PORT = 8788, MOCK = 8794;
const d1 = (sql) => JSON.parse(execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --json --command "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^[^[]*/, ''))[0].results;
rmSync(STATE, { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply shuki --local --persist-to ${STATE}`, { stdio: 'ignore' });
execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --file test/fixture-house.sql`, { stdio: 'ignore' });
d1(`INSERT INTO pairing_codes (code, user_id, expires) VALUES ('481516', 1, 9999999999999), ('234234', 2, 9999999999999)`);

const script = []; const calls = [];
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { const b = Buffer.concat(parts).toString('utf8'); // bytes first: a Hebrew letter can be split between chunks (question 29)

  calls.push(JSON.parse(b));
  const input = script.shift() || { reply: 'ok', face: 'happy' };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'tool_use', id: 'tu1', name: 'respond', input }], usage: { input_tokens: 100, output_tokens: 10 } }));
}); }).listen(MOCK);
const dev = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(PORT), '--persist-to', STATE, '--var', `ANTHROPIC_URL:http://127.0.0.1:${MOCK}/v1/messages`, '--var', 'ANTHROPIC_API_KEY:t'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = ''; dev.stdout.on('data', (d) => (log += d)); dev.stderr.on('data', (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
const call = async (t, m, p, b, raw) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', 'x-levels': '21', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: raw ?? (b ? JSON.stringify(b) : undefined) }); return { status: r.status, data: await r.json().catch(() => null), bytes: +r.headers.get('content-length') || 0 }; };
const state = async (t) => (await call(t, 'GET', '/api/state')).data;
const results = [];
async function check(id, name, fn) {
  const t0 = Date.now();
  try { const note = await fn(); results.push({ id, name, ok: true, note: note || '', ms: Date.now() - t0 }); console.log('✓', id, name, note ? `— ${note}` : ''); }
  catch (e) { results.push({ id, name, ok: false, error: e.message.slice(0, 300) }); console.log('✗', id, name, '\n   ', e.message.slice(0, 300)); }
}

let avi, michal;
const DAY = 86400e3;
const SUB = { endpoint: 'https://push.example.com/michal', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } };
const act = (t, actions, extra = {}) => call(t, 'POST', '/api/actions', { actions, op_id: `op-${Math.random()}`, ...extra });
try {
  for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  avi = (await call(null, 'POST', '/api/pair', { code: '481516' })).data.token;
  michal = (await call(null, 'POST', '/api/pair', { code: '234234' })).data.token;
  await call(michal, 'POST', '/api/push/subscribe', { subscription: SUB });
  await call(avi, 'POST', '/api/push/subscribe', { subscription: { ...SUB, endpoint: 'https://push.example.com/avi' } });
  await act(avi, [
    { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 2, is_basic: 1, target: 2, category_id: 'מוצרי חלב, גבינות וביצים', location_id: 'מקרר' } },
    { kind: 'create', product: { name: 'קוטג׳', count_type: 'units', qty: 1, category_id: 'מוצרי חלב, גבינות וביצים', location_id: 'מקרר' } },
  ]);
  const P = async (name) => (await state(avi)).products.find((p) => p.name === name);

  await check('F1', 'אבי כותב "אני עושה קניות": נפתח מצב קניות ומיכל מקבלת התראה', async () => {
    script.push({ reply: 'יאללה! אעדכן את מיכל', face: 'excited', shopping: 'start', store: 'super' });
    const r = (await call(avi, 'POST', '/api/chat', { text: 'אני עושה קניות' })).data;
    assert.equal(r.shopping, 'start'); assert.ok(!r.proposal, 'no approval card for shopping mode');
    assert.equal(r.notify.length, 1); assert.equal(r.notify[0].to, 'מיכל'); assert.match(r.notify[0].title, /אבי בקניות/);
    const s = await state(michal);
    assert.equal(s.shopping.length, 1); assert.equal(s.shopping[0].name, 'אבי'); assert.equal(s.shopping[0].mine, false);
    assert.equal((await state(avi)).shopping[0].mine, true);
    assert.match(calls.at(-1).system[3].text, /בקניות עכשיו: אף אחד/); // 0e: part 4, this message // the model saw the house before the trip opened
    return r.notify[0].body;
  });

  await check('F2', 'אותו משפט שוב לא שולח התראה כפולה', async () => {
    const r = (await call(avi, 'POST', '/api/shopping', { on: true, store: 'super' })).data;
    assert.equal(r.notify.length, 0);
    assert.equal((await state(avi)).shopping.length, 1);
  });

  await check('F3', 'מיכל מוסיפה לרשימה בזמן שאבי בסופר: אבי (ורק הוא) מקבל התראה עם שם המוצר', async () => {
    const r = (await act(michal, [{ kind: 'list_add', text: 'במבה' }])).data;
    assert.deepEqual(r.notify.map((n) => n.to), ['אבי']); assert.equal(r.notify[0].body, 'במבה'); assert.match(r.notify[0].title, /מיכל הוסיפה/);
    const item = (await state(avi)).list.find((i) => i.text === 'במבה');
    assert.ok(item.added_by === 2 && item.added >= (await state(avi)).shopping[0].started, 'marked as added by Michal during the trip');
  });

  await check('F4', 'מיכל מדווחת בצ׳אט "נגמר החלב": החלב נכנס לרשימה ואבי מקבל התראה', async () => {
    const milk = await P('חלב 3%');
    script.push({ reply: 'אוי', face: 'sad', actions: [{ kind: 'op', product_id: milk.id, op: { type: 'out' } }] });
    const r = (await call(michal, 'POST', '/api/chat', { text: 'נגמר החלב' })).data;
    const a = (await call(michal, 'POST', `/api/proposals/${r.proposal.id}/apply`, {})).data;
    assert.deepEqual(a.notify?.map((n) => n.body), ['חלב 3%']);
  });

  await check('F5', 'אבי עצמו מוסיף לרשימה: אין התראה לאף אחד', async () => {
    const r = (await act(avi, [{ kind: 'list_add', text: 'מסטיק' }])).data;
    assert.equal(r.notify.length, 0);
  });

  await check('F6', 'בלי מצב קניות פתוח, הוספה לא שולחת התראות', async () => {
    const r = (await act(avi, [{ kind: 'list_add', text: 'גפרורים' }])).data; // Avi adds, Michal isn't shopping
    assert.equal(r.notify.length, 0);
  });

  await check('F7', '"סיימתי קנייה" סוגר את מצב הקניות ומיכל מקבלת סיכום', async () => {
    const s = await state(avi);
    const milkItem = s.list.find((i) => i.product_id === s.products.find((p) => p.name === 'חלב 3%').id);
    const bamba = s.list.find((i) => i.text === 'במבה');
    await act(avi, [{ kind: 'check', item_id: milkItem.id, amount: 2 }, { kind: 'check', item_id: bamba.id }], { context: 'shopping' });
    const r = (await act(avi, [{ kind: 'finish' }], { context: 'shopping' })).data;
    assert.deepEqual(r.notify.map((n) => n.to), ['מיכל']); assert.match(r.notify[0].title, /אבי סיים קניות/); assert.match(r.notify[0].body, /^מהרשימה: במבה וחלב 3%/); // the per-trip summary (26/09) replaced "2 items updated"
    assert.equal((await state(michal)).shopping.length, 0);
    return r.notify[0].body;
  });

  await check('F8', 'מיכל "סיימתי קניות" בצ׳אט בלי מצב פתוח: לא קורס ולא שולח', async () => {
    script.push({ reply: 'סגרתי', face: 'happy', shopping: 'end' });
    const r = (await call(michal, 'POST', '/api/chat', { text: 'סיימתי קניות' })).data;
    assert.equal(r.shopping, 'end'); assert.equal(r.notify.length, 0);
  });

  await check('F9', 'מצב קניות שנשכח פתוח נסגר מעצמו אחרי 6 שעות (החלטה 29)', async () => {
    await call(michal, 'POST', '/api/shopping', { on: true, store: 'pharm' });
    assert.equal((await state(avi)).shopping[0].store, 'pharm');
    d1(`UPDATE shopping SET started = started - ${5 * 3600e3} WHERE ended IS NULL`);
    assert.equal((await state(avi)).shopping.length, 1, 'still open after 5 hours');
    d1(`UPDATE shopping SET started = started - ${3600e3 + 60e3} WHERE ended IS NULL`);
    assert.equal((await state(avi)).shopping.length, 0);
    const r = (await act(michal, [{ kind: 'list_add', text: 'שקיות' }])).data;
    assert.equal(r.notify.length, 0, 'the forgotten trip no longer gets alerts');
  });

  await check('F10', 'שוקי לומד: אחרי שני סבבים של קנייה→נגמר הוא יודע את הקצב ומציע לפני שנגמר', async () => {
    const c = await P('קוטג׳');
    const now = Date.now();
    const at = (d) => now - d * DAY;
    // bought 6 days ago, ran out 4 days ago; bought 3.9 days ago, ran out 1.9 days ago; bought 1.8 days ago
    await act(avi, [{ kind: 'op', product_id: c.id, op: { type: 'out' } }], { ts: at(6.5) });
    await act(avi, [{ kind: 'op', product_id: c.id, op: { type: 'purchase', amount: 1 } }], { ts: at(6) });
    await act(avi, [{ kind: 'op', product_id: c.id, op: { type: 'out' } }], { ts: at(4) });
    await act(avi, [{ kind: 'op', product_id: c.id, op: { type: 'purchase', amount: 1 } }], { ts: at(3.9) });
    await act(avi, [{ kind: 'op', product_id: c.id, op: { type: 'out' } }], { ts: at(1.9) });
    await act(avi, [{ kind: 'op', product_id: c.id, op: { type: 'purchase', amount: 1 } }], { ts: at(1.8) });
    const s = await state(avi);
    const p = s.products.find((x) => x.id === c.id);
    assert.equal(p.learned?.every, 2);
    assert.ok(s.soon.some((x) => x.id === c.id), `soon: ${JSON.stringify(s.soon)}`);
    script.push({ reply: 'ok', face: 'happy' });
    await call(avi, 'POST', '/api/chat', { text: 'מה לקנות?' });
    assert.match(calls.at(-1).system[2].text, /קוטג׳\|.*נגמר בדרך כלל כל ~2 ימים; עוד יש בבית, צפוי להיגמר/);
    return `קצב ${p.learned.every} ימים, ${s.soon.length} בהצעות`;
  });

  await check('F11', 'מה שכבר ברשימה לא מוצע שוב, וביטול מוחק גם את הלמידה', async () => {
    const c = await P('קוטג׳');
    await act(avi, [{ kind: 'list_add', product_id: c.id }]);
    assert.ok(!(await state(avi)).soon.some((x) => x.id === c.id));
    const before = (await P('קוטג׳')).learned;
    await act(avi, [{ kind: 'op', product_id: c.id, op: { type: 'out' } }]);
    await call(avi, 'POST', '/api/undo');
    assert.deepEqual((await P('קוטג׳')).learned, before);
    assert.equal(d1(`SELECT COUNT(*) AS n FROM product_log WHERE product_id = ${c.id}`)[0].n, 6);
  });

  await check('F12', 'שוקי גדל, יום אחר יום (16/10): יום עם עדכון נותן נקודה, עוד עדכון באותו יום לא, סגירת קנייה עוד נקודה, זריקה לא', async () => {
    d1(`UPDATE events SET ts = ts - 400 * 86400000 WHERE ts > ${Date.now() - 20 * 3600e3}`); // today starts empty: what was done today is one day long ago
    const g0 = (await state(avi)).growth;
    const n = await P('חלב 3%');
    await act(avi, [{ kind: 'op', product_id: n.id, op: { type: 'use', amount: 1 } }]);
    assert.equal((await state(avi)).growth.xp, g0.xp + 1, 'the first update today');
    await act(avi, [{ kind: 'op', product_id: n.id, op: { type: 'use', amount: 1 } }]);
    assert.equal((await state(avi)).growth.xp, g0.xp + 1, 'a second update the same day');
    await act(avi, [{ kind: 'op', product_id: n.id, op: { type: 'discard', amount: 1 } }]);
    assert.equal((await state(avi)).growth.xp, g0.xp + 1, 'waste gives nothing');
    await act(avi, [{ kind: 'finish' }]);
    const g = (await state(avi)).growth;
    assert.equal(g.xp, g0.xp + 2, 'a finished trip: one more');
    assert.equal(g.level, g.xp >= 14 ? 4 : g.xp >= 7 ? 3 : g.xp >= 3 ? 2 : 1); // days: 3, 7, 14 …
    return `${g.xp} נקודות, רמה ${g.level} (${g.name})`;
  });
} catch (e) { console.error('harness:', e.message, log.slice(-1500)); }
finally {
  writeFileSync(new URL('./features-results.json', import.meta.url), JSON.stringify(results, null, 1));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} feature checks passed`);
  try { process.kill(-dev.pid, 'SIGKILL'); } catch { /* gone */ }
  mock.close(); setTimeout(() => process.exit(0), 300);
}
