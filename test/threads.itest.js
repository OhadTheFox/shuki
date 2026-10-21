// Stage 0b, part 2: a chat for each person (docs/stage0-0b-proposal.md §2), on the Node server with a fake model.
// It starts from a house before 0017 with a shared chat of every shape the code writes. Each check fails on the code
// before 0b part 2. Run: node --disable-warning=ExperimentalWarning test/threads.itest.js
import './fetch-retry.js';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, readdirSync, readFileSync, copyFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DIR = '/tmp/shuki-test/shuki-threads'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const PORT = 8777, MOCK = 8778;
const NOW = Date.now(), OLD = NOW - 3 * 86400e3; // older than a day: not a "recent tell"

const db = new DatabaseSync(`${DIR}/shuki.db`);
db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql') && x < '0017').sort()) { db.exec(readFileSync(`migrations/${f}`, 'utf8')); db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f); }
db.exec(readFileSync('test/fixture-house.sql', 'utf8'));
db.exec("INSERT INTO users (id, name, gender, role, active, created) VALUES (3, 'יואבי', 'm', 'child', 1, 0), (4, 'דנה', 'f', 'member', 0, 0)");
db.exec("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999), ('222222', 2, 9999999999999), ('333333', 3, 9999999999999)");
db.exec(`INSERT INTO products (id, name, count_type, qty, created, updated) VALUES (7, 'חלב', 'units', 2, 1, 1)`);
const row = (ts, uid, role, c) => db.prepare('INSERT INTO chat (ts, user_id, role, content) VALUES (?,?,?,?)').run(ts, uid, role, JSON.stringify(c));
// the shared chat, before 0017
row(OLD, 1, 'user', { text: 'שלום מאבי' });
row(OLD + 1, null, 'shuki', { reply: 'תשובה לאבי', face: 'happy', for: 1 });
row(OLD + 2, 2, 'user', { text: 'סוד של מיכל: מתנה לאבי' });
row(OLD + 3, null, 'shuki', { reply: 'תשובה למיכל', face: 'happy', for: 2 });
row(OLD + 4, null, 'shuki', { reply: 'רק למיכל', face: 'happy', for: 2, only: 2 });
row(OLD + 5, null, 'shuki', { reply: 'יואבי ביקש במבה. האם לאשר?', face: 'happy', proposal: { id: 'p-kid', lines: [{ text: 'להוסיף במבה לרשימה?' }] }, status: 'pending', to: [1, 2], for: 3, notFor: 3 });
row(OLD + 6, null, 'shuki', { reply: 'אבי ויואבי, מיכל ביקשה שאגיד לכם: אני מאחרת', face: 'excited', to: [1, 3], for: 2 });
row(OLD + 7, null, 'shuki', { reply: 'איזה כיף שעברתם לבית חדש!', face: 'excited' });
row(OLD + 8, 3, 'user', { text: 'שלום מיואבי' });
row(OLD + 9, null, 'shuki', { reply: 'תשובה ליואבי', face: 'happy', for: 3 });
row(OLD + 10, 4, 'user', { text: 'הודעה של דנה שעזבה' });
row(OLD + 11, null, 'shuki', { reply: 'תשובה לדנה', face: 'happy', for: 4 });
// the card to the grown-ups about a child's request is the grown-ups' (the code writes it with a grown-up as its owner, and `approve` lines)
db.exec("INSERT INTO list_items (id, product_id, text, store, source, status, added_by, added, approved) VALUES (90, NULL, 'במבה', 'super', 'manual', 'open', 3, 1, 0)");
db.exec(`INSERT INTO proposals (id, user_id, created, actions) VALUES ('p-kid', 1, ${NOW}, '${JSON.stringify({ actions: [{ kind: 'approve', item_id: 90, yes: true }], context: 'report' })}')`);
db.close();
copyFileSync(`${DIR}/shuki.db`, `${DIR}/before-0017.db`);

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
const shown = async (t) => JSON.stringify((await call(t, 'GET', '/api/chat')).data.messages || []);

