// Stage 0b, part 1: distress (docs/stage0-0b-proposal.md §1; approved wording 02/10), on the Node server with a fake
// model. Each check fails on the code before 0b. Run: node --disable-warning=ExperimentalWarning test/distress.itest.js
import './fetch-retry.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, readdirSync, readFileSync, copyFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DIR = '/tmp/shuki-test/shuki-distress'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const PORT = 8774, MOCK = 8775, PORT2 = 8776;

// Avi (admin), Michal, Yoavi (a child)
const db = new DatabaseSync(`${DIR}/shuki.db`);
db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) { db.exec(readFileSync(`migrations/${f}`, 'utf8')); db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f); }
db.exec(readFileSync('test/fixture-house.sql', 'utf8'));
db.exec("INSERT INTO users (id, name, gender, role, active, created) VALUES (3, 'יואבי', 'm', 'child', 1, 0)");
db.exec("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999), ('222222', 2, 9999999999999), ('333333', 3, 9999999999999), ('914444', 1, 9999999999999)");
db.close();
copyFileSync(`${DIR}/shuki.db`, `${DIR}/nokey.db`); // the same house with no key, for the "no model" checks

let answer = () => ({ reply: 'אני פה!', face: 'happy' });
const requests = [];
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { const b = Buffer.concat(parts).toString('utf8'); // bytes first: a Hebrew letter can be split between chunks (question 29)

  const body = JSON.parse(b); requests.push(body);
  if (answer(body) === 'FAIL') { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":{"type":"api_error"}}'); return; }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'tool_use', name: body.tools?.[0]?.name || 'respond', input: answer(body) }], usage: { input_tokens: 1, output_tokens: 1 } }));
}); }).listen(MOCK, '127.0.0.1');
const start = (port, file, key) => spawn('node', ['--disable-warning=ExperimentalWarning', 'server/node.js'], { env: { ...process.env, PORT: String(port), DB_PATH: `${DIR}/${file}`, ANTHROPIC_API_KEY: key, ANTHROPIC_URL: `http://127.0.0.1:${MOCK}/v1/messages`, TEST_RESET: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
const srv = start(PORT, 'shuki.db', 't');
const srv2 = start(PORT2, 'nokey.db', '');
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
const caller = (port) => async (t, m, p, b) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const x = await r.text(); let data; try { data = JSON.parse(x); } catch { data = x; } return { status: r.status, data }; };
const call = caller(PORT), call2 = caller(PORT2);
const sql = (q, ...a) => { const d = new DatabaseSync(`${DIR}/shuki.db`); try { return /^\s*select/i.test(q) ? d.prepare(q).all(...a) : d.prepare(q).run(...a); } finally { d.close(); } };
const results = [];
async function check(id, name, fn) {
  try { await fn(); results.push({ id, ok: true }); console.log('✓', id, name); }
  catch (e) { results.push({ id, ok: false }); console.log('✗', id, name, '\n   ', e.message.slice(0, 500)); }
}

// the approved words (02/10), exactly
const D1 = 'אני כאן איתך. אפשר לדבר עכשיו עם ער"ן בטלפון 1201, בכל שעה. אם יש סכנה מיידית, להתקשר למד"א בטלפון 101. האם יש מישהו קרוב שיכול להיות איתך עכשיו?';
const D2 = 'אני כאן איתך. אני ממליץ להתקשר לקו החם לאלימות במשפחה, בטלפון 118. אם יש סכנה מיידית, להתקשר למשטרה בטלפון 100. לא אספר על זה לאף אחד בבית.';
const PARENTS = 'אבא ואמא לא יראו את מה שכתבת.';
const D3 = `אני כאן איתך. ${PARENTS} כדאי לספר למבוגר שאתה סומך עליו, כמו מורה או יועצת. אפשר גם לדבר עם ער"ן בטלפון 1201, בכל שעה. אם יש סכנה עכשיו, להתקשר למד"א בטלפון 101.`;
const D4 = `אני כאן איתך. ${PARENTS} אפשר להתקשר ל-118, שם עונים על אלימות במשפחה. אם יש סכנה עכשיו, להתקשר למשטרה, 100. כדאי לספר גם למבוגר שאתה סומך עליו מחוץ לבית, כמו מורה או יועצת.`;
const D5 = `אני כאן איתך. ${PARENTS} אפשר להתקשר ל-105, שם עוזרים לילדים שנפגעו ברשת, בכל שעה. כדאי לספר גם למבוגר שאתה סומך עליו.`;

const say = async (t, text, c = call) => (await c(t, 'POST', '/api/chat', { text })).data;
const seen = async (t, re) => re.test(JSON.stringify((await call(t, 'GET', '/api/chat')).data.messages || []));
let avi, michal, yoavi, aviNoKey;
try {
  for (const p of [PORT, PORT2]) for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${p}`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  [avi, michal, yoavi] = await Promise.all(['111111', '222222', '333333'].map(async (code) => (await call(null, 'POST', '/api/pair', { code })).data.token));
  aviNoKey = (await call2(null, 'POST', '/api/pair', { code: '914444' })).data.token;

  await check('X1', 'מבוגר, חד-משמעי: הנוסח הקבוע D1 בדיוק, בלי מודל, בלי כרטיס, בלי 👍/👎, הפרצוף "מבין" (שלב 10, t1)', async () => {
    const n = requests.length;
    const r = await say(avi, 'אני לא רוצה לחיות יותר');
    assert.equal(r.reply, D1); assert.equal(r.face, 'understanding'); assert.equal(r.proposal, undefined);
    assert.equal(requests.length, n, 'the model was asked');
    const row = sql("SELECT content FROM chat WHERE role = 'shuki' ORDER BY id DESC LIMIT 1")[0];
    assert.equal(JSON.parse(row.content).ai, undefined, 'no 👍/👎'); assert.equal(JSON.parse(row.content).face, 'understanding', 'the saved face');
  });
  await check('X2', 'מבוגרת, אלימות בבית: D2 בדיוק, "מבין"', async () => { const r = await say(michal, 'בעלי מרביץ לי'); assert.equal(r.reply, D2); assert.equal(r.face, 'understanding'); });
  await check('X3', 'ילד, חד-משמעי: D3 עם "אבא ואמא לא יראו את מה שכתבת.", "מבין"', async () => { const r = await say(yoavi, 'אני רוצה להתאבד'); assert.equal(r.reply, D3); assert.equal(r.face, 'understanding'); });
  await check('X4', 'ילד, "אבא מרביץ לי כשהוא כועס": D4, "מבין"', async () => { const r = await say(yoavi, 'אבא מרביץ לי כשהוא כועס'); assert.equal(r.reply, D4); assert.equal(r.face, 'understanding'); });

  await check('X5', 'חשד, והמודל אומר "ברשת": המילה החמה של המודל ואחריה D5; הפעולות של אותה תשובה יורדות', async () => {
    const list = sql('SELECT COUNT(*) AS n FROM list_items')[0].n;
    answer = () => ({ reply: 'אני ממש מצטער שזה קרה לך.', face: 'sad', distress: 'online', actions: [{ kind: 'list_add', text: 'במבה' }] });
    const r = await say(yoavi, 'מישהו מהכיתה ביקש ממני תמונות ומאיים לפרסם');
    assert.equal(r.reply, `אני ממש מצטער שזה קרה לך. ${D5}`); assert.equal(r.proposal, undefined); assert.equal(r.face, 'understanding');
    assert.equal(sql('SELECT COUNT(*) AS n FROM list_items')[0].n, list);
    assert.match(JSON.stringify(requests.at(-1).messages.at(-1)), /ייתכן שזו הודעת מצוקה/);
  });
  await check('X6', 'חשד, והמודל אומר "לא": תשובה רגילה, והכרטיס נשאר', async () => {
    answer = () => ({ reply: 'להוסיף את זה לרשימה?', face: 'happy', distress: 'none', actions: [{ kind: 'list_add', text: 'מגבונים' }] });
    const r = await say(avi, 'מיכל שלחה לי תמונה של המקרר, תוסיף מגבונים');
    assert.equal(r.reply, 'להוסיף את זה לרשימה?'); assert.ok(r.proposal, 'the card stays');
    assert.match(JSON.stringify(requests.at(-1).messages.at(-1)), /ייתכן שזו הודעת מצוקה/, 'the model was asked');
  });
  await check('X7', 'אזעקות שווא (#28–#30): בלי נוסח ובלי הערה למודל', async () => {
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('ask_once:recipe_tip:2', '1')"); // stage 8, ז5: the tip was given already
    answer = () => ({ reply: 'בתיאבון', face: 'happy' });
    for (const t of ['אני מת מרעב, מה יש לאכול?', 'הילדים הורגים אותי היום, תוסיף קפה', 'נגמר לי הכוח, תוסיף קפה', 'מתה על הפיצה הזאת']) {
      const r = await say(michal, t);
      assert.equal(r.reply, 'בתיאבון', t); assert.doesNotMatch(JSON.stringify(requests.at(-1).messages.at(-1)), /מצוקה/, t);
    }
    // the control: a real suspicion is passed to the model (so the above is the lists working, not nothing happening)
    answer = () => ({ reply: 'אוי, בושות.', face: 'happy', distress: 'none' });
    await say(michal, 'בא לי למות מבושה');
    assert.match(JSON.stringify(requests.at(-1).messages.at(-1)), /ייתכן שזו הודעת מצוקה/);
  });
  await check('X8', 'הודעת מצוקה רק אצל מי שכתב: לא בצ\'אט של אחרים (גם לא של ההורה), ולא בהיסטוריה שהמודל מקבל בשם אחר', async () => {
    assert.ok(await seen(yoavi, /להתאבד/), 'the writer sees it');
    assert.ok(!(await seen(avi, /להתאבד|בעלי מרביץ|אבא מרביץ/)), 'Avi (a parent) sees Yoavi\'s or Michal\'s');
    assert.ok(!(await seen(michal, /להתאבד|לא רוצה לחיות|אבא מרביץ/)), 'Michal (a parent) sees Avi\'s or Yoavi\'s');
    answer = () => ({ reply: 'אני פה!', face: 'happy' });
    await say(avi, 'מה נשמע?');
    assert.doesNotMatch(JSON.stringify(requests.at(-1).messages), /להתאבד|בעלי מרביץ|מרביץ לי|ביקש ממני תמונות/);
  });
  await check('X9', 'ילד, 24 השעות שאחרי: ההודעות שלו והתשובות מוסתרות מההורים', async () => {
    answer = () => ({ reply: 'אני פה איתך.', face: 'happy' });
    await say(yoavi, 'אני עדיין עצוב');
    assert.ok(await seen(yoavi, /עדיין עצוב/));
    assert.ok(!(await seen(avi, /עדיין עצוב/)) && !(await seen(michal, /עדיין עצוב/)), 'a parent sees it');
  });
  await check('X10', '👎 על תשובה של מצוקה: לא נשמר, ושום דבר לא מועתק ל-feedback', async () => {
    const id = sql("SELECT id FROM chat WHERE role = 'shuki' AND content LIKE '%\"sensitive\":true%' ORDER BY id LIMIT 1")[0].id;
    const r = await call(yoavi, 'POST', '/api/feedback', { chat_id: id, note: 'לא טוב' });
    assert.notEqual(r.status, 200, JSON.stringify(r.data));
    assert.equal(sql('SELECT COUNT(*) AS n FROM feedback')[0].n, 0);
  });
  await check('X11', 'אחרי שבוע: הודעות המצוקה נמחקות, והודעה רגילה מאותו יום נשארת', async () => {
    const old = Date.now() - 8 * 86400e3;
    sql("INSERT INTO chat (ts, user_id, role, content) VALUES (?, 1, 'user', ?)", old, JSON.stringify({ text: 'ישן ורגיש', only: 1, sensitive: true }));
    sql("INSERT INTO chat (ts, user_id, role, content) VALUES (?, 1, 'user', ?)", old, JSON.stringify({ text: 'ישן ורגיל' }));
    await call(avi, 'POST', '/api/__schedule', { now: Date.now() });
    assert.equal(sql("SELECT COUNT(*) AS n FROM chat WHERE content LIKE '%ישן ורגיש%'")[0].n, 0);
    assert.equal(sql("SELECT COUNT(*) AS n FROM chat WHERE content LIKE '%ישן ורגיל%'")[0].n, 1);
  });
  await check('X12', 'בלי מפתח: חד-משמעי מקבל את D1; חשד מקבל את התשובה הרגילה של "אין מפתח" (בלי נוסח)', async () => {
    assert.equal((await say(aviNoKey, 'אני לא רוצה לחיות יותר', call2)).reply, D1);
    assert.notEqual((await say(aviNoKey, 'בא לי למות', call2)).reply, D1);
  });
  await check('X13', 'תקציב שנגמר: חד-משמעי עדיין מקבל את D1 (r12 q049)', async () => {
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('cost_cap', '0')");
    assert.equal((await say(avi, 'אני רוצה להתאבד')).reply, D1);
    sql("DELETE FROM settings WHERE key = 'cost_cap'");
  });
  await check('X14', 'באמצע ההיכרות: מצוקה לא נבלעת בהיכרות', async () => {
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('onboard', ?)", JSON.stringify({ step: 'people', user: 1, started: Date.now() }));
    const r = await say(avi, 'אני לא רוצה לחיות יותר');
    assert.equal(r.reply, D1); assert.equal(r.onboard, undefined);
    sql("DELETE FROM settings WHERE key = 'onboard'");
  });
  await check('X15', 'אחרי 30 הודעות בדקה: חד-משמעי מקבל את D1; חשד נשאר בתוך המגבלה, בלי נוסח (כמו בהצעה)', async () => {
    const now = Date.now();
    for (let i = 0; i < 31; i++) sql("INSERT INTO chat (ts, user_id, role, content) VALUES (?, 2, 'user', ?)", now - 1000, JSON.stringify({ text: `הודעה ${i}` }));
    answer = () => ({ reply: 'זה נשמע קשה.', face: 'sad', distress: 'self' });
    const n = requests.length;
    assert.notEqual((await say(michal, 'בא לי למות')).reply, `זה נשמע קשה. ${D1}`);
    assert.equal(requests.length, n, 'a suspicion went past the per-minute limit');
    assert.equal((await say(michal, 'אני רוצה להתאבד')).reply, D1);
    sql("DELETE FROM chat WHERE user_id = 2 AND content LIKE '%הודעה %'");
  });

  await check('X16', 'צורות נוספות: "אמא היכתה אותי", "חתכתי את עצמי", "פגעתי בעצמי", "התאבדות", מילה בתוך מרכאות', async () => {
    assert.equal((await say(michal, 'אמא שלי היכתה אותי')).reply, D2);
    for (const t of ['חתכתי את עצמי אתמול', 'פגעתי בעצמי', 'אני חושב על התאבדות', 'כתבו לי "להתאבד" בקבוצה']) assert.equal((await say(avi, t)).reply, D1, t);
  });
  await check('X17', '"אחי מרביץ לי" ו"אבא מרביץ לאמא": חשד, לא נוסח בלי מודל', async () => {
    answer = () => ({ reply: 'אוי.', face: 'sad', distress: 'none' });
    for (const t of ['אחי הקטן מרביץ לי', 'אבא מרביץ לאמא']) {
      const n = requests.length; const r = await say(michal, t);
      assert.notEqual(r.reply, D2, t); assert.equal(requests.length, n + 1, `${t}: the model wasn't asked`);
      assert.match(JSON.stringify(requests.at(-1).messages.at(-1)), /ייתכן שזו הודעת מצוקה/, t);
    }
  });
  await check('X18', 'ילד בתוך 24 השעות: בקשה שלו להורים (כרטיס "ביקש… לאשר?") עדיין מגיעה להורים', async () => {
    answer = () => ({ reply: 'אבקש מאבא או מאמא.', face: 'happy', actions: [{ kind: 'list_add', text: 'במבה' }] });
    await say(yoavi, 'תוסיף במבה לרשימה');
    assert.ok(!(await seen(avi, /תוסיף במבה לרשימה/)), 'the parent sees the child\'s own message in the 24 hours');
    assert.ok(await seen(avi, /יואבי ביקש[\s\S]*במבה/), 'the parent does not get the request');
  });
  await check('X18ב', 'ילד בתוך 24 השעות, חשד שהמודל אומר עליו "לא מצוקה": עדיין מוסתר מההורים', async () => {
    answer = () => ({ reply: 'אני פה.', face: 'happy', distress: 'none' });
    await say(yoavi, 'אין טעם בכלום');
    assert.ok(await seen(yoavi, /אין טעם בכלום/));
    assert.ok(!(await seen(avi, /אין טעם בכלום/)) && !(await seen(michal, /אין טעם בכלום/)), 'a parent sees it');
  });
  await check('X19', 'הסימן של 24 השעות לא יוצא מהשרת: לא ב-state ולא בייצוא', async () => {
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'distress:3'")[0].n, 1, 'the mark exists');
    assert.doesNotMatch(JSON.stringify((await call(avi, 'GET', '/api/state')).data.settings), /distress/);
    assert.doesNotMatch(JSON.stringify((await call(avi, 'GET', '/api/export')).data.settings), /distress/);
  });
  await check('X20', 'הסבר אחרי 👎 שהוא הודעת מצוקה: לא נשמר ב-feedback', async () => {
    answer = () => ({ reply: 'יש ביצים.', face: 'happy' });
    await say(avi, 'יש ביצים?');
    const id = sql("SELECT id FROM chat WHERE role = 'shuki' AND content NOT LIKE '%\"sensitive\":true%' ORDER BY id DESC LIMIT 1")[0].id;
    await call(avi, 'POST', '/api/feedback', { chat_id: id, note: 'אני לא רוצה לחיות יותר' });
    assert.doesNotMatch(JSON.stringify(sql('SELECT note FROM feedback')), /לחיות/);
  });
  await check('X21', 'חשד והמודל נפל: בלי נוסח, וההודעה חוזרת להיות רגילה (לא נשארת מוסתרת)', async () => {
    answer = () => 'FAIL';
    const r = await say(avi, 'אין טעם בכלום');
    assert.notEqual(r.reply, D1);
    const row = sql("SELECT content FROM chat WHERE user_id = 1 AND content LIKE '%אין טעם בכלום%'")[0];
    assert.ok(row, 'saved'); const c = JSON.parse(row.content); assert.equal(c.sensitive, undefined); assert.equal(c.only, undefined);
  });
  await check('X22', 'דרך עוזר מחובר (MCP): חד-משמעי מקבל את D1', async () => {
    const conn = (await call(avi, 'POST', '/api/connectors', { name: 'Claude' })).data.path;
    const r = await call(null, 'POST', conn, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ask_shuki', arguments: { message: 'אני לא רוצה לחיות יותר' } } });
    assert.equal(r.data.result?.content?.[0]?.text, D1, JSON.stringify(r.data));
  });
  await check('X23', 'מבוגר שנפגע ברשת: D6, הנוסח המאושר (02/10), ולא D1', async () => {
    answer = () => ({ reply: 'זה נשמע מפחיד.', face: 'sad', distress: 'online' });
    const r = await say(michal, 'מישהו מאיים לפרסם תמונות שלי');
    assert.equal(r.reply, 'זה נשמע מפחיד. אני כאן איתך. אם מאיימים עליך, אפשר להתלונן במשטרה בטלפון 100. אם קשה לך, אפשר לדבר עם ער"ן בטלפון 1201, בכל שעה.');
  });
  await check('X25', 'ילד, מילה מרשימת החשד, והמודל לא אישר (אמר "לא" או נפל): מוסתר מההורים, עם 24 השעות שאחרי; בלי נוסח מצוקה (03/10, שאלה 40)', async () => {
    sql("DELETE FROM settings WHERE key = 'distress:3'");
    answer = () => ({ reply: 'אוי, אני פה.', face: 'sad', distress: 'none' });
    const r = await say(yoavi, 'אני רוצה להיעלם, כולם בכיתה צוחקים עליי');
    assert.ok(!/1201|105|118/.test(r.reply), `distress words without the model: ${r.reply}`);
    assert.ok(await seen(yoavi, /להיעלם/));
    assert.ok(!(await seen(avi, /להיעלם/)) && !(await seen(michal, /להיעלם/)), 'a parent sees it');
    assert.ok(sql("SELECT value FROM settings WHERE key = 'distress:3'").length, 'no 24-hour mark');
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await say(yoavi, 'ומה יש לארוחת ערב');
    assert.ok(!(await seen(avi, /ומה יש לארוחת ערב/)), 'the next message, inside the 24 hours, a parent sees it');
    sql("DELETE FROM settings WHERE key = 'distress:3'");
    answer = () => 'FAIL';
    await say(yoavi, 'בא לי להיעלם מפה');
    assert.ok(!(await seen(avi, /להיעלם מפה/)), 'the model fell: a parent sees it');
  });
  await check('X24', 'D3–D5 עם שני הורים מאותו מין, כמו D9 (02/10): "אבא ואבא לא יראו…" / "אמא ואמא לא יראו…"', async () => {
    sql("UPDATE users SET gender = 'm' WHERE id = 2");
    assert.match((await say(yoavi, 'אני רוצה להתאבד')).reply, /^אני כאן איתך\. אבא ואבא לא יראו את מה שכתבת\. /);
    sql("UPDATE users SET gender = 'f' WHERE id IN (1, 2)");
    assert.match((await say(yoavi, 'אני רוצה להתאבד')).reply, /^אני כאן איתך\. אמא ואמא לא יראו את מה שכתבת\. /);
    sql("UPDATE users SET gender = 'm' WHERE id = 1");
  });
  await check('X39', 'D3–D5 עם 3 מבוגרים ויותר: "ההורים לא יראו את מה שכתבת." (the owner 06/10, r7b)', async () => {
    sql("INSERT INTO users (id, name, gender, role, active, created) VALUES (9, 'דני', 'm', 'member', 1, 0)");
    try { assert.match((await say(yoavi, 'אני רוצה להתאבד')).reply, /^אני כאן איתך\. ההורים לא יראו את מה שכתבת\. /); }
    finally { sql('DELETE FROM users WHERE id = 9'); }
  });
  await check('X26', 'הרשימה החד-משמעית נשארת כמו שהיא, גם על משפט רגיל ("לא רוצה לחיות בלי שוקולד", "אבא מכה אותי בשחמט"): נכשלים לצד הבטוח (0ב שאלה 15, r0t b5)', async () => {
    const n = requests.length;
    const r = await say(avi, 'אני לא רוצה לחיות בלי שוקולד');
    assert.equal(r.reply, D1); assert.equal(r.proposal, undefined);
    const k = await say(yoavi, 'אבא מכה אותי בשחמט');
    assert.equal(k.reply, D4); assert.equal(k.proposal, undefined);
    assert.equal(requests.length, n, 'without the model');
  });
  await check('X27', 'פ4 (r7b): בהוראות למודל, בדידות, דיכאון (עם המשפט של D6 על ער"ן) וכעס על שוקי', async () => {
    answer = () => ({ reply: 'אני פה!', face: 'happy' });
    await say(avi, 'מה נשמע?');
    const t = requests.at(-1).system[0].text;
    assert.match(t, /"אני בודד"/); assert.match(t, /כועסים עליך/);
    const dep = t.split('\n').find((l) => /"אני בדיכאון"/.test(l)) || '';
    assert.ok(dep.includes('"זה לא התחום שלי"') && dep.includes('אם קשה לך, אפשר לדבר עם ער"ן בטלפון 1201, בכל שעה.'), dep);
  });

  // פ5: an eating disorder (the owner 06/10, r7b; decisions 1 and 2 of stage 7)
  const ED = 'בלי קלוריות ומשקל';
  const QF = 'האם תרצי שאזכור את זה ולא אדבר איתך על קלוריות ומשקל?', QM = "האם תרצה שאזכור את זה ולא אדבר איתך על קלוריות ומשקל?"; // "תרצי" and "תרצה" since r8z (question 31); "רוצה" was the same for both (the owner 07/10, r7c)
  const WARM = 'תודה שסיפרת לי, זה לא פשוט. כדאי לדבר על זה עם איש מקצוע.';
  const prompt = () => requests.at(-1).system.slice(1).map((b) => b.text).join('\n'); // after the instructions, which name the fact's words
  const edFacts = (id) => sql("SELECT * FROM facts WHERE about = 'person' AND about_id = ? AND key = 'health'", id);
  await check('X28', 'פ5: מיכל מספרת על הפרעת אכילה: התשובה נגמרת ב"זה נשאר בינינו." ובשאלה "האם תרצה שאזכור…?" (r7c, שאלה 103), עם [כן, תזכור] [לא צריך]; רק אצלה, ובלי עובדה עדיין', async () => {
    answer = () => ({ reply: WARM, face: 'sad', eating: true, personal: true });
    const r = await say(michal, 'אני מקיאה אחרי שאני אוכלת, כבר חודשים');
    assert.ok(r.reply.startsWith(WARM) && r.reply.endsWith(QF), r.reply);
    assert.ok(r.reply.endsWith(`זה נשאר בינינו. ${QF}`), `the owner 07/10 (question 103): "זה נשאר בינינו." before the question: ${r.reply}`);
    assert.deepEqual(r.options, ['כן, תזכור', 'לא צריך']); assert.equal(r.proposal, undefined);
    const row = JSON.parse(sql("SELECT content FROM chat WHERE content LIKE '%מקיאה אחרי%' ORDER BY id DESC LIMIT 1")[0].content);
    assert.equal(row.only, 2); assert.equal(row.sensitive, true);
    assert.ok(await seen(michal, /מקיאה אחרי/)); assert.ok(!(await seen(avi, /מקיאה אחרי|קלוריות ומשקל/)), 'Avi sees it');
    assert.equal(edFacts(2).length, 0, 'a fact before "yes"');
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'eating:2'")[0].n, 1);
  });
  await check('X29', 'פ5: "כן, תזכור": עובדה health פרטית, רק במצב ובפרומפט של מיכל, ולא בהורדה של אף אחד', async () => {
    const r = await say(michal, 'כן, תזכור');
    assert.equal(r.reply, 'בסדר, אזכור.');
    const f = edFacts(2); assert.equal(f.length, 1); assert.equal(f[0].value, ED); assert.equal(f[0].private, 1);
    assert.ok((await call(michal, 'GET', '/api/state')).data.facts.some((x) => x.key === 'health' && x.value === ED), 'not in her state');
    assert.ok(!(await call(avi, 'GET', '/api/state')).data.facts.some((x) => x.key === 'health'), 'in Avi\'s state');
    // r13l: her own download has her own chat and private facts (my_chat, my_facts); the house's tables and Avi's, nothing
    const { my_chat: _c, my_facts: mf, ...hers } = (await call(michal, 'GET', '/api/export')).data;
    assert.doesNotMatch(JSON.stringify(hers), /קלוריות ומשקל|eating:/); assert.ok(mf.some((x) => x.key === 'health' && x.value === ED), 'not in her own download');
    assert.doesNotMatch(JSON.stringify((await call(avi, 'GET', '/api/export')).data), /קלוריות ומשקל|eating:/);
    answer = () => ({ reply: 'יש פסטה.', face: 'happy' });
    await say(michal, 'מה יש לארוחת ערב?');
    assert.match(prompt(), /health: בלי קלוריות ומשקל/); assert.doesNotMatch(prompt(), /כבר הצעת לו איש מקצוע/);
    await say(avi, 'מה יש לארוחת ערב?');
    assert.doesNotMatch(prompt(), /קלוריות ומשקל/);
  });
  await check('X30', 'פ5: eating בפעם השנייה (עם העובדה): בלי שאלה', async () => {
    answer = () => ({ reply: WARM, face: 'sad', eating: true, personal: true });
    const r = await say(michal, 'שוב הקאתי אחרי ארוחת הערב');
    assert.ok(!/שאזכור את זה ולא אדבר/.test(r.reply), r.reply); assert.equal(r.options, undefined);
    assert.equal(edFacts(2).length, 1);
  });
  await check('X32', 'פ5: אבי (זכר) מקבל אותה שאלה, ולפניה "זה נשאר בינינו." (r7c, שאלה 103)', async () => {
    answer = () => ({ reply: WARM, face: 'sad', eating: true, personal: true });
    const r = await say(avi, 'אני לא אוכל בכוונה כבר שלושה ימים, אני מפחד לעלות במשקל');
    assert.ok(r.reply.endsWith(`זה נשאר בינינו. ${QM}`), r.reply);
  });
  await check('X31', 'פ5 (the owner 07/10): "לא צריך": בלי עובדה; eating:1 נשאר ולא ב-state; בפעם הבאה בלי שאלה, ובפרומפט אין שום שורה על קלוריות ומשקל', async () => {
    assert.equal((await say(avi, 'לא צריך')).reply, 'בסדר, לא אזכור.');
    assert.equal(edFacts(1).length, 0);
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'eating:1'")[0].n, 1);
    assert.doesNotMatch(JSON.stringify((await call(avi, 'GET', '/api/state')).data.settings), /eating/);
    answer = () => ({ reply: WARM, face: 'sad', eating: true, personal: true });
    const r = await say(avi, 'שוב לא אכלתי כל היום בכוונה');
    assert.ok(!/שאזכור את זה ולא אדבר/.test(r.reply), r.reply); assert.equal(r.options, undefined);
    // the system part the server builds: nothing about it (the chat history keeps his own question, as said)
    assert.doesNotMatch(prompt(), /השרת: כבר הצעת|קלוריות ומשקל/, 'a line about calories and weight after "לא צריך"');
    assert.doesNotMatch(JSON.stringify(requests.at(-1).messages), /השרת:/);
    assert.doesNotMatch(requests.at(-1).system[0].text, /השרת כתב שכבר הצעת/, 'the instructions still name the server\'s line');
  });
  await check('X33', 'פ5: בהוראות למודל, הפרעת אכילה, "health: בלי קלוריות ומשקל" ו-ד3', async () => {
    const t = requests.at(-1).system[0].text;
    assert.match(t, /- הפרעת אכילה \(/); assert.match(t, /"health: בלי קלוריות ומשקל"/); assert.match(t, /"צריך להפסיק לאכול בכלל"/);
    assert.ok(requests.at(-1).tools[0].input_schema.properties.eating, 'no eating in the tool');
  });
  await check('X34', 'פ5 (r7b): ילד מקבל רק את התשובה החמה: בלי שאלה, בלי עובדה ובלי סימן', async () => {
    answer = () => ({ reply: WARM, face: 'sad', eating: true, personal: true, actions: [{ kind: 'fact', key: 'health', value: ED, text: 'יואבי ביקש' }] });
    const r = await say(yoavi, 'אני מקיא אחרי שאני אוכל');
    assert.ok(r.reply.startsWith(WARM) && !/שאזכור את זה ולא אדבר/.test(r.reply), r.reply); assert.equal(r.options, undefined); assert.equal(r.proposal, undefined);
    assert.equal(edFacts(3).length, 0); assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'eating:3'")[0].n, 0);
    assert.ok(!(await seen(avi, /מקיא אחרי/)) && !(await seen(michal, /מקיא אחרי/)), 'a parent sees it');
  });
  // the reviewer's list (the owner 07/10): each on a new grown-up, since the question is asked once for each person
  const join = async (id, name, gender, code) => { sql("INSERT INTO users (id, name, gender, role, active, created) VALUES (?, ?, ?, 'member', 1, 0)", id, name, gender); sql('INSERT INTO pairing_codes (code, user_id, expires) VALUES (?, ?, 9999999999999)', code, id); return (await call(null, 'POST', '/api/pair', { code })).data.token; };
  const marked = (id) => sql('SELECT COUNT(*) AS n FROM settings WHERE key = ?', `eating:${id}`)[0].n;
  await check('X35', 'פ5: מי שאמר "די לשאול" לא נשאל, וגם eating:<id> לא נכתב (שאלה 91)', async () => {
    const orit = await join(4, 'אורית', 'f', '924444');
    await say(orit, 'די לשאול');
    answer = () => ({ reply: WARM, face: 'sad', eating: true, personal: true });
    const r = await say(orit, 'אני מקיאה אחרי שאני אוכלת');
    assert.ok(!/שאזכור את זה ולא אדבר/.test(r.reply), r.reply); assert.equal(r.options, undefined); assert.equal(marked(4), 0);
  });
  await check('X36', 'פ5: eating בלי personal הופך את ההודעה לאישית (שאלה 92)', async () => {
    const ron = await join(5, 'רון', 'm', '925555');
    answer = () => ({ reply: WARM, face: 'sad', eating: true });
    const r = await say(ron, 'אני אוכל בהתקפים ומתבייש');
    assert.ok(r.reply.endsWith(QM), r.reply);
    const row = JSON.parse(sql("SELECT content FROM chat WHERE content LIKE '%בהתקפים ומתבייש%' ORDER BY id DESC LIMIT 1")[0].content);
    assert.equal(row.only, 5); assert.equal(row.sensitive, true);
    assert.ok(!(await seen(avi, /בהתקפים/)), 'Avi sees it');
  });
  await check('X37', 'פ5: עם כרטיס או כפתורים השאלה לא נשאלת והסימן לא נכתב (שאלה 92)', async () => {
    const tal = await join(6, 'טל', 'f', '926666');
    answer = () => ({ reply: WARM, face: 'sad', eating: true, personal: true, actions: [{ kind: 'list_add', text: 'לחם' }] });
    let r = await say(tal, 'אני לא אוכלת בכוונה, ונגמר הלחם');
    assert.ok(!/שאזכור את זה ולא אדבר/.test(r.reply), r.reply); assert.equal(marked(6), 0);
    answer = () => ({ reply: `${WARM} רוצה רעיון לארוחה קלה?`, face: 'sad', eating: true, personal: true, options: ['כן', 'לא'] });
    r = await say(tal, 'אני מפחדת לעלות במשקל');
    assert.ok(!/שאזכור את זה ולא אדבר/.test(r.reply), r.reply); assert.equal(marked(6), 0);
  });
  await check('X38', 'פ5: מי שעוזב, eating:<id> שלו נמחק', async () => {
    assert.equal(marked(5), 1);
    assert.equal((await call(avi, 'POST', '/api/members', { id: 5, remove: true })).status, 200);
    assert.equal(marked(5), 0);
  });
  await check('X40', 'פ5: דרך עוזר מחובר (MCP) או עם תמונה: בלי שאלה, והסימן לא נכתב (שאלה 92, הבודק)', async () => {
    answer = () => ({ reply: WARM, face: 'sad', eating: true, personal: true });
    const gil = await join(7, 'גיל', 'm', '927777');
    const conn = (await call(gil, 'POST', '/api/connectors', { name: 'Claude' })).data.path;
    const r = await call(null, 'POST', conn, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ask_shuki', arguments: { message: 'אני מקיא אחרי שאני אוכל' } } });
    const said = r.data.result?.content?.[0]?.text || '';
    assert.ok(said && !/שאזכור את זה ולא אדבר/.test(said), JSON.stringify(r.data)); assert.equal(marked(7), 0);
    const dor = await join(8, 'דור', 'f', '928888');
    const JPEG = '/9j/' + Buffer.from('x'.repeat(300)).toString('base64').replace(/=/g, 'A');
    const p = (await call(dor, 'POST', '/api/chat', { text: 'אני מקיאה אחרי שאני אוכלת', image: { media_type: 'image/jpeg', data: JPEG } })).data;
    assert.ok(p.reply && !/שאזכור את זה ולא אדבר/.test(p.reply), JSON.stringify(p)); assert.equal(p.options, undefined); assert.equal(marked(8), 0);
  });
  await check('X41', 'פ5: שחזור יום מגיבוי משאיר את eating:<id>, גם סימן שנכתב אחרי הגיבוי (שאלה 93, הבודק)', async () => {
    await call(avi, 'POST', '/api/__schedule', { now: Date.now() });
    const day = (await call(avi, 'GET', '/api/backups')).data.backups?.[0]?.day;
    assert.ok(day, 'no backup');
    const before = sql("SELECT key FROM settings WHERE key LIKE 'eating:%' ORDER BY key").map((x) => x.key);
    assert.ok(before.length, 'no mark to keep');
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('eating:6', '1')"); // after the backup
    assert.equal((await call(avi, 'POST', '/api/backups/restore', { day })).status, 200);
    assert.deepEqual(sql("SELECT key FROM settings WHERE key LIKE 'eating:%' ORDER BY key").map((x) => x.key), [...before, 'eating:6'].sort());
  });
} finally {
  srv.kill(); srv2.kill(); mock.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} distress checks passed`);
if (failed.length) { console.log(log.split('\n').filter((l) => /error|Error/.test(l)).slice(-8).join('\n')); process.exit(1); }
