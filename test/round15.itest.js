// Round 15 (27/09): brand, weights on the list, roommates, notification switches, a child's requests, guests, big buys,
// three trips without it, hosting lists, history, no brain, house notes. Run: node test/round15.itest.js
import './fetch-retry.js';
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

const STATE = '/tmp/shuki-test/shuki-r15';
const PORT = 8756, MOCK = 8754;
const d1 = (sql) => JSON.parse(execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --json --command "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^[^[]*/, ''))[0].results;
rmSync(STATE, { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply shuki --local --persist-to ${STATE}`, { stdio: 'ignore' });
execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --file test/fixture-house.sql`, { stdio: 'ignore' });
d1(`INSERT INTO pairing_codes (code, user_id, expires) VALUES ('481516', 1, 9999999999999), ('234234', 2, 9999999999999)`);

const script = []; const calls = [];
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { const b = Buffer.concat(parts).toString('utf8'); // bytes first: a Hebrew letter can be split between chunks (question 29)

  calls.push(JSON.parse(b));
  const input = script.shift() || { reply: 'ok', face: 'happy' };
  if (input.__status) { res.writeHead(input.__status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { message: input.__body } })); return; }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'tool_use', id: 'tu1', name: 'respond', input }], usage: { input_tokens: 100, output_tokens: 10 } }));
}); }).listen(MOCK);
const dev = spawn('npx', ['wrangler', 'dev', '--local', '--test-scheduled', '--port', String(PORT), '--persist-to', STATE, '--var', `ANTHROPIC_URL:http://127.0.0.1:${MOCK}/v1/messages`, '--var', 'ANTHROPIC_API_KEY:t', '--var', 'VAPID_PUBLIC:BMMdXvS-VuZiLvO1dnln5--ThCfc4M25IulaMpiMQcLf_Vr-OuNxtjBm4R-Gl8osOtEdudLwFZ0bBuVCLJwKEo'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = ''; dev.stdout.on('data', (d) => (log += d)); dev.stderr.on('data', (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
const call = async (t, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const txt = await r.text(); let data = null; try { data = JSON.parse(txt); } catch { /* text */ } return { status: r.status, data, text: txt, headers: r.headers }; };
const state = async (t) => (await call(t, 'GET', '/api/state')).data;
const results = [];
async function check(id, name, fn) {
  try { const note = await fn(); results.push({ id, name, ok: true, note: note || '' }); console.log('✓', id, name, note ? `— ${note}` : ''); }
  catch (e) { results.push({ id, name, ok: false, error: e.message.slice(0, 400) }); console.log('✗', id, name, '\n   ', e.message.slice(0, 400)); }
}
const DAY = 86400e3;
const SUB = { endpoint: 'https://push.example.com/x', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } };
const act = (t, actions, extra = {}) => call(t, 'POST', '/api/actions', { actions, op_id: `op-${Math.random()}`, ...extra });
const hourNow = () => +new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', hour: 'numeric', hourCycle: 'h23' }).format(new Date());
const tick = async () => { const n = log.length; await fetch(`${base}/__scheduled?cron=0+*+*+*+*`); await new Promise((r) => setTimeout(r, 1500)); const m = log.slice(n).match(/schedule \S+ (\{.*\})/); return m ? JSON.parse(m[1]) : null; };
const P = (s, name) => s.products.find((p) => p.name === name);




const sysText = (c) => c.system.map((x) => x.text).join('\n');
let avi, michal, kid;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  avi = (await call(null, 'POST', '/api/pair', { code: '481516', name: 'iPhone' })).data.token;
  michal = (await call(null, 'POST', '/api/pair', { code: '234234', name: 'iPhone' })).data.token;
  for (const t of [avi, michal]) await call(t, 'POST', '/api/push/subscribe', { subscription: SUB });
  await act(avi, [
    { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 1, is_basic: 1, target: 2 } },
    { kind: 'create', product: { name: 'בשר טחון', count_type: 'level', level: 'none' } },
    { kind: 'create', product: { name: 'נייר טואלט', count_type: 'pack', pack_size: 32, qty: 10 } },
    { kind: 'create', product: { name: 'קוטג\'', count_type: 'units', qty: 0 } },
  ]);

  await check('F1', 'מותג מועדף: נשמר על המוצר, מופיע במצב ובקטלוג של שוקי', async () => {
    let s = await state(avi);
    await act(avi, [{ kind: 'edit', product_id: P(s, 'חלב 3%').id, fields: { brand: 'תנובה' } }]);
    s = await state(michal); assert.equal(P(s, 'חלב 3%').brand, 'תנובה');
    script.push({ reply: 'יש.', face: 'happy' }); await call(avi, 'POST', '/api/chat', { text: 'יש חלב?' });
    assert.match(sysText(calls.at(-1)), /\|חלב 3%\|.*\|מותג תנובה/); // 0e: the short line, with a label
  });
  await check('F2', 'משקל ברשימה: "חצי קילו טחון" נשמר כ-0.5 ק"ג; סימון לא מכניס 0.5 יחידות', async () => {
    let s = await state(avi);
    await act(avi, [{ kind: 'list_add', product_id: P(s, 'בשר טחון').id, amount: 0.5, unit: 'ק"ג' }]);
    s = await state(avi); const it = s.list.find((i) => i.product_id === P(s, 'בשר טחון').id);
    assert.equal(it.want, 0.5); assert.equal(it.want_unit, 'ק"ג');
    await act(avi, [{ kind: 'check', item_id: it.id }], { context: 'shopping' });
    s = await state(avi); assert.equal(P(s, 'בשר טחון').level, 'plenty');
  });
  await check('F3', 'הודעות: מיכל מכבה "קניות" → לא מקבלת "אבי בקניות", ועדיין מקבלת הודעות', async () => {
    await call(michal, 'POST', '/api/settings', { notify: { shopping: false } });
    assert.equal((await state(michal)).notify.shopping, false);
    const r = (await call(avi, 'POST', '/api/shopping', { on: true, store: 'super' })).data;
    assert.ok(!r.notify.some((x) => x.to === 'מיכל'), JSON.stringify(r.notify));
    await call(avi, 'POST', '/api/shopping', { on: false });
    await call(michal, 'POST', '/api/settings', { notify: { shopping: true } });
  });
  await check('F4', 'ילד: מה שהוא מוסיף מחכה; ההורים מקבלים התראה; אי אפשר לסמן לפני אישור; "לא" מוריד', async () => {
    const a = await call(avi, 'POST', '/api/members', { add: { name: 'יובל', gender: 'm', role: 'child' } });
    kid = (await call(null, 'POST', '/api/pair', { code: a.data.code })).data.token;
    assert.equal((await state(kid)).me.role, 'child');
    const r = await act(kid, [{ kind: 'list_add', text: 'במבה' }, { kind: 'list_add', text: 'שוקולד' }]);
    assert.ok(r.data.notify.some((x) => x.to === 'אבי' && /במבה/.test(x.body)), JSON.stringify(r.data.notify));
    let s = await state(avi);
    const bamba = s.list.find((i) => i.text === 'במבה'), choc = s.list.find((i) => i.text === 'שוקולד');
    assert.equal(bamba.approved, 0);
    assert.equal((await act(michal, [{ kind: 'check', item_id: bamba.id }])).status, 400, 'tick before approval');
    assert.equal((await act(kid, [{ kind: 'approve', item_id: bamba.id, yes: true }])).status, 400, 'a child approves');
    await act(michal, [{ kind: 'approve', item_id: bamba.id, yes: true }, { kind: 'approve', item_id: choc.id }]);
    s = await state(avi);
    assert.equal(s.list.find((i) => i.id === bamba.id).approved, 1); assert.ok(!s.list.some((i) => i.id === choc.id));
    // what ran out is on the list right away, even when the child says so
    await act(kid, [{ kind: 'op', product_id: P(s, 'קוטג\'').id, op: { type: 'out' } }]);
    s = await state(avi); assert.equal(s.list.find((i) => i.product_id === P(s, 'קוטג\'').id)?.approved, 1);
  });
  await check('F5', 'קנייה גדולה (פי 3 מהרגיל) לא מלמדת קצב', async () => {
    const s = await state(avi); const tp = P(s, 'נייר טואלט');
    const n0 = d1(`SELECT COUNT(*) AS n FROM product_log WHERE product_id = ${tp.id}`)[0].n;
    await act(avi, [{ kind: 'op', product_id: tp.id, op: { type: 'purchase', amount: 4 } }]);
    assert.equal(d1(`SELECT COUNT(*) AS n FROM product_log WHERE product_id = ${tp.id}`)[0].n, n0);
    await act(avi, [{ kind: 'op', product_id: tp.id, op: { type: 'purchase', amount: 1 } }]);
    assert.equal(d1(`SELECT COUNT(*) AS n FROM product_log WHERE product_id = ${tp.id}`)[0].n, n0 + 1, 'a normal buy teaches');
  });
  await check('F6', 'שלוש קניות בסופר בלי הקוטג\' → "לא נקנה כבר שלוש פעמים"; "להשאיר" מאפס', async () => {
    let s = await state(avi); const cot = s.list.find((i) => i.product_id === P(s, 'קוטג\'').id);
    const milk = P(s, 'חלב 3%');
    for (let k = 0; k < 3; k++) {
      await act(avi, [{ kind: 'list_add', product_id: milk.id }]);
      s = await state(avi); const m = s.list.find((i) => i.product_id === milk.id && i.status === 'open');
      await act(avi, [{ kind: 'check', item_id: m.id, amount: 1 }], { context: 'shopping' });
      await act(avi, [{ kind: 'finish', store: 'super' }]);
    }
    s = await state(avi); assert.ok(s.stale.some((x) => x.id === cot.id && x.store === 'super'), JSON.stringify(s.stale)); // d45: with its store
    await act(avi, [{ kind: 'keep', item_id: cot.id }]);
    assert.ok(!(await state(avi)).stale.some((x) => x.id === cot.id));
  });
  await check('F6b', 'd45 "להחליף" (02/10, 05/10): הספירה מתאפסת, שוקי שואל בצ\'אט שלי "מה לקנות במקום קוטג\'?" (לא אצל מיכל); תשובה עם מוצר: כרטיס שמוסיף ומוריד; "לא": הישן נשאר', async () => {
    let s = await state(avi); const cot = s.list.find((i) => i.product_id === P(s, 'קוטג\'').id && i.status === 'open');
    const chatOf = async (t) => JSON.stringify((await call(t, 'GET', '/api/chat')).data.messages);
    assert.equal((await call(avi, 'POST', '/api/stale-swap', { item_id: cot.id })).status, 200);
    assert.match(await chatOf(avi), /מה לקנות במקום קוטג'\?/); assert.doesNotMatch(await chatOf(michal), /מה לקנות במקום/);
    s = await state(avi); assert.ok(s.list.some((i) => i.id === cot.id && i.status === 'open'), 'the old line went before the answer');
    script.push({ reply: 'להוסיף גבינה לבנה לרשימה?', face: 'happy', actions: [{ kind: 'list_add', text: 'גבינה לבנה' }] });
    const c = (await call(avi, 'POST', '/api/chat', { text: 'גבינה לבנה' })).data;
    assert.equal(c.proposal?.lines?.length, 2, JSON.stringify(c));
    assert.equal((await call(avi, 'POST', `/api/proposals/${c.proposal.id}/apply`, {})).data.status, 'applied');
    s = await state(avi);
    assert.ok(!s.list.some((i) => i.id === cot.id && i.status === 'open'), 'the old one stayed');
    assert.ok(s.list.some((i) => i.text === 'גבינה לבנה' && i.status === 'open'), 'the new one isn\'t there');
    // "לא": the old one stays, and the next message isn't a swap any more
    const milk = s.list.find((i) => i.text === 'גבינה לבנה' && i.status === 'open');
    await call(avi, 'POST', '/api/stale-swap', { item_id: milk.id });
    const no = (await call(avi, 'POST', '/api/chat', { text: 'לא' })).data;
    assert.equal(no.reply, 'בסדר.'); assert.ok((await state(avi)).list.some((i) => i.id === milk.id && i.status === 'open'));
    script.push({ reply: 'להוסיף במבה?', face: 'happy', actions: [{ kind: 'list_add', text: 'במבה' }] });
    const next = (await call(avi, 'POST', '/api/chat', { text: 'תוסיף במבה' })).data;
    assert.equal(next.proposal?.lines?.length, 1, `still a swap: ${JSON.stringify(next.proposal)}`);
    if (next.proposal) await call(avi, 'POST', `/api/proposals/${next.proposal.id}/reject`, {});
    // 58 (the owner 05/10): a message with no product closes it, the old line stays, and the one after isn't a swap
    await call(avi, 'POST', '/api/stale-swap', { item_id: milk.id });
    script.push({ reply: 'אין בעיה.', face: 'happy' });
    await call(avi, 'POST', '/api/chat', { text: 'רגע, אני חושב' });
    script.push({ reply: 'להוסיף לחם?', face: 'happy', actions: [{ kind: 'list_add', text: 'לחם' }] });
    const later = (await call(avi, 'POST', '/api/chat', { text: 'תוסיף לחם' })).data;
    assert.equal(later.proposal?.lines?.length, 1, `a later message was a swap: ${JSON.stringify(later.proposal)}`);
    if (later.proposal) await call(avi, 'POST', `/api/proposals/${later.proposal.id}/reject`, {});
    assert.ok((await state(avi)).list.some((i) => i.id === milk.id && i.status === 'open'), 'the old one went');
    // 58: a photo is the next message too: it closes the question, and the message after it isn't a swap
    await call(avi, 'POST', '/api/stale-swap', { item_id: milk.id });
    script.push({ reply: 'יפה.', face: 'happy' });
    await call(avi, 'POST', '/api/chat', { text: '', image: { media_type: 'image/jpeg', data: '/9j/4AAQSkZJRg==' } });
    script.push({ reply: 'להוסיף לחם?', face: 'happy', actions: [{ kind: 'list_add', text: 'לחם' }] });
    const afterPhoto = (await call(avi, 'POST', '/api/chat', { text: 'תוסיף לחם' })).data;
    assert.equal(afterPhoto.proposal?.lines?.length, 1, `a swap after a photo: ${JSON.stringify(afterPhoto.proposal)}`);
    if (afterPhoto.proposal) await call(avi, 'POST', `/api/proposals/${afterPhoto.proposal.id}/reject`, {});
    // 58: with a question of mine open, "להחליף" takes its place, and its bubble is in the chat now
    const aviId = (await state(avi)).me.id;
    d1(`INSERT OR REPLACE INTO settings (key, value) VALUES ('ask:${aviId}', '${JSON.stringify({ actions: [], again: true, done: 'סגור!', nope: 'בסדר.', choices: { 'כן, עדיין': {}, 'כבר לא': { no: true } }, ts: Date.now() })}')`);
    d1(`INSERT INTO chat (ts, user_id, role, content, thread) VALUES (${Date.now()}, NULL, 'shuki', '${JSON.stringify({ askOnly: true, reply: 'רשמתי שאתה לא אוכל פטריות. האם זה עדיין נכון?', face: 'happy', options: ['כן, עדיין', 'כבר לא'], for: aviId, only: aviId })}', ${aviId})`);
    assert.equal((await call(avi, 'POST', '/api/stale-swap', { item_id: milk.id })).status, 200);
    const asked = JSON.parse(d1(`SELECT value FROM settings WHERE key = 'ask:${aviId}'`)[0].value);
    assert.ok(asked.swap?.item_id === milk.id, JSON.stringify(asked));
    const msgs = (await call(avi, 'GET', '/api/chat')).data.messages;
    assert.match(msgs.at(-1)?.content?.reply || '', /^מה לקנות במקום /);
    // 9 (the owner 05/10 noon): the question it took the place of comes back after the answer, with its words and buttons
    assert.equal((await call(avi, 'POST', '/api/chat', { text: 'לא' })).data.reply, 'בסדר.');
    const back = (await call(avi, 'GET', '/api/chat')).data.messages.at(-1)?.content;
    assert.equal(back?.reply, 'רשמתי שאתה לא אוכל פטריות. האם זה עדיין נכון?', JSON.stringify(back));
    assert.deepEqual(back?.options, ['כן, עדיין', 'כבר לא']);
    assert.ok(JSON.parse(d1(`SELECT value FROM settings WHERE key = 'ask:${aviId}'`)[0].value).again, 'not the replaced question waiting'); // (kitniyot waits for Passover: r0t C11B)
    // a question saved with the answer before it comes back from the question on (the reviewer of 9)
    d1(`INSERT OR REPLACE INTO settings (key, value) VALUES ('ask:${aviId}', '${JSON.stringify({ actions: [{ kind: 'lesson', text: 'קונים לחם כל שבוע' }], done: 'סגור, אזכור!', nope: 'בסדר, לא אזכור.', ts: Date.now() })}')`);
    d1(`INSERT INTO chat (ts, user_id, role, content, thread) VALUES (${Date.now() + 10}, NULL, 'shuki', '${JSON.stringify({ reply: 'הוספתי חלב לרשימה. אגב, שמתי לב שקונים לחם כל שבוע. האם לזכור?', face: 'happy', options: ['כן', 'לא'], for: aviId })}', ${aviId})`);
    await call(avi, 'POST', '/api/stale-swap', { item_id: milk.id });
    await call(avi, 'POST', '/api/chat', { text: 'לא' });
    const back2 = (await call(avi, 'GET', '/api/chat')).data.messages.at(-1)?.content;
    assert.equal(back2?.reply, 'אגב, שמתי לב שקונים לחם כל שבוע. האם לזכור?', JSON.stringify(back2));
  });
  await check('F7', 'אירוח: "אנחנו מארחים בשישי" → לשונית משלה, הכרטיס מוסיף אליה, קנייה משם לא מלמדת, ונסגרת אחרי', async () => {
    const fri = new Date(Date.now() + 3 * DAY).toISOString().slice(0, 10);
    script.push({ reply: 'לפתוח רשימת אירוח ולהוסיף יין?', face: 'happy', hosting: { name: 'אירוח שישי', date: fri }, actions: [{ kind: 'list_add', text: 'יין אדום', store: 'hosting' }] });
    const c = (await call(avi, 'POST', '/api/chat', { text: 'אנחנו מארחים בשישי, תוסיף יין' })).data;
    let s = await state(avi); const h = s.stores.find((x) => x.event);
    assert.ok(h && h.name === 'אירוח שישי', JSON.stringify(s.stores));
    await call(avi, 'POST', `/api/proposals/${c.proposal.id}/apply`, {});
    s = await state(avi); const wine = s.list.find((i) => i.text === 'יין אדום'); assert.equal(wine.store, h.id);
    await act(avi, [{ kind: 'create', product: { name: 'יין אדום', count_type: 'units', qty: 0, store: h.id } }]);
    s = await state(avi); const it = s.list.find((i) => i.product_id === P(s, 'יין אדום').id);
    await act(avi, [{ kind: 'check', item_id: it.id, amount: 2 }], { context: 'shopping' });
    assert.equal(d1(`SELECT COUNT(*) AS n FROM product_log WHERE product_id = ${P(s, 'יין אדום').id} AND kind = 'purchase'`)[0].n, 0, 'hosting buys do not teach');
    await act(avi, [{ kind: 'list_add', text: 'מפיות', store: h.id }]);
    const stores = JSON.parse(d1("SELECT value FROM settings WHERE key = 'stores'")[0].value).map((x) => (x.id === h.id ? { ...x, until: Date.now() - 1000 } : x));
    d1(`UPDATE settings SET value = '${JSON.stringify(stores)}' WHERE key = 'stores'`);
    const t = await tick(); assert.equal(t.hostingsEnded, 1, JSON.stringify(t));
    s = await state(avi); assert.ok(!s.stores.some((x) => x.id === h.id)); assert.equal(s.list.find((i) => i.text === 'מפיות').store, 'super', 'leftovers to the supermarket');
  });
  await check('F8', 'אורחים עד שישי: נשמר בנפרד מחופשה, הסיכום היומי ממשיך', async () => {
    const fri = new Date(Date.now() + 3 * DAY).toISOString().slice(0, 10);
    script.push({ reply: 'רשמתי שיש אורחים עד שישי.', face: 'happy', guests: { until: fri } });
    await call(michal, 'POST', '/api/chat', { text: 'סבתא אצלנו עד שישי' });
    let s = await state(avi); assert.ok(s.guests?.now); assert.ok(!s.away);
    await call(avi, 'POST', '/api/away', { end: true, until: null, kind: 'guests' });
    s = await state(avi); assert.ok(!s.guests?.now);
  });
  await check('F9', '"מתי קנינו חלב?": שוקי מקבל את כל היסטוריית הקניות של החלב', async () => {
    script.push({ reply: 'היום.', face: 'happy' }); await call(michal, 'POST', '/api/chat', { text: 'מתי קנינו חלב 3%?' });
    // only the dates, without who bought (r0t trim b2: 0b part 4, r12 q011)
    assert.match(sysText(calls.at(-1)), /היסטוריית קניות:\n.*חלב 3%: \d{4}-\d{2}-\d{2}/); assert.doesNotMatch(sysText(calls.at(-1)).split('היסטוריית קניות:')[1], /\((אבי|מיכל)\)/);
  });
  await check('F10', 'הערות לבית ודירת שותפים מגיעות לשוקי; רק מנהל משנה', async () => {
    assert.equal((await call(michal, 'POST', '/api/settings', { house_notes: 'x' })).status, 403);
    await call(avi, 'POST', '/api/settings', { house_notes: 'יובל אלרגי לבוטנים', house_mode: 'roommates' });
    let s = await state(michal); assert.equal(s.notes, 'יובל אלרגי לבוטנים'); assert.equal(s.roommates, true);
    await act(avi, [{ kind: 'create', product: { name: 'בירה', count_type: 'units', qty: 6, owner: s.users.find((u) => u.name === 'מיכל').id } }]);
    script.push({ reply: 'ok', face: 'happy' }); await call(michal, 'POST', '/api/chat', { text: 'מה שלי?' });
    const sys = sysText(calls.at(-1)); assert.match(sys, /הערות לבית \(אלרגיה וגלוטן: בדוק מולן כל פריט שמוסיפים או קונים[^)]*השאר: רק מתכונים ומאכלים שאתה מציע[^)]*\): יובל אלרגי לבוטנים/); /* c9 (r0t trim) */ assert.match(sys, /\|בירה\|.*\|של מיכל/); assert.match(sys, /דירת שותפים/); assert.match(sys, /והצעות אוכל \("מה לבשל\?"\) של מישהו = רק מהמשותף ומשלו/); /* r9-19 (r0t trim) */
    // the model says "mine": the name becomes the id
    script.push({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'create', product: { name: 'חלב שקדים', count_type: 'units', qty: 1, owner: 'מיכל' } }] });
    const c = (await call(michal, 'POST', '/api/chat', { text: 'קניתי לעצמי חלב שקדים' })).data;
    await call(michal, 'POST', `/api/proposals/${c.proposal.id}/apply`, {});
    s = await state(michal); assert.equal(P(s, 'חלב שקדים').owner, s.me.id);
    await call(avi, 'POST', '/api/settings', { house_mode: 'family', house_notes: '' });
  });
  await check('F11', 'בלי קרדיט: תשובה ברורה, הבית מסומן, המנהל מקבל התראה אחת; "בדיקה" מחזיר', async () => {
    script.push({ __status: 400, __body: 'Your credit balance is too low to access the Anthropic API.' });
    const r = (await call(michal, 'POST', '/api/chat', { text: 'היי' })).data;
    assert.equal(r.brainError, 'credit'); assert.match(r.reply, /לא זמין/);
    let s = await state(avi); assert.equal(s.brainError.kind, 'credit');
    script.push({ __status: 400, __body: 'Your credit balance is too low' });
    const r2 = (await call(avi, 'POST', '/api/chat', { text: 'היי' })).data; assert.match(r2.reply, /קרדיט/);
    assert.equal(d1("SELECT COUNT(*) AS n FROM settings WHERE key = 'brain_error'")[0].n, 1);
    script.push({ reply: 'ok', face: 'happy' }); // the check call
    const ck = (await call(avi, 'POST', '/api/brain/check')).data; assert.ok(ck.ok, JSON.stringify(ck));
    s = await state(avi); assert.equal(s.brainError, null);
  });
} finally {
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} round-15 checks passed`);
  (await import('node:fs')).writeFileSync('test/round15-results.json', JSON.stringify(results, null, 1));
  try { process.kill(-dev.pid, 'SIGKILL'); } catch { /* gone */ }
  mock.close();
  process.exit(ok === results.length ? 0 : 1);
}
