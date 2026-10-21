// home19 (the owner's use on 17/10, evening): the server's own decisions on the model's answer, on the Node server with a fake model.
// Each check fails on 6142af5. Run: node --disable-warning=ExperimentalWarning test/home19.itest.js
import './fetch-retry.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DIR = '/tmp/shuki-test/shuki-home19'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const PORT = 8885, MOCK = 8886;

const db0 = new DatabaseSync(`${DIR}/shuki.db`);
db0.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) { db0.exec(readFileSync(`migrations/${f}`, 'utf8')); db0.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f); }
db0.exec(readFileSync('test/fixture-house.sql', 'utf8'));
db0.exec("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999)");
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
const fresh = () => { sql("DELETE FROM proposals"); sql("DELETE FROM chat"); sql("DELETE FROM settings WHERE key LIKE 'ask%'"); answers.length = 0; };
const lines = (r) => (r?.proposal?.lines || []).map((l) => l.text);
const say = async (t, text) => (await call(t, 'POST', '/api/chat', { text })).data;
const apply = async (t, r) => { assert.ok(r?.proposal?.id, `no card: ${JSON.stringify(r).slice(0, 300)}`); const x = await call(t, 'POST', `/api/proposals/${r.proposal.id}/apply`, {}); assert.equal(x.status, 200, JSON.stringify(x.data)); return x.data; };
const create = (name, more = {}) => ({ kind: 'create', product: { name, count_type: 'units', qty: 1, category_id: 'אחר', location_id: 'מזווה', ...more } });
const loc = (n) => sql('SELECT id FROM locations WHERE name = ?', n)[0]?.id;
const addP = (id, name, place, o = {}) => sql(`INSERT INTO products (id, name, aliases, count_type, qty, is_basic, created, updated, location_id) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`, id, name, JSON.stringify(o.aliases || []), o.type || 'units', o.qty ?? 1, o.basic ? 1 : 0, place);
const prep = () => {
  fresh(); sql('DELETE FROM list_items'); sql('DELETE FROM products'); sql('DELETE FROM facts'); sql("DELETE FROM settings WHERE key IN ('dup_no', 'basics_asked', 'daily_q', 'catalog_area', 'catalog_area_at')");
  sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('shop_produce', 'super'), ('shop_care', 'super'), ('shop_asked', '1')");
};
const lastUser = () => { const m = (reqs.at(-1)?.messages || []).filter((x) => x.role === 'user').at(-1); return typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content || ''); };

