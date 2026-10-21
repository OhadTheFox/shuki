// Stage 0e: the order of the prompt and the cache (docs/stage0-0e-proposal.md, the owner's decisions 02/10), on the Node
// server with a fake model. What the model gets, in which part, and that the cached parts don't change when they shouldn't.
// Run: node --disable-warning=ExperimentalWarning test/cache.itest.js
import './fetch-retry.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DIR = '/tmp/shuki-test/shuki-cache'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const PORT = 8787, MOCK = 8788;

const db = new DatabaseSync(`${DIR}/shuki.db`);
db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) { db.exec(readFileSync(`migrations/${f}`, 'utf8')); db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f); }
db.exec(readFileSync('test/fixture-house.sql', 'utf8'));
db.exec("INSERT INTO users (id, name, gender, role, active, created) VALUES (3, 'יואבי', 'm', 'child', 1, 0), (4, 'דנה', 'f', 'member', 1, 0)");
db.exec("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999), ('222222', 2, 9999999999999), ('333333', 3, 9999999999999), ('444444', 4, 9999999999999)");
db.exec(`INSERT INTO products (id, name, count_type, qty, owner, created, updated) VALUES
  (7, 'חלב', 'units', 2, NULL, 1, 1), (8, 'חלב סויה', 'units', 1, 2, 1, 1), (9, 'קפה של אבי', 'units', 1, 1, 1, 1), (10, 'לחם', 'units', 1, NULL, 1, 1)`);
db.close();

let answer = () => ({ reply: 'אני פה!', face: 'happy' });
const requests = [];
// the body as bytes first: a chunk can end in the middle of a Hebrew letter
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => {
  const body = JSON.parse(Buffer.concat(parts).toString('utf8')); requests.push(body);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'tool_use', name: body.tools?.[0]?.name || 'respond', input: answer(body) }], usage: { input_tokens: 1, output_tokens: 1 } }));
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
const act = (t, actions) => call(t, 'POST', '/api/actions', { actions });
// a time in the house's zone (Asia/Jerusalem): a date "YYYY-MM-DD" at `hour`:05
const zoneHour = (ts) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }).format(ts));
const at = (date, hour) => { let ts = Date.parse(`${date}T${String(hour).padStart(2, '0')}:05:00Z`); ts -= (zoneHour(ts) - hour) * 3600e3; return ts; };
const day = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(ts); // YYYY-MM-DD

