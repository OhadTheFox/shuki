// "קניתי 10 ביצים" is ten eggs, not ten trays (the owner 04/10, measurement 4ב #2): a number followed by the plural of the
// product's name or of a unit word is units of something counted in packages; anything else (a package word, the singular,
// no clear match) stays packages, as before. In the server only.
// On the Node server with a fake model that answers as the real one did (amount = the number said).
// Run: node --disable-warning=ExperimentalWarning test/packunits.itest.js
import './fetch-retry.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DIR = '/tmp/shuki-test/shuki-packunits'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const PORT = 8741, MOCK = 8742;
const db = new DatabaseSync(`${DIR}/shuki.db`);
db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) { db.exec(readFileSync(`migrations/${f}`, 'utf8')); db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f); }
db.exec(readFileSync('test/fixture-house.sql', 'utf8'));
db.exec("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999)");
db.exec("INSERT INTO products (id, name, count_type, unit, pack_size, qty, is_basic, created, updated) VALUES (901, 'ביצים', 'pack', NULL, 12, 0, 0, 1, 1), (902, 'נייר טואלט', 'pack', NULL, 32, 0, 0, 1, 1), (903, 'חלב 3%', 'units', 'קרטון', NULL, 1, 0, 1, 1), (904, 'מים', 'pack', NULL, 6, 0, 0, 1, 1), (905, 'טישו', 'pack', NULL, 3, 0, 0, 1, 1), (906, 'יוגורט', 'pack', NULL, 4, 0, 0, 1, 1), (907, 'עגבניות', 'units', NULL, NULL, 0, 0, 1, 1), (908, 'מגבונים', 'pack', NULL, 72, 0, 0, 1, 1), (909, 'חיתולים', 'pack', NULL, 40, 0, 0, 1, 1), (910, 'קפסולות', 'pack', NULL, 10, 0, 0, 1, 1), (911, 'בירה', 'pack', NULL, 6, 0, 0, 1, 1), (912, 'סוללות', 'pack', NULL, 4, 0, 0, 1, 1), (913, 'קולה', 'pack', NULL, 6, 0, 0, 1, 1)");
db.close();

