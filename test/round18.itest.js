// Round 18 (28/09): decisions 78–118, one by one.
// Run: node test/round18.itest.js
import './fetch-retry.js';
import { israelAt, israelDate, israelDateOf, weekdayOf } from './israel-time.js';
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { lastHoliday } from '../worker/domain.js';
import { rmSync, writeFileSync } from 'node:fs';

const STATE = '/tmp/shuki-test/shuki-r18';
const PORT = 8786, MOCK = 8784;
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
const lastBot = async (t) => { const r = await call(t, 'GET', '/api/chat'); if (!r.data?.messages) throw new Error(r.status + ' ' + r.text.slice(0, 300)); return r.data.messages.filter((m) => m.role === 'shuki').at(-1); };

let avi, michal, kid;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  avi = (await call(null, 'POST', '/api/pair', { code: '481516', name: 'iPhone' })).data.token;
  michal = (await call(null, 'POST', '/api/pair', { code: '234234', name: 'iPhone' })).data.token;
  await act(avi, [
    { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 1, is_basic: 1, target: 2, shelf_days: 7 } },
    { kind: 'create', product: { name: 'חלב סויה', count_type: 'units', unit: 'קרטון', qty: 1 } },
  ]);
  const sysText = (c) => (c.system || []).map((x) => x.text).join('\n');
  const msgsText = (c) => JSON.stringify(c.messages);
  const pid = async (name) => P(await state(avi), name).id;
  await call(avi, 'POST', '/api/settings', { costCap: 1000 }); // the fake Claude bills a lot per call

  await check('D78', 'כלל שאושר מופיע ביומן (ובשורה "מאז שהיית כאן") בשם מי שלימד', async () => {
    const r = await chatSay(michal, 'תזכור שאנחנו לא קונים במבה', { reply: 'לזכור?', face: 'happy', actions: [{ kind: 'lesson', text: 'לא קונים במבה' }] });
    assert.equal(r.proposal, undefined); assert.equal(r.reply, 'סגור, אזכור שלא קונים במבה.'); // asked in so many words: no question back; D10 says what (approved 02/10)
    const j = (await state(avi)).journal.find((e) => e.type === 'lesson'); assert.equal(j?.summary, 'מיכל לימדה אותי: לא קונים במבה');
  });

  await check('D79', 'שלוש פעמים אותה תשובה ל"איזה חלב?": בפעם השלישית הכרטיס מציע ללמוד; תשובה אחרת מתחילה את הספירה מחדש', async () => {
    const soy = await pid('חלב סויה'), reg = await pid('חלב 3%');
    const round = async (answer, id) => {
      await chatSay(avi, 'נגמר החלב', { reply: 'איזה חלב?', face: 'confused', options: ['חלב 3%', 'חלב סויה'] });
      const r = await chatSay(avi, answer, { reply: 'לעדכן שנגמר?', face: 'sad', actions: [{ kind: 'op', product_id: id, op: { type: 'out' } }] });
      if (r.proposal) await call(avi, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
      return r;
    };
    // decision 159/160: never a "learn" line on the card; the question comes after the card is decided
    const lastBot = async (t) => (await call(t, 'GET', '/api/chat')).data.messages.filter((m) => m.role === 'shuki').at(-1).content;
    const asksNow = async (t) => /שאזכור/.test((await lastBot(t)).reply);
    await round('חלב סויה', soy); assert.ok(!(await asksNow(avi)));
    await round('חלב 3%', reg); // starts over
    await round('חלב סויה', soy);
    await round('חלב סויה', soy); assert.ok(!(await asksNow(avi)), 'too early');
    const r = await round('חלב סויה', soy);
    assert.ok(!r.proposal.lines.some((l) => l.icon === 'learn'), JSON.stringify(r.proposal.lines)); assert.doesNotMatch(r.reply, /שאזכור/);
    const q = await lastBot(avi); assert.equal(q.reply, 'האם תרצה שאזכור שכשאתה אומר חלב, אתה מתכוון לחלב סויה?'); assert.deepEqual(q.options, ['כן, תזכור', 'לא צריך']);
    assert.equal((await call(avi, 'POST', '/api/chat', { text: 'לא' })).data.reply, 'בסדר, לא אזכור.');
    // a model option that isn't the full name ("the soy one") counts too, and Michal gets her own count and her own words
    for (let i = 0; i < 3; i++) {
      await chatSay(michal, 'נגמר החלב', { reply: 'הרגיל או הסויה?', face: 'confused', options: ['הרגיל', 'הסויה'] });
      const x = await chatSay(michal, 'הסויה', { reply: 'לעדכן?', face: 'sad', actions: [{ kind: 'op', product_id: soy, op: { type: 'out' } }] });
      await call(michal, 'POST', `/api/proposals/${x.proposal.id}/reject`, {});
      if (i === 2) assert.equal((await lastBot(michal)).reply, 'האם תרצי שאזכור שכשאת אומרת חלב, את מתכוונת לחלב סויה?');
    }
    // stage 8, question 53 (r9p, built in stage 9): with no card, not with the model's own question; it waits for the next pick
    await call(michal, 'POST', '/api/chat', { text: 'לא צריך' });
    d1("DELETE FROM settings WHERE key LIKE 'learnask:%' OR key LIKE 'pick:%'");
    const ask = async (reply) => { await chatSay(michal, 'יש חלב?', { reply: 'איזה חלב?', face: 'confused', options: ['חלב 3%', 'חלב סויה'] }); return chatSay(michal, 'חלב סויה', { reply, face: 'happy' }); };
    await ask('יש קרטון אחד.'); await ask('יש קרטון אחד.');
    assert.equal((await ask('יש קרטון אחד. האם להוסיף עוד לרשימה?')).reply, 'יש קרטון אחד. האם להוסיף עוד לרשימה?', 'two questions in one message');
    assert.equal((await ask('יש קרטון אחד.')).reply, 'יש קרטון אחד. האם תרצי שאזכור שכשאת אומרת חלב, את מתכוונת לחלב סויה?', 'the next time');
  });

  await check('D80', 'הוזמן במשלוח: נשאר ברשימה, לא נספר בשלוש קניות בלי, שוקי יודע שהוא בדרך; "הגיע" מעדכן את המלאי וסוגר', async () => {
    const reg = await pid('חלב 3%');
    await act(avi, [{ kind: 'list_add', product_id: reg, amount: 2 }, { kind: 'list_add', text: 'נייר אפייה' }]);
    let s = await state(avi); const it = s.list.find((i) => i.product_id === reg), one = s.list.find((i) => i.text === 'נייר אפייה');
    assert.equal((await act(avi, [{ kind: 'order', item_id: it.id }, { kind: 'order', item_id: one.id }])).status, 200);
    s = await state(michal); assert.ok(s.list.find((i) => i.id === it.id).ordered); assert.equal(s.list.find((i) => i.id === it.id).status, 'open');
    calls.length = 0; await chatSay(michal, 'צריך חלב?', { reply: 'בדרך', face: 'happy' });
    assert.match(sysText(calls[0]), /פריט#\d+\|חלב 3%\|[^|]*\|הוזמן במשלוח, בדרך \(לא לקנות\)/);
    // a trip to the store that ends without it doesn't count it as skipped
    await act(michal, [{ kind: 'list_add', text: 'מלח' }]); s = await state(michal);
    await act(michal, [{ kind: 'check', item_id: s.list.find((i) => i.text === 'מלח').id, amount: 1 }]); await act(michal, [{ kind: 'finish', store: 'super' }]);
    assert.equal(d1(`SELECT skipped FROM list_items WHERE id = ${it.id}`)[0].skipped, 0);
    const before = P(await state(avi), 'חלב 3%').qty;
    await act(avi, [{ kind: 'arrived', item_id: it.id }, { kind: 'arrived', item_id: one.id }]);
    s = await state(avi); assert.equal(P(s, 'חלב 3%').qty, before + 2); assert.ok(!s.list.some((i) => i.id === it.id || i.id === one.id));
    assert.match(s.journal[0].summary, /קיבל במשלוח/);
    // undo brings the line back, ordered
    await call(avi, 'POST', '/api/undo'); s = await state(avi); assert.ok(s.list.find((i) => i.id === it.id)?.ordered);
    await act(avi, [{ kind: 'order', item_id: it.id, off: true }]); assert.ok(!(await state(avi)).list.find((i) => i.id === it.id).ordered);
  });

  await check('D92', 'קנייה קבועה: כרטיס מהצ\'אט, נכנסת לרשימה לבד בבוקר של יום לפני (פעם אחת), ונעצרת; שלושה שבועות של קנייה באותו יום = כרטיס אחד', async () => {
    const soy = await pid('חלב סויה');
    const tomorrow = weekdayOf(israelDate(1)); // tomorrow in Israel
    const r = await chatSay(avi, 'חלב סויה כל שבוע', { reply: 'לקבוע?', face: 'happy', actions: [{ kind: 'routine', product_id: soy, weekday: tomorrow }] });
    assert.match(r.proposal.lines[0].text, /^לקנות חלב סויה כל יום \S+\?$/);
    await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    let s = await state(avi); assert.equal(s.routines.length, 1);
    const it = s.list.find((i) => i.product_id === soy); if (it) await act(avi, [{ kind: 'list_remove', item_id: it.id }]);
    const seven = israelAt(israelDate(), '7:30'); // 07:30 in Israel today
    const run = async (t) => (await call(avi, 'POST', '/api/__schedule', { now: t })).data;
    const out = await run(seven); assert.equal(out?.weeklyAdded, 1, JSON.stringify(out));
    s = await state(avi); assert.ok(s.list.some((i) => i.product_id === soy && i.status === 'open')); assert.match(s.journal.find((e) => /שוקי/.test(e.summary)).summary, /^שוקי הוסיף לרשימה חלב סויה/);
    assert.equal((await run(seven + 60e3))?.weeklyAdded, undefined, 'twice');
    calls.length = 0; await chatSay(avi, 'היי', { reply: 'היי', face: 'happy' }); assert.match(sysText(calls[0]), /קניות קבועות: חלב סויה \(יום \S+\)/); // "בשבוע" went: a buy can be every N days too (r0t d101)
    await call(michal, 'POST', '/api/routines', { id: s.routines[0].id }); assert.equal((await state(avi)).routines.length, 0);
    // the pattern: bought on the same weekday three weeks running
    const reg = await pid('חלב 3%');
    d1(`INSERT INTO product_log (event_id, ts, product_id, kind) VALUES ${[0, 1, 2].map((w) => `(0, ${seven - w * 7 * 864e5 - 3600e3}, ${reg}, 'purchase')`).join(',')}`);
    // round 19 (decisions 124, 148): noticed, not a message from Shuki; answered in settings (or asked in a reply)
    const chatBefore = (await call(avi, 'GET', '/api/chat')).data.messages.length;
    await run(seven + 120e3);
    assert.equal((await call(avi, 'GET', '/api/chat')).data.messages.length, chatBefore, 'Shuki wrote first');
    const n = (await state(avi)).noticed.find((x) => x.kind === 'weekly'); assert.match(n?.text || '', /^אתם קונים חלב 3% בכל יום \S+\.$/, JSON.stringify((await state(avi)).noticed));
    assert.equal((await call(avi, 'POST', '/api/noticed', { id: n.id, yes: true })).data.status, 'applied');
    assert.equal((await state(avi)).routines[0].name, 'חלב 3%');
    await run(seven + 180e3); assert.ok(!(await state(avi)).noticed.some((x) => x.kind === 'weekly' && x.status !== 'yes'), 'asked again');
  });

  await check('D93', 'מותג בקנייה לא משנה את המוצר, גם כשאין לו מותג (החלטה 93)', async () => {
    const reg = await pid('חלב 3%'), soy = await pid('חלב סויה');
    await act(avi, [{ kind: 'edit', product_id: reg, fields: { brand: 'טרה' } }]);
    const r = await chatSay(avi, 'לא היה טרה, לקחתי 2 חלב 3% של תנובה', { reply: 'לעדכן?', face: 'happy', actions: [{ kind: 'op', product_id: reg, op: { type: 'purchase', amount: 2 }, fields: { brand: 'תנובה' } }] });
    assert.ok(r.proposal, JSON.stringify(r));     assert.ok(!r.proposal.lines.some((l) => /תנובה/.test(l.text)), JSON.stringify(r.proposal.lines));
    const r2 = await chatSay(avi, 'קניתי חלב סויה אלפרו', { reply: 'לעדכן?', face: 'happy', actions: [{ kind: 'op', product_id: soy, op: { type: 'purchase', amount: 1 }, fields: { brand: 'אלפרו' } }] });
    assert.deepEqual(r2.proposal.lines.map((l) => l.text), ['לסמן שקנינו קרטון חלב סויה?'], 'no brand line either (decision 93: not a default)');
    for (const x of [r, r2]) await call(avi, 'POST', `/api/proposals/${x.proposal.id}/reject`, {});
  });

  await check('D102', 'מוצר שלא נקנה חודשיים: הקצב נשאר, אבל לא "עומד להיגמר" ולא "צפוי להיגמר" אצל שוקי', async () => {
    await act(avi, [{ kind: 'create', product: { name: 'אבטיח', count_type: 'units', qty: 1 } }]);
    const w = await pid('אבטיח'); const now = Date.now();
    d1(`INSERT INTO product_log (event_id, ts, product_id, kind) VALUES ${[[175, 'purchase'], [170, 'out'], [165, 'purchase'], [160, 'out'], [150, 'purchase']].map(([ago, kind]) => `(0, ${now - ago * 864e5}, ${w}, '${kind}')`).join(',')}`);
    // inside the 180-day window: purchase 150 days ago. The pace is known, next is long past → would be "soon"
    let s = await state(avi); const p = P(s, 'אבטיח');
    assert.ok(p.learned?.every, JSON.stringify(p.learned)); assert.equal(p.learned.next, null); assert.ok(!s.soon.some((x) => x.id === w));
    calls.length = 0; await chatSay(avi, 'היי', { reply: 'היי', face: 'happy' }); assert.doesNotMatch(sysText(calls[0]), /אבטיח[^\n]*צפוי להיגמר/);
  });

  await check('D104', 'החזרה לחנות: יורד מהמלאי, לא בזבוז, והקנייה שהוחזרה לא מלמדת; מוצר קבוע שנגמר חוזר לרשימה', async () => {
    const reg = await pid('חלב 3%');
    await act(avi, [{ kind: 'op', product_id: reg, op: { type: 'set', qty: 3 } }]);
    const r = await chatSay(avi, 'החזרתי 3 קרטוני חלב 3%, היו פגומים', { reply: 'לעדכן שהחזרת?', face: 'happy', actions: [{ kind: 'op', product_id: reg, op: { type: 'return', amount: 3 } }] });
    assert.equal(r.proposal.lines[0].text, 'לסמן שהחזרנו לחנות 3 קרטוני חלב 3%?');
    const ap = (await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {})).data; assert.equal(ap.status, 'applied', JSON.stringify(ap));
    const s = await state(avi); assert.equal(P(s, 'חלב 3%').qty, 0); assert.ok(s.list.some((i) => i.product_id === reg && i.status === 'open'));
    const ev = d1(`SELECT waste, summary FROM events ORDER BY ts DESC LIMIT 1`)[0]; assert.equal(ev.waste, 0); assert.match(ev.summary, /החזיר לחנות את חלב 3%/);
    assert.equal(d1(`SELECT COUNT(*) AS n FROM product_log WHERE product_id = ${reg} AND kind = 'return'`)[0].n, 1);
  });

  const SUB = { endpoint: 'https://push.example.com/x', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } };
  // hour:05 in Israel on that day, by the real offset (test/israel-time.js; a fixed +3 gave 06:05 after the change, 25/10/2026)
  const israel = (dayOffset, hour) => israelAt(israelDate(dayOffset), `${hour}:05`);

  await check('D82', 'מקום נוסף: "נגמר" כשיש במרפסת לא נכנס לרשימה ושוקי אומר שיש שם; "הבאתי 2" מעביר; מקום חדש נוצר', async () => {
    await act(avi, [{ kind: 'create', product: { name: 'קולה', count_type: 'units', unit: 'בקבוק', qty: 2, is_basic: 1, target: 2 } }]);
    const cola = await pid('קולה');
    const r = await chatSay(avi, 'יש עוד 6 קולה במרפסת', { reply: 'לעדכן?', face: 'happy', actions: [{ kind: 'edit', product_id: cola, fields: { reserve_qty: 6, reserve_location_id: 'מרפסת' } }] });
    await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    let s = await state(avi); const place = s.locations.find((l) => l.name === 'מרפסת'); assert.ok(place, 'no place'); assert.equal(P(s, 'קולה').reserve_location_id, place.id);
    const r2 = await chatSay(avi, 'נגמרה הקולה', { reply: 'לעדכן שנגמרה?', face: 'sad', actions: [{ kind: 'op', product_id: cola, op: { type: 'out' } }] });
    assert.match(r2.reply, /יש עוד 6 בקבוקי קולה במרפסת\./);
    await call(avi, 'POST', `/api/proposals/${r2.proposal.id}/apply`, {});
    s = await state(avi); assert.equal(P(s, 'קולה').qty, 0); assert.ok(!s.list.some((i) => i.product_id === cola && i.status === 'open'), 'on the list');
    calls.length = 0; await chatSay(avi, 'היי', { reply: 'היי', face: 'happy' }); assert.match(sysText(calls[0]), /קולה\|[^\n]*ועוד 6 בקבוקים במרפסת/);
    const r3 = await chatSay(avi, 'הבאתי 2 מהמרפסת', { reply: 'לעדכן?', face: 'happy', actions: [{ kind: 'op', product_id: cola, op: { type: 'bring', amount: 2 } }] });
    assert.equal(r3.proposal.lines[0].text, 'לסמן שהבאנו 2 בקבוקי קולה מהמרפסת?');
    await call(avi, 'POST', `/api/proposals/${r3.proposal.id}/apply`, {});
    s = await state(avi); assert.equal(P(s, 'קולה').qty, 2); assert.equal(P(s, 'קולה').reserve_qty, 4);
    // the last ones brought in, and then out: now it's on the list
    await act(avi, [{ kind: 'op', product_id: cola, op: { type: 'bring', amount: 9 } }, { kind: 'op', product_id: cola, op: { type: 'out' } }]);
    s = await state(avi); assert.equal(P(s, 'קולה').reserve_qty, null); assert.ok(s.list.some((i) => i.product_id === cola && i.status === 'open'), 'not on the list');
  });

  await check('D84', 'תרופה: התוקף נאמר חודש לפני, פעם אחת; מוצר רגיל יומיים לפני; קטגוריה "חיות מחמד" קיימת', async () => {
    const s = await state(avi);
    assert.ok(s.categories.some((c) => c.name === 'חיות מחמד'));
    const med = s.categories.find((c) => c.name === 'תרופות ועזרה ראשונה').id;
    await act(avi, [{ kind: 'create', product: { name: 'אקמול', count_type: 'units', unit: 'קופסה', qty: 1, category_id: med, store: 'pharm' } }, { kind: 'create', product: { name: 'שמנת', count_type: 'units', unit: 'קרטון', qty: 1 } }]);
    const ak = await pid('אקמול'), sh = await pid('שמנת');
    // the 1st of the month has its own summary message: start on a day where none of the three checks lands on a 1st
    const dayOf = (d) => Number(israelDateOf(israel(d, 20)).slice(8)); // its day of the month in Israel
    let k = 0; while ([0, 1, 9].some((d) => dayOf(k + d) === 1)) k++;
    await act(avi, [{ kind: 'edit', product_id: ak, fields: { expires: israel(k + 25, 23) } }, { kind: 'edit', product_id: sh, fields: { expires: israel(k + 10, 23) } }]);
    await call(avi, 'POST', '/api/push/subscribe', { subscription: SUB });
    const at20 = (d) => israel(k + d, 20);
    const a = await call(avi, 'POST', '/api/__schedule', { now: at20(0) }); assert.equal(a.data.messages, 1, JSON.stringify(a.data));
    assert.equal((await call(avi, 'POST', '/api/__schedule', { now: at20(1) })).data.messages, 0, 'medicine said twice');
    assert.equal((await call(avi, 'POST', '/api/__schedule', { now: at20(9) })).data.messages, 1, 'cream 1 day before');
  });

  await check('D107', '"בתוקף עד ה-5": תאריך מהצ\'אט נשמר כסוף היום, בשעון הבית', async () => {
    const sh = await pid('שמנת');
    const day = israelDate(5);
    const r = await chatSay(avi, 'השמנת בתוקף עד ה-X', { reply: 'לעדכן?', face: 'happy', actions: [{ kind: 'edit', product_id: sh, fields: { expires: day } }] });
    assert.equal((await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {})).data.status, 'applied');
    const e = P(await state(avi), 'שמנת').expires;
    assert.equal(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).format(new Date(e)), `${day}, 23`);
  });

  await check('D90', 'שאריות: לא מוצר ולא רשימה; שוקי רואה אותן; אחרי 3 ימים כרטיס "עוד במקרר?"; "עוד יש" דוחה ב-3 ימים; "נגמרה" מוריד', async () => {
    const r = await chatSay(michal, 'נשארה פסטה מאתמול', { reply: 'לרשום?', face: 'happy', actions: [{ kind: 'leftover', text: 'פסטה', days_ago: 1 }] });
    assert.equal(r.proposal.lines[0].text, 'לרשום שיש שאריות של פסטה?'); assert.equal(r.proposal.lines[0].detail, 'מאתמול');
    await call(michal, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    let s = await state(michal); assert.equal(s.leftovers.length, 1); assert.ok(!s.products.some((p) => p.name === 'פסטה')); assert.deepEqual(s.leftoverAsk, []);
    calls.length = 0; await chatSay(michal, 'מה יש לאכול', { reply: 'פסטה', face: 'happy' }); assert.match(sysText(calls[0]), /שאריות \(אוכל מבושל, לא בקטלוג\): #\d+ פסטה \(מ-/);
    const id = s.leftovers[0].id;
    d1(`UPDATE leftovers SET made = made - ${3 * 864e5} WHERE id = ${id}`);
    s = await state(michal); assert.deepEqual(s.leftoverAsk, [id]);
    await call(michal, 'POST', '/api/leftovers', { id, gone: false }); assert.deepEqual((await state(michal)).leftoverAsk, []);
    const g = await chatSay(avi, 'גמרנו את הפסטה', { reply: 'לעדכן?', face: 'happy', actions: [{ kind: 'leftover', id, gone: true }] });
    assert.equal(g.proposal.lines[0].text, 'לסמן שגמרנו את השאריות (פסטה)?');
    await call(avi, 'POST', `/api/proposals/${g.proposal.id}/apply`, {}); assert.equal((await state(avi)).leftovers.length, 0);
  });

  await check('D85', 'מעבר דירה: נשמר, שוקי יודע, "עומד להיגמר" נעלם; בבוקר שאחרי שוקי מציע למפות, פעם אחת', async () => {
    const day = israelDate(10);
    const r = await chatSay(avi, 'עוברים דירה בעוד 10 ימים', { reply: 'לרשום?', face: 'happy', actions: [{ kind: 'moving', date: day }] });
    assert.match(r.proposal.lines[0].text, /^לרשום שעוברים דירה ב-\d+\.\d+\?$/);
    await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    let s = await state(avi); assert.ok(s.moving); assert.deepEqual(s.soon, []);
    calls.length = 0; await chatSay(avi, 'מה לקנות', { reply: 'x', face: 'happy' }); assert.match(sysText(calls[0]), new RegExp(`מעבר דירה ב-${day}: עד אז לגמור מה שיש`));
    assert.equal((await call(avi, 'POST', '/api/__schedule', { now: israel(5, 7) })).data.movedIn, undefined, 'too early');
    assert.equal((await call(avi, 'POST', '/api/__schedule', { now: israel(11, 7) })).data.movedIn, true);
    assert.ok((await call(avi, 'GET', '/api/chat')).data.messages.some((m) => /^איזה כיף שעברתם לבית חדש! האם נעבור יחד על מקומות האחסון\?/.test(m.content.reply || '')));
    s = await state(avi); assert.equal(s.moving, null);
    assert.equal((await call(avi, 'POST', '/api/__schedule', { now: israel(12, 7) })).data.movedIn, undefined, 'twice');
  });

  await check('D98', 'שבת: "אני שומר שבת" = כרטיס; בשישי ב-10:00 פוש אחד עם מה שחסר מהקבועים, רק למי ששומר; שעות שקט', async () => {
    const { isQuiet } = await import('../worker/index.js');
    const at = (iso) => Date.parse(iso);
    assert.equal(isQuiet(at('2026-10-01T20:30:00Z'), 'Asia/Jerusalem', false), true, '23:30');
    assert.equal(isQuiet(at('2026-10-01T04:30:00Z'), 'Asia/Jerusalem', false), false, '07:30');
    assert.equal(isQuiet(at('2026-10-02T13:30:00Z'), 'Asia/Jerusalem', false), false, 'Friday 16:30, not keeping');
    assert.equal(isQuiet(at('2026-10-02T13:30:00Z'), 'Asia/Jerusalem', true), true, 'Friday 16:30, keeping');
    assert.equal(isQuiet(at('2026-10-03T16:30:00Z'), 'Asia/Jerusalem', true), false, 'Saturday 19:30');
    const r = await chatSay(michal, 'אני שומרת שבת', { reply: 'לא להתריע בשבת?', face: 'happy', actions: [{ kind: 'shabbat', on: true }] });
    assert.ok(r.proposal, JSON.stringify(r));
    assert.equal(r.proposal.lines[0].text, 'לא לשלוח התראות משישי ב-16:00 עד שבת ב-19:00?'); assert.equal(r.proposal.lines[0].detail, 'ובשישי בבוקר אשלח את מה שחסר מהמוצרים הקבועים');
    await call(michal, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    assert.equal((await state(michal)).shabbat, true); assert.equal((await state(avi)).shabbat, false);
    await call(michal, 'POST', '/api/push/subscribe', { subscription: SUB });
    await act(avi, [{ kind: 'op', product_id: await pid('חלב 3%'), op: { type: 'out' } }]);
    let fri = 0; while (new Date(israel(fri, 12)).getUTCDay() !== 5) fri++;
    const sched = (await call(avi, 'POST', '/api/__schedule', { now: israel(fri, 10) })).data;
    assert.equal(sched.shabbatSent, 1);
    assert.match(sched.shabbatBody, /^לשבת צריך להשלים: .*חלב 3%/); // the approved words (02/10)
    assert.equal((await call(avi, 'POST', '/api/__schedule', { now: israel(fri, 10) + 60e3 })).data.shabbatSent, 0, 'twice');
  });

  await check('D86', 'שותף שעוזב: כרטיס אחד על המוצרים שלו; מה שמסומן יורד, השאר משותף', async () => {
    await call(avi, 'POST', '/api/settings', { house_mode: 'roommates' });
    const add = await call(avi, 'POST', '/api/members', { add: { name: 'עומר', gender: 'm' } });
    const omer = (await call(null, 'POST', '/api/pair', { code: add.data.code })).data.token;
    await act(omer, [{ kind: 'create', product: { name: 'שמפו של עומר', count_type: 'units', qty: 1, owner: add.data.id } }, { kind: 'create', product: { name: 'קפה של עומר', count_type: 'units', qty: 1, owner: add.data.id } }]);
    const rm = await call(avi, 'POST', '/api/members', { id: add.data.id, remove: true }); assert.equal(rm.data.card, true);
    const m = (await call(avi, 'GET', '/api/chat')).data.messages.find((x) => /^עומר יצא מהבית/.test(x.content.reply || ''));
    assert.equal(m.content.reply, 'עומר יצא מהבית. מה עושים עם הדברים שלו? מה שתסמנו יירד מהמלאי והשאר יהיה משותף.');
    const j = m.content.proposal.lines.findIndex((l) => /^קפה/.test(l.text));
    await call(avi, 'POST', `/api/proposals/${m.content.proposal.id}/apply`, { skip: [j] });
    const s = await state(avi); assert.ok(!P(s, 'שמפו של עומר')); assert.equal(P(s, 'קפה של עומר').owner, null);
    await call(avi, 'POST', '/api/settings', { house_mode: 'family' });
  });

  await check('D112', 'CSV: מלאי והיסטוריה, עם BOM לאקסל ועם עברית', async () => {
    const inv = await fetch(`${base}/api/export.csv?what=inventory`, { headers: { authorization: `Bearer ${avi}` } });

    const raw = new Uint8Array(await inv.arrayBuffer()); assert.match(inv.headers.get('content-type'), /text\/csv/);
    assert.deepEqual([...raw.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'BOM'); const t = new TextDecoder().decode(raw); assert.match(t, /^מוצר,כמות,יחידה,מיקום,קטגוריה,קבוע,מינימום,חנות,מותג,תוקף\r\n/); assert.match(t, /\r\nחלב 3%,0,קרטון,/);
    const h = await (await fetch(`${base}/api/export.csv?what=history`, { headers: { authorization: `Bearer ${avi}` } })).text();
    assert.match(h, /^תאריך,מוצר,מה,מי\r\n/); assert.match(h, /,חלב 3%,קנייה,/); assert.match(h, /,חלב 3%,החזרה,אבי\r\n/);
    assert.equal((await fetch(`${base}/api/export.csv`)).status, 401);
  });

  await check('D94', 'מתכון נשמר עם סוג, ושוקי רואה את הסוג; "מה קנינו לראש השנה שעבר?" מביא את הקניות של לפני החג', async () => {
    const r = await chatSay(michal, 'תשמור את המתכון', { reply: 'לשמור?', face: 'excited', actions: [{ kind: 'recipe', name: 'שמיכת דאמפלינג', tags: 'אסייתי, סיני, דפי גיוזה', ingredients: 'דפי גיוזה, בשר טחון, בצל ירוק', recipe_text: 'מקפלים ומטגנים' }] });
    await call(michal, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    calls.length = 0; await chatSay(michal, 'משהו אסייתי לערב?', { reply: 'x', face: 'happy' });
    assert.match(sysText(calls[0]), /שמיכת דאמפלינג \[אסייתי, סיני, דפי גיוזה\]: דפי גיוזה/);
    // "the last Rosh Hashanah" depends on today's date (21 days or more back): the date comes from the same function, so the
    // check doesn't break on 03/10/2026, three weeks after Rosh Hashanah 2026
    const hol = lastHoliday('ראש השנה', Date.now()); const holDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(hol.ts);
    const rh = hol.ts - 3 * 86400e3; const reg = await pid('חלב 3%');
    d1(`INSERT INTO events (id, ts, user_id, type, summary) VALUES (999001, ${rh}, 1, 'purchase', 'x')`);
    d1(`INSERT INTO product_log (event_id, ts, product_id, kind) VALUES (999001, ${rh}, ${reg}, 'purchase')`);
    calls.length = 0; await chatSay(avi, 'מה קנינו לראש השנה שעבר?', { reply: 'x', face: 'happy' });
    assert.match(sysText(calls[0]), new RegExp(`קניות לקראת ראש השנה הקודם \\(${holDay}\\): [^\\n]*חלב 3%`));
  });

  await check('D110', 'מחיקת הבית: רק מנהל, רק עם השם הנכון; אחרי זה הכל נעלם והשרת מחכה להקמה חדשה', async () => {
    assert.equal((await call(michal, 'POST', '/api/house/delete', { name: 'הבית של אבי ומיכל' })).status, 403);
    assert.equal((await call(avi, 'POST', '/api/house/delete', { name: 'בית אחר' })).status, 400);
    assert.equal((await call(avi, 'POST', '/api/house/delete', { name: 'הבית של אבי ומיכל' })).status, 200);
    assert.equal((await call(avi, 'GET', '/api/state')).status, 401);
    assert.equal((await call(null, 'GET', '/api/setup')).data.needed, true);
    for (const t of ['products', 'users', 'chat', 'events', 'lessons', 'settings']) assert.equal(d1(`SELECT COUNT(*) AS n FROM ${t} WHERE ${t === 'settings' ? "key NOT IN ('setup_code', 'vapid')" : '1'}`)[0].n, 0, t);
    assert.equal(d1(`SELECT COUNT(*) AS n FROM categories WHERE name = 'חיות מחמד'`)[0].n, 1);
  });
} finally {
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} round-18 checks passed`);
  writeFileSync('test/round18-results.json', JSON.stringify(results, null, 1)); writeFileSync('/tmp/shuki-test/r18-log.txt', log);
  try { process.kill(-dev.pid, 'SIGKILL'); } catch { /* gone */ }
  mock.close(); process.exit(ok === results.length ? 0 : 1);
}