let avi, michal, yoavi, dana;
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  [avi, michal, yoavi, dana] = await Promise.all(['111111', '222222', '333333', '444444'].map(async (code) => (await call(null, 'POST', '/api/pair', { code })).data.token));
  const toolsOf = (r) => JSON.stringify(r.tools);
  // the chat call that carried this message (not another call the server made meanwhile)
  const callFor = (text) => requests.findLast((r) => JSON.stringify(r.messages || []).includes(text));

  await check('E1', 'חלק 1 זהה לכל כותב: הכלים של אבי ושל מיכל זהים (רשימת השמות של כל הבית, לפי מספר)', async () => {
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await say(avi, 'מה נשמע אצל אבי?'); const a = callFor('מה נשמע אצל אבי?');
    await say(michal, 'מה נשמע אצל מיכל?'); const m = callFor('מה נשמע אצל מיכל?');
    assert.equal(toolsOf(a), toolsOf(m));
    assert.equal(JSON.stringify(a.system[0]), JSON.stringify(m.system[0]), 'the instructions');
    assert.deepEqual(a.tools[0].input_schema.properties.actions.items.properties.to.enum, ['אבי', 'מיכל', 'יואבי', 'דנה']);
  });

  await check('E2', '"תגיד לעצמך": המודל מקבל הודעה משלו לתיקון, ולא "אין בבית מישהו בשם"', async () => {
    let n = 0;
    answer = () => (n++ ? { reply: 'אזכיר לך.', face: 'happy' } : { reply: 'אמסור.', face: 'happy', actions: [{ kind: 'tell', to: 'אבי', text: 'לקנות חלב' }] });
    await say(avi, 'תגיד לי לקנות חלב');
    const fix = JSON.stringify(callFor('אי אפשר להגיד משהו לעצמך')?.messages || requests.at(-1).messages);
    assert.match(fix, /אי אפשר להגיד משהו לעצמך: לתזכורת, remind/);
    assert.doesNotMatch(fix, /אין בבית מישהו בשם/);
  });
  await check('E1ב', 'בית של אדם אחד: גם שם רשימת השמות בכלים (רק הוא), כמו בכל בית', async () => {
    sql('UPDATE users SET active = 0 WHERE id != 1');
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await say(avi, 'לבד בבית'); const r = callFor('לבד בבית');
    sql('UPDATE users SET active = 1');
    assert.deepEqual(r.tools[0].input_schema.properties.actions.items.properties.to?.enum, ['אבי']);
  });

  const cached = (r) => r.system.filter((b) => b.cache_control);
  const partsOf = (r) => JSON.stringify([r.tools, cached(r)]);
  // which part carries it (the instructions, part 1, are skipped: they name words like these as examples)
  const where = (r, text) => r.system.findIndex((b, k) => k > 0 && b.text.includes(text));

  await check('E3', 'ארבעה חלקים: מטמון על 1–3 בלבד, וחלק 4 בלי', async () => {
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await say(avi, 'שלום E3'); const r = callFor('שלום E3');
    assert.ok(r.system.length >= 4, r.system.length);
    assert.deepEqual(r.system.map((b) => !!b.cache_control).slice(0, 4), [true, true, true, false]);
    assert.equal(cached(r).length, 3);
  });

  await check('E4', 'מה עבר לאן: הבית בחלק 2, הקטלוג והרשימה בחלק 3, השעה, מצב הרוח, מי בקניות, פעולות אחרונות ומי כותב בחלק 4', async () => {
    await act(avi, [{ kind: 'list_add', text: 'נייר כסף' }]);
    await call(michal, 'POST', '/api/shopping', { store: 'super' });
    await say(avi, 'שלום E4'); const r = callFor('שלום E4');
    for (const [text, part] of [['בני הבית:', 1], ['קטגוריות:', 1], ['מיקומים:', 1], ['חנויות (id=שם)', 1], ['קטלוג, לפי קטגוריה', 2], ['רשימת קניות (', 2], ['נייר כסף', 2],
      ['היום: יום', 3], ['מצב רוח:', 3], ['בקניות עכשיו: מיכל', 3], ['מצב פסח:', 3], ['חופשה:', 3], ['פעולות אחרונות בבית', 3], ['המשתמש שכותב עכשיו: אבי', 3]]) {
      assert.equal(where(r, text), part, `${text}: in part ${where(r, text) + 1}`);
    }
    await call(michal, 'POST', '/api/shopping', { on: false });
  });

  await check('E4ב', 'מה עבר לאן, כל השאר: שם הבית, הערות, שותפים, מעבר דירה, שאריות, קניות קבועות, כללים ועובדות בחלק 2; אורחים ואזור קטלוג בחלק 4', async () => {
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('house_notes', 'הבית כשר'), ('house_mode', 'roommates'), ('moving', ?), ('catalog_area', 'מקרר')", String(Date.now() + 20 * 86400e3));
    sql("INSERT INTO leftovers (text, made, added_by) VALUES ('אורז מבושל', ?, 1)", Date.now());
    sql("INSERT INTO routines (product_id, text, weekday, store, added_by, added) VALUES (NULL, 'פיתות', 5, 'super', 1, 1)");
    sql("INSERT INTO lessons (text, added, added_by) VALUES ('לא קונים במבה', 1, 1)");
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('house', 0, 'appliance', 'מדיח', 1, 1, 1, 0, 'chat', 1, 1)");
    sql("INSERT INTO away (start, end, set_by, kind) VALUES (?, ?, 1, 'guests')", Date.now() - 3600e3, Date.now() + 86400e3);
    await say(avi, 'שלום E4ב'); const r = callFor('שלום E4ב');
    sql("DELETE FROM settings WHERE key IN ('house_mode', 'moving', 'catalog_area')"); sql("DELETE FROM away WHERE kind = 'guests'");
    for (const [text, part] of [['הבית: ', 1], ['הבית כשר', 1], ['דירת שותפים', 1], ['מעבר דירה', 1], ['אורז מבושל', 1], ['פיתות', 1], ['לא קונים במבה', 1], ['מדיח', 1],
      ['אורחים בבית עד', 3], ['אזור קטלוג נוכחי: מקרר', 3]]) {
      assert.equal(where(r, text), part, `${text}: in part ${where(r, text) + 1}`);
    }
  });
  await check('E5', 'מתכון ששאלו עליו, ואחריו שלוש הודעות בלי שום שינוי בבית: חלקים 1–3 זהים בכולן (המתכון המלא בחלק 4)', async () => {
    await call(avi, 'POST', '/api/__recipes', { recipes: [{ name: 'שקשוקה', ingredients: 'שמן זית\n4 שיני שום\n6 עגבניות\n6 ביצים', text: 'מטגנים, מוסיפים, שוברים ביצים.', tags: 'ארוחות ערב', serves: 4 }] });
    await say(avi, 'מה נשמע לפני השקשוקה?');
    const texts = ['איך מכינים שקשוקה?', 'מה נשמע 1', 'מה נשמע 2', 'מה נשמע 3', 'מה נשמע 4'];
    const rs = [];
    for (const t of texts) { await say(avi, t); rs.push(callFor(t)); }
    assert.ok(where(rs[0], 'מתכון "שקשוקה"') >= 3, 'the full recipe is not in part 4');
    for (const r of rs.slice(1)) assert.equal(partsOf(r), partsOf(rs[0]), 'parts 1–3 changed');
  });

  await check('E6', 'פעולה במלאי: רק חלק 3 משתנה; חלקים 1–2 לא', async () => {
    await say(avi, 'לפני הפעולה E6'); const a = callFor('לפני הפעולה E6');
    await act(avi, [{ kind: 'list_add', text: 'נייר אפייה' }]);
    await say(avi, 'אחרי הפעולה E6'); const b = callFor('אחרי הפעולה E6');
    assert.equal(JSON.stringify([a.tools, a.system[0], a.system[1]]), JSON.stringify([b.tools, b.system[0], b.system[1]]), 'parts 1–2 changed');
    assert.notEqual(a.system[2].text, b.system[2].text, 'part 3 did not change');
  });

  await check('E7', 'כותב אחר, כששניהם עם מוצר פרטי: חלקים 1–3 זהים, והמוצרים הפרטיים של כל אחד רק בחלק 4 שלו', async () => {
    await act(avi, [{ kind: 'list_add', text: 'ויאגרה' }]);
    await act(michal, [{ kind: 'list_add', text: 'בדיקת הריון' }]);
    await say(avi, 'אבי E7'); const a = callFor('אבי E7');
    await say(michal, 'מיכל E7'); const m = callFor('מיכל E7');
    assert.equal(partsOf(a), partsOf(m));
    assert.ok(where(a, 'ויאגרה') >= 3 && where(a, 'בדיקת הריון') < 0, 'Avi');
    assert.ok(where(m, 'בדיקת הריון') >= 3 && where(m, 'ויאגרה') < 0, 'Michal');
  });
  await check('E9', '"מי ומתי": "מי עדכן שהחלב נגמר?" מקבל שורה בחלק 4; "תוסיף מים" לא', async () => {
    await act(michal, [{ kind: 'op', product_id: 7, op: { type: 'out' } }]);
    await say(avi, 'מי עדכן שהחלב נגמר?'); const r = callFor('מי עדכן שהחלב נגמר?');
    assert.ok(where(r, 'מי ומתי:') >= 3, 'no who-and-when line');
    assert.match(r.system[where(r, 'מי ומתי:')].text, /חלב: עודכן אחרון ב-\d{4}-\d{2}-\d{2} על ידי מיכל/);
    await say(avi, 'תוסיף מים'); const w = callFor('תוסיף מים');
    assert.equal(where(w, 'מי ומתי:'), -1, '"מים" is not "מי"');
  });
  await check('E8', 'הקטלוג: שורה קצרה, תחת הקטגוריה; כל מוצר שאינו פרטי פעם אחת; בלי קטגוריה בשורה, בלי "עודכן", ו"נגמר" פעם אחת; כל שדה נשאר (פתוח מ-, קצב, של מי, שם החנות)', async () => {
    const fridge = sql("SELECT id FROM locations WHERE name = 'מקרר'")[0].id, pantry = sql("SELECT id FROM locations WHERE name = 'מזווה'")[0].id;
    const dairy = sql("SELECT id, name FROM categories ORDER BY id LIMIT 1")[0];
    sql("UPDATE products SET qty = 0, is_basic = 1, target = 2, category_id = ? WHERE id = 7", dairy.id);
    // a product with a value in every field
    sql(`INSERT INTO products (id, name, aliases, category_id, location_id, count_type, pack_size, qty, is_basic, target, store, expires, brand, reserve_location_id, reserve_qty, chametz, created, updated, updated_by)
      VALUES (30, 'פתיתים', '["פתיתים אפויים"]', ?, ?, 'pack', 4, 2, 1, 1, 'pharm', ?, 'אסם', ?, 1, 1, 1, 1, 2)`, dairy.id, fridge, Date.now() + 5 * 86400e3, pantry);
    sql("UPDATE products SET opened = ?, owner = 2 WHERE id = 30", Date.now() - 2 * 86400e3);
    for (const d of [30, 20, 10]) sql("INSERT INTO product_log (event_id, ts, product_id, kind) VALUES (0, ?, 30, 'out')", Date.now() - d * 86400e3);
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('pesach', '1'), ('house_mode', 'roommates')");
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await say(avi, 'שלום E8'); const r = callFor('שלום E8');
    const cat = r.system[2].text;
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('pesach', '0')"); sql("DELETE FROM settings WHERE key = 'house_mode'");
    sql("UPDATE products SET opened = NULL, owner = NULL WHERE id = 30"); sql('DELETE FROM product_log WHERE product_id = 30');
    for (const p of sql('SELECT name FROM products WHERE deleted IS NULL AND private_to IS NULL')) {
      assert.equal(cat.split('\n').filter((l) => /^\d+\|/.test(l) && l.split('|')[1] === p.name).length, 1, `${p.name} once`);
    }
    const rows = cat.split('\n'); const at = rows.findIndex((l) => l.startsWith('30|'));
    assert.equal(rows.slice(0, at).reverse().find((l) => l.startsWith('## ')), `## ${dairy.name}`, 'under its category');
    const line = cat.split('\n').find((l) => l.startsWith('30|'));
    for (const f of ['מקרר', 'כינויים פתיתים אפויים', 'סוג pack×4', 'קבוע, מינימום 1', 'חנות פארם', 'תוקף ', 'מזווה', 'חמץ', 'מותג אסם', 'פתוח מ-', 'קצב: ', 'של מיכל']) assert.ok(line.includes(f), `${f}: ${line}`);
    assert.ok(!line.includes(dairy.name), 'the category in the line');
    assert.doesNotMatch(cat, /עודכן|מיכל \d{4}-/, '"updated (who, when)"');
    const milk = cat.split('\n').find((l) => l.startsWith('7|'));
    assert.equal((milk.match(/נגמר/g) || []).length, 1, milk);
  });

  // 0e part 4: recipes (the owner 02/10: option 2)
  const part4 = (r) => r.system.slice(3).map((b) => b.text).join('\n');
  const ask = async (t, text) => { await say(t, text); return callFor(text); };
  await call(avi, 'POST', '/api/__recipes', { recipes: [
    { name: 'שמיכת דאמפלינג', ingredients: 'דפי גיוזה\nבשר טחון\nבצל ירוק', text: 'ממלאים וסוגרים.', tags: 'אסייתי', serves: 4 },
    { name: 'פסטה ברוטב עגבניות', ingredients: '500 גרם פסטה\n6 עגבניות\nשמן זית', text: 'מבשלים.', tags: 'איטלקי, פסטה', serves: 4 },
    { name: 'צ\'יזבורגר', ingredients: 'בשר טחון\nגבינה צהובה\nלחמניה', text: 'צולים.', tags: 'המבורגרים', serves: 2 },
    { name: 'סלמון בתנור', ingredients: 'פילה סלמון\nלימון', text: 'אופים.', tags: 'דגים', serves: 2 },
    { name: 'עוגת אגוזים', ingredients: 'אגוזי מלך\nקמח\nסוכר', text: 'אופים.', tags: 'עוגות', serves: 8 },
    { name: 'סלט ירוק', ingredients: 'חסה\nמלפפון', text: 'חותכים.', tags: 'סלטים', serves: 4 },
  ] });

  await check('E10', 'מתכונים בחלק 2: שם, תגיות, "ל-X" והמצרכים בלי כמויות; בלי "חסר בבית". בחלק 3 אין מתכונים', async () => {
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    const r = await ask(avi, 'שלום E10');
    const house = r.system[1].text;
    assert.match(house, /פסטה ברוטב עגבניות \[איטלקי, פסטה\] \(ל-4\): פסטה, עגבניות, שמן זית/);
    const recipeLines = house.slice(house.indexOf('מתכונים שמורים')).split('\n').slice(1);
    assert.ok(recipeLines.length >= 6 && recipeLines.every((l) => !/חסר|500 גרם/.test(l)), recipeLines.join(' / '));
    assert.doesNotMatch(r.system[2].text, /שמיכת דאמפלינג|מתכונים/);
  });

  await check('E11', 'מה נכנס לחלק 4: שאלה מה לבשל (12, 94), תגית, מצרך עם "עם", שם, מילה מהשם, ו"ל-X" (134–136); ולא "קניתי פסטה", "נגמרו העגבניות", "מה עושים הערב?", "שום דבר", "ל-1%"', async () => {
    let r = await ask(avi, 'מה אפשר לבשל הערב?');
    for (const n of ['שמיכת דאמפלינג', 'פסטה ברוטב עגבניות', 'סלט ירוק']) assert.match(part4(r), new RegExp(`${n}: (יש הכל|חסר)`), n);
    for (const t of ['מה יש לאכול?', 'מה אני יכול להכין?']) { r = await ask(avi, t); assert.match(part4(r), /מתכונים שמתאימים להודעה/, t); }
    r = await ask(avi, 'בא לי משהו אסייתי'); assert.match(part4(r), /שמיכת דאמפלינג: /);
    r = await ask(avi, 'יש משהו עם דפי גיוזה?'); assert.match(part4(r), /שמיכת דאמפלינג: /);
    r = await ask(avi, 'מה חסר לי לפסטה ברוטב עגבניות?'); assert.match(part4(r), /מתכון "פסטה ברוטב עגבניות"[^]*חסר בבית|מתכון "פסטה ברוטב עגבניות"[^]*יש בבית הכל/);
    r = await ask(avi, 'איך מכינים את הדאמפלינג?'); assert.match(part4(r), /מתכון "שמיכת דאמפלינג"/);
    r = await ask(avi, 'הכנתי פסטה ברוטב עגבניות ל-8'); assert.match(part4(r), /ל-8 \(המתכון ל-4\)/);
    for (const k of [0, 1, 2]) assert.ok(!r.system[k].text.includes('ל-8 (המתכון'), 'in a cached part');
    // and none for what only looks like it
    for (const t of ['קניתי פסטה', 'נגמרו העגבניות', 'מה עושים הערב?', 'לא נשאר שום דבר', 'קניתי חלב ל-1%']) {
      const r = await ask(michal, t);
      assert.doesNotMatch(part4(r), /מתכון "|מתכונים שמתאימים|המתכון ל-/, t);
    }
  });


  await check('E13', '"⚠" בחלק 2 לפי מה שהאדם לא אוכל (0.5, שלב 8): צמחוני = בשר, חזיר, ג\'לטין, ודג ופירות ים אם לא אוכל דגים; "לא אוכל בשר" = בשר; ערך אחר בלי; כשרות רק בשר וחלב, חזיר ופירות ים; "(לא אוכלת דגים)" לפי אותו כלל, גם ברבים; אלרגיה לפי מילה; עובדה פרטית לא', async () => {
    const fact = (uid, key, value, priv = 0, confirmed = uid) => sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', ?, ?, ?, 1, ?, ?, ?, 'chat', 1, 1)", uid, key, value, uid, confirmed, priv);
    // two who chose the plural (7ב), for "(לא אוכלים דגים)" and a value that isn't about animal foods
    sql("INSERT INTO users (id, name, gender, role, active, created) VALUES (5, 'נועם', 'p', 'member', 1, 0), (6, 'עדי', 'p', 'member', 1, 0), (7, 'רוני', 'f', 'member', 1, 0), (8, 'שי', 'p', 'member', 1, 0), (9, 'גיל', 'm', 'member', 1, 0), (10, 'טל', 'm', 'member', 1, 0)");
    await call(avi, 'POST', '/api/__recipes', { recipes: [
      { name: 'שניצל עוף', ingredients: 'חזה עוף\nפירורי לחם', text: 'מטגנים.', tags: 'עוף', serves: 4 },
      { name: 'פאייה פשוטה', ingredients: 'שרימפס\nאורז', text: 'מבשלים.', tags: 'ספרדי', serves: 4 },
      { name: 'ג\'לי', ingredients: 'ג\'לטין\nסוכר', text: 'מקררים.', tags: 'קינוחים', serves: 4 },
      { name: 'חביתה עם גבינה', ingredients: 'ביצים\nגבינה צהובה', text: 'מטגנים.', tags: 'בוקר', serves: 1 },
    ] });
    fact(2, 'diet', 'צמחונית, דגים מותר'); fact(4, 'diet', 'צמחונית, בלי דגים'); fact(3, 'kosher', 'כן', 0, 1); fact(1, 'allergy', 'בוטנים ואגוזים', 0, null); fact(2, 'health', 'סוכרת סוג 1', 1);
    fact(1, 'diet', 'לא אוכל בשר'); fact(5, 'diet', 'צמחונים, בלי דגים'); fact(6, 'diet', 'ללא גלוטן');
    // "ולא" denies too; the plural that eats fish; "לא טבעוני" isn't vegan; "בלי בשר ודגים"; kosher that's denied
    fact(7, 'diet', 'צמחונית ולא אוכלת דגים'); fact(8, 'diet', 'צמחונים, אוכלים דגים'); fact(9, 'diet', 'צמחוני, לא טבעוני'); fact(10, 'diet', 'בלי בשר ודגים');
    fact(6, 'kosher', 'בכלל לא'); fact(8, 'kosher', 'ולא שומרים');
    try {
      const r = await ask(avi, 'שלום E13'); const h = r.system[1].text;
      for (const n of ["צ'יזבורגר", 'שניצל עוף', 'פאייה פשוטה', "ג'לי", 'חביתה עם גבינה', 'סלמון בתנור', 'סלט ירוק', 'עוגת אגוזים']) assert.match(h, new RegExp(`(^|\\n)${n}[ :\\[(]`), `no line for ${n}`);
      const flags = (recipe) => (new RegExp(`(^|\\n)${recipe}[^\\n]*\\n((?:  ⚠[^\\n]*\\n?)*)`).exec(h)?.[2] || '');
      // vegetarian, eats fish (r8p 1): meat and gelatin; not fish, not seafood, not eggs or cheese
      assert.match(flags("צ'יזבורגר"), /⚠ מיכל, תזונה: צמחונית, דגים מותר\. במתכון: [^\n]*בשר טחון/, 'vegetarian, meat');
      assert.match(flags("ג'לי"), /⚠ מיכל, תזונה: צמחונית, דגים מותר\. במתכון: /, 'vegetarian, gelatin (r8p 1ב)');
      assert.doesNotMatch(flags('סלמון בתנור'), /מיכל/, 'eats fish: no flag on salmon');
      assert.doesNotMatch(flags('פאייה פשוטה'), /מיכל/, 'eats fish: seafood is the same (r8p 1)');
      assert.doesNotMatch(flags('חביתה עם גבינה'), /⚠ (מיכל|דנה|נועם)/, 'vegetarian: no flag on eggs and cheese');
      // vegetarian, no fish: fish and seafood too, and "(לא אוכלת דגים)" for the model by the same rule
      assert.match(flags('סלמון בתנור'), /⚠ דנה, תזונה: צמחונית, בלי דגים\. במתכון: פילה סלמון/, 'no fish, salmon');
      assert.match(flags('פאייה פשוטה'), /⚠ דנה, תזונה: צמחונית, בלי דגים\. במתכון: שרימפס/, 'no fish, seafood');
      assert.match(h, /דנה: [^\n]*diet: צמחונית, בלי דגים \(לא אוכלת דגים\)/, '"(לא אוכלת דגים)" for "בלי דגים"');
      assert.doesNotMatch(h, /מיכל: [^\n]*diet: צמחונית, דגים מותר \(לא אוכלת דגים\)/, 'eats fish: no "(לא אוכלת דגים)"');
      // the plural (7ב): the same rule, "(לא אוכלים דגים)"
      assert.match(flags('סלמון בתנור'), /⚠ נועם, תזונה: צמחונים, בלי דגים\. במתכון: פילה סלמון/, 'plural, no fish, salmon');
      assert.match(h, /נועם: [^\n]*diet: צמחונים, בלי דגים \(לא אוכלים דגים\)/, '"(לא אוכלים דגים)"');
      // "לא אוכל בשר" = meat and pork only (r8p 17); a value that isn't about animal foods: nothing
      assert.match(flags("צ'יזבורגר"), /⚠ אבי, תזונה: לא אוכל בשר\. במתכון: בשר טחון/, '"לא אוכל בשר", meat');
      assert.doesNotMatch(flags('סלמון בתנור') + flags("ג'לי") + flags('חביתה עם גבינה'), /אבי, תזונה/, '"לא אוכל בשר": not fish, gelatin or cheese');
      assert.doesNotMatch(h, /⚠ עדי/, '"ללא גלוטן": no flag from animal foods');
      // kosher (decision 2): meat and milk together, pork, seafood; not chicken alone
      assert.match(flags("צ'יזבורגר"), /⚠ יואבי, כשרות: כן\. במתכון: [^\n]*בשר וחלב/, 'kosher, meat and cheese');
      assert.match(flags('פאייה פשוטה'), /⚠ יואבי, כשרות: כן\. במתכון: [^\n]*פירות ים/, 'kosher, seafood');
      assert.doesNotMatch(flags('שניצל עוף') + flags('חביתה עם גבינה'), /יואבי/, 'kosher: chicken alone, cheese alone');
      assert.match(flags('עוגת אגוזים'), /⚠ אבי, אלרגיה: בוטנים ואגוזים\. במתכון: אגוזי מלך \(עוד לא אושר\)/, 'allergy by word, not yet confirmed');
      assert.equal(flags('סלט ירוק'), '', 'nothing from an animal: no flag');
      assert.doesNotMatch(h, /סוכרת סוג 1/, 'a private fact');
      assert.match(flags('סלמון בתנור'), /⚠ רוני, תזונה: צמחונית ולא אוכלת דגים\. במתכון: פילה סלמון/, '"ולא אוכלת דגים" denies');
      assert.match(h, /רוני: [^\n]*\(לא אוכלת דגים\)/);
      assert.doesNotMatch(flags('סלמון בתנור') + flags('פאייה פשוטה'), /שי/, 'the plural that eats fish: no fish flag');
      assert.doesNotMatch(h, /שי: [^\n]*\(לא אוכלים דגים\)/);
      assert.doesNotMatch(flags('חביתה עם גבינה'), /גיל/, '"צמחוני, לא טבעוני" is not vegan');
      assert.match(flags('סלמון בתנור'), /⚠ גיל, תזונה: צמחוני, לא טבעוני\. במתכון: פילה סלמון/, 'a vegetarian: fish');
      assert.match(h, /גיל: [^\n]*\(לא אוכל דגים\)/);
      assert.match(flags('סלמון בתנור'), /⚠ טל, תזונה: בלי בשר ודגים\. במתכון: פילה סלמון/, '"בלי בשר ודגים": fish too');
      assert.doesNotMatch(flags("ג'לי"), /טל/, '"בלי בשר ודגים" is not vegetarian: no gelatin');
      assert.doesNotMatch(h, /⚠ (עדי|שי), כשרות/, 'kosher denied: "בכלל לא", "ולא שומרים"');
    } finally { sql('DELETE FROM facts WHERE about_id IN (5, 6, 7, 8, 9, 10)'); sql('DELETE FROM users WHERE id IN (5, 6, 7, 8, 9, 10)'); }
  });

  await check('E14', '"⚠": קבוצה בשמה ("פירות ים", "פירות הים", "מאכלי ים", "דגים", "דגי ים") לפי הרשימה, ולא "מים"; "בלי" לא נבדק; מילה קצרה ("דג") כמילה שלמה, גם "בדג", ולא "דגני"; טבעונית מול שקשוקה (ביצים, פטה); אלרגיה לאגוזים לבד; אלרגיה שהאות הראשונה שלה כמו אות תחילית (ביצים, בוטנים); עובדה פרטית בחלק 4 של מי שהיא עליו בלבד', async () => {
    sql('DELETE FROM facts');
    await call(avi, 'POST', '/api/__recipes', { recipes: [
      { name: 'שקשוקה', ingredients: '4 ביצים\n3 עגבניות\nגבינת פטה', text: 'מבשלים.', tags: 'בוקר', serves: 2 },
      { name: 'עוגיות חמאת בוטנים', ingredients: 'חמאת בוטנים\nקמח\nסוכר', text: 'אופים.', tags: 'עוגיות', serves: 6 },
    ] });
    const fact = (uid, key, value, priv = 0) => sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', ?, ?, ?, 1, ?, ?, ?, 'chat', 1, 1)", uid, key, value, uid, uid, priv);
    await call(avi, 'POST', '/api/__recipes', { recipes: [
      { name: 'דג בתנור', ingredients: 'דג סלמון\nלימון', text: 'אופים.', tags: 'דגים', serves: 2 },
      { name: 'מרק עם דג', ingredients: 'מים\nבדג טרי', text: 'מבשלים.', tags: 'מרקים', serves: 4 },
      { name: 'סלט דגנים', ingredients: 'דגני בוקר\nיוגורט', text: 'מערבבים.', tags: 'בוקר', serves: 1 },
      { name: 'פאייה', ingredients: 'שרימפס\nקלמרי\nמיקס פירות ים\nאורז', text: 'מבשלים.', tags: 'ספרדי', serves: 4 },
      { name: 'מרק ירקות', ingredients: 'מים\nמלח ים\nגזר', text: 'מבשלים.', tags: 'מרקים', serves: 4 },
      { name: 'פסטה בלי מלח', ingredients: 'פסטה\nבלי מלח\nשמן זית', text: 'מבשלים.', tags: 'פסטה', serves: 2 },
    ] });
    fact(4, 'diet', 'טבעונית'); fact(3, 'allergy', 'אגוזים'); fact(2, 'allergy', 'ביצים'); fact(1, 'allergy', 'בוטנים'); fact(2, 'health', 'סוכרת סוג 1', 1);
    fact(1, 'avoid', 'דג'); fact(3, 'avoid', 'דגים'); fact(4, 'allergy', 'פירות ים');
    fact(2, 'avoid', 'פירות הים ומאכלי ים'); fact(4, 'avoid', 'בלי דגי ים');
    const r = await ask(avi, 'שלום E14'); const h = r.system[1].text;
    assert.match(h, /שקשוקה[^\n]*\n(?:  ⚠[^\n]*\n)*  ⚠ דנה, תזונה: טבעונית\. במתכון: (?=[^\n]*ביצים)(?=[^\n]*פטה)/, 'vegan, eggs and feta');
    assert.match(h, /עוגת אגוזים[^\n]*\n(?:  ⚠[^\n]*\n)*  ⚠ יואבי, אלרגיה: אגוזים\. במתכון: אגוזי מלך/, 'nuts alone');
    assert.match(h, /  ⚠ מיכל, אלרגיה: ביצים\. במתכון: [^\n]*ביצים/, 'eggs: ב is the word\'s own');
    assert.match(h, /  ⚠ אבי, אלרגיה: בוטנים\. במתכון: חמאת בוטנים/, 'peanuts: ב and ו are the word\'s own');
    // a short word ("דג") is a whole word, also with a prefix letter; and "דגים" also as "דג" (the owner 03/10, question 36)
    assert.match(h, /דג בתנור[^\n]*\n(?:  ⚠[^\n]*\n)*  ⚠ אבי, לא אוכל: דג\. במתכון: דג סלמון/, 'דג, דג סלמון');
    assert.match(h, /מרק עם דג[^\n]*\n(?:  ⚠[^\n]*\n)*  ⚠ אבי, לא אוכל: דג\. במתכון: בדג/, 'דג, בדג'); // "טרי" isn't part of the name since 16/10
    assert.match(h, /דג בתנור[^\n]*\n(?:  ⚠[^\n]*\n)*  ⚠ יואבי, לא אוכל: דגים\. במתכון: דג סלמון/, 'דגים, דג סלמון');
    assert.doesNotMatch(h, /סלט דגנים[^\n]*\n(?:  ⚠[^\n]*\n)*  ⚠ (אבי|יואבי), לא אוכל/, 'דגני בוקר is not fish');
    // a group by its name: its list and the name as a whole phrase, and "ים" alone finds nothing (the owner 03/10, question 37א)
    assert.match(h, /פאייה[^\n]*\n(?:  ⚠[^\n]*\n)*  ⚠ דנה, אלרגיה: פירות ים\. במתכון: (?=[^\n]*שרימפס)(?=[^\n]*קלמרי)(?=[^\n]*מיקס פירות ים)/, 'פירות ים: shrimp, squid, "פירות ים"');
    assert.doesNotMatch(h, /מרק ירקות[^\n]*\n(?:  ⚠[^\n]*\n)*  ⚠ דנה, אלרגיה/, 'פירות ים: מים or מלח ים');
    assert.match(h, /סלמון בתנור[^\n]*\n(?:  ⚠[^\n]*\n)*  ⚠ יואבי, לא אוכל: דגים\. במתכון: פילה סלמון/, 'דגים: salmon');
    // "פירות הים", "מאכלי ים", "דגי ים" are groups too, and "בלי" is a common word (the owner 03/10, question 42)
    assert.match(h, /פאייה[^\n]*\n(?:  ⚠[^\n]*\n)*  ⚠ מיכל, לא אוכל: פירות הים ומאכלי ים\. במתכון: (?=[^\n]*שרימפס)/, 'פירות הים: shrimp');
    assert.doesNotMatch(h, /מרק ירקות[^\n]*\n(?:  ⚠[^\n]*\n)*  ⚠ (מיכל|דנה), לא אוכל/, 'פירות הים / דגי ים: מים or מלח ים');
    assert.match(h, /סלמון בתנור[^\n]*\n(?:  ⚠[^\n]*\n)*  ⚠ דנה, לא אוכל: בלי דגי ים\. במתכון: פילה סלמון/, 'דגי ים: salmon');
    assert.doesNotMatch(h, /פסטה בלי מלח[^\n]*\n(?:  ⚠[^\n]*\n)*  ⚠ דנה, לא אוכל/, '"בלי" found "בלי מלח"');
    assert.doesNotMatch(h, /סוכרת סוג 1/, 'a private fact, not in part 2');
    assert.doesNotMatch(part4(r), /סוכרת סוג 1/, 'nor in someone else\'s part 4');
    const m = await ask(michal, 'שלום E14 מיכל');
    assert.doesNotMatch(m.system.slice(0, 3).map((b) => b.text).join('\n'), /סוכרת סוג 1/, 'not in the cached parts');
    assert.match(part4(m), /סוכרת סוג 1/, 'in the part 4 of the one it is about');
  });
} finally {
  srv.kill(); mock.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} cache checks passed`);
if (failed.length) { console.log(log.split('\n').filter((l) => /error|Error/.test(l)).slice(-8).join('\n')); process.exit(1); }
