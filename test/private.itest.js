// Stage 0b, part 3: a private product (docs/stage0-0b-proposal.md §3; the owner 01/10: only who added it sees it, everywhere).
// On the Node server with a fake model. Michal adds condoms; Avi (the admin) and Yoavi (a child) never see them: not in
// the state, the journal, the gray lines, the prompt, a download, a CSV, a push, a trip's summary or 👎's copy.
// Run: node --disable-warning=ExperimentalWarning test/private.itest.js
import './fetch-retry.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SECRET_ALLOWED } from '../worker/secret.js';

const DIR = '/tmp/shuki-test/shuki-private'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const PORT = 8781, MOCK = 8782;
const SECRET = 'קונדומים';

const db = new DatabaseSync(`${DIR}/shuki.db`);
db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) { db.exec(readFileSync(`migrations/${f}`, 'utf8')); db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f); }
db.exec(readFileSync('test/fixture-house.sql', 'utf8'));
db.exec("INSERT INTO users (id, name, gender, role, active, created) VALUES (3, 'יואבי', 'm', 'child', 1, 0)");
db.exec("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999), ('222222', 2, 9999999999999), ('333333', 3, 9999999999999)");
db.exec("INSERT INTO products (id, name, count_type, qty, is_basic, target, created, updated) VALUES (7, 'חלב', 'units', 0, 1, 1, 1, 1)");
db.close();

let answer = () => ({ reply: 'אני פה!', face: 'happy' });
const requests = [];
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { const b = Buffer.concat(parts).toString('utf8'); // bytes first: a Hebrew letter can be split between chunks (question 29)

  const body = JSON.parse(b); requests.push(body);
  const input = answer(body);
  if (input?.__status) { res.writeHead(input.__status, { 'content-type': 'application/json' }); res.end('{"error":{"type":"invalid_request_error","message":"fake"}}'); return; } // the model fails (P40)
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'tool_use', name: body.tools?.[0]?.name || 'respond', input }], usage: { input_tokens: 1, output_tokens: 1 } }));
}); }).listen(MOCK, '127.0.0.1');
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/node.js'], { env: { ...process.env, PORT: String(PORT), DB_PATH: `${DIR}/shuki.db`, ANTHROPIC_API_KEY: 't', ANTHROPIC_URL: `http://127.0.0.1:${MOCK}/v1/messages`, TEST_RESET: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
const call = async (t, m, p, b) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const x = await r.text(); let data; try { data = JSON.parse(x); } catch { data = x; } return { status: r.status, data }; };
const sql = (q, ...a) => { const d = new DatabaseSync(`${DIR}/shuki.db`); try { return /^\s*select/i.test(q) ? d.prepare(q).all(...a) : d.prepare(q).run(...a); } finally { d.close(); } };
const results = [];
async function check(id, name, fn) {
  try { await fn(); results.push({ id, ok: true }); console.log('✓', id, name); }
  catch (e) { results.push({ id, ok: false }); console.log('✗', id, name, '\n   ', e.message.slice(0, 500)); }
}
const say = async (t, text) => (await call(t, 'POST', '/api/chat', { text })).data;
const state = async (t) => (await call(t, 'GET', '/api/state')).data;
const apply = (t, id, b = {}) => call(t, 'POST', `/api/proposals/${id}/apply`, b);
const act = (t, actions, extra = {}) => call(t, 'POST', '/api/actions', { actions, ...extra });
// a time in the house's zone (Asia/Jerusalem), `days` from today, at `hour`:05
const local = (days, hour) => { const z = (ts) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }).format(ts));
  // the day in Jerusalem, not in UTC: between midnight and 3 in Israel the UTC date is still yesterday's; and calendar days, since 24 hours aren't a day across DST (stage 5, 05/10)
  const [y, mo, dd] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(Date.now()).split('-').map(Number); let ts = Date.UTC(y, mo - 1, dd + days, hour, 5); ts -= (z(ts) - hour) * 3600e3; return ts; };
const pid = (name) => sql('SELECT id FROM products WHERE name = ?', name)[0]?.id;

