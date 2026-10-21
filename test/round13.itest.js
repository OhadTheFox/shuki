// Round 13 (27/09): Avi's decisions — own stores, timed reminders, messages, recipes, Passover, receipt after ticking,
// the last spare, bought for guests. Run: node test/round13.itest.js
import './fetch-retry.js';
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

const STATE = '/tmp/shuki-test/shuki-r13';
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



const ymd = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
const IMG = { media_type: 'image/jpeg', data: '/9j/' + 'A'.repeat(400) };
const sysText = (c) => c.system.map((x) => x.text).join('\n');
let avi, michal;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  avi = (await call(null, 'POST', '/api/pair', { code: '481516', name: 'iPhone' })).data.token;
  michal = (await call(null, 'POST', '/api/pair', { code: '234234', name: 'iPhone' })).data.token;
  await call(michal, 'POST', '/api/push/subscribe', { subscription: SUB });
  await act(avi, [
    { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 1, is_basic: 1, target: 2, location_id: 'מקרר' } },
    { kind: 'create', product: { name: 'יוגורט', count_type: 'units', unit: 'גביע', qty: 1, location_id: 'מקרר' } },
    { kind: 'create', product: { name: 'פסטה', count_type: 'units', unit: 'שקית', qty: 1, is_basic: 1, target: 1, location_id: 'מזווה' } },
    { kind: 'create', product: { name: 'אורז', count_type: 'units', unit: 'שקית', qty: 1, is_basic: 1, target: 1, location_id: 'מזווה' } },
    { kind: 'create', product: { name: 'סבון כלים', count_type: 'inuse', is_open: 1, qty: 1, location_id: 'מזווה' } },
    { kind: 'create', product: { name: 'ביצים', count_type: 'pack', pack_size: 12, qty: 12, location_id: 'מקרר' } },
  ]);

  await check('N1', 'חנויות משלכם: הוספה, מוצר ופריט ברשימה בחנות החדשה, מחיקה מחזירה לסופר', async () => {
    const a0 = await call(avi, 'POST', '/api/settings', { addStore: 'קצב' }); assert.equal(a0.status, 200, a0.text);
    assert.equal((await call(avi, 'POST', '/api/settings', { addStore: 'קצב' })).status, 400, 'twice');
    assert.equal((await call(avi, 'POST', '/api/settings', { addStore: '  ' })).status, 400, 'empty');
    assert.equal((await call(avi, 'POST', '/api/settings', { addStore: 'סופר' })).status, 400, 'a base store');
    let s = await state(michal);
    const k = s.stores.find((x) => x.name === 'קצב'); assert.ok(k && k.custom, JSON.stringify(s.stores));
    const mk = await act(avi, [{ kind: 'create', product: { name: 'בשר טחון', count_type: 'units', unit: 'קילו', qty: 0, store: k.id } }, { kind: 'list_add', text: 'בשר טחון' }]); assert.equal(mk.status, 200, mk.text);
    s = await state(avi);
    const meat = P(s, 'בשר טחון'); assert.equal(meat.store, k.id);
    assert.equal(s.list.find((i) => i.product_id === meat.id)?.store, k.id, 'on the butcher tab');
    // Shuki knows the store and can use it
    script.push({ reply: 'יש.', face: 'happy' });
    await call(avi, 'POST', '/api/chat', { text: 'יש לנו בשר?' });
    const c = calls.at(-1); assert.match(sysText(c), new RegExp(`${k.id}=קצב`));
    assert.ok(JSON.stringify(c.tools[0].input_schema).includes(`"${k.id}"`), 'store enum');
    assert.equal((await call(avi, 'POST', '/api/settings', { removeStore: 'super' })).status, 400);
    assert.equal((await call(avi, 'POST', '/api/settings', { removeStore: k.id })).status, 200);
    s = await state(avi);
    assert.ok(!s.stores.some((x) => x.id === k.id));
    assert.equal(P(s, 'בשר טחון').store, 'super'); assert.equal(s.list.find((i) => i.product_id === meat.id).store, 'super');
    return s.stores.map((x) => x.name).join(', ');
  });

  await check('N2', 'תזכורת לזמן שבוחרים: כרטיס עם יום ושעה, נשמרת, ונשלחת בשעה שלה (לא רק בשעת הסיכום)', async () => {
    const tomorrow = ymd(Date.now() + DAY);
    script.push({ reply: 'לקבוע תזכורת?', face: 'happy', actions: [{ kind: 'remind', text: 'נרות', date: tomorrow, time: '10:30' }] });
    const c = (await call(avi, 'POST', '/api/chat', { text: 'תזכיר לי לקנות נרות מחר ב-10:30' })).data;
    assert.match(c.proposal.lines[0].text, /^להזכיר לקנות נרות\?$/); assert.match(c.proposal.lines[0].detail, /^מחר, 10:30$/);
    assert.equal((await call(avi, 'POST', `/api/proposals/${c.proposal.id}/apply`, {})).data.status, 'applied');
    let s = await state(avi); const m = s.maybe.find((x) => x.text === 'נרות');
    assert.equal(m.kind, 'remind'); assert.ok(!m.due);
    assert.equal(ymd(m.due_at), tomorrow);
    d1(`UPDATE maybe SET due_at = ${Date.now() - 60e3} WHERE id = ${m.id}`);
    const r = await tick();
    assert.equal(r.reminders, 1, JSON.stringify(r));
    assert.ok(d1(`SELECT asked FROM maybe WHERE id = ${m.id}`)[0].asked, 'marked as sent');
    s = await state(avi); assert.ok(s.maybe.find((x) => x.id === m.id).due, 'shows "הגיע הזמן"');
    // a time in the past goes back to the model once
    script.push({ reply: 'לקבוע?', face: 'happy', actions: [{ kind: 'remind', text: 'סוללות', date: '2020-01-01', time: '09:00' }] });
    script.push({ reply: 'מתי להזכיר?', face: 'confused', options: ['מחר בבוקר', 'בעוד שבוע'] });
    const n = calls.length;
    const c2 = (await call(avi, 'POST', '/api/chat', { text: 'תזכיר לי סוללות' })).data;
    assert.equal(calls.length, n + 2); assert.match(JSON.stringify(calls.at(-1).messages.at(-1)), /כבר עבר/);
    assert.ok(!c2.proposal);
    return m.due_at;
  });

  await check('N3', '"תגיד למיכל לקנות חלב": הודעה לטלפון של מיכל, בצ\'אט, והחלב ברשימה', async () => {
    const s0 = await state(avi);
    script.push({ reply: 'לשלוח למיכל?', face: 'happy', actions: [{ kind: 'tell', text: 'תקני חלב בדרך הביתה' }, { kind: 'list_add', product_id: P(s0, 'חלב 3%').id }] });
    const c = (await call(avi, 'POST', '/api/chat', { text: 'תגיד למיכל לקנות חלב' })).data;
    assert.match(c.proposal.lines[0].text, /^להגיד למיכל: תקני חלב/);
    const r = (await call(avi, 'POST', `/api/proposals/${c.proposal.id}/apply`, {})).data;
    assert.ok(r.notify.some((x) => x.to === 'מיכל' && /תקני חלב/.test(x.body)), JSON.stringify(r.notify));
    const chat = (await call(michal, 'GET', '/api/chat')).data.messages;
    assert.ok(chat.some((m) => /ביקש שאגיד לך: תקני חלב/.test(m.content.reply || '')), 'in the chat too');
    const s = await state(michal); assert.ok(s.list.some((i) => i.product_id === P(s, 'חלב 3%').id));
    return r.notify.find((x) => x.to === 'מיכל').body;
  });

  await check('N4', 'מתכון: שמירה מהצ\'אט, מופיע בהגדרות ובקטלוג של שוקי, המתכון המלא כשמזכירים אותו, מחיקה', async () => {
    script.push({ reply: 'לשמור?', face: 'happy', actions: [{ kind: 'recipe', name: 'שקשוקה', ingredients: '4 ביצים, 3 עגבניות, בצל, רסק עגבניות', recipe_text: 'מטגנים בצל, מוסיפים עגבניות ורסק, שוברים ביצים ומכסים.' }] });
    const c = (await call(michal, 'POST', '/api/chat', { text: 'תשמור מתכון לשקשוקה: 4 ביצים, 3 עגבניות...' })).data;
    assert.match(c.proposal.lines[0].text, /^לשמור את המתכון לשקשוקה\?$/);
    await call(michal, 'POST', `/api/proposals/${c.proposal.id}/apply`, {});
    let s = await state(avi); const x = s.recipes.find((y) => y.name === 'שקשוקה'); assert.ok(x);
    script.push({ reply: 'במה השתמשת?', face: 'happy' });
    await call(avi, 'POST', '/api/chat', { text: 'מה אפשר לבשל?' });
    assert.match(sysText(calls.at(-1)), /שקשוקה[^\n]*: ביצים, עגבניות/); // 0e: part 2, ingredients without amounts
    script.push({ reply: 'לפי המתכון: 4 ביצים. ככה?', face: 'happy', options: ['כן, ככה', 'לא בדיוק'] });
    await call(avi, 'POST', '/api/chat', { text: 'הכנתי שקשוקה' });
    assert.match(sysText(calls.at(-1)), /שוברים ביצים/);
    await call(avi, 'POST', '/api/settings', { deleteRecipe: x.id });
    s = await state(avi); assert.ok(!s.recipes.length);
    return 'נשמר ונמחק';
  });

  await check('N5', 'מצב פסח: מסווג את מה שבבית, חמץ לא חוזר לרשימה לבד, מה שלא חמץ כן; מוצר חדש מסווג לבד', async () => {
    let s = await state(avi);
    script.push({ reply: '', face: 'happy', chametz_ids: [P(s, 'פסטה').id] }); // the classifier's answer
    const r = (await call(avi, 'POST', '/api/settings', { pesach: true })).data;
    assert.deepEqual(r.chametz, ['פסטה']);
    s = await state(avi); assert.equal(s.pesach, true); assert.equal(P(s, 'פסטה').chametz, 1); assert.equal(P(s, 'אורז').chametz, 0);
    await act(avi, [{ kind: 'op', product_id: P(s, 'פסטה').id, op: { type: 'out' } }, { kind: 'op', product_id: P(s, 'אורז').id, op: { type: 'out' } }]);
    s = await state(avi);
    assert.ok(!s.list.some((i) => i.product_id === P(s, 'פסטה').id), 'chametz stays off');
    assert.ok(s.list.some((i) => i.product_id === P(s, 'אורז').id), 'rice goes on');
    await act(avi, [{ kind: 'create', product: { name: 'פיתות', count_type: 'units', qty: 0, is_basic: 1, target: 1 } }]);
    s = await state(avi); assert.equal(P(s, 'פיתות').chametz, 1); assert.ok(!s.list.some((i) => i.product_id === P(s, 'פיתות').id));
    script.push({ reply: 'אין.', face: 'happy' });
    await call(avi, 'POST', '/api/chat', { text: 'מה חסר?' });
    assert.match(sysText(calls.at(-1)), /מצב פסח: פועל/);
    // the model puts chametz on the list anyway: sent back once, and never on the card unless it was named
    const pasta = P(s, 'פסטה');
    script.push({ reply: 'להוסיף פסטה?', face: 'happy', actions: [{ kind: 'list_add', product_id: pasta.id }] });
    script.push({ reply: 'להוסיף פסטה?', face: 'happy', actions: [{ kind: 'list_add', product_id: pasta.id }] });
    const n0 = calls.length;
    const g = (await call(avi, 'POST', '/api/chat', { text: 'צור לי רשימה' })).data;
    assert.equal(calls.length, n0 + 2); assert.match(JSON.stringify(calls.at(-1).messages.at(-1)), /מצב פסח פועל/);
    assert.ok(!g.proposal, 'chametz card');
    script.push({ reply: 'להוסיף פסטה?', face: 'happy', actions: [{ kind: 'list_add', product_id: pasta.id }] });
    const g2 = (await call(avi, 'POST', '/api/chat', { text: 'תוסיף פסטה לרשימה' })).data;
    assert.ok(g2.proposal, 'named: yes');
    await call(avi, 'POST', `/api/proposals/${g2.proposal.id}/reject`, {});
    // on purpose, it still goes on
    await act(avi, [{ kind: 'list_add', product_id: P(s, 'פסטה').id }]);
    s = await state(avi); assert.ok(s.list.some((i) => i.product_id === P(s, 'פסטה').id), 'by hand: yes');
    await call(avi, 'POST', '/api/settings', { pesach: false });
    s = await state(avi); assert.equal(s.pesach, false);
    await act(avi, [{ kind: 'op', product_id: P(s, 'פיתות').id, op: { type: 'set', qty: 0 } }]);
    s = await state(avi); assert.ok(s.list.some((i) => i.product_id === P(s, 'פיתות').id), 'after Passover: back to normal');
    return 'פסטה ופיתות חמץ, אורז לא';
  });

  await check('N6', 'קבלה אחרי סימון בעגלה: מה שסומן לא נספר שוב, כמות אחרת בקבלה מתקנת את ההפרש', async () => {
    let s = await state(avi);
    const milk = P(s, 'חלב 3%'), yog = P(s, 'יוגורט'), eggs = P(s, 'ביצים');
    await act(avi, [{ kind: 'list_add', product_id: yog.id }]);
    s = await state(avi);
    const iMilk = s.list.find((i) => i.product_id === milk.id), iYog = s.list.find((i) => i.product_id === yog.id);
    await act(avi, [{ kind: 'check', item_id: iMilk.id, amount: 2 }, { kind: 'check', item_id: iYog.id, amount: 2 }], { context: 'shopping' });
    s = await state(avi); const milkQty = P(s, 'חלב 3%').qty, yogQty = P(s, 'יוגורט').qty;
    script.push({ reply: 'לעדכן את הקבלה?', face: 'happy', actions: [
      { kind: 'op', product_id: milk.id, op: { type: 'purchase', amount: 2 } },
      { kind: 'op', product_id: yog.id, op: { type: 'purchase', amount: 3 } },
      { kind: 'op', product_id: eggs.id, op: { type: 'purchase', amount: 1 } },
    ] });
    const c = (await call(avi, 'POST', '/api/chat', { text: 'צילמתי קבלה', image: IMG })).data; assert.ok(c.proposal, JSON.stringify(c));
    assert.match(sysText(calls.at(-1)), /כבר סומנו בעגלה.*חלב 3% \(2\)/);
    const t = c.proposal.lines.map((l) => l.text + (l.detail ? ` [${l.detail}]` : '')).join(' | ');
    assert.doesNotMatch(t, /חלב/, t); assert.match(t, /לסמן שקנינו גביע יוגורט\? \[בקבלה 3, בעגלה סומנו 2/, t); assert.match(t, /לסמן שקנינו אריזת ביצים/, t);
    assert.match(c.reply, /חלב 3% כבר בעגלה מהקניות, אז לא ספרתי שוב/);
    await call(avi, 'POST', `/api/proposals/${c.proposal.id}/apply`, {});
    s = await state(avi);
    assert.equal(P(s, 'חלב 3%').qty, milkQty, 'milk not twice'); assert.equal(P(s, 'יוגורט').qty, yogQty + 1);
    // fewer on the receipt than ticked: corrects down
    script.push({ reply: 'לעדכן?', face: 'happy', actions: [{ kind: 'op', product_id: yog.id, op: { type: 'purchase', amount: 1 } }] });
    const c2 = (await call(avi, 'POST', '/api/chat', { text: 'עוד קבלה', image: IMG })).data;
    assert.match(c2.proposal.lines[0].detail || '', /מתקן/);
    return t;
  });

  await check('N7', 'פתחו את הרזרבה האחרונה של מוצר לא בסיסי → לרשימה (החלטה 11)', async () => {
    let s = await state(avi); const soap = P(s, 'סבון כלים');
    await act(avi, [{ kind: 'op', product_id: soap.id, op: { type: 'open' } }]);
    s = await state(avi);
    assert.equal(P(s, 'סבון כלים').qty, 0); assert.ok(s.list.some((i) => i.product_id === soap.id));
    return P(s, 'סבון כלים').text;
  });

  await check('N8', 'נקנה לאירוח (מוצר חדש): במלאי, לא מלמד, ולא חוזר לרשימה כשנגמר', async () => {
    await act(avi, [{ kind: 'create', bought: true, event: true, product: { name: 'יין אדום', count_type: 'units', unit: 'בקבוק', qty: 2 } }]);
    let s = await state(avi); const w = P(s, 'יין אדום');
    assert.equal(w.occasional, 1); assert.equal(w.qty, 2);
    assert.equal(d1(`SELECT COUNT(*) AS n FROM product_log WHERE product_id = ${w.id}`)[0].n, 0);
    await act(avi, [{ kind: 'op', product_id: w.id, op: { type: 'out' } }]);
    s = await state(avi); assert.ok(!s.list.some((i) => i.product_id === w.id));
    return 'לא ברשימה';
  });

  await check('N9', 'שוקי יודע מי עדכן ומתי; תמונת מקרר ותמונת מתכון מגיעות עם ההסבר הנכון', async () => {
    script.push({ reply: 'אבי, היום.', face: 'happy' });
    await call(michal, 'POST', '/api/chat', { text: 'מי עדכן את היין?' });
    assert.match(sysText(calls.at(-1)), /יין אדום: עודכן אחרון ב-\d{4}-\d{2}-\d{2} על ידי אבי/); // 0e: "מי ומתי" in part 4
    script.push({ reply: 'רואה.', face: 'happy' });
    await call(michal, 'POST', '/api/chat', { text: 'צילמתי מה יש כאן', image: IMG, kind: 'shelf' });
    assert.match(JSON.stringify(calls.at(-1).messages.at(-1)), /מקרר, מדף או ארון/);
    script.push({ reply: 'לשמור?', face: 'happy' });
    await call(michal, 'POST', '/api/chat', { text: 'צילמתי מתכון', image: IMG, kind: 'recipe' });
    assert.match(JSON.stringify(calls.at(-1).messages.at(-1)), /תמונה של מתכון/);
    return 'ok';
  });
} finally {
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} round-13 checks passed`);
  (await import('node:fs')).writeFileSync('test/round13-results.json', JSON.stringify(results, null, 1));
  try { process.kill(-dev.pid, 'SIGKILL'); } catch { /* gone */ }
  mock.close();
  process.exit(ok === results.length ? 0 : 1);
}
