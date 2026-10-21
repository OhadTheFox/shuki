// Stage 10 (docs/stage10-plan.md): Shuki's character on the server, on the Node server with a fake model in the test.
// t12: a sensitive answer has no laughing, afro, excited or strong face; distress is "מבין" (with t1); t53: the button of
// the quantity question in the first meeting by the product's gender. Run: node --disable-warning=ExperimentalWarning test/character.itest.js
import './fetch-retry.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DIR = '/tmp/shuki-test/shuki-character'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const PORT = 8841, MOCK = 8842;

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
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => {
  const body = JSON.parse(Buffer.concat(parts).toString('utf8')); requests.push(body);
  const a = answer(body);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'tool_use', id: `t${requests.length}`, name: body.tools?.[0]?.name || 'respond', input: a }], usage: { input_tokens: 1, output_tokens: 1 } }));
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
const lastShuki = () => JSON.parse(sql("SELECT content FROM chat WHERE role = 'shuki' ORDER BY id DESC LIMIT 1")[0].content);
const LOUD = ['excited', 'ecstatic', 'laughing', 'strong'];
// the instructions and the tool at 7d7d3ff (stage 9 deployed): stage 10 doesn't change what the model sees (K11)
const PROMPT_AT_7D7D3FF = '8f0d6b55fad4e157'; // home20 pita/ed round (ב): never an offer to tell others; a professional or someone close // home20 pita/ed round (א): a neutral refusal // home20 small round (pita): no goal, target, weight, calories or plan to whoever has an eating disorder // home20 round 3, fix 2: the writer in the second person, food only as the facts say // home20 round 3: "שוקי לא מקלל" // home20 round 2, after the real model (s8-05-fish): "גם לא כדי לומר שאין" only when not asked, after the exception, with no example // home20 round 2 (the owner 19/10): rule 15 ("המנה של X" and no day: plan, the server asks; a child's; no missing in words) and §9's "גם לא בשלילה": s7 and s8 run again // home20 (section 16): the action plan, and rule 15 ("היום דגים, מחר המנה של אושרי"): s7 and s8 run again on the real model // home19 (8, after h19-a): a name said is the recipe's name // home19 (1, 2, 7, 8, 11, 12): the card is the question; "X זה סוג של Y" is an alias; a saved recipe's missing from the server; second person to the writer; the place not asked from the server // home18 (after s8c): a food fact only from what the person said now, no value to copy // home18 (2, 5, 6, 7): no ב before a preposition; the store lines one rule; "מה קבוע" from the catalog; "למה X לא קבוע" // 17/10: buttons only for a closed choice, a place not in the list (place_said), "חצי" on a regular open one with nothing closed, the tone (af31b05d5dc54c05 on 16/10); sha256 of [system[0], tools], first 16 hex, on the fixture house; at 7d7d3ff '205e818ccbee11be', since stage 13's d5 (the family's names out of the examples, approved) '08723abe41376ca6', since r13l (the recording answer's five examples, approved 15/10) 'e052cad79066873e', since q9 (a number on a vegetable or fruit is units, approved 16/10) '23160278e043d25e', and since 16/10's (half while mapping, the mapping's three buttons and its basics after each place, no pressing for an answer; approved) 'fca4b3929989e1b6', and since the typo line (approved 16/10) this
let avi, michal, yoavi;
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  [avi, michal, yoavi] = await Promise.all(['111111', '222222', '333333'].map(async (code) => (await call(null, 'POST', '/api/pair', { code })).data.token));

  // first, on the clean house: what the model sees doesn't depend on what came before
  await check('S10-11', 'K11: "מבין" לא ב-enum של face בכלי, וההוראות והכלי כמו ב-7d7d3ff', async () => {
    answer = () => ({ reply: 'אני פה!', face: 'happy' });
    const n = requests.length; await say(avi, 'מה נשמע?');
    const body = requests[n];
    const face = body.tools[0].input_schema.properties.face.enum;
    assert.ok(!face.includes('understanding'), face.join());
    const hash = createHash('sha256').update(JSON.stringify([body.system[0], body.tools])).digest('hex').slice(0, 16);
    if (process.env.PRINT_PROMPT_HASH) console.log('prompt hash', hash);
    assert.equal(hash, PROMPT_AT_7D7D3FF, 'the instructions or the tool changed: stop and tell the owner');
  });
  await check('S10-01', 'K1: personal ("אני בהריון, בינינו") עם excited → רגיל, בתשובה ובשורה', async () => {
    answer = () => ({ reply: 'מזל טוב!', face: 'excited', personal: true });
    const r = await say(michal, 'יש לי חדשות');
    assert.equal(r.face, 'neutral'); assert.equal(lastShuki().face, 'neutral'); assert.equal(lastShuki().sensitive, true);
  });
  await check('S10-02', 'K2: ecstatic, laughing ו-strong בתור personal → רגיל; happy ו-sad נשארים', async () => {
    for (const face of ['ecstatic', 'laughing', 'strong']) { answer = () => ({ reply: 'יופי.', face, personal: true }); assert.equal((await say(michal, 'משהו אישי')).face, 'neutral', face); }
    for (const face of ['happy', 'sad']) { answer = () => ({ reply: 'בסדר.', face, personal: true }); assert.equal((await say(michal, 'משהו אישי')).face, face, face); }
  });
  await check('S10-03', 'K3: "בינינו" (isSecret) עם laughing → רגיל', async () => {
    answer = () => ({ reply: 'חחח, סגור.', face: 'laughing' });
    const r = await say(avi, 'בינינו, אכלתי את כל העוגה');
    assert.equal(r.face, 'neutral');
  });
  await check('S10-04', 'K4: ילד בתוך 24 השעות שאחרי מצוקה: excited → רגיל', async () => {
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('distress:3', ?)", String(Date.now() - 3600e3));
    answer = () => ({ reply: 'איזה כיף!', face: 'excited' });
    assert.equal((await say(yoavi, 'היה לי יום טוב')).face, 'neutral');
    sql("DELETE FROM settings WHERE key = 'distress:3'");
  });
  await check('S10-05', 'K5: ילד, חשד שהמודל אמר עליו "לא מצוקה": excited → רגיל', async () => {
    answer = () => ({ reply: 'אוי, איזה מצחיק!', face: 'excited', distress: 'none' });
    const r = await say(yoavi, 'אחי מרביץ לי במשחק');
    assert.equal(r.face, 'neutral');
    sql("DELETE FROM settings WHERE key = 'distress:3'");
  });
  await check('S10-06', 'K6: מבוגר, תור רגיל: excited נשאר', async () => {
    answer = () => ({ reply: 'איזה כיף!', face: 'excited' });
    assert.equal((await say(avi, 'קנינו מקרר חדש')).face, 'excited');
  });
  await check('S10-07', 'K7: עובדת health בלי personal: excited → רגיל', async () => {
    answer = () => ({ reply: 'אזכור את זה!', face: 'excited', actions: [{ kind: 'fact', key: 'health', about: 'אבי', value: 'סוכרת', text: 'לאבי יש סוכרת' }] });
    assert.equal((await say(avi, 'יש לי סוכרת')).face, 'neutral');
  });
  await check('S10-08', 'K8: אף נוסח קבוע (FIXED) לא נותן צוחק, אפרו, נלהב או שרירי', async () => {
    const { FIXED } = await import('../worker/fixed.js');
    for (const [k, f] of Object.entries(FIXED)) assert.ok(!LOUD.includes(f.face), `${k}: ${f.face}`);
  });
  await check('S10-09', 'K9: אחרי מצוקה, שאלה שמחכה בתור לא משתחררת באותו תור; אחרי הודעה רגילה כן', async () => {
    sql("DELETE FROM settings WHERE key LIKE 'ask:%' OR key LIKE 'askq:%'");
    sql("INSERT INTO settings (key, value) VALUES ('askq:1', ?)", JSON.stringify([{ ask: { done: 'סגור!' }, bubble: { reply: 'שאלה שמחכה בתור?', face: 'happy', for: 1 }, ts: Date.now() }]));
    // a suspicion the model confirmed: the path that reaches releaseAsk (a sure phrase returns before it)
    answer = () => ({ reply: 'אני ממש מצטער.', face: 'sad', distress: 'violence_home' });
    const d = await say(avi, 'אחי מרביץ לי');
    assert.equal(d.distress, true); assert.equal(d.face, 'understanding');
    assert.equal(sql("SELECT COUNT(*) AS n FROM chat WHERE content LIKE '%שאלה שמחכה בתור?%'")[0].n, 0, 'released right after distress');
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await say(avi, 'מה יש לארוחת ערב?');
    assert.equal(sql("SELECT COUNT(*) AS n FROM chat WHERE content LIKE '%שאלה שמחכה בתור?%'")[0].n, 1, 'not released after an ordinary message');
    sql("DELETE FROM settings WHERE key LIKE 'ask:%' OR key LIKE 'askq:%'");
  });
  await check('S10-10', 'K10: תור רגיש: התגובה cooked (נלהב) לא נשלחת; love (שמח) נשארת', async () => {
    answer = () => ({ reply: 'נשמע טעים!', face: 'happy', personal: true });
    const r = await say(michal, 'הכנתי עוגה, בינינו');
    assert.equal(r.reaction, undefined, `reaction ${r.reaction}`);
    answer = () => ({ reply: 'בהצלחה!', face: 'happy', personal: true });
    const d = await say(michal, 'יש לי דייט הערב, בינינו');
    assert.equal(d.reaction, 'love');
    answer = () => ({ reply: 'נשמע טעים!', face: 'excited' });
    assert.equal((await say(avi, 'הכנתי עוגה')).reaction, 'cooked', 'not sensitive: stays');
  });
  await check('S10-12', 'K12 (t53; 17/10, ש4): מוצר קבוע אחד, "ביצים": "לא" / "כן, אכתוב לך"; גם אחרי הפסקה; "לא" בלי מודל', async () => {
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('onboard', ?)", JSON.stringify({ step: 'basics', user: 1, started: Date.now() }));
    answer = () => ({ names: [], new_items: ['ביצים'] });
    await say(avi, 'ביצים');
    let b = lastShuki(); assert.equal(b.reply, 'האם צריך מהן יותר מאחת בבית?'); assert.deepEqual(b.options, ['לא', 'כן, אכתוב לך']);
    await say(avi, 'אחר כך');
    await say(avi, 'כן, נמשיך');
    b = lastShuki(); assert.match(b.reply, /האם צריך מהן יותר מאחת בבית\?$/); assert.deepEqual(b.options, ['לא', 'כן, אכתוב לך'], 'after a pause');
    const n = requests.length;
    await say(avi, 'לא');
    assert.equal(requests.length, n, 'the model was asked');
    assert.equal(JSON.parse(sql("SELECT value FROM settings WHERE key = 'onboard'")[0].value).step, 'more');
    sql("DELETE FROM settings WHERE key = 'onboard'");
  });
  await check('S10-13', 'K13 (שאלה 18): אפליקציה שעוד יודעת 15 רמות (בלי x-levels) מקבלת את הרמה במספרים שלה; האפליקציה החדשה את 21', async () => {
    const xp = (await call(michal, 'GET', '/api/state')).data.growth.xp;
    const add = 100 - xp;
    if (add > 0) sql(`INSERT INTO events (ts, user_id, type, summary) SELECT ${Date.now()} - (2000 + k) * 86400000, 2, 'edit', 'x' FROM (WITH RECURSIVE c(k) AS (SELECT 1 UNION ALL SELECT k + 1 FROM c WHERE k < ${add}) SELECT k FROM c)`); // a day each (points are days, 16/10)
    const old = (await call(michal, 'GET', '/api/state')).data.growth;
    const r = await fetch(`http://127.0.0.1:${PORT}/api/state`, { headers: { authorization: `Bearer ${michal}`, 'x-levels': '21' } }).then((x) => x.json());
    assert.equal(old.xp, 100); assert.equal(old.level, 6); assert.equal(old.from, 100); assert.equal(old.to, 125);
    assert.equal(r.growth.level, 10); assert.equal(r.growth.name, 'צייד המבצעים');
  });
} finally {
  srv.kill(); mock.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} character checks passed`);
if (failed.length) { console.log(log.split('\n').filter((l) => /error|Error/.test(l)).slice(-8).join('\n')); process.exit(1); }