let avi, michal, yoavi;
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  [avi, michal, yoavi] = await Promise.all(['111111', '222222', '333333'].map(async (code) => (await call(null, 'POST', '/api/pair', { code })).data.token));
  // every phone can get pushes (nothing leaves the server without VAPID keys; what would be sent comes back)
  sql(`UPDATE devices SET push_sub = '{"endpoint":"http://127.0.0.1:${MOCK}/push","keys":{"p256dh":"x","auth":"y"}}', push_on = 1`);

  await check('P1', 'כרטיס מהצ\'אט: קונדומים פרטיים בלי שהמודל סימן; D8 מתחת לשורה; כרטיס מעורב = שני אירועים, אחד פרטי', async () => {
    answer = () => ({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'create', product: { name: SECRET, qty: 0 } }, { kind: 'list_add', text: SECRET }, { kind: 'list_add', product_id: 7 }] });
    const r = await say(michal, 'צריך קונדומים וחלב');
    assert.ok(r.proposal, JSON.stringify(r));
    const lines = r.proposal.lines.map((l) => l.detail || '');
    assert.ok(lines.some((d) => d.includes('רק את תראי את המוצר הזה.')), JSON.stringify(r.proposal.lines));
    assert.ok(!r.proposal.lines.find((l) => /חלב/.test(l.text))?.detail?.includes('רק את'), 'milk is shared');
    const ap = await apply(michal, r.proposal.id); assert.equal(ap.status, 200, JSON.stringify(ap.data));
    assert.deepEqual(sql('SELECT private_to FROM list_items WHERE text = ?', SECRET).map((x) => x.private_to), [2]);
    assert.equal(sql('SELECT private_to FROM list_items WHERE product_id = 7')[0].private_to, null);
    // added from the app as a product: private too, and the list line becomes that product's, still private
    const c = await act(michal, [{ kind: 'create', product: { name: SECRET, qty: 2 } }]); assert.equal(c.status, 200, JSON.stringify(c.data));
    assert.equal(sql('SELECT private_to FROM products WHERE id = ?', pid(SECRET))[0].private_to, 2);
    const ev = sql("SELECT summary, private_to FROM events WHERE user_id = 2 ORDER BY ts, id");
    assert.ok(ev.some((e) => e.private_to === 2 && e.summary.includes(SECRET)), JSON.stringify(ev));
    assert.ok(ev.some((e) => e.private_to === null && /חלב/.test(e.summary) && !e.summary.includes(SECRET)), JSON.stringify(ev));
  });

  await check('P2', 'המצב (מלאי, רשימה, יומן): אבי ויואבי לא רואים; מיכל רואה', async () => {
    for (const t of [avi, yoavi]) {
      const s = JSON.stringify(await state(t));
      assert.ok(!s.includes(SECRET), 'leaked to someone else');
    }
    const m = await state(michal);
    assert.ok(m.products.some((p) => p.name === SECRET));
    assert.ok(m.journal.some((j) => j.summary.includes(SECRET)));
  });

  await check('P3', 'שורה אפורה בצ\'אט של אבי: חלב כן, קונדומים לא', async () => {
    const s = JSON.stringify((await call(avi, 'GET', '/api/chat')).data.messages);
    assert.match(s, /מיכל הוסיפה לרשימה חלב/);
    assert.ok(!s.includes(SECRET));
  });

  await check('P4', 'הפרומפט: לא אצל אבי; אצל מיכל רק אחרי החלק שבמטמון', async () => {
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await say(avi, 'מה ברשימה?');
    { const q = requests.at(-1); const j = JSON.stringify([q.messages, q.system.slice(1)]); const k = j.indexOf(SECRET); assert.ok(k < 0, `in Avi's prompt: ${j.slice(Math.max(0, k - 300), k + 100)}`); }
    await say(michal, 'מה ברשימה?');
    const sys = requests.at(-1).system;
    const cachedEnd = sys.findLastIndex((b) => b.cache_control);
    assert.ok(!JSON.stringify(sys.slice(1, cachedEnd + 1)).includes(SECRET), 'in the cached part'); // [0] is the instructions, which name the private list
    assert.ok(JSON.stringify(sys.slice(cachedEnd + 1)).includes(SECRET), 'Michal\'s own prompt lost it');
  });

  await check('P5', 'הורדה ו-CSV של אבי: בלי; של מיכל: עם', async () => {
    for (const p of ['/api/export', '/api/export.csv?what=inventory', '/api/export.csv?what=history']) {
      assert.ok(!JSON.stringify((await call(avi, 'GET', p)).data).includes(SECRET), `Avi ${p}`);
    }
    assert.ok(JSON.stringify((await call(michal, 'GET', '/api/export')).data).includes(SECRET), 'Michal\'s own download');
    sql("INSERT INTO maybe (text, product_id, store, added_by, added, kind, private_to) VALUES ('טסט הריון', NULL, 'super', 2, 0, 'remind', 2)"); // as the app writes it now (private_to, migration 0024)
    assert.ok(!JSON.stringify((await call(avi, 'GET', '/api/export')).data).includes('טסט הריון'), 'Michal\'s reminder in Avi\'s download');
    assert.ok(!JSON.stringify(await state(avi)).includes('טסט הריון'), 'and in his state');
  });

  await check('P6', '👎 של מיכל: מה שנשמר בלי המוצר הפרטי', async () => {
    const row = sql("SELECT id FROM chat WHERE role = 'shuki' AND thread = 2 ORDER BY id DESC LIMIT 1")[0];
    assert.equal((await call(michal, 'POST', '/api/feedback', { chat_id: row.id, note: 'לא טוב' })).status, 200);
    const f = sql('SELECT state FROM feedback ORDER BY id DESC LIMIT 1')[0];
    // no copy of the catalog at all now (r11 q022, r0t p3), so nothing private in it either
    assert.equal(f?.state, '', 'the copy of the catalog'); assert.ok(!JSON.stringify(sql('SELECT * FROM feedback ORDER BY id DESC LIMIT 1')).includes(SECRET));
    // and Avi's download carries no one else's 👎 (it quotes their chat)
    assert.ok(!JSON.stringify((await call(avi, 'GET', '/api/export')).data).includes('לא טוב'), 'Michal\'s 👎 in Avi\'s download');
  });

  await check('P7', 'כל דרך שמוסיפה: MCP של אבי ("בדיקת הריון"), ומהאפליקציה של מיכל ("חומר סיכה"); דאודורנט רגיל לא', async () => {
    const conn = (await call(avi, 'POST', '/api/connectors', { name: 'Claude' })).data.path;
    await call(null, 'POST', conn, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'add_to_list', arguments: { items: [{ name: 'בדיקת הריון' }] } } });
    assert.deepEqual(sql("SELECT private_to FROM list_items WHERE text = 'בדיקת הריון'").map((x) => x.private_to), [1]);
    await act(michal, [{ kind: 'list_add', text: 'חומר סיכה' }, { kind: 'list_add', text: 'דאודורנט' }]);
    assert.deepEqual(sql("SELECT text, private_to FROM list_items WHERE text IN ('חומר סיכה', 'דאודורנט') ORDER BY text").map((x) => [x.text, x.private_to]), [['דאודורנט', null], ['חומר סיכה', 2]]);
    assert.ok(!JSON.stringify(await state(michal)).includes('בדיקת הריון'));
    assert.ok(!JSON.stringify(await state(avi)).includes('חומר סיכה'));
  });

  await check('P8', 'מה שהכותב ביקש במפורש (private) פרטי; "שלי" בלי בקשה לא', async () => {
    answer = () => ({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'list_add', text: 'מתנה לאבי', private: true }, { kind: 'list_add', text: 'שמפו' }] });
    const r = await say(michal, 'תוסיף מתנה לאבי, שהוא לא יראה, ושמפו שלי');
    await apply(michal, r.proposal.id);
    assert.deepEqual(sql("SELECT text, private_to FROM list_items WHERE text IN ('מתנה לאבי', 'שמפו') ORDER BY text").map((x) => [x.text, x.private_to]), [['מתנה לאבי', 2], ['שמפו', null]]);
  });

  await check('P9', 'ילד שמוסיף בדיקת הריון: לא פרטי, מחכה לאישור, וההורה רואה (הכרעה 4)', async () => {
    await act(yoavi, [{ kind: 'list_add', text: 'בדיקת הריון לבית הספר' }]);
    const row = { ...sql("SELECT private_to, approved FROM list_items WHERE text = 'בדיקת הריון לבית הספר'")[0] };
    assert.deepEqual(row, { private_to: null, approved: 0 });
    assert.ok(JSON.stringify(await state(avi)).includes('בדיקת הריון לבית הספר'));
  });

  await check('P10', 'התראות: מיכל מוסיפה כשאבי בקניות; רק המשותף מגיע אליו. סוף קניות של מיכל: בלי הפרטי', async () => {
    await call(avi, 'POST', '/api/shopping', { store: 'super' });
    const a = await act(michal, [{ kind: 'list_add', text: 'ויאגרה' }]);
    assert.deepEqual(a.data.notify, [], JSON.stringify(a.data.notify));
    const b = await act(michal, [{ kind: 'list_add', text: 'לחם' }]);
    assert.ok(b.data.notify.some((n) => n.to === 'אבי' && /לחם/.test(n.body)), JSON.stringify(b.data.notify));
    await call(avi, 'POST', '/api/shopping', { on: false });
    await call(michal, 'POST', '/api/shopping', { store: 'super' });
    const items = sql("SELECT i.id FROM list_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.status = 'open' AND (p.name IN (?, 'חלב') OR i.text IN ('לחם', 'ויאגרה'))", SECRET).map((x) => x.id);
    assert.equal(items.length, 3, 'milk, bread and the private text line (the condoms line went when they were counted)');
    await act(michal, items.map((id) => ({ kind: 'check', item_id: id })));
    const f = await act(michal, [{ kind: 'finish', store: 'super' }]);
    const said = JSON.stringify([f.data.notify, f.data.trip, sql('SELECT summary FROM shopping WHERE user_id = 2')]);
    assert.ok(/חלב/.test(said), said);
    assert.ok(!said.includes(SECRET) && !said.includes('ויאגרה') && !said.includes('חומר סיכה'), said);
    assert.ok(!JSON.stringify((await state(avi)).lastTrip).includes(SECRET));
    const dl = JSON.stringify((await call(avi, 'GET', '/api/export')).data);
    assert.ok(!dl.includes(SECRET) && !dl.includes('ויאגרה'), 'Avi\'s download after the trip (the shared journal line keeps what was before)');
  });

  await check('P11', '20:00 ושבת: כל אחד מקבל רק מה שהוא רואה, ומוצר פרטי לא נשלח גם למי שהוא שלו (r7b, 06/10)', async () => {
    const s = pid(SECRET);
    sql('UPDATE products SET qty = 2, expires = ?, is_basic = 1, target = 5 WHERE id = ?', local(1, 12), s);
    sql('UPDATE products SET qty = 2, expires = ? WHERE id = 7', local(1, 12));
    const d = (await call(avi, 'POST', '/api/__schedule', { now: local(0, 20) })).data;
    assert.ok(d.digestFor, JSON.stringify(d).slice(0, 300));
    assert.ok(/חלב/.test(JSON.stringify(d.digestFor[1])) && !JSON.stringify(d.digestFor[1]).includes(SECRET), JSON.stringify(d.digestFor));
    assert.ok(/חלב/.test(JSON.stringify(d.digestFor[2])) && !JSON.stringify(d.digestFor[2]).includes(SECRET), `Michal's own: ${JSON.stringify(d.digestFor[2])}`);
    // Shabbat: both keep it; the basics missing are milk (shared) and condoms (Michal's)
    sql('UPDATE products SET qty = 0 WHERE id = 7');
    for (const [t, n] of [[avi, 'אני שומר שבת'], [michal, 'אני שומרת שבת']]) { answer = () => ({ reply: 'לא להתריע בשבת?', face: 'happy', actions: [{ kind: 'shabbat', on: true }] }); const r = await say(t, n); if (r.proposal) await apply(t, r.proposal.id); }
    const fri = [0, 1, 2, 3, 4, 5, 6].map((k) => local(k, 10)).find((ts) => new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short' }).format(ts) === 'Fri');
    const sh = (await call(avi, 'POST', '/api/__schedule', { now: fri })).data;
    assert.ok(sh.shabbatBodies, JSON.stringify(sh).slice(0, 300));
    assert.ok(/חלב/.test(sh.shabbatBodies[1]) && !sh.shabbatBodies[1].includes(SECRET), JSON.stringify(sh.shabbatBodies));
    assert.ok(/חלב/.test(sh.shabbatBodies[2]) && !sh.shabbatBodies[2].includes(SECRET), sh.shabbatBodies[2]);
  });

  await check('P12', 'כללים שהשרת כותב: דחייה של שורה פרטית לא נרשמת ב"שמתי לב"', async () => {
    answer = () => ({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'list_add', product_id: pid(SECRET) }] });
    for (let i = 0; i < 3; i++) { const r = await say(michal, 'עוד קונדומים?'); if (r.proposal) await apply(michal, r.proposal.id, { skip: [0] }); }
    assert.equal(sql("SELECT COUNT(*) AS n FROM noticed WHERE product_id = ?", pid(SECRET))[0].n, 0);
  });

  await check('P15', 'אותו שם אצל אחר: אבי יוצר "בדיקת הריון" משלו בלי לשמוע שיש כזה; יואבי מוסיף אותו בלי להתחבר למוצר של מיכל', async () => {
    await act(michal, [{ kind: 'create', product: { name: 'בדיקת הריון', qty: 1 } }]);
    assert.equal(sql("SELECT COUNT(*) AS n FROM list_items WHERE text = 'בדיקת הריון' AND private_to = 1")[0].n, 1, 'Michal\'s new product took Avi\'s private line (P7)');
    // Avi types a line Michal has privately: his own line, not "already on the list"
    await act(avi, [{ kind: 'list_add', text: 'מתנה לאבי' }]);
    assert.deepEqual(sql("SELECT private_to FROM list_items WHERE text = 'מתנה לאבי' ORDER BY private_to").map((x) => x.private_to), [null, 2]);
    const a = await act(avi, [{ kind: 'create', product: { name: 'בדיקת הריון', qty: 1 } }]);
    assert.equal(a.status, 200, JSON.stringify(a.data));
    assert.deepEqual(sql("SELECT private_to FROM products WHERE name = 'בדיקת הריון' AND deleted IS NULL ORDER BY private_to").map((x) => x.private_to), [1, 2]);
    await act(yoavi, [{ kind: 'list_add', text: 'בדיקת הריון' }]);
    const kid = sql("SELECT product_id, private_to, approved FROM list_items WHERE added_by = 3 AND text = 'בדיקת הריון'").map((x) => ({ ...x }));
    assert.deepEqual(kid, [{ product_id: null, private_to: null, approved: 0 }]);
  });

  await check('P16', 'קנייה קבועה של המוצר הפרטי של מיכל: השרת מוסיף, ושורת היומן שלה בלבד', async () => {
    const at = local(1, 7);
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short' }).format(at));
    sql("DELETE FROM list_items WHERE product_id = ?", pid(SECRET));
    sql("INSERT INTO routines (product_id, text, weekday, store, added_by, added) VALUES (?, NULL, ?, 'super', 2, 0)", pid(SECRET), (wd + 1) % 7);
    const r = (await call(avi, 'POST', '/api/__schedule', { now: at })).data;
    assert.equal(r.weeklyAdded, 1, JSON.stringify(r).slice(0, 200));
    const ev = sql("SELECT user_id, private_to FROM events WHERE summary LIKE ? ORDER BY ts DESC LIMIT 1", `%${SECRET}%`)[0];
    assert.equal(ev.private_to, 2, JSON.stringify(ev));
    assert.ok(!JSON.stringify(await state(avi)).includes(SECRET), 'Avi\'s state');
    assert.ok(!JSON.stringify((await call(avi, 'GET', '/api/chat')).data).includes(SECRET), 'Avi\'s gray lines');
  });

  await check('P17', 'ביטול של פעולה פרטית: גם שורת הביטול פרטית', async () => {
    await act(michal, [{ kind: 'op', product_id: pid(SECRET), op: { type: 'use', amount: 1 } }]);
    assert.equal((await call(michal, 'POST', '/api/undo', {})).status, 200);
    const u = sql("SELECT private_to FROM events WHERE type = 'undo' AND user_id = 2 ORDER BY ts DESC LIMIT 1")[0];
    assert.equal(u?.private_to, 2);
    assert.ok(!JSON.stringify((await state(avi)).journal).includes(SECRET));
  });

  await check('P18', 'פעולות לפי מספר: אבי מקבל על המוצר הפרטי של מיכל את מה שמקבלים על מוצר שלא קיים', async () => {
    const s = pid(SECRET);
    assert.equal((await call(michal, 'POST', `/api/photo/${s}`, { data: '/9j/AAAA' })).status, 200, 'her own photo');
    let r = await call(avi, 'GET', `/api/photo/${s}`);
    assert.deepEqual([r.status, r.data.error], [404, 'אין תמונה'], 'the photo');
    r = await call(avi, 'POST', `/api/photo/${s}`, { data: '/9j/BBBB' });
    assert.deepEqual([r.status, r.data.error], [404, 'מוצר לא נמצא'], 'replacing the photo');
    r = await call(avi, 'POST', '/api/low', { id: s, decision: 'remind' });
    assert.deepEqual([r.status, r.data.error], [404, 'מוצר לא נמצא'], '"a little left"');
    r = await act(avi, [{ kind: 'op', product_id: s, op: { type: 'use', amount: 1 } }]);
    assert.equal(r.data.error, 'המוצר הזה כבר לא במלאי', 'an action on the product');
    const line = sql("SELECT id FROM list_items WHERE private_to = 2 AND status = 'open' LIMIT 1")[0].id;
    r = await act(avi, [{ kind: 'list_remove', item_id: line }]);
    assert.equal(r.data.error, 'המוצר הזה כבר לא ברשימה', 'a private line');
    assert.equal(sql('SELECT COUNT(*) AS n FROM list_items WHERE id = ?', line)[0].n, 1);
    sql("INSERT INTO maybe (text, product_id, store, added_by, added) VALUES (?, ?, 'super', 2, 0)", SECRET, s);
    const m = sql('SELECT id FROM maybe WHERE product_id = ? ORDER BY id DESC LIMIT 1', s)[0].id;
    r = await call(avi, 'POST', '/api/maybe', { id: m, decision: 'drop' });
    assert.deepEqual([r.status, r.data.error], [404, 'מישהו כבר טיפל בזה'], '"let\'s think about it"');
    const rt = sql('SELECT id FROM routines WHERE product_id = ?', s)[0].id;
    assert.equal((await call(avi, 'POST', '/api/routines', { id: rt })).status, 200);
    assert.equal(sql('SELECT COUNT(*) AS n FROM routines WHERE id = ?', rt)[0].n, 1, 'her weekly buy');
  });

  await check('P19', 'יש מוצר משותף בשם מהרשימה הפרטית (ילד הוסיף): מיכל מקבלת מוצר פרטי נפרד, עם D8; "קניתי" שלה מעדכן רק אותו, ואבי לא רואה (02/10, 21 אפשרות (א))', async () => {
    await act(yoavi, [{ kind: 'create', product: { name: 'טסט הריון', qty: 0 } }]);
    const shared = sql("SELECT id, private_to FROM products WHERE name = 'טסט הריון'")[0];
    assert.equal(shared.private_to, null, 'a child\'s is shared');
    answer = () => ({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'list_add', product_id: shared.id }] });
    const r = await say(michal, 'צריך טסט הריון');
    assert.ok(r.proposal.lines.some((l) => (l.detail || '').includes('רק את תראי את המוצר הזה.')), JSON.stringify(r.proposal.lines));
    await apply(michal, r.proposal.id);
    const mine = sql("SELECT id, private_to FROM products WHERE name = 'טסט הריון' AND private_to = 2 AND deleted IS NULL");
    assert.equal(mine.length, 1, 'a separate private product');
    assert.deepEqual(sql('SELECT private_to FROM list_items WHERE product_id = ?', mine[0].id).map((x) => x.private_to), [2], 'its line');
    assert.equal(sql('SELECT COUNT(*) AS n FROM list_items WHERE product_id = ?', shared.id)[0].n, 0, 'the shared product went on the list');
    // "קניתי": the model picks the shared one; it goes to hers, and the shared one doesn't move
    const before = sql('SELECT qty, updated FROM products WHERE id = ?', shared.id)[0];
    await act(michal, [{ kind: 'op', product_id: shared.id, op: { type: 'purchase', amount: 1 } }]);
    assert.deepEqual({ ...sql('SELECT qty, updated FROM products WHERE id = ?', shared.id)[0] }, { ...before }, 'the shared one moved');
    assert.ok(sql('SELECT qty FROM products WHERE id = ?', mine[0].id)[0].qty > 0, 'hers did not');
    const aviState = JSON.stringify((await state(avi)).journal) + JSON.stringify((await call(avi, 'GET', '/api/chat')).data);
    assert.ok(!/מיכל (קנתה|הוסיפה לרשימה) טסט הריון/.test(aviState), 'in Avi\'s journal');
    // a second "add" is the same product, not another one
    await act(michal, [{ kind: 'list_add', text: 'טסט הריון' }]);
    assert.equal(sql("SELECT COUNT(*) AS n FROM products WHERE name = 'טסט הריון' AND private_to = 2 AND deleted IS NULL")[0].n, 1);
  });
  await check('P20', 'מוצר פרטי ליד משותף באותו שם: הוספה בטקסט נרשמת כפרטית; סימון השורה המשותפת הולך לשורה שלה; עריכה מהטופס עובדת', async () => {
    const journalOfAvi = async () => JSON.stringify((await state(avi)).journal) + JSON.stringify((await call(avi, 'GET', '/api/chat')).data);
    await act(avi, [{ kind: 'create', product: { name: 'שוקולד מריר', qty: 0 } }]);
    answer = () => ({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'list_add', text: 'שוקולד מריר', private: true }] });
    const r = await say(michal, 'תוסיף לי שוקולד מריר, שרק אני אראה'); await apply(michal, r.proposal.id);
    assert.equal(sql("SELECT COUNT(*) AS n FROM products WHERE name = 'שוקולד מריר' AND private_to = 2")[0].n, 1, 'her own');
    await act(michal, [{ kind: 'list_add', text: 'שוקולד מריר', amount: 2 }]);
    assert.ok(!/מיכל [^"]*שוקולד מריר/.test(await journalOfAvi()), 'her addition by text is in Avi\'s journal');
    // the shared "טסט הריון" on the list (Yoavi's, approved by Avi), and her own line of it
    const shared = sql("SELECT id FROM products WHERE name = 'טסט הריון' AND private_to IS NULL")[0].id;
    await act(yoavi, [{ kind: 'list_add', product_id: shared }]);
    const line = sql('SELECT id FROM list_items WHERE product_id = ? AND status = \'open\'', shared)[0].id;
    await act(avi, [{ kind: 'approve', item_id: line, yes: true }]);
    await act(michal, [{ kind: 'check', item_id: line }]);
    assert.equal(sql('SELECT status FROM list_items WHERE id = ?', line)[0].status, 'open', 'the shared line was bought');
    assert.ok(!/מיכל קנתה טסט הריון/.test(await journalOfAvi()), 'in Avi\'s journal');
    // the product form always sends the name
    const mine = sql("SELECT id FROM products WHERE name = 'טסט הריון' AND private_to = 2")[0].id;
    const e = await act(michal, [{ kind: 'edit', product_id: mine, fields: { name: 'טסט הריון', qty: 3 } }]);
    assert.equal(e.status, 200, JSON.stringify(e.data));
  });
  await check('P21', 'מוצר פרטי ליד משותף באותו שם: כל פעולה שלה על השם הולכת לשלה, ושום דבר לא ביומן של אבי (02/10, שאלה 33)', async () => {
    const journalOfAvi = async () => JSON.stringify((await state(avi)).journal) + JSON.stringify((await call(avi, 'GET', '/api/chat')).data);
    const shared = sql("SELECT id FROM products WHERE name = 'שוקולד מריר' AND private_to IS NULL")[0].id;
    const mine = sql("SELECT id FROM products WHERE name = 'שוקולד מריר' AND private_to = 2 AND deleted IS NULL")[0].id;
    const bad = []; const soft = (f) => { try { f(); } catch (e) { bad.push(e.message.split('\n')[0]); } };
    const row = (id) => ({ ...sql('SELECT qty, level, counted, updated, deleted FROM products WHERE id = ?', id)[0] });
    sql("UPDATE list_items SET status = 'done' WHERE product_id IN (?, ?)", shared, mine);
    const was = row(shared); // "שוקולד מריר" isn't a private name: only the twin makes it hers
    // "קניתי" on the shared line when she has no line of her own
    await act(avi, [{ kind: 'list_add', product_id: shared }]);
    const line = sql("SELECT id FROM list_items WHERE product_id = ? AND status = 'open'", shared)[0].id;
    const q0 = row(mine).qty;
    await act(michal, [{ kind: 'check', item_id: line }]);
    soft(() => assert.equal(sql('SELECT status FROM list_items WHERE id = ?', line)[0].status, 'open', 'check: the shared line was bought'));
    soft(() => assert.ok(row(mine).qty > q0, 'check: hers was not bought'));
    // "add to the list" by the shared product's id, without "only me"
    await act(michal, [{ kind: 'list_add', product_id: shared }]);
    soft(() => assert.deepEqual(sql("SELECT product_id, private_to FROM list_items WHERE status = 'open' AND product_id IN (?, ?) AND (private_to = 2 OR added_by = 2)", shared, mine).map((x) => ({ ...x })), [{ product_id: mine, private_to: 2 }], 'list_add'));
    sql('UPDATE products SET counted = NULL WHERE id = ?', mine);
    // by name with "ה" in front, and "קניתי 3" on the shared line
    sql("UPDATE list_items SET status = 'done' WHERE product_id = ?", mine);
    await act(michal, [{ kind: 'list_add', text: 'השוקולד מריר' }]);
    soft(() => assert.equal(sql("SELECT COUNT(*) AS n FROM list_items WHERE status = 'open' AND product_id = ? AND private_to = 2", mine)[0].n, 1, 'list_add "השוקולד מריר": not on hers'));
    sql("UPDATE list_items SET status = 'done' WHERE product_id = ?", mine);
    const q1 = row(mine).qty; await act(michal, [{ kind: 'check', item_id: line, amount: 3 }]);
    soft(() => assert.equal(row(mine).qty, q1 + 3, 'check with an amount: not that amount'));
    // "עדיין יש", count, "ran out", edit
    await act(michal, [{ kind: 'confirm', product_id: shared }]);
    soft(() => assert.ok(row(mine).counted, 'confirm: hers was not counted'));
    await act(michal, [{ kind: 'op', product_id: shared, op: { type: 'set', qty: 4 } }]);
    soft(() => assert.equal(row(mine).qty, 4, 'count'));
    await act(michal, [{ kind: 'op', product_id: shared, op: { type: 'out' } }]);
    soft(() => assert.equal(row(mine).qty, 0, 'out'));
    await act(michal, [{ kind: 'edit', product_id: shared, fields: { brand: 'קלירבלו' } }]);
    soft(() => assert.equal(sql('SELECT brand FROM products WHERE id = ?', mine)[0].brand, 'קלירבלו', 'edit'));
    soft(() => assert.deepEqual(row(shared), was, 'the shared one moved'));
    // delete
    await act(michal, [{ kind: 'delete', product_id: shared }]);
    soft(() => assert.ok(row(mine).deleted, 'delete: hers is still there'));
    soft(() => assert.equal(row(shared).deleted, null, 'delete: the shared one went'));
    const j = await journalOfAvi(); soft(() => assert.ok(!/מיכל [^"]{0,40}שוקולד מריר/.test(j), 'in Avi\'s journal'));
    assert.deepEqual(bad, []);
  });
  await check('P22', 'השורה המשותפת, כשיש לה מוצר פרטי באותו שם: "להסיר", "הוזמן", "עדיין רוצה", "ביטול סימון" הולכים לשורה שלה; בלי שורה שלה רק "הוזמן" מוסיף לה שורה; כמות כטקסט היא מספר (03/10, שאלה 38)', async () => {
    const bad = []; const soft = (f) => { try { f(); } catch (e) { bad.push(e.message.split('\n')[0]); } };
    const journalOfAvi = async () => JSON.stringify((await state(avi)).journal) + JSON.stringify((await call(avi, 'GET', '/api/chat')).data);
    await act(avi, [{ kind: 'create', product: { name: 'קפה שחור', qty: 0 } }]);
    const shared = sql("SELECT id FROM products WHERE name = 'קפה שחור' AND private_to IS NULL")[0].id;
    answer = () => ({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'list_add', text: 'קפה שחור', private: true }] });
    const r = await say(michal, 'תוסיף לי קפה שחור, שרק אני אראה'); await apply(michal, r.proposal.id);
    const mine = sql("SELECT id FROM products WHERE name = 'קפה שחור' AND private_to = 2")[0].id;
    const line = (pid, st = 'open') => sql('SELECT * FROM list_items WHERE product_id = ? AND status = ?', pid, st)[0];
    await act(avi, [{ kind: 'list_add', product_id: shared }]);
    const sh = line(shared).id;
    sql('UPDATE list_items SET skipped = 2 WHERE product_id IN (?, ?)', shared, mine);
    // with a line of hers
    await act(michal, [{ kind: 'keep', item_id: sh }]);
    soft(() => assert.equal(line(mine).skipped, 0, 'keep: not hers'));
    soft(() => assert.equal(line(shared).skipped, 2, 'keep: the shared line'));
    await act(michal, [{ kind: 'order', item_id: sh }]);
    soft(() => assert.ok(line(mine).ordered, 'order: not hers'));
    soft(() => assert.equal(line(shared).ordered, null, 'order: the shared line'));
    await act(michal, [{ kind: 'list_remove', item_id: sh }]);
    soft(() => assert.equal(line(mine), undefined, 'list_remove: hers is still on the list'));
    soft(() => assert.ok(line(shared), 'list_remove: the shared line went'));
    // no line of hers
    await act(michal, [{ kind: 'order', item_id: sh }]);
    soft(() => assert.ok(line(mine)?.ordered && line(mine)?.private_to === 2, 'order with no line: no ordered line of hers'));
    soft(() => assert.equal(line(shared).ordered, null, 'order with no line: the shared line'));
    sql("UPDATE list_items SET status = 'done' WHERE product_id = ?", mine);
    const events = () => sql('SELECT COUNT(*) AS n FROM events')[0].n, e0 = events();
    await act(michal, [{ kind: 'list_remove', item_id: sh }]);
    await act(michal, [{ kind: 'keep', item_id: sh }]);
    await act(michal, [{ kind: 'order', item_id: sh, off: true }]);
    soft(() => assert.equal(events(), e0, 'nothing of hers to act on: an event was written anyway'));
    soft(() => assert.ok(line(shared), 'list_remove with no line: the shared line went'));
    soft(() => assert.equal(line(shared).skipped, 2, 'keep with no line: the shared line'));
    // "uncheck": Avi's tick on the shared line stays; hers comes back
    await act(avi, [{ kind: 'check', item_id: sh }]);
    const e1 = events(); await act(michal, [{ kind: 'uncheck', item_id: sh }]);
    soft(() => assert.equal(events(), e1, 'uncheck with no line: an event was written anyway'));
    soft(() => assert.ok(line(shared, 'checked'), 'uncheck with no line: Avi\'s tick went'));
    await act(michal, [{ kind: 'list_add', product_id: mine }]);
    const own = line(mine).id; await act(michal, [{ kind: 'check', item_id: own, amount: 1 }]);
    await act(michal, [{ kind: 'uncheck', item_id: sh }]);
    soft(() => assert.ok(line(mine), 'uncheck: hers is still in the cart'));
    soft(() => assert.ok(line(shared, 'checked'), 'uncheck: Avi\'s tick went'));
    // an amount as text, on top of what she has in the cart
    await act(michal, [{ kind: 'check', item_id: own, amount: 1 }]);
    const q0 = sql('SELECT qty FROM products WHERE id = ?', mine)[0].qty;
    await act(michal, [{ kind: 'check', item_id: sh, amount: '2' }]);
    soft(() => assert.equal(sql('SELECT qty FROM products WHERE id = ?', mine)[0].qty, q0 + 2, 'amount "2": not 2 more'));
    soft(() => assert.equal(typeof sql('SELECT bought_qty FROM list_items WHERE id = ?', own)[0].bought_qty, 'number', 'amount "2": bought_qty is text'));
    const j = await journalOfAvi(); soft(() => assert.ok(!/מיכל [^"]{0,40}קפה שחור/.test(j), 'in Avi\'s journal'));
    assert.deepEqual(bad, []);
  });
  await check('P23', 'כרטיס שכל הפעולות בו נפלו (אין לה שורה משלה): שוקי כותב לה "לא היה מה לעדכן.", ורק לה; ולא נכתב אירוע (03/10, שאלה 41)', async () => {
    const shared = sql("SELECT id FROM products WHERE name = 'קפה שחור' AND private_to IS NULL")[0].id;
    const mine = sql("SELECT id FROM products WHERE name = 'קפה שחור' AND private_to = 2 AND deleted IS NULL")[0].id;
    sql("UPDATE list_items SET status = 'done' WHERE product_id = ?", mine);
    if (!sql("SELECT id FROM list_items WHERE product_id = ? AND status = 'open'", shared).length) await act(avi, [{ kind: 'list_add', product_id: shared }]);
    const sh = sql("SELECT id FROM list_items WHERE product_id = ? AND status = 'open'", shared)[0].id;
    answer = () => ({ reply: 'להסיר?', face: 'happy', actions: [{ kind: 'list_remove', item_id: sh }] });
    const r = await say(michal, 'תוריד את הקפה השחור מהרשימה');
    const e0 = sql('SELECT COUNT(*) AS n FROM events')[0].n;
    assert.equal((await apply(michal, r.proposal.id)).status, 200);
    assert.equal(sql('SELECT COUNT(*) AS n FROM events')[0].n, e0, 'an event was written');
    assert.ok(sql("SELECT id FROM list_items WHERE id = ? AND status = 'open'", sh).length, 'the shared line went');
    assert.ok(JSON.stringify((await call(michal, 'GET', '/api/chat')).data).includes('לא היה מה לעדכן.'), 'not in her chat');
    assert.ok(!JSON.stringify((await call(avi, 'GET', '/api/chat')).data).includes('לא היה מה לעדכן.'), 'in Avi\'s chat');
  });
  await check('P24', 'בקשה מפורשת לסוד ("אל תגיד לאבי", "שלא תדע") כשהמודל לא סימן: ההודעה והכרטיס פרטיים, ומי שהסוד ממנו לא רואה (03/10, שאלה 40)', async () => {
    const sees = async (t, re) => re.test(JSON.stringify((await call(t, 'GET', '/api/chat')).data) + JSON.stringify(await state(t)));
    answer = () => ({ reply: 'הוספתי.', face: 'happy', actions: [{ kind: 'list_add', text: 'ויטמינים להריון' }] });
    let r = await say(michal, 'אל תגיד לאבי, אני בהריון. תוסיף ויטמינים להריון');
    await apply(michal, r.proposal.id);
    assert.ok(await sees(michal, /ויטמינים להריון/), 'not on her list');
    assert.ok(!(await sees(avi, /ויטמינים|בהריון/)), 'Avi sees it (#31)');
    answer = () => ({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'list_add', text: 'עוגת יום הולדת' }, { kind: 'list_add', text: 'נרות' }] });
    r = await say(avi, 'יום ההולדת של מיכל ביום שישי, תוסיף עוגה ונרות, שלא תדע');
    await apply(avi, r.proposal.id);
    assert.ok(await sees(avi, /עוגת יום הולדת/), 'not on his list');
    assert.ok(!(await sees(michal, /עוגת יום הולדת|יום ההולדת של מיכל|נרות/)), 'Michal sees it (#34)');
    // only "שלא ת/ידע", as in the decision: "לא ידע" alone is no secret (the reviewer)
    answer = () => ({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'list_add', text: 'חלב סויה' }] });
    r = await say(avi, 'הילד לא ידע שנגמר חלב הסויה, צריך חלב סויה');
    assert.ok(!/זה נשאר בינינו/.test(r.reply), 'a plain "לא ידע" made it personal');
    await apply(avi, r.proposal.id);
    assert.ok(await sees(michal, /חלב סויה/), 'a plain "לא ידע" made the line private');
  });
  await check('P25', '"לא היה מה לעדכן." רק כשלא נשמר כלום: לא אחרי תמונה, שאלה להמשך או "הכנו"; ותמונה שנכשלה באמצע לא כותבת אותו פעמיים באישור חוזר (03/10, שאלה 43)', async () => {
    const bad = []; const soft = (f) => { try { f(); } catch (e) { bad.push(e.message.split('\n')[0]); } };
    const shared = sql("SELECT id FROM products WHERE name = 'קפה שחור' AND private_to IS NULL")[0].id;
    const mine = sql("SELECT id FROM products WHERE name = 'קפה שחור' AND private_to = 2 AND deleted IS NULL")[0].id;
    sql("UPDATE list_items SET status = 'done' WHERE product_id = ?", mine);
    if (!sql("SELECT id FROM list_items WHERE product_id = ? AND status = 'open'", shared).length) await act(avi, [{ kind: 'list_add', product_id: shared }]);
    const sh = sql("SELECT id FROM list_items WHERE product_id = ? AND status = 'open'", shared)[0].id;
    const nothingSaid = () => sql("SELECT COUNT(*) AS n FROM chat WHERE role = 'shuki' AND content LIKE '%לא היה מה לעדכן.%'")[0].n;
    const card = (extra) => { const id = `p25-${Math.random().toString(36).slice(2)}`; sql('INSERT INTO proposals (id, user_id, created, actions) VALUES (?, 2, ?, ?)', id, Date.now(), JSON.stringify({ actions: [{ kind: 'list_remove', item_id: sh }, ...(extra.actions || [])], context: 'report', ...extra, actions: undefined })); return id; };
    const fixCard = (id, extra) => sql('UPDATE proposals SET actions = ? WHERE id = ?', JSON.stringify({ actions: [{ kind: 'list_remove', item_id: sh }, ...(extra.actions || [])], context: 'report', ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'actions')) }), id);
    const one = async (name, extra) => { const id = card({}); fixCard(id, extra); const n0 = nothingSaid(); const r = (await apply(michal, id)).data; soft(() => assert.equal(nothingSaid(), n0, `${name}: "לא היה מה לעדכן." though something was kept`)); soft(() => assert.ok(!r?.nothing, `${name}: "nothing" though something was kept (question 41)`)); };
    await one('a question for later', { ask: { q: 'לזכור את זה?', actions: [] } });
    sql("INSERT INTO recipes (id, name, ingredients, text, added_by, added) VALUES (25025, 'קפה קר', 'קפה שחור', 'מערבבים.', 2, 1)");
    await one('"we made it"', { recipe: 25025 });
    await one('a photo', { thumb: 'QUJD', actions: [{ kind: 'photo', product_id: mine }] });
    // a photo that fails half way: the card is approved again, and the words aren't said twice
    const ddl = sql("SELECT sql FROM sqlite_master WHERE name = 'product_photos'")[0].sql;
    sql('DROP TABLE product_photos');
    const id = card({}); fixCard(id, { thumb: 'QUJD', actions: [{ kind: 'photo', product_id: mine }] });
    const n0 = nothingSaid();
    await apply(michal, id);
    sql(ddl);
    await apply(michal, id);
    soft(() => assert.ok(nothingSaid() - n0 <= 1, `said ${nothingSaid() - n0} times after a failed photo`));
    // and with nothing at all kept, it is still said, once
    const n1 = nothingSaid(); const plain = card({}); fixCard(plain, {}); const rp = await apply(michal, plain);
    soft(() => assert.equal(nothingSaid(), n1 + 1, 'nothing kept: not said'));
    // questions 41, 43 (stage 5): the answer says nothing happened, with no reaction picked from what was chosen
    const rd = rp?.data || rp;
    soft(() => assert.ok(rd?.nothing === true && !('reaction' in rd), `nothing done: ${JSON.stringify(rd)}`));
    // and a card with every line skipped: nothing too (no "לבטל" that would undo the action before)
    const all = card({}); fixCard(all, {}); const n2 = nothingSaid(); const ra = (await apply(michal, all, { skip: [0] })).data;
    soft(() => assert.ok(ra?.nothing === true && !('reaction' in ra), `every line skipped: ${JSON.stringify(ra)}`));
    soft(() => assert.equal(nothingSaid(), n2, 'every line skipped: words said (57)'));
    // 57 (the owner 05/10): the stamps, from the chat row: "לא היה מה לעדכן." for nothing done, "בוטל" for every line skipped
    const row = (pid) => JSON.parse(sql("SELECT content FROM chat WHERE json_extract(content, '$.proposal.id') = ?", pid)[0]?.content || '{}');
    sql("INSERT INTO chat (ts, user_id, role, content, thread) VALUES (?, NULL, 'shuki', ?, 2)", Date.now(), JSON.stringify({ reply: 'x', proposal: { id: 'p25-stamp', lines: [{ text: 'x' }] }, status: 'pending', for: 2 }));
    sql("INSERT INTO chat (ts, user_id, role, content, thread) VALUES (?, NULL, 'shuki', ?, 2)", Date.now(), JSON.stringify({ reply: 'x', proposal: { id: 'p25-skip', lines: [{ text: 'x' }] }, status: 'pending', for: 2 }));
    sql("INSERT INTO proposals (id, user_id, created, actions) VALUES ('p25-stamp', 2, ?, ?), ('p25-skip', 2, ?, ?)", Date.now(), JSON.stringify({ actions: [{ kind: 'list_remove', item_id: sh }], context: 'report', secret: true }), Date.now(), JSON.stringify({ actions: [{ kind: 'list_remove', item_id: sh }], context: 'report' }));
    await apply(michal, 'p25-stamp'); await apply(michal, 'p25-skip', { skip: [0] });
    soft(() => assert.ok(row('p25-stamp').proposal?.nothing === true && row('p25-stamp').status === 'applied', `stamp: ${JSON.stringify(row('p25-stamp'))}`));
    soft(() => assert.ok(row('p25-skip').status === 'rejected' && !row('p25-skip').proposal?.nothing, `skipped: ${JSON.stringify(row('p25-skip'))}`));
    // a "yes" to Shuki's question that changed nothing: only "לא היה מה לעדכן.", once, without "סגור!"
    sql('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'ask:2', JSON.stringify({ actions: [{ kind: 'list_remove', item_id: sh }], secret: true, done: 'סגור!', ts: Date.now() }));
    const n3 = nothingSaid(); const yes = await say(michal, 'כן');
    soft(() => assert.equal(yes.reply, 'לא היה מה לעדכן.', JSON.stringify(yes)));
    soft(() => assert.equal(nothingSaid(), n3 + 1, `said ${nothingSaid() - n3} times`));
    // a card of extras only (a rule): applied, nothing to undo
    const ex = card({}); sql('UPDATE proposals SET actions = ? WHERE id = ?', JSON.stringify({ actions: [{ kind: 'remind', text: 'לבדוק את הגז', due_at: Date.now() + 864e5 }], context: 'report' }), ex);
    const rx = (await apply(michal, ex)).data; soft(() => assert.ok(rx?.status === 'applied' && !rx.undoable && !rx.nothing, `extras only: ${JSON.stringify(rx)}`));
    assert.deepEqual(bad, []);
  });
  await check('P26', '"כן" לכרטיס שהוצע אחרי הודעה שסומנה כסוד: השורות פרטיות; ודרך עוזר מחובר (MCP) אותה בדיקה ואותה פרטיות (03/10, שאלות 44א, 44ב)', async () => {
    const bad = []; const soft = (f) => { try { f(); } catch (e) { bad.push(e.message.split('\n')[0]); } };
    const aviSees = async (re) => re.test(JSON.stringify((await call(avi, 'GET', '/api/chat')).data) + JSON.stringify(await state(avi)));
    // 44א: the secret, Shuki offers, "כן"
    answer = () => ({ reply: 'מזל טוב! להוסיף חומצה פולית לרשימה?', face: 'excited', options: ['כן', 'לא'] });
    await say(michal, 'אל תגיד לאבי, אני בהריון');
    answer = () => ({ reply: 'מוסיף.', face: 'happy', actions: [{ kind: 'list_add', text: 'חומצה פולית' }] });
    const r = await say(michal, 'כן');
    await apply(michal, r.proposal.id);
    soft(() => assert.ok(sql("SELECT 1 FROM list_items i LEFT JOIN products p ON p.id = i.product_id WHERE (p.name = 'חומצה פולית' OR i.text = 'חומצה פולית') AND i.private_to = 2").length, '44א: the line is not hers alone'));
    if (await aviSees(/חומצה פולית/)) bad.push('44א: Avi sees it');
    // 44א, the reviewer: a "כן" longer than three words (a button's text), and "כן, רק הפעם" to a question about a rule
    answer = () => ({ reply: 'להוסיף ברזל?', face: 'happy', options: ['כן, תוסיף ברזל לרשימה', 'לא'] });
    await say(michal, 'שלא ידעו, אני בהריון');
    answer = () => ({ reply: 'מוסיף.', face: 'happy', actions: [{ kind: 'list_add', text: 'ברזל' }] });
    let y = await say(michal, 'כן, תוסיף ברזל לרשימה');
    if (y.proposal) await apply(michal, y.proposal.id);
    soft(() => assert.ok(sql("SELECT 1 FROM list_items i LEFT JOIN products p ON p.id = i.product_id WHERE (p.name = 'ברזל' OR i.text = 'ברזל') AND i.private_to = 2").length, '44א: a button\'s "כן, …" is not hers alone'));
    answer = () => ({ reply: 'להוסיף אבץ?', face: 'happy', options: ['כן', 'לא'] });
    await say(michal, 'שלא ידעו, אני בהריון');
    answer = () => ({ reply: 'מוסיף.', face: 'happy', actions: [{ kind: 'list_add', text: 'אבץ' }] });
    y = await say(michal, 'כן, תוסיף');
    if (y.proposal) await apply(michal, y.proposal.id);
    soft(() => assert.ok(sql("SELECT 1 FROM list_items i LEFT JOIN products p ON p.id = i.product_id WHERE (p.name = 'אבץ' OR i.text = 'אבץ') AND i.private_to = 2").length, '44א: a typed "כן, תוסיף" is not hers alone'));
    // a question in words only, no buttons (the owner 03/10, question 45): an offer too
    answer = () => ({ reply: 'להוסיף חומצה פולית לרשימה?', face: 'happy' });
    await say(michal, 'שלא ידעו, אני בהריון');
    answer = () => ({ reply: 'מוסיף.', face: 'happy', actions: [{ kind: 'list_add', text: 'חומצה פולית טבליות' }] });
    y = await say(michal, 'כן');
    if (y.proposal) await apply(michal, y.proposal.id);
    soft(() => assert.ok(sql("SELECT 1 FROM list_items i LEFT JOIN products p ON p.id = i.product_id WHERE (p.name = 'חומצה פולית טבליות' OR i.text = 'חומצה פולית טבליות') AND i.private_to = 2").length, '45: "כן" to a question in words only is not hers alone'));
    // a "?" anywhere in the answer, words after it too (the owner 03/10, question 46)
    answer = () => ({ reply: 'להוסיף חומצה פולית? ומזל טוב!', face: 'excited' });
    await say(michal, 'שלא ידעו, אני בהריון');
    answer = () => ({ reply: 'מוסיף.', face: 'happy', actions: [{ kind: 'list_add', text: 'ברזל טבליות' }] });
    y = await say(michal, 'כן');
    if (y.proposal) await apply(michal, y.proposal.id);
    soft(() => assert.ok(sql("SELECT 1 FROM list_items i LEFT JOIN products p ON p.id = i.product_id WHERE (p.name = 'ברזל טבליות' OR i.text = 'ברזל טבליות') AND i.private_to = 2").length, '46: "כן" to a question in the middle of the answer is not hers alone'));
    // any words, no "כן", after an offer (the owner 03/10): private
    answer = () => ({ reply: 'להוסיף סידן?', face: 'happy', options: ['כן', 'לא'] });
    await say(michal, 'שלא ידעו, אני בהריון');
    answer = () => ({ reply: 'מוסיף.', face: 'happy', actions: [{ kind: 'list_add', text: 'סידן' }] });
    y = await say(michal, 'תוסיפי גם סידן');
    if (y.proposal) await apply(michal, y.proposal.id);
    soft(() => assert.ok(sql("SELECT 1 FROM list_items i LEFT JOIN products p ON p.id = i.product_id WHERE (p.name = 'סידן' OR i.text = 'סידן') AND i.private_to = 2").length, '44א: "תוסיפי גם סידן" after an offer is not hers alone'));
    // no offer in between: a new request is not private
    answer = () => ({ reply: 'מזל טוב!', face: 'excited' });
    await say(michal, 'שלא ידעו, אני בהריון');
    answer = () => ({ reply: 'מוסיף.', face: 'happy', actions: [{ kind: 'list_add', text: 'במבה נוגט' }] });
    y = await say(michal, 'תוסיף במבה נוגט');
    if (y.proposal) await apply(michal, y.proposal.id);
    soft(() => assert.ok(sql("SELECT 1 FROM list_items i LEFT JOIN products p ON p.id = i.product_id WHERE (p.name = 'במבה נוגט' OR i.text = 'במבה נוגט') AND i.private_to IS NULL").length, '44א: a new request with no offer in between was made private'));
    sql("INSERT INTO lessons (text, added, added_by) VALUES ('לא לקנות מגנזיום', 1, 1)");
    answer = () => ({ reply: 'מוסיף.', face: 'happy', actions: [{ kind: 'list_add', text: 'מגנזיום' }] });
    await say(michal, 'בינינו, תוסיף מגנזיום');
    answer = () => ({ reply: 'אוקיי.', face: 'happy' });
    y = await say(michal, 'כן, רק הפעם');
    if (y.proposal) await apply(michal, y.proposal.id);
    soft(() => assert.ok(sql("SELECT 1 FROM list_items i LEFT JOIN products p ON p.id = i.product_id WHERE (p.name = 'מגנזיום' OR i.text = 'מגנזיום') AND i.private_to = 2").length, '44א: "כן, רק הפעם" to the rule\'s question is not hers alone'));
    // (the rule "לא לקנות מגנזיום" is the house's own, so Avi's chat and list only, not his whole state)
    if (/ברזל|מגנזיום|אבץ|סידן|חומצה פולית טבליות|ברזל טבליות/.test(JSON.stringify((await call(avi, 'GET', '/api/chat')).data) + JSON.stringify((await state(avi)).list || []))) bad.push('44א: Avi sees it');
    // 44ב: through her connected assistant
    const conn = (await call(michal, 'POST', '/api/connectors', { name: 'Claude' })).data.path;
    answer = () => ({ reply: 'הוספתי.', face: 'happy', actions: [{ kind: 'list_add', text: 'בדיקת דם' }] });
    await call(null, 'POST', conn, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ask_shuki', arguments: { message: 'תוסיף בדיקת דם, שאבי לא ידע' } } });
    const pid = sql("SELECT id FROM proposals WHERE user_id = 2 AND status = 'pending' ORDER BY created DESC LIMIT 1")[0]?.id;
    if (pid) await apply(michal, pid);
    // 44ב with 44א: a card offered after a secret through the assistant (its card lives in the app), then "כן, ותוסיף…" there too
    const ask = (message) => call(null, 'POST', conn, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ask_shuki', arguments: { message } } });
    answer = () => ({ reply: 'להוסיף ויטמין די?', face: 'happy', actions: [{ kind: 'list_add', text: 'ויטמין די' }] });
    await ask('שלא ידעו, אני בהריון');
    answer = () => ({ reply: 'מוסיף.', face: 'happy', actions: [{ kind: 'list_add', text: 'ויטמין בי' }] });
    await ask('כן, ותוסיף גם ויטמין בי');
    for (const p of sql("SELECT id FROM proposals WHERE user_id = 2 AND status = 'pending'")) await apply(michal, p.id);
    soft(() => assert.ok(sql("SELECT 1 FROM list_items i LEFT JOIN products p ON p.id = i.product_id WHERE (p.name = 'ויטמין בי' OR i.text = 'ויטמין בי') AND i.private_to = 2").length, '44א+ב: through the assistant, the answer to an offer after a secret is not hers alone'));
    soft(() => assert.ok(sql("SELECT 1 FROM list_items i LEFT JOIN products p ON p.id = i.product_id WHERE (p.name = 'בדיקת דם' OR i.text = 'בדיקת דם') AND i.private_to = 2").length, '44ב: through MCP the line is not hers alone'));
    if (await aviSees(/בדיקת דם|ויטמין בי/)) bad.push('44ב: Avi sees it');
    assert.deepEqual(bad, []);
  });
  await check('P27', 'אחרי ה-merge של r0t: שאלה מהתור של r0t-4, חופשה (c12) וקטניות (c11) אחרי סוד אינן הצעה של 44א; כרטיס שעוצר תזכורת יומית ותשובה לחופשה או לקטניות לא כותבים "לא היה מה לעדכן."; "עזוב" על כרטיס אחרי סוד סוגר אותו בלי שורה לאחרים (04/10)', async () => {
    const bad = []; const soft = (f) => { try { f(); } catch (e) { bad.push(e.message.split('\n')[0]); } };
    const lineOf = (name) => sql("SELECT i.private_to FROM list_items i LEFT JOIN products p ON p.id = i.product_id WHERE (p.name = ? OR i.text = ?) AND i.status = 'open' ORDER BY i.added DESC LIMIT 1", name, name)[0];
    const nothingSaid = () => sql("SELECT COUNT(*) AS n FROM chat WHERE role = 'shuki' AND content LIKE '%לא היה מה לעדכן.%'")[0].n;
    sql('UPDATE chat SET ts = ts - 3600e3 WHERE user_id = 2'); // P26 sent many: not 30 a minute here (that limit answers "לא הצלחתי לחשוב")
    const addLater = async (name) => { answer = () => ({ reply: 'מוסיף.', face: 'happy', actions: [{ kind: 'list_add', text: name }] }); const y = await say(michal, `תוסיף ${name}`); if (y.proposal) await apply(michal, y.proposal.id); return lineOf(name); };
    // א: a vacation said right after a secret: since 04/10 a state of the house isn't kept after a secret, so it isn't even
    // asked (worker/secret.js); no offer, the next request stays shared
    sql("DELETE FROM settings WHERE key IN ('ask:2', 'askq:2')");
    answer = () => ({ reply: 'נסיעה טובה!', face: 'happy', away: { until: '2026-10-10' } });
    const v = await say(michal, 'שלא ידעו, אנחנו טסים מחר');
    soft(() => assert.ok(!/חופשה/.test(v.reply), `a vacation question after a secret: ${v.reply}`));
    let l = await addLater('מלפפון ננסי');
    soft(() => assert.equal(l?.private_to ?? null, null, 'א: after the vacation question, a new request was made private'));
    // א: kitniyot (c11) waiting as the open question after a secret: no offer
    sql("DELETE FROM settings WHERE key IN ('ask:2', 'askq:2')");
    answer = () => ({ reply: 'מזל טוב!', face: 'excited' });
    await say(michal, 'שלא ידעו, אני בהריון');
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('ask:2', ?)", JSON.stringify({ actions: [], kitniyot: true, done: 'סגור!', nope: 'בסדר.', choices: { 'כן, אוכלים': {}, 'לא אוכלים': { no: true } }, ts: Date.now() }));
    sql("DELETE FROM chat WHERE id = (SELECT MAX(id) FROM chat WHERE role = 'shuki' AND thread = 2)"); // ...in place of it: the kitniyot question as the server builds it (askOnly)
    sql("INSERT INTO chat (ts, user_id, role, content, thread) VALUES (?, NULL, 'shuki', ?, 2)", Date.now(), JSON.stringify({ askOnly: true, reply: 'האם אוכלים קטניות בפסח?', face: 'happy', options: ['כן, אוכלים', 'לא אוכלים'], for: 2 }));
    l = await addLater('חומוס גרגרים');
    soft(() => assert.equal(l?.private_to ?? null, null, 'א: with the kitniyot question open, a new request was made private'));
    // א: a question released from r0t-4's queue after Shuki's own answer: no offer
    sql("DELETE FROM settings WHERE key IN ('ask:2', 'askq:2')");
    answer = () => ({ reply: 'מזל טוב!', face: 'excited' });
    await say(michal, 'שלא ידעו, אני בהריון');
    sql("INSERT INTO chat (ts, user_id, role, content, thread) VALUES (?, NULL, 'shuki', ?, 2)", Date.now(), JSON.stringify({ reply: 'לזכור שיואבי לא אוכל גבינה?', options: ['כן', 'לא'], to: [2], fromQueue: true }));
    l = await addLater('גבינת שמנת');
    soft(() => assert.equal(l?.private_to ?? null, null, 'א: after a queued question, a new request was made private'));
    // the reviewer (04/10): the model's own offer stays an offer when the server adds a question of its own ("לספר לבית?", r9-79)
    sql("DELETE FROM settings WHERE key IN ('ask:2', 'askq:2')");
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 2, 'pregnancy', 'בהריון', ?, 2, 2, 1, 'chat', ?, ?)", Date.now(), Date.now(), Date.now());
    answer = () => ({ reply: 'כדאי חומצה פולית. להוסיף לרשימה?', face: 'happy' });
    await say(michal, 'שלא ידעו, מה כדאי לי לקנות?');
    l = await addLater('חומצה פולית 400');
    soft(() => assert.equal(l?.private_to, 2, 'the model\'s "להוסיף לרשימה?" with the server\'s question after it: the next line is shared'));
    sql("DELETE FROM facts WHERE about = 'person' AND about_id = 2 AND key = 'pregnancy'");
    // ב: a card that stops a daily reminder, and answers to the vacation / kitniyot questions: no "לא היה מה לעדכן."
    sql("DELETE FROM settings WHERE key IN ('ask:2', 'askq:2')");
    sql("INSERT INTO maybe (text, store, added_by, added, due_at, kind, repeat) VALUES ('להכין קופסאות', 'super', 2, ?, ?, 'remind', 'daily')", Date.now(), Date.now() + 3600e3);
    const n0 = nothingSaid();
    const pid = `p27-${Date.now()}`;
    sql('INSERT INTO proposals (id, user_id, created, actions) VALUES (?, 2, ?, ?)', pid, Date.now(), JSON.stringify({ actions: [{ kind: 'remind', off: true, text: 'להכין קופסאות' }], context: 'report' }));
    await apply(michal, pid);
    answer = () => ({ reply: 'נסיעה טובה!', face: 'happy', away: { until: '2026-10-12' } });
    await say(michal, 'אנחנו טסים מחר');
    await say(michal, 'כן, להפעיל');
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('ask:2', ?)", JSON.stringify({ actions: [], kitniyot: true, done: 'סגור!', nope: 'בסדר.', choices: { 'כן, אוכלים': {}, 'לא אוכלים': { no: true } }, ts: Date.now() }));
    await say(michal, 'כן, אוכלים');
    soft(() => assert.equal(nothingSaid(), n0, 'ב: "לא היה מה לעדכן." after a reminder stopped, a vacation or kitniyot'));
    sql("DELETE FROM away"); sql("DELETE FROM facts WHERE about = 'house' AND key = 'kitniyot'");
    // ג: "עזוב" on a card made after a secret: it closes, and nothing reaches Avi
    answer = () => ({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'list_add', text: 'בדיקת שתן' }] });
    const c = await say(michal, 'שלא ידעו, תוסיף בדיקת שתן');
    const avi0 = JSON.stringify((await call(avi, 'GET', '/api/chat')).data);
    await say(michal, 'עזוב');
    soft(() => assert.equal(sql('SELECT status FROM proposals WHERE id = ?', c.proposal?.id)[0]?.status, 'rejected', 'ג: the card is still open'));
    const avi1 = JSON.stringify((await call(avi, 'GET', '/api/chat')).data);
    soft(() => assert.equal(avi1, avi0, 'ג: Avi\'s chat changed'));
    const aviState = JSON.stringify(await state(avi));
    soft(() => assert.ok(!/בדיקת שתן|ביטלתי|עזוב/.test(avi1 + aviState), 'ג: Avi sees it'));
    // ...and "בטל" the same way (the owner 04/10)
    answer = () => ({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'list_add', text: 'בדיקת דם מיוחדת' }] });
    const c2 = await say(michal, 'שלא ידעו, תוסיף בדיקת דם מיוחדת');
    await say(michal, 'בטל');
    soft(() => assert.equal(sql('SELECT status FROM proposals WHERE id = ?', c2.proposal?.id ?? '')[0]?.status, 'rejected', 'ג: "בטל": the card is still open'));
    const avi2 = JSON.stringify((await call(avi, 'GET', '/api/chat')).data) + JSON.stringify(await state(avi));
    soft(() => assert.ok(!/בדיקת דם מיוחדת|ביטלתי|בטל/.test(avi2), 'ג: "בטל": Avi sees it'));
    assert.deepEqual(bad, []);
  });
  await check('P28', 'תזכורת וקנייה קבועה מהודעה שסומנה כסוד, או שהמודל סימן אישית: רק מי שכתב רואה (לא ב"תזכורות", לא ב-API, לא בהורדה, לא בפרומפט של אבי), והקנייה הקבועה נכנסת לרשימה כשלה (04/10)', async () => {
    const bad = []; const soft = (f) => { try { f(); } catch (e) { bad.push(e.message.split('\n')[0]); } };
    sql('UPDATE chat SET ts = ts - 3600e3 WHERE user_id = 2'); sql("DELETE FROM settings WHERE key IN ('ask:2', 'askq:2')");
    const jlm = (t) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', hour: 'numeric', hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(t).map((x) => [x.type, x.value]));
    const tomorrow = (() => { const d = jlm(Date.now() + 86400e3); return `${d.year}-${d.month}-${d.day}`; })();
    const aviSees = async (re) => re.test(JSON.stringify(await state(avi)) + JSON.stringify((await call(avi, 'GET', '/api/chat')).data) + JSON.stringify((await call(avi, 'GET', '/api/export')).data));
    // the secret: Michal's example
    answer = () => ({ reply: 'לקבוע?', face: 'happy', actions: [{ kind: 'remind', text: 'לקחת חומצה פולית יומית', date: tomorrow, time: '08:00', repeat: 'daily' }] });
    let r = await say(michal, 'שלא ידעו, תזכיר לי כל יום ב-8 לקחת חומצה פולית');
    if (r.proposal) await apply(michal, r.proposal.id);
    const herState = JSON.stringify((await state(michal)).maybe); soft(() => assert.ok(/לקחת חומצה פולית יומית/.test(herState), 'not in her own "תזכורות"'));
    // the model marked it personal (no secret words)
    answer = () => ({ reply: 'לקבוע?', face: 'happy', personal: true, actions: [{ kind: 'remind', text: 'לקחת כדור ורוד', date: tomorrow, time: '09:00', repeat: 'daily' }] });
    r = await say(michal, 'תזכיר לי כל יום ב-9 לקחת את הכדור הוורוד');
    if (r.proposal) await apply(michal, r.proposal.id);
    // a weekly buy after a secret, its day tomorrow
    let at = Math.ceil(Date.now() / 3600e3) * 3600e3; while (+jlm(at).hour !== 7) at += 3600e3;
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(jlm(at + 86400e3).weekday);
    answer = () => ({ reply: 'לקבוע?', face: 'happy', actions: [{ kind: 'routine', text: 'טבליות ברזל שבועיות', weekday: wd }] });
    r = await say(michal, 'שלא ידעו, תוסיף כל שבוע טבליות ברזל');
    if (r.proposal) await apply(michal, r.proposal.id);
    soft(() => assert.equal(sql("SELECT private_to FROM maybe WHERE text = 'לקחת חומצה פולית יומית'")[0]?.private_to, 2, 'the secret reminder is not hers alone'));
    soft(() => assert.equal(sql("SELECT private_to FROM maybe WHERE text = 'לקחת כדור ורוד'")[0]?.private_to, 2, 'the personal reminder is not hers alone'));
    soft(() => assert.equal(sql("SELECT private_to FROM routines WHERE text = 'טבליות ברזל שבועיות'")[0]?.private_to, 2, 'the weekly buy is not hers alone'));
    if (await aviSees(/לקחת חומצה פולית יומית|לקחת כדור ורוד|טבליות ברזל שבועיות/)) bad.push('Avi sees it (state, chat or his download)');
    // ...nor in his prompt
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await say(avi, 'מה הקניות הקבועות שלנו?');
    soft(() => assert.ok(!/טבליות ברזל שבועיות|חומצה פולית יומית|כדור ורוד/.test(JSON.stringify(requests.at(-1)?.body?.system || requests.at(-1)?.system || requests.at(-1) || '')), 'in Avi\'s prompt'));
    // part 2 (the house, cached) is the same for the whole house: her private weekly buy is in her part 4 (the owner 04/10)
    const aviPart2 = requests.at(-1)?.system?.[1]?.text;
    await say(michal, 'מה הקניות הקבועות שלי?');
    const herSystem = requests.at(-1)?.system || [];
    soft(() => assert.ok(aviPart2 && aviPart2 === herSystem[1]?.text, `part 2 differs between Avi and Michal: ${JSON.stringify(herSystem[1]?.text || '').slice(0, 200)}`));
    soft(() => assert.ok(herSystem.slice(3).some((b) => /טבליות ברזל שבועיות/.test(b.text)), 'her private weekly buy is not in her part 4'));
    // weeklyBuys: the line goes on the list as hers, not Shuki's for everyone
    await call(avi, 'POST', '/api/__schedule', { now: at });
    const line = sql("SELECT i.private_to, p.private_to AS pp FROM list_items i LEFT JOIN products p ON p.id = i.product_id WHERE (i.text = 'טבליות ברזל שבועיות' OR p.name = 'טבליות ברזל שבועיות') AND i.status = 'open'")[0];
    soft(() => assert.ok(line, 'the weekly buy did not go on the list'));
    soft(() => assert.equal(line?.private_to ?? line?.pp, 2, 'the weekly buy\'s line is not hers alone'));
    const aviList = JSON.stringify((await state(avi)).list); soft(() => assert.ok(!/טבליות ברזל שבועיות/.test(aviList), 'Avi sees the weekly buy on his list'));
    // the reviewer (04/10): "להוסיף לרשימה" on her secret reminder makes her line, not a shared one
    const mid = sql("SELECT id FROM maybe WHERE text = 'לקחת חומצה פולית יומית'")[0]?.id;
    await call(michal, 'POST', '/api/maybe', { id: mid, decision: 'list' });
    soft(() => assert.equal(sql("SELECT private_to FROM list_items WHERE text = 'לקחת חומצה פולית יומית' AND status = 'open'")[0]?.private_to, 2, 'her secret reminder became a shared line'));
    // ...and Avi's weekly buy of the same name doesn't take hers away
    answer = () => ({ reply: 'לקבוע?', face: 'happy', actions: [{ kind: 'routine', text: 'טבליות ברזל שבועיות', weekday: wd }] });
    r = await say(avi, 'תוסיף כל שבוע טבליות ברזל שבועיות');
    if (r.proposal) await apply(avi, r.proposal.id);
    soft(() => assert.equal(sql("SELECT COUNT(*) AS n FROM routines WHERE text = 'טבליות ברזל שבועיות' AND private_to = 2")[0].n, 1, 'Avi\'s weekly buy deleted hers'));
    // the reviewer's blocker 2 (the owner 04/10, option 1): after a secret, what she does to a SHARED product goes to her own of that
    // name (made now, D8 on the card), and the shared one doesn't move: Avi learns nothing of it in "מי ומתי", "לבטל", the CSV or the month
    sql("INSERT INTO products (id, name, count_type, qty, is_basic, created, updated, updated_by) VALUES (90, 'טבליות', 'units', 3, 0, 1, 1, 1)");
    await act(avi, [{ kind: 'op', product_id: 90, op: { type: 'use', amount: 1 } }]); // Avi's last action, on the tablets
    const tabsBefore = { ...sql('SELECT qty, updated, updated_by, deleted FROM products WHERE id = 90')[0] };
    sql('UPDATE chat SET ts = ts - 3600e3 WHERE user_id = 2');
    answer = () => ({ reply: 'לסמן?', face: 'happy', actions: [{ kind: 'op', product_id: 90, op: { type: 'discard', amount: 1 } }] });
    r = await say(michal, 'שלא ידעו, זרקתי טבלייה');
    soft(() => assert.ok(r.proposal?.lines?.some((l) => (l.detail || '').includes('רק את תראי את המוצר הזה.')), `no D8 on the card: ${JSON.stringify(r.proposal?.lines)}`));
    if (r.proposal) await apply(michal, r.proposal.id);
    answer = () => ({ reply: 'לסמן?', face: 'happy', actions: [{ kind: 'op', product_id: 90, op: { type: 'out' } }] });
    r = await say(michal, 'שלא ידעו, נגמרו הטבליות');
    if (r.proposal) await apply(michal, r.proposal.id);
    soft(() => assert.deepEqual({ ...sql('SELECT qty, updated, updated_by, deleted FROM products WHERE id = 90')[0] }, tabsBefore, 'the shared tablets moved'));
    soft(() => assert.equal(sql("SELECT COUNT(*) AS n FROM products WHERE name = 'טבליות' AND private_to = 2 AND deleted IS NULL")[0].n, 1, 'no private tablets of hers'));
    // "מי ומתי" in Avi's prompt
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await say(avi, 'מי עדכן את הטבליות?');
    const aviPrompt = JSON.stringify(requests.at(-1) || '');
    soft(() => assert.ok(/טבליות: עודכן אחרון/.test(aviPrompt), 'no "מי ומתי" line in Avi\'s prompt at all'));
    soft(() => assert.ok(!/טבליות: עודכן אחרון[^\n"]*מיכל/.test(aviPrompt), 'Avi\'s "מי ומתי" names Michal'));
    // the CSV of the history
    const histCsv = (await call(avi, 'GET', '/api/export.csv?what=history')).data;
    soft(() => assert.ok(!String(histCsv).split('\n').some((l) => /טבליות(?! ברזל)/.test(l) && /מיכל/.test(l)), 'Avi\'s history CSV has Michal on the tablets'));
    // the month's summary on the 1st
    // by calendar days at 20:00 (local), not 24-hour steps: after midnight and across the end of DST those land a day off
    let days1 = 0; while (new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', day: 'numeric' }).format(local(days1, 20)) !== '1') days1++;
    const m = (await call(avi, 'POST', '/api/__schedule', { now: local(days1, 20) })).data;
    soft(() => assert.ok(/סיכום החודש/.test(JSON.stringify(m.digestFor?.[1] || '')), `no month summary for Avi: ${JSON.stringify(m).slice(0, 300)}`));
    soft(() => assert.ok(!/טבליות(?! ברזל)/.test(JSON.stringify(m.digestFor?.[1] || '')), 'the tablets in Avi\'s "נזרק"'));
    // "לבטל": Avi takes back his own, with no word of Michal
    const u = await call(avi, 'POST', '/api/undo');
    soft(() => assert.ok(!/מיכל/.test(JSON.stringify(u.data)), `Avi's undo names Michal: ${JSON.stringify(u.data)}`));
    soft(() => assert.equal(sql('SELECT qty FROM products WHERE id = 90')[0].qty, 3, 'Avi\'s undo did not go through'));
    // deleting, or "still there", after a secret on a shared product she has no copy of: nothing happens, and she is told so
    sql("INSERT INTO products (id, name, count_type, qty, is_basic, created, updated, updated_by, counted) VALUES (91, 'ויטמין C', 'units', 2, 0, 1, 1, 1, 1)");
    for (const [kind, text] of [['delete', 'שלא ידעו, תמחק את ויטמין C'], ['confirm', 'שלא ידעו, עדיין יש ויטמין C']]) {
      sql('UPDATE chat SET ts = ts - 3600e3 WHERE user_id = 2');
      const nothing = async () => (JSON.stringify((await call(michal, 'GET', '/api/chat')).data).match(/לא היה מה לעדכן\./g) || []).length;
      const n0 = await nothing(), e0 = sql('SELECT COUNT(*) AS n FROM events')[0].n;
      answer = () => ({ reply: 'לעדכן?', face: 'happy', actions: [{ kind, product_id: 91 }] });
      r = await say(michal, text);
      const ap = r.proposal ? await apply(michal, r.proposal.id) : null;
      soft(() => assert.equal(ap?.status, 200, `${kind}: ${JSON.stringify(ap?.data)}`));
      soft(() => assert.deepEqual({ ...sql('SELECT deleted, counted, updated_by FROM products WHERE id = 91')[0] }, { deleted: null, counted: 1, updated_by: 1 }, `${kind}: the shared vitamin moved`));
      soft(() => assert.equal(sql('SELECT COUNT(*) AS n FROM events')[0].n, e0, `${kind}: an event was written`));
      const n1 = await nothing();
      soft(() => assert.equal(n1, n0 + 1, `${kind}: she wasn't told "לא היה מה לעדכן."`));
      soft(() => assert.ok(!ap?.data?.eventId, `${kind}: the answer looks as if something happened: ${JSON.stringify(ap?.data)}`));
    }
    assert.deepEqual(bad, []);
  });
  await check('P29', 'אחרי סוד (04/10, הבודק): פעולה על שורה משותפת ברשימה לא זזה לאחרים; כלל, שאריות, מתכון ועובדה על הבית או על אחר לא נשמרים והתשובה לא אומרת שכן; עובדה על מי שכותב פרטית; mineOf מבחוץ לא נקלט', async () => {
    const bad = []; const soft = (f) => { try { f(); } catch (e) { bad.push(e.message.split('\n')[0]); } };
    const fresh = () => { sql('UPDATE chat SET ts = ts - 3600e3 WHERE user_id = 2'); sql("DELETE FROM settings WHERE key IN ('ask:2', 'askq:2')"); };
    const nothing = async () => (JSON.stringify((await call(michal, 'GET', '/api/chat')).data).match(/לא היה מה לעדכן\./g) || []).length;
    const aviJournal = (re) => sql('SELECT summary FROM events WHERE private_to IS NULL').some((e) => re.test(e.summary));
    // 1. a shared line on the list (blocker 1): two shared products with a line Avi added, Michal has no copy of either
    sql("INSERT INTO products (id, name, count_type, qty, is_basic, created, updated, updated_by) VALUES (92, 'משחת שיניים', 'units', 0, 0, 1, 1, 1), (93, 'סבון כלים', 'units', 0, 0, 1, 1, 1)");
    await act(avi, [{ kind: 'list_add', product_id: 92 }, { kind: 'list_add', product_id: 93 }]);
    const line = (p) => sql("SELECT id, status, ordered FROM list_items WHERE product_id = ? AND private_to IS NULL AND status != 'done'", p)[0];
    const l92 = line(92).id, l93 = line(93).id;
    for (const [kind, extra] of [['list_remove', {}], ['keep', {}]]) {
      fresh(); const n0 = await nothing(), e0 = sql('SELECT COUNT(*) AS n FROM events')[0].n;
      answer = () => ({ reply: 'לעדכן?', face: 'happy', actions: [{ kind, item_id: l92, ...extra }] });
      const r = await say(michal, 'שלא ידעו, תורידי את משחת השיניים מהרשימה');
      if (r.proposal) await apply(michal, r.proposal.id);
      soft(() => assert.equal(line(92)?.id, l92, `${kind}: the shared line went`));
      soft(() => assert.equal(sql('SELECT COUNT(*) AS n FROM events')[0].n, e0, `${kind}: an event was written`));
      const n1 = await nothing(); soft(() => assert.equal(n1, n0 + 1, `${kind}: she wasn't told "לא היה מה לעדכן."`));
    }
    fresh();
    answer = () => ({ reply: 'לסמן?', face: 'happy', actions: [{ kind: 'order', item_id: l92 }] });
    let r = await say(michal, 'שלא ידעו, הזמנתי משחת שיניים במשלוח');
    if (r.proposal) await apply(michal, r.proposal.id);
    soft(() => assert.equal(line(92)?.ordered ?? null, null, 'order: the shared line is marked ordered'));
    soft(() => assert.ok(sql("SELECT i.ordered FROM list_items i JOIN products p ON p.id = i.product_id WHERE p.name = 'משחת שיניים' AND p.private_to = 2 AND i.status = 'open'")[0]?.ordered, 'order: no ordered line of her own'));
    fresh();
    const p93 = { ...sql('SELECT qty, updated, updated_by FROM products WHERE id = 93')[0] };
    answer = () => ({ reply: 'לסמן?', face: 'happy', actions: [{ kind: 'arrived', item_id: l93 }] });
    r = await say(michal, 'שלא ידעו, הסבון כלים הגיע במשלוח');
    if (r.proposal) await apply(michal, r.proposal.id);
    soft(() => assert.equal(line(93)?.status, 'open', 'arrived: the shared line is no longer open'));
    soft(() => assert.deepEqual({ ...sql('SELECT qty, updated, updated_by FROM products WHERE id = 93')[0] }, p93, 'arrived: the shared soap moved'));
    soft(() => assert.equal(sql("SELECT COUNT(*) AS n FROM products WHERE name = 'סבון כלים' AND private_to = 2 AND deleted IS NULL")[0].n, 1, 'arrived: no private soap of hers'));
    soft(() => assert.ok(!aviJournal(/מיכל.*(משחת שיניים|סבון כלים)/), 'Michal on the toothpaste or the soap in the shared journal'));
    // 2. what has no private kind isn't kept (blocker 2), and the answer doesn't say it was
    fresh();
    answer = () => ({ reply: 'אזכור שלא לקנות ביסלי גריל. שמרתי את המתכון לעוגת פרג. רשמתי שנשארה פשטידת תרד.', face: 'happy', actions: [
      { kind: 'lesson', text: 'לא לקנות ביסלי גריל' }, { kind: 'fact', key: 'habit', about: 'הבית', value: 'המפתח הרזרבי מתחת לעציץ', text: 'המפתח הרזרבי מתחת לעציץ' },
      { kind: 'leftover', text: 'פשטידת תרד' }, { kind: 'recipe', name: 'עוגת פרג', ingredients: 'קמח, פרג, ביצים' }] });
    r = await say(michal, 'שלא ידעו, תזכור שלא קונים ביסלי גריל ושהמפתח הרזרבי מתחת לעציץ, נשארה פשטידת תרד, ותשמור מתכון לעוגת פרג');
    if (r.proposal) await apply(michal, r.proposal.id);
    soft(() => assert.equal(sql("SELECT COUNT(*) AS n FROM lessons WHERE text LIKE '%ביסלי גריל%'")[0].n, 0, 'the rule was kept'));
    soft(() => assert.equal(sql("SELECT COUNT(*) AS n FROM facts WHERE value LIKE '%עציץ%'")[0].n, 0, 'the fact about the house was kept'));
    soft(() => assert.equal(sql("SELECT COUNT(*) AS n FROM leftovers WHERE text LIKE '%פשטידת תרד%'")[0].n, 0, 'the leftovers were kept'));
    soft(() => assert.equal(sql("SELECT COUNT(*) AS n FROM recipes WHERE name LIKE '%עוגת פרג%'")[0].n, 0, 'the recipe was kept'));
    soft(() => assert.ok(!/אזכור|שמרתי|רשמתי/.test(String(r.reply || '')), `the answer says it kept it: ${r.reply}`));
    const aviAll = async () => JSON.stringify(await state(avi)) + JSON.stringify((await call(avi, 'GET', '/api/chat')).data);
    const a2 = await aviAll(); soft(() => assert.ok(!/ביסלי גריל|עציץ|פשטידת תרד|עוגת פרג/.test(a2), `Avi sees it: ${a2.match(/.{0,120}(ביסלי גריל|עציץ|פשטידת תרד|עוגת פרג).{0,60}/)?.[0]}`));
    // 3. a fact: about the writer, hers alone; about someone else, not kept and not asked (blocker 3)
    fresh();
    answer = () => ({ reply: 'אזכור.', face: 'happy', actions: [
      { kind: 'fact', key: 'avoid', about: 'מיכל', value: 'קשיו', text: 'מיכל לא אוכלת קשיו' }, { kind: 'fact', key: 'avoid', about: 'אבי', value: 'פיסטוק', text: 'אבי לא אוכל פיסטוק' }] });
    r = await say(michal, 'שלא ידעו, תזכור שאני לא אוכלת קשיו ושאבי לא אוכל פיסטוק');
    if (r.proposal) await apply(michal, r.proposal.id);
    soft(() => assert.equal(sql("SELECT private FROM facts WHERE value = 'קשיו' AND about_id = 2")[0]?.private, 1, 'her own fact is not hers alone'));
    soft(() => assert.equal(sql("SELECT COUNT(*) AS n FROM facts WHERE value = 'פיסטוק'")[0].n, 0, 'the fact about Avi was kept'));
    const a3 = await aviAll(); soft(() => assert.ok(!/פיסטוק|קשיו/.test(a3), 'Avi sees it (or is asked about it)'));
    // 4. mineOf from outside is not taken
    sql("INSERT INTO products (id, name, count_type, qty, is_basic, created, updated, updated_by) VALUES (94, 'מלח גס', 'units', 3, 0, 1, 1, 1)");
    await act(avi, [{ kind: 'op', product_id: 94, mineOf: 94, op: { type: 'use', amount: 1 } }]);
    soft(() => assert.equal(sql("SELECT COUNT(*) AS n FROM products WHERE name = 'מלח גס' AND private_to IS NOT NULL")[0].n, 0, 'mineOf from outside made a private product'));
    soft(() => assert.equal(sql('SELECT qty FROM products WHERE id = 94')[0].qty, 2, 'the salt did not change'));
    assert.deepEqual(bad, []);
  });
  await check('P30', 'שער אחד אחרי סוד (worker/secret.js, 04/10): כל סוג שנזרק, מהמודל או מהשרת, לא משנה כלום שאבי רואה; שבת אחרי סוד פרטית; כלל מבחירה חוזרת לא נלמד; קנייה קבועה פרטית לא מוחקת את המשותפת; התשובה מאבדת רק את מה שלא נשמר', async () => {
    const bad = []; const soft = (f) => { try { f(); } catch (e) { bad.push(e.message.split('\n')[0]); } };
    const fresh = () => { sql('UPDATE chat SET ts = ts - 3600e3 WHERE user_id = 2'); sql("DELETE FROM settings WHERE key IN ('ask:2', 'askq:2')"); };
    const aviChat = async () => (JSON.stringify((await call(avi, 'GET', '/api/chat')).data).match(/"id":/g) || []).length;
    // what Avi could see of the house, as rows
    const house = async () => JSON.stringify({
      events: sql('SELECT COUNT(*) AS n FROM events WHERE private_to IS NULL')[0].n,
      lessons: sql('SELECT id, text FROM lessons'), leftovers: sql('SELECT id, text, gone, asked FROM leftovers'), recipes: sql('SELECT COUNT(*) AS n FROM recipes')[0].n,
      facts: sql('SELECT id, about, about_id, key, value, private, confirmed_by, ask_again FROM facts WHERE private = 0 ORDER BY id'),
      settings: sql("SELECT key, value FROM settings WHERE key IN ('moving', 'stores', 'catalog_area') ORDER BY key"),
      away: sql('SELECT * FROM away'), shopping: sql('SELECT * FROM shopping'),
      items: sql('SELECT id, status, approved, ordered, checked_by FROM list_items WHERE private_to IS NULL ORDER BY id'),
      products: sql('SELECT id, qty, deleted, updated_by FROM products WHERE private_to IS NULL ORDER BY id'),
      chat: await aviChat(),
    });
    const dropped = async (label, run) => { fresh(); const h0 = await house(); await run(); const h1 = await house(); soft(() => assert.equal(h1, h0, `${label}: Avi's house changed`)); };
    // from the model, as actions
    for (const [kind, a] of [['lesson', { text: 'לא לקנות ופלים' }], ['leftover', { text: 'מרק עדשים' }], ['recipe', { name: 'עוגת תפוזים', ingredients: 'תפוזים, קמח' }], ['moving', { date: '2026-12-01' }]]) {
      await dropped(kind, async () => { answer = () => ({ reply: 'לעדכן?', face: 'happy', actions: [{ kind, ...a }] }); const r = await say(michal, `בינינו, ${kind}`); if (r.proposal) await apply(michal, r.proposal.id); });
    }
    // from the model, as the house's states
    for (const [field, v] of [['away', { until: '2026-12-10' }], ['guests', { until: '2026-12-10' }], ['hosting', { name: 'יום הולדת', date: '2026-12-05' }], ['shopping', 'start'], ['catalog_area', 'מחסן']]) {
      await dropped(field, async () => { answer = () => ({ reply: 'בסדר.', face: 'happy', [field]: v }); const r = await say(michal, `בינינו, ${field}`); if (r.options?.[0]) await say(michal, r.options[0]); });
    }
    // what only the server adds: a card of a secret turn, as the chat writes it
    await act(yoavi, [{ kind: 'list_add', text: 'רובוט צעצוע' }]);
    const kidLine = sql("SELECT id FROM list_items WHERE text = 'רובוט צעצוע' AND approved = 0")[0]?.id;
    const fid = (key, value, extra) => { sql(`INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, ask_again, source, created, updated) VALUES ('person', 2, ?, ?, 1, ?, ?, ?, ?, 'chat', 1, 1)`, key, value, ...extra); return sql('SELECT MAX(id) AS id FROM facts')[0].id; };
    const pending = fid('likes', 'שקשוקה חריפה', [1, null, 0, null]), again = fid('training', 'ריצה', [2, 2, 0, 5]), preg = fid('pregnancy', 'כן', [2, 2, 1, null]);
    const ticked = sql("SELECT id FROM list_items WHERE private_to IS NULL AND status = 'open' AND approved = 1 LIMIT 1")[0]?.id;
    sql("UPDATE list_items SET status = 'checked', checked_by = 2, checked = 1 WHERE id = ?", ticked);
    for (const a of [{ kind: 'approve', item_id: kidLine, yes: true }, { kind: 'fact_confirm', id: pending, text: 'מיכל אוהבת שקשוקה חריפה' }, { kind: 'fact_keep', id: again }, { kind: 'fact_share', id: preg }, { kind: 'finish' }]) {
      await dropped(a.kind, async () => {
        const id = `p30-${a.kind}`; sql('INSERT INTO proposals (id, user_id, created, actions) VALUES (?, 2, ?, ?)', id, Date.now(), JSON.stringify({ actions: [a], context: 'report', secret: true }));
        await apply(michal, id);
      });
    }
    soft(() => assert.equal(sql('SELECT private FROM facts WHERE id = ?', preg)[0]?.private, 1, 'fact_share: her pregnancy was shared'));
    // a question of Shuki's own asked in a secret turn, answered "yes": the house's state isn't kept
    for (const ask of [{ actions: [], kitniyot: true }, { actions: [], away: { until: '2026-12-20' } }]) {
      await dropped(ask.kitniyot ? 'kitniyot' : 'away (asked)', async () => { fresh(); sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('ask:2', ?)", JSON.stringify({ ...ask, secret: true, done: 'סגור!', nope: 'בסדר.', ts: Date.now() })); const y = await say(michal, 'כן'); soft(() => assert.equal(y.reply, 'בסדר', `its "yes" (decision 7, r7b): ${y.reply}`)); });
    }
    soft(() => assert.equal(sql("SELECT COUNT(*) AS n FROM facts WHERE about = 'house' AND key = 'kitniyot'")[0].n, 0, 'kitniyot was kept'));
    // a shared fact about her doesn't change after a secret (the owner 04/10): not Shabbat (shared since P11), not "no longer
    // vegetarian", not a new value of a single-valued key; Avi sees nothing change. Since פ6 (question 50) each is kept for
    // her alone, a private row that wins over the shared one, so she no longer hears "לא היה מה לעדכן."; only what changes
    // nothing she sees ("אני שומרת שבת" over the shared "כן") still does
    const nothingN = async () => (JSON.stringify((await call(michal, 'GET', '/api/chat')).data).match(/לא היה מה לעדכן\./g) || []).length;
    if (!sql("SELECT id FROM facts WHERE about = 'person' AND about_id = 2 AND key = 'shabbat' AND private = 0").length) sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 2, 'shabbat', 'כן', 1, 2, 2, 0, 'settings', 1, 1)");
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 2, 'diet', 'צמחונית', 1, 2, 2, 0, 'chat', 1, 1)");
    for (const [label, text, out] of [
      ['Shabbat off', 'בינינו, הפסקתי לשמור שבת', { reply: 'בסדר.', face: 'happy' }],
      ['no longer vegetarian', 'בינינו, אני כבר לא צמחונית', { reply: 'אשכח.', face: 'happy', actions: [{ kind: 'fact_end', key: 'diet', value: 'צמחונית' }] }],
      ['a new diet', 'בינינו, אני טבעונית עכשיו. תזכור', { reply: 'אזכור.', face: 'happy', actions: [{ kind: 'fact', key: 'diet', value: 'טבעונית', text: 'מיכל טבעונית' }] }],
    ]) {
      fresh(); const n0 = await nothingN();
      await dropped(label, async () => { answer = () => out; const x = await say(michal, text); if (x.proposal) await apply(michal, x.proposal.id); else if (x.options?.[0]) await say(michal, x.options[0]); });
      const n1 = await nothingN(); soft(() => assert.equal(n1, n0, `${label}: she was told "לא היה מה לעדכן."`));
    }
    soft(() => assert.deepEqual(sql("SELECT key, value, ended FROM facts WHERE about = 'person' AND about_id = 2 AND key IN ('shabbat', 'diet') AND private = 1 ORDER BY key, value").map((x) => ({ ...x })), [{ key: 'diet', value: 'טבעונית', ended: null }, { key: 'shabbat', value: 'כן', ended: 1 }], 'her private rows'));
    // "אני שומרת שבת" in a secret, over the shared "כן" and her own "stopped": a change; again: nothing to update
    const keep = async () => { fresh(); answer = () => ({ reply: 'בסדר.', face: 'happy' }); const x = await say(michal, 'בינינו, אני שומרת שבת'); if (x.proposal) await apply(michal, x.proposal.id); else if (x.options?.[0]) await say(michal, x.options[0]); };
    await keep(); soft(() => assert.equal(sql("SELECT COUNT(*) AS n FROM facts WHERE about_id = 2 AND key = 'shabbat' AND private = 1")[0].n, 0, 'her ended Shabbat stayed'));
    { const n0 = await nothingN(); await keep(); const n1 = await nothingN(); soft(() => assert.ok(n1 > n0, '"אני שומרת שבת" over the shared "כן": not "לא היה מה לעדכן."')); }
    soft(() => assert.deepEqual(sql("SELECT key, value, private FROM facts WHERE about = 'person' AND about_id = 2 AND key IN ('shabbat', 'diet') AND private = 0 ORDER BY key").map((x) => ({ ...x })), [{ key: 'diet', value: 'צמחונית', private: 0 }, { key: 'shabbat', value: 'כן', private: 0 }], 'her shared facts changed'));
    // blocker 1: Shabbat after a secret, when the house doesn't know about hers, is hers alone
    sql("DELETE FROM facts WHERE about = 'person' AND about_id = 2 AND key = 'shabbat'");
    fresh(); answer = () => ({ reply: 'בסדר.', face: 'happy' });
    let r = await say(michal, 'בינינו, אני שומרת שבת'); if (r.proposal) await apply(michal, r.proposal.id); else if (r.options?.[0]) await say(michal, r.options[0]);
    soft(() => assert.equal(sql("SELECT private FROM facts WHERE about = 'person' AND about_id = 2 AND key = 'shabbat'")[0]?.private, 1, 'her Shabbat is not hers alone'));
    await say(avi, 'מה נשמע?');
    soft(() => assert.ok(!/מיכל: [^\n"]*shabbat/.test(JSON.stringify(requests.at(-1)?.system || '')), 'her Shabbat is in Avi\'s prompt'));
    // blocker 3: a pick for the third time, the third after a secret: no rule is learned, nothing is asked
    sql("INSERT INTO products (id, name, count_type, qty, is_basic, created, updated) VALUES (95, 'חלב סויה', 'units', 1, 0, 1, 1)");
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('pick:2:חלב', ?)", JSON.stringify({ id: 95, n: 2 }));
    fresh(); answer = () => ({ reply: 'איזה חלב?', face: 'confused', options: ['חלב', 'חלב סויה'] });
    await say(michal, 'בינינו, תוסיף חלב');
    answer = () => ({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'list_add', product_id: 95 }] });
    r = await say(michal, 'חלב סויה'); if (r.proposal) await apply(michal, r.proposal.id);
    const herChat = JSON.stringify((await call(michal, 'GET', '/api/chat')).data);
    if (/שאזכור ש[^"]*סויה/.test(herChat)) await say(michal, 'כן, תזכור');
    soft(() => assert.ok(!/שאזכור ש[^"]*סויה/.test(herChat), 'Shuki asked to remember the pick after a secret'));
    soft(() => assert.equal(sql("SELECT COUNT(*) AS n FROM lessons WHERE text LIKE '%סויה%'")[0].n, 0, 'a rule was learned from a pick after a secret'));
    // 4: her private weekly buy doesn't delete the house's of the same product
    sql("INSERT INTO routines (product_id, text, weekday, store, added_by, added, private_to) VALUES (7, NULL, 3, 'super', 1, 1, NULL)");
    fresh(); answer = () => ({ reply: 'לקבוע?', face: 'happy', actions: [{ kind: 'routine', product_id: 7, weekday: 4 }] });
    r = await say(michal, 'שלא ידעו, חלב כל שבוע'); if (r.proposal) await apply(michal, r.proposal.id);
    soft(() => assert.equal(sql('SELECT COUNT(*) AS n FROM routines WHERE product_id = 7 AND private_to IS NULL')[0].n, 1, 'her private weekly buy deleted the house\'s'));
    soft(() => assert.equal(sql('SELECT COUNT(*) AS n FROM routines WHERE product_id = 7 AND private_to = 2')[0].n, 1, 'no private weekly buy of hers'));
    // 5: the answer loses only what wasn't kept, and the buttons of "remember?"
    fresh(); answer = () => ({ reply: 'להוסיף טסט הריון לרשימה ולשמור את זה בינינו?', face: 'happy', options: ['כן, תזכור', 'לא צריך'], actions: [{ kind: 'list_add', text: 'טסט הריון' }, { kind: 'lesson', text: 'לא לספר על טסטים' }] });
    r = await say(michal, 'בינינו, תוסיף טסט הריון');
    soft(() => assert.ok(String(r.reply).startsWith('להוסיף טסט הריון לרשימה ולשמור את זה בינינו?'), `the answer: ${r.reply}`)); // the server adds "זה נשאר בינינו."
    soft(() => assert.ok(!(r.options || []).includes('כן, תזכור'), `the buttons: ${JSON.stringify(r.options)}`));
    if (r.proposal) await apply(michal, r.proposal.id);
    assert.deepEqual(bad, []);
  });
  await check('P31', 'כתיבות מחוץ לשער בתור של סוד (04/10, הבודק 1–6, הרשימה 4, 9, 13, 22): "הכנתי" לא נספר; "די לשאול" אחרי סוד פרטי; בחירה לא נספרת; שורה שנדחתה לא נספרת; התשובה לא אומרת חופשה או אורחים; סיום של עובדות מעורבות מסיים רק את הפרטית; ילד כמו היום; שאלה ממתינה של כרטיס שנדחה נושאת secret', async () => {
    const bad = []; const soft = (f) => { try { f(); } catch (e) { bad.push(e.message.split('\n')[0]); } };
    const fresh = () => { sql('UPDATE chat SET ts = ts - 3600e3 WHERE user_id IN (2, 3)'); sql("DELETE FROM settings WHERE key IN ('ask:2', 'askq:2', 'ask:3')"); };
    // 13: "we made it" in a secret turn isn't counted for the house
    await call(avi, 'POST', '/api/__recipes', { recipes: [{ name: 'עוגת גבינה', ingredients: 'גבינה, ביצים' }] });
    const rid = sql("SELECT id FROM recipes WHERE name = 'עוגת גבינה'")[0].id;
    fresh(); answer = () => ({ reply: 'איזה כיף!', face: 'happy' });
    await say(michal, 'הכנתי עוגת גבינה ליום ההולדת של אבי, שאבי לא ידע');
    soft(() => assert.equal(sql('SELECT COUNT(*) AS n FROM cooked_log WHERE recipe_id = ?', rid)[0].n, 0, 'cooked: counted in cooked_log'));
    soft(() => assert.equal(sql('SELECT cooked FROM recipes WHERE id = ?', rid)[0].cooked || 0, 0, 'cooked: recipes.cooked went up'));
    // 4: "די לשאול" right after a secret message is hers alone
    fresh(); answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await say(michal, 'בינינו, משהו קטן'); await say(michal, 'די לשאול');
    soft(() => assert.equal(sql("SELECT private FROM facts WHERE about = 'person' AND about_id = 2 AND key = 'no_ask'")[0]?.private, 1, 'no_ask: not hers alone'));
    sql("DELETE FROM facts WHERE about = 'person' AND about_id = 2 AND key = 'no_ask'");
    // 9: a pick in a secret turn isn't counted
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('pick:2:חלב', ?)", JSON.stringify({ id: 95, n: 1 }));
    fresh(); answer = () => ({ reply: 'איזה חלב?', face: 'confused', options: ['חלב', 'חלב סויה'] });
    await say(michal, 'בינינו, תוסיף חלב');
    answer = () => ({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'list_add', product_id: 95 }] });
    let r = await say(michal, 'חלב סויה'); if (r.proposal) await apply(michal, r.proposal.id);
    soft(() => assert.equal(JSON.parse(sql("SELECT value FROM settings WHERE key = 'pick:2:חלב'")[0]?.value || '{}').n, 1, 'pick: counted in a secret turn'));
    // 22: a line turned down on a secret card isn't counted for "שמתי לב"
    const rej0 = sql("SELECT COALESCE(SUM(count), 0) AS n FROM noticed WHERE key = 'rejects:7'")[0].n;
    fresh(); answer = () => ({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'list_add', product_id: 7 }, { kind: 'list_add', text: SECRET }] });
    r = await say(michal, 'בינינו, תוסיף חלב וקונדומים'); if (r.proposal) await apply(michal, r.proposal.id, { skip: [0] });
    soft(() => assert.equal(sql("SELECT COALESCE(SUM(count), 0) AS n FROM noticed WHERE key = 'rejects:7'")[0].n, rej0, 'rejects: a line turned down on a secret card was counted'));
    // 4 (the reviewer): the answer doesn't say a state of the house that wasn't kept
    for (const [field, v, reply, opts] of [['guests', { until: '2026-12-10' }, 'רשמתי שיש אורחים עד שבת.', undefined], ['away', { until: '2026-12-10' }, 'נסיעה טובה! להפעיל מצב חופשה?', ['כן, להפעיל', 'לא צריך']]]) {
      fresh(); answer = () => ({ reply, face: 'happy', [field]: v, ...(opts && { options: opts }) });
      const x = await say(michal, `בינינו, ${field}`);
      soft(() => assert.ok(!/אורחים|חופשה/.test(String(x.reply)), `${field}: the answer says it: ${x.reply}`));
      soft(() => assert.ok(!(x.options || []).length, `${field}: buttons: ${JSON.stringify(x.options)}`));
    }
    // 6: ending facts, one private and one shared: only the private one ends
    const fp = (value, priv) => { sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 2, 'likes', ?, 1, 2, 2, ?, 'chat', 1, 1)", value, priv); return sql('SELECT MAX(id) AS id FROM facts')[0].id; };
    const fPriv = fp('פלאפל', 1), fShared = fp('שווארמה', 0);
    fresh(); answer = () => ({ reply: 'אשכח.', face: 'happy', actions: [{ kind: 'fact_end', key: 'likes' }] });
    r = await say(michal, 'בינינו, אני כבר לא אוהבת את מה שאהבתי'); if (r.proposal) await apply(michal, r.proposal.id);
    soft(() => assert.equal(sql('SELECT COUNT(*) AS n FROM facts WHERE id = ?', fPriv)[0].n, 0, 'fact_end: her private one is still there'));
    soft(() => assert.equal(sql('SELECT COUNT(*) AS n FROM facts WHERE id = ?', fShared)[0].n, 1, 'fact_end: the shared one ended'));
    // 6: a child as before: Yoavi's shared Shabbat ends when he says so, also as a secret
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 3, 'shabbat', 'כן', 1, 3, 3, 0, 'settings', 1, 1)");
    fresh(); answer = () => ({ reply: 'בסדר.', face: 'happy' });
    r = await say(yoavi, 'בינינו, הפסקתי לשמור שבת'); if (r.proposal) await apply(yoavi, r.proposal.id); else if (r.options?.[0]) await say(yoavi, r.options[0]);
    soft(() => assert.equal(sql("SELECT COUNT(*) AS n FROM facts WHERE about = 'person' AND about_id = 3 AND key = 'shabbat'")[0].n, 0, 'child: his Shabbat didn\'t end as before'));
    // 3: a secret card turned down: the question waiting for it keeps `secret`
    fresh(); sql('INSERT INTO proposals (id, user_id, created, actions) VALUES (?, 2, ?, ?)', 'p31-later', Date.now(), JSON.stringify({ actions: [{ kind: 'list_add', text: 'גלולות' }], context: 'report', secret: true, ask: { actions: [{ kind: 'fact', key: 'likes', about: 'מיכל', value: 'x', text: 'x' }], q: 'האם תרצה שאזכור?', done: 'סגור, אזכור!', nope: 'בסדר.' } }));
    await call(michal, 'POST', '/api/proposals/p31-later/reject', {});
    soft(() => assert.equal(JSON.parse(sql("SELECT value FROM settings WHERE key = 'ask:2'")[0]?.value || '{}').secret, true, 'the waiting question of a turned-down secret card lost `secret`'));
    assert.deepEqual(bad, []);
  });
  await check('P32', 'כלל אחד (04/10): אחרי סוד, כל סוג מותר שהיה משנה, מסיים או מוחק שורה קיימת שאחר רואה לא עושה כלום, והיא שומעת "לא היה מה לעדכן."; לכל סוג ב-SECRET_ALLOWED יש כאן תרחיש', async () => {
    const bad = []; const soft = (f) => { try { f(); } catch (e) { bad.push(e.message.split('\n')[0]); } };
    const fresh = () => { sql('UPDATE chat SET ts = ts - 3600e3 WHERE user_id = 2'); sql("DELETE FROM settings WHERE key IN ('ask:2', 'askq:2')"); };
    const nothingN = async () => (JSON.stringify((await call(michal, 'GET', '/api/chat')).data).match(/לא היה מה לעדכן\./g) || []).length;
    // every row Avi sees that a secret could change
    const house = (withChat = true) => JSON.stringify({
      products: sql('SELECT id, name, qty, deleted, updated_by, counted, photo FROM products WHERE private_to IS NULL ORDER BY id'),
      items: sql('SELECT id, status, approved, ordered, checked_by, skipped FROM list_items WHERE private_to IS NULL ORDER BY id'),
      maybe: sql('SELECT id, text, decided, decision FROM maybe WHERE private_to IS NULL ORDER BY id'),
      routines: sql('SELECT id, product_id, text, weekday FROM routines WHERE private_to IS NULL ORDER BY id'),
      facts: sql('SELECT id, key, value FROM facts WHERE private = 0 ORDER BY id'),
      aliases: sql('SELECT alias, product_id FROM receipt_aliases ORDER BY alias'),
      events: sql('SELECT COUNT(*) AS n FROM events WHERE private_to IS NULL AND undone IS NULL')[0].n,
      ...(withChat && { aviChat: sql("SELECT COUNT(*) AS n FROM chat WHERE thread = 1")[0].n }),
    });
    const now = Date.now();
    sql("INSERT INTO products (id, name, count_type, qty, is_basic, created, updated, updated_by, counted) VALUES (101, 'שמן קנולה', 'units', 3, 0, 1, 1, 1, 1), (102, 'אורז בסמטי', 'units', 0, 0, 1, 1, 1, 1), (103, 'פסטה פנה', 'units', 0, 0, 1, 1, 1, 1), (104, 'קוסקוס', 'units', 0, 0, 1, 1, 1, 1), (105, 'סוכר חום', 'units', 2, 0, 1, 1, 1, 1)");
    await act(avi, [{ kind: 'list_add', product_id: 102 }, { kind: 'list_add', product_id: 103 }, { kind: 'list_add', product_id: 104 }]);
    const line = (p) => sql("SELECT id FROM list_items WHERE product_id = ? AND private_to IS NULL AND status != 'done'", p)[0]?.id;
    sql("UPDATE list_items SET status = 'checked', checked_by = 1, checked = 1, bought_qty = 1 WHERE id = ?", line(103));
    sql("INSERT INTO maybe (text, store, added_by, added, due_at, kind, repeat, private_to) VALUES ('לקחת ויטמין D', 'super', 2, ?, ?, 'remind', 'daily', NULL)", now, now + 864e5);
    sql("INSERT INTO routines (product_id, text, weekday, store, added_by, added, private_to) VALUES (101, NULL, 2, 'super', 2, 1, NULL)");
    sql("DELETE FROM facts WHERE about = 'person' AND about_id = 2 AND key IN ('kosher', 'shabbat')");
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 2, 'kosher', 'כן', 1, 2, 2, 0, 'chat', 1, 1), ('person', 2, 'shabbat', 'כן', 1, 2, 2, 0, 'settings', 1, 1)");
    const kosherId = sql("SELECT id FROM facts WHERE about = 'person' AND about_id = 2 AND key = 'kosher'")[0].id;
    sql("INSERT OR REPLACE INTO receipt_aliases (alias, product_id) VALUES ('שמן קנ', 101)");
    const card = async (a) => { const id = `p32-${a.kind}-${Math.random().toString(36).slice(2, 8)}`; sql('INSERT INTO proposals (id, user_id, created, actions) VALUES (?, 2, ?, ?)', id, Date.now(), JSON.stringify({ actions: [a], context: 'report', secret: true })); return apply(michal, id); };
    // each allowed kind: what it does after a secret to a row someone else sees; `nothing`: she hears "לא היה מה לעדכן."
    const SCEN = {
      create: { a: () => ({ kind: 'create', product: { name: 'שמן קנולה', qty: 1 } }) },
      list_add: { a: () => ({ kind: 'list_add', product_id: 102 }) },
      op: { a: () => ({ kind: 'op', product_id: 101, op: { type: 'use', amount: 1 } }) },
      edit: { a: () => ({ kind: 'edit', product_id: 101, fields: { name: 'שמן קנולה זך' } }) },
      delete: { a: () => ({ kind: 'delete', product_id: 105 }), nothing: true },
      confirm: { a: () => ({ kind: 'confirm', product_id: 105 }), nothing: true },
      check: { a: () => ({ kind: 'check', item_id: line(102) }) },
      arrived: { a: () => ({ kind: 'arrived', item_id: line(104) }) },
      order: { a: () => ({ kind: 'order', item_id: line(102) }) },
      list_remove: { a: () => ({ kind: 'list_remove', item_id: line(104) }), nothing: true },
      uncheck: { a: () => ({ kind: 'uncheck', item_id: line(103) }), nothing: true },
      keep: { a: () => ({ kind: 'keep', item_id: line(104) }), nothing: true },
      remind: { a: () => ({ kind: 'remind', off: true, text: 'לקחת ויטמין D' }), nothing: true },
      routine: { a: () => ({ kind: 'routine', off: true, product_id: 101 }), nothing: true },
      // פ6 (question 50): a shared fact about her changes for her alone, a private row that wins; Avi sees nothing change
      fact: { a: () => ({ kind: 'fact', key: 'kosher', about: 'מיכל', value: 'לא', text: 'מיכל לא שומרת כשרות' }) },
      shabbat: { a: () => ({ kind: 'shabbat', on: false }) },
      fact_end: { a: () => ({ kind: 'fact_end', key: 'kosher', ids: [kosherId] }) },
      undo: { before: async () => { await act(michal, [{ kind: 'list_add', text: 'גריסים' }]); }, a: () => ({ kind: 'undo' }), nothing: true },
      cancel: { a: () => ({ kind: 'cancel' }), say: 'בינינו, עזוב את זה' }, // never on a card: chatTurn takes it off first
      alias: { a: () => ({ kind: 'alias', product_id: sql("SELECT id FROM products WHERE name LIKE 'שמן קנולה%' AND private_to = 2 AND deleted IS NULL")[0]?.id ?? 101, alias: 'שמן קנ' }), nothing: true },
      photo: { a: () => ({ kind: 'photo', product_id: 101 }) },
      tell: { a: () => ({ kind: 'tell', to: 'אבי', text: 'היי' }), chat: true }, // goes to whom she named, as asked: no row changes
    };
    for (const kind of SECRET_ALLOWED) {
      const sc = SCEN[kind]; if (!sc) { bad.push(`${kind}: no scenario (a new allowed kind needs one)`); continue; }
      fresh(); if (sc.before) await sc.before();
      const h0 = house(!sc.chat), n0 = await nothingN();
      const r = sc.say ? (answer = () => ({ reply: 'בסדר.', face: 'happy', actions: [sc.a()] }), { status: 200, data: await say(michal, sc.say) }) : await card(sc.a());
      soft(() => assert.equal(r.status, 200, `${kind}: ${JSON.stringify(r.data)}`));
      soft(() => assert.equal(house(!sc.chat), h0, `${kind}: a row Avi sees changed`));
      const n1 = await nothingN(); if (sc.nothing) soft(() => assert.equal(n1, n0 + 1, `${kind}: she wasn't told "לא היה מה לעדכן."`));
    }
    // "stop asking" the house sees, after a secret: "אפשר לשאול שוב" doesn't take it away
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 2, 'no_ask', 'ללמוד', 1, 2, 2, 0, 'chat', 1, 1)"); // NO_ASK in worker/shuki.js
    fresh(); answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await say(michal, 'בינינו, משהו קטן'); const x = await say(michal, 'אפשר לשאול שוב');
    soft(() => assert.equal(sql("SELECT COUNT(*) AS n FROM facts WHERE about = 'person' AND about_id = 2 AND key = 'no_ask' AND private = 0")[0].n, 1, 'no_ask: the shared one went'));
    soft(() => assert.equal(x.reply, 'סגור, אחזור לשאול לפעמים.', `no_ask (פ6: hers alone, a private ended row): ${x.reply}`));
    assert.deepEqual(bad, []);
  });
  await check('P33', 'הבודק 04/10: עצירת תזכורת בסוד עוצרת רק את הפרטית גם כשיש משותפת באותו טקסט; מוצר פרטי (בסוד או בלי) לא יוצר מקום חדש; עובדה פרטית לא מוחקת משותפת עם ערך ארוך; ילד כמו היום (עצירת תזכורת ו-undo)', async () => {
    const bad = []; const soft = (f) => { try { f(); } catch (e) { bad.push(e.message.split('\n')[0]); } };
    const fresh = () => { sql('UPDATE chat SET ts = ts - 3600e3 WHERE user_id IN (2, 3)'); sql("DELETE FROM settings WHERE key IN ('ask:2', 'askq:2', 'ask:3')"); };
    const card = async (t, uid, a, secret = true) => { const id = `p33-${a.kind}-${Math.random().toString(36).slice(2, 8)}`; sql('INSERT INTO proposals (id, user_id, created, actions) VALUES (?, ?, ?, ?)', id, uid, Date.now(), JSON.stringify({ actions: [a], context: 'report', secret })); return apply(t, id); };
    const now = Date.now();
    // 1: two daily reminders with the same text, one the house sees and one hers
    sql("INSERT INTO maybe (text, store, added_by, added, due_at, kind, repeat, private_to) VALUES ('לקחת ברזל', 'super', 2, ?, ?, 'remind', 'daily', NULL), ('לקחת ברזל', 'super', 2, ?, ?, 'remind', 'daily', 2)", now, now + 864e5, now, now + 864e5);
    fresh(); await card(michal, 2, { kind: 'remind', off: true, text: 'לקחת ברזל' });
    soft(() => assert.equal(sql("SELECT decided FROM maybe WHERE text = 'לקחת ברזל' AND private_to IS NULL")[0].decided, null, 'reminder: the shared one stopped'));
    soft(() => assert.ok(sql("SELECT decided FROM maybe WHERE text = 'לקחת ברזל' AND private_to = 2")[0].decided, 'reminder: her private one didn\'t stop'));
    // 2: a private product makes no new place, with a secret or without one; an existing place is fine
    const places = () => sql('SELECT name FROM locations').map((x) => x.name);
    fresh(); await card(michal, 2, { kind: 'create', product: { name: 'ויטמין פרטי', qty: 1, location_id: 'התיק של מיכל' } });
    soft(() => assert.ok(!places().includes('התיק של מיכל'), 'place: a secret private product made a new place'));
    await card(michal, 2, { kind: 'create', product: { name: 'גלולה למחרת', qty: 1, location_id: 'המגירה הסודית' } }, false); // a card from the chat, no secret
    soft(() => assert.ok(!places().includes('המגירה הסודית'), 'place: a private product (no secret) made a new place'));
    soft(() => assert.equal(sql("SELECT location_id FROM products WHERE name = 'גלולה למחרת' AND private_to = 2")[0]?.location_id, null, 'place: the new name isn\'t empty'));
    const known = places()[0];
    await card(michal, 2, { kind: 'create', product: { name: 'בדיקת ביוץ', qty: 1, location_id: known } }, false);
    soft(() => assert.ok(sql("SELECT location_id FROM products WHERE name = 'בדיקת ביוץ'")[0]?.location_id != null, 'place: an existing place wasn\'t kept'));
    const aviPlaces = JSON.stringify((await state(avi))?.locations || []); soft(() => assert.ok(!aviPlaces.includes('התיק של מיכל'), 'place: in Avi\'s state'));
    // 3: a long value of a shared multi-valued fact isn't deleted by her secret one
    const long = 'שקשוקה עם הרבה פלפל חריף ועגבניות טריות '.repeat(6).trim();
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 2, 'likes', ?, 1, 2, 2, 0, 'chat', 1, 1)", long.slice(0, 200));
    fresh(); await card(michal, 2, { kind: 'fact', key: 'likes', about: 'מיכל', value: long, text: 'מיכל אוהבת שקשוקה' });
    soft(() => assert.equal(sql("SELECT COUNT(*) AS n FROM facts WHERE about_id = 2 AND key = 'likes' AND private = 0 AND value = ?", long.slice(0, 200))[0].n, 1, 'fact: the shared long value went'));
    // a child as before: Yoavi stops his own (shared) reminder, and undoes his own action
    sql("INSERT INTO maybe (text, store, added_by, added, due_at, kind, repeat, private_to) VALUES ('לצחצח שיניים', 'super', 3, ?, ?, 'remind', 'daily', NULL)", now, now + 864e5);
    fresh(); await card(yoavi, 3, { kind: 'remind', off: true, text: 'לצחצח שיניים' });
    soft(() => assert.ok(sql("SELECT decided FROM maybe WHERE text = 'לצחצח שיניים'")[0].decided, 'child: his reminder didn\'t stop'));
    await act(yoavi, [{ kind: 'list_add', text: 'מדבקות דינוזאורים' }]);
    fresh(); await card(yoavi, 3, { kind: 'undo' });
    soft(() => assert.equal(sql("SELECT COUNT(*) AS n FROM list_items WHERE text = 'מדבקות דינוזאורים'")[0].n, 0, 'child: his undo didn\'t undo'));
    assert.deepEqual(bad, []);
  });
  // פ7 (decision 3, the owner 06/10, r7b): no private product's name on a locked screen; Shuki's own pushes about one aren't sent at all
  await check('P35', 'תוקף של מוצר פרטי בלבד: למיכל אין פוש "תוקף", ו-med_warned לא נכתב', async () => {
    sql('UPDATE products SET expires = NULL'); sql('UPDATE batches SET expires = NULL');
    sql("UPDATE devices SET digest_sent = NULL");
    sql('UPDATE products SET qty = 2, expires = ? WHERE id = ?', local(3, 12), pid(SECRET));
    const d = (await call(avi, 'POST', '/api/__schedule', { now: local(2, 20) })).data;
    assert.ok(d.digestFor, JSON.stringify(d).slice(0, 300));
    const hers = JSON.stringify(d.digestFor[2] || []);
    assert.ok(!hers.includes('תוקף') && !hers.includes(SECRET), hers);
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key LIKE ?", `med_warned:${pid(SECRET)}:%`)[0].n, 0);
  });

  await check('P36', '"אולי לקנות" פרטי אחרי 48 שעות: בלי פוש, לא נספר ב-maybeAsked, ו-asked מלא', async () => {
    sql('UPDATE maybe SET asked = 1 WHERE asked IS NULL');
    const old = Date.now() - 3 * 864e5;
    sql("INSERT INTO maybe (text, product_id, store, added_by, added, kind, private_to) VALUES ('ג׳ל סיכה', NULL, 'super', 2, ?, 'maybe', 2), (?, ?, 'super', 2, ?, 'maybe', NULL)", old, SECRET, pid(SECRET), old);
    const d = (await call(avi, 'POST', '/api/__schedule', { now: local(0, 20) })).data; // weekly runs at the 20:00 hour
    assert.equal(d.maybeAsked, undefined, JSON.stringify(d).slice(0, 300));
    assert.ok(!JSON.stringify(d.maybeBodies || []).includes('סיכה') && !JSON.stringify(d.maybeBodies || []).includes(SECRET), JSON.stringify(d.maybeBodies));
    assert.equal(sql("SELECT COUNT(*) AS n FROM maybe WHERE added = ? AND asked IS NULL", old)[0].n, 0, 'not marked asked');
    // a shared one, the same day, is still asked, with its name
    sql("INSERT INTO maybe (text, store, added_by, added, kind) VALUES ('גבינה צהובה', 'super', 1, ?, 'maybe')", old);
    sql("DELETE FROM settings WHERE key LIKE 'pushes:%'");
    const e = (await call(avi, 'POST', '/api/__schedule', { now: local(0, 20) })).data;
    assert.equal(e.maybeAsked, 1, JSON.stringify(e).slice(0, 300));
    assert.deepEqual(e.maybeBodies, ['האם להוסיף גבינה צהובה לרשימה, או לוותר הפעם?']);
  });

  await check('P37', 'סירי: כרטיס עם מוצר פרטי שולח "האם לאשר?" בנוסח הכללי, בלי השם; כרטיס של חלב עם החלב', async () => {
    const key = (await call(michal, 'POST', '/api/shortcut/token')).data.token;
    const siri = async (text) => { const r = await fetch(`http://127.0.0.1:${PORT}/api/say`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ text }) }); return { text: await r.text(), pushed: r.headers.get('x-shuki-pushed'), body: decodeURIComponent(r.headers.get('x-shuki-push-body') || '') }; };
    sql('UPDATE chat SET ts = ts - 3600e3'); sql("DELETE FROM settings WHERE key IN ('ask:2', 'askq:2')");
    answer = () => ({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'list_add', text: SECRET }] });
    const a = await siri(`תוסיף ${SECRET}`);
    assert.equal(a.pushed, '1', JSON.stringify(a));
    assert.equal(a.body, 'ההצעה מחכה לאישור שלך באפליקציה.', JSON.stringify(a));
    sql('UPDATE chat SET ts = ts - 3600e3');
    answer = () => ({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'list_add', product_id: 7 }] });
    const b = await siri('תוסיף חלב');
    assert.equal(b.pushed, '1', JSON.stringify(b));
    assert.match(b.body, /חלב/); assert.ok(!b.body.includes(SECRET), b.body);
  });

  await check('P38', '"בינינו, נשארו 2 ביצים" על ביצים משותפות באריזות: לתאום הפרטי של מיכל count_type pack ו-pack_size 12', async () => {
    sql("INSERT INTO products (id, name, count_type, unit, pack_size, qty, created, updated) VALUES (380, 'ביצים', 'pack', 'תבנית', 12, 24, 1, 1)");
    sql('UPDATE chat SET ts = ts - 3600e3'); sql("DELETE FROM settings WHERE key IN ('ask:2', 'askq:2')");
    answer = () => ({ reply: 'לעדכן?', face: 'happy', actions: [{ kind: 'op', product_id: 380, op: { type: 'set', qty: 2 } }] });
    const r = await say(michal, 'בינינו, נשארו 2 ביצים');
    assert.ok(r.proposal, JSON.stringify(r));
    assert.equal((await apply(michal, r.proposal.id)).status, 200);
    const mine = sql("SELECT count_type, unit, pack_size FROM products WHERE name = 'ביצים' AND private_to = 2 AND deleted IS NULL")[0];
    assert.deepEqual({ ...mine }, { count_type: 'pack', unit: 'תבנית', pack_size: 12 });
    assert.equal(sql('SELECT qty FROM products WHERE id = 380')[0].qty, 24, 'the shared one changed');
  });

  await check('P39', '"ויתרתם על N": מיכל עוצרת תזכורת פרטית ("לא צריך"); המספר של אבי ושל מיכל לא עולה (פ9, r12 q013)', async () => {
    const n = async (t) => (await state(t)).maybeDroppedThisMonth;
    const [a0, m0] = [await n(avi), await n(michal)];
    sql("INSERT INTO maybe (text, product_id, store, added_by, added, kind, private_to) VALUES ('ג׳ל סיכה P39', NULL, 'super', 2, ?, 'maybe', 2), (?, ?, 'super', 2, ?, 'maybe', NULL)", Date.now(), SECRET, pid(SECRET), Date.now());
    for (const m of sql("SELECT id FROM maybe WHERE decided IS NULL AND (text = 'ג׳ל סיכה P39' OR (product_id = ? AND private_to IS NULL))", pid(SECRET))) {
      const r = await call(michal, 'POST', '/api/maybe', { id: m.id, decision: 'drop' }); assert.equal(r.status, 200, JSON.stringify(r.data));
    }
    assert.deepEqual([await n(avi), await n(michal)], [a0, m0]);
    // a shared one still counts
    sql("INSERT INTO maybe (text, store, added_by, added, kind) VALUES ('גבינה בולגרית', 'super', 2, ?, 'maybe')", Date.now());
    await call(michal, 'POST', '/api/maybe', { id: sql("SELECT id FROM maybe WHERE text = 'גבינה בולגרית'")[0].id, decision: 'drop' });
    assert.deepEqual([await n(avi), await n(michal)], [a0 + 1, m0 + 1]);
  });

  // פ29 (question 49, decision 7, the owner 06/10, r7b)
  await check('P40', 'בחירה חוזרת (pick:) נספרת גם כשהמודל זרק שגיאה, ולא בתור של סוד', async () => {
    const fresh = () => { sql('UPDATE chat SET ts = ts - 3600e3 WHERE user_id = 2'); sql("DELETE FROM settings WHERE key IN ('ask:2', 'askq:2')"); };
    const pick = () => JSON.parse(sql("SELECT value FROM settings WHERE key = 'pick:2:חלב'")[0]?.value || 'null');
    sql("DELETE FROM settings WHERE key = 'pick:2:חלב'");
    const which = () => ({ reply: 'איזה חלב?', face: 'confused', options: ['חלב', 'חלב סויה'] });
    fresh(); answer = which; await say(michal, 'תוסיף חלב');
    answer = () => ({ __status: 400 });
    const e = await say(michal, 'חלב סויה');
    assert.equal(e.error, 'model', JSON.stringify(e));
    assert.deepEqual(pick(), { id: 95, n: 1 });
    // the same after a secret: not counted
    fresh(); answer = which; await say(michal, 'בינינו, תוסיף חלב');
    answer = () => ({ __status: 400 });
    await say(michal, 'חלב סויה');
    assert.deepEqual(pick(), { id: 95, n: 1 }, 'counted after a secret');
  });

  await check('P41', 'substitute בסוד כשיש תחליף משותף זהה: אין כרטיס או שאלה שמציגים אותו ואחר כך "לא היה מה לעדכן."', async () => {
    sql('UPDATE chat SET ts = ts - 3600e3 WHERE user_id = 2'); sql("DELETE FROM settings WHERE key IN ('ask:2', 'askq:2')");
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 2, 'substitute', ?, 1, 2, 2, 0, 'chat', 1, 1)", JSON.stringify({ from: { id: 7, name: 'חלב' }, to: { id: 95, name: 'חלב סויה' } }));
    answer = () => ({ reply: 'אזכור.', face: 'happy', actions: [{ kind: 'fact', key: 'substitute', about: 'מיכל', value: 'חלב → חלב סויה', text: 'במקום חלב מיכל לוקחת חלב סויה' }] });
    const r = await say(michal, 'בינינו, במקום חלב אני לוקחת חלב סויה');
    assert.equal(r.proposal, undefined, JSON.stringify(r));
    assert.match(r.reply, /^לא היה מה לעדכן\./, r.reply);
    assert.equal(sql("SELECT COUNT(*) AS n FROM facts WHERE about_id = 2 AND key = 'substitute'")[0].n, 1);
  });

  await check('P42', 'כרטיס סוד עם alias על שם שכבר של מוצר אחר: השם נשאר על המוצר הקודם', async () => {
    sql("INSERT OR REPLACE INTO receipt_aliases (alias, product_id) VALUES ('חלב טרה 1 ליטר', 7)");
    const id = `p42-${Date.now()}`;
    sql('INSERT INTO proposals (id, user_id, created, actions) VALUES (?, 2, ?, ?)', id, Date.now(), JSON.stringify({ actions: [{ kind: 'alias', product_id: pid(SECRET), alias: 'חלב טרה 1 ליטר' }], context: 'report', secret: true }));
    assert.equal((await apply(michal, id)).status, 200);
    assert.equal(sql("SELECT product_id FROM receipt_aliases WHERE alias = 'חלב טרה 1 ליטר'")[0].product_id, 7);
  });

  // question 88 (a) (the owner 06/10, r7b): the number of someone else's private product isn't in the JSON of /api/state
  await check('P43', 'מצרך של מתכון שמחובר למוצר פרטי של מיכל: אצל אבי product_id ריק ב-/api/state, אצל מיכל המספר', async () => {
    const s = pid(SECRET);
    sql("INSERT INTO recipes (id, name, ingredients, text, added_by, added, parsed) VALUES (25043, 'ערב רומנטי', 'קונדומים, יין', 'x', 1, 1, 1)");
    sql("INSERT INTO recipe_ingredients (recipe_id, pos, name, product_id, line) VALUES (25043, 0, 'קונדומים', ?, 'קונדומים'), (25043, 1, 'חלב', 7, 'חלב')", s);
    const ings = async (t) => (await state(t)).recipes.find((r) => r.id === 25043)?.ings.map((i) => i.product_id);
    assert.deepEqual(await ings(avi), [null, 7]);
    assert.deepEqual(await ings(michal), [s, 7]);
    assert.equal(sql('SELECT product_id FROM recipe_ingredients WHERE recipe_id = 25043 AND pos = 0')[0].product_id, s, 'the link itself changed');
    sql('DELETE FROM recipe_ingredients WHERE recipe_id = 25043'); sql('DELETE FROM recipes WHERE id = 25043');
  });

  await check('P44', 'כרטיס שהחלק המשותף שלו לא עושה כלום (ביטול סימון על שורה שנסגרה) והחלק הפרטי כן: לא "לא היה מה לעדכן.", ויש מה לבטל (הבודק, פ8)', async () => {
    sql("INSERT INTO list_items (id, product_id, text, store, source, status, added_by, added, approved) VALUES (25044, NULL, 'נרות', 'super', 'manual', 'done', 1, 1, 1)");
    sql(`INSERT INTO proposals (id, user_id, created, actions) VALUES ('p-25044', 1, ${Date.now()}, '${JSON.stringify({ actions: [{ kind: 'uncheck', item_id: 25044 }, { kind: 'list_add', text: 'מתנה למיכל', private: true }], context: 'report' })}')`);
    const r = (await apply(avi, 'p-25044')).data;
    assert.ok(r.ok && !r.nothing && r.undoable, JSON.stringify(r));
    assert.equal(sql("SELECT private_to FROM list_items WHERE text = 'מתנה למיכל'")[0]?.private_to, 1, 'the private line wasn\'t saved');
    assert.ok(!JSON.stringify((await call(avi, 'GET', '/api/chat')).data.messages).includes('לא היה מה לעדכן'), 'stamped "לא היה מה לעדכן."');
    sql("DELETE FROM list_items WHERE id = 25044 OR text = 'מתנה למיכל'");
  });

  await check('P13', 'שחזור יום מהעותק המלא: המוצר הפרטי נשאר', async () => {
    await call(avi, 'POST', '/api/__schedule', { now: Date.now() });
    const day = (await call(avi, 'GET', '/api/backups')).data.backups[0]?.day;
    assert.ok(day);
    assert.equal((await call(avi, 'POST', '/api/backups/restore', { day })).status, 200);
    assert.equal(sql('SELECT private_to FROM products WHERE name = ? AND deleted IS NULL', SECRET)[0]?.private_to, 2);
  });

  // question 105 (א), the owner 07/10: before she leaves, her private product has an alias, a photo, a recipe line, and her
  // "סיימתי קניות" is a shared journal line that holds her private list line for undo
  let gone = null, finishEv = null, michalId = 2; // stage 13, d4: whoever joins with her name is someone new
  await check('P45', 'לפני שמיכל עוזבת: לקונדומים שלה יש כינוי בקבלה, תמונה, שורה במתכון ושורה ביומן הפרטי; "סיימתי קניות" שלה משותף ומחזיק את השורה הפרטית שלה', async () => {
    gone = sql('SELECT id FROM products WHERE name = ? AND private_to = 2 AND deleted IS NULL', SECRET)[0].id;
    sql("INSERT OR REPLACE INTO receipt_aliases (alias, product_id) VALUES ('קונד דורקס 12', ?)", gone);
    sql("INSERT OR REPLACE INTO product_photos (product_id, data, updated) VALUES (?, 'data:image/jpeg;base64,AAAA', 1)", gone);
    sql("INSERT INTO recipes (id, name, ingredients, text, added_by, added, parsed) VALUES (25045, 'ערב', 'מה שבמגירה', 'x', 1, 1, 1)");
    sql("INSERT INTO recipe_ingredients (recipe_id, pos, name, product_id, line) VALUES (25045, 0, 'מה שבמגירה', ?, 'מה שבמגירה')", gone); // not the name: the recipe is Avi's
    if (!sql("SELECT id FROM list_items WHERE product_id = ? AND status != 'done'", gone).length) assert.equal((await act(michal, [{ kind: 'list_add', product_id: gone }])).status, 200);
    if (!sql("SELECT id FROM list_items WHERE product_id = 7 AND status != 'done'").length) assert.equal((await act(michal, [{ kind: 'list_add', product_id: 7 }])).status, 200);
    sql("UPDATE list_items SET status = 'checked', checked_by = 2, checked = 1, store = 'super' WHERE product_id IN (?, 7) AND status != 'done'", gone);
    assert.equal((await act(michal, [{ kind: 'finish' }])).status, 200);
    finishEv = sql("SELECT id, summary, private_to, before FROM events WHERE user_id = 2 AND type = 'finish' ORDER BY ts DESC, id DESC LIMIT 1")[0];
    assert.equal(finishEv.private_to, null, 'the line is shared');
    assert.ok(Object.values(JSON.parse(finishEv.before).list_items).some((r) => r?.product_id === gone && r.private_to === 2), 'her private line isn\'t in it');
    assert.ok(sql('SELECT COUNT(*) AS n FROM events WHERE private_to = 2 AND summary LIKE ?', `%${SECRET}%`)[0].n > 0, 'no private journal line with the name');
    sql('UPDATE events SET ts = ts - 1 WHERE user_id = 2 AND id != ?', finishEv.id); // "סיימתי קניות" is her last action
  });
  await check('P14', 'מיכל עוזבת: המוצרים הפרטיים שלה נמחקים בשקט', async () => {
    assert.equal((await call(avi, 'POST', '/api/members', { id: 2, remove: true })).status, 200);
    assert.equal(sql('SELECT COUNT(*) AS n FROM products WHERE private_to = 2 AND deleted IS NULL')[0].n, 0);
    assert.equal(sql('SELECT COUNT(*) AS n FROM list_items WHERE private_to = 2')[0].n, 0);
    assert.ok(!JSON.stringify(await state(avi)).includes(SECRET));
  });
  await check('P46', 'אחרי שמיכל עזבה (שאלה 105 (א)): השם של המוצר הפרטי שלה לא נמצא באף טבלה; השורות הפרטיות שלה ביומן נמחקו; "סיימתי קניות" כבר לא מחזיק את השורות שלה; המתכון נשאר, בלי הקישור', async () => {
    assert.equal(sql('SELECT COUNT(*) AS n FROM products WHERE id = ? OR name LIKE ?', gone, `%${SECRET}%`)[0].n, 0, 'products');
    assert.equal(sql('SELECT COUNT(*) AS n FROM events WHERE summary LIKE ?1 OR before LIKE ?1', `%${SECRET}%`)[0].n, 0, 'events: summary or before');
    assert.equal(sql('SELECT COUNT(*) AS n FROM events WHERE private_to = 2')[0].n, 0, 'her private journal lines');
    assert.equal(sql('SELECT COUNT(*) AS n FROM list_items WHERE product_id = ? OR text LIKE ?', gone, `%${SECRET}%`)[0].n, 0, 'list_items');
    for (const t of ['receipt_aliases', 'product_photos', 'product_log', 'batches', 'maybe', 'routines', 'noticed']) assert.equal(sql(`SELECT COUNT(*) AS n FROM ${t} WHERE product_id = ?`, gone)[0].n, 0, t);
    assert.equal(sql('SELECT COUNT(*) AS n FROM proposals WHERE actions LIKE ?', `%${SECRET}%`)[0].n, 0, 'her cards (question 106)');
    assert.deepEqual(sql('SELECT product_id FROM recipe_ingredients WHERE recipe_id = 25045').map((r) => r.product_id), [null], 'the recipe line, unlinked');
    const b = JSON.parse(sql('SELECT before FROM events WHERE id = ?', finishEv.id)[0].before);
    assert.ok(!Object.values(b.list_items).some((r) => r?.private_to === 2 || r?.product_id === gone), JSON.stringify(b.list_items));
    assert.ok(!Object.keys(b.products || {}).map(Number).includes(gone) && !Object.keys(b.batches || {}).map(Number).includes(gone));
    assert.ok(Object.values(b.list_items).some((r) => r?.product_id === 7), 'the milk line, shared, stays in it');
  });
  await check('P47', 'מישהי בשם מיכל מצטרפת אחרי שמיכל יצאה: מספר חדש (שלב 13, d4), בלי המוצר הפרטי; "בטל" שלה לא נוגע ב"סיימתי קניות" של מיכל, ולא יוצר את המוצר הפרטי והשורה שלו לא נוצרים מחדש', async () => {
    const a = await call(avi, 'POST', '/api/members', { add: { name: 'מיכל', gender: 'f' } });
    assert.equal(a.status, 200, JSON.stringify(a.data)); assert.notEqual(a.data.id, 2); michalId = a.data.id;
    const back = (await call(null, 'POST', '/api/pair', { code: a.data.code })).data.token; assert.ok(back);
    assert.ok(!JSON.stringify(await state(back)).includes(SECRET), 'her state');
    const u = await call(back, 'POST', '/api/undo');
    assert.notEqual(u.data?.undone, finishEv.id, "the newcomer undid the leaver's action");
    assert.equal(sql('SELECT undone FROM events WHERE id = ?', finishEv.id)[0].undone, null);
    // the leaver's own undo, as before (question 105): the product and her line aren't made again
    sql('UPDATE users SET active = 1 WHERE id = 2'); sql("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('247247', 2, 9999999999999)");
    const old = (await call(null, 'POST', '/api/pair', { code: '247247' })).data.token;
    const u2 = await call(old, 'POST', '/api/undo');
    sql('UPDATE users SET active = 0 WHERE id = 2'); sql('DELETE FROM devices WHERE user_id = 2');
    assert.equal(u2.status, 200, JSON.stringify(u2.data)); assert.equal(u2.data.undone, finishEv.id);
    assert.equal(sql('SELECT COUNT(*) AS n FROM products WHERE id = ? OR name LIKE ?', gone, `%${SECRET}%`)[0].n, 0, 'the product made again');
    assert.equal(sql('SELECT COUNT(*) AS n FROM list_items WHERE product_id = ? OR private_to = 2', gone)[0].n, 0, 'her line made again');
    assert.equal(sql("SELECT status FROM list_items WHERE product_id = 7 AND status != 'done'")[0]?.status, 'checked', 'the milk line');
    assert.ok(!JSON.stringify(await state(back)).includes(SECRET), 'her state after undo');
  });
  await check('P48', '"בטל" על שורה ביומן שמחזיקה מוצר שכבר לא קיים, ושורה ברשימה שלו: מדלג עליהם, בלי ליצור אותם ובלי להיכשל (שאלה 105)', async () => {
    const before = { products: { 99901: { id: 99901, name: 'מוצר שהלך', count_type: 'units', qty: 1, store: 'super', created: 1, updated: 1 }, 7: sql('SELECT * FROM products WHERE id = 7')[0] },
      batches: { 99901: [] }, list_items: { 99902: { id: 99902, product_id: 99901, store: 'super', source: 'manual', status: 'open', added: 1 } }, created: { products: [], list_items: [] } };
    const id = Number(sql("INSERT INTO events (ts, user_id, type, summary, before) VALUES (?, 1, 'edit', 'אבי עדכן', ?)", Date.now() + 60e3, JSON.stringify(before)).lastInsertRowid);
    const u = await call(avi, 'POST', '/api/undo');
    assert.equal(u.status, 200, JSON.stringify(u.data)); assert.equal(u.data.undone, id);
    assert.equal(sql('SELECT COUNT(*) AS n FROM products WHERE id = 99901')[0].n, 0, 'the product made again');
    assert.equal(sql('SELECT COUNT(*) AS n FROM list_items WHERE id = 99902')[0].n, 0, 'its list line made again');
  });
  await check('P49', 'שחזור מגיבוי שנעשה לפני שמיכל עזבה (P13), אחרי שהיא עזבה שוב: שום דבר פרטי שלה לא חוזר, לא מוצר, לא שורה ברשימה ולא שורה פרטית ביומן (the owner 08/10)', async () => {
    assert.equal((await call(avi, 'POST', '/api/members', { id: michalId, remove: true })).status, 200);
    const day = (await call(avi, 'GET', '/api/backups')).data.backups.map((b) => b.day).find((d) => !d.startsWith('before:'));
    assert.ok(day, 'no daily copy');
    assert.equal((await call(avi, 'POST', '/api/backups/restore', { day })).status, 200);
    assert.equal(sql('SELECT COUNT(*) AS n FROM products WHERE private_to = 2 OR name LIKE ?', `%${SECRET}%`)[0].n, 0, 'her private product came back');
    assert.equal(sql('SELECT COUNT(*) AS n FROM list_items WHERE private_to = 2')[0].n, 0, 'her private list line came back');
    for (const t of ['maybe', 'routines']) assert.equal(sql(`SELECT COUNT(*) AS n FROM ${t} WHERE private_to = 2`)[0].n, 0, t);
    assert.equal(sql('SELECT COUNT(*) AS n FROM events WHERE private_to = 2 OR summary LIKE ?1 OR before LIKE ?1', `%${SECRET}%`)[0].n, 0, 'her private journal lines came back');
    assert.ok(sql('SELECT COUNT(*) AS n FROM products WHERE private_to IS NULL AND deleted IS NULL')[0].n > 0, 'the shared house came back');
  });
  await check('P50', 'מיכל חוזרת לבית (או מישהי אחרת בשם מיכל, אותו מספר), ואז שחזור מגיבוי שנעשה לפני שעזבה: הדברים הפרטיים הישנים שלה לא חוזרים (left:, the owner 08/10)', async () => {
    assert.ok(Number(sql("SELECT value FROM settings WHERE key = 'left:2'")[0]?.value) > 0, 'when she left wasn\'t kept');
    const a = await call(avi, 'POST', '/api/members', { add: { name: 'מיכל', gender: 'f' } });
    assert.equal(a.status, 200, JSON.stringify(a.data)); assert.notEqual(a.data.id, 2); michalId = a.data.id;
    const day = (await call(avi, 'GET', '/api/backups')).data.backups.map((b) => b.day).find((d) => !d.startsWith('before:'));
    assert.equal((await call(avi, 'POST', '/api/backups/restore', { day })).status, 200);
    assert.equal(sql('SELECT COUNT(*) AS n FROM products WHERE private_to = 2 OR name LIKE ?', `%${SECRET}%`)[0].n, 0, 'her old private product came back to her');
    assert.equal(sql('SELECT COUNT(*) AS n FROM events WHERE private_to = 2 OR summary LIKE ?1 OR before LIKE ?1', `%${SECRET}%`)[0].n, 0, 'her old private journal lines came back');
    assert.ok(Number(sql("SELECT value FROM settings WHERE key = 'left:2'")[0]?.value) > 0, 'the restore lost when she left');
    assert.ok(!Object.keys((await state(avi)).settings || {}).some((k) => k.startsWith('left:')), 'when she left is in the state');
  });
  await check('P34', 'D8 לגבר (53): "רק אתה תראה את המוצר הזה."', async () => {
    answer = () => ({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'create', product: { name: 'אמצעי מניעה', qty: 0 } }, { kind: 'list_add', text: 'אמצעי מניעה' }] });
    const ra = await say(avi, 'צריך אמצעי מניעה');
    assert.ok((ra.proposal?.lines || []).some((l) => (l.detail || '').includes('רק אתה תראה את המוצר הזה.')), JSON.stringify(ra.proposal?.lines));
  });
  // stage 8 (docs/stage8-plan.md, "שלושה כללים"; question 21): Shuki's own marks about a person in settings go when they
  // leave, and a copy from before they left doesn't bring them back. Michal is back from P50 (id 2); Avi's marks stay.
  const MARKS = (u) => [`ask_once:fish:${u}`, `ask_once:suggest:${u}`, `holiday:${u}:2026-10-13`, `period_done:${u}`, `likes_asked:${u}`, `recipe_tip:${u}`];
  const marksOf = (u) => sql(`SELECT key FROM settings WHERE key IN (${MARKS(u).map(() => '?').join(',')}) ORDER BY key`, ...MARKS(u)).map((r) => r.key);
  await check('P51', 'מיכל יוצאת מהבית: הסימנים של שוקי עליה (ask_once, holiday, period_done, likes_asked, recipe_tip) נמחקים, וגם period_end של עובדה שכבר לא קיימת; של אבי נשארים', async () => {
    for (const k of [...MARKS(michalId), ...MARKS(1), 'ask_once:fish:12', 'holiday:21:2026-10-13']) sql('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', k, '1');
    const kept = sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 1, 'period', 'קיטו', 1, 1, 1, 0, 'chat', 1, 1)").lastInsertRowid;
    sql('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?), (?, ?)', `period_end:${kept}`, '1', 'period_end:999999', '1');
    assert.equal((await call(avi, 'POST', '/api/members', { id: michalId, remove: true })).status, 200);
    assert.deepEqual(marksOf(michalId), [], 'her marks stayed');
    assert.equal(marksOf(1).length, MARKS(1).length, "Avi's marks went too");
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key IN ('ask_once:fish:12', 'holiday:21:2026-10-13')")[0].n, 2, 'a mark of someone whose id starts the same went');
    assert.equal(sql('SELECT COUNT(*) AS n FROM settings WHERE key = ?', `period_end:${kept}`)[0].n, 1, "the mark of a fact that's still there went");
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'period_end:999999'")[0].n, 0, "the mark of a fact that's gone stayed");
  });
  await check('P52', 'מיכל חוזרת, ושחזור מגיבוי שנעשה לפני שעזבה, ושיש בו את הסימנים שלה: הם לא חוזרים; של אבי חוזרים', async () => {
    const leaver = michalId; assert.notEqual((await call(avi, 'POST', '/api/members', { add: { name: 'מיכל', gender: 'f' } })).data.id, leaver);
    const left = Number(sql('SELECT value FROM settings WHERE key = ?', `left:${leaver}`)[0].value);
    const src = sql("SELECT day FROM backups WHERE day NOT LIKE 'before:%' ORDER BY created DESC LIMIT 1")[0].day;
    const bk = JSON.parse(sql('SELECT data FROM backups WHERE day = ? ORDER BY part', src).map((r) => r.data).join(''));
    bk.made = left - 60e3; // a copy made a minute before she left, with her marks in it
    bk.settings = [...(bk.settings || []).filter((r) => !/^(ask_once|holiday|period_done|likes_asked|recipe_tip|period_end):/.test(r.key)), ...[...MARKS(leaver), ...MARKS(1), 'period_end:999998'].map((key) => ({ key, value: '1' }))];
    sql('INSERT INTO backups (day, part, data, created) VALUES (?, 0, ?, ?)', 'p52', JSON.stringify(bk), left - 60e3);
    assert.equal((await call(avi, 'POST', '/api/backups/restore', { day: 'p52' })).status, 200);
    assert.deepEqual(marksOf(leaver), [], 'her marks came back with the copy');
    assert.equal(marksOf(1).length, MARKS(1).length, "Avi's marks didn't come back from the copy");
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'period_end:999998'")[0].n, 0, 'the mark of a fact that is gone came back');
  });
  await check('P52א', 'שחזור מגיבוי שאין בו אף אחד שיצא: period_end של עובדה שנמחקה מאז לא חוזר', async () => {
    const src = sql("SELECT day FROM backups WHERE day NOT LIKE 'before:%' ORDER BY created DESC LIMIT 1")[0].day;
    const bk = JSON.parse(sql('SELECT data FROM backups WHERE day = ? ORDER BY part', src).map((r) => r.data).join(''));
    bk.made = Date.now(); // after everyone came back: nobody is gone
    bk.settings = [...(bk.settings || []).filter((r) => !/^period_end:/.test(r.key)), { key: 'period_end:999997', value: '1' }];
    sql('INSERT INTO backups (day, part, data, created) VALUES (?, 0, ?, ?)', 'p52a', JSON.stringify(bk), Date.now());
    assert.equal((await call(avi, 'POST', '/api/backups/restore', { day: 'p52a' })).status, 200);
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'period_end:999997'")[0].n, 0, 'the mark came back');
  });
  // stage 9, task 0 (docs/stage9-plan.md): only what the app reads leaves settings in the state, and only the house's settings
  // and my own marks in a download. Michal is back (id 2), on a new phone: since stage 13 (d4) whoever joined with her name in
  // P52 is someone new, so the test brings her back itself
  const now2 = sql("SELECT id FROM users WHERE name = 'מיכל' AND active = 1")[0]?.id;
  if (now2 && now2 !== 2) { sql("UPDATE users SET active = 0, name = 'מיכל' || char(8288, 8288, 8288, 8288, 8288, 8288, 8288, 8288, 8288) WHERE id = ?", now2); sql('DELETE FROM devices WHERE user_id = ?', now2); }
  sql("UPDATE users SET active = 1, name = 'מיכל' WHERE id = 2");
  const pair = async (id, code) => { sql('INSERT OR REPLACE INTO pairing_codes (code, user_id, expires) VALUES (?, ?, 9999999999999)', code, id); return (await call(null, 'POST', '/api/pair', { code })).data.token; };
  assert.equal(sql('SELECT active FROM users WHERE id = 2')[0]?.active, 1, 'Michal is in the house');
  michal = await pair(2, '262626');
  sql("DELETE FROM settings WHERE key IN ('joinfood:2', 'joinlife:2')"); // her new phone's food question isn't what's tested here
  const exp = async (t) => (await call(t, 'GET', '/api/export')).data;
  const keysIn = (rows) => (Array.isArray(rows) ? rows.map((r) => r.key) : Object.keys(rows || {}));
  await check('P61', 'אבי ויואבי לא מקבלים במצב ובהורדה אף סימן של מיכל (שאלה ממתינה, התור שלה, עובדה, תקופה, תמונה); מיכל מקבלת בהורדה רק את שלה, ובמצב רק את מה שהאפליקציה קוראת', async () => {
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 2, 'training', 'ריצה', 1, 2, 2, 0, 'chat', 1, 1)");
    const fid = sql('SELECT MAX(id) AS id FROM facts')[0].id;
    const hers = ['ask:2', 'askq:2', `preg_asked:${fid}`, `period_end:${fid}`, 'period_done:2', 'lastphoto:2', 'ask_once:likes:2', 'pick:2:חלב'];
    for (const k of hers) sql('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', k, k === 'askq:2' ? '[]' : '{"x":1}');
    try {
      for (const [who, t] of [['אבי', avi], ['יואבי', yoavi]]) {
        const s = keysIn((await state(t)).settings), e = keysIn((await exp(t)).settings);
        for (const k of hers) { assert.ok(!s.includes(k), `${k} in ${who}'s state`); assert.ok(!e.includes(k), `${k} in ${who}'s download`); }
        assert.ok(s.every((k) => k === 'digest_hour' || k.startsWith(`child_chat:${who === 'אבי' ? 1 : 3}:`)), `${who}'s state: ${s}`);
      }
      const ms = keysIn((await state(michal)).settings);
      assert.ok(ms.every((k) => k === 'digest_hour' || k.startsWith('child_chat:2:')), `her state: ${ms}`);
      const me = keysIn((await exp(michal)).settings);
      for (const k of ['ask:2', 'askq:2', `preg_asked:${fid}`, `period_end:${fid}`, 'lastphoto:2', 'ask_once:likes:2', 'pick:2:חלב']) assert.ok(me.includes(k), `${k} isn't in her own download`);
      assert.ok(!me.includes('period_done:2'), 'period_done went out (never, also to her)');
      for (const t of [michal, avi, yoavi]) assert.ok(keysIn((await exp(t)).settings).includes('digest_hour'), 'the house\'s settings aren\'t in the download');
    } finally { sql(`DELETE FROM settings WHERE key IN (${hers.map(() => '?').join(',')})`, ...hers); sql('DELETE FROM facts WHERE id = ?', fid); } // a failure here doesn't spill into P62
  });
  await check('P61א', 'הסינון רק בגבול של /api/state: "אזור קטלוג נוכחי" עדיין מגיע לפרומפט', async () => {
    const was = sql("SELECT value FROM settings WHERE key = 'catalog_area'")[0]?.value;
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('catalog_area', 'מקרר')");
    answer = () => ({ reply: 'סגור!', face: 'happy' });
    await say(avi, 'מה נשמע?');
    assert.match(requests.at(-1).system.map((x) => x.text).join('\n'), /אזור קטלוג נוכחי: מקרר/);
    assert.ok(!('catalog_area' in (await state(avi)).settings), 'catalog_area is in the state');
    if (was == null) sql("DELETE FROM settings WHERE key = 'catalog_area'"); else sql("UPDATE settings SET value = ? WHERE key = 'catalog_area'", was);
  });
  await check('P62', 'הפרעת אכילה: השאלה הממתינה של מיכל (עם עובדת health) לא מגיעה לאבי וליואבי, במצב ובהורדה', async () => {
    answer = () => ({ reply: 'אני כאן איתך. זה נשמע קשה.', face: 'sad', eating: true, personal: true });
    const r = await say(michal, 'אני מקיאה אחרי כל ארוחה');
    assert.match(r.reply || '', /שאזכור את זה ולא אדבר/, r.reply);
    assert.match(sql("SELECT value FROM settings WHERE key = 'ask:2'")[0]?.value || '', /health/, 'her question isn\'t waiting');
    for (const t of [avi, yoavi]) {
      for (const x of [(await state(t)).settings, (await exp(t)).settings]) {
        const txt = JSON.stringify(x);
        assert.ok(!keysIn(x).includes('ask:2'), 'ask:2 went out');
        assert.doesNotMatch(txt, /health|קלוריות/, txt.slice(0, 300));
      }
    }
    assert.equal((await say(michal, 'לא צריך')).reply, 'בסדר, לא אזכור.');
    sql("DELETE FROM settings WHERE key LIKE 'distress:2%' OR key = 'eating:2'");
  });
  // stage 9, מ32: a private product's edit to a place that doesn't exist keeps its place, and makes none
  await check('P56', 'מ32: מוצר פרטי במקרר, edit עם location_id "מגירה של מיכל": המקום נשאר המקרר, ולא נוצר מקום חדש', async () => {
    const fridge = sql("SELECT id FROM locations WHERE name = 'מקרר'")[0].id;
    sql("INSERT INTO products (name, count_type, qty, location_id, private_to, created, updated) VALUES ('ויטמין D', 'units', 1, ?, 2, 1, 1)", fridge);
    const id = pid('ויטמין D');
    const r = await act(michal, [{ kind: 'edit', product_id: id, fields: { location_id: 'מגירה של מיכל', target: 2 } }]);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(sql('SELECT location_id FROM products WHERE id = ?', id)[0].location_id, fridge, 'the place was emptied');
    assert.equal(sql('SELECT target FROM products WHERE id = ?', id)[0].target, 2, 'the rest of the edit');
    assert.equal(sql("SELECT COUNT(*) AS n FROM locations WHERE name = 'מגירה של מיכל'")[0].n, 0, 'a new place');
    sql('DELETE FROM products WHERE id = ?', id);
  });
} finally {
  srv.kill(); mock.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} private-product checks passed`);
if (failed.length) { console.log(log.split('\n').filter((l) => /error|Error/.test(l)).slice(-8).join('\n')); process.exit(1); }
