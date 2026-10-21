// Stage 0b, part 5: limits and permissions in the server (docs/stage0-0b-proposal.md §5), on the Node server with a
// fake model. Who may delete (D15), a child's 30 a day (D13), "די לשאול" (D12, D12ב), one "want me to remember?" a day,
// "תזכור ש…" says what (D10), two pushes a day, one card from the server at a time, gone after a day, "בינינו, די לשאול"
// kept as hers alone (פ21), and "אל תיתן לה להוסיף" in the owner's words (פ23).
// Run: node --disable-warning=ExperimentalWarning test/limits.itest.js
import './fetch-retry.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DIR = '/tmp/shuki-test/shuki-limits'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const PORT = 8785, MOCK = 8786;

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
const act = (t, actions) => call(t, 'POST', '/api/actions', { actions });
// a time in the house's zone (Asia/Jerusalem): a date "YYYY-MM-DD" at `hour`:05
const zoneHour = (ts) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }).format(ts));
const at = (date, hour) => { let ts = Date.parse(`${date}T${String(hour).padStart(2, '0')}:05:00Z`); ts -= (zoneHour(ts) - hour) * 3600e3; return ts; };
const day = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(ts); // YYYY-MM-DD

let avi, michal, yoavi, dana;
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  [avi, michal, yoavi, dana] = await Promise.all(['111111', '222222', '333333', '444444'].map(async (code) => (await call(null, 'POST', '/api/pair', { code })).data.token));
  sql(`UPDATE devices SET push_sub = '{"endpoint":"http://127.0.0.1:${MOCK}/push","keys":{"p256dh":"x","auth":"y"}}', push_on = 1`);

  await check('L1', 'מחיקה (r10 q015, D15): של מיכל רק מיכל או המנהל; משותף כל מבוגר; כשהבעלים הוא המנהל, רק הוא', async () => {
    let r = await act(dana, [{ kind: 'delete', product_id: 8 }]);
    assert.equal(r.data.error, 'את המוצר הזה רק מיכל או אבי יכולים למחוק.', JSON.stringify(r.data));
    r = await act(dana, [{ kind: 'delete', product_id: 9 }]);
    assert.equal(r.data.error, 'את המוצר הזה רק אבי יכול למחוק.', JSON.stringify(r.data));
    r = await act(dana, [{ kind: 'edit', product_id: 9, fields: { owner: null } }, { kind: 'delete', product_id: 9 }]);
    assert.equal(r.data.error, 'את המוצר הזה רק אבי יכול למחוק.', 'making it shared on the same card opened it');
    assert.equal(sql('SELECT COUNT(*) AS n FROM products WHERE id IN (8, 9) AND deleted IS NULL')[0].n, 2);
    assert.equal((await act(dana, [{ kind: 'delete', product_id: 10 }])).status, 200, 'shared: any grown-up');
    // ש11 (the owner 05/10): the owner and the manager both women, "יכולות"; the owner who is the manager, a woman, "יכולה"
    sql("UPDATE users SET gender = 'f' WHERE id = 1");
    assert.equal((await act(dana, [{ kind: 'delete', product_id: 8 }])).data.error, 'את המוצר הזה רק מיכל או אבי יכולות למחוק.');
    assert.equal((await act(dana, [{ kind: 'delete', product_id: 9 }])).data.error, 'את המוצר הזה רק אבי יכולה למחוק.');
    sql("UPDATE users SET gender = 'm' WHERE id = 1");
    assert.equal((await act(avi, [{ kind: 'delete', product_id: 8 }])).status, 200, 'the manager');
    assert.equal(sql('SELECT COUNT(*) AS n FROM products WHERE id IN (8, 10) AND deleted IS NOT NULL')[0].n, 2);
  });

  await check('L2', 'ילד: 30 הודעות ביום, ואז D13 בלי מודל; מצוקה עוקפת', async () => {
    const now = Date.now();
    for (let i = 0; i < 30; i++) sql("INSERT INTO chat (ts, user_id, role, content, thread) VALUES (?, 3, 'user', '{\"text\":\"היי\"}', 3)", now - 120e3 - i * 1000); // today, not in the last minute (that limit is 30 a minute)
    const n = requests.length;
    const r = await say(yoavi, 'מה יש לאכול?');
    assert.equal(r.reply, 'סיימנו לדבר היום, נמשיך לדבר מחר!');
    assert.equal(requests.length, n, 'the model was asked');
    const d = await say(yoavi, 'אני רוצה להתאבד');
    assert.match(d.reply, /1201/, 'distress goes first');
    // a suspicion ("אני רוצה למות" can be a figure of speech) still goes to the model, which decides
    answer = () => ({ reply: 'זה נשמע קשה.', face: 'sad', distress: 'self' });
    const k = requests.length;
    const e = await say(yoavi, 'אני רוצה למות');
    assert.equal(requests.length, k + 1, 'the model wasn\'t asked');
    assert.match(e.reply, /1201/);
  });

  await check('L3', '"די לשאול" (D12, לפי מין), ואז אין "שמתי לב"; "אפשר לשאול שוב" (D12ב) מחזיר', async () => {
    sql(`INSERT INTO noticed (key, kind, user_id, product_id, data, count, first, last, status) VALUES ('weekly:7', 'weekly', NULL, 7, '{"v":5}', 9, 1, ${Date.now()}, 'watching')`);
    let r = await say(avi, 'די לשאול');
    assert.equal(r.reply, "בסדר, אפסיק לשאול אם לזכור דברים. אם תרצה שאחזור לשאול, תכתוב לי 'אפשר לשאול שוב'.");
    assert.equal((await say(michal, 'די לשאול אותי')).reply, "בסדר, אפסיק לשאול אם לזכור דברים. אם תרצי שאחזור לשאול, תכתבי לי 'אפשר לשאול שוב'.");
    answer = () => ({ reply: 'יש חלב.', face: 'happy' });
    r = await say(avi, 'יש חלב?');
    assert.ok(!/שמתי לב/.test(r.reply), r.reply);
    r = await say(avi, 'אפשר לשאול שוב');
    assert.equal(r.reply, 'סגור, אחזור לשאול לפעמים.');
    assert.equal(sql("SELECT COUNT(*) AS n FROM facts WHERE key = 'no_ask' AND about_id = 1")[0].n, 0);
    r = await say(avi, 'יש חלב?');
    assert.match(r.reply, /שמתי לב/, 'asked again');
  });

  await check('L4', 'שאלת "לזכור?" אחת ביום ששוקי מתחיל (r12 q030)', async () => {
    await say(avi, 'לא צריך');
    sql(`INSERT INTO noticed (key, kind, user_id, product_id, data, count, first, last, status) VALUES ('weekly:10', 'weekly', NULL, 7, '{"v":2}', 9, 1, ${Date.now()}, 'watching')`);
    const r = await say(avi, 'יש לחם?');
    assert.ok(!/שמתי לב/.test(r.reply), r.reply);
  });

  await check('L5', '"תזכור ש…" נשמר מיד, ושוקי אומר מה זכר, בגוף שני (D10)', async () => {
    answer = () => ({ reply: 'סגור, אזכור!', face: 'happy', actions: [{ kind: 'lesson', text: 'כשמיכל אומרת חלב היא מתכוונת לחלב סויה' }] });
    const r = await say(michal, 'תזכור שכשאני אומרת חלב אני מתכוונת לחלב סויה');
    assert.equal(r.reply, 'סגור, אזכור שכשאת אומרת חלב את מתכוונת לחלב סויה.');
    assert.equal(sql("SELECT COUNT(*) AS n FROM lessons WHERE text LIKE '%לחלב סויה%'")[0].n, 1);
    // a fact about the writer, kept in the third person, is said to him in the second
    answer = () => ({ reply: 'סגור!', face: 'happy', actions: [{ kind: 'fact', key: 'diet', about: 'אבי', value: 'צמחוני', text: 'אבי צמחוני' }] });
    assert.equal((await say(avi, 'תזכור שאני צמחוני')).reply, 'סגור, אזכור שאתה צמחוני.');
  });

  await check('L6', 'עד 2 התראות ביום: ב-1 בחודש "פג בקרוב" והסיכום, והמקפיא בתוך הסיכום (שאלה 28); "האם עדיין רוצים?" לא נשאל ונשאל מחר', async () => {
    const d = new Date(); const first = `${d.getUTCFullYear() + (d.getUTCMonth() === 11 ? 1 : 0)}-${String((d.getUTCMonth() + 1) % 12 + 1).padStart(2, '0')}-01`;
    const t20 = at(first, 20), next = at(day(t20 + 86400e3), 20);
    const freezer = sql("SELECT id FROM locations WHERE name = 'מקפיא'")[0].id;
    sql("INSERT INTO products (id, name, count_type, qty, location_id, created, updated) VALUES (20, 'שניצל', 'units', 2, ?, 1, 1)", freezer);
    sql('UPDATE products SET expires = ? WHERE id = 7', t20 + 86400e3);
    sql("INSERT INTO maybe (text, product_id, store, added_by, added, kind) VALUES ('אבטיח', NULL, 'super', 1, ?, 'maybe')", t20 - 3 * 86400e3);
    sql("DELETE FROM settings WHERE key LIKE 'pushes:%' OR key LIKE 'later:%'");
    const a = (await call(avi, 'POST', '/api/__schedule', { now: t20 })).data;
    const titles = (a.digestFor?.[1] || []).map((m) => m.title);
    assert.deepEqual(titles, ['תוקף', 'סיכום החודש'], JSON.stringify(a).slice(0, 400));
    assert.match(a.digestFor[1][1].body, / הכי הרבה זמן במקפיא: שניצל .*האם הגיע הזמן לבשל אותם\?$/, 'the freezer in the summary');
    assert.equal(sql("SELECT asked FROM maybe WHERE text = 'אבטיח'")[0].asked, null, '"still want it?" waited');
    assert.equal(sql(`SELECT value FROM settings WHERE key = 'pushes:1:${first}'`)[0]?.value, '2');
    sql('UPDATE products SET expires = NULL WHERE id = 7');
    const b = (await call(avi, 'POST', '/api/__schedule', { now: next })).data;
    assert.deepEqual((b.digestFor?.[1] || []).map((m) => m.title), [], 'nothing waited for the next day: ' + JSON.stringify(b).slice(0, 300));
    assert.ok(sql("SELECT asked FROM maybe WHERE text = 'אבטיח'")[0].asked, 'asked the next day');
  });

  await check('L7', 'כרטיס מהשרת אחד בכל פעם; כרטיס שלא ענו עליו נעלם אחרי יום', async () => {
    sql("UPDATE events SET ts = ts - 30 * 86400000");
    sql("DELETE FROM settings WHERE key = 'idle_offer'");
    sql(`INSERT INTO chat (ts, user_id, role, content, thread) VALUES (${Date.now()}, NULL, 'shuki', '{"reply":"איזה כיף שעברתם לבית חדש!","options":["כן, נתחיל למפות","אחר כך"],"card":1}', NULL)`);
    let s = JSON.stringify((await call(avi, 'GET', '/api/chat')).data.messages);
    assert.ok(s.includes('עברתם לבית חדש') && !s.includes('התגעגעתי'), 'a second card while one is up');
    sql('UPDATE chat SET ts = ts - 2 * 86400000'); // two days on (all of it: the chat shows the last 60, so the card is still among them)
    s = JSON.stringify((await call(avi, 'GET', '/api/chat')).data.messages);
    assert.ok(!s.includes('עברתם לבית חדש'), 'the old card is still shown');
    assert.ok(s.includes('התגעגעתי'), 'the next one comes once it went');
    // answered: it stays in the history after a day, and doesn't hold the next one back
    await say(avi, 'לא עכשיו');
    sql('UPDATE chat SET ts = ts - 2 * 86400000'); // two days on, for everything (the chat shows the last 60)
    s = JSON.stringify((await call(avi, 'GET', '/api/chat')).data.messages);
    assert.ok(s.includes('התגעגעתי'), 'an answered card went');
    assert.ok(sql("SELECT content FROM chat WHERE content LIKE '%התגעגעתי%'").every((r) => JSON.parse(r.content).answered === 1));
    // the owner 05/10: the next message closes it also when it's free text, as "להחליף"
    sql(`INSERT INTO chat (ts, user_id, role, content, thread) VALUES (${Date.now() - 1000}, NULL, 'shuki', '{"reply":"ניסיון של כרטיס","options":["כן","לא"],"card":1}', NULL)`);
    answer = () => ({ reply: 'בוקר טוב!', face: 'happy' });
    await say(yoavi, 'בוקר טוב'); // 65: a child's message doesn't close a card to the house
    assert.equal(JSON.parse(sql("SELECT content FROM chat WHERE content LIKE '%ניסיון של כרטיס%'")[0].content).answered, undefined, 'a child closed it');
    await say(avi, 'בוקר טוב');
    assert.equal(JSON.parse(sql("SELECT content FROM chat WHERE content LIKE '%ניסיון של כרטיס%'")[0].content).answered, 1, 'free text didn\'t close it');
    // a card to one person: only their message closes it
    sql(`INSERT INTO chat (ts, user_id, role, content, thread) VALUES (${Date.now() - 500}, NULL, 'shuki', '{"reply":"כרטיס לדנה","options":["כן"],"card":1,"for":4}', NULL)`);
    await say(avi, 'עוד משהו');
    assert.equal(JSON.parse(sql("SELECT content FROM chat WHERE content LIKE '%כרטיס לדנה%'")[0].content).answered, undefined, 'Avi closed Dana\'s card');
    await say(dana, 'היי');
    assert.equal(JSON.parse(sql("SELECT content FROM chat WHERE content LIKE '%כרטיס לדנה%'")[0].content).answered, 1, 'Dana didn\'t close hers');
  });
  await check('L6B', 'שבת כשאין מקום (0ב-5.6.1, r0t b4): מי שכבר קיבל 2 התראות היום לא מקבל "לשבת", והיא לא נדחית למחר; מי שיש לו מקום מקבל', async () => {
    let fri = Date.now() + 86400e3; while (new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short' }).format(fri) !== 'Fri') fri += 86400e3;
    const date = day(fri), t10 = at(date, 10);
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 1, 'shabbat', 'כן', 0, 1, 1, 0, 'settings', 0, 0), ('person', 2, 'shabbat', 'כן', 0, 2, 2, 0, 'settings', 0, 0)");
    sql("INSERT INTO products (id, name, count_type, qty, is_basic, target, created, updated) VALUES (21, 'חלות', 'units', 0, 1, 1, 1, 1)");
    sql("DELETE FROM settings WHERE key LIKE 'pushes:%' OR key LIKE 'later:%' OR key LIKE 'shabbat_sent:%'");
    sql('INSERT INTO settings (key, value) VALUES (?, ?)', `pushes:1:${date}`, '2'); // Avi already had his two today
    const r = (await call(avi, 'POST', '/api/__schedule', { now: t10 })).data;
    assert.equal(r.shabbatSent, 1, `only Michal: ${JSON.stringify(r).slice(0, 300)}`);
    assert.equal(sql(`SELECT value FROM settings WHERE key = 'pushes:1:${date}'`)[0].value, '2', 'not counted past the limit');
    assert.equal(sql(`SELECT value FROM settings WHERE key = 'pushes:2:${date}'`)[0]?.value, '1', 'Michal\'s counted');
    assert.ok(!/לשבת/.test(sql("SELECT value FROM settings WHERE key = 'later:1'")[0]?.value || ''), 'it\'s about today: dropped, not kept for later');
    assert.equal((await call(avi, 'POST', '/api/__schedule', { now: t10 + 60e3 })).data.shabbatSent ?? 0, 0, 'not sent again in the same hour');
    const sat = (await call(avi, 'POST', '/api/__schedule', { now: at(day(fri + 86400e3), 20) })).data;
    assert.ok(!(sat.digestFor?.[1] || []).some((m) => m.title === 'לשבת'), 'not the next day either');
    sql("DELETE FROM facts WHERE key = 'shabbat'"); sql('DELETE FROM products WHERE id = 21');
  });

  await check('L8', 'מוצר שהבעלים שלו ילד: כל מבוגר יכול למחוק (0ב שאלה 26, r0t b5); הילד עצמו לא', async () => {
    sql("INSERT INTO products (id, name, count_type, qty, owner, created, updated) VALUES (22, 'במבה של יואבי', 'units', 1, 3, 1, 1), (23, 'ביסלי של יואבי', 'units', 1, 3, 1, 1)");
    let r = await act(yoavi, [{ kind: 'delete', product_id: 23 }]);
    assert.ok(r.status >= 400 || r.data.error, `the child deleted: ${JSON.stringify(r.data)}`); assert.equal(sql('SELECT deleted FROM products WHERE id = 23')[0].deleted, null);
    r = await act(dana, [{ kind: 'delete', product_id: 22 }]);
    assert.ok(!r.data.error, JSON.stringify(r.data)); assert.ok(sql('SELECT deleted FROM products WHERE id = 22')[0].deleted, 'Dana, not the owner nor the admin, deleted it');
  });

  await check('L9', '"בינינו, די לשאול" בלי עובדה משותפת (פ21, r7b): העובדה פרטית, ושתי השורות רק של מיכל, רגישות, ונמחקות אחרי שבוע', async () => {
    sql("DELETE FROM facts WHERE key = 'no_ask' AND about_id = 2"); // L3's shared one
    const lastId = () => sql('SELECT MAX(id) AS n FROM chat')[0].n;
    const t0 = lastId(), d12 = "בסדר, אפסיק לשאול אם לזכור דברים. אם תרצי שאחזור לשאול, תכתבי לי 'אפשר לשאול שוב'.";
    assert.equal((await say(michal, 'בינינו, די לשאול')).reply, d12, 'D12 as it is, without "זה נשאר בינינו."');
    assert.equal(sql("SELECT private FROM facts WHERE key = 'no_ask' AND about_id = 2").map((r) => r.private).join(), '1');
    let rows = sql('SELECT id, role, content FROM chat WHERE id > ? AND thread = 2 ORDER BY id', t0);
    assert.equal(rows.length, 2, JSON.stringify(rows));
    for (const k of ['"only":2', '"sensitive":true', '"secret":true']) assert.ok(rows[0].content.includes(k), `the user row: ${k} ${rows[0].content}`);
    for (const k of ['"only":2', '"sensitive":true']) assert.ok(rows[1].content.includes(k), `Shuki's row: ${k} ${rows[1].content}`);
    const seen = JSON.stringify((await call(avi, 'GET', '/api/chat')).data.messages.map((m) => m.id));
    assert.ok(rows.every((r) => !JSON.parse(seen).includes(r.id)), 'Avi sees them');
    // a week later, the hourly run's cleanup (SENSITIVE_DAYS): both go
    sql('UPDATE chat SET ts = ts - 8*86400e3 WHERE id IN (?, ?)', rows[0].id, rows[1].id);
    await call(avi, 'POST', '/api/__schedule', { now: Date.now() });
    assert.equal(sql('SELECT COUNT(*) AS n FROM chat WHERE id IN (?, ?)', rows[0].id, rows[1].id)[0].n, 0, 'still there after a week');
    // the secret went on from her message before: only/sensitive, without `secret` on "די לשאול"
    sql("DELETE FROM facts WHERE key = 'no_ask' AND about_id = 2");
    answer = () => ({ reply: 'אני פה!', face: 'happy' });
    await say(michal, 'בינינו, משהו קטן');
    const t2 = lastId();
    assert.equal((await say(michal, 'די לשאול')).reply, d12);
    rows = sql('SELECT role, content FROM chat WHERE id > ? AND thread = 2 ORDER BY id', t2);
    assert.equal(rows.length, 2, JSON.stringify(rows));
    for (const r of rows) for (const k of ['"only":2', '"sensitive":true']) assert.ok(r.content.includes(k), `${r.role}: ${k} ${r.content}`);
    assert.ok(!rows[0].content.includes('"secret"'), rows[0].content);
    // without a secret, "די לשאול" is kept as before (L3): no only, no sensitive
    sql("DELETE FROM facts WHERE key = 'no_ask' AND about_id = 4");
    const t3 = lastId();
    await say(dana, 'די לשאול');
    rows = sql('SELECT content FROM chat WHERE id > ? AND thread = 4 ORDER BY id', t3);
    assert.equal(rows.length, 2); assert.ok(rows.every((r) => !/"only"|"sensitive"|"secret"/.test(r.content)), JSON.stringify(rows));
    assert.equal(sql("SELECT private FROM facts WHERE key = 'no_ask' AND about_id = 4")[0].private, 0);
  });

  await check('L10', '"אל תיתן לה להוסיף שוקולד" (פ23, r12 q020): לא חוסמים מבוגר, בנוסח של the owner ובלי מודל; "לי" ושם של ילד למודל', async () => {
    const OWNER_SAYS = 'אצלי כל מבוגר בבית יכול להוסיף לרשימה מה שהוא רוצה.';
    sql("DELETE FROM settings WHERE key = 'ask:1'");
    const lessons = () => sql('SELECT COUNT(*) AS n FROM lessons')[0].n, before = lessons();
    for (const t of ['אל תיתן לה להוסיף שוקולד', 'אל תיתן למיכל להוסיף שוקולד', 'לא תרשה לו לקנות במבה']) {
      const n = requests.length, r = await say(avi, t);
      assert.equal(r.reply, OWNER_SAYS, t); assert.ok(!r.proposal && !r.options, JSON.stringify(r));
      assert.equal(requests.length, n, `the model was asked: ${t}`);
    }
    assert.equal(lessons(), before, 'a rule'); assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'ask:1'")[0].n, 0, 'a question');
    // a secret turn: both rows Avi's alone
    const t0 = sql('SELECT MAX(id) AS n FROM chat')[0].n;
    assert.equal((await say(avi, 'בינינו, אל תיתן לה להוסיף שוקולד')).reply, OWNER_SAYS);
    const rows = sql('SELECT content FROM chat WHERE id > ? AND thread = 1 ORDER BY id', t0);
    assert.equal(rows.length, 2); assert.ok(rows.every((r) => r.content.includes('"only":1') && r.content.includes('"sensitive":true')), JSON.stringify(rows));
    assert.ok(rows[0].content.includes('"secret":true'), rows[0].content);
    // about oneself, or a child: the model, as before (r7b)
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    for (const t of ['אל תיתן לי להוסיף שוקולד', 'אל תיתן ליואבי להוסיף שוקולד']) {
      const n = requests.length, r = await say(avi, t);
      assert.equal(requests.length, n + 1, `the model wasn't asked: ${t}`); assert.notEqual(r.reply, OWNER_SAYS);
    }
  });
} finally {
  srv.kill(); mock.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} limit checks passed`);
if (failed.length) { console.log(log.split('\n').filter((l) => /error|Error/.test(l)).slice(-8).join('\n')); process.exit(1); }
