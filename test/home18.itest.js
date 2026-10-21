// home18 (the owner's list after home17): the server's own decisions on the model's answer, on the Node server with a fake model
// that answers what the real one answered in h17-map / h17b-map (test/home18-recorded.json). Each check fails on 36ccbf9.
// Run: node --disable-warning=ExperimentalWarning test/home18.itest.js
import './fetch-retry.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DIR = '/tmp/shuki-test/shuki-home18'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const PORT = 8883, MOCK = 8884;
const REC = JSON.parse(readFileSync(new URL('./home18-recorded.json', import.meta.url), 'utf8'));

const db0 = new DatabaseSync(`${DIR}/shuki.db`);
db0.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) { db0.exec(readFileSync(`migrations/${f}`, 'utf8')); db0.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f); }
db0.exec(readFileSync('test/fixture-house.sql', 'utf8'));
db0.exec("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999)");
// the almond milk of h17's fu-map-milk: regular, in use, one open, nothing closed (id 41, as in the recording)
db0.exec(`INSERT INTO products (id, name, aliases, count_type, qty, is_open, is_basic, target, created, updated, location_id) VALUES (41, 'חלב שקדים', '[]', 'inuse', 0, 1, 1, 1, 0, 0, (SELECT id FROM locations WHERE name = 'מקרר'))`);
db0.close();

const answers = [], reqs = []; let calls = 0;
const requests_len = () => reqs.length, lastSystem = () => (reqs.at(-1)?.system || []).map((b) => b.text).join('\n');
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => {
  const body = JSON.parse(Buffer.concat(parts).toString('utf8')); calls++; reqs.push(body);
  const input = answers.shift() || { reply: 'בסדר', face: 'happy' };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'tool_use', id: `tu${calls}`, name: body.tools?.[0]?.name || 'respond', input }], usage: { input_tokens: 1, output_tokens: 1 } }));
}); }).listen(MOCK, '127.0.0.1');
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/node.js'], { env: { ...process.env, PORT: String(PORT), DB_PATH: `${DIR}/shuki.db`, ANTHROPIC_API_KEY: 't', ANTHROPIC_URL: `http://127.0.0.1:${MOCK}/v1/messages`, RETRY_MS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
const call = async (t, m, p, b) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, data: await r.json().catch(() => null) }; };
const sql = (q, ...a) => { const d = new DatabaseSync(`${DIR}/shuki.db`); try { return /^\s*select/i.test(q) ? d.prepare(q).all(...a) : d.prepare(q).run(...a); } finally { d.close(); } };
const results = [];
async function check(id, name, fn) {
  try { await fn(); results.push({ id, ok: true }); console.log('✓', id, name); }
  catch (e) { results.push({ id, ok: false }); console.log('✗', id, name, '\n   ', e.message.slice(0, 500)); }
}
const area = (a) => sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('catalog_area', ?), ('catalog_area_at', ?)", a, String(Date.now()));
const fresh = () => { sql("DELETE FROM proposals"); sql("DELETE FROM chat"); sql("DELETE FROM settings WHERE key LIKE 'ask%'"); };
const MILK = 'במקרר יש חצי קרטון חלב שקדים ורבע צנצנת חמוצים';
const lines = (r) => (r?.proposal?.lines || []).map((l) => l.text);