let avi;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${PORT}`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  avi = (await call(null, 'POST', '/api/pair', { code: '111111' })).data.token;
  await call(avi, 'POST', '/api/chat', { text: 'אחר כך' }); answers.length = 0; // past the first meeting

  /* ---------- 1: no line on what wasn't said; what was said with a number comes back ---------- */
  await check('H1-1', 'ההודעה של the owner (17/10): בלי "להעביר עגבניות למקרר", עם 5 לימונים, ובלי "האם להוסיף את המקום" לפני הכרטיס', async () => {
    prep(); addP(9011, 'עגבניות', loc('מקרר'), { qty: 5, basic: true }); addP(9012, '6 בננות', loc('מזווה'), { qty: 6 }); addP(9013, 'לימון כבוש', loc('מזווה'));
    answers.push({ reply: 'האם ככה?', face: 'happy', actions: [create('רכז רימונים', { location_id: 'מזווה' }), { kind: 'edit', product_id: 9012, fields: { location_id: 'מזווה', place_said: 'פינת אוכל' } }, { kind: 'edit', product_id: 9011, fields: { location_id: 'מקרר' } }] });
    const r = await say(avi, 'יש במזווה רכז רימונים. יש 5 לימונים על השולחן בפינת אוכל, והבננות גם שם');
    const l = lines(r);
    assert.ok(!l.some((x) => /עגבני/.test(x)), JSON.stringify(l));
    assert.ok(l.some((x) => /לימונים/.test(x) && /5/.test(x)), JSON.stringify(l));
    assert.ok(l.some((x) => /בננות/.test(x) && /פינת אוכל/.test(x)), JSON.stringify(l));
    assert.ok(l.some((x) => /רכז רימונים/.test(x)), JSON.stringify(l));
    await apply(avi, r);
    assert.equal(sql("SELECT l.name FROM products p JOIN locations l ON l.id = p.location_id WHERE p.name = 'לימונים'")[0]?.name, 'פינת אוכל');
  });
  await check('H1-2', 'תיקון של כרטיס: שורות שהכרטיס הקודם כבר הזכיר נשארות', async () => {
    prep(); answers.push({ reply: 'האם ככה?', face: 'happy', actions: [create('קולה זירו', { qty: 1.5, unit: 'בקבוק', location_id: 'מקרר' }), create('פטרוזיליה', { count_type: 'level', level: 'little', location_id: 'מקרר' })] });
    await say(avi, 'במקרר יש בקבוק וחצי קולה זירו ומעט פטרוזיליה');
    answers.push({ reply: 'סליחה! האם ככה?', face: 'happy', actions: [create('קולה זירו', { qty: 1.5, unit: 'בקבוק', location_id: 'מקרר' }), create('פטרוזיליה', { count_type: 'level', level: 'little', location_id: 'מקרר' }), create('יין לבן', { count_type: 'inuse', is_open: true, qty: 0, location_id: 'מקרר' })] });
    const l = lines(await say(avi, 'שכחת את היין הלבן הפתוח'));
    assert.equal(l.length, 3, JSON.stringify(l));
  });

  /* ---------- 2: another name ---------- */
  await check('H2-1', '"מיוקל זה סוג של מיונז" כשהמודל הציע כלל: כרטיס של כינוי על מיוקל, ואחרי האישור "מיונז" בכינויים', async () => {
    prep(); addP(9021, 'מיוקל', loc('מקרר'), { qty: 1.5 });
    answers.push({ reply: 'הבנתי! האם תרצה שאזכור?', face: 'happy', actions: [{ kind: 'lesson', text: 'מיוקל הוא סוג של מיונז.' }] });
    const r = await say(avi, 'מיוקל זה סוג של מיונז');
    assert.deepEqual(lines(r), ['לרשום ש"מיונז" הוא שם נוסף של מיוקל?'], JSON.stringify(r).slice(0, 300));
    await apply(avi, r);
    assert.deepEqual(JSON.parse(sql("SELECT aliases FROM products WHERE id = 9021")[0].aliases), ['מיונז']);
    assert.equal(sql("SELECT COUNT(*) AS n FROM lessons WHERE text LIKE '%מיוקל%'")[0].n, 0, 'a lesson too');
  });

  /* ---------- 10: an auto line the rule doesn't need any more ---------- */
  await check('H10-1', 'שורה אוטומטית ברשימה על מוצר שכבר לא חסר (פפריקה פתוחה ו"נשאר מעט" עם אחת סגורה): יורדת כשקוראים את הבית', async () => {
    prep(); sql("INSERT INTO products (id, name, aliases, count_type, qty, is_open, level, is_basic, target, created, updated, location_id) VALUES (9101, 'פפריקה מעושנת', '[]', 'inuse', 1, 1, 'little', 1, 1, 0, 0, ?)", loc('מזווה'));
    sql("INSERT INTO list_items (product_id, status, added, store, source) VALUES (9101, 'open', 0, 'super', 'auto')");
    addP(9102, 'כמון', loc('מזווה'), { basic: true }); sql("UPDATE products SET qty = 5 WHERE id = 9102"); sql("INSERT INTO list_items (product_id, status, added, store, source) VALUES (9102, 'open', 0, 'super', 'manual')"); // one put there by hand stays
    const st = (await call(avi, 'GET', '/api/state')).data;
    assert.ok(!st.list.some((i) => i.product_id === 9101 && i.source === 'auto'), 'still on the list');
    assert.equal(sql("SELECT COUNT(*) AS n FROM list_items WHERE product_id = 9101 AND source = 'auto'")[0].n, 0);
    assert.equal(sql("SELECT COUNT(*) AS n FROM list_items WHERE product_id = 9102")[0].n, 1, 'the one by hand went too');
  });

  /* ---------- 7: what a saved recipe misses, from the server ---------- */
  await check('H7-1', '"מחר אני מכין את המנה של אושרי" כשיש 5 עגבניות: למודל "עגבנייה סחוטה" לא חסרה, והמודל מתבקש לא להשוות שמות', async () => {
    prep(); addP(9071, 'עגבניות', loc('מקרר'), { qty: 5, basic: true }); addP(9072, 'ביצים', loc('מקרר'), { qty: 6 });
    sql("DELETE FROM recipe_ingredients WHERE recipe_id = 9070"); sql("DELETE FROM recipes WHERE id = 9070");
    sql("INSERT INTO recipes (id, name, ingredients, text, added_by, added, tags, serves, cooked, parsed) VALUES (9070, 'המנה של אושרי', '4 ביצים\nעגבנייה סחוטה', 'מטגנים.', 1, 0, 'ארוחות ערב', 4, 0, 1)");
    sql("INSERT INTO recipe_ingredients (recipe_id, pos, qty, name, line, product_id) VALUES (9070, 0, 4, 'ביצים', '4 ביצים', 9072), (9070, 1, NULL, 'עגבנייה סחוטה', 'עגבנייה סחוטה', NULL)");
    answers.push({ reply: 'בתיאבון!', face: 'happy' });
    await say(avi, 'מחר אני מכין את המנה של אושרי');
    const sys = lastSystem();
    assert.match(sys, /מתכון "המנה של אושרי"/);
    assert.match(sys, /יש בבית הכל \(מחושב מהמלאי, כמו במסך המתכונים: סמוך על זה\)/, sys.slice(sys.indexOf('מתכון "המנה'), sys.indexOf('מתכון "המנה') + 300));
    assert.match(sys, /מצרך מוכן \(סחוט, קצוץ, מבושל, מגורר\) הוא חומר הגלם שלו/);
  });

  /* ---------- 8: the card is the question ---------- */
  await check('H8-1', 'מקום שאינו בבית: הכרטיס מיד ("מקום חדש" בשורה), בלי "האם להוסיף אותו למקומות האחסון?" לפניו; אחרי האישור המקום נוסף', async () => {
    prep(); answers.push({ reply: 'יש!', face: 'happy', actions: [create('תירס גמדי', { place_said: 'על המדף העליון' })] });
    const r = await say(avi, 'על המדף העליון יש תירס גמדי');
    assert.ok(r.proposal, `no card: ${JSON.stringify(r).slice(0, 300)}`);
    assert.ok(!r.options?.length, `buttons: ${JSON.stringify(r.options)}`);
    assert.match(r.reply, /^אין לי עדיין מקום בשם "על המדף העליון"\. כשהכרטיס יאושר, הוא יתווסף למקומות האחסון\./);
    assert.match(r.proposal.lines[0].detail || '', /\(מקום חדש\)/);
    await apply(avi, r);
    assert.ok(loc('על המדף העליון'), 'no such place');
    assert.equal(sql("SELECT l.name FROM products p JOIN locations l ON l.id = p.location_id WHERE p.name = 'תירס גמדי'")[0]?.name, 'על המדף העליון');
  });
  await check('H8-2', '"האם לשמור את \'המנה של אושרי\' כמתכון חדש?" בטקסט: נשלח למודל פעם אחת, ומגיע כרטיס של המתכון', async () => {
    prep(); const n = calls;
    answers.push({ reply: 'נשמע טעים! האם לשמור את "המנה של אושרי" כמתכון חדש?', face: 'happy', options: ['כן, לשמור', 'לא'] });
    answers.push({ reply: 'נשמע טעים!', face: 'happy', actions: [{ kind: 'recipe', name: 'המנה של אושרי', ingredients: '4 ביצים\nשמן לטיגון\nלימון כבוש קצוץ', tags: ['ארוחות ערב'] }] });
    const r = await say(avi, 'המנה של אושרי: 4 ביצים, שמן לטיגון ולימון כבוש קצוץ. מטגנים הכל יחד');
    assert.equal(calls - n, 2, 'no second call');
    assert.match(lastUser(), /שאלת בטקסט אם לשמור מתכון/);
    assert.ok(r.proposal && lines(r).some((l) => /^לשמור את המתכון למנה של אושרי/.test(l)), JSON.stringify(r).slice(0, 300));
    assert.ok(!/האם לשמור/.test(r.reply), r.reply);
  });
  await check('H8-3', '"האם תשתפו אותי בהם, כדי שאשמור את המתכון?" (תמונה בלי מצרכים, מההוראות) לא נשלח שוב', async () => {
    prep(); const n = calls;
    answers.push({ reply: 'אני לא רואה בצילום את המצרכים. האם תשתפו אותי בהם, כדי שאשמור את המתכון?', face: 'happy' });
    await say(avi, 'תשמור את המתכון של העוגה של סבתא');
    assert.equal(calls - n, 1);
  });

  /* ---------- 12: "למה X לא קבוע?" ---------- */
  await check('H12-1', '"למה השוקולד לא קבוע?" כשעל המקום לא שאלתי: ליד ההודעה למודל כתוב שעל המקום עוד לא שאלתי', async () => {
    prep(); sql("INSERT OR IGNORE INTO locations (name, sort) VALUES ('מעל המקרר', 60)");
    addP(9121, 'שוקולד', loc('מעל המקרר')); addP(9122, 'עוגיות', loc('מעל המקרר'), { basic: true });
    answers.push({ reply: 'כי לא אמרו שהוא צריך להיות תמיד בבית.', face: 'happy' });
    await say(avi, 'למה השוקולד לא קבוע?');
    assert.match(lastUser(), /\(על מעל המקרר עוד לא שאלתי מה קבוע\. כתוב את זה באותה תשובה, והצע לשאול עכשיו\.\)/);
  });
  await check('H12-2', 'מקום שכבר נשאל: בלי ההערה', async () => {
    prep(); sql("INSERT OR IGNORE INTO locations (name, sort) VALUES ('מעל המקרר', 60)"); addP(9121, 'שוקולד', loc('מעל המקרר'));
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('basics_asked', ?)", JSON.stringify([loc('מעל המקרר')]));
    answers.push({ reply: 'כי לא אמרו.', face: 'happy' });
    await say(avi, 'למה השוקולד לא קבוע?');
    assert.ok(!/עוד לא שאלתי מה קבוע\./.test(lastUser()), lastUser());
  });

  /* ---------- 13: an edit by the list row's id ---------- */
  await check('H13-1', 'edit עם item_id של שורה ברשימה (h18-map, הביצים): המוצר נמצא בשרת, בלי קריאה שנייה', async () => {
    prep(); addP(9131, 'ביצים', loc('מקרר'), { qty: 0 });
    const item = sql("INSERT INTO list_items (product_id, status, added, store) VALUES (9131, 'open', 0, 'super')").lastInsertRowid;
    const n = calls; answers.push({ reply: 'האם ככה?', face: 'happy', actions: [{ kind: 'edit', item_id: Number(item), fields: { qty: 6, level: null } }] });
    const r = await say(avi, 'במקרר יש 6 ביצים');
    assert.equal(calls - n, 1, 'a second call');
    assert.ok(lines(r).some((l) => /ביצים/.test(l) && /6/.test(l)), JSON.stringify(lines(r)));
  });

  /* ---------- 15: amounts ---------- */
  await check('H15-1', '"בקבוק וחצי קולה זירו" שהמודל שלח "נשאר מעט": 1.5 בקבוקים; "חצי קילו בורגול" שהמודל שלח קילו: 0.5 ק"ג', async () => {
    prep(); area('מקרר');
    answers.push({ reply: 'האם ככה?', face: 'happy', actions: [create('קולה זירו', { count_type: 'level', level: 'little', qty: 1, location_id: 'מקרר' }), create('בורגול', { qty: 1, unit: 'ק"ג', location_id: 'מקרר' }), create('תפוח אדמה', { qty: 1, location_id: 'מקרר' })] });
    const r = await say(avi, 'בוא נמפה את המקרר: תפוח אדמה 1, בקבוק וחצי קולה זירו וחצי קילו בורגול');
    const l = lines(r);
    assert.ok(l.some((x) => x === 'לרשום שיש 1.5 בקבוקי קולה זירו?'), JSON.stringify(l));
    assert.ok(l.some((x) => /בורגול/.test(x) && /0\.5/.test(x)), JSON.stringify(l));
    assert.ok(!l.some((x) => /מעט/.test(x)), JSON.stringify(l));
  });
  await check('H15-2', '"קניתי 3 אבוקדו" שהמודל שלח עם היחידה "יחידה": "לסמן שקנינו 3 אבוקדו"', async () => {
    prep(); answers.push({ reply: 'האם ככה?', face: 'happy', actions: [{ kind: 'create', bought: true, product: { name: 'אבוקדו', count_type: 'units', qty: 3, unit: 'יחידה', category_id: 'ירקות ופירות', location_id: 'מקרר' } }] });
    const l = lines(await say(avi, 'קניתי 3 אבוקדו'));
    assert.ok(l.includes('לסמן שקנינו 3 אבוקדו?'), JSON.stringify(l));
  });
  await check('H15-3', 'צמחוני שלא אוכל דגים מבקש מתכון לסלמון, והמודל לא שלח fact: "האם תרצה שאזכור…?" עם הערך הקיים ו"אוכל דגים"', async () => {
    prep(); sql("DELETE FROM settings WHERE key LIKE 'once:%'");
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 1, 'diet', 'צמחוני', 1, 1, 1, 0, 'chat', 1, 1)");
    answers.push({ reply: 'אין לי מתכון שמור לסלמון, אז הנה רעיון כללי: מתבלים פילה סלמון ואופים ב-200 מעלות כ-15 דקות.', face: 'happy', idea: true });
    const r = await say(avi, 'תן לי מתכון לסלמון בתנור');
    assert.match(r.reply, /שאזכור/);
    assert.match(r.reply, /דג/);
    const ask = sql("SELECT value FROM settings WHERE key LIKE 'ask%' ORDER BY rowid DESC LIMIT 1")[0]?.value || '';
    assert.match(ask, /צמחוני, אוכל דגים/);
  });
} catch (e) { console.log('setup failed:', e.message, log.slice(-800)); } finally {
  srv.kill(); mock.close();
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} home19 checks passed`);
  process.exit(ok === results.length && results.length ? 0 : 1);
}
