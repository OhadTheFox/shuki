// QA by user story (the user stories of the spec), against `wrangler dev --local`
// with a scripted fake Claude and a fake push service. Run: node test/stories.itest.js
// STORIES_NOW and STORIES_ONLY (below) are for diagnosing only. The full run sets neither (the owner 03/10).
// Every story runs even if an earlier one failed; results go to test/qa-results.json.
import './fetch-retry.js';
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync, readFileSync } from 'node:fs';

const STATE = '/tmp/shuki-test/shuki-qa';
const PORT = 8788, MOCK = 8798;
const VAPID = await (async () => { // a throwaway push key pair for this run
  const { webcrypto: c } = await import('node:crypto');
  const k = await c.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { pub: Buffer.from(await c.subtle.exportKey('raw', k.publicKey)).toString('base64url'), jwk: await c.subtle.exportKey('jwk', k.privateKey) };
})();
const d1 = (sql) => JSON.parse(execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --json --command "${sql.replace(/"/g, '\\"')}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60e3 }).replace(/^[^\[]*/, ""))[0].results; // a stuck d1 fails, not hangs
rmSync(STATE, { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply shuki --local --persist-to ${STATE}`, { stdio: 'ignore' });
execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --file test/fixture-house.sql`, { stdio: 'ignore' });
d1(`INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999), ('222222', 2, 9999999999999), ('333333', 1, 1000)`);
d1(`INSERT OR REPLACE INTO settings (key, value) VALUES ('shop_produce', 'greengrocer')`); // home18 (5): this house buys produce at the greengrocer

// ---- fake Claude + fake push service
const script = []; const claudeCalls = []; const pushes = []; let claudeFail = false;
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    if (req.url.startsWith('/push')) { pushes.push({ url: req.url, headers: req.headers, bytes: body.length }); res.writeHead(201); return res.end(); }
    const parsed = JSON.parse(body); claudeCalls.push(parsed);
    if (claudeFail) { res.writeHead(529); return res.end('{"error":"overloaded"}'); }
    const input = script.shift() || { reply: 'ok', face: 'happy' };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'tool_use', name: 'respond', input }], usage: { input_tokens: 1200, output_tokens: 150, cache_read_input_tokens: 800 } }));
  });
}).listen(MOCK);

