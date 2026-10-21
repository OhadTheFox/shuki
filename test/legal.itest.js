// The legal package (r13l, 15/10): l4, l6, the recording answer, leaving by oneself and the personal download, on the Node
// server with a fake model. Each check fails on the code before it. Run: node --disable-warning=ExperimentalWarning test/legal.itest.js
import './fetch-retry.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DIR = '/tmp/shuki-test/shuki-legal'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const PORT = 8893, MOCK = 8894;

// Avi (admin), Michal, Orit (a child)
const db0 = new DatabaseSync(`${DIR}/shuki.db`);
db0.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) { db0.exec(readFileSync(`migrations/${f}`, 'utf8')); db0.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f); }
db0.exec(readFileSync('test/fixture-house.sql', 'utf8'));
db0.exec("INSERT INTO users (id, name, gender, role, active, created) VALUES (3, 'אורית', 'f', 'child', 1, 0)");
db0.exec("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999), ('222222', 2, 9999999999999), ('333333', 3, 9999999999999)");
db0.close();

let answer = () => ({ reply: 'אני פה!', face: 'happy' }), fail = false;
const requests = [];
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
  requests.push(body);
  if (fail) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'invalid request: boom' } })); return; }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'tool_use', name: body.tools?.[0]?.name || 'respond', input: answer(body) }], usage: { input_tokens: 1, output_tokens: 1 } }));
}); }).listen(MOCK, '127.0.0.1');
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/node.js'], { env: { ...process.env, PORT: String(PORT), DB_PATH: `${DIR}/shuki.db`, TRUST_PROXY: '1', ANTHROPIC_API_KEY: 't', ANTHROPIC_URL: `http://127.0.0.1:${MOCK}/v1/messages`, RETRY_MS: '1', TEST_RESET: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
const call = async (t, m, p, b) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch { /* text */ }
  return { status: r.status, data, text };
};
const sql = (q, ...a) => { const d = new DatabaseSync(`${DIR}/shuki.db`); try { return /^\s*select/i.test(q) ? d.prepare(q).all(...a) : d.prepare(q).run(...a); } finally { d.close(); } };
const say = async (t, text) => (await call(t, 'POST', '/api/chat', { text })).data;
const results = [];
async function check(id, name, fn) {
  try { await fn(); results.push({ id, ok: true }); console.log('✓', id, name); }
  catch (e) { results.push({ id, ok: false }); console.log('✗', id, name, '\n   ', e.message.slice(0, 500)); }
}
const RECORDING = 'אני שומע רק מה שכותבים לי. כשמישהו כותב לי, אני שולח ל-Claude, המוח שלי, שנמצא בארה"ב, את ההודעה, את המלאי, את הרשימה, את השמות של מי שגר כאן ואת מה שלמדתי עליהם. כל השאר נשמר רק בשרת של הבית. את הצ\'אט אני שומר עד 90 יום. הפירוט המלא כאן.';
const D3 = 'אני רוצה להתאבד'; // a child's sure distress phrase (test/distress.itest.js X3)
const noFactsOf = (id) => sql("SELECT key, value FROM facts WHERE about = 'person' AND about_id = ? AND key IN ('pregnancy', 'health')", id);
const askedAdults = () => sql("SELECT key FROM settings WHERE key IN ('ask:1', 'ask:2', 'askq:1', 'askq:2')");
const toAdults = () => sql("SELECT content FROM chat WHERE json_extract(content, '$.to') IS NOT NULL").map((r) => r.content).filter((c) => /אורית/.test(c));

