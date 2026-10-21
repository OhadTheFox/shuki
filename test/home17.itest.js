// The last round for home use (17/10), on the Node server with a fake model that answers in the shape the instructions ask
// for. Each check fails on the code before its fix (6ca7415).
//   H1 (ש3): an admin's only phone, with no other admin who has one, isn't disconnected (the server refuses, not only the app)
//   H2 (ש4): an open question ("מה יש במקרר?", "מה מבדיל ביניהם?") comes without the model's buttons; a closed one keeps them
//   H5 (ש12; home19 (8)): a place that isn't in the house ("מעל המקרר", the words written at home on 16/10) comes as the card itself, marked new
//   H6 (ש1+ש7): the same product in another container: asked; "כן" one product (open and one closed), "לא" two
//   H7 (ש2): a mapping's button approves its waiting card first
//   H8 (ש8): "נעצור כאן": the list card only after the answer about the regular products
//   H9 (ש9): a grown-up's second phone gets a code, a child's doesn't; the grown-up hears that a phone joined as them
//   H10 (ש10): "spoke of Passover this week" reads only what people wrote, in the shared threads and the reader's own
//   H12 (ש14): the list's lines from a recipe ("גמבות ברצועות") become the base name, once; two that become one: one stays
//   H14 (ש15): smoked paprika open and running out with another one closed, a regular with a minimum of one: not on the list
// Run: node --disable-warning=ExperimentalWarning test/home17.itest.js
import './fetch-retry.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DIR = '/tmp/shuki-test/shuki-home17'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const PORT = 8901, MOCK = 8902;

// Avi (admin), Michal; Itai, a child with a phone; products and list lines from a recipe for H12 (the hourly job runs at start)
const db0 = new DatabaseSync(`${DIR}/shuki.db`);
db0.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) { db0.exec(readFileSync(`migrations/${f}`, 'utf8')); db0.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f); }
db0.exec(readFileSync('test/fixture-house.sql', 'utf8'));
db0.exec("INSERT INTO users (id, name, gender, role, active, created) VALUES (3, 'איתי', 'm', 'child', 1, 0)");
db0.exec("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999), ('222222', 2, 9999999999999), ('333333', 3, 9999999999999), ('111112', 1, 9999999999999)");
const T = Date.now() - 86400e3;
db0.exec(`INSERT INTO products (id, name, count_type, qty, created, updated) VALUES (901, 'גמבה', 'units', 0, ${T}, ${T}), (902, 'שום', 'units', 0, ${T}, ${T})`);
db0.exec(`INSERT INTO list_items (id, product_id, text, store, source, status, added) VALUES
  (801, NULL, 'גמבות ברצועות', 'super', 'manual', 'open', ${T}), (802, NULL, 'שום פרוסות', 'super', 'manual', 'open', ${T + 1}),
  (803, NULL, 'שום קצוץ', 'super', 'manual', 'open', ${T + 2}), (804, NULL, 'גדושה פפריקה מתוקה', 'super', 'manual', 'open', ${T + 3}),
  (805, NULL, 'פטרוזיליה קצוצה', 'super', 'manual', 'done', ${T + 4}), (806, NULL, 'נרות', 'super', 'manual', 'open', ${T + 5})`);
db0.close();

