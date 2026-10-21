// Round 9 (26/09 night): twin names, product photos, and ten real-life cases. Run: node test/cases.itest.js
import './fetch-retry.js';
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

const STATE = '/tmp/shuki-test/shuki-cases';
const PORT = 8796, MOCK = 8794;
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
  res.end(JSON.stringify({ content: [{ type: 'tool_use', id: 'tu1', name: 'respond', input }], usage: { input_tokens: 100, output_tokens: 10 } }));
}); }).listen(MOCK);
const dev = spawn('npx', ['wrangler', 'dev', '--local', '--test-scheduled', '--port', String(PORT), '--persist-to', STATE, '--var', `ANTHROPIC_URL:http://127.0.0.1:${MOCK}/v1/messages`, '--var', 'ANTHROPIC_API_KEY:t'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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


const JPEG = '/9j/' + Buffer.from('x'.repeat(300)).toString('base64').replace(/=/g, 'A'); // looks like a small JPEG
let avi, michal;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  avi = (await call(null, 'POST', '/api/pair', { code: '481516', name: 'iPhone' })).data.token;
  michal = (await call(null, 'POST', '/api/pair', { code: '234234', name: 'iPhone' })).data.token;
  await act(avi, [
    { kind: 'create', product: { name: 'רוטב חריף סקורפיון', count_type: 'units', unit: 'בקבוק', qty: 1, location_id: 'מזווה' } },
    { kind: 'create', product: { name: 'ביצים', count_type: 'pack', pack_size: 6, qty: 0, is_basic: 1, target: 6, location_id: 'מקרר' } },
    { kind: 'create', product: { name: 'קולה', count_type: 'units', unit: 'בקבוק', qty: 0, is_basic: 1, target: 2, location_id: 'מזווה' } },
    { kind: 'create', product: { name: 'שמנת', count_type: 'units', unit: 'קופסה', qty: 1, shelf_days: 5, location_id: 'מקרר' } },
    { kind: 'create', product: { name: 'אורז', count_type: 'units', unit: 'שקית', qty: 2, is_basic: 1, target: 1, location_id: 'מזווה' } },
  ]);

  await check('R-A', 'שני מוצרים באותו שם: נחסם ביצירה, בעריכה ובהצעה של שוקי', async () => {
    const r = await act(michal, [{ kind: 'create', product: { name: 'רוטב  חריף סקורפיון ' } }]);
    assert.equal(r.status, 400); assert.match(r.data.error, /כבר יש מוצר בשם/);
    const ok = await act(michal, [{ kind: 'create', product: { name: 'רוטב חריף סקורפיון ירוק' } }]);
    assert.equal(ok.status, 200);
    const s = await state(avi);
    const e = await act(avi, [{ kind: 'edit', product_id: P(s, 'רוטב חריף סקורפיון ירוק').id, fields: { name: 'רוטב חריף סקורפיון' } }]);
    assert.equal(e.status, 400);
    // the model proposes a twin: validate sends it back once, the retry asks what differs
    script.push({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'create', product: { name: 'רוטב חריף סקורפיון' } }] });
    script.push({ reply: 'יש כבר רוטב חריף סקורפיון. מה מבדיל את החדש?', face: 'confused', options: ['אדום', 'ירוק', 'זה אותו אחד'] });
    const n = calls.length;
    const c = (await call(avi, 'POST', '/api/chat', { text: 'קנינו רוטב חריף סקורפיון חדש' })).data;
    assert.equal(calls.length, n + 2, 'one retry');
    assert.match(JSON.stringify(calls[n + 1].messages.at(-1)), /כבר יש|קיים/);
    assert.ok(!c.proposal, 'no twin proposal'); assert.equal(c.options, undefined, 'buttons the model made up on an open question (17/10, ש4)');
    return c.reply;
  });

  await check('R-B', 'תמונת מוצר: שמירה, קריאה, במצב, החלפה, מחיקה; קבצים לא תקינים נדחים', async () => {
    let s = await state(avi); const id = P(s, 'רוטב חריף סקורפיון').id;
    assert.equal((await call(avi, 'POST', `/api/photo/${id}`, { data: 'not-a-jpeg' })).status, 400);
    assert.equal((await call(avi, 'POST', `/api/photo/${id}`, { data: '/9j/' + 'A'.repeat(95000) })).status, 400, 'too big');
    assert.equal((await call(avi, 'POST', '/api/photo/99999', { data: JPEG })).status, 404);
    assert.equal((await call(null, 'GET', `/api/photo/${id}`)).status, 401, 'needs a paired phone');
    const up = await call(avi, 'POST', `/api/photo/${id}`, { data: JPEG });
    assert.equal(up.status, 200);
    s = await state(michal); assert.equal(P(s, 'רוטב חריף סקורפיון').photo, up.data.photo, 'the other phone sees it');
    const g = await fetch(`${base}/api/photo/${id}`, { headers: { authorization: `Bearer ${michal}` } });
    assert.equal(g.headers.get('content-type'), 'image/jpeg');
    assert.equal(Buffer.from(await g.arrayBuffer()).toString('base64').replace(/=+$/, ''), JPEG.replace(/=+$/, ''));
    // an edit of the product keeps the photo
    await act(avi, [{ kind: 'edit', product_id: id, fields: { unit: 'צנצנת' } }]);
    assert.ok(P(await state(avi), 'רוטב חריף סקורפיון').photo);
    await call(avi, 'DELETE', `/api/photo/${id}`);
    assert.equal(P(await state(avi), 'רוטב חריף סקורפיון').photo, null);
    assert.equal((await call(avi, 'GET', `/api/photo/${id}`)).status, 404);
    await call(avi, 'POST', `/api/photo/${id}`, { data: JPEG });
    return 'נשמר, נקרא בטלפון השני, נמחק';
  });

  await check('R-C', 'מוצר חדש מתמונה: התמונה נשלחת לשוקי כמוצר, ואחרי אישור נשמרת על המוצר שנוצר', async () => {
    const img = { media_type: 'image/jpeg', data: JPEG };
    script.push({ reply: 'זה רוטב חריף סקורפיון אדום. להוסיף?', face: 'happy', actions: [{ kind: 'create', product: { name: 'רוטב חריף סקורפיון אדום', count_type: 'units', unit: 'בקבוק', qty: 1 } }] });
    const n = calls.length;
    const c = (await call(michal, 'POST', '/api/chat', { text: 'צילמתי מוצר', image: img, kind: 'product', thumb: JPEG })).data;
    const sent = calls[n].messages.at(-1).content;
    assert.equal(sent[0].type, 'image'); assert.match(sent[1].text, /מוצר בודד/);
    assert.match(calls[n].system.map ? JSON.stringify(calls[n].system) : String(calls[n].system), /תמונה של מוצר/);
    await call(michal, 'POST', `/api/proposals/${c.proposal.id}/apply`, {});
    const p = P(await state(avi), 'רוטב חריף סקורפיון אדום');
    assert.ok(p?.photo, 'photo attached');
    // a receipt is not a product photo: nothing attached
    script.push({ reply: 'לעדכן?', face: 'happy', actions: [{ kind: 'op', product_id: P(await state(avi), 'אורז').id, op: { type: 'purchase', amount: 1 } }] });
    const r = (await call(michal, 'POST', '/api/chat', { text: 'צילמתי קבלה', image: img, thumb: JPEG })).data;
    await call(michal, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    assert.equal(P(await state(avi), 'אורז').photo, null);
    return p.name;
  });

  await check('R-C2', 'תמונה של מוצר קיים: הצעת "שמירת התמונה"; תמונה שמחכה לתשובה על שאלה נשמרת על המוצר שנוצר אחרי', async () => {
    const img = { media_type: 'image/jpeg', data: JPEG };
    let s = await state(avi); const rice = P(s, 'אורז');
    script.push({ reply: 'זה האורז שלנו. לשמור עליו את התמונה?', face: 'happy', actions: [{ kind: 'photo', product_id: rice.id }] });
    const c = (await call(avi, 'POST', '/api/chat', { text: 'צילמתי מוצר', image: img, kind: 'product', thumb: JPEG })).data;
    assert.match(c.proposal.lines[0].text, /^לשמור את התמונה של האורז\?$/);
    await call(avi, 'POST', `/api/proposals/${c.proposal.id}/apply`, {});
    assert.ok(P(await state(avi), 'אורז').photo, 'saved on rice');
    // a question first, the answer next: the photo waits for it
    script.push({ reply: 'איזה סוג זה?', face: 'confused', options: ['חריף', 'עדין'] });
    await call(michal, 'POST', '/api/chat', { text: 'צילמתי מוצר', image: img, kind: 'product', thumb: JPEG });
    script.push({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'create', product: { name: 'חרדל עדין', count_type: 'units', qty: 1 } }] });
    const a = (await call(michal, 'POST', '/api/chat', { text: 'עדין' })).data;
    await call(michal, 'POST', `/api/proposals/${a.proposal.id}/apply`, {});
    assert.ok(P(await state(avi), 'חרדל עדין').photo, 'the waiting photo went on it');
    // but not on something unrelated later
    script.push({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'create', product: { name: 'קטשופ', count_type: 'units', qty: 1 } }] });
    const k = (await call(michal, 'POST', '/api/chat', { text: 'קנינו קטשופ' })).data;
    await call(michal, 'POST', `/api/proposals/${k.proposal.id}/apply`, {});
    assert.equal(P(await state(avi), 'קטשופ').photo, null);
    return 'אורז, חרדל עדין; קטשופ בלי';
  });

  await check('R1', 'ברשימה אבל יש בבית: ספירה + הורדה מהרשימה בפעולה אחת', async () => {
    let s = await state(avi); const cola = P(s, 'קולה');
    const it = s.list.find((i) => i.product_id === cola.id); assert.ok(it, 'basic at 0 is on the list');
    await act(avi, [{ kind: 'op', product_id: cola.id, op: { type: 'set', qty: 3 } }, { kind: 'list_remove', item_id: it.id }]);
    s = await state(avi);
    assert.equal(P(s, 'קולה').qty, 3); assert.ok(!s.list.some((i) => i.id === it.id));
    await call(avi, 'POST', '/api/undo');
    s = await state(avi); assert.equal(P(s, 'קולה').qty, 0); assert.ok(s.list.some((i) => i.id === it.id), 'undo brings both back');
    return 'אחד ביטול מחזיר את שניהם';
  });

  await check('R2', 'לא קונים יותר: לא בסיסי ולא חוזר לרשימה; חד-פעמי → מוצר במלאי', async () => {
    let s = await state(avi); const cola = P(s, 'קולה'); const it = s.list.find((i) => i.product_id === cola.id);
    await act(avi, [{ kind: 'edit', product_id: cola.id, fields: { is_basic: 0 } }, { kind: 'list_remove', item_id: it.id }]);
    await act(avi, [{ kind: 'op', product_id: cola.id, op: { type: 'set', qty: 0 } }]);
    s = await state(avi); assert.equal(P(s, 'קולה').is_basic, 0); assert.ok(!s.list.some((i) => i.product_id === cola.id), 'does not come back');
    await act(michal, [{ kind: 'list_add', text: 'נייר אפייה', store: 'super' }]);
    s = await state(michal); const one = s.list.find((i) => i.text === 'נייר אפייה');
    await act(michal, [{ kind: 'create', product: { name: 'נייר אפייה', count_type: 'units', qty: 0, store: 'super' } }, { kind: 'list_remove', item_id: one.id }, { kind: 'list_add', text: 'נייר אפייה', store: 'super' }]);
    s = await state(michal); const np = P(s, 'נייר אפייה');
    assert.ok(np); const lines = s.list.filter((i) => i.product_id === np.id || i.text === 'נייר אפייה');
    assert.equal(lines.length, 1); assert.equal(lines[0].product_id, np.id, 'the line is the product now');
    return 'חד-פעמי הפך למוצר, שורה אחת';
  });

  await check('R3', 'שם של מוצר מוקלד כטקסט → המוצר; אותו חד-פעמי משני טלפונים → שורה אחת', async () => {
    await act(avi, [{ kind: 'list_add', text: 'האורז', store: 'super' }]);
    let s = await state(avi);
    assert.ok(s.list.some((i) => i.product_id === P(s, 'אורז').id), 'linked to the product');
    assert.ok(!s.list.some((i) => i.text === 'האורז'));
    await act(avi, [{ kind: 'list_add', text: 'נרות יום הולדת', store: 'super' }]);
    await act(michal, [{ kind: 'list_add', text: 'נרות  יום-הולדת', store: 'super' }]);
    s = await state(avi);
    assert.equal(s.list.filter((i) => i.text && /נרות/.test(i.text)).length, 1);
    return 'אין כפילויות';
  });

  await check('R4', 'עבר התאריך: מופיע במצב (expired); "עוד בסדר" דוחה ביומיים; "זרקנו" מוריד', async () => {
    let s = await state(avi); const cream = P(s, 'שמנת');
    d1(`UPDATE products SET expires = ${Date.now() - DAY} WHERE id = ${cream.id}`);
    s = await state(avi);
    assert.deepEqual(s.expired.map((x) => x.name), ['שמנת']);
    await act(avi, [{ kind: 'op', product_id: cream.id, op: { type: 'set', expires: Date.now() + 2 * DAY } }]);
    s = await state(avi); assert.equal(s.expired.length, 0);
    d1(`UPDATE products SET expires = ${Date.now() - DAY} WHERE id = ${cream.id}`);
    await act(avi, [{ kind: 'op', product_id: cream.id, op: { type: 'discard' } }]);
    s = await state(avi); assert.equal(s.expired.length, 0); assert.equal(P(s, 'שמנת').qty, 0);
    return 'נדחה, ואז נזרק';
  });

  await check('R5', 'מכשירים: רשימה, קוד צימוד חדש, ניתוק טלפון אבוד; את המכשיר הזה לא מנתקים מכאן', async () => {
    let d = (await call(avi, 'GET', '/api/devices')).data.devices;
    assert.equal(d.length, 2); assert.equal(d.filter((x) => x.mine).length, 1);
    // 16/10 (the owner): a grown-up who has a phone gets a code for another one too (only a child's is blocked, stage 13 d3)
    const asked = await call(avi, 'POST', '/api/devices/code', { user_id: 2 });
    assert.equal(asked.status, 200, asked.text);
    const code = (await call(michal, 'POST', '/api/devices/code', { user_id: 2 })).data;
    assert.match(code.code, /^\d{6}$/); assert.ok(code.expires > Date.now() + 23 * 3600e3);
    const michal2 = (await call(null, 'POST', '/api/pair', { code: code.code, name: 'iPad' })).data.token;
    assert.equal((await state(michal2)).me.name, 'מיכל');
    d = (await call(avi, 'GET', '/api/devices')).data.devices; assert.equal(d.length, 3);
    const lost = d.find((x) => x.who === 'מיכל' && x.name === 'iPhone');
    assert.equal((await call(avi, 'DELETE', `/api/devices/${d.find((x) => x.mine).id}`)).status, 400);
    await call(michal2, 'DELETE', `/api/devices/${lost.id}`);
    assert.equal((await call(michal, 'GET', '/api/state')).status, 401, 'the lost phone is out');
    assert.equal((await call(null, 'POST', '/api/pair', { code: code.code })).status >= 400, true, 'a code works once');
    assert.equal((await call(null, 'POST', '/api/devices/code', { user_id: 1 })).status, 401);
    michal = michal2;
    return '3 מכשירים → הטלפון האבוד נותק';
  });

  await check('R7', 'קניתי דרך הצ\'אט בזמן קניות: הפריט עובר לעגלה ונספר בסיכום', async () => {
    await call(avi, 'POST', '/api/shopping', { on: true, store: 'super' });
    let s = await state(avi); const rice = P(s, 'אורז');
    assert.ok(s.list.some((i) => i.product_id === rice.id && i.status === 'open'));
    await act(avi, [{ kind: 'op', product_id: rice.id, op: { type: 'purchase', amount: 1 } }], { context: 'shopping' });
    s = await state(avi);
    assert.equal(s.list.find((i) => i.product_id === rice.id).status, 'checked', 'in the cart, not gone');
    const r = (await act(avi, [{ kind: 'finish', store: 'super' }], { context: 'shopping' })).data;
    assert.ok(r.trip.bought.includes('אורז'), JSON.stringify(r.trip));
    return r.trip.bought.join(', ');
  });

  await check('R8', 'אריזה בגודל אחר (12 במקום 6): המלאי מקבל 12; ביטול הסימון מחזיר בדיוק 12', async () => {
    let s = await state(avi); const eggs = P(s, 'ביצים');
    const it = s.list.find((i) => i.product_id === eggs.id);
    await act(avi, [{ kind: 'check', item_id: it.id, amount: 1, units: 12 }], { context: 'shopping' });
    s = await state(avi); assert.equal(P(s, 'ביצים').qty, 12);
    await act(avi, [{ kind: 'uncheck', item_id: it.id }], { context: 'shopping' });
    s = await state(avi); assert.equal(P(s, 'ביצים').qty, 0);
    await act(avi, [{ kind: 'check', item_id: it.id, amount: 2 }], { context: 'shopping' });
    s = await state(avi); assert.equal(P(s, 'ביצים').qty, 12, '2 packs of the usual 6');
    return '12 → 0 → 12';
  });

  await check('R9', 'קנייה לאירוח: נכנס למלאי, לא מלמד את שוקי קצב צריכה', async () => {
    let s = await state(avi); const cola = P(s, 'קולה');
    const before = d1(`SELECT COUNT(*) AS n FROM product_log WHERE product_id = ${cola.id}`)[0].n;
    await act(avi, [{ kind: 'op', product_id: cola.id, op: { type: 'purchase', amount: 6, event: true } }]);
    s = await state(avi);
    assert.equal(P(s, 'קולה').qty, 6);
    assert.equal(d1(`SELECT COUNT(*) AS n FROM product_log WHERE product_id = ${cola.id}`)[0].n, before, 'no learning row');
    assert.match(s.journal[0].summary, /לאירוח/);
    return s.journal[0].summary;
  });

  await check('R10', 'שכחו ללחוץ "סיימתי": מה שבעגלה יותר מ-6 שעות נסגר לבד (המלאי כבר עודכן)', async () => {
    let s = await state(avi); const eggs = P(s, 'ביצים'); const it = s.list.find((i) => i.product_id === eggs.id);
    assert.equal(it.status, 'checked');
    await call(avi, 'POST', '/api/shopping', { on: false });
    d1(`UPDATE list_items SET checked = ${Date.now() - 7 * 3600e3} WHERE id = ${it.id}`);
    await tick();
    s = await state(avi);
    assert.ok(!s.list.some((i) => i.id === it.id), 'gone from the list');
    assert.equal(P(s, 'ביצים').qty, 12, 'stock untouched');
    return 'נסגר';
  });
} finally {
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} case checks passed`);
  (await import('node:fs')).writeFileSync('test/cases-results.json', JSON.stringify(results, null, 1));
  try { process.kill(-dev.pid, 'SIGKILL'); } catch { /* gone */ }
  mock.close();
  process.exit(ok === results.length ? 0 : 1);
}