let answer = () => ({ reply: 'בסדר.', face: 'happy' });
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => {
  const body = JSON.parse(Buffer.concat(parts).toString('utf8')); // bytes first (question 29)
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'tool_use', name: body.tools?.[0]?.name || 'respond', input: answer(body) }], usage: { input_tokens: 1, output_tokens: 1 } }));
}); }).listen(MOCK, '127.0.0.1');
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/node.js'], { env: { ...process.env, PORT: String(PORT), DB_PATH: `${DIR}/shuki.db`, ANTHROPIC_API_KEY: 't', ANTHROPIC_URL: `http://127.0.0.1:${MOCK}/v1/messages`, TEST_RESET: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
const call = async (t, m, p, b) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const x = await r.text(); let data; try { data = JSON.parse(x); } catch { data = x; } return { status: r.status, data }; };
const sql = (q, ...a) => { const d = new DatabaseSync(`${DIR}/shuki.db`); try { return /^\s*select/i.test(q) ? d.prepare(q).all(...a) : d.prepare(q).run(...a); } finally { d.close(); } };
const qty = (id) => sql('SELECT qty FROM products WHERE id = ?', id)[0].qty;
const results = [];
async function check(id, name, fn) {
  try { await fn(); results.push({ id, ok: true }); console.log('✓', id, name); }
  catch (e) { results.push({ id, ok: false }); console.log('✗', id, name, '\n   ', e.message.slice(0, 500)); }
}
let avi;
// what the model answered in 4ב: the number as said, as a purchase
const buy = async (text, ops) => {
  sql('UPDATE chat SET ts = ts - 3600e3'); // not 30 a minute
  answer = () => ({ reply: 'לסמן?', face: 'happy', actions: ops.map(([pid, amount]) => ({ kind: 'op', product_id: pid, op: { type: 'purchase', amount } })) });
  const r = (await call(avi, 'POST', '/api/chat', { text })).data;
  assert.ok(r.proposal, JSON.stringify(r).slice(0, 300));
  const ap = await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
  assert.equal(ap.status, 200, JSON.stringify(ap.data));
  return r.proposal.lines.map((l) => l.text);
};
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  avi = (await call(null, 'POST', '/api/pair', { code: '111111' })).data.token;

  await check('U1', '"קניתי 10 ביצים": עשר ביצים, לא עשר אריזות; והכרטיס אומר עשר ביצים', async () => {
    sql('UPDATE products SET qty = 0 WHERE id = 901');
    const lines = await buy('קניתי 10 ביצים', [[901, 10]]);
    assert.equal(qty(901), 10);
    assert.ok(!/אריז/.test(lines.join(' ')) && /10/.test(lines.join(' ')), JSON.stringify(lines));
  });
  await check('U2', '"קניתי 2 קרטוני ביצים": שתי אריזות, 24', async () => {
    sql('UPDATE products SET qty = 0 WHERE id = 901');
    await buy('קניתי 2 קרטוני ביצים', [[901, 2]]);
    assert.equal(qty(901), 24);
  });
  await check('U3', 'הודעה #2 מהמדידה, "קניתי 2 קרטוני חלב 3% ו-10 ביצים": חלב 2 (לא באריזות), ביצים 10', async () => {
    sql('UPDATE products SET qty = 0 WHERE id IN (901, 903)');
    await buy('קניתי 2 קרטוני חלב 3% ו-10 ביצים', [[903, 2], [901, 10]]);
    assert.equal(qty(903), 2, 'milk');
    assert.equal(qty(901), 10, 'eggs');
  });
  await check('U4', 'נייר טואלט (32 באריזה): "קניתי 32 גלילים" הם 32; "קניתי חבילה" היא 32', async () => {
    sql('UPDATE products SET qty = 0 WHERE id = 902');
    await buy('קניתי 32 גלילים', [[902, 32]]);
    assert.equal(qty(902), 32, '32 rolls');
    sql('UPDATE products SET qty = 0 WHERE id = 902');
    await buy('קניתי חבילה', [[902, 1]]);
    assert.equal(qty(902), 32, 'a pack');
  });
  await check('U5', 'מילות אריזה שלא ברשימה נשארות אריזות (הבודק): "2 ארגזי מים" 12, "2 קופסאות טישו" 6, "2 תריסר ביצים" 24, "2 חב׳ ביצים" 24', async () => {
    const bad = [];
    for (const [text, pid, n, want] of [['קניתי 2 ארגזי מים', 904, 2, 12], ['קניתי 2 קופסאות טישו', 905, 2, 6], ['קניתי 2 תריסר ביצים', 901, 2, 24], ['קניתי 2 חב׳ ביצים', 901, 2, 24]]) {
      sql('UPDATE products SET qty = 0 WHERE id = ?', pid); await buy(text, [[pid, n]]); if (qty(pid) !== want) bad.push(`${text}: ${qty(pid)}, expected ${want}`);
    }
    assert.deepEqual(bad, []);
  });
  await check('U6', '"קניתי 2 עגבניות ו-2 חבילות יוגורטים": יוגורט 8 (ה-2 של העגבניות לא שלו)', async () => {
    sql('UPDATE products SET qty = 0 WHERE id IN (906, 907)');
    await buy('קניתי 2 עגבניות ו-2 חבילות יוגורטים', [[907, 2], [906, 2]]);
    assert.equal(qty(906), 8, 'yogurt'); assert.equal(qty(907), 2, 'tomatoes');
  });
  await check('U7', 'רבים מול יחיד (the owner, (ב)): "4 יוגורטים" 4; "4 יוגורט" 16; "2 נייר טואלט" שתי חבילות, 64', async () => {
    const bad = [];
    for (const [text, pid, n, want] of [['קניתי 4 יוגורטים', 906, 4, 4], ['קניתי 4 יוגורט', 906, 4, 16], ['קניתי 2 נייר טואלט', 902, 2, 64]]) {
      sql('UPDATE products SET qty = 0 WHERE id = ?', pid); await buy(text, [[pid, n]]); if (qty(pid) !== want) bad.push(`${text}: ${qty(pid)}, expected ${want}`);
    }
    assert.deepEqual(bad, []);
  });
  await check('U8', 'בעגלה: "קניתי 10 ביצים" בזמן קניות, ואז הוצאה מהעגלה: המלאי חוזר למה שהיה (10, לא 12)', async () => {
    sql('UPDATE products SET qty = 5 WHERE id = 901'); sql('DELETE FROM list_items WHERE product_id = 901');
    await call(avi, 'POST', '/api/actions', { actions: [{ kind: 'list_add', product_id: 901 }] });
    sql('UPDATE chat SET ts = ts - 3600e3'); answer = () => ({ reply: 'בהצלחה!', face: 'happy', shopping: 'start', store: 'super' });
    await call(avi, 'POST', '/api/chat', { text: 'אני בסופר' });
    await buy('קניתי 10 ביצים', [[901, 10]]);
    assert.equal(qty(901), 15, 'bought');
    const line = sql("SELECT id, status, bought_units FROM list_items WHERE product_id = 901 AND status = 'checked'")[0];
    assert.ok(line, 'not in the cart'); assert.equal(line.bought_units, 10, 'bought_units');
    await call(avi, 'POST', '/api/actions', { actions: [{ kind: 'uncheck', item_id: line.id }] });
    assert.equal(qty(901), 5, 'out of the cart');
  });
  await check('U9', 'קנייה לאירוח ביחידות: בכרטיס "לא אלמד מזה כל כמה זמן נגמר", כמו בשורה של אריזות', async () => {
    sql('UPDATE chat SET ts = ts - 3600e3');
    answer = () => ({ reply: 'לסמן?', face: 'happy', actions: [{ kind: 'op', product_id: 901, op: { type: 'purchase', amount: 30, event: true, reason: 'hosting' } }] });
    const r = (await call(avi, 'POST', '/api/chat', { text: 'קנינו 30 ביצים לאירוח' })).data;
    const l = r.proposal?.lines?.[0] || {};
    assert.ok(/30 ביצים/.test(l.text) && /לא אלמד/.test(l.detail || ''), JSON.stringify(l));
  });
  await check('U10', 'שם שכבר ברבים, פחות מרבע אריזה: אריזות, כמו לפני (הבודק, the owner (א)): "3 מגבונים" 216, "2 חיתולים" 80, "2 קפסולות" 20; מרבע ומעלה יחידות: "10 ביצים" 10, "6 ביצים" 6, "4 יוגורטים" 4', async () => {
    const bad = [];
    for (const [text, pid, n, want] of [['קניתי 3 מגבונים', 908, 3, 216], ['קניתי 2 חיתולים', 909, 2, 80], ['קניתי 2 קפסולות', 910, 2, 20], ['קניתי 10 ביצים', 901, 10, 10], ['קניתי 6 ביצים', 901, 6, 6], ['קניתי 4 יוגורטים', 906, 4, 4]]) {
      sql('UPDATE products SET qty = 0 WHERE id = ?', pid); await buy(text, [[pid, n]]); if (qty(pid) !== want) bad.push(`${text}: ${qty(pid)}, expected ${want}`);
    }
    assert.deepEqual(bad, []);
  });
  await check('U11', '"בקבוקי" ו"גלילי" עם המוצר מיד אחריהן: יחידות (the owner): "6 בקבוקי מים" 6, "24 בקבוקי בירה" 24', async () => {
    const bad = [];
    for (const [text, pid, n, want] of [['קניתי 6 בקבוקי מים', 904, 6, 6], ['קניתי 24 בקבוקי בירה', 911, 24, 24]]) {
      sql('UPDATE products SET qty = 0 WHERE id = ?', pid); await buy(text, [[pid, n]]); if (qty(pid) !== want) bad.push(`${text}: ${qty(pid)}, expected ${want}`);
    }
    assert.deepEqual(bad, []);
  });
  // stage 9, מ33 (decision 3; stage 8's question 49): pack words, numbers in words, a price, a hyphen, a big buy in units
  await check('U12', 'מ33: "קניתי 2 חבילות סוללות" (4 באריזה) = 8; "קניתי שישייה מים" = 6; "קניתי 2 סוללות" = 2', async () => {
    const bad = [];
    for (const [text, pid, n, want] of [['קניתי 2 חבילות סוללות', 912, 2, 8], ['קניתי שישייה מים', 904, 1, 6], ['קניתי 2 סוללות', 912, 2, 2]]) {
      sql('UPDATE products SET qty = 0 WHERE id = ?', pid); await buy(text, [[pid, n]]); if (qty(pid) !== want) bad.push(`${text}: ${qty(pid)}, expected ${want}`);
    }
    assert.deepEqual(bad, []);
  });
  await check('U13', 'מ33: "עשר ביצים" = 10, "תריסר ביצים" = 12, "חצי תריסר ביצים" = 6; "קניתי ביצים ב-10" לא עשר אריזות (אריזה אחת)', async () => {
    const bad = [];
    for (const [text, n, want] of [['קניתי עשר ביצים', 10, 10], ['קניתי תריסר ביצים', 12, 12], ['קניתי חצי תריסר ביצים', 6, 6], ['קניתי ביצים ב-10', 10, 12]]) {
      sql('UPDATE products SET qty = 0 WHERE id = 901'); await buy(text, [[901, n]]); if (qty(901) !== want) bad.push(`${text}: ${qty(901)}, expected ${want}`);
    }
    assert.deepEqual(bad, []);
  });
  await check('U14', 'מ33: "קניתי 10-ביצים" = 10', async () => {
    sql('UPDATE products SET qty = 0 WHERE id = 901'); await buy('קניתי 10-ביצים', [[901, 10]]); assert.equal(qty(901), 10);
  });
  await check('U15', 'מ33: "30 ביצים" מול רשימה של אריזה אחת: לא קנייה גדולה (נלמד, כמו כל קנייה)', async () => {
    sql('UPDATE products SET qty = 0 WHERE id = 901'); sql('DELETE FROM list_items WHERE product_id = 901');
    await call(avi, 'POST', '/api/actions', { actions: [{ kind: 'list_add', product_id: 901 }] });
    const n = sql("SELECT COUNT(*) AS n FROM product_log WHERE product_id = 901 AND kind = 'purchase'")[0].n;
    await buy('קניתי 30 ביצים', [[901, 30]]);
    assert.equal(qty(901), 30);
    assert.equal(sql("SELECT COUNT(*) AS n FROM product_log WHERE product_id = 901 AND kind = 'purchase'")[0].n, n + 1, 'taken for a big buy (event)');
  });
  await check('U16', 'מ33: "קניתי מים ו-6 בקבוקים קולה": הקולה 6, והמים לא מקבלים את 6 היחידות של הקולה', async () => {
    sql('UPDATE products SET qty = 0 WHERE id IN (904, 913)');
    // the model put the 6 on the water too: the unit word goes with the cola named after it, not with the water
    await buy('קניתי מים ו-6 בקבוקים קולה', [[904, 6], [913, 6]]);
    assert.equal(qty(913), 6, 'cola'); assert.notEqual(qty(904), 6, 'the water got the cola\'s 6 units');
  });
  await check('U17', 'מ33: סיום קניות אחרי "10 ביצים" מול 2 אריזות ברשימה: אריזה אחת חוזרת לרשימה', async () => {
    sql('UPDATE products SET qty = 0 WHERE id = 901'); sql('DELETE FROM list_items WHERE product_id = 901');
    await call(avi, 'POST', '/api/actions', { actions: [{ kind: 'list_add', product_id: 901, amount: 2 }] });
    sql('UPDATE chat SET ts = ts - 3600e3'); answer = () => ({ reply: 'בהצלחה!', face: 'happy', shopping: 'start', store: 'super' });
    await call(avi, 'POST', '/api/chat', { text: 'אני בסופר' });
    await buy('קניתי 10 ביצים', [[901, 10]]);
    await call(avi, 'POST', '/api/actions', { actions: [{ kind: 'finish', store: 'super' }] });
    const open = sql("SELECT want FROM list_items WHERE product_id = 901 AND status = 'open'");
    assert.equal(open.length, 1, JSON.stringify(sql('SELECT status, want, bought_qty FROM list_items WHERE product_id = 901'))); assert.equal(open[0].want, 1);
  });
} finally {
  srv.kill(); mock.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} pack-unit checks passed`);
if (failed.length) { console.log(log.split('\n').filter((l) => /error|Error/.test(l)).slice(-8).join('\n')); process.exit(1); }
