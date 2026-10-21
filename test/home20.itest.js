// home20 (section 16, the weekly plan): /api/plan, what a dish's end takes off the list, "הכנו את זה", the backup, a child, and
// the chat's card with a fake model. Run: node --disable-warning=ExperimentalWarning test/home20.itest.js
import './fetch-retry.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { todayOf, addDays } from '../worker/plan.js';

const DIR = '/tmp/shuki-test/shuki-home20'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const PORT = 8887, MOCK = 8888;

const db0 = new DatabaseSync(`${DIR}/shuki.db`);
db0.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) { db0.exec(readFileSync(`migrations/${f}`, 'utf8')); db0.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f); }
db0.exec(readFileSync('test/fixture-house.sql', 'utf8'));
db0.exec("INSERT INTO users (id, name, gender, role, active, created) VALUES (3, 'יואבי', 'm', 'child', 1, 0)");
db0.exec("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999), ('222222', 2, 9999999999999), ('333333', 3, 9999999999999)");
db0.close();

const answers = [], reqs = []; let calls = 0;
const lastSystem = () => (reqs.at(-1)?.system || []).map((b) => b.text).join('\n');
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => {
  const body = JSON.parse(Buffer.concat(parts).toString('utf8')); calls++; reqs.push(body);
  const input = answers.shift() || { reply: 'בסדר', face: 'happy' };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'tool_use', id: `tu${calls}`, name: body.tools?.[0]?.name || 'respond', input }], usage: { input_tokens: 1, output_tokens: 1 } }));
}); }).listen(MOCK, '127.0.0.1');
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/node.js'], { env: { ...process.env, PORT: String(PORT), DB_PATH: `${DIR}/shuki.db`, ANTHROPIC_API_KEY: 't', ANTHROPIC_URL: `http://127.0.0.1:${MOCK}/v1/messages`, RETRY_MS: '1', TEST_RESET: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
const call = async (t, m, p, b) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, data: await r.json().catch(() => null) }; };
const sql = (q, ...a) => { const d = new DatabaseSync(`${DIR}/shuki.db`); try { return /^\s*select/i.test(q) ? d.prepare(q).all(...a) : d.prepare(q).run(...a); } finally { d.close(); } };
const results = [];
async function check(id, name, fn) {
  try { await fn(); results.push({ id, ok: true }); console.log('✓', id, name); }
  catch (e) { results.push({ id, ok: false }); console.log('✗', id, name, '\n   ', e.message.slice(0, 600)); }
}
const lines = (r) => (r?.proposal?.lines || []).map((l) => l.text);
const say = async (t, text) => (await call(t, 'POST', '/api/chat', { text })).data;
const apply = async (t, r, skip) => { assert.ok(r?.proposal?.id, `no card: ${JSON.stringify(r).slice(0, 300)}`); const x = await call(t, 'POST', `/api/proposals/${r.proposal.id}/apply`, skip ? { skip } : {}); assert.equal(x.status, 200, JSON.stringify(x.data)); return x.data; };
const plan = (t, b) => call(t, 'POST', '/api/plan', b);
const T = () => todayOf(Date.now()), D = (k) => addDays(T(), k);
const loc = (n) => sql('SELECT id FROM locations WHERE name = ?', n)[0]?.id;
// the house: 4 eggs, no milk; shakshuka (3 eggs), Dana's quiche (3 eggs, milk, spinach) added by Michal, a cake by Michal
const prep = () => {
  answers.length = 0;
  for (const t of ['proposals', 'chat', 'meal_plan', 'meal_plan_items', 'list_items', 'cooked_log', 'recipe_ingredients', 'recipes', 'products']) sql(`DELETE FROM ${t}`);
  sql("DELETE FROM settings WHERE key LIKE 'ask%' OR key IN ('daily_q', 'dup_no', 'basics_asked')");
  sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('shop_produce', 'super'), ('shop_care', 'super'), ('shop_asked', '1')");
  sql("INSERT INTO products (id, name, aliases, count_type, qty, is_basic, created, updated, location_id) VALUES (1, 'ביצים', '[]', 'units', 4, 0, 0, 0, ?)", loc('מקרר'));
  sql("INSERT INTO products (id, name, aliases, count_type, level, qty, is_basic, created, updated, location_id) VALUES (2, 'חלב', '[]', 'level', 'none', 0, 0, 0, 0, ?)", loc('מקרר'));
  sql("INSERT INTO products (id, name, aliases, count_type, qty, is_basic, created, updated, location_id) VALUES (3, 'גבינה בולגרית', '[]', 'units', 0, 0, 0, 0, ?)", loc('מקרר'));
  sql("INSERT INTO recipes (id, name, ingredients, text, added_by, added, serves, cooked, parsed) VALUES (10, 'שקשוקה', '3 ביצים', 'מטגנים.', 1, 0, NULL, 0, 1), (11, 'פשטידת התרד של דנה', '3 ביצים', 'אופים.', 2, 0, NULL, 0, 1), (12, 'עוגת גזר', 'גזר', 'אופים.', 2, 0, NULL, 0, 1)");
  sql("INSERT INTO recipe_ingredients (recipe_id, pos, qty, name, line, product_id) VALUES (10, 0, 3, 'ביצים', '3 ביצים', 1), (11, 0, 3, 'ביצים', '3 ביצים', 1), (11, 1, NULL, 'חלב', 'חלב', 2), (11, 2, 1, 'תרד', 'תרד', NULL), (11, 3, 1, 'גבינה בולגרית', 'גבינה בולגרית', 3), (12, 0, 2, 'גזר', '2 גזר', NULL)");
};
const items = (pid) => sql('SELECT * FROM list_items WHERE ' + (typeof pid === 'number' ? 'product_id = ?' : 'text = ?'), pid);

