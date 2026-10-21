// r0t (docs/stage0-trace-decisions.md, the owner 03/10): the server items of part ב, on the Node server with a fake model.
// Each check fails on the code before its item.
// Run: node --disable-warning=ExperimentalWarning test/r0t.itest.js
import './fetch-retry.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DIR = '/tmp/shuki-test/shuki-r0t'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const PORT = 8811, MOCK = 8812;

const db = new DatabaseSync(`${DIR}/shuki.db`);
db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) { db.exec(readFileSync(`migrations/${f}`, 'utf8')); db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f); }
db.exec(readFileSync('test/fixture-house.sql', 'utf8'));
db.exec("INSERT INTO users (id, name, gender, role, active, created) VALUES (3, 'יואבי', 'm', 'child', 1, 0)");
db.exec("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999), ('222222', 2, 9999999999999), ('333333', 3, 9999999999999)");
db.exec(`INSERT INTO products (id, name, count_type, qty, created, updated) VALUES
  (7, 'חלב', 'units', 2, 1, 1), (8, 'חלב סויה', 'units', 1, 1, 1), (10, 'לחם', 'units', 1, 1, 1)`);
db.close();

let answer = () => ({ reply: 'אני פה!', face: 'happy' });
const requests = [];
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { const b = Buffer.concat(parts).toString('utf8'); // bytes first: a Hebrew letter can be split between chunks (question 29)

  const body = b ? JSON.parse(b) : {}; requests.push(body);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'tool_use', name: body.tools?.[0]?.name || 'respond', input: answer(body) }], usage: { input_tokens: 1, output_tokens: 1 } }));
}); }).listen(MOCK, '127.0.0.1');
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/node.js'], { env: { ...process.env, PORT: String(PORT), DB_PATH: `${DIR}/shuki.db`, ANTHROPIC_API_KEY: 't', ANTHROPIC_URL: `http://127.0.0.1:${MOCK}/v1/messages`, TEST_RESET: '1', CHAT_PER_MINUTE: '200' /* many checks write as Avi within a minute; the limit has its own test (limits) */ }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
const call = async (t, m, p, b) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const x = await r.text(); let data; try { data = JSON.parse(x); } catch { data = x; } return { status: r.status, data }; };
const sql = (q, ...a) => { const d = new DatabaseSync(`${DIR}/shuki.db`); try { return /^\s*select/i.test(q) ? d.prepare(q).all(...a) : d.prepare(q).run(...a); } finally { d.close(); } };
const results = [];
async function check(id, name, fn) {
  try { await fn(); results.push({ id, ok: true }); console.log('✓', id, name); }
  catch (e) { results.push({ id, ok: false }); console.log('✗', id, name, '\n   ', e.message.slice(0, 500)); }
}
const say = async (t, text, body = {}) => (await call(t, 'POST', '/api/chat', { text, ...body })).data;
const act = (t, actions) => call(t, 'POST', '/api/actions', { actions });
const status = (id) => sql('SELECT status FROM proposals WHERE id = ?', id)[0]?.status;

