// Stage 8, ו2 (docs/stage8-plan.md, question 11): "חג שמח!" on a holiday, on the Node server with a fake model and the server's
// clock on the first day of Pesach 5786 (2 April 2026, 10:00 in Jerusalem). The plan's F51–F53.
// Run: node --disable-warning=ExperimentalWarning test/holiday.itest.js
import './fetch-retry.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DIR = '/tmp/shuki-test/shuki-holiday'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const PORT = 8863, MOCK = 8864;
const PESACH = Date.UTC(2026, 3, 2, 7, 0);

// Avi (admin), Michal, Yoavi (a child)
const db = new DatabaseSync(`${DIR}/shuki.db`);
db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) { db.exec(readFileSync(`migrations/${f}`, 'utf8')); db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f); }
db.exec(readFileSync('test/fixture-house.sql', 'utf8'));
db.exec("INSERT INTO users (id, name, gender, role, active, created) VALUES (3, 'יואבי', 'm', 'child', 1, 0)");
db.exec("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999), ('222222', 2, 9999999999999), ('333333', 3, 9999999999999)");
db.close();

let answer = () => ({ reply: 'אני פה!', face: 'happy' });
const requests = [];
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { const b = Buffer.concat(parts).toString('utf8'); // bytes first: a Hebrew letter can be split between chunks (question 29)
  const body = JSON.parse(b); requests.push(body);
  const a = answer(body);
  if (a === 'FAIL') { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":{"type":"api_error"}}'); return; }
  res.writeHead(200, { 'content-type': 'application/json' });
  // NO_TOOL: an answer with no tool_use in it
  res.end(JSON.stringify({ content: a === 'NO_TOOL' ? [{ type: 'text', text: 'hmm' }] : [{ type: 'tool_use', id: `t${requests.length}`, name: body.tools?.[0]?.name || 'respond', input: a }], usage: { input_tokens: 1, output_tokens: 1 } }));
}); }).listen(MOCK, '127.0.0.1');
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/node.js'], { env: { ...process.env, PORT: String(PORT), DB_PATH: `${DIR}/shuki.db`, ANTHROPIC_API_KEY: 't', ANTHROPIC_URL: `http://127.0.0.1:${MOCK}/v1/messages`, TEST_RESET: '1', CHAT_PER_MINUTE: '1000', FIXED_NOW: String(PESACH) }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
const call = async (t, m, p, b) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const x = await r.text(); let data; try { data = JSON.parse(x); } catch { data = x; } return { status: r.status, data }; };
const sql = (q, ...a) => { const d = new DatabaseSync(`${DIR}/shuki.db`); try { return /^\s*select/i.test(q) ? d.prepare(q).all(...a) : d.prepare(q).run(...a); } finally { d.close(); } };
const results = [];
async function check(id, name, fn) {
  try { await fn(); results.push({ id, ok: true }); console.log('✓', id, name); }
  catch (e) { results.push({ id, ok: false }); console.log('✗', id, name, '\n   ', e.message.slice(0, 500)); }
}
const say = async (t, text) => (await call(t, 'POST', '/api/chat', { text })).data;
/** Shuki's last row in the chat table: what was saved */
const lastShuki = () => JSON.parse(sql("SELECT content FROM chat WHERE role = 'shuki' ORDER BY id DESC LIMIT 1")[0].content);
const CARD = [{ kind: 'list_add', text: 'במבה' }];
/** The fixed words are the whole answer: exactly, the face, no card, no buttons, no 👍/👎 */
const whole = (r, words, face) => {
  assert.equal(r.reply, words); assert.equal(r.face, face);
  assert.equal(r.proposal, undefined, 'a card'); assert.equal(r.options, undefined, 'buttons');
  const row = lastShuki(); assert.equal(row.reply, words); assert.equal(row.ai, undefined, '👍/👎'); assert.equal(row.proposal, undefined);
};
let avi, michal, yoavi;
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  [avi, michal, yoavi] = await Promise.all(['111111', '222222', '333333'].map(async (code) => (await call(null, 'POST', '/api/pair', { code })).data.token));

  // the phones were just paired: the joiner's food question (r9-100) would take the first message; not what's tested here
  sql("DELETE FROM settings WHERE key LIKE 'joinfood:%'");

  const answer1 = (reply) => { answer = () => ({ reply, face: 'happy' }); };
  const mark = (u) => sql('SELECT COUNT(*) AS n FROM settings WHERE key = ?', `holiday:${u}:2026-04-02`)[0].n;
  await check('F51', 'יום פסח: התשובה הראשונה של אבי מתחילה ב"חג שמח!", והשנייה לא', async () => {
    answer1('האם להוסיף חלב לרשימה?');
    assert.equal((await say(avi, 'נגמר החלב')).reply, 'חג שמח! האם להוסיף חלב לרשימה?');
    assert.equal((await say(avi, 'נגמר החלב')).reply, 'האם להוסיף חלב לרשימה?');
    assert.equal(mark(1), 1);
  });
  await check('F52', 'לא בתשובה עם fixed (loss), לא בתור אישי; אחריהם, בתשובה הרגילה הראשונה כן', async () => {
    answer = () => ({ reply: 'אוי.', face: 'sad', fixed: 'loss' });
    assert.doesNotMatch((await say(michal, 'סבתא שלי נפטרה')).reply, /חג שמח/);
    answer = () => ({ reply: 'אני כאן.', face: 'happy', personal: true });
    assert.doesNotMatch((await say(michal, 'בינינו, אני בהריון')).reply, /חג שמח/);
    assert.equal(mark(2), 0, 'marked without the greeting');
    answer1('בסדר.');
    assert.equal((await say(michal, 'תודה')).reply, 'חג שמח! בסדר.');
  });
  await check('F52א', 'לא לילד ב-24 השעות אחרי מצוקה; "חג שמח!" שהמודל כתב בעצמו לא נכפל', async () => {
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('distress:3', ?)", String(PESACH - 3600e3));
    answer1('יש יוגורט במקרר.');
    assert.equal((await say(yoavi, 'מה יש לאכול?')).reply, 'יש יוגורט במקרר.');
    assert.equal(mark(3), 0);
    sql("DELETE FROM settings WHERE key = 'distress:3'");
    sql("DELETE FROM settings WHERE key LIKE 'holiday:%'");
    answer1('חג שמח! האם להוסיף מצות לרשימה?');
    assert.equal((await say(avi, 'נגמרו המצות')).reply, 'חג שמח! האם להוסיף מצות לרשימה?');
    assert.equal((await say(avi, 'נגמרו המצות')).reply, 'האם להוסיף מצות לרשימה?', "the model's own greeting, the second time, goes");
    sql("DELETE FROM settings WHERE key LIKE 'holiday:%'");
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('ask_once:recipe_tip:1', '1')"); // ז5's tip, given already
    answer1('חג שמח לך ולכל המשפחה! מה נבשל?');
    assert.equal((await say(avi, 'מה נבשל?')).reply, 'חג שמח לך ולכל המשפחה! מה נבשל?', 'its greeting to the family broke');
  });
  await check('F52ג', '"חג שמח" שהמודל כתב בתור סודי, או בפעם השנייה ביום: יורד', async () => {
    answer = () => ({ reply: 'חג שמח! זה נשאר בינינו, אני כאן.', face: 'happy', personal: true });
    assert.doesNotMatch((await say(michal, 'בינינו, קשה לי היום')).reply, /חג שמח/, 'in a secret turn');
    answer1('האם להוסיף חלב?');
    assert.equal((await say(michal, 'נגמר החלב')).reply, 'חג שמח! האם להוסיף חלב?', 'her first answer of the day');
    answer1('חג שמח! האם להוסיף חלב?');
    assert.equal((await say(michal, 'נגמר החלב')).reply, 'האם להוסיף חלב?', 'the second time today');
    answer1('חג שמח, הנה מה שחסר: חלב וביצים. עוד משהו?');
    assert.equal((await say(michal, 'מה חסר?')).reply, 'חג שמח, הנה מה שחסר: חלב וביצים. עוד משהו?', 'a sentence that isn\'t only a greeting stays');
    answer1('חג שמח לכל המשפחה! האם להוסיף חלב?');
    assert.equal((await say(michal, 'נגמר החלב')).reply, 'האם להוסיף חלב?', 'a greeting to the family, the second time');
    answer1('חג שמח הנה מה שחסר: חלב וביצים. עוד משהו?');
    assert.equal((await say(michal, 'מה חסר?')).reply, 'חג שמח הנה מה שחסר: חלב וביצים. עוד משהו?', 'a sentence with more in it stays');
    answer1('חג שמח! 🎉 האם להוסיף חלב?');
    assert.equal((await say(michal, 'נגמר החלב')).reply, 'האם להוסיף חלב?', 'the emoji goes with it');
    answer1('חג שמח הוספתי חלב לרשימה! עוד משהו?');
    assert.equal((await say(michal, 'נגמר החלב')).reply, 'חג שמח הוספתי חלב לרשימה! עוד משהו?', 'a short sentence of more than a greeting stays');
    answer1('חג שמח גם לך!');
    assert.equal((await say(michal, 'חג שמח שוקי!')).reply, 'חג שמח גם לך!', 'an answer to her own greeting');
  });
  await check('F52ב', 'הסימן של אתמול נמחק בריצה של השעה, ושל היום נשאר', async () => {
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('holiday:1:2026-04-01', '1')");
    await call(avi, 'POST', '/api/__schedule', { now: PESACH + 3600e3 });
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'holiday:1:2026-04-01'")[0].n, 0, "yesterday's stayed");
    assert.equal(mark(1), 1, "today's went");
  });
  await check('F53', 'בית שאמר "לא חוגגים חגים": בלי; בית שחוגג חגים מוסלמיים: לא בפסח', async () => {
    for (const [value, why] of [['לא חוגגים חגים', 'a house that doesn\'t celebrate'], ['חוגגים חגים מוסלמיים', 'Pesach in a Muslim house']]) {
      sql("DELETE FROM settings WHERE key LIKE 'holiday:%'"); sql("DELETE FROM facts WHERE key = 'habit'");
      sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('house', 0, 'habit', ?, 1, 1, 1, 0, 'chat', 1, 1)", value);
      answer1('בסדר.');
      assert.equal((await say(avi, 'תודה')).reply, 'בסדר.', why);
    }
    sql("DELETE FROM facts WHERE key = 'habit'");
  });
  await check('F54', 'רמדאן, הדת של הבית כ-habit, ו"חג שמח!" של השרת בהוראות', async () => {
    answer1('בסדר.');
    await say(avi, 'F54');
    assert.ok(requests.at(-1).system[0].text.includes('רמדאן (ו2): רק אחרי שמי שכותב אמר שהוא צם (fasting "רמדאן")'));
    assert.ok(requests.at(-1).system[0].text.includes('fact habit על הבית, למשל "חוגגים חגים מוסלמיים". "חג שמח!" השרת אומר בעצמו, אל תכתוב אותו.'));
  });
} finally {
  srv.kill(); mock.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} holiday checks passed`);
if (failed.length) { console.log(log.split('\n').filter((l) => /error|Error/.test(l)).slice(-8).join('\n')); process.exit(1); }