let answer = () => ({ reply: 'אני פה!', face: 'happy' });
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => {
  const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'tool_use', name: body.tools?.[0]?.name || 'respond', input: answer(body) }], usage: { input_tokens: 1, output_tokens: 1 } }));
}); }).listen(MOCK, '127.0.0.1');
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/node.js'], { env: { ...process.env, PORT: String(PORT), DB_PATH: `${DIR}/shuki.db`, ANTHROPIC_API_KEY: 't', ANTHROPIC_URL: `http://127.0.0.1:${MOCK}/v1/messages`, RETRY_MS: '1', CHAT_PER_MINUTE: '1000', RUN_SCHEDULE_ON_START: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
const call = async (t, m, p, b) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch { /* text */ }
  return { status: r.status, data, text };
};
const sql = (q, ...a) => { const d = new DatabaseSync(`${DIR}/shuki.db`); try { return /^\s*select/i.test(q) ? d.prepare(q).all(...a) : d.prepare(q).run(...a); } finally { d.close(); } };
const say = async (t, text) => (await call(t, 'POST', '/api/chat', { text })).data;
const apply = async (t, r) => { assert.ok(r?.proposal?.id, `no card: ${JSON.stringify(r).slice(0, 300)}`); const x = await call(t, 'POST', `/api/proposals/${r.proposal.id}/apply`, {}); assert.equal(x.status, 200, x.text); return x.data; };
const act = (t, actions) => call(t, 'POST', '/api/actions', { op_id: `h17-${Math.random()}`, ts: Date.now(), actions });
const product = (name) => sql('SELECT * FROM products WHERE name = ? AND deleted IS NULL', name)[0];
const onList = (name) => sql("SELECT i.* FROM list_items i JOIN products p ON p.id = i.product_id WHERE p.name = ? AND i.status = 'open'", name)[0];
const placeOf = (name) => sql('SELECT l.name FROM products p JOIN locations l ON l.id = p.location_id WHERE p.name = ? AND p.deleted IS NULL', name)[0]?.name;
const state = async (t) => (await call(t, 'GET', '/api/state')).data;
const results = [];
async function check(id, name, fn) {
  try { await fn(); results.push({ id, ok: true }); console.log('✓', id, name); }
  catch (e) { results.push({ id, ok: false }); console.log('✗', id, name, '\n   ', e.message.slice(0, 600)); }
}
const create = (name, more = {}) => ({ kind: 'create', product: { name, count_type: 'units', qty: 1, category_id: 'שימורים ורטבים', location_id: 'ארון מטבח', ...more } });

