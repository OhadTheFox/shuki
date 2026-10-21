// Round 20 (28/09): decisions 150-189 against a fake model — the first meeting run by the server (every step and
// every way out of it), questions before cards, plain yes/no answers, the list screen, and bought-fewer.
// The same things against the real model, through the app: test/e2e-onboarding.sh and test/stories-e2e.sh.
// Run: node test/round20.itest.js
import './fetch-retry.js';
import { israelAt, israelDate } from './israel-time.js';
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';

const STATE = '/tmp/shuki-test/shuki-r20';
const PORT = 8785, MOCK = 8784;
const d1 = (sql) => JSON.parse(execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --json --command "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^[^[]*/, ''))[0].results;
rmSync(STATE, { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply shuki --local --persist-to ${STATE}`, { stdio: 'ignore' });

// the fake model answers from the script, in order: the first meeting's reader and the chat alike
const script = []; const calls = [];
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { const b = Buffer.concat(parts).toString('utf8'); // bytes first: a Hebrew letter can be split between chunks (question 29)

  const body = JSON.parse(b || '{}'); calls.push(body);
  const input = script.shift() || { reply: 'ok', face: 'happy' };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'tool_use', id: 'tu1', name: body.tools?.[0]?.name || 'respond', input }], usage: { input_tokens: 100, output_tokens: 10 } }));
}); }).listen(MOCK);
const dev = spawn('npx', ['wrangler', 'dev', '--local', '--test-scheduled', '--port', String(PORT), '--persist-to', STATE, '--var', `ANTHROPIC_URL:http://127.0.0.1:${MOCK}/v1/messages`, '--var', 'ANTHROPIC_API_KEY:t', '--var', 'TEST_RESET:1', '--var', 'SETUP_CODE:13572468', '--var', 'CHAT_PER_MINUTE:1000'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = ''; dev.stdout.on('data', (d) => (log += d)); dev.stderr.on('data', (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
const call = async (t, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const txt = await r.text(); let data = null; try { data = JSON.parse(txt); } catch { /* text */ } return { status: r.status, data, text: txt }; };
const state = async (t) => (await call(t, 'GET', '/api/state')).data;
const results = [];
async function check(id, name, fn) {
  try { const note = await fn(); results.push({ id, name, ok: true, note: note || '' }); console.log('✓', id, name, note ? `— ${note}` : ''); }
  catch (e) { results.push({ id, name, ok: false, error: e.message.slice(0, 500) }); console.log('✗', id, name, '\n   ', e.message.slice(0, 500)); }
}
const act = (t, actions, extra = {}) => call(t, 'POST', '/api/actions', { actions, op_id: `op-${Math.random()}`, ...extra });
const say = async (t, text, ...outs) => { script.push(...outs); return (await call(t, 'POST', '/api/chat', { text })).data; };
const bots = async (t) => (await call(t, 'GET', '/api/chat')).data.messages.filter((m) => m.role === 'shuki').map((m) => m.content);
const P = (s, name) => s.products.find((p) => p.name === name);
let avi;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }

  await check('O1', 'הקמה: ארבע בועות של מי אני, והאחרונה שואלת מי בבית (150, 179)', async () => {
    const r = await call(null, 'POST', '/api/setup', { code: '13572468', house: 'הבית', name: 'אבי', gender: 'm' });
    assert.equal(r.status, 200, r.text); avi = r.data.token;
    const b = await bots(avi); assert.equal(b.length, 4); assert.match(b[3].reply, /מי מנהל את האפליקציה ומי עוד גר בבית\?$/);
  });

  await check('O2', 'מי גר בבית: אשה וילדים בלי שמות → "ומה השמות?"; שם דו-מיני → שאלה אחת; "בחורה" מובן; מי צריך טלפון (152, 153, r0t d152)', async () => {
    let r = await say(avi, 'אני אבי. גרים איתי מיכל אשתי והילדים', { people: [{ name: 'מיכל', gender: 'f', child: false }, { name: '', gender: 'unknown', child: true }] });
    assert.equal(r.reply, 'איך קוראים להם? ואם יש ילדים, בני כמה הם?');
    r = await say(avi, 'טל בת 8 ויואב בן 17', { people: [{ name: 'טל', gender: 'unknown', child: true, age: 8 }, { name: 'יואב', gender: 'm', child: true, age: 17 }] });
    assert.equal(r.reply, 'איך לפנות לטל?'); assert.deepEqual(r.options, ['בלשון זכר', 'בלשון נקבה', 'בלשון רבים']);
    r = await say(avi, 'טל בחורה', {});
    // r0t d152 (approved 03/10): who needs a phone, before any code
    assert.equal(r.reply, 'למי מהם צריך קוד לטלפון?'); assert.deepEqual(r.options, ['מיכל', 'טל', 'יואב', 'לכולם', 'לאף אחד']);
    assert.ok(!(await bots(avi)).some((x) => x.codes), 'codes before asking');
    r = (await call(avi, 'POST', '/api/chat', { text: 'לכולם' })).data; // a button: no model
    // r0t r9-96 (the decision's words): one question about food before the mapping; what's about a person is their fact
    assert.equal(r.reply, 'האם יש מישהו בבית שלא אוכל משהו?');
    r = await say(avi, 'מיכל צמחונית ויואב לא אוכל פטריות', { food: [{ name: 'מיכל', key: 'diet', value: 'צמחונית', text: 'מיכל צמחונית' }, { name: 'יואב', key: 'avoid', value: 'פטריות', text: 'יואב לא אוכל פטריות' }] });
    assert.equal(r.reply, 'האם יש משהו בסגנון החיים שלך שכדאי שאדע? למשל אימונים או דיאטה.'); // stage 8, ז2: the lifestyle question before the mapping
    const said = (await bots(avi)).find((x) => /^רשמתי ש/.test(x.reply || ''));
    r = (await call(avi, 'POST', '/api/chat', { text: 'נדלג על זה' })).data;
    assert.match(r.reply, /מאיפה מתחילים\?$/);
    assert.equal(said?.reply, 'רשמתי שמיכל צמחונית ושיואב לא אוכל פטריות.');
    const s = await state(avi); const u = (n) => s.users.find((x) => x.name === n);
    assert.equal(u('טל').gender, 'f'); assert.equal(u('טל').role, 'child'); assert.equal(u('יואב').role, 'child', 'a child at any age (r0t d152)'); assert.equal(u('מיכל').gender, 'f');
    const b = await bots(avi); const codes = b.find((x) => x.codes); assert.equal(codes.codes.length, 3); assert.equal(codes.only, s.me.id, 'the codes only to the admin');
  });

  await check('O3', 'מקום ומה יש בו בהודעה אחת; "איזה חלב?" עם תשובה חופשית; נכנס למלאי מיד עם "לתקן" (154, 155, 187)', async () => {
    let r = await say(avi, 'במקרר יש חלב, 3 יוגורטים ו-6 ביצים', { place: 'מקרר', items: [
      { name: 'חלב', qty: 1, count_type: 'units', category: 'מוצרי חלב, גבינות וביצים', generic: true, question: 'איזה חלב?', options: ['3%', '1%', 'סויה'] },
      { name: 'יוגורט', qty: 3, phrase: '3 יוגורטים', count_type: 'units', category: 'מוצרי חלב, גבינות וביצים', generic: true, question: 'איזה יוגורט?', options: ['טבעי', 'וניל'] },
      { name: 'ביצים', qty: 6, phrase: '6 ביצים', count_type: 'pack', category: 'מוצרי חלב, גבינות וביצים' }] });
    assert.equal(r.reply, 'איזה חלב?');
    r = await say(avi, 'חלב שקדים'); // not one of the buttons: fine
    assert.equal(r.reply, 'איזה יוגורט?');
    r = (await call(avi, 'POST', '/api/chat', { text: 'טבעי' })).data; // a button: no model
    const b = await bots(avi); const saved = b.find((x) => /^רשמתי במקרר/.test(x.reply));
    assert.equal(saved.reply, 'רשמתי במקרר: חלב שקדים, 3 יוגורטים טבעיים ו-6 ביצים.'); assert.equal(saved.undo, true);
    const s = await state(avi); assert.ok(P(s, 'חלב שקדים')); assert.equal(P(s, 'יוגורט טבעי').qty, 3); assert.ok(!P(s, 'חלב'));
    assert.ok(!s.products.some((p) => p.is_basic), 'nothing regular without being told (163)');
  });

  await check('O4', 'באמצע: "לא יודע, תדלג" מתקדם; עוד ילד שנזכר באמצע נוסף בלי לשאול שוב (169, 187)', async () => {
    let r = await say(avi, 'מקפיא'); // a place's name: no model
    assert.match(r.reply, /^מה יש במקפיא\?/);
    r = await say(avi, 'לא יודע תדלג', { skip: true });
    assert.equal(r.reply, 'בסדר, נדלג. איפה עוד?');
    r = await say(avi, 'אה ויש לנו גם את איתי בן 4', { people: [{ name: 'איתי', gender: 'm', child: true, age: 4 }] });
    const b = await bots(avi); assert.ok(b.some((x) => x.reply === 'איזה כיף, עכשיו אני מכיר גם את איתי!'), JSON.stringify(b.slice(-3)));
    assert.equal(r.reply, 'איפה עוד?', 'and the same question again');
    assert.equal((await state(avi)).users.find((u) => u.name === 'איתי').role, 'child');
  });

  await check('O5', 'שאלה אחרת באמצע: שוקי עונה, ואז "האם נמשיך להכיר?"; "כן, נמשיך" חוזר לאותה שאלה; "אחר כך" עוצר (169)', async () => {
    const r = await say(avi, 'מה מזג האוויר מחר?', { off_topic: true }, { reply: 'את זה אני לא יודע, אני רק במטבח.', face: 'happy' });
    assert.equal(r.reply, 'את זה אני לא יודע, אני רק במטבח.');
    const b = await bots(avi); assert.equal(b.at(-1).reply, 'האם נמשיך להכיר?'); assert.deepEqual(b.at(-1).options, ['כן, נמשיך', 'אחר כך']);
    const again = (await call(avi, 'POST', '/api/chat', { text: 'כן, נמשיך' })).data; assert.equal(again.reply, 'אז איפה עוד?');
    const later = (await call(avi, 'POST', '/api/chat', { text: 'אחר כך' })).data; assert.match(later.reply, /נמשיך להכיר/);
    const n = calls.length; const chat = await say(avi, 'היי', { reply: 'היי!', face: 'happy' }); assert.equal(chat.reply, 'היי!'); assert.equal(calls.length, n + 1, 'the usual chat while paused');
    const back = (await call(avi, 'POST', '/api/chat', { text: 'נמשיך להכיר' })).data; assert.equal(back.reply, 'אז איפה עוד?', 'back at the same step, even later');
  });

  await check('O6', 'סוף המיפוי → מה קונים תמיד (גם מה שלא בבית עכשיו: קבוע ונגמר, ברשימה) → יותר מאחד → יש עוד משהו (156, 158, 181)', async () => {
    let r = (await call(avi, 'POST', '/api/chat', { text: 'זהו, סיימנו למפות' })).data;
    assert.match(r.reply, /^ומה מכל מה שיש בבית אתם קונים כל הזמן\?/);
    r = await say(avi, 'חלב שקדים וקפה', { names: ['חלב שקדים'], new_items: ['קפה'] });
    let b = await bots(avi); assert.ok(b.some((x) => x.reply === 'קפה לא בבית עכשיו, אז הוספתי אותו לרשימה.'), JSON.stringify(b.slice(-4).map((x) => x.reply)));
    let s = await state(avi); assert.equal(P(s, 'קפה').is_basic, 1); assert.ok(s.list.some((i) => i.product_id === P(s, 'קפה').id && i.status === 'open'));
    assert.equal(P(s, 'חלב שקדים').target, 1);
    r = await say(avi, 'מהחלב צריך 2', { targets: [{ name: 'חלב שקדים', target: 2 }] });
    s = await state(avi); assert.equal(P(s, 'חלב שקדים').target, 2);
    assert.match(r.reply, /^והאם יש עוד משהו שתרצה להגיד לי\? למשל אלרגיה, כשרות או משהו שכדאי שאדע\.$/); // r0t r9-7
    r = await say(avi, 'אנחנו כשרים, ובשישי אני קונה ירקות בשוק', { notes: 'כשרים', habits: ['אבי קונה ירקות בשוק בשישי'] });
    assert.equal(r.reply, 'האם תרצה שאזכור שאתה קונה ירקות בשוק בשישי?'); assert.deepEqual(r.options, ['כן, תזכור', 'לא צריך']); // question 30 (r9z): to whoever writes, as 0ב
    b = await bots(avi); assert.ok(!b.some((x) => x.proposal), 'no card in the whole first meeting');
    r = (await call(avi, 'POST', '/api/chat', { text: 'כן' })).data;
    // home18 (5): after the first meeting's last words, where the house buys produce (asked once)
    assert.equal(r.reply, 'איפה אתם קונים ירקות ופירות?'); assert.deepEqual(r.options, ['בסופר', 'בירקן', 'פעם פה פעם שם']);
    b = await bots(avi); assert.ok(b.some((x) => /^זהו, עכשיו אני מכיר את הבית שלכם!/.test(x.reply || '')), 'the last words');
    s = await state(avi); assert.equal(s.notes, 'כשרים'); assert.ok(s.lessons.some((l) => l.text === 'אבי קונה ירקות בשוק בשישי'));
  });

  await check('C1', 'שאלה עם כפתורים וכרטיס באותה תשובה: רק השאלה (160); מוצר חדש בלי "קבוע" לא נהיה קבוע (163)', async () => {
    const s = await state(avi);
    let r = await say(avi, 'נגמר הקפה', { reply: 'איזה קפה?', face: 'confused', options: ['נמס', 'טחון'], actions: [{ kind: 'op', product_id: P(s, 'קפה').id, op: { type: 'out' } }] });
    assert.equal(r.proposal, undefined); assert.deepEqual(r.options, ['נמס', 'טחון']);
    r = await say(avi, 'קניתי טחינה', { reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'create', bought: true, product: { name: 'טחינה', count_type: 'units', qty: 1, is_basic: true, target: 2 } }] });
    assert.equal(r.proposal.lines[0].text, 'לסמן שקנינו טחינה?'); assert.doesNotMatch(r.proposal.lines[0].detail || '', /קבוע/);
    await call(avi, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
    r = await say(avi, 'קניתי טחינה, זה מוצר קבוע', { reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'create', bought: true, product: { name: 'טחינה', count_type: 'units', qty: 1, is_basic: true, target: 1 } }] });
    assert.match(r.proposal.lines[0].detail, /מוצר קבוע/);
    await call(avi, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
  });

  await check('C2', 'רק "כן"/"לא" פשוטים עונים לשאלה בלי המודל; משפט ארוך יותר הולך למודל (159)', async () => {
    let r = await say(avi, 'השמנת שלנו תמיד של טרה', { reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'lesson', text: 'שמנת קונים של טרה' }] });
    assert.equal(r.reply, 'האם תרצה שאזכור ששמנת קונים של טרה?'); assert.equal(r.proposal, undefined);
    const n = calls.length;
    r = await say(avi, 'לא, רק לפעמים', { reply: 'אוקיי, לא אזכור.', face: 'happy' });
    assert.equal(calls.length, n + 1, 'the model read it'); assert.equal(r.reply, 'אוקיי, לא אזכור.');
    r = (await call(avi, 'POST', '/api/chat', { text: 'כן' })).data; assert.notEqual(r.applied, true, 'the question is gone once they moved on');
  });

  await check('C3', 'כרטיס ושאלה "לזכור?" באותה תשובה: הכרטיס עכשיו, השאלה אחרי שהוחלט עליו (160)', async () => {
    const s = await state(avi);
    const r = await say(avi, 'נגמר הקפה, ואצלנו קפה זה תמיד נמס', { reply: 'להוסיף קפה לרשימה? האם תרצה שאזכור שקפה אצלכם זה נמס?', face: 'happy', actions: [{ kind: 'op', product_id: P(s, 'קפה').id, op: { type: 'out' } }, { kind: 'lesson', text: 'קפה אצלנו זה נמס' }] });
    assert.equal(r.reply, 'להוסיף קפה לרשימה?'); assert.equal(r.proposal.lines.length, 1);
    const a = (await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {})).data; assert.equal(a.asked, true);
    const q = (await bots(avi)).at(-1); assert.equal(q.reply, 'האם תרצה שאזכור שקפה אצלכם זה נמס?'); assert.deepEqual(q.options, ['כן, תזכור', 'לא צריך']);
    assert.equal((await call(avi, 'POST', '/api/chat', { text: 'כן בבקשה' })).data.reply, 'סגור, אזכור!');
    assert.ok((await state(avi)).lessons.some((l) => l.text === 'קפה אצלנו זה נמס'));
  });

  await check('L1', 'במסך הרשימה: דבר חדש נהיה מוצר, "חצי קילו" נשאר על השורה (185)', async () => {
    await act(avi, [{ kind: 'list_add', text: 'בשר טחון', amount: 0.5, unit: 'ק"ג' }, { kind: 'create', product: { name: 'בשר טחון', count_type: 'level', level: 'none', category_id: 'אחר' } }]);
    const s = await state(avi); const p = P(s, 'בשר טחון'); assert.ok(p);
    const it = s.list.find((i) => i.product_id === p.id && i.status === 'open'); assert.ok(it, 'the line is the product now'); assert.equal(it.want, 0.5); assert.equal(it.want_unit, 'ק"ג');
    assert.ok(!s.list.some((i) => i.text === 'בשר טחון' && i.status === 'open'), 'no second, one-off line');
  });

  await check('L2', 'נגיעה = כמו ברשימה; קנו פחות: ההפרש נשאר ברשימה, בכל מוצר (171, 174)', async () => {
    await act(avi, [{ kind: 'create', product: { name: 'טונה', count_type: 'units', unit: 'קופסה', qty: 0, is_basic: 1, target: 4 } }]);
    let s = await state(avi); const tuna = P(s, 'טונה'); const it = s.list.find((i) => i.product_id === tuna.id && i.status === 'open');
    assert.ok(it); await act(avi, [{ kind: 'list_add', product_id: tuna.id, amount: 4 }]);
    await act(avi, [{ kind: 'check', item_id: it.id, amount: 1, store: 'super' }], { context: 'shopping' });
    await act(avi, [{ kind: 'finish', store: 'super' }], { context: 'shopping' });
    s = await state(avi); assert.equal(P(s, 'טונה').qty, 1);
    const rest = s.list.find((i) => i.product_id === tuna.id && i.status === 'open'); assert.ok(rest, 'the rest stays'); assert.equal(rest.want, 3);
  });
  await check('I1', 'נקנה 3 פעמים בחודשיים ולא קבוע: שוקי שואל פעם אחת, בתשובה, אם לסמן כקבוע; "כן" מסמן (163)', async () => {
    await act(avi, [{ kind: 'create', product: { name: 'שמנת', count_type: 'units', unit: 'גביע', qty: 1 } }]);
    const id = P(await state(avi), 'שמנת').id; const now = israelAt(israelDate(), '7:30'); // 07:30 in Israel: the morning scan
    d1(`INSERT INTO product_log (event_id, ts, product_id, kind) VALUES ${[3, 17, 40].map((d) => `(0, ${now - d * 86400e3}, ${id}, 'purchase')`).join(',')}`);
    await call(avi, 'POST', '/api/__schedule', { now });
    const r = await say(avi, 'יש לנו שמנת?', { reply: 'יש גביע אחד.', face: 'happy' });
    assert.equal(r.reply, 'יש גביע אחד. אגב, שמתי לב שאתם קונים שמנת לא מעט. האם תרצו שאהפוך אותה למוצר קבוע, שתיכנס לרשימה לבד כשתיגמר?'); assert.deepEqual(r.options, ['כן, תהפוך לקבוע', 'לא צריך']);
    assert.equal((await call(avi, 'POST', '/api/chat', { text: 'כן' })).data.reply, 'סגור, מעכשיו שמנת מוצר קבוע!');
    const p = P(await state(avi), 'שמנת'); assert.equal(p.is_basic, 1); assert.equal(p.target, 1);
    const again = await say(avi, 'היי', { reply: 'היי', face: 'happy' }); assert.equal(again.reply, 'היי', 'asked once');
  });
  await check('C4', '"כן" לשאלה של שוקי "להוסיף לרשימה?" הוא האישור: בלי כרטיס שני', async () => {
    const r1 = await say(avi, 'מה חסר לשקשוקה?', { reply: 'חסרים פלפלים. להוסיף לרשימה?', face: 'happy', options: ['להוסיף לרשימה', 'יש לי'] });
    assert.equal(r1.proposal, undefined);
    const r = await say(avi, 'להוסיף לרשימה', { reply: 'להוסיף פלפלים לרשימה?', face: 'happy', actions: [{ kind: 'list_add', text: 'פלפלים' }] });
    assert.equal(r.proposal, undefined, JSON.stringify(r)); assert.equal(r.reply, 'הוספתי פלפלים לרשימה.');
    assert.ok((await state(avi)).list.some((i) => i.text === 'פלפלים' && i.status === 'open'));
  });

  await check('C5', 'שמירת מתכון שלא ביקשו: הכרטיס של המלאי עכשיו, ו"האם תרצה שאשמור את המתכון ל...?" אחריו', async () => {
    await act(avi, [{ kind: 'create', product: { name: 'פסטה', count_type: 'units', unit: 'חבילה', qty: 3 } }]);
    const pasta = P(await state(avi), 'פסטה').id;
    const r = await say(avi, 'הכנתי פסטה עם רוטב, השתמשתי בחבילה', { reply: 'לעדכן שהשתמשת בחבילת פסטה, ולשמור את זה כמתכון?', face: 'happy', actions: [{ kind: 'op', product_id: pasta, op: { type: 'use', amount: 1 } }, { kind: 'recipe', name: 'פסטה ברוטב', ingredients: 'פסטה, רוטב עגבניות' }] });
    assert.equal(r.proposal.lines.length, 1); assert.equal(r.proposal.lines[0].text, 'לסמן שהשתמשנו בחבילת פסטה?'); assert.equal(r.reply, 'לעדכן שהשתמשת בחבילת פסטה?');
    await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    assert.equal((await bots(avi)).at(-1).reply, 'האם תרצה שאשמור את המתכון לפסטה ברוטב?');
    assert.equal((await call(avi, 'POST', '/api/chat', { text: 'כן' })).data.reply, 'שמרתי את המתכון!');
    assert.ok((await state(avi)).recipes.some((x) => x.name === 'פסטה ברוטב'));
  });

  await check('C6', '"אני שומר שבת" = הגדרת השבת (כרטיס), לא כלל לזכור', async () => {
    const r = await say(avi, 'אני שומר שבת', { reply: 'האם תרצה שאזכור שאתה שומר שבת?', face: 'happy', actions: [{ kind: 'lesson', text: 'אבי שומר שבת' }] });
    assert.equal(r.reply, 'האם תרצה שלא אשלח לך התראות משישי ב-16:00 עד שבת ב-19:00?'); assert.equal(r.proposal.lines[0].text, 'לא לשלוח התראות משישי ב-16:00 עד שבת ב-19:00?');
    await call(avi, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
  });

  await check('K1', 'ילד מבקש לרשימה: נכנס ומחכה, הוא שומע שההורים יאשרו, וההורים מקבלים כרטיס בצ\'אט (הילד לא); ילד לא מוחק (38, 186)', async () => {
    const s0 = await state(avi); const itai = s0.users.find((u) => u.name === 'איתי');
    const code = (await call(avi, 'POST', '/api/devices/code', { user_id: itai.id })).data.code;
    const kid = (await call(null, 'POST', '/api/pair', { code, name: 'iPhone' })).data.token;
    const r = await say(kid, 'תוסיף שוקולד לרשימה', { reply: 'להוסיף שוקולד לרשימה?', face: 'happy', actions: [{ kind: 'list_add', text: 'שוקולד' }] });
    assert.equal(r.proposal, undefined); assert.match(r.reply, /^שמתי שוקולד ברשימה! /);
    const it = (await state(avi)).list.find((i) => i.text === 'שוקולד'); assert.equal(it.approved, 0, 'waits for a grown-up');
    const card = (await call(avi, 'GET', '/api/chat')).data.messages.at(-1).content; assert.match(card.reply, /^איתי ביקש שוקולד\. האם לאשר\?$/); assert.ok(card.proposal);
    assert.ok(!(await call(kid, 'GET', '/api/chat')).data.messages.some((m) => m.content.proposal?.id === card.proposal.id), 'the child doesn\'t get the card');
    assert.equal((await call(avi, 'POST', `/api/proposals/${card.proposal.id}/apply`, {})).data.status, 'applied');
    assert.equal((await state(avi)).list.find((i) => i.text === 'שוקולד').approved, 1);
    const d = await say(kid, 'תמחק את הקפה', { reply: 'בטוח?', face: 'confused', actions: [{ kind: 'delete', product_id: P(await state(avi), 'קפה').id }] });
    // no card for the child; the grown-ups are asked, and nothing is deleted yet (r0t d186)
    assert.equal(d.proposal, undefined); assert.equal(d.reply, 'ביקשתי מאבי או ממיכל לאשר את המחיקה של הקפה.' /* 131 (the owner 19/10) */);
    assert.ok((await bots(avi)).some((c) => c.reply === 'איתי ביקש למחוק את הקפה. האם לאשר?' && c.proposal)); assert.ok(P(await state(avi), 'קפה'));
  });
  await check('L3', 'מוצר קבוע שעדיין מתחת למינימום לא יורד מהרשימה, גם אם המודל הציע', async () => {
    await act(avi, [{ kind: 'create', product: { name: 'חלב 1%', count_type: 'units', unit: 'קרטון', qty: 0, is_basic: 1, target: 2 } }]);
    let s = await state(avi); const m = P(s, 'חלב 1%'); const it = s.list.find((i) => i.product_id === m.id && i.status === 'open'); assert.ok(it);
    const r = await say(avi, 'מצאתי עוד קרטון חלב 1%', { reply: 'לעדכן?', face: 'happy', actions: [{ kind: 'op', product_id: m.id, op: { type: 'set', qty: 1 } }, { kind: 'list_remove', item_id: it.id }] });
    assert.deepEqual(r.proposal.lines.map((l) => l.text), ['לעדכן שיש קרטון חלב 1%?']);
    await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    s = await state(avi); assert.ok(s.list.some((i) => i.product_id === m.id && i.status === 'open'), 'still on the list (1 of 2)');
  });
} finally {
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} round-20 checks passed`);
  writeFileSync(new URL('./round20-results.json', import.meta.url), JSON.stringify(results, null, 1));
  if (results.some((r) => !r.ok)) console.log(log.split('\n').filter((l) => /error|Error/.test(l)).slice(-10).join('\n'));
  mock.close(); try { process.kill(-dev.pid, 'SIGKILL'); } catch { /* gone */ }
  process.exit(ok === results.length ? 0 : 1);
}