// tests only (question 34): STORIES_NOW=<ms> runs the server on a fixed clock (the hourly run too); STORIES_ONLY=25,26 runs just those
const FIXED = process.env.STORIES_NOW ? Number(process.env.STORIES_NOW) : null;
const ONLY = process.env.STORIES_ONLY ? process.env.STORIES_ONLY.split(',') : null;
const dev = spawn('npx', ['wrangler', 'dev', '--local', '--test-scheduled', '--port', String(PORT), '--persist-to', STATE, ...(FIXED ? ['--var', `FIXED_NOW:${FIXED}`] : []),
  '--var', `ANTHROPIC_URL:http://127.0.0.1:${MOCK}/v1/messages`, '--var', 'ANTHROPIC_API_KEY:test',
  '--var', `VAPID_PUBLIC:${VAPID.pub}`, '--var', `VAPID_PRIVATE_JWK:${JSON.stringify(VAPID.jwk)}`, '--var', `PUSH_ALLOW:127.0.0.1:${MOCK}`], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = ''; dev.stdout.on('data', (d) => (log += d)); dev.stderr.on('data', (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
async function waitUp() { for (let i = 0; i < 80; i++) { try { await fetch(base + '/'); return; } catch { await new Promise((r) => setTimeout(r, 500)); } } throw new Error('dev server did not start\n' + log); }
const call = async (token, method, path, body) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60e3) });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const state = async (t) => (await call(t, 'GET', '/api/state')).data;
const P = (s, name) => s.products.find((p) => p.name === name);
const items = (s, name) => s.list.filter((i) => i.product_id === P(s, name)?.id);
const act = async (t, actions, extra = {}) => { const r = await call(t, 'POST', '/api/actions', { actions, ...extra }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
const chat = async (t, text, reply, extra = {}) => { script.push(reply); const r = await call(t, 'POST', '/api/chat', { text, ...extra }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
const apply = async (t, id, skip) => (await call(t, 'POST', `/api/proposals/${id}/apply`, { skip })).data;

const results = [];
async function story(id, name, fn) {
  if (ONLY && !ONLY.includes(id)) return;
  const t0 = Date.now(), took = () => (Date.now() - t0 > 10e3 ? ` (${Math.round((Date.now() - t0) / 1e3)}s)` : ''); // a slow story says so
  try { await fn(); results.push({ id, name, ok: true }); console.log('✓', id, name + took()); }
  catch (e) { results.push({ id, name, ok: false, error: e.message.slice(0, 400) }); console.log('✗', id, name + took(), '\n   ', e.message.slice(0, 400)); }
}

let avi, michal;
try {
  await waitUp();

  // ================= A. joining and cataloguing =================
  await story('1', 'הרשמת מכשיר: קוד חד-פעמי, קוד שפג, קוד שגוי, טוקן מזהה, בלי טוקן = 401', async () => {
    const a = await call(null, 'POST', '/api/pair', { code: '111111', name: 'iPhone' });
    assert.equal(a.status, 200); avi = a.data.token; assert.match(avi, /^[0-9a-f]{64}$/);
    assert.equal((await call(null, 'POST', '/api/pair', { code: '111111' })).status, 400, 'reuse');
    assert.equal((await call(null, 'POST', '/api/pair', { code: '333333' })).status, 400, 'expired');
    assert.equal((await call(null, 'POST', '/api/pair', { code: '999999' })).status, 400, 'unknown');
    assert.equal((await call(null, 'GET', '/api/state')).status, 401);
    assert.equal((await call('x', 'GET', '/api/state')).status, 401);
    michal = (await call(null, 'POST', '/api/pair', { code: '222222' })).data.token;
    assert.equal((await state(michal)).me.name, 'מיכל');
    const dev = d1('SELECT token_hash FROM devices');
    assert.ok(dev.every((d) => d.token_hash !== avi && d.token_hash !== michal), 'tokens stored hashed only');
  });

  let prop;
  await story('2', 'קטלוג לפי אזור: הצעה עם כל השדות, הורדת שורה לפני אישור, אזור נשמר', async () => {
    const r = await chat(avi, 'מתחילים מהמקרר: 2 חלב, 6 ביצים, גבינה צהובה, עגבניות, קוטג\'. חלב, ביצים, צהובה ועגבניות קבועים', { // decision 163: regular only when said
      reply: 'מתחילים מהמקרר!', face: 'excited', catalog_area: 'מקרר', actions: [
        { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 2, is_basic: true, target: 2, shelf_days: 7, category_id: 'מוצרי חלב, גבינות וביצים', location_id: 'מקרר' } },
        { kind: 'create', product: { name: 'ביצים L', count_type: 'pack', pack_size: 12, qty: 6, is_basic: true, target: 12, shelf_days: 21, category_id: 'מוצרי חלב, גבינות וביצים', location_id: 'מקרר' } },
        { kind: 'create', product: { name: 'גבינה צהובה', aliases: ['צהובה'], count_type: 'units', qty: 1, is_basic: true, target: 1, shelf_days: 21, category_id: 'מוצרי חלב, גבינות וביצים', location_id: 'מקרר' } },
        { kind: 'create', product: { name: 'עגבניות', count_type: 'level', level: 'plenty', is_basic: true, store: 'greengrocer', store2: 'super', category_id: 'ירקות ופירות', location_id: 'מקרר' } },
        { kind: 'create', product: { name: 'קוטג\' 5%', count_type: 'units', qty: 1, category_id: 'מוצרי חלב, גבינות וביצים', location_id: 'מקרר' } },
      ] });
    assert.equal(r.proposal.lines.length, 5);
    assert.match(r.proposal.lines[0].detail, /מקרר/);
    const res = await apply(avi, r.proposal.id, [4]); // drop the cottage line
    assert.equal(res.status, 'applied');
    const s = await state(avi);
    assert.equal(s.products.length, 4); assert.equal(P(s, 'קוטג\' 5%'), undefined);
    const eggs = P(s, 'ביצים L');
    assert.equal(s.locations.find((l) => l.id === eggs.location_id).name, 'מקרר');
    assert.equal(s.categories.find((c) => c.id === eggs.category_id).name, 'מוצרי חלב, גבינות וביצים');
    assert.equal(eggs.missing, true); assert.equal(items(s, 'ביצים L').length, 1, 'eggs 6/12 → on list');
    assert.equal(items(s, 'חלב 3%').length, 0);
    assert.equal(d1("SELECT value FROM settings WHERE key = 'catalog_area'")[0]?.value, 'מקרר'); // the state carries only what the app reads (stage 9, task 0)
    assert.equal((await apply(avi, r.proposal.id)).status, 'applied', 'second apply is a no-op');
    assert.equal((await state(avi)).products.length, 4, 'not applied twice');
  });

  await story('3', 'המשך קטלוג: האזור הנוכחי והקטלוג נשלחים לשוקי בשיחה הבאה', async () => {
    await chat(michal, 'איפה עצרנו?', { reply: 'עצרנו במקרר. ממשיכים למזווה?', face: 'happy' });
    const sys = JSON.stringify(claudeCalls.at(-1).system);
    assert.match(sys, /אזור קטלוג נוכחי: מקרר/); assert.match(sys, /ביצים L/); assert.match(sys, /המשתמש שכותב עכשיו: מיכל/);
    assert.equal(claudeCalls.at(-1).tool_choice.name, 'respond');
    assert.equal(claudeCalls.at(-1).system[0].cache_control.type, 'ephemeral', 'instructions are prompt-cached');
  });

  await story('4', 'מוצר כפול: שוקי יכול להוסיף לכמות הקיימת (purchase) במקום ליצור כפול', async () => {
    const s0 = await state(avi); const cheese = P(s0, 'גבינה צהובה');
    const r = await chat(avi, 'עוד גבינה צהובה במקפיא', { reply: 'להוסיף לגבינה הצהובה הקיימת או מוצר נפרד במקפיא?', face: 'confused', options: ['להוסיף לקיימת', 'מוצר נפרד במקפיא'] });
    assert.equal(r.proposal, undefined); assert.equal(r.options.length, 2);
    const r2 = await chat(avi, 'מוצר נפרד במקפיא', { reply: 'יוצר גבינה צהובה במקפיא', face: 'happy', actions: [{ kind: 'create', product: { name: 'גבינה צהובה (מקפיא)', count_type: 'batches', qty: 1, shelf_days: 90, category_id: 'מוצרי חלב, גבינות וביצים', location_id: 'מקפיא' } }] });
    await apply(avi, r2.proposal.id);
    const s = await state(avi);
    assert.equal(P(s, 'גבינה צהובה').qty, cheese.qty); assert.equal(P(s, 'גבינה צהובה (מקפיא)').batches.length, 1);
  });

  // ================= B. day-to-day reports =================
  await story('5', 'נגמר: כמות 0, בסיסי נכנס לרשימה', async () => {
    const s0 = await state(michal);
    const r = await chat(michal, 'נגמר החלב', { reply: 'אוי, נגמר החלב', face: 'sad', actions: [{ kind: 'op', product_id: P(s0, 'חלב 3%').id, op: { type: 'out' } }] });
    await apply(michal, r.proposal.id);
    const s = await state(michal);
    assert.equal(P(s, 'חלב 3%').qty, 0); assert.equal(items(s, 'חלב 3%')[0].source, 'auto');
    assert.equal(P(s, 'חלב 3%').next_expiry, null, 'no expiry when out');
    assert.match(s.journal[0].summary, /^מיכל סימנה שנגמר חלב 3%/);
  });

  await story('6', 'עומד להיגמר: level → מעט → ברשימה; units → כמות נמוכה', async () => {
    const s0 = await state(michal);
    await act(michal, [{ kind: 'op', product_id: P(s0, 'עגבניות').id, op: { type: 'low' } }]);
    const s = await state(michal);
    assert.equal(P(s, 'עגבניות').level, 'little'); assert.equal(items(s, 'עגבניות').length, 1);
    assert.equal(items(s, 'עגבניות')[0].store, 'greengrocer');
  });

  await story('7', 'בשימוש + רזרבה: פתחנו את האחרון → 0 רזרבה → לרשימה', async () => {
    await act(avi, [{ kind: 'create', product: { name: 'אורז בסמטי', count_type: 'inuse', is_open: 1, qty: 1, is_basic: 1, target: 1, category_id: 'יבשים', location_id: 'מזווה' } }]);
    let s = await state(avi); assert.equal(items(s, 'אורז בסמטי').length, 0);
    await act(avi, [{ kind: 'op', product_id: P(s, 'אורז בסמטי').id, op: { type: 'out' } }]);
    s = await state(avi);
    assert.equal(P(s, 'אורז בסמטי').is_open, 1); assert.equal(P(s, 'אורז בסמטי').qty, 0);
    assert.equal(items(s, 'אורז בסמטי').length, 0, 'home18 (1): the open one counts as one'); assert.equal(P(s, 'אורז בסמטי').text, 'יחידה אחת פתוחה, אין יחידות סגורות');
  });

  await story('8', 'כמה דיווחים בהודעה אחת = אירוע אחד, ביטול אחד מחזיר הכל', async () => {
    const s0 = await state(avi);
    const r = await chat(avi, 'נגמרה הגבינה הצהובה והביצים', { reply: 'שני עדכונים', face: 'happy', actions: [
      { kind: 'op', product_id: P(s0, 'גבינה צהובה').id, op: { type: 'out' } }, { kind: 'op', product_id: P(s0, 'ביצים L').id, op: { type: 'out' } }] });
    assert.equal(r.proposal.lines.length, 2);
    await apply(avi, r.proposal.id);
    let s = await state(avi);
    assert.equal(P(s, 'גבינה צהובה').qty, 0); assert.equal(P(s, 'ביצים L').qty, 0);
    assert.equal((await call(avi, 'POST', '/api/undo')).status, 200);
    s = await state(avi);
    assert.equal(P(s, 'גבינה צהובה').qty, 1); assert.equal(P(s, 'ביצים L').qty, 6);
    assert.equal(items(s, 'גבינה צהובה').length, 0);
  });

  await story('9', 'עמימות: אין הצעה, יש כפתורים; לחיצה שולחת את הטקסט', async () => {
    const r = await chat(michal, 'נגמרה הגבינה', { reply: 'סליחה, לא הבנתי. הכוונה לגבינה צהובה?', face: 'confused', options: ['גבינה צהובה', 'גבינה צהובה (מקפיא)'] });
    assert.equal(r.proposal, undefined); assert.equal(r.face, 'confused'); assert.deepEqual(r.options, ['גבינה צהובה', 'גבינה צהובה (מקפיא)']);
    const h = (await call(michal, 'GET', '/api/chat')).data.messages;
    assert.equal(h.at(-1).content.options.length, 2); assert.equal(h.at(-2).name, 'מיכל');
  });

  await story('10', 'מוצר לא מוכר שנגמר: נוצר (reported) ונכנס לרשימה גם בלי להיות בסיסי', async () => {
    const r = await chat(michal, 'נגמר רוטב סויה', { reply: 'לא הכרתי אותו. להוסיף לרשימה?', face: 'happy', actions: [{ kind: 'create', reported: true, product: { name: 'רוטב סויה', count_type: 'level', level: 'none', category_id: 'שימורים ורטבים', location_id: 'מזווה' } }] });
    await apply(michal, r.proposal.id);
    const s = await state(michal);
    assert.equal(P(s, 'רוטב סויה').level, 'none'); assert.equal(items(s, 'רוטב סויה')[0].source, 'reported');
  });

  await story('11', 'זרקנו: יורד מהמלאי, נרשם בזבוז; שוקי בוכה רק רגע באפליקציה (החלטה 131)', async () => {
    const s0 = await state(avi);
    await act(avi, [{ kind: 'op', product_id: P(s0, 'קוטג\' 5%')?.id ?? P(s0, 'גבינה צהובה').id, op: { type: 'discard' } }]);
    const s = await state(avi);
    assert.notEqual(s.mood.mood, 'sad');
    assert.equal(d1('SELECT COUNT(*) n FROM events WHERE waste = 1')[0].n, 1);
    await call(avi, 'POST', '/api/undo');
  });

  await story('12', 'תיקון ידני: שינוי שדות, שינוי סוג ספירה, כמות שלילית נחסמת', async () => {
    const s0 = await state(avi); const milk = P(s0, 'חלב 3%');
    await act(avi, [{ kind: 'edit', product_id: milk.id, fields: { qty: 3, location_id: 'מקפיא', target: 3 } }]);
    let s = await state(avi);
    assert.equal(P(s, 'חלב 3%').qty, 3); assert.equal(s.locations.find((l) => l.id === P(s, 'חלב 3%').location_id).name, 'מקפיא');
    assert.equal(items(s, 'חלב 3%').length, 0, 'back at target → auto item removed');
    await act(avi, [{ kind: 'edit', product_id: milk.id, fields: { count_type: 'batches' } }]);
    s = await state(avi); assert.equal(P(s, 'חלב 3%').batches.reduce((a, b) => a + b.qty, 0), 3);
    const bad = await call(avi, 'POST', '/api/actions', { actions: [{ kind: 'edit', product_id: milk.id, fields: { qty: -2 } }] });
    assert.equal(bad.status, 400);
    await act(avi, [{ kind: 'op', product_id: milk.id, op: { type: 'use', amount: 99 } }]);
    assert.equal(P(await state(avi), 'חלב 3%').qty, 0, 'using more than exists stops at 0');
    await act(avi, [{ kind: 'edit', product_id: milk.id, fields: { count_type: 'units', qty: 1, location_id: 'מקרר', target: 2 } }]);
  });

  await story('13', 'ביטול: רק הפעולה האחרונה שלי; ביטול יצירה מוחק מוצר ופריטי רשימה', async () => {
    await act(michal, [{ kind: 'create', product: { name: 'שמפו', count_type: 'inuse', is_open: 0, qty: 0, is_basic: 1, target: 1, category_id: 'טואלטיקה והיגיינה' } }]);
    let s = await state(michal); assert.equal(items(s, 'שמפו').length, 1);
    await act(avi, [{ kind: 'op', product_id: P(s, 'עגבניות').id, op: { type: 'purchase' } }]);
    await call(michal, 'POST', '/api/undo');
    s = await state(michal);
    assert.equal(P(s, 'שמפו'), undefined); assert.equal(s.list.filter((i) => !i.product_id && !i.text).length, 0);
    assert.equal(P(s, 'עגבניות').level, 'plenty', 'avi\'s later action untouched');
    assert.equal(s.undo?.summary?.startsWith('מיכל'), true);
  });

  // ================= C. questions =================
  await story('14-17', 'שאלות: הקטלוג שנשלח לשוקי כולל כמות, מיקום, בסיסי/חסר, חנות ותוקף; אין הצעה', async () => {
    const r = await chat(avi, 'יש לנו ביצים? מה חסר? מה פג בקרוב? איפה האורז?', { reply: 'ביצים: 6 מתוך 12, במקרר…', face: 'neutral' });
    assert.equal(r.proposal, undefined);
    const sys = claudeCalls.at(-1).system[2].text; // 0e: part 3, the catalog and the list
    const eggs = sys.split('\n').find((l) => l.includes('ביצים L'));
    assert.match(eggs, /מקרר/); assert.match(eggs, /קבוע, מינימום 12/); assert.match(eggs, /פחות מהמינימום/); assert.match(eggs, /\d{4}-\d{2}-\d{2}/, 'expiry date'); // 0e: the short line
    assert.match(sys, /רשימת קניות/); assert.match(sys, /אורז בסמטי\|.*מזווה/);
  });

  // ================= D. the list and shopping =================
  await story('18', 'רשימה לפי חנות + "גם מכאן" (store2)', async () => {
    const s = await state(avi);
    const tomato = items(s, 'עגבניות');
    // tomatoes were bought in story 13; mark low again so they are on the greengrocer list
    if (!tomato.length) await act(michal, [{ kind: 'op', product_id: P(s, 'עגבניות').id, op: { type: 'low' } }]);
    const s2 = await state(avi);
    const t = items(s2, 'עגבניות')[0];
    assert.equal(t.store, 'greengrocer'); assert.equal(P(s2, 'עגבניות').store2, 'super');
    assert.ok(s2.list.some((i) => i.store === 'super'));
  });

  await story('19', 'הוספה ידנית: מוצר מהקטלוג (בלי כפילות) ופריט חד-פעמי', async () => {
    const s0 = await state(avi);
    await act(avi, [{ kind: 'list_add', product_id: P(s0, 'ביצים L').id }]);
    await act(avi, [{ kind: 'list_add', text: 'חלק לכיור', store: 'super' }]);
    await act(avi, [{ kind: 'list_add', product_id: P(s0, 'גבינה צהובה').id, store: 'super' }]);
    const s = await state(avi);
    assert.equal(items(s, 'ביצים L').length, 1, 'no duplicate for an item already on the list');
    assert.ok(s.list.find((i) => i.text === 'חלק לכיור')); assert.equal(items(s, 'גבינה צהובה')[0].source, 'manual');
    assert.equal((await call(avi, 'POST', '/api/actions', { actions: [{ kind: 'list_add', text: '  ' }] })).status, 400);
  });

  await story('20', 'סימון בקנייה: כמה קנינו → מלאי; מיכל רואה את הסימון של אבי', async () => {
    const s0 = await state(avi); const it = items(s0, 'ביצים L')[0];
    assert.equal(P(s0, 'ביצים L').suggested, 1, 'suggest 1 pack for 6/12');
    await act(avi, [{ kind: 'check', item_id: it.id, amount: 2 }], { context: 'shopping' });
    const sn = await state(michal);
    assert.equal(P(sn, 'ביצים L').qty, 30); assert.equal(items(sn, 'ביצים L')[0].status, 'checked'); assert.equal(items(sn, 'ביצים L')[0].bought_qty, 2);
    assert.ok(P(sn, 'ביצים L').next_expiry > Date.now());
    await act(avi, [{ kind: 'uncheck', item_id: it.id }]);
    const s2 = await state(avi); assert.equal(P(s2, 'ביצים L').qty, 6, 'uncheck returns the amount');
    await act(avi, [{ kind: 'check', item_id: it.id, amount: 1 }], { context: 'shopping' });
  });

  await story('21', 'בלי קליטה: אותה פעולה שנשלחת פעמיים (op_id) נרשמת פעם אחת, עם זמן הסימון המקורי', async () => {
    const s0 = await state(michal); const it = s0.list.find((i) => i.text === 'חלק לכיור');
    const ts = Date.now() - 20 * 60e3;
    const body = { op_id: 'offline-abc', ts, context: 'shopping', actions: [{ kind: 'check', item_id: it.id }] };
    await call(michal, 'POST', '/api/actions', body);
    const again = await call(michal, 'POST', '/api/actions', body);
    assert.equal(again.data.replay, true);
    assert.equal(d1("SELECT COUNT(*) n FROM events WHERE op_id = 'offline-abc'")[0].n, 1);
    assert.equal(d1("SELECT ts FROM events WHERE op_id = 'offline-abc'")[0].ts, ts);
  });

  await story('22', 'סיימתי קנייה: מסומנים יוצאים, לא מסומנים נשארים, רק בחנות הזאת', async () => {
    const s0 = await state(avi);
    const openSuper = s0.list.filter((i) => i.store === 'super' && i.status === 'open').length;
    const greengrocer = s0.list.filter((i) => i.store === 'greengrocer').length;
    await act(avi, [{ kind: 'finish', store: 'super' }]);
    const s = await state(avi);
    // only what Avi ticked (r0t d44); "חלק לכיור" is Michal's tick: it stays hers until she finishes
    assert.equal(s.list.filter((i) => i.status === 'checked' && i.store === 'super' && i.checked_by === s.me.id).length, 0);
    assert.equal(s.list.find((i) => i.text === 'חלק לכיור')?.status, 'checked');
    assert.equal(s.list.filter((i) => i.store === 'super' && i.status === 'open').length, openSuper);
    assert.equal(s.list.filter((i) => i.store === 'greengrocer').length, greengrocer);
    await act(michal, [{ kind: 'finish', store: 'super' }]);
    assert.equal((await state(avi)).list.find((i) => i.text === 'חלק לכיור'), undefined);
    assert.equal((await state(avi)).list.filter((i) => i.status === 'checked' && i.store === 'super').length, 0);
  });

  await story('23', 'מחוץ לרשימה: מוצר מלאי חדש נספר; קנייה של מה שברשימה לא נספרת; חד-פעמי לא נספר', async () => {
    const before = (await state(avi)).offListThisMonth;
    const r = await chat(avi, 'קניתי רכז רימונים במבצע', { reply: 'רכז רימונים! חדש במלאי', face: 'excited', actions: [{ kind: 'create', bought: true, product: { name: 'רכז רימונים', count_type: 'units', qty: 1, category_id: 'שימורים ורטבים', location_id: 'מזווה' } }] });
    await apply(avi, r.proposal.id);
    let s = await state(avi); assert.equal(s.offListThisMonth, before + 1);
    const milk = P(s, 'חלב 3%');
    const onList = items(s, 'חלב 3%').length > 0;
    const r2 = await chat(avi, 'קניתי חלב', { reply: 'קנית חלב', face: 'happy', actions: [{ kind: 'op', product_id: milk.id, op: { type: 'purchase', amount: 1 } }] });
    await apply(avi, r2.proposal.id);
    s = await state(avi);
    assert.equal(s.offListThisMonth, before + 1 + (onList ? 0 : 1), 'milk counted only if it was not on the list');
    const tuna = await act(avi, [{ kind: 'create', product: { name: 'טונה', count_type: 'units', qty: 4, category_id: 'שימורים ורטבים' } }]);
    const r3 = await chat(avi, 'קניתי טונה', { reply: 'עוד טונה', face: 'happy', actions: [{ kind: 'op', product_id: tuna.created[0], op: { type: 'purchase', amount: 2 } }] });
    await apply(avi, r3.proposal.id);
    assert.equal((await state(avi)).offListThisMonth, before + 2 + (onList ? 0 : 1), 'known product bought outside the list counts too');
  });

  await story('24', 'קבלה: התמונה מגיעה לשוקי, שורות ממופות, כינוי נשמר', async () => {
    const s0 = await state(michal);
    const img = { media_type: 'image/jpeg', data: Buffer.from('fake-jpeg').toString('base64') };
    const r = await chat(michal, 'צילמתי קבלה', { reply: 'זיהיתי 2 שורות', face: 'excited', actions: [
      { kind: 'op', product_id: P(s0, 'רוטב סויה').id, op: { type: 'purchase', amount: 1 } },
      { kind: 'alias', alias: 'רוטב סויה קיקומן 250', product_id: P(s0, 'רוטב סויה').id }] }, { image: img });
    const sent = claudeCalls.at(-1).messages.at(-1).content;
    assert.equal(sent[0].type, 'image'); assert.equal(sent[0].source.data, img.data);
    assert.match(r.proposal.lines[1].text, /קיקומן/);
    await apply(michal, r.proposal.id);
    assert.equal(d1("SELECT product_id FROM receipt_aliases WHERE alias = 'רוטב סויה קיקומן 250'")[0].product_id, P(s0, 'רוטב סויה').id);
    const s = await state(michal); assert.equal(P(s, 'רוטב סויה').level, 'plenty');
    // at home (no shopping trip open) the receipt closes the line; in the store it goes to the cart (test/cases.itest.js R7)
    assert.equal(items(s, 'רוטב סויה').length, 0, 'receipt purchase closes the list item');
    const badImg = await call(michal, 'POST', '/api/chat', { image: { media_type: 'application/pdf', data: 'x' } });
    assert.equal(badImg.data.error, 'ההודעה ריקה', 'non-image upload rejected');
  });

  // ================= E. reminders and Shuki =================
  await story('25', 'סיכום יומי: בשעת הסיכום, רק כשמשהו פג תוך יומיים, פעם אחת ביום לכל מכשיר', async () => {
    const now = FIXED ?? Date.now(); // the server's clock
    const hour = +new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', hour: 'numeric', hourCycle: 'h23' }).format(new Date(now));
    await call(avi, 'POST', '/api/settings', { digest_hour: hour });
    // the hour is the real one: at night or on Shabbat, quiet hours would stop the push. During a shopping trip there are
    // none, so whoever has a phone is "in the shop" for this story (question 34; wrangler's /__scheduled takes no time)
    const trip = now; d1(`INSERT INTO shopping (user_id, store, started) SELECT DISTINCT user_id, 'super', ${trip} FROM devices WHERE kind = 'app'`);
    try {
      d1(`UPDATE devices SET push_sub = '{"endpoint":"http://127.0.0.1:${MOCK}/push/avi","keys":{"p256dh":"BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM","auth":"tBHItJI5svbpez7KI4CCXg"}}'`);
      const s = await state(avi);
      await act(avi, [{ kind: 'edit', product_id: P(s, 'גבינה צהובה').id, fields: { expires: now + 86400e3 } }]);
      // a scheduled run that doesn't answer fails here, it doesn't hang the run
      await fetch(`${base}/__scheduled?cron=0+*+*+*+*`, { signal: AbortSignal.timeout(60e3) }); await new Promise((r) => setTimeout(r, 1500));
      assert.equal(pushes.length, 2, `one push per device, got ${pushes.length}\n${log.slice(-800)}`);
      assert.equal(pushes[0].headers['content-encoding'], 'aes128gcm'); assert.match(pushes[0].headers.authorization, /^vapid t=/);
      await fetch(`${base}/__scheduled?cron=0+*+*+*+*`, { signal: AbortSignal.timeout(60e3) }); await new Promise((r) => setTimeout(r, 800));
      assert.equal(pushes.length, 2, 'not twice the same day');
    } finally { // what the story set goes back, also when it fails
      await call(avi, 'POST', '/api/settings', { digest_hour: (hour + 3) % 24 });
      d1(`DELETE FROM shopping WHERE started = ${trip}`);
    }
  });

  await story('26', 'מצב רוח: לפי אחוז בסיסיים; ישנוני אחרי 3 ימים בלי עדכון', async () => {
    let s = await state(avi);
    assert.ok(['happy', 'neutral', 'hungry', 'ecstatic'].includes(s.mood.mood));
    assert.equal(s.mood.basics, s.products.filter((p) => p.is_basic).length);
    d1(`UPDATE events SET ts = ts - ${4 * 86400e3}`);
    s = await state(avi); assert.equal(s.mood.mood, 'sleepy');
    d1(`UPDATE events SET ts = ts + ${4 * 86400e3}`);
  });

  await story('27', 'הצעה להפוך לבסיסי: מוצר לא בסיסי שנגמר 3 פעמים', async () => {
    const s0 = await state(avi); const id = P(s0, 'רכז רימונים').id;
    for (let i = 0; i < 3; i++) { await act(avi, [{ kind: 'op', product_id: id, op: { type: 'out' } }]); await act(avi, [{ kind: 'op', product_id: id, op: { type: 'purchase', amount: 1 } }]); }
    const s = await state(avi);
    assert.equal(s.suggestBasic.find((x) => x.id === id)?.times, 3);
    await act(avi, [{ kind: 'edit', product_id: id, fields: { is_basic: 1 } }]);
    assert.equal((await state(avi)).suggestBasic.find((x) => x.id === id), undefined);
  });

  // 28 (monthly summary text/decision) is unit-tested in domain.test.js: the local runtime cannot fake the date.
  // 29 (afro laugh after a streak) is a client behaviour: covered in the UI pass.

  // ================= F. settings =================
  await story('30', 'קטגוריה חדשה', async () => {
    await call(avi, 'POST', '/api/settings', { addCategory: 'אוכל לחתול' });
    assert.ok((await state(avi)).categories.find((c) => c.name === 'אוכל לחתול'));
  });
  await story('31', 'מיקומים: שינוי שם והוספה', async () => {
    const s0 = await state(avi); const store = s0.locations.find((l) => l.name === 'מחסן');
    await call(avi, 'POST', '/api/settings', { locations: [{ id: store.id, name: 'מחסן במרפסת', sort: store.sort }, { name: 'ארון נעליים' }] });
    const s = await state(avi);
    assert.ok(s.locations.find((l) => l.name === 'מחסן במרפסת')); assert.ok(s.locations.find((l) => l.name === 'ארון נעליים'));
  });
  await story('32', 'שעת סיכום והתראות למכשיר (מנוי, כיבוי, בדיקה)', async () => {
    const sub = { endpoint: `https://push.example.com/abc`, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } };
    assert.equal((await call(michal, 'POST', '/api/push/subscribe', { subscription: sub, on: true })).status, 200);
    assert.equal((await call(michal, 'POST', '/api/push/subscribe', { subscription: { endpoint: 'http://evil' , keys: sub.keys } })).status, 400);
    await call(michal, 'POST', '/api/push/subscribe', { on: false });
    assert.equal(d1("SELECT push_on FROM devices WHERE user_id = 2")[0].push_on, 0);
    await call(avi, 'POST', '/api/settings', { digest_hour: 21 });
    assert.equal((await state(avi)).settings.digest_hour, '21');
    d1(`UPDATE devices SET push_sub = '${JSON.stringify({ endpoint: `http://127.0.0.1:${MOCK}/push/test`, keys: sub.keys })}' WHERE user_id = 1`);
    const t = await call(avi, 'POST', '/api/push/test');
    assert.equal(t.data?.ok, true, JSON.stringify(t) + log.slice(-1500));
  });
  await story('33', 'ייצוא: כל הטבלאות, קובץ להורדה', async () => {
    const r = await fetch(base + '/api/export', { headers: { authorization: `Bearer ${avi}` } });
    assert.match(r.headers.get('content-disposition'), /attachment; filename="shuki-/);
    const dump = await r.json();
    for (const t of ['products', 'batches', 'list_items', 'events', 'locations', 'categories', 'receipt_aliases', 'settings']) assert.ok(Array.isArray(dump[t]), t);
    assert.equal((await fetch(base + '/api/export')).status, 401);
  });

  // ================= edge cases =================
  await story('E1', 'המודל לא זמין: תשובה ידידותית, הרשימה ממשיכה לעבוד', async () => {
    claudeFail = true;
    const r = await call(avi, 'POST', '/api/chat', { text: 'נגמר החלב' });
    claudeFail = false;
    assert.equal(r.status, 200); assert.equal(r.data.reply, 'משהו השתבש אצלי. האם אפשר לנסות שוב עוד רגע?'); assert.equal(r.data.proposal, undefined); // decision 6 (פ18)
    assert.equal((await call(avi, 'GET', '/api/state')).status, 200);
  });
  await story('E2', 'תקרת הוצאה: מעבר לתקרה הצ\'אט נכבה בלי לקרוא למודל', async () => {
    const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
    const used = d1(`SELECT * FROM usage WHERE month = '${month}'`)[0];
    assert.ok(used && used.input_tokens > 0 && used.output_tokens > 0, 'usage is recorded');
    d1(`UPDATE usage SET input_tokens = 9000000, micro = 18000000 WHERE month = '${month}'`); // $18, over the $10 cap
    const n = claudeCalls.length;
    const r = await call(avi, 'POST', '/api/chat', { text: 'היי' });
    assert.match(r.data.reply, /נגמרה לי הסוללה/); assert.equal(claudeCalls.length, n);
    d1(`UPDATE usage SET input_tokens = 0, micro = 0 WHERE month = '${month}'`);
  });
  await story('E3', 'מוצר שנמחק: נעלם מהמלאי ומהרשימה, נשאר ביומן', async () => {
    const s0 = await state(avi); const id = P(s0, 'שמפו')?.id ?? P(s0, 'טונה').id;
    await act(avi, [{ kind: 'list_add', product_id: id }]);
    await act(avi, [{ kind: 'delete', product_id: id }]);
    const s = await state(avi);
    assert.equal(s.products.find((p) => p.id === id), undefined); assert.equal(s.list.find((i) => i.product_id === id), undefined);
    assert.ok(d1(`SELECT deleted FROM products WHERE id = ${id}`)[0].deleted);
    assert.equal((await call(avi, 'POST', '/api/actions', { actions: [{ kind: 'op', product_id: id, op: { type: 'out' } }] })).status, 400, 'acting on a deleted product fails cleanly');
  });
  await story('E4', 'קלט עוין: שם עם HTML נשמר כטקסט; פעולה לא מוכרת נדחית; product_id מומצא נדחה בלי לשנות כלום', async () => {
    await act(avi, [{ kind: 'create', product: { name: '<img src=x onerror=alert(1)>', count_type: 'units' } }]);
    assert.ok(P(await state(avi), '<img src=x onerror=alert(1)>'));
    assert.equal((await call(avi, 'POST', '/api/actions', { actions: [{ kind: 'drop_table' }] })).status, 400);
    const n = claudeCalls.length;
    script.push({ reply: 'x', face: 'happy', actions: [{ kind: 'op', product_id: 123, op: { type: 'out' } }] });
    script.push({ reply: 'מצטער, לא מצאתי את זה בקטלוג', face: 'confused' });
    const r = (await call(avi, 'POST', '/api/chat', { text: 'נגמר משהו' })).data;
    assert.equal(claudeCalls.length, n + 2, 'one retry after an invented id');
    assert.equal(claudeCalls.at(-1).messages.at(-1).content[0].type, 'tool_result');
    assert.match(claudeCalls.at(-1).messages.at(-1).content[0].content, /product_id 123 לא קיים/);
    assert.equal(r.proposal, undefined, 'invalid lines are never shown');
    // the retry can fix it
    const milk = P(await state(avi), 'חלב 3%');
    script.push({ reply: 'x', face: 'happy', actions: [{ kind: 'op', product_id: 999, op: { type: 'out' } }] });
    script.push({ reply: 'חלב נגמר', face: 'sad', actions: [{ kind: 'op', product_id: milk.id, op: { type: 'out' } }] });
    const r2 = (await call(avi, 'POST', '/api/chat', { text: 'נגמר החלב' })).data;
    assert.equal(r2.proposal.lines.length, 1); assert.match(r2.proposal.lines[0].text, /חלב/);
    script.push({ reply: 'יופי 😀 הכל טוב 🤖', face: 'happy' });
    assert.equal((await call(avi, 'POST', '/api/chat', { text: 'היי' })).data.reply, 'יופי הכל טוב', 'emoji stripped');
  });
  await story('E5', 'פעולה עם כמה שורות שאחת מהן שגויה: לא נכתב כלום (אטומי)', async () => {
    const s0 = await state(avi); const before = P(s0, 'ביצים L').qty;
    const r = await call(avi, 'POST', '/api/actions', { actions: [{ kind: 'op', product_id: P(s0, 'ביצים L').id, op: { type: 'out' } }, { kind: 'op', product_id: 1, op: { type: 'out' } }] });
    assert.equal(r.status, 400); assert.equal(P(await state(avi), 'ביצים L').qty, before);
  });
} catch (e) {
  console.error('harness error:', e.message, '\n', log.slice(-2000));
} finally {
  writeFileSync(new URL('./qa-results.json', import.meta.url), JSON.stringify(results, null, 1));
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} stories passed`);
  try { process.kill(-dev.pid, 'SIGKILL'); } catch { /* gone */ }
  mock.close(); setTimeout(() => process.exit(bad.length ? 1 : 0), 300);
}
