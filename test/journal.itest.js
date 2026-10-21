// Stage 0b, part 4: the journal and "since you were here" (docs/stage0-0b-proposal.md §4). On the Node server with a
// fake model. The journal comes from the server already filtered; "what did X buy off the list?" has no buyer's name to
// give (r12 q011); "forget what I said" takes a rule learned from that message too (decided for 0b, 02/10).
// Run: node --disable-warning=ExperimentalWarning test/journal.itest.js
import './fetch-retry.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DIR = '/tmp/shuki-test/shuki-journal'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const PORT = 8783, MOCK = 8784;
const zoneHour = (ts) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }).format(ts));
const at = (date, hour) => { let ts = Date.parse(`${date}T${String(hour).padStart(2, '0')}:05:00Z`); ts -= (zoneHour(ts) - hour) * 3600e3; return ts; };

const db = new DatabaseSync(`${DIR}/shuki.db`);
db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) { db.exec(readFileSync(`migrations/${f}`, 'utf8')); db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f); }
db.exec(readFileSync('test/fixture-house.sql', 'utf8'));
db.exec("INSERT INTO users (id, name, gender, role, active, created) VALUES (3, 'יואבי', 'm', 'child', 1, 0)");
db.exec("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999), ('222222', 2, 9999999999999), ('333333', 3, 9999999999999)");
db.exec("INSERT INTO products (id, name, count_type, qty, created, updated) VALUES (7, 'חלב', 'units', 2, 1, 1), (8, 'חלב סויה', 'units', 1, 1, 1), (9, 'שוקולד', 'units', 0, 1, 1)");
db.close();