let avi, michal, yoavi;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${PORT}`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  [avi, michal, yoavi] = await Promise.all(['111111', '222222', '333333'].map(async (code) => (await call(null, 'POST', '/api/pair', { code })).data.token));
  for (const t of [avi, michal, yoavi]) await say(t, 'אחר כך'); // past the first meeting

  /* ---------- the API ---------- */
  await check('P1', 'GET: שבעה ימים מהיום; להוסיף מתכון להיום ומנה בלי מתכון למחר; החותמות מהשרת', async () => {
    prep();
    const g0 = (await call(avi, 'GET', '/api/plan')).data;
    assert.equal(g0.days.length, 7); assert.equal(g0.days[0], T()); assert.deepEqual(g0.dishes, []); assert.equal(g0.missing, 0);
    const a = await plan(avi, { op: 'add', day: T(), recipe_id: 10 });
    assert.equal(a.status, 200, JSON.stringify(a.data)); assert.equal(a.data.missing, 0);
    const b = await plan(avi, { op: 'add', day: D(1), text: 'דגים' });
    assert.equal(b.data.missing, 0);
    const c = await plan(avi, { op: 'add', day: D(2), recipe_id: 11 });
    assert.equal(c.data.missing, 4, 'eggs (1 left after the shakshuka), milk, spinach, cheese');
    const g = (await call(avi, 'GET', '/api/plan')).data;
    assert.deepEqual(g.dishes.map((d) => [d.day, d.name, d.miss ?? null]), [[T(), 'שקשוקה', 0], [D(1), 'דגים', null], [D(2), 'פשטידת התרד של דנה', 4]]);
    assert.equal(g.missing, 4);
    assert.equal((await plan(avi, { op: 'add', day: D(-1), recipe_id: 10 })).status, 400, 'yesterday');
    assert.equal((await plan(avi, { op: 'add', day: D(14), recipe_id: 10 })).status, 400, 'too far');
    assert.equal((await plan(avi, { op: 'add', day: T(), recipe_id: 10 })).data.id, a.data.id, 'the same dish on a day is once');
    // the state carries it too, for the screen
    const st = (await call(avi, 'GET', '/api/state')).data;
    assert.equal(st.plan.dishes.length, 3);
  });
  await check('P2', '"להוסיף לרשימה" (הטוסט): השורות של המנה, הביצים בסכום (2), ונרשמות כשל המנה; מה שכבר ברשימה לא נרשם', async () => {
    prep();
    sql("INSERT INTO list_items (product_id, status, added, store, source) VALUES (3, 'open', 0, 'super', 'manual')"); // the cheese was on the list before
    const s = (await plan(avi, { op: 'add', day: T(), recipe_id: 10 })).data.id;
    const q = (await plan(avi, { op: 'add', day: D(1), recipe_id: 11 })).data.id;
    const r = await plan(avi, { op: 'list', ids: [q] });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.added, 3);
    assert.equal(items(1)[0].want, 2, 'eggs: 3 + 3 against 4');
    assert.equal(items('תרד').length, 1); assert.equal(items(2).length, 1);
    const mine = sql('SELECT plan_id, list_item_id, qty FROM meal_plan_items ORDER BY list_item_id');
    assert.equal(mine.length, 3);
    assert.ok(mine.every((m) => m.plan_id === q));
    assert.ok(!mine.some((m) => m.list_item_id === items(3)[0].id), 'the line from before is not the dish\'s');
    assert.equal(mine.find((m) => m.list_item_id === items(1)[0].id).qty, 2);
    assert.equal((await call(avi, 'GET', '/api/plan')).data.missing, 0, 'all on the list');
    assert.ok(s);
  });
  await check('P3', '"להוריד מהתכנון": השאלה רק כשיש מה להוריד; "כן, להוריד" מוריד רק מה שפתוח, ומה שמנה אחרת צריכה יורד בכמות', async () => {
    prep();
    const q = (await plan(avi, { op: 'add', day: T(), recipe_id: 11 })).data.id;
    const q2 = (await plan(avi, { op: 'add', day: D(1), recipe_id: 10 })).data.id; // the shakshuka needs eggs too (1 left of 4)
    await plan(avi, { op: 'list' });
    const eggs = items(1)[0];
    assert.equal(eggs.want, 2);
    assert.deepEqual(sql('SELECT plan_id, qty FROM meal_plan_items WHERE list_item_id = ?', eggs.id).map((x) => [x.plan_id, x.qty]), [[q2, 2]]);
    sql("UPDATE list_items SET status = 'checked' WHERE product_id = 2"); // the milk is in the cart: it stays
    const r = await plan(avi, { op: 'remove', id: q });
    assert.equal(r.data.ask, 'האם להוריד מהרשימה את מה שנכנס בשבילה?', JSON.stringify(r.data));
    assert.deepEqual([r.data.yes, r.data.no], ['כן, להוריד', 'לא, להשאיר']);
    assert.equal(sql('SELECT COUNT(*) AS n FROM meal_plan WHERE id = ?', q)[0].n, 0);
    const u = await plan(avi, { op: 'unlist', id: q });
    assert.equal(u.status, 200, JSON.stringify(u.data)); assert.equal(u.data.removed, 2, 'spinach and cheese');
    assert.equal(items('תרד').length, 0); assert.equal(items(3).length, 0);
    assert.equal(items(2).length, 1, 'in the cart: stays');
    assert.equal(items(1).length, 1, 'the shakshuka\'s eggs stay');
    assert.equal(sql('SELECT COUNT(*) AS n FROM meal_plan_items WHERE plan_id = ?', q)[0].n, 0);
    // the shakshuka off too: its eggs come off; nothing was the dish's → no question
    const r2 = await plan(avi, { op: 'remove', id: q2 });
    assert.ok(r2.data.ask); await plan(avi, { op: 'unlist', id: q2 });
    assert.equal(items(1).length, 0);
    const q3 = (await plan(avi, { op: 'add', day: T(), recipe_id: 12 })).data.id;
    assert.deepEqual((await plan(avi, { op: 'remove', id: q3 })).data, { ok: true }, 'nothing went on for it: not asked');
  });
  await check('P4', 'שורה של שתי מנות: ביטול של אחת מוריד את הכמות שלה ומשאיר את השורה; "לא, להשאיר" לא נוגע', async () => {
    prep(); sql('UPDATE products SET qty = 0 WHERE id = 1');
    const a = (await plan(avi, { op: 'add', day: T(), recipe_id: 10 })).data.id;
    const b = (await plan(avi, { op: 'add', day: D(1), recipe_id: 11 })).data.id;
    await plan(avi, { op: 'list' });
    assert.equal(items(1)[0].want, 6);
    await plan(avi, { op: 'remove', id: a }); await plan(avi, { op: 'unlist', id: a });
    assert.equal(items(1)[0].want, 3, '6 - 3');
    const r = await plan(avi, { op: 'remove', id: b }); assert.ok(r.data.ask);
    await plan(avi, { op: 'keep', id: b });
    assert.equal(items(1).length, 1); assert.equal(items('תרד').length, 1);
    assert.equal(sql('SELECT COUNT(*) AS n FROM meal_plan_items')[0].n, 0);
  });
  await check('P5', '"להעביר ליום אחר": רק היום משתנה, והרשימה נשארת', async () => {
    prep();
    const q = (await plan(avi, { op: 'add', day: T(), recipe_id: 11 })).data.id;
    await plan(avi, { op: 'list' }); const n = sql('SELECT COUNT(*) AS n FROM list_items')[0].n;
    assert.equal((await plan(avi, { op: 'move', id: q, day: D(3) })).status, 200);
    assert.equal(sql('SELECT day FROM meal_plan WHERE id = ?', q)[0].day, D(3));
    assert.equal(sql('SELECT COUNT(*) AS n FROM list_items')[0].n, n);
    assert.equal(sql('SELECT COUNT(*) AS n FROM meal_plan_items WHERE plan_id = ?', q)[0].n, n);
  });
  await check('P6', '"הכנו את זה" על מנה: cooked עם cooked_log_id, ומה שפתוח ברשימה בשבילה יורד', async () => {
    prep();
    const q = (await plan(avi, { op: 'add', day: T(), recipe_id: 11 })).data.id;
    await plan(avi, { op: 'list' });
    sql("UPDATE list_items SET status = 'done' WHERE product_id = 2"); // the milk was bought
    const r = await call(avi, 'POST', '/api/recipes/11/cooked', { plan: q });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    if (r.data.proposal) await apply(avi, r.data);
    const row = sql('SELECT status, cooked_log_id FROM meal_plan WHERE id = ?', q)[0];
    assert.equal(row.status, 'cooked');
    assert.equal(row.cooked_log_id, sql('SELECT id FROM cooked_log WHERE recipe_id = 11')[0].id);
    assert.equal(items('תרד').length, 0); assert.equal(items(3).length, 0, 'open: off');
    assert.equal(items(2).length, 1, 'bought: stays');
    // a dish without a recipe: only marked
    const f = (await plan(avi, { op: 'add', day: T(), text: 'דגים' })).data.id;
    assert.equal((await plan(avi, { op: 'cooked', id: f })).status, 200);
    assert.equal(sql('SELECT status FROM meal_plan WHERE id = ?', f)[0].status, 'cooked');
  });
  await check('P7', '"הכנתי שקשוקה" בצ\'אט: השקשוקה של היום מסומנת; בלי תכנון לא נכנס לתכנון', async () => {
    prep();
    const q = (await plan(avi, { op: 'add', day: T(), recipe_id: 10 })).data.id;
    answers.push({ reply: 'בתיאבון!', face: 'yummy' === 'x' ? 'x' : 'happy' });
    await say(avi, 'הכנו שקשוקה');
    const row = sql('SELECT status, cooked_log_id FROM meal_plan WHERE id = ?', q)[0];
    assert.equal(row.status, 'cooked', JSON.stringify(row));
    assert.ok(row.cooked_log_id);
    answers.push({ reply: 'בתיאבון!', face: 'happy' });
    await say(avi, 'הכנו שקשוקה');
    assert.equal(sql('SELECT COUNT(*) AS n FROM meal_plan')[0].n, 1, 'no new dish');
  });
  await check('P8', 'אתמול: השאלה רק על מתכון; "כן, הכנו" נרשם לאתמול; "לא" מסמן skipped; "להעביר להיום"', async () => {
    prep();
    sql("INSERT INTO meal_plan (id, day, pos, recipe_id, text, status, created, updated) VALUES (900, ?, 0, 10, NULL, 'planned', 0, 0), (901, ?, 1, NULL, 'פיצה', 'planned', 0, 0)", D(-1), D(-1));
    let g = (await call(avi, 'GET', '/api/plan')).data;
    assert.deepEqual(g.yesterday, { id: 900, recipe_id: 10, name: 'שקשוקה', ask: 'האם הכנתם אתמול את השקשוקה?' });
    const r = await call(avi, 'POST', '/api/recipes/10/cooked', { plan: 900 });
    if (r.data.proposal) await apply(avi, r.data);
    assert.equal(sql('SELECT status FROM meal_plan WHERE id = 900')[0].status, 'cooked');
    const ts = sql('SELECT ts FROM cooked_log')[0].ts;
    assert.equal(todayOf(ts), D(-1), 'made yesterday');
    g = (await call(avi, 'GET', '/api/plan')).data; assert.equal(g.yesterday, null);
    sql("INSERT INTO meal_plan (id, day, pos, recipe_id, status, created, updated) VALUES (902, ?, 2, 11, 'planned', 0, 0)", D(-1));
    assert.deepEqual((await plan(avi, { op: 'skip', id: 902 })).data, { ok: true });
    assert.equal(sql('SELECT status FROM meal_plan WHERE id = 902')[0].status, 'skipped');
    sql("INSERT INTO meal_plan (id, day, pos, recipe_id, status, created, updated) VALUES (903, ?, 3, 11, 'planned', 0, 0)", D(-1));
    assert.equal((await plan(avi, { op: 'move', id: 903, day: T() })).status, 200);
    assert.equal(sql('SELECT day FROM meal_plan WHERE id = 903')[0].day, T());
  });
  await check('P9', 'ילד: רואה את התכנון ולא משנה אותו', async () => {
    prep(); await plan(avi, { op: 'add', day: T(), recipe_id: 10 });
    const g = await call(yoavi, 'GET', '/api/plan');
    assert.equal(g.status, 200); assert.equal(g.data.dishes.length, 1);
    for (const b of [{ op: 'add', day: T(), text: 'פיצה' }, { op: 'remove', id: g.data.dishes[0].id }, { op: 'list' }]) assert.equal((await plan(yoavi, b)).status, 403, JSON.stringify(b));
    assert.equal(sql('SELECT COUNT(*) AS n FROM meal_plan')[0].n, 1);
  });
  await check('P10', 'גיבוי: בהורדה ובעותק היומי, ושחזור של יום מחזיר את התכנון ואת מה שנכנס בשבילו; מחיקה של ימים ישנים', async () => {
    prep();
    const q = (await plan(avi, { op: 'add', day: T(), recipe_id: 11 })).data.id;
    await plan(avi, { op: 'list' });
    const bk = (await call(avi, 'GET', '/api/export')).data;
    assert.equal(bk.meal_plan.length, 1); assert.equal(bk.meal_plan_items.length, 3);
    await call(avi, 'POST', '/api/__schedule', { now: Date.now() });
    const day = (await call(avi, 'GET', '/api/backups')).data.backups[0]?.day; assert.ok(day, 'a backup');
    sql('DELETE FROM meal_plan'); sql('DELETE FROM meal_plan_items');
    assert.equal((await call(avi, 'POST', '/api/backups/restore', { day })).status, 200);
    assert.equal(sql('SELECT id FROM meal_plan')[0]?.id, q);
    assert.equal(sql('SELECT COUNT(*) AS n FROM meal_plan_items')[0].n, 3);
    sql("INSERT INTO meal_plan (day, pos, recipe_id, status, created, updated) VALUES (?, 0, 10, 'cooked', 0, 0)", D(-31));
    sql('INSERT INTO meal_plan_items (plan_id, list_item_id, qty) VALUES (99999, 1, NULL)');
    await call(avi, 'POST', '/api/__schedule', { now: Date.now() });
    assert.deepEqual(sql('SELECT day FROM meal_plan').map((x) => x.day), [T()]);
    assert.equal(sql('SELECT COUNT(*) AS n FROM meal_plan_items WHERE plan_id = 99999')[0].n, 0);
  });

  await check('P11', 'תיקון 1 (19/10): ביצים באריזה של 12 ומתכונים שסופרים ביצים: לרשימה אריזה אחת, בכרטיס "9 ביצים L"; ביטול של מנה אחת משאיר אריזה', async () => {
    prep(); sql("UPDATE products SET name = 'ביצים L', count_type = 'pack', pack_size = 12, qty = 0 WHERE id = 1");
    sql("UPDATE recipe_ingredients SET qty = 6 WHERE recipe_id = 10 AND product_id = 1");
    const a = (await plan(avi, { op: 'add', day: T(), recipe_id: 10 })).data.id;
    const b = (await plan(avi, { op: 'add', day: D(1), recipe_id: 11 })).data.id;
    const c = await plan(avi, { op: 'card' });
    const eggs = c.data.proposal.lines.find((l) => /ביצים/.test(l.text));
    assert.equal(eggs.text, 'להוסיף 9 ביצים L לרשימה?', JSON.stringify(c.data.proposal.lines));
    await call(avi, 'POST', `/api/proposals/${c.data.proposal.id}/apply`, {});
    assert.equal(items(1)[0].want, null, 'one pack (the default), not 9');
    await plan(avi, { op: 'remove', id: b }); await plan(avi, { op: 'unlist', id: b });
    assert.equal(items(1).length, 1, 'the shakshuka still needs a pack');
    const r = await call(avi, 'POST', '/api/recipes/10/missing', {});
    assert.equal(r.status, 200);
    assert.ok(a);
  });

  /* ---------- the chat ---------- */
  await check('C1', '"היום דגים, מחר המנה של דנה": כרטיס אחד, שורות התכנון ושורות הרשימה מהשרת ("בשביל הפשטידה"); אחרי האישור נשמר ונרשם', async () => {
    prep(); sql('DELETE FROM recipes WHERE id = 12');
    answers.push({ reply: 'לפשטידת התרד של דנה חסרים תרד וגבינה בולגרית. האם ככה?', face: 'happy', actions: [{ kind: 'plan', date: T(), text: 'דגים' }, { kind: 'plan', date: D(1), text: 'המנה של מיכל' }, { kind: 'list_add', text: 'תרד' }] });
    const r = await say(avi, 'היום דגים, מחר המנה של מיכל');
    assert.ok(r.proposal, JSON.stringify(r).slice(0, 400));
    const l = r.proposal.lines;
    assert.equal(l[0].text, 'לתכנן דגים להיום?'); assert.equal(l[0].detail, 'בלי מתכון');
    assert.equal(l[1].text, 'לתכנן את פשטידת התרד של דנה למחר?');
    const adds = l.filter((x) => /לרשימה/.test(x.text));
    assert.deepEqual(adds.map((x) => x.text).sort(), ['להוסיף גבינה בולגרית לרשימה?', 'להוסיף חלב לרשימה?', 'להוסיף תרד לרשימה?'], JSON.stringify(l));
    assert.ok(adds.every((x) => x.detail === 'בשביל הפשטידה'), JSON.stringify(adds));
    await apply(avi, r);
    const rows = sql('SELECT id, day, recipe_id, text, added_by FROM meal_plan ORDER BY day');
    assert.deepEqual(rows.map((x) => [x.day, x.recipe_id, x.text]), [[T(), null, 'דגים'], [D(1), 11, null]]);
    assert.equal(sql('SELECT COUNT(*) AS n FROM meal_plan_items WHERE plan_id = ?', rows[1].id)[0].n, 3);
  });
  await check('C2', 'כמה מנות של אותו אדם: "איזו מנה של מיכל?" עם כפתור לכל אחת, בלי כרטיס; אף אחת: מנה בלי מתכון', async () => {
    prep();
    answers.push({ reply: 'סגור!', face: 'happy', actions: [{ kind: 'plan', date: D(1), text: 'המנה של מיכל' }] });
    const r = await say(avi, 'מחר המנה של מיכל');
    assert.equal(r.proposal ?? null, null);
    assert.equal(r.reply, 'איזו מנה של מיכל?');
    assert.deepEqual([...r.options].sort(), ['עוגת גזר', 'פשטידת התרד של דנה']);
    answers.push({ reply: 'סגור!', face: 'happy', actions: [{ kind: 'plan', date: D(1), text: 'המנה של אושרי' }] });
    const r2 = await say(avi, 'מחר המנה של אושרי');
    assert.deepEqual(lines(r2), ['לתכנן המנה של אושרי למחר?']);
  });
  await check('C3', 'הורדה בצ\'אט: "להוריד את X מהתכנון של מחר", ובאותו כרטיס מה שנכנס לרשימה רק בשבילה', async () => {
    prep();
    const q = (await plan(avi, { op: 'add', day: D(1), recipe_id: 11 })).data.id;
    await plan(avi, { op: 'list' });
    answers.push({ reply: 'בסדר.', face: 'happy', actions: [{ kind: 'plan', date: D(1), name: 'פשטידת התרד של דנה', off: true }] });
    const r = await say(avi, 'מחר כבר לא נכין את הפשטידה');
    const l = lines(r);
    assert.equal(l[0], 'להוריד את פשטידת התרד של דנה מהתכנון של מחר?');
    assert.equal(l.filter((x) => /^להוריד .* מהרשימה\?$/.test(x)).length, 3, JSON.stringify(l)); // milk, spinach, cheese (4 eggs are enough)
    await apply(avi, r);
    assert.equal(sql('SELECT COUNT(*) AS n FROM meal_plan WHERE id = ?', q)[0].n, 0);
    assert.equal(sql('SELECT COUNT(*) AS n FROM list_items')[0].n, 0);
  });
  await check('C4', 'ילד: בקשה לתכנון הולכת למבוגרים כהצעה; המבוגר מאשר והמנה נכנסת בשם הילד', async () => {
    prep();
    answers.push({ reply: 'יאמי!', face: 'happy', actions: [{ kind: 'plan', date: D(2), text: 'פיצה' }] });
    const r = await say(yoavi, 'אני רוצה פיצה ביום ' + ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'][new Date(`${D(2)}T12:00:00Z`).getUTCDay()]);
    assert.equal(r.proposal ?? null, null);
    assert.equal(r.reply, 'ביקשתי מאבי או ממיכל לאשר את התכנון.'); // round 3: by their names
    assert.equal(sql('SELECT COUNT(*) AS n FROM meal_plan')[0].n, 0);
    const card = sql("SELECT id, user_id, actions FROM proposals WHERE status = 'pending'").find((p) => JSON.parse(p.actions).forAdults);
    assert.ok(card, 'no card for the grown-ups');
    const bubble = sql("SELECT content FROM chat WHERE role = 'shuki' ORDER BY id DESC").map((x) => JSON.parse(x.content)).find((c) => c.proposal?.id === card.id);
    assert.match(bubble.reply, /^יואבי ביקש לתכנן פיצה ליום \S+\. האם לאשר\?$/);
    assert.equal((await call(yoavi, 'POST', `/api/proposals/${card.id}/apply`, {})).data.ok, false);
    assert.equal((await call(avi, 'POST', `/api/proposals/${card.id}/apply`, {})).status, 200);
    assert.deepEqual(sql('SELECT day, text, added_by FROM meal_plan').map((x) => [x.day, x.text, x.added_by]), [[D(2), 'פיצה', 3]]);
  });
  await check('C5', 'תור סודי ("בינינו"): לא נכתב תכנון', async () => {
    prep();
    answers.push({ reply: 'סגור.', face: 'happy', actions: [{ kind: 'plan', date: T(), text: 'עוגה' }] });
    const r = await say(michal, 'בינינו, היום אני מכינה עוגה');
    if (r.proposal) await apply(michal, r);
    assert.equal(sql('SELECT COUNT(*) AS n FROM meal_plan')[0].n, 0, JSON.stringify(r).slice(0, 300));
  });
  await check('C6', 'ההוראות: שורת "התכנון לשבוע" בחלק של הבית, ו-plan בכלי', async () => {
    prep(); await plan(avi, { op: 'add', day: T(), recipe_id: 10 }); await plan(avi, { op: 'add', day: D(1), text: 'דגים' });
    answers.push({ reply: 'מחר דגים.', face: 'happy' });
    await say(avi, 'מה אוכלים מחר?');
    const sys = lastSystem();
    assert.ok(sys.includes(`התכנון לשבוע (date: מנות): ${T()} (`), sys.slice(0, 200));
    assert.ok(sys.includes(`${D(1)} (`) && sys.includes('דגים (בלי מתכון)'));
    assert.ok(sys.includes(`${T()} (`) && new RegExp(`${T()} \\([^)]*, היום\\)`).test(sys) && new RegExp(`${D(1)} \\([^)]*, מחר\\)`).test(sys), 'היום / מחר by the date (round 2, ה)');
    assert.ok(reqs.at(-1).tools[0].input_schema.properties.actions.items.properties.kind.enum.includes('plan'));
    assert.match(sys, /15\. תכנון \("היום דגים, מחר המנה של אושרי"/);
  });
  /* ---------- round 2 (the owner 19/10) ---------- */
  const WDN = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  await check('C7', 'תיקון 2 (ז): המודל שאל בעצמו "איזו מהמנות של מיכל?" בלי plan: השרת שואל "איזו מנה של מיכל?" עם השמות המלאים, והכפתור נותן כרטיס למחר בלי מודל', async () => {
    prep();
    answers.push({ reply: 'איזו מהמנות של מיכל? יש עוגה ופשטידה.', face: 'happy', options: ['עוגה', 'פשטידה'] });
    const r = await say(avi, 'מחר נכין את המנה של מיכל');
    assert.equal(r.reply, 'איזו מנה של מיכל?'); assert.deepEqual([...r.options].sort(), ['עוגת גזר', 'פשטידת התרד של דנה']);
    assert.equal(r.proposal ?? null, null);
    const n = calls; const r2 = await say(avi, 'עוגת גזר');
    assert.equal(calls, n, 'the model was asked');
    assert.deepEqual(lines(r2), ['לתכנן את עוגת הגזר למחר?', 'להוסיף גזר לרשימה?'], JSON.stringify(r2).slice(0, 300));
    await apply(avi, r2);
    assert.deepEqual(sql('SELECT day, recipe_id FROM meal_plan').map((x) => [x.day, x.recipe_id]), [[D(1), 12]]);
  });
  await check('C8', 'תיקון 5 (ג): שתי מנות בלי יום: שאלה לכל מנה, כפתורים מ"היום" ו"מחר", והכרטיס אחרי התשובה האחרונה', async () => {
    prep();
    answers.push({ reply: 'יאללה!', face: 'happy', actions: [{ kind: 'plan', name: 'שקשוקה' }, { kind: 'plan', text: 'פסטה' }] });
    const r = await say(avi, 'השבוע נכין שקשוקה ופסטה');
    assert.equal(r.reply, 'באיזה יום נכין את השקשוקה?'); assert.equal(r.proposal ?? null, null);
    assert.deepEqual(r.options, ['היום', 'מחר', ...[2, 3, 4, 5, 6].map((k) => WDN[new Date(`${D(k)}T12:00:00Z`).getUTCDay()])]);
    const n = calls;
    const r2 = await say(avi, 'מחר');
    assert.equal(r2.reply, 'באיזה יום נכין פסטה?');
    const r3 = await say(avi, 'היום');
    assert.equal(calls, n, 'the model was asked');
    assert.deepEqual(lines(r3).filter((l) => /^לתכנן/.test(l)), ['לתכנן את השקשוקה למחר?', 'לתכנן פסטה להיום?'], JSON.stringify(r3).slice(0, 300));
  });
  await check('C9', 'תיקון 3 (ו): ילד, "ביום X" כש-X היום: התאריך של היום גם כשהמודל אמר אחר; "אני שם את זה בתכנון" בלי plan לא נשאר', async () => {
    prep();
    answers.push({ reply: 'יאמי!', face: 'happy', actions: [{ kind: 'plan', date: D(7 - 0 > 13 ? 1 : 7), text: 'פיצה' }] });
    await say(yoavi, `אני רוצה פיצה ביום ${WDN[new Date(`${T()}T12:00:00Z`).getUTCDay()]}`);
    const card = sql("SELECT actions FROM proposals WHERE status = 'pending'").map((p) => JSON.parse(p.actions)).find((x) => x.forAdults);
    assert.ok(card, 'no card for the grown-ups');
    assert.equal(card.actions.find((a) => a.kind === 'plan').date, T());
    prep(); const n = calls;
    answers.push({ reply: 'אין לי מתכון לפיצה, אז אני רק שם את זה בתכנון. האם זה ליום שלישי?', face: 'happy' });
    answers.push({ reply: 'אני שם את זה בתכנון של יום שלישי.', face: 'happy' });
    const r = await say(yoavi, 'אני רוצה פיצה');
    assert.equal(calls - n, 2, 'not asked again');
    assert.equal(r.reply, 'אופס, לא הצלחתי. אפשר לנסות שוב?');
  });
  await check('C10', 'תיקון 4 (ב): ליד כרטיס תכנון ה-reply לא מפרט מה חסר', async () => {
    prep();
    answers.push({ reply: 'לפשטידה חסרים תרד וגבינה בולגרית. האם ככה?', face: 'happy', actions: [{ kind: 'plan', date: D(1), name: 'פשטידת התרד של דנה' }] });
    const r = await say(avi, 'מחר נכין את פשטידת התרד של דנה');
    assert.ok(r.proposal);
    assert.equal(r.reply, 'האם ככה?');
    answers.push({ reply: 'איזה כיף! תרד זה בריא. האם ככה?', face: 'happy', actions: [{ kind: 'plan', date: D(2), name: 'שקשוקה' }] });
    assert.equal((await say(avi, 'מחרתיים שקשוקה')).reply, 'איזה כיף! תרד זה בריא. האם ככה?', 'no list line: the reply stays');
  });
  await check('C11', 'תיקון 6: בהוראות, לא מזכירים אוכל שהאדם לא אוכל, גם לא בשלילה', async () => {
    answers.push({ reply: 'בסדר', face: 'happy' }); await say(avi, 'מה נשמע?');
    // round 2: after the exception (an explicit ask: s8-05-fish), and without the example the model copied
    const sys = lastSystem();
    assert.match(sys, /בלי idea\. כשהוא לא ביקש את המאכל הזה: אל תזכיר אותו, גם לא כדי לומר שאין\./);
    assert.ok(!sys.includes('אין לי בשבילך דג'), 'the example is back');
  });
  /* ---------- round 3 (the owner 19/10) ---------- */
  await check('C12', 'תיקון 1 (סבב 3): קללה ב-reply: קריאה שנייה עם הערה; גם בה קללה: המשפט הקבוע; בלי קללה בשנייה: היא; ובהוראות "שוקי לא מקלל"', async () => {
    prep(); let n = calls;
    answers.push({ reply: 'קורה לכולם, אל תזיין את עצמך על זה.', face: 'happy' }, { reply: 'קורה לכולם, אל תהיה קשה עם עצמך.', face: 'happy' });
    let r = await say(avi, 'אכלתי פיצה שלמה לבד');
    assert.equal(calls - n, 2); assert.equal(r.reply, 'קורה לכולם, אל תהיה קשה עם עצמך.');
    assert.match(JSON.stringify(reqs.at(-1).messages.at(-1)), /מילה גסה \(תזיין\)/);
    assert.match(lastSystem(), /שוקי לא מקלל ולא משתמש במילים גסות, גם כשמי שכותב מקלל\./);
    n = calls; answers.push({ reply: 'אל תזיין את עצמך.', face: 'happy' }, { reply: 'יאללה, לעזאזל עם זה.', face: 'happy' });
    r = await say(avi, 'אכלתי עוד פיצה');
    assert.equal(calls - n, 2); assert.equal(r.reply, 'סליחה, יצא לי משהו לא יפה. האם תוכל לכתוב לי שוב?'); // to Avi
    assert.match(log, /curse blocked 1 /);
    // 129 (the owner 19/10): only the sentence with it goes
    n = calls; answers.push({ reply: 'קורה לכולם. אל תזיין את עצמך על זה. יש פיתות במקפיא.', face: 'happy' }, { reply: 'לעזאזל. קורה לכולם. יש פיתות במקפיא.', face: 'happy' });
    r = await say(avi, 'אכלתי פיצה שלישית');
    assert.equal(r.reply, 'קורה לכולם. יש פיתות במקפיא.');
    n = calls; answers.push({ reply: 'כוס קפה וכוסברה? בטח.', face: 'happy' });
    r = await say(avi, 'מה עם כוס קפה?');
    assert.equal(calls - n, 1, 'a cup is not a curse'); assert.equal(r.reply, 'כוס קפה וכוסברה? בטח.');
  });
  await check('C13', 'תיקון 2 (סבב 3): "מיכל צמחונית ואוכלת דגים" למיכל: קריאה שנייה; גם בה השם: המשפט יורד; ובהוראות: בגוף שני, ומה שכתוב בעובדות בלבד', async () => {
    prep(); const rec = 'מיכל צמחונית ואוכלת דגים, אז אני אבדוק לפי זה: יש חומוס במקרר ופיתות במקפיא, אפשר להכין ארוחה קלה עם זה. יש גם קוטג\' ויוגורט. מה מתחשק?';
    let n = calls; answers.push({ reply: rec, face: 'happy' }, { reply: 'יש חומוס במקרר. מה מתחשק?', face: 'happy' });
    let r = await say(michal, 'לפי מה שיש בבית');
    assert.equal(calls - n, 2); assert.equal(r.reply, 'יש חומוס במקרר. מה מתחשק?');
    assert.match(JSON.stringify(reqs.at(-1).messages.at(-1)), /כתבת את השם מיכל/);
    const sys = lastSystem();
    assert.match(sys, /אף פעם לא בשמו ולא עליו בגוף שלישי/); assert.match(sys, /נאמר רק כמו שכתוב עליו בעובדות, בלי להוסיף/);
    n = calls; answers.push({ reply: rec, face: 'happy' }, { reply: rec, face: 'happy' });
    r = await say(michal, 'לפי מה שיש בבית');
    assert.equal(r.reply, 'יש גם קוטג\' ויוגורט. מה מתחשק?');
    n = calls; answers.push({ reply: 'מיכל אמרה שהיא רוצה פסטה. האם להוסיף לרשימה?', face: 'happy' });
    r = await say(avi, 'מה מיכל רצתה?');
    assert.equal(calls - n, 1, "another's name is fine");
  });
  await check('C14', 'pita (19/10): למי שיש לה הפרעת אכילה: "מה המטרה שלך" עובר לקריאה שנייה; גם בה: המשפט יורד; ובהוראות', async () => {
    prep(); sql("DELETE FROM facts"); sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 2, 'health', 'בלי קלוריות ומשקל', 1, 2, 2, 1, 'chat', 1, 1)");
    const rec = 'אני לא אתן לך מספרים של קלוריות, כמו שביקשת. אם בא לך, תגידי לי מה המטרה שלך ואציע מנות שמתאימות.';
    let n = calls; answers.push({ reply: rec, face: 'happy' }, { reply: 'אני לא אתן לך מספרים של קלוריות, כמו שביקשת. אשמח להכין איתך משהו טעים.', face: 'happy' });
    let r = await say(michal, 'כמה קלוריות יש בפיתה?');
    assert.equal(calls - n, 2); assert.equal(r.reply, 'אני לא אתן לך מספרים של קלוריות, כמו שביקשת. אשמח להכין איתך משהו טעים.');
    assert.match(lastSystem(), /למי שכתוב עליו בעובדות "בלי קלוריות ומשקל": אל תשאל ואל תציע שום דבר על מטרה, יעד, משקל, קלוריות, ירידה במשקל או תוכנית אכילה\./);
    assert.match(lastSystem(), /סירוב למספרים ניטרלי, בלי "אצלך" ובלי לרמוז שיש עליו כלל מיוחד/); // the pita/ed round (א)
    answers.push({ reply: rec, face: 'happy' }, { reply: rec, face: 'happy' });
    r = await say(michal, 'כמה קלוריות יש בפיתה?');
    assert.equal(r.reply, 'אני לא אתן לך מספרים של קלוריות, כמו שביקשת.');
    n = calls; answers.push({ reply: rec, face: 'happy' });
    await say(avi, 'כמה קלוריות יש בפיתה?');
    assert.equal(calls - n, 1, 'Avi has no such fact');
    sql("DELETE FROM facts");
  });
  await check('C15', 'ב (19/10, בטיחות): הפרעת אכילה: "האם תרצי שאשתף שזה קורה לך?" עובר לקריאה שנייה; גם בה: המשפט יורד, ו"זה נשאר בינינו" רק אחרי; ובהוראות', async () => {
    prep(); sql("DELETE FROM facts"); sql("DELETE FROM settings WHERE key LIKE 'eating:%'");
    const bad = { reply: 'אני איתך, וחשוב לי שתדעי שזה לא משהו שכדאי להתמודד איתו לבד. האם תרצי שאשתף שזה קורה לך?', face: 'sad', eating: true, personal: true };
    let n = calls; answers.push(bad, { reply: 'אני איתך. כדאי לדבר על זה עם איש מקצוע או עם מישהו קרוב.', face: 'sad', eating: true, personal: true });
    let r = await say(michal, 'אני מקיאה אחרי שאני אוכלת');
    assert.equal(calls - n, 2);
    assert.ok(!/אשתף/.test(r.reply), r.reply); assert.match(r.reply, /^אני איתך\. כדאי לדבר על זה עם איש מקצוע או עם מישהו קרוב\. זה נשאר בינינו\./);
    assert.match(lastSystem(), /אף פעם אל תציע לשתף, לספר או להעביר את זה לאחרים/);
    sql("DELETE FROM settings WHERE key LIKE 'eating:%'"); sql("DELETE FROM settings WHERE key LIKE 'ask%'");
    answers.push(bad, bad);
    r = await say(michal, 'אני מקיאה אחרי שאני אוכלת');
    assert.ok(!/אשתף/.test(r.reply), r.reply); assert.match(r.reply, /^אני איתך, וחשוב לי שתדעי שזה לא משהו שכדאי להתמודד איתו לבד\. זה נשאר בינינו\./);
  });
} catch (e) { console.log('setup failed:', e.message, log.slice(-800)); } finally {
  srv.kill(); mock.close();
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} home20 checks passed`);
  process.exit(ok === results.length && results.length ? 0 : 1);
}