let avi, michal, orit;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${PORT}`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  [avi, michal, orit] = await Promise.all(['111111', '222222', '333333'].map(async (code) => (await call(null, 'POST', '/api/pair', { code })).data.token));

  // l4
  await check('L4-1', 'ילד "תזכור שאני בהריון": בלי "לזכור?", בלי בקשה למבוגרים ובלי שמירה', async () => {
    answer = () => ({ reply: 'וואו! האם תרצי שאזכור שאת בהריון?', face: 'happy', actions: [{ kind: 'fact', about: 'אורית', key: 'pregnancy', value: 'בהריון', text: 'אורית בהריון' }] });
    const r = await say(orit, 'תזכור שאני בהריון');
    assert.doesNotMatch(r.reply, /אזכור|לזכור|שאלתי את/, r.reply); assert.equal(r.options, undefined); assert.equal(r.proposal, undefined);
    assert.deepEqual(noFactsOf(3), []); assert.deepEqual(askedAdults(), []); assert.deepEqual(toAdults(), []);
  });
  await check('L4-2', 'ילד מספר על בריאות בלי "תזכור" (health): אותו דבר', async () => {
    answer = () => ({ reply: 'אוי, זה לא נעים. האם לזכור את זה?', face: 'sad', actions: [{ kind: 'fact', about: 'אורית', key: 'health', value: 'אסתמה', text: 'לאורית יש אסתמה' }] });
    const r = await say(orit, 'יש לי אסתמה');
    assert.equal(r.reply, 'אוי, זה לא נעים.'); assert.equal(r.options, undefined);
    assert.deepEqual(noFactsOf(3), []); assert.deepEqual(askedAdults(), []); assert.deepEqual(toAdults(), []);
  });
  await check('L4-3', 'ילד: עובדה אחרת (אלרגיה) עדיין נשאלת אצל המבוגרים, כמו קודם', async () => {
    answer = () => ({ reply: 'תודה שסיפרת! האם תרצי שאזכור?', face: 'happy', actions: [{ kind: 'fact', about: 'אורית', key: 'allergy', value: 'בוטנים', text: 'אורית אלרגית לבוטנים' }] });
    const r = await say(orit, 'תזכור שאני אלרגית לבוטנים');
    assert.match(r.reply, /שאלתי את/, r.reply);
    sql("DELETE FROM settings WHERE key IN ('ask:1', 'ask:2', 'askq:1', 'askq:2')"); sql("DELETE FROM chat WHERE json_extract(content, '$.to') IS NOT NULL");
  });
  await check('L4-4', 'שאלה למבוגר שחיכתה מלפני השינוי (בריאות של ילד): גם "כן" לא שומר', async () => {
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('ask:1', ?)", JSON.stringify({ actions: [{ kind: 'fact', about: 'אורית', key: 'health', value: 'סוכרת', text: 'לאורית יש סוכרת' }], done: 'סגור, אזכור!', nope: 'בסדר, לא אזכור.' }));
    await say(avi, 'כן, תזכור');
    assert.deepEqual(noFactsOf(3), []);
    sql("DELETE FROM settings WHERE key = 'ask:1'");
  });
  await check('L4-7', 'ילד "יש לי סוכרת": בלי "האם לשים לב לזה בהצעות?" של ההוראות, וה"כן" שאחריו לא שומר ולא אומר "אשים לב"', async () => {
    answer = () => ({ reply: 'אוי, זה לא פשוט. האם לשים לב לזה בהצעות?', face: 'sad' });
    const r = await say(orit, 'יש לי סוכרת');
    assert.equal(r.reply, 'אוי, זה לא פשוט.'); assert.equal(r.options, undefined);
    answer = () => ({ reply: 'סגור, אשים לב.', face: 'happy', actions: [{ kind: 'fact', about: 'אורית', key: 'health', value: 'סוכרת', text: 'לאורית יש סוכרת' }] });
    const r2 = await say(orit, 'כן');
    assert.equal(r2.reply, 'בסדר.'); assert.deepEqual(noFactsOf(3), []); assert.deepEqual(askedAdults(), []);
  });
  await check('L4-8', 'ילד: בריאות שהמודל עשה ממנה כלל (lesson): לא מגיעה למבוגרים', async () => {
    answer = () => ({ reply: 'האם לזכור את זה?', face: 'happy', actions: [{ kind: 'lesson', text: 'אורית חולה בסוכרת' }] });
    const r = await say(orit, 'תזכור שאני חולה בסוכרת');
    assert.doesNotMatch(r.reply, /שאלתי את|לזכור/, r.reply);
    assert.deepEqual(askedAdults(), []); assert.deepEqual(toAdults(), []);
    assert.equal(sql("SELECT COUNT(*) AS n FROM lessons WHERE text LIKE '%סוכרת%'")[0].n, 0);
  });
  await check('L4-5', 'מבוגרת שאומרת "אני בהריון": כמו קודם', async () => {
    answer = () => ({ reply: 'מזל טוב!', face: 'excited', personal: true, actions: [{ kind: 'fact', about: 'מיכל', key: 'pregnancy', value: 'בהריון', text: 'מיכל בהריון' }] });
    const r = await say(michal, 'אני בהריון');
    assert.match(r.reply, /^מזל טוב! האם לשים לב לאוכל שלך בהריון\?/, r.reply);
    await say(michal, 'כן, תשים לב');
    assert.equal(noFactsOf(2).length, 1, 'her own pregnancy wasn\'t kept');
  });
  await check('L4-6', 'ילד במצוקה: כמו היום (תשובת המצוקה והסימן שלה)', async () => {
    answer = () => ({ reply: 'אני פה!', face: 'happy' });
    const r = await say(orit, D3);
    assert.ok(r.distress, JSON.stringify(r).slice(0, 300));
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'distress:3'")[0].n, 1);
    sql("DELETE FROM settings WHERE key = 'distress:3'");
  });

  // l6
  await check('L6-1', 'Workers Logs: שגיאה מהטלפון ושגיאה מהמודל נרשמות עם המספר של האדם, בלי השם', async () => {
    const from = log.length;
    assert.equal((await call(michal, 'POST', '/api/log', { where: 'legal', msg: 'בדיקה' })).status, 200);
    fail = true; answer = () => ({ reply: 'x', face: 'happy' });
    await say(michal, 'מה נשמע?');
    fail = false;
    await new Promise((r) => setTimeout(r, 300));
    const lines = log.slice(from).split('\n').filter((l) => /^(client|model) /.test(l));
    assert.ok(lines.some((l) => l.startsWith('client 2 ')), lines.join(' | ') || log.slice(from, from + 500));
    assert.ok(lines.some((l) => l.startsWith('model 2 ')), lines.join(' | '));
    assert.ok(!lines.some((l) => /מיכל/.test(l)), lines.join(' | '));
  });

  // the recording answer
  await check('R-1', 'recording: הנוסח החדש, אותו דבר לכל הצורות, עם הספק שעונה עכשיו והקישור', async () => {
    answer = () => ({ reply: 'לא.', face: 'happy', fixed: 'recording' });
    for (const t of [avi, michal]) {
      const r = await say(t, 'אתה מקליט אותנו?');
      assert.equal(r.reply, RECORDING); assert.equal(r.link, 'privacy'); assert.equal(r.face, 'neutral'); assert.equal(r.options, undefined);
    }
    const saved = JSON.parse(sql("SELECT content FROM chat WHERE role = 'shuki' ORDER BY id DESC LIMIT 1")[0].content);
    assert.equal(saved.link, 'privacy', 'the chat row has no link');
  });
  await check('R-2', 'ההוראות: חמש הדוגמאות → fixed=recording', async () => {
    const t = requests.at(-1).system[0].text;
    assert.ok(t.includes('"אתה מקליט?", "אתה שומע אותנו?", "אתה שומר את המידע הפרטי שלי?", "מה אתה עושה עם המידע שלי?", "לאן זה נשלח?": fixed=recording.'), 'the examples');
  });

  // the personal download (before Michal leaves)
  await check('D-1', 'ההורדה האישית: הצ\'אט והעובדות הפרטיות של האדם עצמו, ורק שלו', async () => {
    // her assistant's thread is hers; in her own thread, a row only for Avi, one not for her, and a card to her and Avi
    sql("INSERT INTO connectors (id, user_id, token_hash, name, created) VALUES (7, 2, 'h7', 'Claude', 0), (8, 1, 'h8', 'Claude', 0)");
    const row = (thread, c) => sql('INSERT INTO chat (ts, user_id, role, content, thread) VALUES (?, ?, ?, ?, ?)', Date.now(), c.role === 'user' ? (thread === -8 ? 1 : 2) : null, c.role, JSON.stringify(c), thread);
    row(-7, { role: 'user', text: 'שלה מהעוזר' }); row(-8, { role: 'user', text: 'שלו מהעוזר' });
    row(2, { role: 'shuki', reply: 'רק לאבי', only: 1 }); row(2, { role: 'shuki', reply: 'לא למיכל', notFor: 2 });
    row(2, { role: 'shuki', reply: 'כרטיס לשניהם', to: [1, 2] });
    const mine = (await call(michal, 'GET', '/api/export')).data;
    assert.ok(mine.my_chat.some((m) => m.role === 'user' && m.content.text === 'אני בהריון'), 'her message');
    assert.ok(mine.my_chat.every((m) => m.thread === 2 || m.thread === -7), 'another thread');
    assert.ok(!JSON.stringify(mine.my_chat).includes('אתה מקליט אותנו?') || mine.my_chat.filter((m) => m.content.text === 'אתה מקליט אותנו?').every((m) => m.user_id === 2), "Avi's message");
    assert.deepEqual(mine.my_facts.map((f) => [f.about_id, f.key]), [[2, 'pregnancy']]);
    const txt = JSON.stringify(mine.my_chat);
    assert.ok(txt.includes('שלה מהעוזר') && txt.includes('כרטיס לשניהם'), 'her assistant\'s thread or the card');
    assert.ok(!/שלו מהעוזר|רק לאבי|לא למיכל/.test(txt), 'another\'s row in her download');
    const his = (await call(avi, 'GET', '/api/export')).data;
    assert.ok(!JSON.stringify(his).includes('אני בהריון'), "her message in Avi's download");
    assert.deepEqual(his.my_facts, []);
    assert.ok(!his.facts.some((f) => f.private), 'a private fact among the house\'s facts');
    const kid = (await call(orit, 'GET', '/api/export')).data;
    assert.ok(kid.my_chat.every((m) => m.thread === 3) && kid.my_chat.some((m) => m.content.text === 'יש לי אסתמה'));
  });
  await check('D-2', 'הגיבוי של הבית: בלי צ\'אט ובלי עובדות פרטיות, כמו קודם', async () => {
    assert.equal((await call(avi, 'POST', '/api/__schedule', { now: Date.now() })).status, 200);
    const day = sql("SELECT day FROM backups WHERE day NOT LIKE 'before:%' ORDER BY created DESC LIMIT 1")[0].day;
    const bk = JSON.parse(sql('SELECT data FROM backups WHERE day = ? ORDER BY part', day).map((r) => r.data).join(''));
    assert.equal(bk.my_chat, undefined); assert.equal(bk.my_facts, undefined); assert.equal(bk.chat, undefined);
    assert.ok(!bk.facts.some((f) => f.private)); assert.ok(!JSON.stringify(bk).includes('אני בהריון'));
  });

  // leaving by oneself
  await check('E-1', 'מי שלא מנהל לא מוציא אחר; המנהל היחיד לא יוצא (המילים הקיימות)', async () => {
    assert.equal((await call(michal, 'POST', '/api/members', { id: 3, remove: true })).status, 403);
    const r = await call(avi, 'POST', '/api/members', { id: 1, remove: true });
    assert.equal(r.status, 400); assert.equal(r.data.error, 'אי אפשר להוציא את המנהל היחיד. קודם מעבירים ניהול למישהו אחר');
  });
  await check('E-2', 'מיכל יוצאת בעצמה: הטלפון מתנתק, הצ\'אט, הפרטי ומה שלמדתי עליה נמחקים, והכרטיס על הדברים שלה הולך למנהל', async () => {
    sql("INSERT INTO products (name, count_type, qty, owner, created, updated) VALUES ('שמפו של מיכל', 'units', 1, 2, 0, 0)");
    const r = await call(michal, 'POST', '/api/members', { id: 2, remove: true });
    assert.equal(r.status, 200, r.text); assert.equal(r.data.self, true); assert.equal(r.data.card, true);
    assert.equal((await call(michal, 'GET', '/api/state')).status, 401);
    assert.equal(sql('SELECT active FROM users WHERE id = 2')[0].active, 0);
    assert.equal(sql('SELECT COUNT(*) AS n FROM chat WHERE thread = 2')[0].n, 0);
    assert.equal(sql("SELECT COUNT(*) AS n FROM facts WHERE about = 'person' AND about_id = 2")[0].n, 0);
    const card = sql("SELECT user_id, actions FROM proposals WHERE actions LIKE '%\"share\":2%'");
    assert.equal(card.length, 1); assert.equal(card[0].user_id, 1);
    assert.ok(sql("SELECT content FROM chat WHERE thread = 1 ORDER BY id DESC LIMIT 1").some((x) => /מיכל יצאה מהבית/.test(x.content)), 'Avi has no card');
  });
  await check('E-3', 'מי שמצטרף אחר כך בשם מיכל: מספר חדש', async () => {
    const a = await call(avi, 'POST', '/api/members', { add: { name: 'מיכל', gender: 'f' } });
    assert.equal(a.status, 200, a.text); assert.notEqual(a.data.id, 2);
  });
} finally {
  const n = results.filter((r) => r.ok).length;
  console.log(`\n${n}/${results.length} checks passed`);
  srv.kill(); mock.close();
  process.exit(n === results.length && results.length ? 0 : 1);
}