let answer = () => ({ reply: 'אני פה!', face: 'happy' });
const requests = [];
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { const b = Buffer.concat(parts).toString('utf8'); // bytes first: a Hebrew letter can be split between chunks (question 29)

  const body = JSON.parse(b); requests.push(body);
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
const state = async (t) => (await call(t, 'GET', '/api/state')).data;
const act = (t, actions, extra = {}) => call(t, 'POST', '/api/actions', { actions, ...extra });
const sys = (r) => JSON.stringify([r.system.slice(1), r.messages]);

let avi, michal, yoavi;
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  [avi, michal, yoavi] = await Promise.all(['111111', '222222', '333333'].map(async (code) => (await call(null, 'POST', '/api/pair', { code })).data.token));

  await check('J1', 'היומן מהשרת (ממנו האפליקציה בונה את "מאז שהיית כאן"): הפעולה המשותפת של מיכל אצל אבי, הפרטית לא', async () => {
    await act(michal, [{ kind: 'list_add', product_id: 9 }, { kind: 'list_add', text: 'קונדומים' }]);
    const j = (await state(avi)).journal.map((e) => e.summary);
    assert.ok(j.some((x) => /מיכל הוסיפה לרשימה שוקולד/.test(x)), JSON.stringify(j));
    assert.ok(!JSON.stringify(j).includes('קונדומים'), JSON.stringify(j));
    assert.ok((await state(michal)).journal.some((e) => e.summary.includes('קונדומים')), 'her own private line');
  });

  await check('J2', '"מה מיכל קנתה מחוץ לרשימה?": בהיסטוריית הקניות שהמודל מקבל אין שם של קונה (r12 q011)', async () => {
    await call(michal, 'POST', '/api/shopping', { store: 'super' });
    await act(michal, [{ kind: 'op', product_id: 8, op: { type: 'purchase', amount: 1 } }], { context: 'shopping' });
    await call(michal, 'POST', '/api/shopping', { on: false });
    const trip = sql('SELECT summary FROM shopping WHERE user_id = 2 AND summary IS NOT NULL')[0];
    assert.match(trip.summary, /חלב סויה/, 'an off-list buy on the trip');
    answer = () => ({ reply: 'לא יודע.', face: 'happy' });
    await say(avi, 'מה מיכל קנתה מחוץ לרשימה בשבוע שעבר?');
    const p = sys(requests.at(-1));
    const line = /קנייה ב[^\\]*?חלב סויה/.exec(p)?.[0] || '';
    assert.ok(line, 'the trip is in the history');
    assert.ok(!/מיכל/.test(line), line);
  });

  await check('J3', '"תשכח מה שאמרתי" מוחק גם כלל שנלמד מההודעה, ואת שורת היומן "לימד אותי"; כלל של מיכל נשאר', async () => {
    answer = () => ({ reply: 'סגור.', face: 'happy', actions: [{ kind: 'lesson', text: 'כשמיכל אומרת שוקולד היא מתכוונת לשוקולד מריר' }] });
    await say(michal, 'תזכור שכשאני אומרת שוקולד אני מתכוונת למריר');
    answer = () => ({ reply: 'סגור.', face: 'happy', actions: [{ kind: 'lesson', text: 'כשאבי אומר חלב הוא מתכוון לחלב סויה' }] });
    await say(avi, 'תזכור שכשאני אומר חלב אני מתכוון לחלב סויה');
    const l = sql("SELECT id, chat_id FROM lessons WHERE text LIKE '%לחלב סויה%'");
    assert.equal(l.length, 1, 'learned');
    assert.ok(l[0].chat_id, 'the rule remembers its message');
    assert.equal(sql("SELECT COUNT(*) AS n FROM events WHERE type = 'lesson' AND summary LIKE '%לחלב סויה%'")[0].n, 1);
    const r = await say(avi, 'תשכח מה שאמרתי');
    assert.equal(r.reply, 'סגור, שכחתי.');
    assert.equal(sql("SELECT COUNT(*) AS n FROM lessons WHERE text LIKE '%לחלב סויה%'")[0].n, 0, 'the rule stayed');
    assert.equal(sql("SELECT COUNT(*) AS n FROM events WHERE type = 'lesson' AND summary LIKE '%לחלב סויה%'")[0].n, 0, 'its journal line stayed');
    assert.ok(!JSON.stringify((await state(michal)).journal).includes('לחלב סויה'));
    assert.equal(sql("SELECT COUNT(*) AS n FROM lessons WHERE text LIKE '%שוקולד מריר%'")[0].n, 1, 'Michal\'s rule went too');
  });

  await check('J4', 'כלל שאושר ב"כן": "תשכח מה שאמרתי" אחרי ה"כן" מוחק אותו', async () => {
    answer = () => ({ reply: 'האם תרצה שאזכור שאבי אוהב שוקולד מריר?', face: 'happy', actions: [{ kind: 'lesson', text: 'אבי אוהב שוקולד מריר' }] });
    await say(avi, 'אני אוהב שוקולד מריר');
    await say(avi, 'כן, תזכור');
    assert.equal(sql("SELECT COUNT(*) AS n FROM lessons WHERE text = 'אבי אוהב שוקולד מריר'")[0].n, 1, 'learned on "yes"');
    assert.equal((await say(avi, 'תשכח מה שאמרתי')).reply, 'סגור, שכחתי.');
    assert.equal(sql("SELECT COUNT(*) AS n FROM lessons WHERE text = 'אבי אוהב שוקולד מריר'")[0].n, 0);
  });

  await check('J5', '"תשכח מה שאמרתי" לפני שעניתי על "לזכור?": השאלה נסגרת, ו"אוקי" אחר כך לא מלמד', async () => {
    answer = () => ({ reply: 'האם תרצה שאזכור שאבי לא אוכל פטריות?', face: 'happy', actions: [{ kind: 'lesson', text: 'אבי לא אוכל פטריות' }] });
    await say(avi, 'אני לא אוכל פטריות');
    await say(avi, 'תשכח מה שאמרתי');
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await say(avi, 'אוקי');
    assert.equal(sql("SELECT COUNT(*) AS n FROM lessons WHERE text = 'אבי לא אוכל פטריות'")[0].n, 0);
  });

  await check('J6', 'ילד: "תשכח" סוגר את השאלה להורים; כלל שהורה אישר הילד לא מוחק', async () => {
    answer = () => ({ reply: 'האם תרצה שאזכור?', face: 'happy', actions: [{ kind: 'lesson', text: 'יואבי לא אוכל עגבניות' }] });
    await say(yoavi, 'אני לא אוכל עגבניות');
    assert.ok(sql("SELECT COUNT(*) AS n FROM chat WHERE thread = 1 AND content LIKE '%יואבי ביקש שאזכור%'")[0].n >= 1, 'the parents were asked');
    await say(yoavi, 'תשכח מה שאמרתי');
    assert.equal(sql("SELECT COUNT(*) AS n FROM chat WHERE content LIKE '%עגבניות%' AND content LIKE '%שאזכור%'")[0].n, 0, 'the question to the parents stayed');
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'ask:%' AND value LIKE '%עגבניות%'")[0].n, 0, 'their yes is still waiting');
    // again, and this time Avi says yes; then Yoavi's "forget" can't take it away
    answer = () => ({ reply: 'האם תרצה שאזכור?', face: 'happy', actions: [{ kind: 'lesson', text: 'יואבי לא אוכל חצילים' }] });
    await say(yoavi, 'אני לא אוכל חצילים');
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await say(avi, 'כן, תזכור');
    assert.equal(sql("SELECT COUNT(*) AS n FROM lessons WHERE text = 'יואבי לא אוכל חצילים'")[0].n, 1, 'Avi approved');
    await say(yoavi, 'תשכח מה שאמרתי');
    assert.equal(sql("SELECT COUNT(*) AS n FROM lessons WHERE text = 'יואבי לא אוכל חצילים'")[0].n, 1, 'a child took away a rule');
  });

  await check('J7', 'הסיכום החודשי לבית כולו: בלי המוצר הפרטי של מי שמקבל אותו (r12 q013)', async () => {
    sql(`UPDATE devices SET push_sub = '{"endpoint":"http://127.0.0.1:${MOCK}/push","keys":{"p256dh":"x","auth":"y"}}', push_on = 1`);
    const freezer = sql("SELECT id FROM locations WHERE name = 'מקפיא'")[0].id;
    sql("INSERT INTO products (id, name, count_type, qty, location_id, private_to, created, updated) VALUES (30, 'ויאגרה', 'units', 2, ?, 2, 1, 1), (31, 'שניצל', 'units', 2, ?, NULL, 1, 1)", freezer, freezer);
    const d = new Date(); const first = `${d.getUTCFullYear() + (d.getUTCMonth() === 11 ? 1 : 0)}-${String((d.getUTCMonth() + 1) % 12 + 1).padStart(2, '0')}-01`;
    const r = (await call(avi, 'POST', '/api/__schedule', { now: at(first, 20) })).data;
    const mine = JSON.stringify(r.digestFor?.[2] || []);
    assert.match(mine, /שניצל/, JSON.stringify(r).slice(0, 300));
    assert.ok(!mine.includes('ויאגרה'), mine);
  });
  await check('J8', 'עובדה על מבוגר אחר ואז "תשכח מה שאמרתי": גם השאלה אליו נעלמת, עם מה שציטטה', async () => {
    answer = () => ({ reply: 'האם תרצה שאזכור?', face: 'happy', actions: [{ kind: 'fact', key: 'allergy', about: 'מיכל', value: 'אגוזים', text: 'למיכל יש אלרגיה לאגוזים' }] });
    await say(avi, 'למיכל יש אלרגיה לאגוזים');
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await say(avi, 'כן');
    assert.ok(JSON.stringify((await call(michal, 'GET', '/api/chat')).data.messages).includes('אלרגיה לאגוזים'), 'Michal was asked');
    await say(avi, 'תשכח מה שאמרתי');
    assert.ok(!JSON.stringify((await call(michal, 'GET', '/api/chat')).data.messages).includes('אלרגיה לאגוזים'), 'the question to Michal stayed');
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'ask:2' AND value LIKE '%אגוזים%'")[0].n, 0, 'her yes is still waiting');
    assert.equal(sql("SELECT COUNT(*) AS n FROM facts WHERE key = 'allergy' AND value = 'אגוזים'")[0].n, 0);
  });
  // פ8 (r7b, 06/10): what's private to Michal doesn't change Shuki's mood for Avi, neither the toss nor the time of the last update
  await check('J9', '"זרקתי" של מיכל על מוצר פרטי: מצב הרוח של אבי לא משתנה, ושלה כן', async () => {
    sql('UPDATE events SET ts = ts - 5 * 864e5');
    const before = (await state(avi)).mood;
    assert.equal(before.mood, 'sleepy', JSON.stringify(before));
    const r = await act(michal, [{ kind: 'op', product_id: 30, op: { type: 'discard' } }]); assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(sql('SELECT private_to FROM events WHERE waste = 1 ORDER BY ts DESC LIMIT 1')[0]?.private_to, 2, 'her toss is private');
    assert.deepEqual((await state(avi)).mood, before);
    assert.notEqual((await state(michal)).mood.mood, 'sleepy', 'her own mood didn\'t move');
  });
  await check('J10', 'ביטול סימון על שורה שנסגרה (done): אין שורה ריקה ביומן', async () => {
    await act(michal, [{ kind: 'list_add', product_id: 8 }]);
    const item = sql("SELECT id FROM list_items WHERE product_id = 8 AND status = 'open'")[0].id;
    await act(michal, [{ kind: 'check', item_id: item }]);
    await act(michal, [{ kind: 'finish' }]);
    assert.equal(sql('SELECT status FROM list_items WHERE id = ?', item)[0].status, 'done');
    const n0 = sql('SELECT COUNT(*) AS n FROM events')[0].n;
    const r = await act(michal, [{ kind: 'uncheck', item_id: item }]); assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(sql('SELECT COUNT(*) AS n FROM events')[0].n, n0, JSON.stringify(sql('SELECT summary FROM events ORDER BY ts DESC LIMIT 2')));
    assert.equal(sql("SELECT COUNT(*) AS n FROM events WHERE summary = 'מיכל '")[0].n, 0);
    assert.ok(!(await state(avi)).journal.some((e) => !e.summary.trim() || e.summary.trim() === 'מיכל'), 'an empty line in Avi\'s journal');
  });
} finally {
  srv.kill(); mock.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} journal checks passed`);
if (failed.length) { console.log(log.split('\n').filter((l) => /error|Error/.test(l)).slice(-8).join('\n')); process.exit(1); }