let avi, michal, yoavi;
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  [avi, michal, yoavi] = await Promise.all(['111111', '222222', '333333'].map(async (code) => (await call(null, 'POST', '/api/pair', { code })).data.token));

  await check('X2', 'תיקון מפורש ("התכוונתי לחלב סויה") סוגר את הכרטיס הקודם, גם כשהמוצר שונה (r0t x2, החלטה 5)', async () => {
    answer = () => ({ reply: 'לעדכן שהחלב נגמר?', face: 'happy', actions: [{ kind: 'op', product_id: 7, op: { type: 'out' } }] });
    const a = await say(michal, 'נגמר החלב');
    assert.ok(a.proposal, 'the first card');
    answer = () => ({ reply: 'לעדכן שחלב הסויה נגמר?', face: 'happy', correction: true, actions: [{ kind: 'op', product_id: 8, op: { type: 'out' } }] });
    const b = await say(michal, 'רגע, התכוונתי לחלב סויה');
    assert.ok(b.proposal, 'the corrected card');
    assert.equal(status(a.proposal.id), 'rejected', 'the old card stayed open beside the new one');
    assert.equal(status(b.proposal.id), 'pending');
    // without the mark, a card on another product stays (decision 5: "אחרת הכרטיס ממשיך לחכות")
    answer = () => ({ reply: 'להוסיף לחם לרשימה?', face: 'happy', actions: [{ kind: 'list_add', product_id: 10 }] });
    const c = await say(michal, 'צריך לחם');
    assert.equal(status(b.proposal.id), 'pending', 'an unrelated card closed');
    await call(michal, 'POST', `/api/proposals/${b.proposal.id}/reject`, {}); await call(michal, 'POST', `/api/proposals/${c.proposal.id}/reject`, {});
  });

  await check('X4', 'מוצר חדש מצילום בלי כמות: נכנס למלאי עם 1, לא "נגמר" ולא לרשימה; עם כמות 0 במפורש: כן נגמר (r0t x4, חור (ב))', async () => {
    const img = { media_type: 'image/jpeg', data: '/9j/4AAQSkZJRgABAQ==' };
    const photo = async (name, qty) => {
      answer = () => ({ reply: `להוסיף את ${name} למלאי?`, face: 'happy', actions: [{ kind: 'create', product: { name, count_type: 'units', ...(qty != null && { qty }) } }] });
      const r = await say(avi, 'צילמתי', { image: img, kind: 'product' });
      assert.ok(r.proposal, JSON.stringify(r));
      assert.equal((await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {})).status, 200);
      return sql('SELECT p.qty, (SELECT COUNT(*) FROM list_items i WHERE i.product_id = p.id AND i.status = \'open\') AS listed FROM products p WHERE p.name = ?', name)[0];
    };
    assert.deepEqual({ ...(await photo('רוטב חריף מנגו')) }, { qty: 1, listed: 0 }, 'a photo of a new product came in as "ran out"');
    assert.deepEqual({ ...(await photo('רוטב חריף ירוק', 0)) }, { qty: 0, listed: 1 }, 'qty 0 said in so many words is still "ran out"');
  });

  await check('D44', 'שניים באותו סופר: "סיימתי" של אבי סוגר רק את מה שהוא סימן; מה שמיכל סימנה נשאר מסומן אצלה (r0t d44, החלטה 44)', async () => {
    await act(avi, [{ kind: 'list_add', product_id: 7 }, { kind: 'list_add', product_id: 10 }]);
    const line = (pid) => sql("SELECT id, status FROM list_items WHERE product_id = ? AND status IN ('open', 'checked') ORDER BY id DESC", pid)[0];
    await act(avi, [{ kind: 'check', item_id: line(7).id, store: 'super' }]);
    await act(michal, [{ kind: 'check', item_id: line(10).id, store: 'super' }]);
    const bread = line(10).id;
    await act(avi, [{ kind: 'finish', store: 'super' }]);
    assert.equal(sql('SELECT status FROM list_items WHERE id = ?', bread)[0].status, 'checked', 'Avi\'s "done" closed what Michal ticked');
    assert.equal(sql("SELECT COUNT(*) AS n FROM list_items WHERE product_id = 7 AND status = 'checked'")[0].n, 0, 'Avi\'s own line');
    await act(michal, [{ kind: 'finish', store: 'super' }]);
    assert.equal(sql('SELECT status FROM list_items WHERE id = ?', bread)[0].status, 'done');
  });

  await check('D51', '"מתי קנינו לחם?": 6 הקניות האחרונות, ועוד שורה: כמה בסך הכל ומתי הראשונה (r0t d51, החלטה 51)', async () => {
    const before = sql("SELECT COUNT(*) AS n FROM product_log WHERE product_id = 10 AND kind = 'purchase'")[0].n; // bread bought in the checks before
    for (let i = 0; i < 8; i++) await act(avi, [{ kind: 'op', product_id: 10, op: { type: 'purchase', amount: 1 } }]);
    answer = () => ({ reply: 'קנינו לחם היום.', face: 'happy' });
    const n = requests.length;
    await say(avi, 'מתי קנינו לחם?');
    const sys = JSON.stringify(requests.slice(n).map((r) => r.system));
    assert.match(sys, new RegExp(`לחם: [^"]*בסך הכל ${before + 8} קניות, הראשונה ב-\\d{4}-\\d{2}-\\d{2}`), sys.slice(0, 600));
  });

  await check('D27', 'קבלה שמצלמים יומיים אחרי הקניות: מה שסומן בעגלה לא נספר שוב (72 שעות, r0t d27, החלטה 27)', async () => {
    await act(michal, [{ kind: 'list_add', product_id: 8 }]);
    const item = sql("SELECT id FROM list_items WHERE product_id = 8 AND status = 'open'")[0].id;
    await act(michal, [{ kind: 'check', item_id: item, store: 'super' }]);
    sql('UPDATE list_items SET checked = ? WHERE id = ?', Date.now() - 48 * 3600e3, item);
    const qty = sql('SELECT bought_qty FROM list_items WHERE id = ?', item)[0].bought_qty;
    answer = () => ({ reply: 'לרשום את הקבלה?', face: 'happy', actions: [{ kind: 'op', product_id: 8, op: { type: 'purchase', amount: qty } }] });
    const r = await say(michal, 'הקבלה', { image: { media_type: 'image/jpeg', data: '/9j/4AAQSkZJRgABAQ==' } });
    assert.ok(!r.proposal, `counted twice: ${JSON.stringify(r).slice(0, 300)}`);
    assert.match(r.reply, /כבר בעגלה מהקניות/);
  });

  await check('D78', 'כלל שילד ביקש ומבוגר אישר: ביומן בשם הילד, ומי שאישר בסוגריים ("יואבי לימד אותי: … (אבא אישר)", r0t d78)', async () => {
    answer = () => ({ reply: 'האם תרצה שאזכור?', face: 'happy', actions: [{ kind: 'lesson', text: 'יואבי לא אוכל פטריות' }] });
    await say(yoavi, 'תזכור שאני לא אוכל פטריות');
    const yes = await say(avi, 'כן');
    assert.equal(yes.applied, true, JSON.stringify(yes));
    const line = sql("SELECT summary FROM events WHERE type = 'lesson' ORDER BY ts DESC LIMIT 1")[0]?.summary;
    assert.equal(line, 'יואבי לימד אותי: יואבי לא אוכל פטריות (אבא אישר)');
    // 54 (the owner 05/10), as q08: two grown-ups of the same gender, "(אבא {שם} אישר)"
    sql("UPDATE users SET gender = 'm' WHERE id = 2");
    answer = () => ({ reply: 'האם תרצה שאזכור?', face: 'happy', actions: [{ kind: 'lesson', text: 'יואבי לא אוכל זיתים' }] });
    await say(yoavi, 'תזכור שאני לא אוכל זיתים');
    await say(avi, 'כן');
    sql("UPDATE users SET gender = 'f' WHERE id = 2");
    assert.equal(sql("SELECT summary FROM events WHERE type = 'lesson' ORDER BY ts DESC, id DESC LIMIT 1")[0]?.summary, 'יואבי לימד אותי: יואבי לא אוכל זיתים (אבא אבי אישר)');
  });

  await check('D97', 'שאריות: שאלה אחת אחרי 3 ימים; אחרי "עוד יש" לא שואלים שוב (r0t d97, החלטה 97)', async () => {
    const d = Date.now() - 10 * 86400e3;
    sql('INSERT INTO leftovers (id, text, made, added_by) VALUES (51, ?, ?, 1), (52, ?, ?, 1)', 'פסטה', d, 'מרק', d);
    sql('UPDATE leftovers SET asked = ? WHERE id = 52', Date.now() - 5 * 86400e3); // "עוד יש" five days ago
    const asks = (await call(avi, 'GET', '/api/state')).data.leftoverAsk;
    assert.deepEqual(asks, [51], `asked again after "עוד יש": ${JSON.stringify(asks)}`);
  });

  await check('D98', 'הבדיקה השבועית בשבת אצל מי ששומר שבת: לא נשלחת, ומחכה כמו כל התראה ששוקי שולח מעצמו (r0t d98, החלטה 98)', async () => {
    const zoneHour = (ts) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }).format(ts));
    const dayOf = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(ts);
    const at = (date, hour) => { let ts = Date.parse(`${date}T${String(hour).padStart(2, '0')}:05:00Z`); ts -= (zoneHour(ts) - hour) * 3600e3; return ts; };
    let fri = Date.now() + 86400e3; while (new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short' }).format(fri) !== 'Fri') fri += 86400e3;
    const t20 = at(dayOf(fri), 20);
    sql(`UPDATE devices SET push_sub = '{"endpoint":"http://127.0.0.1:${MOCK}/push","keys":{"p256dh":"x","auth":"y"}}', push_on = 1`);
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 1, 'shabbat', 'כן', 0, 1, 1, 0, 'settings', 0, 0)");
    sql("INSERT INTO products (id, name, count_type, qty, created, updated) VALUES (31, 'אורז', 'units', 1, 1, 1), (32, 'קמח', 'units', 1, 1, 1), (33, 'סוכר', 'units', 1, 1, 1)");
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('recount_at', '1')"); // the last check long ago (0 = the clock never started)
    sql("DELETE FROM settings WHERE key LIKE 'pushes:%' OR key LIKE 'later:%'");
    const r = (await call(avi, 'POST', '/api/__schedule', { now: t20 })).data;
    assert.ok(r.recount >= 3, `no weekly check ran: ${JSON.stringify(r).slice(0, 300)}`);
    const later = sql("SELECT value FROM settings WHERE key = 'later:1'")[0]?.value || '';
    assert.match(later, /בדיקה שבועית/, 'sent to Avi on Shabbat instead of waiting');
    assert.equal(sql(`SELECT value FROM settings WHERE key = 'pushes:1:${dayOf(t20)}'`)[0]?.value, undefined, 'counted for Avi');
    assert.equal(sql("SELECT value FROM settings WHERE key = 'later:2'")[0], undefined, 'Michal, who doesn\'t keep Shabbat, got it now');
  });

  await check('D128', 'הסיכום החודשי: "למדתי" סופר גם "כן" על מה ששוקי שם לב אליו, לא רק כללים (r0t d128, החלטה 128)', async () => {
    const zoneHour = (ts) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }).format(ts));
    const at = (date, hour) => { let ts = Date.parse(`${date}T${String(hour).padStart(2, '0')}:05:00Z`); ts -= (zoneHour(ts) - hour) * 3600e3; return ts; };
    const d = new Date(); const first = `${d.getUTCFullYear() + (d.getUTCMonth() === 11 ? 1 : 0)}-${String((d.getUTCMonth() + 1) % 12 + 1).padStart(2, '0')}-01`;
    const t20 = at(first, 20);
    sql(`UPDATE devices SET push_sub = '{"endpoint":"http://127.0.0.1:${MOCK}/push","keys":{"p256dh":"x","auth":"y"}}', push_on = 1`);
    sql("DELETE FROM facts WHERE key = 'shabbat'"); sql('DELETE FROM lessons');
    sql("DELETE FROM settings WHERE key LIKE 'pushes:%' OR key LIKE 'later:%' OR key LIKE 'digest%'");
    sql("UPDATE devices SET digest_sent = NULL");
    const id = sql("INSERT INTO noticed (key, kind, product_id, data, count, first, last, status) VALUES ('weekly:10', 'weekly', 10, '{\"v\":5}', 3, 0, 0, 'yes')").lastInsertRowid;
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", `noticed_yes:${id}`, String(t20 - 5 * 86400e3));
    const r = (await call(avi, 'POST', '/api/__schedule', { now: t20 })).data;
    const month = (r.digestFor?.[1] || []).find((m) => m.title === 'סיכום החודש');
    assert.match(month?.body || '', /למדתי משהו חדש: אתם קונים לחם בכל יום שישי/, JSON.stringify(r).slice(0, 500));
  });

  await check('P6', 'תזכורת על מוצר פרטי: "תזכורת" / "ביקשת שאזכיר לך משהו.", בלי שם המוצר במסך הנעול (r0t p6, אושר 03/10)', async () => {
    sql("DELETE FROM maybe WHERE kind = 'remind'");
    sql("INSERT INTO maybe (text, product_id, store, added_by, added, kind, due_at, private_to) VALUES ('קונדומים', NULL, 'super', 1, ?, 'remind', ?, 1)", Date.now() - 86400e3, Date.now() - 60e3); // as the app writes it now (private_to, migration 0024)
    const r = (await call(avi, 'POST', '/api/__schedule', { now: Date.now() })).data;
    assert.deepEqual(r.reminderBodies, ['ביקשת שאזכיר לך משהו.'], JSON.stringify(r).slice(0, 400));
    assert.ok(!JSON.stringify(r).includes('קונדומים'), 'the name went out');
  });

  await check('P1', 'הודעה אישית (הריון, בריאות, הפתעה, "בינינו"): רק אצל מי שכתב, רגישה (נמחקת אחרי שבוע), ו"זה נשאר בינינו." בסוף (r0t p1, אושר 03/10)', async () => {
    answer = () => ({ reply: 'וואו, מזל טוב!', face: 'excited', personal: true });
    const r = await say(yoavi, 'בינינו, אני מכין הפתעה לאבא');
    assert.equal(r.reply, 'וואו, מזל טוב! זה נשאר בינינו.');
    const rows = sql("SELECT role, content FROM chat WHERE thread = 3 AND (content LIKE '%הפתעה לאבא%' OR content LIKE '%זה נשאר בינינו%')").map((x) => ({ role: x.role, ...JSON.parse(x.content) }));
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.ok(rows.every((x) => x.sensitive === true && x.only === 3), `not kept for the writer only: ${JSON.stringify(rows)}`);
    const parent = JSON.stringify((await call(avi, 'GET', '/api/chat')).data);
    assert.ok(!parent.includes('הפתעה לאבא'), 'the parent sees it in the child\'s chat');
  });

  await check('P2', 'מי שעזב: ביומן ובהיסטוריית הקניות "מי שגרה כאן" במקום השם, והפועל נשאר (r0t p2, אושר 03/10)', async () => {
    sql("INSERT INTO users (id, name, gender, role, active, created) VALUES (9, 'נוגה', 'f', 'member', 1, 0)");
    sql("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('999999', 9, 9999999999999)");
    const noga = (await call(null, 'POST', '/api/pair', { code: '999999' })).data.token;
    await act(noga, [{ kind: 'op', product_id: 10, op: { type: 'purchase', amount: 1 } }]);
    assert.ok(sql("SELECT summary FROM events WHERE user_id = 9")[0].summary.startsWith('נוגה קנתה'), 'the line before she left');
    assert.equal((await call(avi, 'POST', '/api/members', { id: 9, remove: true })).status, 200);
    const lines = sql('SELECT summary FROM events WHERE user_id = 9').map((x) => x.summary);
    assert.ok(lines.length && lines.every((s) => s.startsWith('מי שגרה כאן קנתה') && !s.includes('נוגה')), JSON.stringify(lines));
    answer = () => ({ reply: 'לאחרונה.', face: 'happy' });
    const n = requests.length;
    await say(avi, 'מתי קנינו לחם?');
    const sys = JSON.stringify(requests.slice(n).map((r) => r.system));
    assert.ok(!sys.includes('נוגה'), 'her name in the history the model gets');
    assert.match(sys, /מי שגרה כאן/);
  });

  await check('D186', 'ילד שמבקש למחוק: כרטיס למבוגרים ("יואבי ביקש למחוק את הלחם. האם לאשר?"), והילד שומע "ביקשתי מאבא או מאמא…" (r0t d186, אושר 03/10)', async () => {
    sql("INSERT INTO products (id, name, count_type, qty, created, updated) VALUES (40, 'במבה', 'units', 1, 1, 1)");
    answer = () => ({ reply: 'אוקיי.', face: 'happy', actions: [{ kind: 'delete', product_id: 40 }] });
    const r = await say(yoavi, 'תמחק את הבמבה');
    assert.equal(r.reply, 'ביקשתי מאבי או ממיכל לאשר את המחיקה של הבמבה.' /* 131 (the owner 19/10) */);
    assert.ok(!r.proposal, 'a card for the child');
    const row = sql("SELECT content FROM chat WHERE content LIKE '%ביקש למחוק את הבמבה%'").map((x) => JSON.parse(x.content))[0];
    assert.equal(row?.reply, 'יואבי ביקש למחוק את הבמבה. האם לאשר?');
    assert.equal(row.proposal.lines[0].text, 'כן, האם למחוק את הבמבה?');
    const kid = (await call(yoavi, 'POST', `/api/proposals/${row.proposal.id}/apply`, {})).data;
    assert.ok(kid.error && !sql('SELECT deleted FROM products WHERE id = 40')[0].deleted, `the child approved it: ${JSON.stringify(kid)}`);
    assert.equal((await call(michal, 'POST', `/api/proposals/${row.proposal.id}/apply`, {})).status, 200, 'any grown-up approves it');
    assert.ok(sql('SELECT deleted FROM products WHERE id = 40')[0].deleted, 'deleted');
    // only mothers in the house: each by name (r7b)
    sql("UPDATE users SET gender = 'f' WHERE id = 1");
    sql("INSERT INTO products (id, name, count_type, qty, created, updated) VALUES (41, 'קולה', 'units', 1, 1, 1)");
    answer = () => ({ reply: 'אוקיי.', face: 'happy', actions: [{ kind: 'delete', product_id: 41 }] });
    assert.equal((await say(yoavi, 'תמחק את הקולה')).reply, 'ביקשתי מאבי או ממיכל לאשר את המחיקה של הקולה.' /* 131 (the owner 19/10) */); // decision 5's rule (r7b)
    sql("UPDATE users SET gender = 'm' WHERE id = 1");
  });

  await check('D101', 'קנייה קבועה "כל 3 חודשים": הכרטיס "לקנות פילטר לבריטה כל 3 חודשים?" עם השורה הקטנה; נשמרת עם every; המודל רואה "כל 3 חודשים" (r0t d101, אושר 03/10)', async () => {
    sql("INSERT INTO products (id, name, count_type, qty, created, updated) VALUES (50, 'פילטר לבריטה', 'units', 1, 1, 1)");
    answer = () => ({ reply: 'לקבוע?', face: 'happy', actions: [{ kind: 'routine', product_id: 50, every: 90 }] });
    const r = await say(avi, 'פילטר לבריטה כל 3 חודשים');
    assert.ok(r.proposal, JSON.stringify(r).slice(0, 300));
    assert.deepEqual(r.proposal.lines.map((l) => [l.text, l.detail]), [['לקנות פילטר לבריטה כל 3 חודשים?', 'אוסיף לרשימה כשיגיע הזמן, לפי הקנייה האחרונה']]);
    assert.equal((await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {})).status, 200);
    assert.deepEqual({ ...sql('SELECT weekday, every FROM routines WHERE product_id = 50')[0] }, { weekday: -1, every: 90 });
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    const n = requests.length; await say(avi, 'מה קונים קבוע?');
    assert.match(JSON.stringify(requests.slice(n).map((x) => x.system)), /פילטר לבריטה \(כל 3 חודשים\)/);
    answer = () => ({ reply: 'להפסיק?', face: 'happy', actions: [{ kind: 'routine', product_id: 50, off: true }] });
    const off = await say(avi, 'תפסיק עם הפילטר');
    assert.equal(off.proposal.lines[0].text, 'להפסיק לקנות פילטר לבריטה כל 3 חודשים?');
    await call(avi, 'POST', `/api/proposals/${off.proposal.id}/reject`, {});
  });

  const fact = (about, key, value, more = {}) => sql(`INSERT INTO facts (about, about_id, key, value, since, until, ask_again, told_by, confirmed_by, private, source, created, updated) VALUES ('person', ?, ?, ?, ?, NULL, ?, ?, ?, ?, 'chat', 0, 0)`, about, key, value, more.since ?? Date.now() - 30 * 86400e3, more.ask_again ?? null, about, about, more.private ?? 0).lastInsertRowid;
  await check('R951', 'ביום שנקבע: "האם אתה עדיין בקיטו?" / "רשמתי שאת אוהבת שקשוקה. האם זה עדיין נכון?"; "כבר לא" מוחק, "כן, עדיין" דוחה (r0t r9-51, אושר 03/10)', async () => {
    sql("DELETE FROM settings WHERE key LIKE 'learnask:%' OR key LIKE 'ask:%'"); sql("DELETE FROM facts WHERE key != 'shabbat'");
    const keto = fact(1, 'period', 'קיטו', { ask_again: Date.now() - 3600e3 });
    answer = () => ({ reply: 'שלום!', face: 'happy' });
    let r = await say(avi, 'היי');
    assert.equal(r.reply, 'שלום! האם אתה עדיין בקיטו?'); assert.deepEqual(r.options, ['כן, עדיין', 'כבר לא']);
    r = await say(avi, 'כבר לא');
    assert.equal(r.reply, 'סגור, שכחתי.'); assert.equal(sql('SELECT COUNT(*) AS n FROM facts WHERE id = ?', keto)[0].n, 0, 'the fact stayed');
    const likes = fact(2, 'likes', 'שקשוקה', { since: Date.now() - 10 * 86400e3, ask_again: Date.now() - 60e3 });
    r = await say(michal, 'היי');
    assert.equal(r.reply, 'שלום! רשמתי שאת אוהבת שקשוקה. האם זה עדיין נכון?');
    r = await say(michal, 'כן, עדיין');
    assert.equal(r.reply, 'סגור!');
    assert.ok(sql('SELECT ask_again FROM facts WHERE id = ?', likes)[0].ask_again > Date.now() + 9 * 86400e3, 'asked again after the same while');
    // a key whose sentence can't be built without guessing (r0t-2): not asked
    sql("DELETE FROM settings WHERE key LIKE 'learnask:%'");
    fact(1, 'diet', 'טבעונות', { ask_again: Date.now() - 60e3 });
    assert.equal((await say(avi, 'היי')).reply, 'שלום!');
  });

  await check('R02', 'עובדה עם "לשאול שוב": המודל כותב גם את השאלה בגוף שני (ask_text), והשרת שואל אותה ביום שנקבע, בכל סוג (r0t-2, הוכרע (א) 03/10)', async () => {
    sql("DELETE FROM settings WHERE key LIKE 'learnask:%' OR key LIKE 'ask:%'"); sql("DELETE FROM facts WHERE about = 'person' AND about_id = 1 AND key = 'diet'");
    const day = new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10);
    answer = () => ({ reply: 'סגור.', face: 'happy', actions: [{ kind: 'fact', key: 'diet', about: 'אבי', value: 'טבעוני', text: 'אבי טבעוני', ask_again: day, ask_text: 'רשמתי שאתה טבעוני. האם זה עדיין נכון?' }] });
    await say(avi, 'תזכור שאני טבעוני, ותשאל אותי שוב בעוד חודש');
    const row = sql("SELECT id, ask_text FROM facts WHERE about = 'person' AND about_id = 1 AND key = 'diet'")[0];
    assert.equal(row?.ask_text, 'רשמתי שאתה טבעוני. האם זה עדיין נכון?');
    // the day came: diet couldn't be asked before (no sentence from its value); now it can, in the model's words
    sql('UPDATE facts SET ask_again = ? WHERE id = ?', Date.now() - 60e3, row.id); sql("DELETE FROM settings WHERE key LIKE 'learnask:%' OR key LIKE 'ask:%'");
    answer = () => ({ reply: 'שלום!', face: 'happy' });
    const r = await say(avi, 'היי');
    assert.equal(r.reply, 'שלום! רשמתי שאתה טבעוני. האם זה עדיין נכון?'); assert.deepEqual(r.options, ['כן, עדיין', 'כבר לא']);
    assert.equal((await say(avi, 'כן, עדיין')).reply, 'סגור!');
  });

  await check('R04', 'ילד מבקש "תזכור ש…" כשלאמא יש שאלה פתוחה משלה: הבקשה מחכה עד שהיא עונה, ואז נשאלת; תשובה של אבא עונה לשניהם (r0t-4, הוכרע (א) 03/10)', async () => {
    sql("DELETE FROM settings WHERE key LIKE 'ask:%' OR key LIKE 'askq:%' OR key LIKE 'learnask:%'");
    const ask = (uid) => sql('SELECT value FROM settings WHERE key = ?', `ask:${uid}`)[0]?.value;
    answer = () => ({ reply: 'הבנתי.', face: 'happy', actions: [{ kind: 'lesson', text: 'כשמיכל אומרת קפה היא מתכוונת לנס קפה' }] });
    await say(michal, 'כשאני אומרת קפה אני מתכוונת לנס');
    assert.match(ask(2) || '', /נס קפה/, 'her own question is open');
    answer = () => ({ reply: 'אוקיי!', face: 'happy', actions: [{ kind: 'lesson', text: 'יואבי אוהב במבה בנוגט' }] });
    await say(yoavi, 'תזכור שאני אוהב במבה בנוגט');
    assert.match(ask(1) || '', /במבה בנוגט/, 'Avi had nothing open: asked now');
    assert.match(ask(2) || '', /נס קפה/, 'not over Michal\'s own question');
    assert.ok(sql("SELECT value FROM settings WHERE key = 'askq:2'")[0], 'it waits for her');
    // she answers her own; then she's asked the child's
    assert.equal((await say(michal, 'כן')).reply, 'סגור, אזכור!');
    assert.match(ask(2) || '', /במבה בנוגט/, 'asked after she answered');
    const bubble = sql("SELECT content FROM chat WHERE thread = 2 AND content LIKE '%ביקש שאזכור שיואבי אוהב במבה בנוגט%' ORDER BY ts DESC LIMIT 1")[0];
    assert.ok(bubble, 'the question in her chat');
    // Avi answers for everyone: Michal's goes too
    assert.equal((await say(avi, 'לא צריך')).reply, 'בסדר, לא אזכור.');
    assert.equal(ask(2), undefined, 'answered by Avi');
  });

  await check('R979', 'הריון: פעם אחת "האם לספר לשאר הבית שאת בהריון, או שזה נשאר בינינו?"; "רק בינינו" משאיר פרטי (r0t r9-79, אושר 03/10)', async () => {
    sql("DELETE FROM settings WHERE key LIKE 'learnask:%' OR key LIKE 'ask:%'");
    const preg = fact(2, 'pregnancy', 'כן', { private: 1 });
    answer = () => ({ reply: 'שלום!', face: 'happy' });
    let r = await say(michal, 'היי');
    assert.equal(r.reply, 'שלום! האם לספר לשאר הבית שאת בהריון, או שזה נשאר בינינו?'); assert.deepEqual(r.options, ['לספר לבית', 'רק בינינו']);
    r = await say(michal, 'רק בינינו');
    assert.equal(r.reply, 'בסדר, זה נשאר בינינו.'); assert.equal(sql('SELECT private FROM facts WHERE id = ?', preg)[0].private, 1);
    sql("DELETE FROM settings WHERE key LIKE 'learnask:%'");
    assert.doesNotMatch((await say(michal, 'היי')).reply, /לספר לשאר הבית/, 'asked twice'); // another day's question may come (stage 9, מ16)
    // "לספר לבית" opens it
    sql(`DELETE FROM settings WHERE key = 'preg_asked:${preg}'`); sql("DELETE FROM settings WHERE key LIKE 'learnask:%'");
    await say(michal, 'היי');
    r = await say(michal, 'לספר לבית');
    assert.equal(r.reply, 'סגור, עכשיו גם שאר הבית יודעים.'); assert.equal(r.face, 'excited');
    assert.equal(sql('SELECT private FROM facts WHERE id = ?', preg)[0].private, 0);
  });

  await check('D186B', 'בקשה של ילד למחוק נשארת ממתינה עד שמבוגר לוחץ: הודעה של אבי על אותו מוצר, או תיקון ("התכוונתי ל…"), לא סוגרים אותה (r0t d186)', async () => {
    sql("INSERT INTO products (id, name, count_type, qty, created, updated) VALUES (42, 'ביסלי', 'units', 1, 1, 1)");
    const status = (id) => sql('SELECT status FROM proposals WHERE id = ?', id)[0]?.status;
    answer = () => ({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'list_add', product_id: 10 }] });
    const own = (await say(avi, 'תוסיף לחם לרשימה')).proposal.id;
    answer = () => ({ reply: 'אוקיי.', face: 'happy', actions: [{ kind: 'delete', product_id: 42 }] });
    await say(yoavi, 'תמחק את הביסלי');
    const kid = sql("SELECT id FROM proposals WHERE status = 'pending' AND actions LIKE '%\"forAdults\":true%' AND actions LIKE '%\"product_id\":42%'")[0].id;
    // a correction closes Avi's own card, not the child's (which is newer)
    answer = () => ({ reply: 'להוסיף חלב?', face: 'happy', correction: true, actions: [{ kind: 'list_add', product_id: 7 }] });
    await say(avi, 'התכוונתי לחלב');
    assert.equal(status(own), 'rejected', 'his own card'); assert.equal(status(kid), 'pending', 'the child\'s request, after a correction');
    // a message about the same product doesn't close it either
    answer = () => ({ reply: 'להוסיף ביסלי?', face: 'happy', actions: [{ kind: 'list_add', product_id: 42 }] });
    await say(avi, 'תוסיף ביסלי לרשימה');
    assert.equal(status(kid), 'pending', 'the child\'s request, after a message about the same product');
  });
  await check('X3', '"עזוב" כשיש כרטיס ממתין: השרת סוגר בלי מודל רק את הכרטיס האחרון של מי שכותב, "בסדר, ביטלתי." (r0t x3, x1); דרך המודל (cancel) גם רק האחרון', async () => {
    sql("INSERT OR IGNORE INTO products (id, name, count_type, qty, created, updated) VALUES (43, 'דבש', 'units', 1, 1, 1), (44, 'ריבה', 'units', 1, 1, 1), (45, 'טחינה', 'units', 1, 1, 1), (46, 'שקדים', 'units', 1, 1, 1)");
    const status = (id) => sql('SELECT status FROM proposals WHERE id = ?', id)[0]?.status;
    const card = async (pid, t) => { answer = () => ({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'list_add', product_id: pid }] }); return (await say(avi, t)).proposal.id; };
    const a1 = await card(43, 'תוסיף דבש לרשימה'), a2 = await card(44, 'תוסיף ריבה לרשימה');
    // a newer card that isn't Avi's own: Yoavi's request to the grown-ups
    answer = () => ({ reply: 'אוקיי.', face: 'happy', actions: [{ kind: 'delete', product_id: 45 }] });
    await say(yoavi, 'תמחק את הטחינה');
    const kid = sql("SELECT id FROM proposals WHERE status = 'pending' AND actions LIKE '%\"product_id\":45%'")[0].id;
    await new Promise((ok) => setTimeout(ok, 1600)); // the grown-ups' card is saved 1.5 seconds ahead
    const n = requests.length;
    const r = await say(avi, 'עזוב');
    assert.equal(r.reply, 'בסדר, ביטלתי.'); assert.equal(requests.length, n, 'without the model');
    assert.equal(status(a2), 'rejected', 'the last of his'); assert.equal(status(a1), 'pending', 'the one before stays'); assert.equal(status(kid), 'pending', 'not the child\'s request');
    // through the model, a "cancel" that isn't a short word: only the last one too
    const a3 = await card(46, 'תוסיף שקדים'); // another product: a card on the same product replaces the old one anyway
    answer = () => ({ reply: 'בסדר.', face: 'happy', actions: [{ kind: 'cancel' }] });
    await say(avi, 'רגע, לא צריך את זה בסוף');
    assert.equal(status(a3), 'rejected'); assert.equal(status(a1), 'pending'); assert.equal(status(kid), 'pending');
  });
  await check('D122', 'מוצר שקונים שלוש פעמים בחנות אחרת: "שמתי לב שאת הפילטר לבריטה אתם קונים בפארם…", ושורה חדשה ברשימה נכנסת לפארם; "לא" מחזיר (r0t d122)', async () => {
    sql("INSERT INTO products (id, name, count_type, qty, store, created, updated) VALUES (47, 'פילטר לבריטה', 'units', 1, 'super', 1, 1)");
    const st = async () => (await call(avi, 'GET', '/api/state')).data;
    const line = async () => (await st()).list.find((i) => i.product_id === 47 && i.status !== 'done');
    for (let k = 0; k < 3; k++) {
      await act(avi, [{ kind: 'list_add', product_id: 47, store: 'pharm' }]);
      await act(avi, [{ kind: 'check', item_id: (await line()).id }]);
      await act(avi, [{ kind: 'finish', store: 'pharm' }]);
    }
    const n = (await st()).noticed.find((x) => x.kind === 'store');
    assert.equal(n?.text, 'את הפילטר לבריטה אתם קונים בפארם, אז אני מכניס אותו לרשימה של הפארם.' /* under the heading "שמתי לב ש..." */, JSON.stringify((await st()).noticed));
    await act(avi, [{ kind: 'list_add', product_id: 47 }]);
    assert.equal((await line()).store, 'pharm', 'the new line goes to the pharm');
    await act(avi, [{ kind: 'list_remove', item_id: (await line()).id }]);
    assert.equal((await call(avi, 'POST', '/api/noticed', { id: n.id, yes: false })).status, 200);
    await act(avi, [{ kind: 'list_add', product_id: 47 }]);
    assert.equal((await line()).store, 'super', 'after "no": the product\'s own store again');
  });
  await check('D122P', 'מוצרים חדשים מקטגוריה שהבית שם במקום מסוים: "אתם שמים מוצרי חלב במקרר במרפסת, אז אני כותב מעכשיו מוצרי חלב חדשים למקרר במרפסת.", ומוצר חדש בלי מקום נכתב לשם; מקום שניתן נשאר; "לא" עוצר (r0t d122, נוסח 12)', async () => {
    const loc = Number(sql("INSERT INTO locations (name, sort) VALUES ('מקרר במרפסת', 70)").lastInsertRowid);
    const dairy = sql("SELECT id FROM categories WHERE name = 'מוצרי חלב, גבינות וביצים'")[0].id;
    const st = async () => (await call(avi, 'GET', '/api/state')).data;
    const placeOf = (name) => sql('SELECT location_id FROM products WHERE name = ? AND deleted IS NULL', name)[0]?.location_id;
    for (const name of ['יוגורט בטעם וניל', 'גבינה בולגרית', 'קוטג\' 5%']) await act(avi, [{ kind: 'create', product: { name, count_type: 'units', qty: 1, category_id: dairy, location_id: loc } }]);
    const n = (await st()).noticed.find((x) => x.kind === 'place');
    assert.equal(n?.text, 'אתם שמים מוצרי חלב במקרר במרפסת, אז אני כותב מעכשיו מוצרי חלב חדשים למקרר במרפסת.', JSON.stringify((await st()).noticed));
    await act(avi, [{ kind: 'create', product: { name: 'שמנת מתוקה', count_type: 'units', qty: 1, category_id: dairy } }]);
    assert.equal(placeOf('שמנת מתוקה'), loc, 'a new one with no place goes there');
    const fridge = sql("SELECT id FROM locations WHERE name = 'מקרר'")[0].id;
    await act(avi, [{ kind: 'create', product: { name: 'חמאה', count_type: 'units', qty: 1, category_id: dairy, location_id: fridge } }]);
    assert.equal(placeOf('חמאה'), fridge, 'a place that was given stays');
    assert.equal((await call(avi, 'POST', '/api/noticed', { id: n.id, yes: false })).status, 200);
    await act(avi, [{ kind: 'create', product: { name: 'לבנה', count_type: 'units', qty: 1, category_id: dairy } }]);
    assert.equal(placeOf('לבנה'), null, 'after "no": as before');
  });
  await check('S28', '"הפסקתי לשמור שבת": השרת מבין לבד שזה כיבוי (§28 יצא מההוראות, r0t trim)', async () => {
    for (const t of ['הפסקתי לשמור שבת', 'הפסקנו לשמור שבת']) {
      answer = () => ({ reply: 'בסדר.', face: 'happy' });
      const r = await say(avi, t);
      assert.equal(r.reply, 'האם תרצה שאחזיר את ההתראות בשבת?', t);
      const p = JSON.parse(sql('SELECT actions FROM proposals WHERE id = ?', r.proposal.id)[0].actions);
      assert.deepEqual(p.actions.map((a) => [a.kind, a.on]), [['shabbat', false]], t);
      await call(avi, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
    }
    // a question about Shabbat isn't the setting
    answer = () => ({ reply: 'עם הרבה סבלנות.', face: 'happy' });
    const q = await say(avi, 'איך לשמור שבת עם ילדים?');
    assert.equal(q.reply, 'עם הרבה סבלנות.'); assert.equal(q.proposal, undefined);
  });
  // stage 9, מ1 (docs/stage9-plan.md): turned over. Whose a product is, in every house now, from the chat and from the app
  await check('R101', '"שלי" בבית שאינו דירת שותפים: owner נשמר, בכלי של המודל ובמה שנשמר, וגם מהאפליקציה (שלב 9, מ1; לפני כן רק בדירת שותפים)', async () => {
    answer = () => ({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'create', product: { name: 'שוקו של אבי', count_type: 'units', qty: 1, owner: 'אבי' } }] });
    const n = requests.length;
    const r = await say(avi, 'יש לי שוקו משלי');
    const schema = requests[n].tools[0].input_schema.properties.actions.items.properties.product.properties;
    assert.ok(schema.owner?.enum?.includes('אבי'), 'owner in the tool, by name');
    await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    assert.equal(sql("SELECT owner FROM products WHERE name = 'שוקו של אבי'")[0].owner, 1, 'kept with Avi as its owner');
    await act(avi, [{ kind: 'edit', product_id: sql("SELECT id FROM products WHERE name = 'שוקו של אבי'")[0].id, fields: { owner: 2 } }]);
    assert.equal(sql("SELECT owner FROM products WHERE name = 'שוקו של אבי'")[0].owner, 2, 'from the app too');
    await act(avi, [{ kind: 'edit', product_id: sql("SELECT id FROM products WHERE name = 'שוקו של אבי'")[0].id, fields: { owner: 99 } }]);
    assert.equal(sql("SELECT owner FROM products WHERE name = 'שוקו של אבי'")[0].owner, 2, 'not someone who isn\'t in the house');
    await act(avi, [{ kind: 'edit', product_id: sql("SELECT id FROM products WHERE name = 'שוקו של אבי'")[0].id, fields: { owner: null } }]);
    assert.equal(sql("SELECT owner FROM products WHERE name = 'שוקו של אבי'")[0].owner, null, 'cleared');
  });
  await check('C11', 'מצב פסח: שוקי שואל פעם אחת "האם אוכלים קטניות בפסח?"; "לא" = קטניות כמו חמץ (לא לרשימה, ומה שנכנס לבד יורד), בלי לקרוא להן חמץ; "כן" = כמו היום; כיבוי מחזיר (r0t trim c11)', async () => {
    sql("DELETE FROM settings WHERE key LIKE 'ask:%' OR key LIKE 'askq:%' OR key = 'kitniyot_asked'"); sql("DELETE FROM facts WHERE about = 'house' AND key = 'kitniyot'");
    sql("INSERT INTO products (id, name, count_type, qty, is_basic, target, created, updated) VALUES (48, 'אורז בסמטי', 'units', 2, 1, 1, 1, 1), (49, 'שעועית לבנה', 'units', 2, 1, 1, 1, 1)");
    const onList = async (id) => (await call(avi, 'GET', '/api/state')).data.list.some((i) => i.product_id === id && i.status === 'open');
    const asks = () => sql("SELECT content FROM chat WHERE thread = 1 AND content LIKE '%האם אוכלים קטניות בפסח?%'").length;
    assert.equal((await call(avi, 'POST', '/api/settings', { pesach: true })).status, 200);
    assert.equal(sql('SELECT kitniyot FROM products WHERE id = 48')[0].kitniyot, 1, 'classified');
    assert.equal(asks(), 1, 'asked once, in his chat');
    assert.deepEqual(JSON.parse(sql("SELECT content FROM chat WHERE thread = 1 AND content LIKE '%האם אוכלים קטניות בפסח?%'")[0].content).options, ['כן, אוכלים', 'לא אוכלים']); // r0t-8
    // before the answer: as today, the beans go on the list by themselves
    await act(avi, [{ kind: 'op', product_id: 49, op: { type: 'out' } }]);
    assert.equal(await onList(49), true, 'not answered yet: as before');
    assert.equal((await say(avi, 'לא')).reply, 'בסדר.');
    assert.equal(sql("SELECT value FROM facts WHERE about = 'house' AND key = 'kitniyot'")[0]?.value, 'לא');
    assert.equal(await onList(49), false, '"no" in Passover: what came on the list by itself goes');
    await act(avi, [{ kind: 'op', product_id: 48, op: { type: 'out' } }]);
    assert.equal(await onList(48), false, 'in a house that doesn\'t eat kitniyot: off the list on Passover');
    // "צור לי רשימה": the kitniyot stay off, and Shuki doesn't call them chametz; the model sees "קטניות, לא בפסח"
    await act(avi, [{ kind: 'op', product_id: 7, op: { type: 'out' } }]); // something to add, so the server writes the reply
    sql("DELETE FROM list_items WHERE product_id = 7");
    answer = () => ({ reply: 'הנה.', face: 'happy' });
    const n = requests.length;
    const r = await say(avi, 'צור לי רשימה');
    assert.doesNotMatch(r.reply || '', /חמץ/, r.reply); assert.match(r.reply || '', /לא הוספתי: אורז בסמטי ושעועית לבנה, כי בבית לא אוכלים קטניות בפסח\./, r.reply); assert.match(r.reply || '', /^האם תרצו שאוסיף לרשימה: [^?]+\?/, r.reply); /* b03 */ /* r0t-9 */ assert.ok(!(r.proposal?.lines || []).some((l) => /אורז|שעועית/.test(l.text)), JSON.stringify(r.proposal));
    assert.match(JSON.stringify(requests[n].system), /אורז בסמטי[^"]*קטניות, לא בפסח/);
    // turned off: back on the list; on again: not asked again
    await call(avi, 'POST', '/api/settings', { pesach: false });
    assert.equal(await onList(48), true, 'Passover over: back on the list');
    await call(avi, 'POST', '/api/settings', { pesach: true });
    assert.equal(asks(), 1, 'asked once');
    await call(avi, 'POST', '/api/settings', { pesach: false });
    // asked again from scratch, and "כן" through the chat: as before
    sql("DELETE FROM facts WHERE about = 'house' AND key = 'kitniyot'"); sql("DELETE FROM settings WHERE key = 'kitniyot_asked'");
    await call(avi, 'POST', '/api/settings', { pesach: true });
    assert.equal((await say(avi, 'כן, אוכלים')).reply, 'סגור!'); // the button (r0t-8)
    assert.equal(sql("SELECT value FROM facts WHERE about = 'house' AND key = 'kitniyot'")[0]?.value, 'כן');
    await act(avi, [{ kind: 'op', product_id: 49, op: { type: 'out' } }]);
    assert.equal(await onList(49), true, 'kitniyot eaten: on the list');
    await call(avi, 'POST', '/api/settings', { pesach: false });
  });
  await check('C11B', 'שאלת הקטניות לא דורסת שאלה פתוחה של מי שהפעיל: היא מחכה עד שהוא עונה על שלו (r0t trim c11, כמו r0t-4)', async () => {
    sql("DELETE FROM settings WHERE key LIKE 'ask:%' OR key LIKE 'askq:%' OR key = 'kitniyot_asked'"); sql("DELETE FROM facts WHERE about = 'house' AND key = 'kitniyot'");
    sql("INSERT INTO settings (key, value) VALUES ('ask:1', ?)", JSON.stringify({ actions: [], done: 'סגור!', nope: 'בסדר, לא אזכור.', ts: Date.now() }));
    const before = sql("SELECT COUNT(*) AS n FROM chat WHERE content LIKE '%האם אוכלים קטניות בפסח?%'")[0].n;
    await call(avi, 'POST', '/api/settings', { pesach: true });
    assert.match(sql("SELECT value FROM settings WHERE key = 'ask:1'")[0].value, /לא אזכור/, 'his question stays');
    assert.equal(sql("SELECT COUNT(*) AS n FROM chat WHERE content LIKE '%האם אוכלים קטניות בפסח?%'")[0].n, before, 'not asked yet');
    // the owner 05/10: asked only once it really is, and a question waiting longer than a day in the queue is still asked
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'kitniyot_asked'")[0].n, 0, 'counted as asked while it waits');
    const q = JSON.parse(sql("SELECT value FROM settings WHERE key = 'askq:1'")[0].value); q.forEach((x) => (x.ts -= 3 * 86400e3));
    sql("UPDATE settings SET value = ? WHERE key = 'askq:1'", JSON.stringify(q));
    assert.equal((await say(avi, 'לא')).reply, 'בסדר, לא אזכור.', 'his own question answered');
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'kitniyot_asked'")[0].n, 1, 'not counted when asked');
    assert.equal(sql("SELECT COUNT(*) AS n FROM chat WHERE content LIKE '%האם אוכלים קטניות בפסח?%'")[0].n, before + 1, 'asked now');
    assert.equal((await say(avi, 'לא')).reply, 'בסדר.');
    assert.equal(sql("SELECT value FROM facts WHERE about = 'house' AND key = 'kitniyot'")[0]?.value, 'לא');
    await call(avi, 'POST', '/api/settings', { pesach: false });
  });
  await check('C64', 'שאלה 64 (הבודק): חופשה שתאריך החזרה שלה עבר לא יוצאת מהתור; קטניות בתור של מי שכבר לא בבית לא חוסמות', async () => {
    sql("DELETE FROM settings WHERE key LIKE 'ask:%' OR key LIKE 'askq:%' OR key = 'kitniyot_asked'"); sql("DELETE FROM facts WHERE about = 'house' AND key = 'kitniyot'");
    const away = { ask: { actions: [], away: { until: '2020-01-01' }, done: 'סגור!', nope: 'בסדר.', choices: { 'כן, להפעיל': {}, 'לא צריך': { no: true } } }, bubble: { askOnly: true, reply: 'האם להפעיל מצב חופשה עד ה-1.1?', options: ['כן, להפעיל', 'לא צריך'] }, ts: Date.now() };
    sql("INSERT INTO settings (key, value) VALUES ('askq:1', ?)", JSON.stringify([away]));
    answer = () => ({ reply: 'אני פה!', face: 'happy' });
    await say(avi, 'היי');
    assert.equal(sql("SELECT COUNT(*) AS n FROM chat WHERE content LIKE '%האם להפעיל מצב חופשה עד ה-1.1%'")[0].n, 0, 'a vacation that ended was asked');
    sql("INSERT OR REPLACE INTO users (id, name, gender, role, active, created) VALUES (9, 'עזב', 'm', 'member', 0, 0)");
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('askq:9', ?)", JSON.stringify([{ ask: { actions: [], kitniyot: true }, bubble: { reply: 'x' }, ts: Date.now() }]));
    const before = sql("SELECT COUNT(*) AS n FROM chat WHERE content LIKE '%האם אוכלים קטניות בפסח?%'")[0].n;
    await call(avi, 'POST', '/api/settings', { pesach: true });
    assert.equal(sql("SELECT COUNT(*) AS n FROM chat WHERE content LIKE '%האם אוכלים קטניות בפסח?%'")[0].n, before + 1, 'held back by the queue of one who left');
    await call(avi, 'POST', '/api/settings', { pesach: false });
    sql("DELETE FROM settings WHERE key IN ('askq:9', 'ask:1')");
    // 65 (the owner 05/10): "אגב, שמתי לב ש…" waiting more than three days in the queue goes, and isn't marked asked
    sql("INSERT OR REPLACE INTO noticed (id, key, kind, user_id, count, first, last, status) VALUES (990, 'c65', 'weekly', 1, 3, 0, 0, 'asked')");
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('askq:1', ?)", JSON.stringify([{ ask: { actions: [{ kind: 'lesson', text: 'x', noticed: 990 }] }, bubble: { reply: 'אגב, שמתי לב שמשהו. האם תרצה שאזכור את זה?' }, ts: Date.now() - 4 * 86400e3 }]));
    await say(avi, 'היי');
    assert.equal(sql("SELECT COUNT(*) AS n FROM chat WHERE content LIKE '%אגב, שמתי לב שמשהו%'")[0].n, 0, 'asked after three days');
    assert.equal(sql('SELECT status FROM noticed WHERE id = 990')[0].status, 'expired', '66: not marked expired (asked again only when seen anew)');
    sql('DELETE FROM noticed WHERE id = 990');
  });
  await check('R07', 'תזכורת יומית: "להזכיר כל יום להכין קופסאות" / "כל יום ב-19:00, מחר בפעם הראשונה"; נשלחת וזזה ליום הבא; נעצרת מהצ\'אט ("להפסיק להזכיר כל יום…") ומ"כבר לא צריך"; תזכורת שאינה לקנייה יורדת אחרי שנשלחה (r0t-7, 04/10)', async () => {
    sql("DELETE FROM settings WHERE key LIKE 'ask:%' OR key LIKE 'askq:%' OR key LIKE 'pushes:%' OR key LIKE 'later:%'");
    sql(`UPDATE devices SET push_sub = '{"endpoint":"http://127.0.0.1:${MOCK}/push","keys":{"p256dh":"x","auth":"y"}}', push_on = 1`);
    const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(Date.now() + 86400e3);
    answer = () => ({ reply: 'לקבוע?', face: 'happy', actions: [{ kind: 'remind', text: 'להכין קופסאות', date: tomorrow, time: '19:00', repeat: 'daily' }] });
    let r = await say(avi, 'תזכיר לי כל ערב ב-7 להכין קופסאות');
    assert.equal(r.proposal.lines[0].text, 'להזכיר כל יום להכין קופסאות?'); /* every card line ends with ? (round 21) */ assert.equal(r.proposal.lines[0].detail, 'כל יום ב-19:00, מחר בפעם הראשונה');
    await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    const row = () => sql("SELECT * FROM maybe WHERE text = 'להכין קופסאות' ORDER BY id DESC LIMIT 1")[0];
    const first = row(); assert.equal(first.repeat, 'daily');
    // a first time later than tomorrow: "ביום X D.M בפעם הראשונה" (the owner 04/10)
    const later = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(Date.now() + 5 * 86400e3);
    answer = () => ({ reply: 'לקבוע?', face: 'happy', actions: [{ kind: 'remind', text: 'להשקות עציצים', date: later, time: '08:30', repeat: 'daily' }] });
    const rl = await say(avi, 'תזכיר לי כל בוקר להשקות עציצים, מיום חמישי');
    const [, lm, ld] = later.split('-').map(Number);
    assert.match(rl.proposal.lines[0].detail, new RegExp(`^כל יום ב-08:30, ביום \\S+ ${ld}\\.${lm} בפעם הראשונה$`), rl.proposal.lines[0].detail);
    await call(avi, 'POST', `/api/proposals/${rl.proposal.id}/reject`, {});
    const out = (await call(avi, 'POST', '/api/__schedule', { now: first.due_at + 60e3 })).data;
    assert.equal(out.reminders, 1, JSON.stringify(out).slice(0, 200));
    assert.equal(row().due_at, first.due_at + 86400e3, 'the next day'); assert.equal(row().decided, null); assert.equal(row().asked, null);
    // the model sees it, and stops it from the chat
    answer = () => ({ reply: 'להפסיק?', face: 'happy', actions: [{ kind: 'remind', off: true, id: first.id, text: 'להכין קופסאות' }] });
    const n = requests.length;
    r = await say(avi, 'די להזכיר על הקופסאות');
    assert.match(JSON.stringify(requests[n].system), new RegExp(`תזכורות יומיות של אבי: #${first.id} להכין קופסאות \\(19:00\\)`));
    assert.equal(r.proposal.lines[0].text, 'להפסיק להזכיר כל יום להכין קופסאות?');
    await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    assert.ok(row().decided, 'stopped from the chat');
    // another one, stopped with "כבר לא צריך"
    answer = () => ({ reply: 'לקבוע?', face: 'happy', actions: [{ kind: 'remind', text: 'להכין קופסאות', date: tomorrow, time: '19:00', repeat: 'daily' }] });
    r = await say(avi, 'תזכיר לי כל ערב להכין קופסאות'); await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    const second = row();
    assert.equal((await call(avi, 'POST', '/api/maybe', { id: second.id, decision: 'drop' })).status, 200);
    assert.ok(!(await call(avi, 'POST', '/api/__schedule', { now: second.due_at + 60e3 })).data.reminders, 'stopped: not sent');
    // a cooking reminder, once: after it went out it leaves "תזכורות"
    answer = () => ({ reply: 'לקבוע?', face: 'happy', actions: [{ kind: 'remind', text: 'להוציא עוף מהמקפיא', date: tomorrow, time: '17:00' }] });
    r = await say(avi, 'תזכיר לי מחר בחמש להוציא עוף מהמקפיא'); await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    const once = sql("SELECT * FROM maybe WHERE text = 'להוציא עוף מהמקפיא'")[0];
    assert.equal((await call(avi, 'POST', '/api/__schedule', { now: once.due_at + 60e3 })).data.reminders, 1);
    assert.ok(!(await call(avi, 'GET', '/api/state')).data.maybe.some((m) => m.id === once.id), 'gone from "תזכורות"');
    // stopping one that isn't there: no card that says it stops
    answer = () => ({ reply: 'להפסיק?', face: 'happy', actions: [{ kind: 'remind', off: true, text: 'לנקות את המקרר' }] });
    assert.equal((await say(avi, 'די להזכיר לנקות את המקרר')).proposal, undefined, 'no such daily reminder');
    // a private daily reminder goes out every day too (the hidden branch)
    sql("INSERT INTO maybe (text, product_id, store, added_by, added, due_at, kind, repeat, private_to) VALUES ('לקנות קונדומים', NULL, 'super', 1, 1, ?, 'remind', 'daily', 1)", first.due_at); // private as the app writes it now (0024)
    const priv = sql("SELECT * FROM maybe WHERE text = 'לקנות קונדומים'")[0];
    await call(avi, 'POST', '/api/__schedule', { now: priv.due_at + 60e3 });
    const p2 = sql('SELECT * FROM maybe WHERE id = ?', priv.id)[0];
    assert.equal(p2.asked, null, 'a private daily one'); assert.ok(p2.due_at > priv.due_at + 60e3, 'moved on');
    sql('DELETE FROM maybe WHERE id = ?', priv.id);
  });
  await check('V12', 'חופשה שמחכה מאחורי שאלה על כלל: נשאלת אחרי שעונים עליה, עם "כן, להפעיל" / "לא צריך" (c12, r0t-6)', async () => {
    sql("DELETE FROM settings WHERE key LIKE 'ask:%' OR key LIKE 'askq:%'"); sql('DELETE FROM away');
    sql("INSERT INTO lessons (text, added, added_by) VALUES ('לא קונים ביסלי', 1, 1)");
    const until = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(Date.now() + 5 * 86400e3);
    const [, mm, dd] = until.split('-').map(Number);
    answer = () => ({ reply: 'נסיעה טובה!', face: 'happy', actions: [{ kind: 'list_add', product_id: 42 }], away: { until } });
    let r = await say(avi, 'טסים מחר, ותוסיף ביסלי');
    assert.match(r.reply, /^זכור לי ש/, 'the rule\'s question first'); // 17/10, ש5
    assert.equal(sql('SELECT COUNT(*) AS n FROM away')[0].n, 0);
    r = await say(avi, 'לא');
    assert.equal(r.reply, 'בסדר, לא הוספתי.');
    const q = sql("SELECT content FROM chat WHERE thread = 1 AND content LIKE '%להפעיל מצב חופשה%' ORDER BY id DESC LIMIT 1").map((x) => JSON.parse(x.content))[0];
    assert.equal(q?.reply, `האם להפעיל מצב חופשה עד ה-${dd}.${mm}?`); assert.deepEqual(q.options, ['כן, להפעיל', 'לא צריך']);
    assert.equal((await say(avi, 'כן, להפעיל')).reply, 'סגור!');
    assert.equal(sql('SELECT COUNT(*) AS n FROM away')[0].n, 1, 'kept after the yes');
    sql('DELETE FROM away'); sql("DELETE FROM lessons WHERE text = 'לא קונים ביסלי'");
    // next to a card: the card now, the vacation's question after it (decision 160)
    sql("DELETE FROM settings WHERE key LIKE 'ask:%' OR key LIKE 'askq:%'");
    const asked = () => sql("SELECT COUNT(*) AS n FROM chat WHERE thread = 1 AND content LIKE '%להפעיל מצב חופשה%'")[0].n, before = asked();
    answer = () => ({ reply: 'נסיעה טובה!', face: 'happy', actions: [{ kind: 'list_add', product_id: 7 }], away: { until } });
    r = await say(avi, 'טסים מחר, ותוסיף חלב');
    assert.ok(r.proposal, 'the card'); assert.equal(r.options, undefined, 'no vacation buttons next to it');
    assert.equal(asked(), before, 'not asked yet');
    await call(avi, 'POST', `/api/proposals/${r.proposal.id}/reject`, {}); // the card decided: now the question
    const q2 = sql("SELECT content FROM chat WHERE thread = 1 AND content LIKE '%להפעיל מצב חופשה%' ORDER BY id DESC LIMIT 1").map((x) => JSON.parse(x.content))[0];
    assert.deepEqual(q2?.options, ['כן, להפעיל', 'לא צריך']);
    assert.equal((await say(avi, 'כן, להפעיל')).reply, 'סגור!'); assert.equal(sql('SELECT COUNT(*) AS n FROM away')[0].n, 1);
    sql('DELETE FROM away');
    // the card closed with "עזוב" (x3): the question comes right after
    const b2 = asked();
    r = await say(avi, 'טסים מחר, ותוסיף חלב');
    assert.ok(r.proposal); assert.equal(asked(), b2, 'not next to the card');
    assert.equal((await say(avi, 'עזוב')).reply, 'בסדר, ביטלתי.');
    assert.equal(asked(), b2 + 1, 'asked once the card closed');
    assert.equal((await say(avi, 'לא צריך')).reply, 'בסדר.'); assert.equal(sql('SELECT COUNT(*) AS n FROM away')[0].n, 0);
  });
  await check('D85', 'מעבר דירה: הקטלוג שהמודל מקבל בלי "צפוי להיגמר", כמו שהשרת כבר מרוקן את "עומד להיגמר" (r0t d85, קבוצה ג\')', async () => {
    sql("INSERT INTO products (id, name, count_type, qty, is_basic, target, created, updated) VALUES (85, 'קפה שחור', 'units', 1, 1, 1, 1, 1)");
    const D = 86400e3, t = Date.now();
    for (const d of [42, 32, 22, 12]) sql("INSERT INTO product_log (event_id, ts, product_id, kind) VALUES (0, ?, 85, 'purchase')", t - d * D);
    for (const d of [33, 23, 13]) sql("INSERT INTO product_log (event_id, ts, product_id, kind) VALUES (0, ?, 85, 'out')", t - d * D);
    const line = async () => { answer = () => ({ reply: 'היי', face: 'happy' }); const n = requests.length; await say(avi, 'היי'); return (JSON.stringify(requests[n].system).match(/קפה שחור[^"\\]*/) || [''])[0]; };
    assert.match(await line(), /צפוי להיגמר/, 'before the move: it says when it will run out');
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('moving', ?)", String(t + 10 * D));
    const l = await line();
    assert.doesNotMatch(l, /צפוי להיגמר/, l); assert.match(l, /קצב/, 'the pace itself stays');
    sql("DELETE FROM settings WHERE key = 'moving'");
  });
  await check('R980', 'עובדה שנגמרה: כרטיס "לשכוח שמיכל לא אוכלת פטריות?", ואחרי אישור "סגור, שכחתי."; בהריון בלי "סגור, שכחתי." (r0t r9-80, אושר 03/10)', async () => {
    sql("DELETE FROM facts WHERE about_id = 2");
    const mush = fact(2, 'avoid', 'פטריות');
    answer = () => ({ reply: 'לשכוח?', face: 'happy', actions: [{ kind: 'fact_end', key: 'avoid', about: 'מיכל', value: 'פטריות', text: 'מיכל לא אוכלת פטריות' }] });
    let r = await say(michal, 'אני כבר אוכלת פטריות');
    assert.deepEqual(r.proposal.lines.map((l) => l.text), ['לשכוח שמיכל לא אוכלת פטריות?']);
    const t0 = Date.now();
    assert.equal((await call(michal, 'POST', `/api/proposals/${r.proposal.id}/apply`, {})).status, 200);
    assert.equal(sql('SELECT COUNT(*) AS n FROM facts WHERE id = ?', mush)[0].n, 0);
    // what Shuki said to her after the approval (D186's card to the grown-ups is saved 1.5 seconds ahead)
    const after = (t) => sql("SELECT content FROM chat WHERE thread = 2 AND role = 'shuki' AND ts >= ?", t).map((x) => JSON.parse(x.content).reply);
    assert.ok(after(t0).includes('סגור, שכחתי.'), JSON.stringify(after(t0)));
    const preg = fact(2, 'pregnancy', 'כן', { private: 1 });
    sql(`INSERT OR REPLACE INTO settings (key, value) VALUES ('preg_asked:${preg}', '1')`);
    answer = () => ({ reply: 'אני כאן איתך.', face: 'sad', actions: [{ kind: 'fact_end', key: 'pregnancy', about: 'מיכל', text: 'מיכל בהריון' }] });
    // what is written from here on, by row id: a bubble of the step before may be saved a little ahead in time (a race on a fast run)
    const id1 = sql('SELECT MAX(id) AS m FROM chat')[0].m ?? 0;
    r = await say(michal, 'אני כבר לא בהריון');
    // stage 8 (round D, the Hebrew reviewer; question 49): it ends at once, no card ("האם לשכוח שמיכל בהריון?" read as forgetting a loss)
    assert.equal(r.proposal, undefined, 'a card');
    assert.equal(sql('SELECT COUNT(*) AS n FROM facts WHERE id = ?', preg)[0].n, 0);
    const since = sql("SELECT content FROM chat WHERE thread = 2 AND role = 'shuki' AND id > ?", id1).map((x) => JSON.parse(x.content).reply);
    assert.ok(since.length, 'no answer was saved'); assert.ok(!since.includes('סגור, שכחתי.'), 'after a pregnancy ended (it may be a loss)');
  });

  await check('D147', 'שוקי לא זוכר הודעות מאתמול: רק מהיום, מ-04:00 (r0t d147, החלטה 147)', async () => {
    sql("INSERT INTO chat (ts, user_id, role, content, thread) VALUES (?, 1, 'user', ?, 1)", Date.now() - 30 * 3600e3, JSON.stringify({ text: 'מחר אני מבשל לזניה' }));
    answer = () => ({ reply: 'בתיאבון!', face: 'happy' });
    const n = requests.length;
    await say(avi, 'מה אני מבשל היום?');
    const msgs = JSON.stringify(requests.slice(n).map((r) => r.messages));
    assert.ok(!msgs.includes('לזניה'), 'yesterday\'s plan reached the model');
    assert.ok(msgs.includes('מה אני מבשל היום?'), 'today\'s message');
  });

  await check('R9100', 'בן בית שמצטרף: "האם יש משהו שאת לא אוכלת?"; התשובה, באותה קריאה למודל, נשמרת כעובדה שלה, בנוסח שאושר ("רשמתי שאת לא אוכלת פטריות.", r0t r9-100)', async () => {
    const add = await call(avi, 'POST', '/api/members', { add: { name: 'שירה', gender: 'f' } });
    const shira = (await call(null, 'POST', '/api/pair', { code: add.data.code })).data.token;
    const said = (await call(shira, 'GET', '/api/chat')).data.messages.filter((m) => m.role === 'shuki').map((m) => m.content.reply);
    assert.equal(said.at(-1), 'האם יש משהו שאת לא אוכלת?', said.join(' | '));
    answer = () => ({ reply: 'האם תרצה שאזכור?', face: 'happy', actions: [{ kind: 'fact', key: 'avoid', about: 'שירה', value: 'פטריות', text: 'שירה לא אוכלת פטריות' }] });
    await new Promise((ok) => setTimeout(ok, 50)); // the hello's rows are a few ms ahead of the pairing; nobody answers that fast
    const n = requests.length;
    const r = await say(shira, 'פטריות, אני לא סובלת');
    assert.equal(requests.length, n + 1, 'one call to the model, as for any message');
    assert.match(JSON.stringify(requests.at(-1).messages.at(-1)), /קודם שאלת: \\"האם יש משהו שאת לא אוכלת\?\\"/);
    assert.equal(r.reply, 'רשמתי שאת לא אוכלת פטריות. האם יש משהו בסגנון החיים שלך שכדאי שאדע? למשל אימונים, דיאטה או הריון.', 'the approved words, not "סגור, אזכור ש…", and then the lifestyle question (stage 8, ז2, question 18)');
    const id = sql("SELECT id FROM users WHERE name = 'שירה'")[0].id;
    assert.equal(sql("SELECT value FROM facts WHERE about = 'person' AND about_id = ? AND key = 'avoid'", id)[0]?.value, 'פטריות');
    // asked once: the next message is an ordinary one, without the note
    answer = () => ({ reply: 'שלום!', face: 'happy' });
    assert.equal((await say(shira, 'היי')).reply, 'שלום!');
    assert.doesNotMatch(JSON.stringify(requests.at(-1).messages.at(-1)), /קודם שאלת: \\"האם יש משהו שאת לא אוכלת/); // the food question once; the lifestyle one comes after it (stage 8, ז2, question 18)
    assert.match(JSON.stringify(requests.at(-1).messages.at(-1)), /קודם שאלת: \\"האם יש משהו בסגנון החיים שלך/);
  });

  await check('D185', 'ילד כותב מוצר חדש במסך הרשימה: מה שהאפליקציה שולחת עכשיו יוצר מוצר, והשורה מחכה לאישור הורה (r0t d185, החלטה 185)', async () => {
    // the same actions public/app.js addToList sends for a new name (a child's too, now)
    const r = await act(yoavi, [{ kind: 'list_add', text: 'מסטיק', store: 'super' }, { kind: 'create', product: { name: 'מסטיק', category_id: 'אחר', qty: 0 } }]);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const p = sql("SELECT id FROM products WHERE name = 'מסטיק' AND deleted IS NULL")[0];
    assert.ok(p, 'no product');
    const line = sql("SELECT product_id, text, approved FROM list_items WHERE (product_id = ? OR text = 'מסטיק') AND status = 'open'", p.id);
    assert.deepEqual(line.map((x) => ({ ...x })), [{ product_id: p.id, text: null, approved: 0 }]);
  });

  await check('R108', 'כיבוי מצב הפסח: חמץ קבוע שנגמר בחג חוזר לרשימה מיד (r0t r10-8, r10 q055)', async () => {
    sql("INSERT INTO products (id, name, count_type, qty, is_basic, target, chametz, created, updated) VALUES (60, 'פיתות', 'units', 0, 1, 1, 1, 1, 1)");
    assert.equal((await call(avi, 'POST', '/api/settings', { pesach: true })).status, 200);
    // b03 (05/10): "צור לי רשימה" on Passover: "לא הוספתי: פיתות, כי זה חמץ ועכשיו פסח."
    await act(avi, [{ kind: 'op', product_id: 7, op: { type: 'out' } }]); sql("DELETE FROM list_items WHERE product_id IN (7, 60)");
    answer = () => ({ reply: 'הנה.', face: 'happy' });
    const pr = await say(avi, 'צור לי רשימה');
    assert.match(pr.reply || '', /לא הוספתי: פיתות, כי זה חמץ ועכשיו פסח\./, pr.reply);
    if (pr.proposal) await call(avi, 'POST', `/api/proposals/${pr.proposal.id}/reject`, {});
    sql("DELETE FROM list_items WHERE product_id = 60");
    assert.equal((await call(avi, 'POST', '/api/settings', { pesach: false })).status, 200);
    assert.equal(sql("SELECT COUNT(*) AS n FROM list_items WHERE product_id = 60 AND status = 'open'")[0].n, 1, 'still off the list after Passover');
  });

  await check('R937', '"מה הכנו ביום שישי?": שורה לכל בישול עם תאריך ויום, מ"הכנתי X" (r0t r9-37)', async () => {
    sql("INSERT INTO recipes (id, name, added) VALUES (70, 'שקשוקה', 1)");
    answer = () => ({ reply: 'בתיאבון!', face: 'excited' });
    await say(avi, 'הכנתי שקשוקה');
    assert.equal(sql('SELECT COUNT(*) AS n FROM cooked_log WHERE recipe_id = 70')[0].n, 1, 'no dated line');
    answer = () => ({ reply: 'שקשוקה.', face: 'happy' });
    const n = requests.length;
    await say(avi, 'מה הכנו השבוע?');
    assert.match(JSON.stringify(requests.slice(n).map((r) => r.system)), /בישולים \(חדש לישן\): שקשוקה \d{4}-\d{2}-\d{2} \(יום \S+\)/);
  });

  await check('R103', 'תחליף נשמר עם מספרי המוצרים, ומתחבר מחדש לפי השם כשהמוצר חוזר (r0t r10-3, r10 q036, q108)', async () => {
    sql("DELETE FROM facts WHERE key = 'substitute'"); sql("DELETE FROM settings WHERE key LIKE 'learnask:%' OR key LIKE 'ask:%'");
    answer = () => ({ reply: 'האם תרצה שאזכור?', face: 'happy', actions: [{ kind: 'fact', key: 'substitute', about: 'מיכל', value: 'חלב → חלב סויה', text: 'כשאין חלב מיכל שותה חלב סויה' }] });
    await say(michal, 'תזכור שכשאין חלב אני שותה סויה');
    const v = JSON.parse(sql("SELECT value FROM facts WHERE key = 'substitute'")[0]?.value || 'null');
    assert.deepEqual(v, { from: { id: 7, name: 'חלב' }, to: { id: 8, name: 'חלב סויה' } });
    // after "להתחיל מהתחלה" the product comes back with a new number
    sql("UPDATE products SET deleted = 1 WHERE id = 8");
    sql("INSERT INTO products (id, name, count_type, qty, created, updated) VALUES (99, 'חלב סויה', 'units', 1, 1, 1)");
    await call(michal, 'GET', '/api/state');
    assert.equal(JSON.parse(sql("SELECT value FROM facts WHERE key = 'substitute'")[0].value).to.id, 99, 'not found again by name');
  });

  // ---- CHECKS ----
} finally {
  srv.kill(); mock.close();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length}`);
  if (bad.length) { console.log(log.slice(-3000)); process.exitCode = 1; }
}