let avi, michal, itai, avi2, mapCard;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${PORT}`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  await new Promise((r) => setTimeout(r, 1500)); // the hourly job at start (H12)
  [avi, michal, itai] = await Promise.all(['111111', '222222', '333333'].map(async (code) => (await call(null, 'POST', '/api/pair', { code })).data.token));

  /* ---------- H1 ---------- */
  await check('H1-1', 'הטלפון היחיד של המנהל, ואין עוד מנהל עם טלפון: /api/logout מחזיר 409 בנוסח המאושר, והמכשיר נשאר', async () => {
    const d = (await call(avi, 'GET', '/api/devices')).data;
    assert.equal(d.onlyPhone, true, JSON.stringify(d).slice(0, 200));
    const r = await call(avi, 'POST', '/api/logout');
    assert.equal(r.status, 409, r.text);
    assert.equal(r.data.error, 'זה המכשיר היחיד שלך, ואין עוד מנהל עם טלפון. כדי לנתק אותו, קודם חבר טלפון נוסף.');
    assert.equal((await call(avi, 'GET', '/api/state')).status, 200, 'the phone was disconnected');
  });
  await check('H1-2', 'מבוגר שאינו מנהל מתנתק כמו היום; מנהל עם טלפון נוסף מתנתק מאחד מהם', async () => {
    assert.equal((await call(michal, 'GET', '/api/devices')).data.onlyPhone, false);
    avi2 = (await call(null, 'POST', '/api/pair', { code: '111112' })).data.token;
    assert.equal((await call(avi, 'GET', '/api/devices')).data.onlyPhone, false);
    const r = await call(avi2, 'POST', '/api/logout');
    assert.equal(r.status, 200, r.text);
    assert.equal((await call(avi, 'GET', '/api/devices')).data.onlyPhone, true, 'back to one');
  });

  /* ---------- H2 ---------- */
  await check('H2-1', 'שאלה פתוחה עם כפתורים שהמודל המציא ("מה יש במקרר?", "מה מבדיל ביניהם?"): בלי הכפתורים', async () => {
    answer = () => ({ reply: 'נשמע טוב. מה יש במקרר?', face: 'happy', options: ['חלב', 'ביצים', 'אין שם כלום'] });
    assert.equal((await say(avi, 'יאללה')).options, undefined);
    answer = () => ({ reply: 'מה מבדיל ביניהם?', face: 'confused', options: ['טעם', 'צבע', 'מותג'] });
    assert.equal((await say(avi, 'יש עוד רוטב חריף')).options, undefined);
  });
  await check('H2-2', 'בחירה מרשימה סגורה ("איזה חלב?") נשארת עם הכפתורים', async () => {
    answer = () => ({ reply: 'האם נגמר החלב או שצריך לקנות?', face: 'confused', options: ['נגמר', 'צריך לקנות'] });
    assert.deepEqual((await say(avi, 'חלב')).options, ['נגמר', 'צריך לקנות']);
  });

  /* ---------- H5: the words written at home, 16/10 18:17 ---------- */
  const above = 'מעל המקרר יש ככה: שלושה סופגי לחות, שתי קופסאות שימורים של מוטי (עגבניות חתוכות), בקבוק ליטר של שמן קנולה של כמעט מלא';
  const aboveAnswer = () => ({ reply: 'איזה כיף למפות עוד פינה! האם להוסיף את כל מה שמצאת מעל המקרר?', face: 'happy', actions: [
    create('ספוגי לחות', { qty: 3, category_id: 'ניקיון', place_said: 'מעל המקרר' }), create('עגבניות חתוכות משומרות', { qty: 2, place_said: 'מעל המקרר' }), create('שמן קנולה', { count_type: 'inuse', is_open: true, qty: 0, place_said: 'מעל המקרר' })] });
  // home19 (8): the card is the question: no "האם להוסיף אותו למקומות האחסון?" before it (was H5-1 to H5-3 of 17/10)
  await check('H5-1', '"מעל המקרר" (לא ברשימת המקומות): הכרטיס מיד, עם "אין לי עדיין מקום בשם" ו"(מקום חדש)"; בלי כפתורים', async () => {
    answer = aboveAnswer;
    const r = await say(avi, above);
    assert.match(r.reply, /^אין לי עדיין מקום בשם "מעל המקרר"\. כשהכרטיס יאושר, הוא יתווסף למקומות האחסון\./);
    assert.ok(!r.options?.length, JSON.stringify(r.options));
    assert.ok(r.proposal?.lines?.length === 3, JSON.stringify(r).slice(0, 300));
    assert.match(r.proposal.lines[0].detail || '', /\(מקום חדש\)/);
    assert.ok(!product('שמן קנולה'), 'already in the stock');
    await apply(avi, r);
    assert.ok(sql("SELECT 1 FROM locations WHERE name = 'מעל המקרר'").length, 'no such place');
    for (const n of ['ספוגי לחות', 'עגבניות חתוכות משומרות', 'שמן קנולה']) assert.equal(placeOf(n), 'מעל המקרר', n);
  });
  await check('H5-3', 'כרטיס עם מקום חדש שנדחה: בלי מקום חדש', async () => {
    answer = () => ({ reply: 'האם להוסיף?', face: 'happy', actions: [create('תירס גמדי', { place_said: 'על המדף העליון' })] });
    const r1 = await say(avi, 'על המדף העליון יש תירס גמדי');
    assert.ok(r1.proposal, JSON.stringify(r1).slice(0, 300));
    await call(avi, 'POST', `/api/proposals/${r1.proposal.id}/reject`, {});
    assert.ok(!sql("SELECT 1 FROM locations WHERE name = 'על המדף העליון'").length, 'a new place');
  });

  /* ---------- H6 ---------- */
  await check('H6-1', 'פפריקה מעושנת פתוחה במזווה, ו"פפריקה מעושנת סגורה" חדשה: "יש כבר פפריקה מעושנת במזווה. האם זו אותה פפריקה?"', async () => {
    await act(avi, [{ kind: 'create', product: { name: 'פפריקה מעושנת', count_type: 'inuse', is_open: 1, level: 'little', qty: 0, is_basic: 1, target: 1, location_id: 'מזווה' } }]);
    answer = () => ({ reply: 'האם ככה?', face: 'happy', actions: [create('פפריקה מעושנת סגורה', { location_id: 'מזווה' })] });
    const r = await say(avi, 'יש גם פפריקה מעושנת סגורה במכל של 100 גרם');
    assert.equal(r.reply, 'יש כבר פפריקה מעושנת במזווה. האם זו אותה פפריקה?');
    assert.deepEqual(r.options, ['כן, אותו מוצר', 'לא, מוצר אחר']);
    assert.ok(!r.proposal);
  });
  await check('H6-2', '"כן, אותו מוצר": מוצר אחד, פתוח ועוד אחד סגור; לא ברשימה (ש15: מינימום אחד, ואחד סגור)', async () => {
    await apply(avi, await say(avi, 'כן, אותו מוצר'));
    const p = product('פפריקה מעושנת');
    assert.ok(p.count_type === 'inuse' && p.is_open === 1 && p.qty === 1, JSON.stringify(p));
    assert.ok(!product('פפריקה מעושנת סגורה') && !product('פפריקה מעושנת נוספת'), 'a second product');
    assert.ok(!onList('פפריקה מעושנת'), 'on the list');
  });
  await check('H6-3', 'שניים באותו כרטיס ו"לא, מוצר אחר": שני מוצרים, והשני "צנוברים נוספים"', async () => {
    answer = () => ({ reply: 'האם ככה?', face: 'happy', actions: [create('צנוברים', { location_id: 'מזווה' }), create('צנוברים פתוחים', { count_type: 'inuse', is_open: true, qty: 0, location_id: 'מזווה' })] });
    const r = await say(avi, 'יש צנוברים וגם צנוברים פתוחים');
    assert.equal(r.reply, 'יש כבר צנוברים במזווה. האם אלה אותם צנוברים?');
    await apply(avi, await say(avi, 'לא, מוצר אחר'));
    assert.ok(product('צנוברים') && product('צנוברים נוספים'), JSON.stringify(sql("SELECT name FROM products WHERE name LIKE 'צנוברים%'")));
  });

  /* ---------- H7, H8: a mapping ---------- */
  await check('H7', 'כרטיס מיפוי פתוח ולחיצה על "נמשיך למפות": הכרטיס מאושר קודם, ואז התשובה', async () => {
    answer = () => ({ reply: 'יש! המקרר ממופה', face: 'happy', catalog_area: 'מקרר', options: ['סיימנו למפות את המקרר', 'נמשיך למפות', 'נעצור כאן'], actions: [create('קוטג׳', { category_id: 'מוצרי חלב, גבינות וביצים', location_id: 'מקרר' }), create('חרדל', { level: 'little', location_id: 'מקרר' })] });
    const r = await say(avi, 'במקרר יש קוטג׳ ונשאר מעט חרדל');
    assert.ok(r.proposal && r.options?.length === 3, JSON.stringify(r).slice(0, 300)); mapCard = r.proposal.id;
    answer = () => ({ reply: 'מה עוד יש במקרר?', face: 'happy' });
    await say(avi, 'נמשיך למפות');
    assert.equal(sql('SELECT status FROM proposals WHERE id = ?', r.proposal.id)[0].status, 'applied');
    assert.ok(product('קוטג׳') && product('חרדל'), 'not in the stock');
  });
  await check('H8', '"נעצור כאן": השאלה על הקבועים לבד, בלי כרטיס הרשימה; הכרטיס אחרי התשובה', async () => {
    if (mapCard && sql('SELECT status FROM proposals WHERE id = ?', mapCard)[0]?.status === 'pending') await call(avi, 'POST', `/api/proposals/${mapCard}/apply`, {}); // on its own, H7 or not
    const cottage = product('קוטג׳'); assert.ok(cottage, 'no cottage');
    answer = () => ({ reply: 'מה מכל זה תמיד צריך להיות בבית?', face: 'happy' });
    const r1 = await say(avi, 'נעצור כאן');
    assert.ok(!r1.proposal, `a card with the question: ${JSON.stringify(r1.proposal?.lines)}`);
    answer = () => ({ reply: 'סגור! עכשיו אני מכיר את הבית', face: 'happy', actions: [{ kind: 'edit', product_id: cottage.id, fields: { is_basic: true, target: 1 } }] });
    const r2 = await say(avi, 'קוטג׳');
    assert.ok((r2.proposal?.lines || []).some((l) => /חרדל/.test(l.text)), JSON.stringify(r2.proposal?.lines));
  });

  /* ---------- H9 ---------- */
  await check('H9', 'קוד לטלפון נוסף של מבוגר: כן, והוא שומע שטלפון חדש התחבר בשמו; לילד שיש לו טלפון: לא', async () => {
    const c = await call(avi, 'POST', '/api/devices/code', { user_id: 2 });
    assert.equal(c.status, 200, c.text);
    assert.equal((await call(null, 'POST', '/api/pair', { code: c.data.code })).status, 200);
    const m = (await call(michal, 'GET', '/api/chat')).data.messages;
    const line = 'טלפון חדש התחבר אליי עכשיו בשם שלך. אם זו לא את, את יכולה לנתק אותו בהגדרות, ב"מכשירים".';
    assert.ok(m.some((x) => (x.content?.reply ?? x.reply) === line), 'no line');
    assert.ok(!(await call(avi, 'GET', '/api/chat')).data.messages.some((x) => (x.content?.reply ?? x.reply) === line), 'Avi sees it');
    assert.equal((await call(avi, 'POST', '/api/devices/code', { user_id: 3 })).status, 409);
  });

  /* ---------- H10 ---------- */
  await check('H10', 'פסח: תשובה של שוקי או צ\'אט פרטי של אחר לא מדליקים את הפאנל; הודעה של אדם בשרשור משותף או אצלי כן', async () => {
    const now = Date.now();
    sql("INSERT INTO chat (ts, user_id, role, thread, content) VALUES (?, NULL, 'shuki', NULL, ?)", now - 60e3, JSON.stringify({ reply: 'בפסח אפשר להכין מצה בריי', face: 'happy' }));
    sql("INSERT INTO chat (ts, user_id, role, thread, content) VALUES (?, 2, 'user', 2, ?)", now - 50e3, JSON.stringify({ text: 'מה קונים לפסח?' }));
    assert.equal((await state(avi)).pesachPanel, false, 'Avi');
    assert.equal((await state(michal)).pesachPanel, true, 'Michal, her own message');
    sql("INSERT INTO chat (ts, user_id, role, thread, content) VALUES (?, 2, 'user', NULL, ?)", now - 40e3, JSON.stringify({ text: 'פסח בעוד חודש' }));
    assert.equal((await state(avi)).pesachPanel, true, 'Avi, a shared thread');
  });

  /* ---------- H12 ---------- */
  await check('H12', 'שורות ממתכון ברשימה: "גמבות ברצועות" ← גמבה, "שום פרוסות" ו"שום קצוץ" ← שורה אחת של שום, "גדושה פפריקה מתוקה" ← "פפריקה מתוקה"; מה שנקנה ו"נרות" כמו שהם', async () => {
    const row = (id) => sql('SELECT product_id, text, status FROM list_items WHERE id = ?', id)[0];
    assert.deepEqual({ ...row(801) }, { product_id: 901, text: null, status: 'open' });
    assert.deepEqual({ ...row(802) }, { product_id: 902, text: null, status: 'open' });
    assert.equal(row(803), undefined, 'the second garlic stays');
    assert.equal(row(804).text, 'פפריקה מתוקה');
    assert.equal(row(805).text, 'פטרוזיליה קצוצה');
    assert.equal(row(806).text, 'נרות');
    assert.ok(sql("SELECT 1 FROM settings WHERE key = 'fix:recipe_rows'").length, 'not marked done');
  });

  /* ---------- H14 ---------- */
  await check('H14', 'ביצים: 11 מתוך קופסה (מינימום 12) לא ברשימה, 6 כן; פפריקה פתוחה ועוד סגורה לא ברשימה גם אחרי עדכון', async () => {
    await act(avi, [{ kind: 'create', product: { name: 'ביצים', count_type: 'pack', pack_size: 12, qty: 11, is_basic: 1, target: 12, location_id: 'מקרר' } }]);
    assert.ok(!onList('ביצים'), '11 eggs');
    await act(avi, [{ kind: 'op', product_id: product('ביצים').id, op: { type: 'set', qty: 6 } }]);
    assert.ok(onList('ביצים'), '6 eggs');
    await act(avi, [{ kind: 'op', product_id: product('פפריקה מעושנת').id, op: { type: 'low' } }]);
    assert.ok(!onList('פפריקה מעושנת'), 'paprika');
  });
} finally {
  const n = results.filter((r) => r.ok).length;
  console.log(`\n${n}/${results.length} home17 checks passed`);
  srv.kill(); mock.close();
  if (n !== results.length) console.log(log.split('\n').filter((l) => /Error|error/.test(l)).slice(-8).join('\n'));
  process.exit(n === results.length ? 0 : 1);
}