let avi;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${PORT}`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  avi = (await call(null, 'POST', '/api/pair', { code: '111111' })).data.token;
  await call(avi, 'POST', '/api/chat', { text: 'אחר כך' }); answers.length = 0; // past the first meeting

  await check('H3-1', 'הקלטה h17-map m8-r2: החמוצים (לא קבועים) "נשאר מעט" אצל המודל, והשרת שומר "יש"; חלב השקדים (קבוע, בלי סגור) נשאר "כמעט נגמר"', async () => {
    fresh(); area('מקרר'); answers.push(REC['h17-map m8-r2']);
    const r = (await call(avi, 'POST', '/api/chat', { text: MILK })).data;
    const l = lines(r);
    assert.ok(l.some((x) => /חמוצים/.test(x) && /^לרשום שיש/.test(x)), JSON.stringify(l));
    assert.ok(!l.some((x) => /חמוצים/.test(x) && /מעט|נגמר/.test(x)), JSON.stringify(l));
    assert.ok(l.some((x) => /חלב שקדים/.test(x) && /מעט/.test(x)), `the almond milk: ${JSON.stringify(l)}`);
  });

  for (const k of ['h17-map m8-r1', 'h17b-map m8-r2']) await check(`H3-2 ${k}`, `הקלטה ${k}: החמוצים נעלמו מהכרטיס, והשרת מוסיף אותם כ"יש"`, async () => {
    fresh(); area('מקרר'); answers.push(REC[k]);
    const r = (await call(avi, 'POST', '/api/chat', { text: MILK })).data;
    const l = lines(r);
    assert.ok(l.some((x) => /^לרשום שיש חמוצים/.test(x)), JSON.stringify(l));
    assert.ok(l.some((x) => /חלב שקדים/.test(x) && /מעט/.test(x)), `the almond milk: ${JSON.stringify(l)}`);
  });

  await check('H3-3', 'מוצר קיים שאינו קבוע ("חצי צנצנת ריבה") עם level little מהמודל: "יש"; ו"נשאר מעט ריבה" שנאמר במפורש נשאר מעט', async () => {
    sql("INSERT INTO products (id, name, aliases, count_type, qty, level, created, updated) VALUES (9181, 'ריבה', '[]', 'level', 0, 'plenty', 0, 0)");
    fresh(); answers.push({ reply: 'לעדכן?', face: 'happy', actions: [{ kind: 'edit', product_id: 9181, fields: { level: 'little' } }] });
    let l = lines((await call(avi, 'POST', '/api/chat', { text: 'יש חצי צנצנת ריבה' })).data);
    assert.ok(!l.some((x) => /מעט/.test(x)), JSON.stringify(l));
    fresh(); answers.push({ reply: 'לעדכן?', face: 'happy', actions: [{ kind: 'edit', product_id: 9181, fields: { level: 'little' } }] });
    l = lines((await call(avi, 'POST', '/api/chat', { text: 'נשאר מעט ריבה' })).data);
    assert.ok(l.some((x) => /מעט/.test(x)), `said "מעט": ${JSON.stringify(l)}`);
  });

  await check('H4-1', 'הקלטה h17-map m7-r3 ("מעולה, רושם את זה למזווה. האם סיימתם…"): קריאה אחת למודל, והמשפט "רושם" נמחק בלי לשבור את השאר', async () => {
    fresh(); area('מזווה'); const n = calls; answers.push(REC['h17-map m7-r3']);
    const r = (await call(avi, 'POST', '/api/chat', { text: 'במזווה יש חצי קופסה פפריקה מעושנת, רבע בקבוק שמן קנולה, קופסה פתוחה של קוסקוס, בקבוק וחצי סודה ומעט סוכר' })).data;
    assert.equal(calls - n, 1, `${calls - n} calls`);
    assert.ok(!/רושם|רשמתי/.test(r.reply), r.reply); assert.equal(r.reply, 'האם סיימתם למפות את המזווה, או שיש עוד?');
    assert.ok(lines(r).length >= 4, JSON.stringify(lines(r)));
  });

  await check('H4-2', 'כל ה-reply הוא "רשמתי": "האם ככה?"; ובעיה אחרת (מוצר שלא קיים) עדיין שולחת שוב למודל', async () => {
    fresh(); area('מקרר'); let n = calls; answers.push({ reply: 'יש! עדכנתי את כל מה שסיפרת על המקרר.', face: 'happy', actions: [{ kind: 'create', product: { name: 'בורגול', count_type: 'level', level: 'plenty', category_id: 'יבשים' } }] });
    let r = (await call(avi, 'POST', '/api/chat', { text: 'במקרר יש בורגול' })).data;
    assert.equal(calls - n, 1); assert.equal(r.reply, 'יש!'); // the sentence that claimed went, whole
    fresh(); n = calls; answers.push({ reply: 'רשמתי.', face: 'happy', actions: [{ kind: 'create', product: { name: 'אורז', count_type: 'level', level: 'plenty', category_id: 'יבשים' } }] });
    r = (await call(avi, 'POST', '/api/chat', { text: 'יש אורז' })).data;
    assert.equal(r.reply, 'האם ככה?');
    fresh(); n = calls; answers.push({ reply: 'לסמן?', face: 'happy', actions: [{ kind: 'op', product_id: 999999, op: { type: 'out' } }] }, { reply: 'לסמן?', face: 'happy', actions: [] });
    await call(avi, 'POST', '/api/chat', { text: 'נגמר משהו' });
    assert.equal(calls - n, 2, 'a product that does not exist: no second call');
  });

  // ---- 5: a tab of the list is a shopping trip (the owner 17/10) ----
  const cardOf = (r) => r?.proposal?.id;
  const approve = (r) => call(avi, 'POST', `/api/proposals/${cardOf(r)}/apply`, {});
  const prod = (n) => sql('SELECT p.name, p.store, p.store2, c.name AS cat FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.name = ? AND p.deleted IS NULL', n)[0];
  const setShop = (k, v) => (v == null ? sql('DELETE FROM settings WHERE key = ?', `shop_${k}`) : sql('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', `shop_${k}`, v));
  const make = async (product, text = 'יש') => { fresh(); answers.push({ reply: 'לרשום?', face: 'happy', actions: [{ kind: 'create', product }] }); const r = (await call(avi, 'POST', '/api/chat', { text })).data; assert.equal((await approve(r)).status, 200); return prod(product.name); };
  sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('shop_asked', '1')"); // the questions are their own checks, below

  await check('H5-1', 'דיזטול ← ניקיון וכביסה, גם כשהמודל כתב קטגוריה שאין ("ניקוי וכביסה") או "אחר"', async () => {
    let p = await make({ name: 'תרסיס ניקוי דיזטול', count_type: 'units', qty: 1, category_id: 'ניקוי וכביסה' });
    assert.equal(p.cat, 'ניקיון וכביסה', JSON.stringify(p));
    p = await make({ name: 'סנו ג\'אוול', count_type: 'units', qty: 1, category_id: 'אחר' });
    assert.equal(p.cat, 'ניקיון וכביסה', JSON.stringify(p));
  });
  await check('H5-2', 'בית שענה "בירקן": עגבנייה ← ירקן, ובסופר כחנות שנייה (store2)', async () => {
    setShop('produce', 'greengrocer'); await call(avi, 'GET', '/api/state');
    const p = await make({ name: 'עגבנייה', count_type: 'units', qty: 2, category_id: 'ירקות ופירות', store: 'super' });
    assert.deepEqual([p.store, p.store2], ['greengrocer', 'super']);
  });
  await check('H5-3', 'בית שענה "בסופר": עגבנייה ← סופר, בלי חנות שנייה', async () => {
    setShop('produce', 'super'); sql("DELETE FROM products WHERE name = 'עגבנייה'");
    const p = await make({ name: 'עגבנייה', count_type: 'units', qty: 2, category_id: 'ירקות ופירות', store: 'greengrocer', store2: 'super' });
    assert.deepEqual([p.store, p.store2], ['super', null]);
  });
  await check('H5-4', 'שמפו בבית שענה "פעם פה פעם שם" ← סופר, וגם בפארם', async () => {
    setShop('care', 'both');
    const p = await make({ name: 'שמפו', count_type: 'inuse', is_open: true, category_id: 'טואלטיקה והיגיינה', store: 'pharm' });
    assert.deepEqual([p.store, p.store2], ['super', 'pharm']);
  });
  await check('H5-5', 'אקמול ← פארם (תרופות, לפי השם, בלי קטגוריה מהמודל)', async () => {
    const p = await make({ name: 'אקמול', count_type: 'units', qty: 1 });
    assert.deepEqual([p.cat, p.store, p.store2], ['תרופות ועזרה ראשונה', 'pharm', null]);
  });
  await check('H5-6', 'תשובה חדשה מזיזה מוצרים קיימים בקטגוריה (ואת השורה שלהם ברשימה), אבל לא מוצר שנעשה בטופס', async () => {
    setShop('produce', null);
    sql("INSERT INTO products (id, name, aliases, count_type, qty, created, updated, category_id, store) VALUES (9182, 'מלפפון', '[]', 'units', 0, 0, 0, (SELECT id FROM categories WHERE name = 'ירקות ופירות'), 'super')");
    sql("INSERT INTO list_items (product_id, store, source, status, added_by, added) VALUES (9182, 'super', 'manual', 'open', 1, 0)");
    await call(avi, 'POST', '/api/actions', { op_id: 'form-h56', ts: Date.now(), actions: [{ kind: 'create', product: { name: 'גזר', count_type: 'units', qty: 1, category_id: 'ירקות ופירות', store: 'super' } }] });
    assert.equal((await call(avi, 'POST', '/api/settings', { shop_produce: 'greengrocer' })).status, 200);
    assert.deepEqual(Object.values(prod('מלפפון')).slice(1, 3), ['greengrocer', 'super']);
    assert.equal(sql("SELECT store FROM list_items WHERE product_id = 9182 AND status = 'open'")[0].store, 'greengrocer', 'its line');
    assert.deepEqual([prod('גזר').store, prod('גזר').store2], ['super', null], 'made in the form');
  });

  await check('H5-7', 'השאלות: אחרי שאלת הקבועים, ואחרי הכרטיס שלה, אחת בכל פעם; התשובות נשמרות; ולא שוב אחרי שענו', async () => {
    sql("DELETE FROM settings WHERE key IN ('shop_asked', 'shop_produce', 'shop_care')"); fresh();
    sql("INSERT INTO chat (ts, user_id, role, content, thread) VALUES (?, NULL, 'shuki', ?, 1)", Date.now() - 5000, JSON.stringify({ reply: 'יש! המזווה ממופה. מה מכל זה תמיד צריך להיות בבית?', face: 'happy', for: 1 }));
    answers.push({ reply: 'לסמן כמוצר קבוע?', face: 'happy', actions: [{ kind: 'edit', product_id: 41, fields: { is_basic: true } }] });
    const r = (await call(avi, 'POST', '/api/chat', { text: 'החלב שקדים' })).data;
    assert.ok(cardOf(r), 'the card'); assert.ok(!/איפה אתם קונים/.test(r.reply || ''), 'next to the card');
    await approve(r);
    let msgs = (await call(avi, 'GET', '/api/chat')).data.messages.filter((m) => m.role === 'shuki').map((m) => m.content);
    const q1 = msgs.filter((c) => c.reply === 'איפה אתם קונים ירקות ופירות?');
    assert.equal(q1.length, 1, JSON.stringify(msgs.slice(-3)));
    assert.deepEqual(q1[0].options, ['בסופר', 'בירקן', 'פעם פה פעם שם']);
    assert.ok(!msgs.some((c) => /טואלטיקה/.test(c.reply || '')), 'both at once');
    let a = (await call(avi, 'POST', '/api/chat', { text: 'בירקן' })).data;
    assert.equal(a.reply, 'איפה אתם קונים טואלטיקה ומוצרי ניקיון?'); assert.deepEqual(a.options, ['בסופר', 'בפארם', 'פעם פה פעם שם']);
    a = (await call(avi, 'POST', '/api/chat', { text: 'בפארם' })).data;
    assert.equal(a.reply, 'סגור!');
    assert.deepEqual(sql("SELECT key, value FROM settings WHERE key IN ('shop_produce', 'shop_care') ORDER BY key").map((x) => x.value), ['pharm', 'greengrocer']);
    // not again: another regular products' answer, and opening the chat
    sql("INSERT INTO chat (ts, user_id, role, content, thread) VALUES (?, NULL, 'shuki', ?, 1)", Date.now(), JSON.stringify({ reply: 'מה מכל זה תמיד צריך להיות בבית?', face: 'happy', for: 1 }));
    answers.push({ reply: 'בסדר', face: 'happy' }); await call(avi, 'POST', '/api/chat', { text: 'כלום' });
    msgs = (await call(avi, 'GET', '/api/chat')).data.messages.filter((m) => m.role === 'shuki' && m.content.reply === 'איפה אתם קונים ירקות ופירות?');
    assert.equal(msgs.length, 1, 'asked again');
  });

  await check('H5-8', 'בית קיים שלא נשאל (הבית החי): כשמנהל פותח את הצ\'אט בלי שיחה באמצע, השאלה הראשונה פעם אחת; מי שלא ענה לא נשאל שוב', async () => {
    sql("DELETE FROM settings WHERE key IN ('shop_asked', 'shop_produce', 'shop_care', 'catalog_area', 'catalog_area_at')"); fresh(); // no place being mapped
    sql("INSERT INTO chat (ts, user_id, role, content, thread) VALUES (?, 1, 'user', ?, 1)", Date.now() - 3600e3, JSON.stringify({ text: 'תודה' }));
    await call(avi, 'GET', '/api/chat'); await call(avi, 'GET', '/api/chat');
    const n = () => sql("SELECT COUNT(*) AS n FROM chat WHERE json_extract(content, '$.reply') = 'איפה אתם קונים ירקות ופירות?'")[0].n;
    assert.equal(n(), 1);
    answers.push({ reply: 'בסדר', face: 'happy' }); await call(avi, 'POST', '/api/chat', { text: 'נגמר החלב' }); // not an answer
    sql('UPDATE chat SET ts = ts - 7200e3'); await call(avi, 'GET', '/api/chat');
    assert.equal(n(), 1, 'asked again');
  });

  // ---- 6, 7 and the pace: asked, never merged alone; places never asked what's regular; at most one question a day ----
  const openChat = async () => { sql("UPDATE chat SET ts = ts - 7200e3"); return call(avi, 'GET', '/api/chat'); }; // no talk going on
  const lastShuki = () => { const r = sql("SELECT content FROM chat WHERE role = 'shuki' ORDER BY ts DESC, id DESC LIMIT 1")[0]; return r && JSON.parse(r.content); };
  const newDay = () => sql("DELETE FROM settings WHERE key = 'daily_q'");
  const loc = (n) => sql('SELECT id FROM locations WHERE name = ?', n)[0]?.id;
  const addP = (id, name, place, o = {}) => sql(`INSERT INTO products (id, name, aliases, count_type, qty, is_basic, created, updated, location_id) VALUES (?, ?, '[]', ?, ?, ?, 0, 0, ?)`, id, name, o.type || 'units', o.qty ?? 1, o.basic ? 1 : 0, place);
  const prep = () => {
    fresh(); sql('DELETE FROM list_items'); sql('DELETE FROM products'); sql("DELETE FROM settings WHERE key IN ('dup_no', 'basics_asked', 'daily_q', 'catalog_area', 'catalog_area_at')");
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('shop_produce', 'super'), ('shop_care', 'super'), ('shop_asked', '1')"); // the stores were answered
    sql("INSERT OR IGNORE INTO locations (name, sort) VALUES ('מעל המקרר', 60)");
  };

  await check('H6-1', '"עגבניות חתוכות" ו"עגבניות חתוכות משומרות": בפתיחת הצ\'אט, השאלה עם שני הכפתורים', async () => {
    prep(); addP(9601, 'עגבניות חתוכות', loc('מזווה'), { qty: 2 }); addP(9602, 'עגבניות חתוכות משומרות', loc('מעל המקרר'), { qty: 3, basic: true });
    sql("UPDATE settings SET value = ? WHERE key = 'basics_asked'", '[]'); sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('basics_asked', ?)", JSON.stringify([loc('מזווה'), loc('מעל המקרר')]));
    sql("INSERT INTO list_items (product_id, store, source, status, added_by, added) VALUES (9601, 'super', 'manual', 'open', 1, 0)");
    await openChat();
    const q = lastShuki();
    assert.equal(q?.reply, 'יש עגבניות חתוכות וגם עגבניות חתוכות משומרות. האם אלה אותו מוצר?'); assert.deepEqual(q.options, ['כן, אותו מוצר', 'לא, מוצר אחר']);
  });
  await check('H6-2', '"כן, אותו מוצר": מוצר אחד בשם הארוך, השני כינוי ("עגבניות חתוכות" עדיין מוצא אותו), הכמויות מתחברות, קבוע, והשורה ברשימה עוברת', async () => {
    const r = (await call(avi, 'POST', '/api/chat', { text: 'כן, אותו מוצר' })).data;
    assert.equal(r.reply, 'סגור!');
    const live = sql("SELECT id, name, aliases, qty, is_basic FROM products WHERE deleted IS NULL AND name LIKE 'עגבניות חתוכות%'");
    assert.equal(live.length, 1, JSON.stringify(live)); assert.equal(live[0].name, 'עגבניות חתוכות משומרות');
    assert.ok(JSON.parse(live[0].aliases).includes('עגבניות חתוכות')); assert.equal(live[0].qty, 5); assert.equal(live[0].is_basic, 1);
    assert.equal(sql("SELECT product_id FROM list_items WHERE status = 'open'")[0]?.product_id, live[0].id, 'its line');
    await call(avi, 'POST', '/api/actions', { op_id: 'h62', ts: Date.now(), actions: [{ kind: 'op', product_id: live[0].id, op: { type: 'out' } }] });
    const add = await call(avi, 'POST', '/api/actions', { op_id: 'h62b', ts: Date.now(), actions: [{ kind: 'list_add', text: 'עגבניות חתוכות' }] });
    assert.equal(add.status, 200); assert.equal(sql("SELECT COUNT(*) AS n FROM list_items WHERE status = 'open' AND product_id IS NULL")[0].n, 0, '"עגבניות חתוכות" made a line of its own');
  });
  await check('H6-3', '"לא, מוצר אחר": לא נשאל שוב על אותו זוג', async () => {
    prep(); addP(9611, 'חומץ בלסמי', loc('מזווה')); addP(9612, 'חומץ בלסמי לבן', loc('מזווה'));
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('basics_asked', ?)", JSON.stringify([loc('מזווה')]));
    await openChat(); assert.equal(lastShuki()?.reply, 'יש חומץ בלסמי וגם חומץ בלסמי לבן. האם זה אותו מוצר?');
    assert.equal((await call(avi, 'POST', '/api/chat', { text: 'לא, מוצר אחר' })).data.reply, 'בסדר.');
    newDay(); const n = sql('SELECT COUNT(*) AS n FROM chat')[0].n; await openChat();
    assert.ok(!sql('SELECT content FROM chat').some((r) => /חומץ בלסמי וגם/.test(r.content) && sql('SELECT COUNT(*) AS n FROM chat')[0].n > n + 1), 'asked again');
    assert.equal(sql("SELECT COUNT(*) AS n FROM chat WHERE content LIKE '%וגם חומץ בלסמי לבן%'")[0].n, 1, 'asked again');
  });
  await check('H6-4', '"מעל המקרר" ו"במעל המקרר": שאלת מקום; "כן, אותו מקום": המוצרים עוברים והכפול נמחק', async () => {
    prep(); sql("INSERT INTO locations (name, sort) VALUES ('במעל המקרר', 61)");
    addP(9621, 'סופגי לחות', loc('במעל המקרר')); sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('basics_asked', ?)", JSON.stringify([loc('במעל המקרר')]));
    await openChat(); const q = lastShuki();
    assert.equal(q?.reply, 'יש מעל המקרר וגם במעל המקרר. האם זה אותו מקום?'); assert.deepEqual(q.options, ['כן, אותו מקום', 'לא, מקום אחר']);
    assert.equal((await call(avi, 'POST', '/api/chat', { text: 'כן, אותו מקום' })).data.reply, 'סגור!');
    assert.equal(loc('במעל המקרר'), undefined, 'the duplicate place'); assert.equal(sql('SELECT location_id FROM products WHERE id = 9621')[0].location_id, loc('מעל המקרר'));
  });
  await check('H6-5', 'מוצר חדש בשם דומה למוצר במקום אחר: השאלה לפני ה-create', async () => {
    prep(); addP(9631, 'עגבניות חתוכות משומרות', loc('מעל המקרר'), { qty: 3 });
    answers.push({ reply: 'לרשום?', face: 'happy', actions: [{ kind: 'create', product: { name: 'עגבניות חתוכות', count_type: 'units', qty: 2, category_id: 'שימורים ורטבים', location_id: 'מקרר' } }] });
    const r = (await call(avi, 'POST', '/api/chat', { text: 'במקרר יש 2 עגבניות חתוכות' })).data;
    assert.ok(!r.proposal, 'a card before the question'); assert.equal(r.reply, 'יש כבר עגבניות חתוכות משומרות מעל המקרר. האם אלה אותן עגבניות?');
    const yes = (await call(avi, 'POST', '/api/chat', { text: 'כן, אותו מוצר' })).data;
    assert.ok(yes.proposal, 'the card after "yes"'); await approve(yes);
    assert.equal(sql("SELECT COUNT(*) AS n FROM products WHERE deleted IS NULL AND name LIKE 'עגבניות חתוכות%'")[0].n, 1);
    assert.ok(JSON.parse(sql('SELECT aliases FROM products WHERE id = 9631')[0].aliases).includes('עגבניות חתוכות'), 'the other name');
  });

  await check('H7-1', 'מקום שמופה עם שאלת הקבועים לא נשאל שוב; מקום שלא נשאל: פעם אחת, עם שמות המוצרים ו"אין שם כאלה", ולא שוב', async () => {
    prep(); addP(9701, 'שמן קנולה', loc('מזווה')); addP(9702, 'קמח', loc('מזווה')); addP(9703, 'פלפל שחור', loc('ארון מטבח')); addP(9704, 'כמון', loc('ארון מטבח'));
    area('מזווה'); answers.push({ reply: 'יש! המזווה ממופה. מה מכל זה תמיד צריך להיות בבית?', face: 'happy' });
    await call(avi, 'POST', '/api/chat', { text: 'סיימנו למפות את המזווה' });
    assert.ok(JSON.parse(sql("SELECT value FROM settings WHERE key = 'basics_asked'")[0]?.value || '[]').includes(loc('מזווה')), 'the mapped place');
    sql("DELETE FROM settings WHERE key IN ('catalog_area', 'catalog_area_at')"); fresh();
    await openChat(); const q = lastShuki();
    assert.equal(q?.reply, 'על ארון המטבח עוד לא שאלתי: מה מכל זה תמיד צריך להיות בבית?\nכמון, פלפל שחור'); assert.deepEqual(q.options, ['אין שם כאלה']);
    assert.equal((await call(avi, 'POST', '/api/chat', { text: 'אין שם כאלה' })).data.reply, 'בסדר.');
    newDay(); await openChat();
    assert.equal(sql("SELECT COUNT(*) AS n FROM chat WHERE content LIKE '%עוד לא שאלתי%'")[0].n, 1, 'asked again');
  });
  await check('H7-2', 'בהוראות: "למה X לא קבוע?" ולא "אין לי הסבר", והמקום שלא נשאל מסומן ברשימת המקומות', async () => {
    prep(); addP(9711, 'מלח', loc('מגירה') ?? loc('ארון מטבח'));
    const n = requests_len(); answers.push({ reply: 'כי לא אמרו לי.', face: 'happy' }); await call(avi, 'POST', '/api/chat', { text: 'למה מלח לא קבוע?' });
    const sys = lastSystem();
    assert.ok(/"למה X לא קבוע\?": כי לא אמרו שהוא צריך להיות תמיד בבית \(לא "אין לי הסבר"\)/.test(sys), 'the instruction');
    assert.ok(/עוד לא שאלתי מה קבוע במקום הזה/.test(sys), 'the place'); void n;
  });
  await check('H8-1', 'הקצב: שאלה אחת ביום מכל השלושה, לפי הסדר (חנויות, זוג, מקום)', async () => {
    prep(); sql("DELETE FROM settings WHERE key IN ('shop_produce', 'shop_care', 'shop_asked')");
    addP(9801, 'קוטג\'', loc('מקרר')); addP(9802, 'קוטג\' סגור', loc('מקרר')); addP(9803, 'כמון', loc('ארון מטבח'));
    await openChat(); assert.equal(lastShuki()?.reply, 'איפה אתם קונים ירקות ופירות?');
    await call(avi, 'POST', '/api/chat', { text: 'בסופר' }); await call(avi, 'POST', '/api/chat', { text: 'בסופר' });
    await openChat(); assert.equal(sql("SELECT COUNT(*) AS n FROM chat WHERE content LIKE '%וגם קוטג%'")[0].n, 0, 'a second question the same day');
    newDay(); await openChat(); assert.match(lastShuki()?.reply || '', /^יש קוטג' וגם קוטג' סגור\./);
    await call(avi, 'POST', '/api/chat', { text: 'לא, מוצר אחר' });
    newDay(); await openChat(); assert.match(lastShuki()?.reply || '', /^על /);
  });
} catch (e) { console.log('setup failed:', e.message, log.slice(-800)); } finally {
  srv.kill(); mock.close();
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} home18 checks passed`);
  process.exit(ok === results.length && results.length ? 0 : 1);
}
