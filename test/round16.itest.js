// Round 16 (27/09): the month's cost and the cap, the daily backup and going back a day, 👎, a quiet house,
// "only mine", a child can't delete, a card that deletes a lot asks twice, the Hebrew of the card lines.
// Run: node test/round16.itest.js
import './fetch-retry.js';
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';

const STATE = '/tmp/shuki-test/shuki-r16';
const PORT = 8766, MOCK = 8764;
const d1 = (sql) => JSON.parse(execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --json --command "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^[^[]*/, ''))[0].results;
rmSync(STATE, { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply shuki --local --persist-to ${STATE}`, { stdio: 'ignore' });
execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --file test/fixture-house.sql`, { stdio: 'ignore' });
d1(`INSERT INTO pairing_codes (code, user_id, expires) VALUES ('481516', 1, 9999999999999), ('234234', 2, 9999999999999)`);

const script = []; const calls = [];
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { const b = Buffer.concat(parts).toString('utf8'); // bytes first: a Hebrew letter can be split between chunks (question 29)

  calls.push(JSON.parse(b));
  const input = script.shift() || { reply: 'ok', face: 'happy' };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'tool_use', id: 'tu1', name: 'respond', input }], usage: { input_tokens: 100000, output_tokens: 10000 } }));
}); }).listen(MOCK);
const dev = spawn('npx', ['wrangler', 'dev', '--local', '--test-scheduled', '--port', String(PORT), '--persist-to', STATE, '--var', `ANTHROPIC_URL:http://127.0.0.1:${MOCK}/v1/messages`, '--var', 'ANTHROPIC_API_KEY:t', '--var', 'TEST_RESET:1', '--var', 'VAPID_PUBLIC:BMMdXvS-VuZiLvO1dnln5--ThCfc4M25IulaMpiMQcLf_Vr-OuNxtjBm4R-Gl8osOtEdudLwFZ0bBuVCLJwKEo'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = ''; dev.stdout.on('data', (d) => (log += d)); dev.stderr.on('data', (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
const call = async (t, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const txt = await r.text(); let data = null; try { data = JSON.parse(txt); } catch { /* text */ } return { status: r.status, data, text: txt }; };
const state = async (t) => (await call(t, 'GET', '/api/state')).data;
const results = [];
async function check(id, name, fn) {
  try { const note = await fn(); results.push({ id, name, ok: true, note: note || '' }); console.log('✓', id, name, note ? `— ${note}` : ''); }
  catch (e) { results.push({ id, name, ok: false, error: e.message.slice(0, 400) }); console.log('✗', id, name, '\n   ', e.message.slice(0, 400)); }
}
const DAY = 86400e3;
const act = (t, actions, extra = {}) => call(t, 'POST', '/api/actions', { actions, op_id: `op-${Math.random()}`, ...extra });
const tick = async () => { const n = log.length; await fetch(`${base}/__scheduled?cron=0+*+*+*+*`); await new Promise((r) => setTimeout(r, 1500)); const m = log.slice(n).match(/schedule \S+ (\{.*\})/); return m ? JSON.parse(m[1]) : null; };
const P = (s, name) => s.products.find((p) => p.name === name);
const month = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).format(new Date());
const chatSay = async (t, text, out) => { script.push(out); return (await call(t, 'POST', '/api/chat', { text })).data; };
const lastBot = async (t) => (await call(t, 'GET', '/api/chat')).data.messages.filter((m) => m.role === 'shuki').at(-1);

let avi, michal, kid;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  avi = (await call(null, 'POST', '/api/pair', { code: '481516', name: 'iPhone' })).data.token;
  michal = (await call(null, 'POST', '/api/pair', { code: '234234', name: 'iPhone' })).data.token;
  await act(avi, [
    { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 1, is_basic: 1, target: 2, shelf_days: 7 } },
    { kind: 'create', product: { name: 'ביצים', count_type: 'pack', pack_size: 12, qty: 12, is_basic: 1, target: 12 } },
    { kind: 'create', product: { name: 'אורז', count_type: 'inuse', qty: 1, is_open: 1 } },
    ...['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז'].map((x) => ({ kind: 'create', product: { name: `תבלין ${x}`, count_type: 'level', level: 'plenty' } })),
  ]);

  await check('C1', 'עלות החודש: המנהל רואה דולרים ותקרה; מיכל לא. התקרה נשמרת רק אצל המנהל, בין $1 ל-$1000', async () => {
    await chatSay(avi, 'היי', { reply: 'היי!', face: 'happy' }); // 100k in, 10k out = $0.20 + $0.10
    let s = await state(avi);
    assert.equal(s.cost.spent, 0.3, JSON.stringify(s.cost)); assert.equal(s.cost.cap, 10);
    assert.equal((await state(michal)).cost, undefined);
    assert.equal((await call(michal, 'POST', '/api/settings', { costCap: 50 })).status, 403);
    assert.equal((await call(avi, 'POST', '/api/settings', { costCap: 0.5 })).status, 400);
    assert.equal((await call(avi, 'POST', '/api/settings', { costCap: 25 })).status, 200);
    s = await state(avi); assert.equal(s.cost.cap, 25); assert.equal(s.cost.own, true);
    return JSON.stringify(s.cost);
  });

  await check('C2', 'ב-80% מהתקרה: התראה למנהלים פעם אחת בחודש; בתקרה הצ\'אט נח בלי לקרוא ל-Claude', async () => {
    d1(`UPDATE usage SET input_tokens = 10000000, output_tokens = 0, micro = 20000000 WHERE month = '${month()}'`); // $20 of $25 = 80%
    const t1 = await tick(); assert.equal(t1?.costWarned, true, JSON.stringify(t1));
    const t2 = await tick(); assert.ok(!t2?.costWarned, 'once a month');
    d1(`UPDATE usage SET input_tokens = 13000000, micro = 26000000 WHERE month = '${month()}'`); // $26
    const n = calls.length;
    const r = await chatSay(avi, 'נגמר החלב', { reply: 'x', face: 'happy' }); script.length = 0;
    assert.match(r.reply, /נגמרה לי הסוללה לחודש הזה\./); assert.equal(calls.length, n, 'no call at the cap');
    d1(`UPDATE usage SET input_tokens = 0, output_tokens = 0, micro = 0 WHERE month = '${month()}'`);
    return r.reply;
  });

  let today;
  await check('B1', 'גיבוי יומי: פעם ביום, בלי סודות; צ\'אט מעל 90 יום נמחק; היומן נשאר', async () => {
    d1(`DELETE FROM backups`);
    d1(`INSERT INTO chat (ts, user_id, role, content) VALUES (${Date.now() - 91 * DAY}, 1, 'user', '{"text":"ישן"}')`);
    await new Promise((r) => setTimeout(r, 1500)); // wrangler's d1 command and the dev server share the files
    let t = null; for (let i = 0; i < 3 && !t?.backup; i++) { try { t = await tick(); } catch { await new Promise((r) => setTimeout(r, 1500)); } }
    assert.ok(t?.backup, JSON.stringify(t)); today = t.backup;
    assert.ok(t.chatDeleted >= 1);
    assert.equal(d1(`SELECT COUNT(*) AS n FROM chat WHERE content LIKE '%ישן%'`)[0].n, 0);
    assert.ok(!(await tick())?.backup, 'once a day');
    const data = d1(`SELECT data FROM backups WHERE day = '${today}' ORDER BY part`).map((r) => r.data).join('');
    assert.ok(!/anthropic_key|privateJwk|token_hash|setup_code/.test(data)); assert.ok(JSON.parse(data).products.length >= 10);
    const list = (await call(avi, 'GET', '/api/backups')).data.backups; assert.equal(list[0].day, today);
    assert.equal((await call(michal, 'GET', '/api/backups')).status, 403);
    return today;
  });

  await check('B2', 'להחזיר ליום קודם: המלאי, הרשימה והיומן חוזרים; הטלפונים נשארים מחוברים; עותק "לפני השחזור" מחזיר את מה שהיה', async () => {
    let s = await state(avi);
    await act(michal, [{ kind: 'op', product_id: P(s, 'חלב 3%').id, op: { type: 'purchase', amount: 3 } }, { kind: 'delete', product_id: P(s, 'אורז').id }, { kind: 'list_add', text: 'נרות' }]);
    await act(avi, [{ kind: 'create', product: { name: 'טחינה', count_type: 'units', qty: 1 } }]);
    script.push({ reply: 'למחוק?', face: 'neutral', actions: [{ kind: 'delete', product_id: P(s, 'ביצים').id }] });
    const pending = (await call(avi, 'POST', '/api/chat', { text: 'תמחק ביצים' })).data.proposal;
    s = await state(avi); assert.equal(P(s, 'חלב 3%').qty, 4); assert.ok(!P(s, 'אורז')); assert.ok(P(s, 'טחינה'));
    assert.equal((await call(michal, 'POST', '/api/backups/restore', { day: today })).status, 403);
    const r = await call(avi, 'POST', '/api/backups/restore', { day: today }); assert.equal(r.status, 200, r.text);
    s = await state(michal); // Michal's phone still works
    assert.equal(P(s, 'חלב 3%').qty, 1); assert.ok(P(s, 'אורז'), 'deleted comes back'); assert.ok(!P(s, 'טחינה'), 'new goes');
    assert.ok(!s.list.some((i) => i.text === 'נרות'));
    assert.match(s.journal[0].summary, /אבי החזיר את הבית לגיבוי/);
    assert.equal((await call(avi, 'POST', `/api/proposals/${pending.id}/apply`, {})).data.status, 'expired', 'cards made before the restore');
    const before = (await call(avi, 'GET', '/api/backups')).data.backups.find((b) => b.day.startsWith('before:')); assert.ok(before);
    await call(avi, 'POST', '/api/backups/restore', { day: before.day });
    s = await state(avi); assert.equal(P(s, 'חלב 3%').qty, 4); assert.ok(P(s, 'טחינה')); assert.ok(!P(s, 'אורז'));
    await call(avi, 'POST', '/api/backups/restore', { day: today });
    return `${r.data.products} מוצרים`;
  });

  await check('B3', 'הורדת גיבוי = אותו תוכן, עם ה-👎 ובלי סודות', async () => {
    const e = await call(avi, 'GET', '/api/export'); assert.equal(e.status, 200);
    assert.ok(Array.isArray(e.data.feedback)); assert.equal(e.data.version, '0.21.0'); assert.ok(!/anthropic_key|vapid|token_hash/.test(e.text));
  });

  await check('F1', '👎: נשמרים רק התשובה וההסבר (r11 q022, r0t p3), בלי השאלה והמלאי; האגודל נשאר לחוץ', async () => {
    await chatSay(michal, 'יש לנו אורז?', { reply: 'אין אורז', face: 'sad' });
    const m = await lastBot(michal);
    assert.equal(m.content.for, 2, 'whose answer');
    const r = await call(michal, 'POST', '/api/feedback', { chat_id: m.id, note: 'יש אורז, פתוח' }); assert.equal(r.status, 200, r.text);
    const f = d1('SELECT * FROM feedback ORDER BY id DESC LIMIT 1')[0];
    assert.equal(f.question, ''); assert.match(f.reply, /אין אורז/); assert.equal(f.note, 'יש אורז, פתוח'); assert.equal(f.state, '');
    assert.equal((await lastBot(michal)).content.down, true);
    assert.equal((await call(michal, 'POST', '/api/feedback', { chat_id: 999999 })).status, 400);
  });

  await check('I1', 'בית ששקט שבועיים: שוקי מציע פעם אחת לעבור; "כן, נעבור" = בדיקה של הקבועים והמתכלים, בלי Claude', async () => {
    d1(`UPDATE events SET ts = ts - ${16 * DAY}`);
    const msgs = (await call(avi, 'GET', '/api/chat')).data.messages;
    const offer = msgs.at(-1); assert.equal(offer.content.offer, 'idle'); assert.deepEqual(offer.content.options, ['כן, נעבור', 'לא עכשיו']);
    assert.match(offer.content.reply, /עבר קצת זמן/);
    const again = (await call(michal, 'GET', '/api/chat')).data.messages; assert.equal(again.filter((m) => m.content.offer === 'idle').length, 1, 'once');
    const n = calls.length;
    const r = (await call(avi, 'POST', '/api/chat', { text: 'כן, נעבור' })).data;
    assert.equal(calls.length, n, 'no Claude'); assert.ok(r.recount >= 2, JSON.stringify(r));
    const s = await state(avi); assert.equal(s.recountKind, 'idle');
    assert.ok(s.recount.includes(P(s, 'חלב 3%').id) && s.recount.includes(P(s, 'ביצים').id)); assert.ok(!s.recount.includes(P(s, 'תבלין א').id), 'spices are not checked');
    // 66 (the owner 05/10): his press closed it: Michal's press doesn't start a second recount
    const r2 = (await call(michal, 'POST', '/api/chat', { text: 'כן, נעבור' })).data;
    assert.equal(r2.recount, undefined, `a second recount: ${JSON.stringify(r2)}`);
    return `${s.recount.length} לבדיקה`;
  });

  await check('K1', 'ילד לא מוחק מוצרים: לא ישירות, ובצ\'אט אין לו בכלל כרטיס מחיקה', async () => {
    const add = await call(avi, 'POST', '/api/members', { add: { name: 'יובל', gender: 'm', role: 'child' } });
    kid = (await call(null, 'POST', '/api/pair', { code: add.data.code })).data.token;
    // 66 (the owner 05/10): a child's press on a card to the house isn't taken, and doesn't close it
    d1(`INSERT INTO chat (ts, user_id, role, content, thread) VALUES (${Date.now() + 2000}, NULL, 'shuki', '${JSON.stringify({ reply: 'התגעגעתי! שוב', options: ['כן, נעבור', 'לא עכשיו'], offer: 'idle', card: 1 })}', NULL)`);
    await new Promise((r) => setTimeout(r, 2100));
    const kr = (await call(kid, 'POST', '/api/chat', { text: 'כן, נעבור' })).data;
    assert.equal(kr.recount, undefined, `a child started a recount: ${JSON.stringify(kr)}`);
    assert.equal(JSON.parse(d1("SELECT content FROM chat WHERE content LIKE '%התגעגעתי! שוב%'")[0].content).answered, undefined, 'a child closed it');
    d1("UPDATE chat SET content = json_set(content, '$.answered', 1) WHERE content LIKE '%התגעגעתי! שוב%'");
    const s = await state(kid);
    const r = await act(kid, [{ kind: 'delete', product_id: P(s, 'אורז').id }]); assert.equal(r.status, 400); assert.match(r.data.error, /רק מבוגר/);
    script.push({ reply: 'למחוק?', face: 'neutral', actions: [{ kind: 'delete', product_id: P(s, 'אורז').id }] });
    const c = (await call(kid, 'POST', '/api/chat', { text: 'תמחק את האורז' })).data; // no card for the child; the grown-ups are asked (r0t d186)
    assert.equal(c.proposal, undefined); assert.equal(c.reply, 'ביקשתי מאבי או ממיכל לאשר את המחיקה של האורז.' /* 131 (the owner 19/10): by their names */);
    const card = (await lastBot(avi)).content;
    assert.equal(card.reply, 'יובל ביקש למחוק את האורז. האם לאשר?'); assert.deepEqual(card.to, [1, 2]);
    assert.ok(P(await state(avi), 'אורז'), 'not deleted until a grown-up approves');
  });

  await check('K2', 'מחיקה של יותר מ-5 מוצרים: צריך "בטוח" (ישירות ובכרטיס)', async () => {
    const s = await state(avi);
    const dels = ['א', 'ב', 'ג', 'ד', 'ה', 'ו'].map((x) => ({ kind: 'delete', product_id: P(s, `תבלין ${x}`).id }));
    const r = await act(avi, dels); assert.equal(r.status, 409); assert.equal(r.data.needSure, 6);
    script.push({ reply: 'למחוק את כל התבלינים?', face: 'neutral', actions: dels });
    const p = (await call(avi, 'POST', '/api/chat', { text: 'תמחק את כל התבלינים' })).data.proposal;
    const a1 = (await call(avi, 'POST', `/api/proposals/${p.id}/apply`, {})).data; assert.equal(a1.needSure, 6);
    assert.ok(P(await state(avi), 'תבלין א'), 'nothing yet');
    const a2 = (await call(avi, 'POST', `/api/proposals/${p.id}/apply`, { sure: true })).data; assert.equal(a2.status, 'applied');
    assert.ok(!P(await state(avi), 'תבלין א'));
    const five = (await act(avi, [{ kind: 'delete', product_id: P(await state(avi), 'תבלין ז').id }])).status; assert.equal(five, 200, 'one is fine');
  });

  await check('M1', '"רק שלי": כל תשובה של שוקי יודעת למי היא, והודעה למישהו יודעת אל מי', async () => {
    await new Promise((ok) => setTimeout(ok, 1600)); // K1's card to the grown-ups is saved 1.5 seconds ahead (r0t d186): it's in the past now
    await chatSay(avi, 'תגיד למיכל לקנות חלב', { reply: 'לשלוח למיכל?', face: 'happy', actions: [{ kind: 'tell', to: 'מיכל', text: 'תקני חלב' }] });
    const p = (await lastBot(avi)).content.proposal;
    await call(avi, 'POST', `/api/proposals/${p.id}/apply`, {});
    const m = await lastBot(michal); assert.deepEqual(m.content.to, [2]); assert.equal(m.content.for, 1); assert.match(m.content.reply, /מיכל, אבי ביקש שאגיד לך: תקני חלב/);
  });

  await check('H1', 'שורות הכרטיס בעברית: מבצע ולא "לאירוח", "ב-2", עריכה עם פירוט, ביטול עם השם, "ו" לפני האחרון', async () => {
    const s = await state(avi); const milk = P(s, 'חלב 3%').id;
    const r = await chatSay(avi, 'היה מבצע, לקחתי 6 חלב', { reply: 'לרשום שקנית 6 קרטוני חלב?', face: 'happy', actions: [
      { kind: 'op', product_id: milk, op: { type: 'purchase', amount: 6, event: true, reason: 'sale' } },
      { kind: 'op', product_id: milk, op: { type: 'use', amount: 2 } },
      { kind: 'edit', product_id: milk, product: { brand: 'תנובה', is_basic: true } },
      { kind: 'tell', text: 'יש חלב' },
    ] });
    const t = r.proposal.lines.map((l) => l.text);
    const d = r.proposal.lines.map((l) => l.detail || '');
    assert.equal(t[0], 'לסמן שקנינו 6 קרטוני חלב 3%?'); assert.match(d[0], /^במבצע/); assert.equal(t[1], 'לסמן שהשתמשנו ב-2 קרטוני חלב 3%?');
    assert.equal(t[2], 'לעדכן פרטים של חלב 3%?'); assert.equal(d[2], 'מוצר קבוע · מותג: תנובה'); assert.equal(t[3], 'להגיד למיכל ויובל: יש חלב?');
    return t.join(' | ');
  });

  await check('H2', 'תשובה בהווה ("מוסיף") עם כרטיס: השרת מוחק את המשפט, בלי קריאה שנייה (home18, 4)', async () => {
    const s = await state(avi); const n = calls.length;
    script.push({ reply: 'מוסיף חלב לרשימה', face: 'happy', actions: [{ kind: 'list_add', product_id: P(s, 'חלב 3%').id }] });
    const r = (await call(avi, 'POST', '/api/chat', { text: 'צריך חלב' })).data;
    assert.equal(calls.length, n + 1, 'retried'); assert.equal(r.reply, 'האם ככה?');
  });

  await check('H3', '"השבוע נכין שקשוקה": מצרכים של מתכון שמור שנגמרו נכנסים לכרטיס גם אם המודל פספס', async () => {
    await act(avi, [{ kind: 'create', product: { name: 'רסק עגבניות', count_type: 'units', unit: 'קופסה', qty: 0 } }, { kind: 'create', product: { name: 'עגבניות', count_type: 'level', level: 'plenty' } }]);
    await call(avi, 'POST', '/api/__recipes', { recipes: [{ name: 'שקשוקה', ingredients: '4 ביצים, 3 עגבניות, בצל, קופסת רסק עגבניות' }] });
    const r = await chatSay(michal, 'השבוע נכין שקשוקה', { reply: 'יש הכל, בתיאבון!', face: 'happy' });
    const t = (r.proposal?.lines || []).map((l) => l.text);
    assert.deepEqual(t, ['להוסיף רסק עגבניות לרשימה?']); assert.match(r.reply, /לפי המלאי חסר גם רסק עגבניות, אז הוספתי אותו לכרטיס\./);
    await call(michal, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
    return r.reply;
  });

  await check('H4', '"נגמר החלב" כשיש שני סוגים: אם המודל בוחר אחד, הוא מקבל הערה; ואם שוב, שוקי שואל איזה', async () => {
    await act(avi, [{ kind: 'create', product: { name: 'חלב סויה', count_type: 'units', unit: 'קרטון', qty: 1 } }]);
    const s = await state(avi); const milk = P(s, 'חלב 3%').id; const n = calls.length;
    script.push({ reply: 'לעדכן?', face: 'happy', actions: [{ kind: 'op', product_id: milk, op: { type: 'out' } }] }, { reply: 'לעדכן?', face: 'happy', actions: [{ kind: 'op', product_id: milk, op: { type: 'out' } }] });
    const r = (await call(avi, 'POST', '/api/chat', { text: 'נגמר החלב' })).data;
    assert.equal(calls.length, n + 2); assert.match(JSON.stringify(calls.at(-1).messages.at(-1)), /מתאים לכמה מוצרים/);
    assert.ok(!r.proposal); assert.equal(r.reply, 'איזה חלב?'); assert.deepEqual(r.options, ['חלב 3%', 'חלב סויה']);
    const r2 = await chatSay(avi, 'חלב סויה', { reply: 'לעדכן שנגמר חלב הסויה?', face: 'happy', actions: [{ kind: 'op', product_id: P(s, 'חלב סויה').id, op: { type: 'out' } }] });
    assert.ok(r2.proposal, 'the answer is clear');
    await call(avi, 'POST', `/api/proposals/${r2.proposal.id}/reject`, {});
  });

  await check('H5', 'מותג שהמודל שם בתוך הקנייה ("fields") לא משנה כלום (החלטה 93: לא ברירת מחדל)', async () => {
    const s = await state(avi); const milk = P(s, 'חלב 3%').id;
    const r = await chatSay(michal, 'קניתי 2 חלב 3% יטבתה', { reply: 'לרשום?', face: 'happy', actions: [{ kind: 'op', product_id: milk, op: { type: 'purchase', amount: 2 }, fields: { brand: 'יטבתה' } }] });
    assert.deepEqual(r.proposal.lines.map((l) => l.text), ['לסמן שקנינו 2 קרטוני חלב 3%?'] /* decision 93: a brand in a purchase is not a default */);
    await call(michal, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
  });

  await check('U1', 'גרסה חדשה: רק המנהל רואה', async () => {
    d1(`INSERT OR REPLACE INTO settings (key, value) VALUES ('update_available', '{"tag":"v0.17.0","url":"https://github.com/x/shuki/releases/tag/v0.17.0"}')`);
    assert.equal((await state(avi)).update.tag, 'v0.17.0'); assert.equal((await state(michal)).update, undefined);
    d1(`DELETE FROM settings WHERE key = 'update_available'`);
  });
} finally {
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} round-16 checks passed`);
  writeFileSync('test/round16-results.json', JSON.stringify(results, null, 1)); writeFileSync('/tmp/shuki-test/r16-log.txt', log);
  try { process.kill(-dev.pid, 'SIGKILL'); } catch { /* gone */ }
  mock.close(); process.exit(ok === results.length ? 0 : 1);
}