let avi, michal, yoavi;
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  [avi, michal, yoavi] = await Promise.all(['111111', '222222', '333333'].map(async (code) => (await call(null, 'POST', '/api/pair', { code })).data.token));

  await check('T1', 'מיגרציה 0017: כל שורה ל-thread הנכון, עותק לכל נמען, מי שעזב נמחק; כלי הבדיקה על עותק אומר ok', async () => {
    assert.match(log, /migration 0017_threads\.sql/);
    const th = (re) => sql('SELECT thread FROM chat WHERE content LIKE ? ORDER BY thread', `%${re}%`).map((r) => r.thread);
    assert.deepEqual(th('שלום מאבי'), [1]); assert.deepEqual(th('תשובה לאבי'), [1]);
    assert.deepEqual(th('סוד של מיכל'), [2]); assert.deepEqual(th('רק למיכל'), [2]);
    assert.deepEqual(th('יואבי ביקש במבה'), [1, 2], 'the card to the parents, a copy each, not the child');
    assert.deepEqual(th('מיכל ביקשה שאגיד'), [1, 3], 'a tell to two: a copy each');
    assert.deepEqual(th('שעברתם לבית חדש'), [null], 'a house message');
    assert.deepEqual(th('דנה'), [], 'whoever left: gone');
    const tool = execFileSync('node', ['--disable-warning=ExperimentalWarning', 'tools/migrate-chat-check.mjs', `${DIR}/before-0017.db`], { encoding: 'utf8' });
    assert.match(tool, /ok: every row has its thread/); assert.match(tool, /before: 12 rows · copies for several recipients: \+2/);
  });

  await check('T2', 'מה כל אחד רואה: אבי לא רואה את מה שמיכל כתבה ומה שנאמר רק לה; מיכל לא רואה את של אבי; הורה רואה את של הילד', async () => {
    const a = await shown(avi), m = await shown(michal);
    assert.doesNotMatch(a, /סוד של מיכל|תשובה למיכל|רק למיכל/); assert.match(a, /שלום מאבי/); assert.match(a, /שלום מיואבי/, 'a parent sees the child\'s chat');
    // (the tell Michal sent to Yoavi she sees through his chat, as a parent: that's the child's chat)
    assert.doesNotMatch(m, /שלום מאבי|תשובה לאבי/); assert.match(m, /יואבי ביקש במבה/);
  });

  await check('T3', 'ההיסטוריה שהמודל מקבל בשם אבי: בלי שום דבר מהצ\'אט של מיכל (ממצא 0ג, #33); ורק מהיום (r0t d147)', async () => {
    await say(avi, 'מה נשמע?');
    let h = JSON.stringify(requests.at(-1).messages);
    assert.doesNotMatch(h, /שלום מאבי|סוד של מיכל|מתנה לאבי|רק למיכל|תשובה למיכל/, 'three days ago: not today (d147)');
    // the same rows as if just written (after the hello and the first question, so they're among the last 12): Avi's own come, Michal's still don't
    const shift = Date.now() - 20 - OLD;
    sql('UPDATE chat SET ts = ts + ? WHERE ts BETWEEN ? AND ?', shift, OLD, OLD + 11);
    try {
      await say(avi, 'מה נשמע?');
      h = JSON.stringify(requests.at(-1).messages);
      assert.doesNotMatch(h, /סוד של מיכל|מתנה לאבי|רק למיכל|תשובה למיכל/); assert.match(h, /שלום מאבי/);
    } finally { sql('UPDATE chat SET ts = ts - ? WHERE ts BETWEEN ? AND ?', shift, OLD + shift, OLD + shift + 11); }
  });

  await check('T4', '"מה מיכל אמרה לך?": הנוסח המאושר בלי מודל ("תצטרך"/"תצטרכי"; לילד "את אבא")', async () => {
    const n = requests.length;
    assert.equal((await say(avi, 'מה מיכל אמרה לך?')).reply, 'את זה תצטרך לשאול את מיכל.');
    assert.equal((await say(michal, 'מה אבי אמר לך')).reply, 'את זה תצטרכי לשאול את אבי.');
    assert.equal((await say(yoavi, 'מה אבא אמר לך?')).reply, 'את זה תצטרך לשאול את אבא.');
    assert.equal(requests.length, n, 'the model was asked');
    // a question about the list is not that question
    await say(avi, 'מה מיכל אמרה לך להוסיף לרשימה?');
    assert.equal(requests.length, n + 1);
  });

  await check('T5', '"תגיד למיכל…": מגיע רק לצ\'אט של מיכל; ההודעה של אבי נשארת אצלו; ואז "מה אבי אמר לך?" הולך למודל (יש הודעה אמיתית)', async () => {
    answer = () => ({ reply: 'אמסור למיכל.', face: 'happy', actions: [{ kind: 'tell', to: 'מיכל', text: 'אני מאחר' }] });
    const r = await say(avi, 'תגיד למיכל שאני מאחר');
    assert.ok(r.proposal, JSON.stringify(r));
    await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    const m = await shown(michal), a = await shown(avi);
    assert.match(m, /מיכל, אבי ביקש שאגיד לך: אני מאחר/); assert.doesNotMatch(m, /תגיד למיכל שאני מאחר/);
    assert.doesNotMatch(a, /מיכל, אבי ביקש שאגיד לך/);
    const n = requests.length; answer = () => ({ reply: 'הוא מאחר.', face: 'happy' });
    await say(michal, 'מה אבי אמר לך?');
    assert.equal(requests.length, n + 1, 'with a real message from Avi, it goes to the model');
  });

  await check('T6', 'מגבלה: עד 5 הודעות אישיות ביום לשולח; "לכולם" נספר כאחת; בשישית הנוסח המאושר ובלי כרטיס', async () => {
    const tell = (to) => () => ({ reply: 'אמסור.', face: 'happy', actions: [{ kind: 'tell', ...(to && { to }), text: 'הודעה' }] });
    for (let i = 0; i < 4; i++) { answer = tell(i === 0 ? null : 'אבי'); const r = await say(michal, 'תגיד'); assert.ok(r.proposal, `tell ${i + 1}`); await call(michal, 'POST', `/api/proposals/${r.proposal.id}/apply`, {}); }
    answer = tell('אבי'); let r = await say(michal, 'תגיד'); assert.ok(r.proposal, 'the 5th'); await call(michal, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    r = await say(michal, 'תגיד');
    assert.equal(r.reply, 'יש לי מגבלה של עד 5 הודעות לאדם ליום.'); assert.equal(r.proposal, undefined);
  });

  await check('T7', 'כרטיס שהגיע לשני ההורים: אבי מאשר, והסטטוס מתעדכן בשני העותקים', async () => {
    await call(avi, 'POST', '/api/proposals/p-kid/apply', {});
    const st = sql("SELECT thread, json_extract(content, '$.status') AS s FROM chat WHERE content LIKE '%p-kid%' ORDER BY thread").map((x) => `${x.thread}:${x.s}`);
    assert.deepEqual(st, ['1:applied', '2:applied']);
  });

  await check('T8', 'הילד יודע מי רואה (D9); הורה מכבה לילד הזה, ואז רק הוא לא רואה (b01, לכל מבוגר, 05/10); כשאף אחד לא רואה, השורה יורדת', async () => {
    assert.match(await shown(yoavi), /אבא ואמא יכולים לראות את השיחה שלנו\./);
    assert.equal((await call(avi, 'POST', '/api/child-chat', { id: 3, see: false })).status, 200);
    assert.doesNotMatch(await shown(avi), /שלום מיואבי/);
    assert.match(await shown(michal), /שלום מיואבי/, 'Avi turned it off for Michal too');
    assert.equal(sql("SELECT value FROM settings WHERE key = 'child_chat:1:3'")[0]?.value, '0');
    assert.equal((await call(avi, 'GET', '/api/state')).data.settings['child_chat:1:3'], '0', 'Avi doesn\'t get his own choice');
    for (const t of [michal, yoavi]) assert.ok(!('child_chat:1:3' in (await call(t, 'GET', '/api/state')).data.settings), 'Avi\'s choice reaches someone else (b01 reviewer)');
    const d9 = async () => (await call(yoavi, 'GET', '/api/chat')).data.messages.find((m) => m.content.fixed === 'parents_see')?.content.reply;
    assert.equal(await d9(), 'אמא יכולה לראות את השיחה שלנו.', 'D9 says only who really sees');
    await call(michal, 'POST', '/api/child-chat', { id: 3, see: false });
    assert.equal(await d9(), undefined, 'nobody sees: no D9');
    assert.equal((await call(yoavi, 'POST', '/api/child-chat', { id: 3, see: true })).status, 403, 'a child can\'t turn it on');
    await call(michal, 'POST', '/api/child-chat', { id: 3, see: true }); await call(avi, 'POST', '/api/child-chat', { id: 3, see: true });
    assert.equal(await d9(), 'אבא ואמא יכולים לראות את השיחה שלנו.');
  });

  await check('T9', 'שורה אפורה: הפעולה של מיכל מופיעה אצל אבי בנוסח של היומן (D7ב), ולא אצל מיכל עצמה', async () => {
    await call(michal, 'POST', '/api/actions', { actions: [{ kind: 'op', product_id: 7, op: { type: 'out' } }] });
    const summary = sql("SELECT summary FROM events WHERE user_id = 2 ORDER BY ts DESC LIMIT 1")[0].summary;
    const a = (await call(avi, 'GET', '/api/chat')).data.messages, m = (await call(michal, 'GET', '/api/chat')).data.messages;
    assert.ok(a.some((x) => x.role === 'event' && x.content.gray === summary), `no gray line "${summary}" for Avi`);
    assert.ok(!m.some((x) => x.role === 'event' && x.content.gray === summary), 'Michal sees her own as a gray line');
  });

  await check('T10', 'עוזר מחובר: רק ההודעה עצמה, בלי היסטוריה; השורות שלו ב-thread שלו, לא בצ\'אט של אבי', async () => {
    const conn = (await call(avi, 'POST', '/api/connectors', { name: 'Claude' })).data.path;
    answer = () => ({ reply: 'יש חלב.', face: 'happy' });
    await call(null, 'POST', conn, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ask_shuki', arguments: { message: 'יש חלב בבית?' } } });
    assert.equal(requests.at(-1).messages.length, 1, 'history went to the assistant');
    assert.doesNotMatch(await shown(avi), /יש חלב בבית/);
    assert.ok(sql("SELECT thread FROM chat WHERE content LIKE '%יש חלב בבית%'").every((r) => r.thread < 0));
  });

  await check('T11', '"כן" של מיכל לא מאשר שאלה "להוסיף… לרשימה?" שנשאלה בצ\'אט של אבי', async () => {
    sql("INSERT INTO chat (ts, user_id, role, content, thread) VALUES (?, NULL, 'shuki', ?, 1)", Date.now() - 1, JSON.stringify({ reply: 'להוסיף חלב לרשימה?', face: 'happy', for: 1 }));
    answer = () => ({ reply: 'להוסיף חלב לרשימה?', face: 'happy', actions: [{ kind: 'list_add', product_id: 7 }] });
    const r = await say(michal, 'כן');
    assert.ok(r.proposal, 'it was applied without a card, from someone else\'s question');
  });

  await check('T13', 'עוזר מחובר שמביא כרטיס: השאלה שלו ב-thread שלו, והכרטיס בצ\'אט של אבי, שם אפשר לאשר אותו', async () => {
    const conn = (await call(avi, 'POST', '/api/connectors', { name: 'Siri' })).data.path;
    answer = () => ({ reply: 'להוסיף מגבונים לרשימה?', face: 'happy', actions: [{ kind: 'list_add', text: 'מגבונים' }] });
    await call(null, 'POST', conn, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ask_shuki', arguments: { message: 'תוסיף מגבונים' } } });
    const a = (await call(avi, 'GET', '/api/chat')).data.messages;
    assert.ok(a.some((m) => m.content.proposal && /מגבונים/.test(JSON.stringify(m.content.proposal))), 'the card is not in Avi\'s chat');
    assert.ok(!a.some((m) => m.content.text === 'תוסיף מגבונים'), 'the assistant\'s message is in Avi\'s chat');
  });
  await check('T14', '👎 של אבי על שורה מהצ\'אט של מיכל: נדחה, ושום דבר ממנה לא מועתק', async () => {
    const id = sql("SELECT id FROM chat WHERE thread = 2 AND role = 'shuki' ORDER BY id DESC LIMIT 1")[0].id;
    const r = await call(avi, 'POST', '/api/feedback', { chat_id: id, note: 'לא' });
    assert.notEqual(r.status, 200, JSON.stringify(r.data));
    assert.equal(sql('SELECT COUNT(*) AS n FROM feedback')[0].n, 0);
  });
  await check('T15', 'מגבלה בזמן האישור: כרטיסים שכבר נוצרו לא עוברים את 5; השישי לא מתבצע, והנוסח המאושר חוזר', async () => {
    const cards = [];
    for (let i = 0; i < 5; i++) { answer = () => ({ reply: 'אמסור.', face: 'happy', actions: [{ kind: 'tell', to: 'מיכל', text: `כרטיס ${i}` }] }); cards.push((await say(avi, 'תגיד למיכל')).proposal.id); }
    const res = []; for (const id of cards) res.push((await call(avi, 'POST', `/api/proposals/${id}/apply`, {})).data);
    // Avi sent one in T5: four more pass, the fifth card would be the sixth
    assert.equal(res.filter((r) => r.status === 'applied').length, 4, JSON.stringify(res));
    assert.equal(res.at(-1).error, 'יש לי מגבלה של עד 5 הודעות לאדם ליום.');
    assert.doesNotMatch(await shown(michal), /כרטיס 4/);
  });
  await check('T16', 'שחזור יום לא מחזיר את הצפייה בצ\'אט של ילד שהורה כיבה', async () => {
    await call(avi, 'POST', '/api/__schedule', { now: Date.now() }); // today's copy (child_chat:3 is on in it)
    const day = (await call(avi, 'GET', '/api/backups')).data.backups[0]?.day;
    await call(avi, 'POST', '/api/child-chat', { id: 3, see: false });
    assert.equal((await call(avi, 'POST', '/api/backups/restore', { day })).status, 200);
    assert.equal(sql("SELECT value FROM settings WHERE key = 'child_chat:1:3'")[0]?.value, '0');
    await call(avi, 'POST', '/api/child-chat', { id: 3, see: true });
  });
  await check('T17', 'כרטיס "תגיד ל…" של ילד: ההורה לא מאשר ולא מבטל אותו (r0t k2) ("את זה רק יואבי יכול לאשר.", 02/10); הילד מאשר, וההודעה בשמו ונספרת לו', async () => {
    const day = (k) => sql("SELECT value FROM settings WHERE key LIKE ?", `tells:${k}:%`)[0]?.value;
    const aviBefore = Number(day(1) || 0);
    answer = () => ({ reply: 'אמסור.', face: 'happy', actions: [{ kind: 'tell', to: 'מיכל', text: 'אני אצל חבר' }] });
    const r = await say(yoavi, 'תגיד למיכל שאני אצל חבר');
    assert.ok(r.proposal, 'a card');
    const a = await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    assert.equal(a.data.error, 'את זה רק יואבי יכול לאשר.', JSON.stringify(a.data));
    // r0t k2: turning it down is the writer's too, with the same exceptions
    const no = await call(avi, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
    assert.equal(no.data.error, 'את זה רק יואבי יכול לבטל.', JSON.stringify(no.data));
    assert.equal(sql('SELECT status FROM proposals WHERE id = ?', r.proposal.id)[0].status, 'pending', 'a parent turned the child\'s card down');
    assert.equal(sql("SELECT COUNT(*) AS n FROM chat WHERE content LIKE '%אני אצל חבר%' AND json_extract(content, '$.tell') = 1")[0].n, 0, 'sent on the parent\'s approval');
    assert.equal((await call(yoavi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {})).status, 200);
    const row = sql("SELECT content FROM chat WHERE thread = 2 AND content LIKE '%אני אצל חבר%'").map((x) => JSON.parse(x.content));
    assert.equal(row.length, 1, 'one row, in Michal\'s chat');
    assert.equal(row[0].reply, 'מיכל, יואבי ביקש שאגיד לך: אני אצל חבר');
    assert.equal(Number(day(3) || 0), 1, 'counted for the child');
    assert.equal(Number(day(1) || 0), aviBefore, 'not for the parent');
    // "to everyone": everyone but the child who wrote it
    answer = () => ({ reply: 'אמסור.', face: 'happy', actions: [{ kind: 'tell', text: 'אני חוזר בשש' }] });
    const r2 = await say(yoavi, 'תגיד לכולם שאני חוזר בשש');
    assert.equal((await call(yoavi, 'POST', `/api/proposals/${r2.proposal.id}/apply`, {})).status, 200);
    const to = sql("SELECT thread FROM chat WHERE role = 'shuki' AND json_extract(content, '$.tell') = 1 AND content LIKE '%אני חוזר בשש%' ORDER BY thread").map((x) => x.thread);
    assert.deepEqual(to, [1, 2], 'Avi and Michal, not Yoavi');
    // Michal's card: Avi can't approve it either ("יכולה")
    answer = () => ({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'list_add', text: 'פתיתים' }] });
    const r3 = await say(michal, 'צריך פתיתים');
    assert.equal((await call(avi, 'POST', `/api/proposals/${r3.proposal.id}/apply`, {})).data.error, 'את זה רק מיכל יכולה לאשר.');
    assert.equal((await call(avi, 'POST', `/api/proposals/${r3.proposal.id}/reject`, {})).data.error, 'את זה רק מיכל יכולה לבטל.');
    assert.equal((await call(michal, 'POST', `/api/proposals/${r3.proposal.id}/reject`, {})).status, 200, 'the writer turns it down');
  });
  await check('T18', 'D9 עם שני הורים מאותו מין (02/10): "אבא ואבא יכולים…" / "אמא ואמא יכולות…"', async () => {
    const line = async () => (await call(yoavi, 'GET', '/api/chat')).data.messages.find((m) => m.content.fixed === 'parents_see')?.content.reply;
    assert.equal(await line(), 'אבא ואמא יכולים לראות את השיחה שלנו.');
    sql("UPDATE users SET gender = 'm' WHERE id = 2");
    assert.equal(await line(), 'אבא ואבא יכולים לראות את השיחה שלנו.');
    sql("UPDATE users SET gender = 'f' WHERE id IN (1, 2)");
    assert.equal(await line(), 'אמא ואמא יכולות לראות את השיחה שלנו.');
    sql("UPDATE users SET gender = 'm' WHERE id = 1");
    // ש9 (the owner 05/10): three grown-ups or more, "ההורים"
    sql("INSERT INTO users (id, name, gender, role, active, created) VALUES (6, 'סבתא', 'f', 'member', 1, 0)");
    assert.equal(await line(), 'ההורים יכולים לראות את השיחה שלנו.');
    sql('DELETE FROM users WHERE id = 6');
  });
  await check('T19', 'שורה אפורה בצ\'אט של ילד (q08, 02/10, 05/10): "אמא סימנה…"; שני מבוגרים מאותו מין: "אמא מיכל סימנה…"; אח או אחות בשם; ההורה עצמו רואה בשם', async () => {
    await call(michal, 'POST', '/api/actions', { actions: [{ kind: 'op', product_id: 7, op: { type: 'low' } }] });
    const summary = sql("SELECT summary FROM events WHERE user_id = 2 ORDER BY ts DESC, id DESC LIMIT 1")[0].summary;
    assert.ok(summary.startsWith('מיכל '), summary);
    const grays = async (t) => (await call(t, 'GET', '/api/chat')).data.messages.filter((x) => x.role === 'event').map((x) => x.content.gray);
    assert.ok((await grays(yoavi)).includes(`אמא${summary.slice('מיכל'.length)}`), `not "אמא…" for Yoavi: ${JSON.stringify(await grays(yoavi))}`);
    assert.ok(!(await grays(yoavi)).some((g) => g.includes('מיכל')), 'her name in the child\'s chat');
    assert.ok((await grays(avi)).includes(summary), 'Avi doesn\'t see her name');
    sql("UPDATE users SET gender = 'f' WHERE id = 1");
    assert.ok((await grays(yoavi)).includes(`אמא מיכל${summary.slice('מיכל'.length)}`), `two mothers: ${JSON.stringify(await grays(yoavi))}`);
    sql("UPDATE users SET gender = 'm' WHERE id = 1");
    sql("INSERT INTO users (id, name, gender, role, active, created) VALUES (5, 'אורית', 'f', 'child', 1, 0)");
    sql("INSERT INTO events (ts, user_id, type, summary) VALUES (?, 5, 'out', 'אורית סימנה שנגמרה הגבינה')", Date.now());
    assert.ok((await grays(yoavi)).includes('אורית סימנה שנגמרה הגבינה'), 'a sister keeps her name');
    sql("INSERT INTO events (ts, user_id, type, summary) VALUES (?, 1, 'lesson', 'אורית לימדה אותי: בלי בוטנים (אבא אישר)')", Date.now());
    assert.ok((await grays(yoavi)).includes('אורית לימדה אותי: בלי בוטנים (אבא אישר)'), 'a line that starts with another name changed');
    sql('DELETE FROM events WHERE user_id = 5 OR summary LIKE \'אורית%\''); sql('DELETE FROM users WHERE id = 5');
  });
  await check('T20', 'הודעה "תגיד ל…" לאבי ולילד שהוא רואה: אצל אבי היא בצ\'אט שלו, לא רק בלשונית של הילד (stage 5, הבודק)', async () => {
    const tell = (await call(avi, 'GET', '/api/chat')).data.messages.filter((m) => /מיכל ביקשה שאגיד לכם: אני מאחרת/.test(m.content.reply || ''));
    assert.ok(tell.length === 1 && tell[0].thread === 1, JSON.stringify(tell.map((m) => m.thread)));
  });
  await check('T21', '"לא לשאול" של אבי לא מגיע ב-state למיכל; אצל אבי כן (the owner 05/10)', async () => {
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 1, 'no_ask', 'ללמוד', 0, 1, 1, 0, 'chat', 0, 0)");
    const of = async (t) => (await call(t, 'GET', '/api/state')).data.facts.filter((f) => f.key === 'no_ask' && f.about_id === 1).length;
    assert.equal(await of(avi), 1, 'not at Avi\'s');
    assert.equal(await of(michal), 0, 'at Michal\'s');
    sql("DELETE FROM facts WHERE key = 'no_ask' AND about_id = 1");
  });
  // פ9 (r12 q012, ✎; the wider words approved in r7b, 06/10): a server path, no model, no look in the inventory
  await check('T22', '"מי אכל את השוקולד?": הנוסח של the owner מילה במילה, בלי מודל, ובצ\'אט של אבי בלבד', async () => {
    const n = requests.length;
    assert.equal((await say(avi, 'מי אכל את השוקולד?')).reply, 'אני לא יכול להגיד לך מי אכל את השוקולד. אני יכול להגיד מי עדכן שהשוקולד נגמר.');
    assert.equal(requests.length, n, 'the model was asked');
    const mine = JSON.stringify((await call(avi, 'GET', '/api/chat')).data.messages);
    assert.ok(mine.includes('מי אכל את השוקולד?') && mine.includes('מי עדכן שהשוקולד נגמר'), 'not in Avi\'s chat');
    assert.ok(!JSON.stringify((await call(michal, 'GET', '/api/chat')).data.messages).includes('השוקולד'), 'in Michal\'s chat');
  });
  await check('T23', '"מי שתה את הקולה?" ו"מי גמרה לי את הבמבות": הפועל בזכר יחיד מאותו שורש, ו"נגמר" לפי המוצר', async () => {
    const n = requests.length;
    assert.equal((await say(michal, 'מי שתה את הקולה?')).reply, 'אני לא יכול להגיד לך מי שתה את הקולה. אני יכול להגיד מי עדכן שהקולה נגמרה.');
    assert.equal((await say(michal, 'מי גמרה לי את הבמבות')).reply, 'אני לא יכול להגיד לך מי גמר את הבמבות. אני יכול להגיד מי עדכן שהבמבות נגמרו.');
    assert.equal(requests.length, n, 'the model was asked');
    await say(michal, 'מה אכלנו אתמול?'); // not "מי…": the model's
    assert.equal(requests.length, n + 1);
    // the product is one word (question 94): anything more goes to the model
    await say(michal, 'מי אכל את השוקולד ומה נשאר?');
    await say(michal, 'מי אכל את השוקולד אתמול?');
    assert.equal(requests.length, n + 3, 'the server answered a longer question');
    assert.equal((await say(michal, 'מי אכל את השוקולד?')).reply, 'אני לא יכול להגיד לך מי אכל את השוקולד. אני יכול להגיד מי עדכן שהשוקולד נגמר.');
    assert.equal(requests.length, n + 3, 'the model was asked');
    // a period or "!" ends the product too (the reviewer): not "השוקולד.." / "שהשוקולד. נגמר."
    for (const t of ['מי אכל את השוקולד.', 'מי אכל את השוקולד!', 'מי אכל את השוקולד?!']) assert.equal((await say(michal, t)).reply, 'אני לא יכול להגיד לך מי אכל את השוקולד. אני יכול להגיד מי עדכן שהשוקולד נגמר.', t);
    assert.equal(requests.length, n + 3, 'the model was asked');
  });
  // פ14 ב, decision 5 (the owner 06/10, r7b): "יאשרו" and "צריכים לעשות" by the grown-ups in the house; Dana isn't active
  const kidAdds = async () => { answer = () => ({ reply: 'אוקיי.', face: 'happy', actions: [{ kind: 'list_add', text: 'שוקולד' }] }); return (await say(yoavi, 'תוסיף שוקולד')).reply; };
  // "צריכים לעשות" is said only when no grown-up is active (a delete of a product that isn't there is dropped before; question 95)
  const kidDeletes = async () => { answer = () => ({ reply: 'אוקיי.', face: 'happy', actions: [{ kind: 'delete', product_id: 7 }] }); return (await say(yoavi, 'תמחק את החלב')).reply; };
  await check('T25', 'אב ואם: "יאשרו" כמו היום, מילה במילה; בלי מבוגר פעיל, "צריכים לעשות" כמו היום', async () => {
    assert.equal(await kidAdds(), 'שמתי שוקולד ברשימה! אבא או אמא יאשרו את זה ואז נקנה אותו.');
    sql('UPDATE users SET active = 0 WHERE id IN (1, 2)');
    try { assert.equal(await kidDeletes(), 'את זה אבא או אמא צריכים לעשות. אני אשמח לעזור בכל דבר אחר!'); }
    finally { sql('UPDATE users SET active = 1 WHERE id IN (1, 2)'); }
  });
  await check('T26', 'שני אבות (מיכל היא דני): "אבא אבי או אבא דני יאשרו"', async () => {
    sql("UPDATE users SET name = 'דני', gender = 'm' WHERE id = 2");
    try {
      assert.equal(await kidAdds(), 'שמתי שוקולד ברשימה! אבא אבי או אבא דני יאשרו את זה ואז נקנה אותו.');
    } finally { sql("UPDATE users SET name = 'מיכל', gender = 'f' WHERE id = 2"); }
  });
  await check('T27', 'שתי אמהות (אבי היא תמר), לפי id: "אמא תמר או אמא מיכל יאשרו"', async () => {
    sql("UPDATE users SET name = 'תמר', gender = 'f' WHERE id = 1");
    try {
      assert.equal(await kidAdds(), 'שמתי שוקולד ברשימה! אמא תמר או אמא מיכל יאשרו את זה ואז נקנה אותו.');
    } finally { sql("UPDATE users SET name = 'אבי', gender = 'm' WHERE id = 1"); }
  });
  await check('T28', '3 מבוגרים (דנה פעילה): "אחד ההורים יאשר"', async () => {
    sql('UPDATE users SET active = 1 WHERE id = 4');
    try {
      assert.equal(await kidAdds(), 'שמתי שוקולד ברשימה! אחד ההורים יאשר את זה ואז נקנה אותו.');
    } finally { sql('UPDATE users SET active = 0 WHERE id = 4'); }
  });
  await check('T29', 'הורה אחד (מיכל לא פעילה): השם, "אבי יאשר"', async () => {
    sql('UPDATE users SET active = 0 WHERE id = 2');
    try {
      assert.equal(await kidAdds(), 'שמתי שוקולד ברשימה! אבי יאשר את זה ואז נקנה אותו.');
    } finally { sql('UPDATE users SET active = 1 WHERE id = 2'); }
  });
  await check('T12', 'מי שעוזב: הצ\'אט שלו נמחק', async () => {
    assert.ok(sql('SELECT COUNT(*) AS n FROM chat WHERE thread = 2')[0].n > 0);
    assert.equal((await call(avi, 'POST', '/api/members', { id: 2, remove: true })).status, 200);
    assert.equal(sql('SELECT COUNT(*) AS n FROM chat WHERE thread = 2')[0].n, 0);
  });
} finally {
  srv.kill(); mock.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} thread checks passed`);
if (failed.length) { console.log(log.split('\n').filter((l) => /error|Error/.test(l)).slice(-8).join('\n')); process.exit(1); }
