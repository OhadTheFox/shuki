// Stage 11: importing recipes. i1, an ingredient with no product finds one added later (S11-01–04, S11-14, S11-15), and the
// import tool, tools/import-recipes.mjs, against a real local server with the invented test/import-recipes.fixture.json
// (S11-06–13, S11-18). No model: no key at all. Run: node test/import-recipes.itest.js
import './fetch-retry.js';
import { spawn, execSync, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const STATE = '/tmp/shuki-test/shuki-import';
const PORT = 8751;
const d1 = (sql) => JSON.parse(execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --json --command "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))[0].results;
rmSync(STATE, { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply shuki --local --persist-to ${STATE}`, { stdio: 'ignore' });
const env = { ...process.env }; delete env.ANTHROPIC_API_KEY; delete env.OPENAI_API_KEY;
let dev;
const start = () => { dev = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(PORT), '--persist-to', STATE], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true }); };
const stop = () => { try { process.kill(-dev.pid, 'SIGKILL'); } catch { /* gone */ } try { execSync(`pkill -f "workerd.*${PORT}"`, { stdio: 'ignore' }); } catch { /* none */ } };
const base = `http://127.0.0.1:${PORT}`;
const up = async () => { for (let i = 0; i < 80; i++) { try { await fetch(base); return; } catch { await new Promise((r) => setTimeout(r, 500)); } } };
const call = async (t, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, data: await r.json().catch(() => ({})) }; };
const state = async (t) => (await call(t, 'GET', '/api/state')).data;
const act = (t, actions) => call(t, 'POST', '/api/actions', { actions, op_id: `op-${Math.random()}` });
const results = [];
async function check(id, name, fn) {
  try { const note = await fn(); results.push({ id, name, ok: true }); console.log('✓', id, name, note ? `— ${note}` : ''); }
  catch (e) { results.push({ id, name, ok: false }); console.log('✗', id, name, '\n   ', e.message.slice(0, 500)); }
}
const ing = (s, recipe, name) => s.recipes.find((r) => r.name === recipe).ings.find((i) => i.name === name);
const pid = (s, name) => s.products.find((p) => p.name === name)?.id;

// the tool: a child process, so what it prints is what it prints in a terminal
const TOOL = 'tools/import-recipes.mjs';
const DIR = '/tmp/shuki-test/shuki-import-files';
const FIX = `${DIR}/recipes.json`;
const tool = (args, extra = {}) => {
  try { return { rc: 0, out: execFileSync('node', [TOOL, ...args], { env: { ...env, SHUKI_DELAY_MS: '0', ...extra }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { rc: e.status, out: `${e.stdout || ''}${e.stderr || ''}` }; }
};

let avi, orit;
try {
  start(); await up();
  await fetch(`${base}/api/setup`); await new Promise((r) => setTimeout(r, 500));
  const code = d1("SELECT value FROM settings WHERE key = 'setup_code'")[0].value;
  avi = (await call(null, 'POST', '/api/setup', { code })).data.token;
  orit = (await call(null, 'POST', '/api/pair', { code: (await call(avi, 'POST', '/api/members', { add: { name: 'אורית', gender: 'f' } })).data.code })).data.token;
  await state(avi); // the first look sets the mark: an empty house, nothing before it

  await check('S11-01', 'בית ריק: מתכון עם ביצים, בצל ומלח. נוספו ביצים למלאי, וב-state הבא הביצים מקושרות והבצל לא', async () => {
    assert.equal((await call(avi, 'POST', '/api/recipes', { name: 'חביתה עם בצל', ings: [{ qty: 2, unit: null, name: 'ביצים' }, { qty: 1, unit: null, name: 'בצל' }, { qty: null, unit: null, name: 'מלח' }] })).status, 200);
    let s = await state(avi);
    assert.equal(ing(s, 'חביתה עם בצל', 'ביצים').product_id, null);
    await act(avi, [{ kind: 'create', product: { name: 'ביצים', count_type: 'pack', pack_size: 12, qty: 6 } }]);
    s = await state(avi);
    assert.equal(ing(s, 'חביתה עם בצל', 'ביצים').product_id, pid(s, 'ביצים'));
    assert.equal(ing(s, 'חביתה עם בצל', 'בצל').product_id, null);
  });

  await check('S11-02', 'מוצר "בצל סגול" נוסף ונמחק לפני ה-state הבא: הוא לא נקשר', async () => {
    await act(avi, [{ kind: 'create', product: { name: 'בצל סגול', count_type: 'level', level: 'plenty' } }]);
    const id = d1("SELECT id FROM products WHERE name = 'בצל סגול'")[0].id;
    await act(avi, [{ kind: 'delete', product_id: id }]);
    const s = await state(avi);
    assert.equal(ing(s, 'חביתה עם בצל', 'בצל').product_id, null);
  });

  await check('S11-14', 'מוצר מקושר נמחק, ונוסף אחר באותו שם: המצרך עובר לחדש', async () => {
    const old = d1("SELECT id FROM products WHERE name = 'ביצים' AND deleted IS NULL")[0].id;
    await act(avi, [{ kind: 'delete', product_id: old }]);
    await act(avi, [{ kind: 'create', product: { name: 'ביצים', count_type: 'pack', pack_size: 12, qty: 12 } }]);
    const s = await state(avi);
    const now = pid(s, 'ביצים');
    assert.notEqual(now, old);
    assert.equal(ing(s, 'חביתה עם בצל', 'ביצים').product_id, now);
  });

  await check('S11-03', 'אחרי "להתחיל מהתחלה" המצרך ברשימה של relink. מוצר חדש שמתאים לו מקשר אותו, והוא יוצא מהרשימה', async () => {
    await call(avi, 'POST', '/api/recipes', { name: 'סלט עגבניות', ings: [{ qty: 3, unit: null, name: 'עגבניות' }, { qty: 1, unit: null, name: 'מלפפון' }] });
    await act(avi, [{ kind: 'create', product: { name: 'עגבניות', count_type: 'level', level: 'plenty' } }, { kind: 'create', product: { name: 'מלפפון', count_type: 'level', level: 'plenty' } }]);
    let s = await state(avi);
    const tom = ing(s, 'סלט עגבניות', 'עגבניות'), cuc = ing(s, 'סלט עגבניות', 'מלפפון');
    assert.ok(tom.product_id && cuc.product_id);
    // what wipe() does (worker/restart.js): the names are kept in "relink", the links go, and so do the products
    d1(`INSERT OR REPLACE INTO settings (key, value) VALUES ('relink', '${JSON.stringify([{ id: tom.id, name: 'עגבניות' }, { id: cuc.id, name: 'מלפפון' }])}')`);
    d1(`UPDATE recipe_ingredients SET product_id = NULL WHERE id IN (${tom.id}, ${cuc.id})`);
    d1(`DELETE FROM products WHERE id IN (${tom.product_id}, ${cuc.product_id})`);
    await act(avi, [{ kind: 'create', product: { name: 'עגבניות שרי', count_type: 'level', level: 'plenty' } }]);
    s = await state(avi);
    assert.equal(ing(s, 'סלט עגבניות', 'עגבניות').product_id, pid(s, 'עגבניות שרי'));
    assert.deepEqual(JSON.parse(d1("SELECT value FROM settings WHERE key = 'relink'")[0].value), [{ id: cuc.id, name: 'מלפפון' }]);
  });

  await check('S11-04', 'מצרך שקושר ביד למוצר א\'. נוסף מוצר ב\' שמתאים בשם, והקישור נשאר א\'', async () => {
    await act(avi, [{ kind: 'create', product: { name: 'אורז', count_type: 'units', unit: 'שקית', qty: 1 } }]);
    let s = await state(avi);
    const rice = pid(s, 'אורז');
    await call(avi, 'POST', '/api/recipes', { name: 'אורז לבן', ings: [{ qty: 1, unit: 'כוס', name: 'אורז בסמטי', product_id: rice }] });
    await act(avi, [{ kind: 'create', product: { name: 'אורז בסמטי', count_type: 'units', unit: 'שקית', qty: 1 } }]);
    s = await state(avi);
    assert.equal(ing(s, 'אורז לבן', 'אורז בסמטי').product_id, rice);
  });

  await check('S11-15', 'מוצר פרטי של אורית בשם "שמנת": המצרך לא מתקשר אליו, לא ב-state שלה ולא בשלי', async () => {
    await call(avi, 'POST', '/api/recipes', { name: 'רוטב שמנת', ings: [{ qty: 1, unit: 'גביע', name: 'שמנת' }] });
    const noaId = d1("SELECT id FROM users WHERE name = 'אורית'")[0].id;
    d1(`INSERT INTO products (id, name, count_type, qty, created, updated, private_to) VALUES (777001, 'שמנת', 'units', 1, ${Date.now()}, ${Date.now()}, ${noaId})`);
    await state(orit); await state(avi);
    assert.equal(d1("SELECT i.product_id FROM recipe_ingredients i JOIN recipes r ON r.id = i.recipe_id WHERE r.name = 'רוטב שמנת'")[0].product_id, null);
  });

  /* ---- the tool (i2, i3) ---- */
  rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
  copyFileSync('test/import-recipes.fixture.json', FIX);
  const PROG = `${FIX}.progress-127.0.0.1-${PORT}.json`;
  const URL_ = { SHUKI_URL: base, SHUKI_TOKEN: avi };
  const FIXNAMES = JSON.parse(readFileSync(FIX, 'utf8')).map((x) => x.name.trim()).filter(Boolean);
  const inHouse = () => d1('SELECT id, name, url FROM recipes').filter((r) => FIXNAMES.some((n) => n.slice(0, 80) === r.name));
  const wipeFix = async () => { for (const r of inHouse()) await call(avi, 'POST', `/api/recipes/${r.id}/delete`, {}); };
  const num = (out, label) => Number(new RegExp(`${label}: (\\d+)`).exec(out)?.[1]);
  const outs = [];
  const run = (a, extra) => { const r = tool(a, { ...URL_, ...extra }); outs.push(r.out); return r; };

  await check('S11-06', 'ייבוא של הקובץ המומצא: 6 נכנסו, 2 כפולים בקובץ, 2 נדחו. השרת חותך כמו תמיד', async () => {
    const r = run([FIX, '--fresh']);
    assert.equal(r.rc, 0, r.out);
    assert.deepEqual([num(r.out, 'נכנסו'), num(r.out, 'כפולים בקובץ'), num(r.out, 'כבר בבית'), num(r.out, 'נדחו'), num(r.out, 'שגיאות רשת')], [6, 2, 0, 2, 0], r.out);
    const rows = inHouse();
    assert.equal(rows.length, 6);
    assert.ok(rows.some((x) => x.name.length === 80), 'the long name, cut to 80 by the server');
    assert.equal(rows.find((x) => x.name === 'פיתות בטאבון').url, null);
    assert.equal(d1("SELECT i.qty FROM recipe_ingredients i JOIN recipes r ON r.id = i.recipe_id WHERE r.name = 'עוגיות טחינה' AND i.name = 'קמח'")[0].qty, null);
    assert.ok(!r.out.includes('ייחתך'));
  });

  await check('S11-07', 'ריצה שנייה עם --fresh: 0 נכנסו, 8 חוזרים כפולים, 2 נדחו. בלי --fresh: לא נשלח כלום', async () => {
    let r = run([FIX, '--fresh']);
    assert.equal(r.rc, 0, r.out);
    assert.equal(num(r.out, 'נכנסו'), 0, r.out);
    assert.equal(num(r.out, 'כבר בבית') + num(r.out, 'כפולים בקובץ'), 8, r.out);
    assert.equal(num(r.out, 'נדחו'), 2);
    r = run([FIX]);
    assert.deepEqual([num(r.out, 'נכנסו'), num(r.out, 'כבר בבית'), num(r.out, 'כפולים בקובץ'), num(r.out, 'נדחו')], [0, 0, 0, 0], r.out);
    assert.equal(inHouse().length, 6);
  });

  await check('S11-12', 'המתכונים נמחקו מהבית: קובץ ההתקדמות לא מתאים, הכלי עוצר. עם --fresh הוא ממשיך', async () => {
    await wipeFix();
    let r = run([FIX]);
    assert.equal(r.rc, 4, r.out);
    assert.match(r.out, /קובץ ההתקדמות לא מתאים לבית הזה \(מתכון #\d+ כבר לא שם\)\. אפשר להריץ עם --fresh\./);
    r = run([FIX, '--fresh']);
    assert.equal(num(r.out, 'נכנסו'), 6, r.out);
  });

  await check('S11-09', '--only: מספר, ושם יחיד; שם של שני מתכונים עוצר', async () => {
    await call(avi, 'POST', `/api/recipes/${inHouse().find((x) => x.name === 'חביתה').id}/delete`, {});
    let r = run([FIX, '--only=1', '--fresh']);
    assert.equal(num(r.out, 'נכנסו'), 1, r.out);
    r = run([FIX, '--only=1', '--fresh']);
    assert.equal(num(r.out, 'כבר בבית'), 1, r.out);
    r = run([FIX, '--only=רוטב עגבניות מהיר', '--fresh']);
    assert.deepEqual([num(r.out, 'נכנסו'), num(r.out, 'כבר בבית')], [0, 1], r.out);
    r = run([FIX, '--only=חביתה']);
    assert.equal(r.rc, 2);
    assert.match(r.out, /יש שני מתכונים בשם הזה: #1 ו-#2\. איזה מהם\? אפשר לכתוב --only=<מספר>\./);
    assert.equal(inHouse().length, 6);
  });

  await check('S11-08', 'נפילה באמצע (kill -9) והמשך: 6 מתכונים בבית, ואף שם פעמיים', async () => {
    await wipeFix();
    rmSync(PROG, { force: true }); // what is counted below is this run's file only
    const child = spawn('node', [TOOL, FIX, '--fresh', '--delay=300'], { env: { ...env, ...URL_ }, stdio: 'ignore' });
    const done = () => { try { return Object.values(JSON.parse(readFileSync(PROG, 'utf8'))).filter((v) => v !== 'sending').length; } catch { return 0; } };
    for (let i = 0; i < 200 && done() < 3; i++) await new Promise((r) => setTimeout(r, 50));
    child.kill('SIGKILL');
    await new Promise((r) => child.on('exit', r));
    const mid = inHouse().length;
    assert.ok(mid >= 1 && mid < 6, `after the kill: ${mid}`);
    const r = run([FIX]);
    assert.equal(r.rc, 0, r.out);
    assert.equal(inHouse().length, 6);
    assert.equal(d1('SELECT name, COUNT(*) AS n FROM recipes GROUP BY name HAVING COUNT(*) > 1').length, 0);
    return `${mid} before the kill`;
  });

  await check('S11-18', 'קובץ התקדמות עם "sending" על מתכון 2 (כפול של 1 בקובץ): בריצה החוזרת הוא כפול, ולא "נכנס"', async () => {
    await wipeFix();
    run([FIX, '--only=1', '--fresh']);
    const prog = JSON.parse(readFileSync(PROG, 'utf8'));
    prog[2] = 'sending';
    writeFileSync(PROG, JSON.stringify(prog));
    const r = run([FIX]);
    assert.deepEqual([num(r.out, 'נכנסו'), num(r.out, 'כפולים בקובץ'), num(r.out, 'נדחו')], [5, 2, 2], r.out);
    assert.equal(JSON.parse(readFileSync(PROG, 'utf8'))[2].dup, prog[1].id);
  });

  await check('S11-21', 'מתכון נכנס והתשובה אבדה (הכלי נהרג אחריה): בריצה החוזרת הוא "נכנס" ולא "כבר בבית"', async () => {
    await wipeFix();
    const start = Math.max(0, ...d1('SELECT id FROM recipes').map((x) => x.id));
    run([FIX, '--only=6', '--fresh']);
    const id = JSON.parse(readFileSync(PROG, 'utf8'))[6].id;
    writeFileSync(PROG, JSON.stringify({ _start: start, 6: 'sending' })); // as if killed before the answer came
    const r = run([FIX, '--only=6']);
    assert.deepEqual([num(r.out, 'נכנסו'), num(r.out, 'כבר בבית')], [1, 0], r.out);
    assert.equal(JSON.parse(readFileSync(PROG, 'utf8'))[6].id, id);
  });

  await check('S11-22', '--only של מתכון שכפול של שורה קודמת בקובץ: "כפול בקובץ", ולא "כבר בבית"', async () => {
    const r = run([FIX, '--only=2', '--dry-run']);
    assert.match(r.out, /#2 חביתה: כפול בקובץ, של #1/, r.out);
  });

  await check('S11-10', 'הטוקן לא מודפס ולא נכתב: לא בריצות הרגילות, לא אחרי 401 ולא אחרי שגיאת רשת', async () => {
    const BAD = 'tok-secret-0f9e8d7c6b5a';
    let r = tool([FIX, '--fresh'], { SHUKI_URL: base, SHUKI_TOKEN: BAD });
    assert.equal(r.rc, 3, r.out);
    assert.match(r.out, /הטוקן לא מחובר\. עצרתי\./);
    outs.push(r.out);
    r = tool([FIX, '--fresh'], { SHUKI_URL: 'http://127.0.0.1:8759', SHUKI_TOKEN: BAD, SHUKI_RETRY_MS: '10' });
    assert.equal(r.rc, 1, r.out);
    assert.match(r.out, /אין קליטה לשרת אחרי 4 ניסיונות\. עצרתי אחרי מתכון 0\. אפשר להריץ שוב, ואמשיך מאותו מקום\./);
    outs.push(r.out);
    for (const o of outs) { assert.ok(!o.includes(avi) && !o.includes(BAD), 'a token in the output'); }
    for (const f of [PROG, `${FIX}.progress-127.0.0.1-8759.json`]) if (existsSync(f)) { const t = readFileSync(f, 'utf8'); assert.ok(!t.includes(avi) && !t.includes(BAD)); }
  });

  await check('S11-11', 'טוקן של ילד: הכלי עוצר לפני כל מתכון. אין מתכון שמחכה לאישור', async () => {
    const kid = (await call(null, 'POST', '/api/pair', { code: (await call(avi, 'POST', '/api/members', { add: { name: 'יואב', gender: 'm', role: 'child' } })).data.code })).data.token;
    const r = tool([FIX, '--fresh'], { SHUKI_URL: base, SHUKI_TOKEN: kid });
    assert.equal(r.rc, 3, r.out);
    assert.match(r.out, /הטוקן של ילד: המתכונים יחכו לאישור, וההורים יקבלו התראה על כל אחד\. עצרתי\./);
    assert.equal(d1("SELECT COUNT(*) AS n FROM recipes WHERE status = 'suggested'")[0].n, 0);
  });

  await check('S11-13', '--pair: המכשיר "ייבוא מתכונים" נוסף ונמחק בסוף: גם אחרי ריצה רגילה, גם כשהכלי נעצר באמצע, וגם אחרי SIGTERM', async () => {
    const me = (await state(avi)).me.id;
    const devices = () => d1('SELECT COUNT(*) AS n FROM devices')[0].n;
    const code = async () => (await call(avi, 'POST', '/api/devices/code', { user_id: me })).data.code;
    const n0 = devices();
    let r = tool([FIX, '--only=1', '--fresh', `--pair=${await code()}`], { SHUKI_URL: base });
    assert.equal(r.rc, 0, r.out);
    assert.equal(devices(), n0, 'after a normal run');
    assert.equal(d1("SELECT COUNT(*) AS n FROM devices WHERE name = 'ייבוא מתכונים'")[0].n, 0);
    // stopped in the middle: a progress file of another house
    writeFileSync(PROG, JSON.stringify({ 1: { id: 999999999 } }));
    r = tool([FIX, `--pair=${await code()}`], { SHUKI_URL: base });
    assert.equal(r.rc, 4, r.out);
    assert.equal(devices(), n0, 'after a stop');
    // a signal while it runs
    await wipeFix();
    const child = spawn('node', [TOOL, FIX, '--fresh', '--delay=2000', `--pair=${await code()}`], { env: { ...env, SHUKI_URL: base }, stdio: 'ignore' });
    for (let i = 0; i < 200 && devices() === n0; i++) await new Promise((x) => setTimeout(x, 50));
    assert.equal(devices(), n0 + 1, 'paired');
    child.kill('SIGTERM');
    const rc = await new Promise((x) => child.on('exit', (c) => x(c)));
    assert.equal(rc, 143);
    assert.equal(devices(), n0, 'after SIGTERM');
  });
} finally { stop(); }
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} import checks passed`);
writeFileSync('test/import-recipes-results.json', JSON.stringify(results, null, 1));
process.exit(ok === results.length ? 0 : 1);
