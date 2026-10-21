// The first use (15/10, the owner's own house): what went wrong there and what the check of the server against the
// instructions found, on the Node server with a fake model that answers in the very shape the instructions tell the model
// to send. Each check fails on the code before its fix.
//   F2: an open wine is "יש", not "נגמר" (mapping, the correction card, and a closed one with nothing open that did run out)
//   R3–R10: the rows of the table in docs/firstuse-report.md
//   F3: a fact about another grown-up in the first meeting is asked to them (when they join, after their first answer)
//   F4: the journal's "לימד אותי" line (approved 15/10)
// Run: node --disable-warning=ExperimentalWarning test/firstuse.itest.js
import './fetch-retry.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DIR = '/tmp/shuki-test/shuki-firstuse'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const PORT = 8883, MOCK = 8884;

// Avi (admin), Michal; Orit joins later (no phone yet)
const db0 = new DatabaseSync(`${DIR}/shuki.db`);
db0.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) { db0.exec(readFileSync(`migrations/${f}`, 'utf8')); db0.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f); }
db0.exec(readFileSync('test/fixture-house.sql', 'utf8'));
db0.exec("INSERT INTO users (id, name, gender, role, active, created) VALUES (4, 'הילה', 'f', 'member', 1, 0)");
db0.exec("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999), ('222222', 2, 9999999999999), ('444444', 4, 9999999999999)");
db0.close();

let answer = () => ({ reply: 'אני פה!', face: 'happy' });
const requests = [];
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => {
  const body = JSON.parse(Buffer.concat(parts).toString('utf8')); requests.push(body);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'tool_use', name: body.tools?.[0]?.name || 'respond', input: answer(body) }], usage: { input_tokens: 1, output_tokens: 1 } }));
}); }).listen(MOCK, '127.0.0.1');
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/node.js'], { env: { ...process.env, PORT: String(PORT), DB_PATH: `${DIR}/shuki.db`, ANTHROPIC_API_KEY: 't', ANTHROPIC_URL: `http://127.0.0.1:${MOCK}/v1/messages`, RETRY_MS: '1', CHAT_PER_MINUTE: '1000' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
const call = async (t, m, p, b) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch { /* text */ }
  return { status: r.status, data, text };
};
const sql = (q, ...a) => { const d = new DatabaseSync(`${DIR}/shuki.db`); try { return /^\s*select/i.test(q) ? d.prepare(q).all(...a) : d.prepare(q).run(...a); } finally { d.close(); } };
const say = async (t, text) => (await call(t, 'POST', '/api/chat', { text })).data;
const apply = async (t, r) => { assert.ok(r?.proposal?.id, `no card: ${JSON.stringify(r).slice(0, 300)}`); const x = await call(t, 'POST', `/api/proposals/${r.proposal.id}/apply`, {}); assert.equal(x.status, 200, x.text); return x.data; };
const act = (t, actions) => call(t, 'POST', '/api/actions', { op_id: `fu-${Math.random()}`, ts: Date.now(), actions });
const lines = (r) => (r?.proposal?.lines || []).map((l) => l.text);
const product = (name) => sql('SELECT * FROM products WHERE name = ? AND deleted IS NULL', name)[0];
const onList = (name) => sql("SELECT i.* FROM list_items i JOIN products p ON p.id = i.product_id WHERE p.name = ? AND i.status = 'open'", name)[0];
const outLogged = (name) => sql("SELECT COUNT(*) AS n FROM product_log l JOIN products p ON p.id = l.product_id WHERE p.name = ? AND l.kind = 'out'", name)[0].n;
const chatOf = async (t) => (await call(t, 'GET', '/api/chat')).data.messages;
const respond = (actions, more = {}) => () => ({ reply: 'האם ככה?', face: 'happy', actions, ...more });
const results = [];
async function check(id, name, fn) {
  try { await fn(); results.push({ id, ok: true }); console.log('✓', id, name); }
  catch (e) { results.push({ id, ok: false }); console.log('✗', id, name, '\n   ', e.message.slice(0, 600)); }
}

let avi, michal;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${PORT}`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  [avi, michal] = await Promise.all(['111111', '222222'].map(async (code) => (await call(null, 'POST', '/api/pair', { code })).data.token));

  /* ---------- F2: the open wine ---------- */
  const wine = (name) => ({ kind: 'create', product: { name, count_type: 'inuse', is_open: true, qty: 0, category_id: 'שימורים ורטבים', location_id: 'מקרר' } }); // line 106: "במוצר inuse: is_open=true ו-qty 0"
  await check('F2-1', 'מיפוי: יין פתוח (inuse, is_open, qty 0) הוא "לרשום שיש", לא "נגמר"; אחרי האישור פתוח, לא ברשימה ובלי "נגמר" בקצב', async () => {
    answer = respond([wine('יין שאוסינג'), { kind: 'create', product: { name: 'קולה זירו', count_type: 'units', unit: 'בקבוק', qty: 1.5, category_id: 'משקאות', location_id: 'מקרר' } }]);
    const r = await say(avi, 'במקרר יש יין שאוסינג פתוח ובקבוק וחצי קולה זירו');
    const l = lines(r);
    assert.ok(l.some((x) => /^(האם )?לרשום שיש יין שאוסינג/.test(x)), JSON.stringify(l));
    assert.ok(!l.some((x) => /נגמר/.test(x)), JSON.stringify(l));
    await apply(avi, r);
    const p = product('יין שאוסינג');
    assert.ok(p && p.is_open === 1 && p.qty === 0, JSON.stringify(p));
    assert.ok(!onList('יין שאוסינג'), 'on the list');
    assert.equal(outLogged('יין שאוסינג'), 0, '"out" in its pace');
  });
  await check('F2-2', 'תיקון לכרטיס: "לא נגמר, יש פתוח" מחליף את הכרטיס של "נגמר" בכרטיס שבאמת שונה, והקודם נסגר', async () => {
    answer = respond([{ kind: 'create', product: { name: 'רוטב סויה', count_type: 'units', qty: 0, category_id: 'שימורים ורטבים', location_id: 'מקרר' }, reported: true }]);
    const r1 = await say(avi, 'נגמר רוטב הסויה');
    assert.ok(lines(r1).some((x) => /נגמר רוטב סויה/.test(x)), JSON.stringify(lines(r1)));
    answer = respond([wine('רוטב סויה')], { correction: true });
    const r2 = await say(avi, 'לא נגמר, יש פתוח');
    assert.ok(r2.proposal?.id && r2.proposal.id !== r1.proposal.id, 'no new card');
    assert.notDeepEqual(lines(r2), lines(r1), 'the same card again');
    assert.ok(lines(r2).some((x) => /לרשום שיש רוטב סויה/.test(x)) && !lines(r2).some((x) => /נגמר/.test(x)), JSON.stringify(lines(r2)));
    assert.equal(sql('SELECT status FROM proposals WHERE id = ?', r1.proposal.id)[0].status, 'rejected', 'the old card stayed open');
  });
  await check('F2-3', 'inuse סגור עם 0 פתוחים (is_open=false, qty 0): נגמר, בכרטיס ואחרי האישור, וברשימה', async () => {
    answer = respond([{ kind: 'create', product: { name: 'שמן קנולה', count_type: 'inuse', is_open: false, qty: 0, category_id: 'תבלינים ושמנים', location_id: 'מזווה' }, reported: true }]);
    const r = await say(avi, 'נגמר שמן הקנולה');
    assert.ok(lines(r).some((x) => /נגמר שמן קנולה/.test(x)), JSON.stringify(lines(r)));
    await apply(avi, r);
    const p = product('שמן קנולה');
    assert.ok(p && !p.is_open && !p.qty, JSON.stringify(p));
    assert.ok(onList('שמן קנולה'), 'not on the list');
  });

  await check('R12', 'מיפוי (הוראות, 12): create לכל פריט, catalog_area ושלושת הכפתורים (16/10): הכרטיס והכפתורים יחד, והמקום עם ה\' הידיעה', async () => {
    answer = () => ({ reply: 'יש! המקרר ממופה.', face: 'happy', catalog_area: 'מקרר', options: ['סיימנו למפות את מקרר', 'נמשיך למפות', 'נעצור כאן'],
      actions: [{ kind: 'create', product: { name: 'סודה', count_type: 'units', unit: 'בקבוק', qty: 1.5, category_id: 'משקאות', location_id: 'מקרר' } }, wine('יין לבן')] });
    const r = await say(avi, 'במקרר יש בקבוק וחצי סודה ויין לבן פתוח');
    assert.equal(lines(r).length, 2, `no card: ${JSON.stringify(r).slice(0, 300)}`);
    assert.deepEqual(r.options, ['סיימנו למפות את המקרר', 'נמשיך למפות', 'נעצור כאן']);
  });
  await check('R13', 'מה שהמודל שלח בטעות במדידה: unit שהוא סוג ספירה ("units") לא מופיע בכרטיס, ושינוי שם לאותו שם לא מופיע', async () => {
    await act(avi, [{ kind: 'create', product: { name: 'ביצים', count_type: 'pack', pack_size: 12, qty: 0, category_id: 'מוצרי חלב, גבינות וביצים', location_id: 'מקרר' } }]);
    const eggs = product('ביצים').id;
    answer = respond([{ kind: 'create', product: { name: 'מים מינרליים', count_type: 'units', qty: 1, unit: 'units', category_id: 'משקאות', location_id: 'מקרר' } },
      { kind: 'edit', product_id: eggs, fields: { name: 'ביצים' } }, { kind: 'op', product_id: eggs, op: { type: 'set', qty: 6 } }]);
    const r = await say(avi, 'יש מים מינרליים ו-6 ביצים');
    assert.ok(!lines(r).some((x) => /units|לשנות את השם/.test(x)), JSON.stringify(lines(r)));
    assert.equal(lines(r).length, 2, JSON.stringify(lines(r)));
  });
  await check('R8b', 'set 0 מגיליון "כמה יש?" במסך המלאי (לא מכרטיס): לא נכנס לרשימה בשקט', async () => {
    await act(avi, [{ kind: 'create', product: { name: 'זיתים', count_type: 'units', unit: 'צנצנת', qty: 2, category_id: 'שימורים ורטבים', location_id: 'מזווה' } }]);
    await act(avi, [{ kind: 'op', product_id: product('זיתים').id, op: { type: 'set', qty: 0 } }]);
    assert.ok(!onList('זיתים'), 'on the list');
  });
  await check('Q9', 'ש9 (א), אושר 16/10: בהוראות שנשלחות למודל, מספר על ירק או פרי הוא units עם הכמות', async () => {
    requests.length = 0; answer = () => ({ reply: 'אני פה!', face: 'happy' });
    await say(avi, 'מה נשמע?');
    const sys = JSON.stringify(requests.find((b) => b.tools?.[0]?.name === 'respond')?.system || '');
    assert.ok(sys.includes('כשנאמר מספר על ירק או פרי (תפוח אדמה 1, 3 אבוקדו): units עם הכמות.'), 'not in the instructions');
  });
  await check('Q11', 'ש11: "X כבר ברשימה" כש-X לא ברשימה: השרת אומר למודל פעם אחת, והכרטיס מוסיף אותו; כשהוא באמת ברשימה, אין קריאה שנייה', async () => {
    await act(avi, [{ kind: 'create', product: { name: 'נייר סופג', count_type: 'pack', pack_size: 6, qty: 12, category_id: 'חד-פעמי ונייר', location_id: 'מחסן' } }]);
    const towel = product('נייר סופג').id;
    const second = (b) => Array.isArray(b.messages.at(-1).content) && b.messages.at(-1).content[0]?.type === 'tool_result';
    answer = (b) => (second(b) ? { reply: 'האם להוסיף נייר סופג לרשימה?', face: 'happy', actions: [{ kind: 'list_add', product_id: towel }] } : { reply: 'נייר סופג כבר ברשימה.', face: 'happy' });
    requests.length = 0;
    const r = await say(avi, 'תוסיף לרשימה נייר סופג');
    const again = requests.filter(second);
    assert.equal(again.length, 1, `${again.length} second calls`);
    assert.ok(JSON.stringify(again[0].messages.at(-1).content).includes('כבר ברשימה, אבל זה לא ברשימת הקניות'), 'not told why');
    assert.ok(lines(r).some((x) => /להוסיף נייר סופג לרשימה/.test(x)), JSON.stringify(lines(r)));
    await apply(avi, r);
    answer = (b) => ({ reply: 'נייר סופג כבר ברשימה.', face: 'happy' });
    requests.length = 0;
    await say(avi, 'תוסיף לרשימה נייר סופג');
    assert.equal(requests.filter(second).length, 0, 'asked again when it is on the list');
  });
  /* ---------- 16/10: from the use at home ---------- */
  await check('H1', '1: קוד לטלפון נוסף של מבוגר שכבר יש לו טלפון נוצר, והשורה "טלפון חדש התחבר" מגיעה אליו', async () => {
    const r = await call(avi, 'POST', '/api/devices/code', { user_id: 2 });
    assert.equal(r.status, 200, r.text);
    const t = (await call(null, 'POST', '/api/pair', { code: r.data.code })).data?.token; assert.ok(t, 'not paired');
    assert.ok((await chatOf(michal)).some((m) => /^טלפון חדש התחבר אליי עכשיו בשם שלך/.test(m.content.reply || '')), 'no line to her');
    const m = await call(avi, 'POST', '/api/members', { id: 2, code: true }); assert.equal(m.status, 200, m.text);
  });
  await check('H3', '3: פאנל פסח רק כשמצב פסח פועל, כשפסח קרוב, או כשדיברו עליו השבוע', async () => {
    sql("DELETE FROM chat WHERE content LIKE '%פסח%'"); sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('pesach', '0')");
    assert.equal((await call(avi, 'GET', '/api/state')).data.pesachPanel, false, 'shown in October');
    sql("INSERT INTO chat (ts, user_id, role, content, thread) VALUES (?, 1, 'user', '{\"text\":\"מה עושים בפסח?\"}', 1)", Date.now());
    assert.equal((await call(avi, 'GET', '/api/state')).data.pesachPanel, true, 'not after talking of it');
    sql("DELETE FROM chat WHERE content LIKE '%פסח%'"); sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('pesach', '1')");
    assert.equal((await call(avi, 'GET', '/api/state')).data.pesachPanel, true, 'not with the mode on');
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('pesach', '0')");
    const { pesachSeason } = await import('../worker/domain.js');
    assert.equal(pesachSeason(Date.UTC(2027, 3, 10, 9)), true, '11/04/2027 (4 ניסן)'); assert.equal(pesachSeason(Date.UTC(2027, 2, 1, 9)), false, '01/03/2027');
  });
  await check('H4', '4: בזמן מיפוי בלי "נשאר מעט… להוסיף?"; אחרי "נעצור כאן" והתשובה על הקבועים (17/10, ש8) כרטיס אחד עם כל מה שמעט ולא קבוע, בנוסח של כרטיס רשימה', async () => {
    answer = () => ({ reply: 'יש! המזווה ממופה. מה יש בארון?', face: 'happy', catalog_area: 'מזווה', actions: [{ kind: 'create', product: { name: 'אגוז מוסקט', count_type: 'level', level: 'little', category_id: 'תבלינים ושמנים', location_id: 'מזווה' } }, { kind: 'create', product: { name: 'צנובר', count_type: 'level', level: 'little', category_id: 'יבשים', location_id: 'מזווה' } }] });
    await apply(avi, await say(avi, 'במזווה יש מעט אגוז מוסקט ומעט צנובר'));
    const low = (await call(avi, 'GET', '/api/state')).data.lowAsk;
    assert.ok(!low.some((x) => /אגוז מוסקט|צנובר/.test(x.name)), `asked while mapping: ${JSON.stringify(low)}`);
    answer = () => ({ reply: 'מה מכל זה תמיד צריך להיות בבית?', face: 'happy' });
    assert.ok(!lines(await say(avi, 'נעצור כאן')).length, 'a card with the question');
    answer = () => ({ reply: 'סגור! עכשיו אני מכיר את הבית', face: 'happy', catalog_area: '' });
    const r = await say(avi, 'אף אחד');
    assert.ok(lines(r).includes('להוסיף אגוז מוסקט לרשימה?') && lines(r).includes('להוסיף צנובר לרשימה?'), JSON.stringify(lines(r)));
    assert.ok(!onList('צנובר'), 'added without the card');
  });
  await check('H5', '5: בהוראות: כשממפים, "חצי", "רבע", "קופסה פתוחה" ומספר חלקי = יש', async () => {
    requests.length = 0; answer = () => ({ reply: 'אני פה!', face: 'happy' });
    await say(avi, 'יש חצי קופסה קוסקוס');
    const sys = JSON.stringify(requests.find((b) => b.tools?.[0]?.name === 'respond')?.system || '');
    assert.ok(sys.includes('כשממפים, \\"חצי\\", \\"רבע\\", \\"קופסה פתוחה\\" ומספר חלקי = יש') || sys.includes('כשממפים, "חצי", "רבע", "קופסה פתוחה" ומספר חלקי = יש'), 'not in the instructions');
  });
  await check('H6', '6 (17/10, ש1+ש7): "פפריקה מעושנת" ו"פפריקה מעושנת סגורה" באותו כרטיס, ו"קופסת מלח" כשיש "מלח": השרת שואל לפני הכרטיס, ולמודל לא נאמר כלום', async () => {
    await act(avi, [{ kind: 'create', product: { name: 'מלח', count_type: 'inuse', is_open: true, qty: 0, category_id: 'תבלינים ושמנים', location_id: 'מזווה' } }]);
    const twice = [{ kind: 'create', product: { name: 'פפריקה מעושנת', count_type: 'level', level: 'little', category_id: 'תבלינים ושמנים', location_id: 'מזווה' } },
      { kind: 'create', product: { name: 'פפריקה מעושנת סגורה', count_type: 'units', qty: 1, category_id: 'תבלינים ושמנים', location_id: 'מזווה' } },
      { kind: 'create', product: { name: 'קופסת מלח', count_type: 'units', qty: 1, category_id: 'תבלינים ושמנים', location_id: 'מזווה' } }];
    answer = () => ({ reply: 'האם ככה?', face: 'happy', actions: twice }); // the same again on the second call: the server still makes one
    requests.length = 0;
    const r = await say(avi, 'קופסה קטנה פפריקה מעושנת, ויש גם פפריקה מעושנת סגורה, וקופסת מלח');
    const told = JSON.stringify(requests.filter((b) => Array.isArray(b.messages.at(-1).content) && b.messages.at(-1).content[0]?.type === 'tool_result').map((b) => b.messages.at(-1).content));
    assert.ok(!told.includes('הם אותו מוצר') && !told.includes('כבר יש מוצר בשם'), told.slice(0, 400));
    assert.equal(r.reply, 'יש כבר פפריקה מעושנת במזווה. האם זו אותה פפריקה?'); assert.deepEqual(r.options, ['כן, אותו מוצר', 'לא, מוצר אחר']);
    assert.ok(!lines(r).length, JSON.stringify(lines(r)));
    await say(avi, 'בטל'); // the question goes, for the checks after it
  });
  /* ---------- the rows of the table ---------- */
  await check('R2', 'inuse פתוח ו"צריך לקנות" (create + list_add באותו שם): נשמר פתוח, וגם ברשימה', async () => {
    answer = respond([wine('שמן זית'), { kind: 'list_add', text: 'שמן זית' }]);
    const r = await say(avi, 'יש שמן זית פתוח, וצריך לקנות עוד');
    await apply(avi, r);
    const p = product('שמן זית');
    assert.ok(p && p.is_open === 1, JSON.stringify(p));
    assert.ok(sql("SELECT 1 FROM list_items WHERE status = 'open' AND (product_id = ? OR text = 'שמן זית')", p.id).length, 'not on the list');
  });
  await check('R3', '"תוסיף 2 עגבניות לרשימה" כשאין עגבניות: השורה ברשימה עם 2, וחצי קילו טחון עם היחידה', async () => {
    answer = respond([{ kind: 'create', product: { name: 'עגבניות', count_type: 'units', qty: 0, category_id: 'ירקות ופירות', location_id: 'מקרר' }, reported: true }, { kind: 'list_add', text: 'עגבניות', amount: 2 },
      { kind: 'create', product: { name: 'בשר טחון', count_type: 'level', level: 'none', category_id: 'בשר ועוף', location_id: 'מקפיא' }, reported: true }, { kind: 'list_add', text: 'בשר טחון', amount: 0.5, unit: 'ק"ג' }]);
    const r = await say(avi, 'תוסיף לרשימה 2 עגבניות וחצי קילו טחון');
    assert.ok(lines(r).some((x) => /2 עגבניות/.test(x)), JSON.stringify(lines(r)));
    await apply(avi, r);
    assert.equal(onList('עגבניות')?.want, 2, JSON.stringify(onList('עגבניות')));
    const t = onList('בשר טחון'); assert.ok(t?.want === 0.5 && t.want_unit === 'ק"ג', JSON.stringify(t));
  });
  await check('R4', 'level עם כמות: "חצי קילו בורגול" (qty 0.5, בלי level) הוא יש; "כמון" עם qty 0 (בלי level) נגמר, בכרטיס ואחרי האישור', async () => {
    answer = respond([{ kind: 'create', product: { name: 'בורגול', count_type: 'level', qty: 0.5, unit: 'ק"ג', category_id: 'יבשים', location_id: 'מזווה' } },
      { kind: 'create', product: { name: 'כמון', count_type: 'level', qty: 0, category_id: 'תבלינים ושמנים', location_id: 'מזווה' } }]);
    const r = await say(avi, 'יש חצי קילו בורגול, והכמון נגמר');
    assert.ok(lines(r).some((x) => /לרשום שיש בורגול/.test(x)) && lines(r).some((x) => /נגמר (ה)?כמון/.test(x)), JSON.stringify(lines(r)));
    await apply(avi, r);
    assert.equal(product('בורגול').level, 'plenty', JSON.stringify(product('בורגול')));
    assert.equal(product('כמון').level, 'none');
    assert.ok(onList('כמון'), 'cumin not on the list');
  });
  await check('R5', '"נשאר מעט קוטג\'" (units, qty 1, level little): בכרטיס "לעדכן שנשאר מעט", כמו שנשמר', async () => {
    answer = respond([{ kind: 'create', product: { name: "קוטג'", count_type: 'units', unit: 'גביע', qty: 1, level: 'little', category_id: 'מוצרי חלב, גבינות וביצים', location_id: 'מקרר' } }]);
    const r = await say(avi, "נשאר מעט קוטג'");
    assert.ok(lines(r).some((x) => /לעדכן שנשאר מעט קוטג'/.test(x)), JSON.stringify(lines(r)));
    await apply(avi, r);
    const p = product("קוטג'"); assert.ok(p.qty === 1 && p.level === 'little', JSON.stringify(p));
  });
  await check('R7', 'out על inuse עם רזרבה: הכרטיס בלי "ולהוסיף לרשימה", כמו שנשמר (נפתחה רזרבה)', async () => {
    await act(avi, [{ kind: 'create', product: { name: 'סבון כלים', count_type: 'inuse', is_open: true, qty: 2, category_id: 'ניקיון וכביסה', location_id: 'ארון ניקיון' } }]);
    answer = () => ({ reply: 'האם לעדכן?', face: 'happy', actions: [{ kind: 'op', product_id: product('סבון כלים').id, op: { type: 'out' } }] });
    const r = await say(avi, 'נגמר סבון הכלים');
    assert.ok(!lines(r).some((x) => /לרשימה/.test(x)), JSON.stringify(lines(r)));
    await apply(avi, r);
    assert.ok(!onList('סבון כלים'), 'on the list');
  });
  await check('R8', 'set qty 0 על מוצר לא קבוע: הכרטיס אומר "ולהוסיף לרשימה", ואחרי האישור הוא ברשימה', async () => {
    await act(avi, [{ kind: 'create', product: { name: 'חומוס', count_type: 'units', unit: 'קופסה', qty: 2, category_id: 'שימורים ורטבים', location_id: 'מזווה' } }]);
    answer = () => ({ reply: 'האם לתקן?', face: 'happy', actions: [{ kind: 'op', product_id: product('חומוס').id, op: { type: 'set', qty: 0 } }] });
    const r = await say(avi, 'אין חומוס בכלל, זה 0');
    assert.ok(lines(r).some((x) => /לרשימה/.test(x)), JSON.stringify(lines(r)));
    await apply(avi, r);
    assert.ok(onList('חומוס'), 'not on the list');
  });
  await check('R9', '"מעכשיו קונים רק X במקום Y" (Y קבוע, מתחת למינימום, שורה ידנית ברשימה): השורה "להוריד Y מהרשימה" נשארת בכרטיס, ו-Y יורד', async () => {
    await act(avi, [{ kind: 'create', product: { name: 'פריכיות', count_type: 'units', qty: 0, is_basic: true, target: 2, category_id: 'יבשים', location_id: 'מזווה' } }]);
    const y = product('פריכיות');
    sql("DELETE FROM list_items WHERE product_id = ?", y.id);
    await act(avi, [{ kind: 'list_add', product_id: y.id }]);
    const item = onList('פריכיות'); assert.ok(item, 'no line');
    answer = () => ({ reply: 'האם ככה?', face: 'happy', actions: [{ kind: 'create', product: { name: 'פריכיות אורז', count_type: 'units', qty: 0, category_id: 'יבשים', location_id: 'מזווה' } },
      { kind: 'edit', product_id: y.id, fields: { is_basic: false } }, { kind: 'list_remove', item_id: item.id }, { kind: 'list_add', text: 'פריכיות אורז' }] });
    const r = await say(avi, 'מעכשיו קונים רק פריכיות אורז במקום פריכיות');
    assert.ok(lines(r).some((x) => /להוריד פריכיות מהרשימה/.test(x)), JSON.stringify(lines(r)));
    await apply(avi, r);
    assert.ok(!onList('פריכיות'), 'still on the list');
  });
  await check('R10', '"כמעט נגמר" עם reported (units, level little, בלי qty): נשמר "נשאר מעט", לא נגמר ולא ברשימה, כמו בכרטיס', async () => {
    answer = respond([{ kind: 'create', product: { name: 'חרדל', count_type: 'units', level: 'little', category_id: 'שימורים ורטבים', location_id: 'מקרר' }, reported: true }]);
    const r = await say(avi, 'החרדל כמעט נגמר');
    assert.ok(lines(r).some((x) => /לעדכן שנשאר מעט חרדל/.test(x)), JSON.stringify(lines(r)));
    await apply(avi, r);
    const p = product('חרדל'); assert.ok(p.qty === 1 && p.level === 'little', JSON.stringify(p));
    assert.ok(!onList('חרדל'), 'on the list');
    assert.equal(outLogged('חרדל'), 0, '"out" in its pace');
  });

  /* ---------- F4: the journal ---------- */
  const taught = () => sql("SELECT summary FROM events WHERE type = 'lesson' ORDER BY ts DESC, rowid DESC").map((x) => x.summary);
  const factsTurn = async (t, text, facts) => { answer = () => ({ reply: 'האם לזכור?', face: 'happy', actions: facts }); const r = await say(t, text); if (process.env.FU_DEBUG) console.log(JSON.stringify(r).slice(0, 600)); if (r.options?.includes('כן, תזכור')) await say(t, 'כן, תזכור'); else if (r.proposal?.id && r.proposal.status !== 'applied') await apply(t, r); }; // "האם תרצי שאזכור…?" first
  await check('F4-1', 'עובדה אחת על עצמי: "מיכל לימדה אותי שהיא לא אוכלת כוסברה."', async () => {
    const n = taught().length;
    await factsTurn(michal, 'אני לא אוכלת כוסברה', [{ kind: 'fact', key: 'avoid', about: 'מיכל', value: 'כוסברה', text: 'מיכל לא אוכלת כוסברה' }]);
    assert.equal(taught().length, n + 1); assert.equal(taught()[0], 'מיכל לימדה אותי שהיא לא אוכלת כוסברה.');
  });
  await check('F4-2', 'שתיים על עצמי באותה הודעה: שורה אחת, ", וש"', async () => {
    const n = taught().length;
    await factsTurn(michal, 'אני פסקטריאנית ולא אוכלת פטריות', [{ kind: 'fact', key: 'diet', about: 'מיכל', value: 'פסקטריאנית', text: 'מיכל פסקטריאנית, אוכלת דגים' }, { kind: 'fact', key: 'avoid', about: 'מיכל', value: 'פטריות', text: 'מיכל לא אוכלת פטריות.' }]);
    assert.equal(taught().length, n + 1, JSON.stringify(taught().slice(0, 3)));
    assert.equal(taught()[0], 'מיכל לימדה אותי שהיא פסקטריאנית, אוכלת דגים, ושהיא לא אוכלת פטריות.');
  });
  await check('F4-3', 'עובדה על מישהו אחר (ילד, מאושרת מיד): "אבי לימד אותי ש…" עם השם, בלי "ש" כפולה', async () => {
    sql("INSERT OR IGNORE INTO users (id, name, gender, role, active, created) VALUES (5, 'יואבי', 'm', 'child', 1, 0)");
    const n = taught().length;
    await factsTurn(avi, 'יואבי לא אוכל זיתים', [{ kind: 'fact', key: 'avoid', about: 'יואבי', value: 'זיתים', text: 'שיואבי לא אוכל זיתים' }]);
    assert.equal(taught().length, n + 1); assert.equal(taught()[0], 'אבי לימד אותי שיואבי לא אוכל זיתים.');
  });
  await check('F4-4', 'על עצמי ועל אחר באותה הודעה: שתי שורות, כל אחת תקינה', async () => {
    const n = taught().length;
    await factsTurn(avi, 'אני לא אוכל חצילים ויואבי לא אוכל פלפל', [{ kind: 'fact', key: 'avoid', about: 'אבי', value: 'חצילים', text: 'אבי לא אוכל חצילים' }, { kind: 'fact', key: 'avoid', about: 'יואבי', value: 'פלפל', text: 'יואבי לא אוכל פלפל' }]);
    assert.equal(taught().length, n + 2, JSON.stringify(taught().slice(0, 3)));
    assert.deepEqual(taught().slice(0, 2).sort(), ['אבי לימד אותי שהוא לא אוכל חצילים.', 'אבי לימד אותי שיואבי לא אוכל פלפל.'].sort());
  });
  await check('F4-5', 'שורות ישנות ביומן נשארות כמו שהן, ושכחה של עובדה מוחקת את השורה שלה', async () => {
    sql("INSERT INTO events (id, ts, user_id, type, summary) VALUES (990001, ?, 2, 'lesson', 'מיכל לימדה אותי: מיכל צמחונית')", Date.now() - 86400e3);
    const j = (await call(michal, 'GET', '/api/state')).data.journal || [];
    assert.ok(j.some((e) => e.summary === 'מיכל לימדה אותי: מיכל צמחונית'), 'the old line changed or is gone');
    const f = sql("SELECT id, event_id FROM facts WHERE about_id = 2 AND key = 'avoid' AND value = 'פטריות'")[0];
    sql('DELETE FROM events WHERE id = ?', f.event_id); // (forget() deletes it the same way)
    assert.equal(sql("SELECT COUNT(*) AS n FROM events WHERE summary LIKE '%פטריות%'")[0].n, 0);
  });

  /* ---------- F3: a fact about another grown-up in the first meeting ---------- */
  await check('F3-1', 'בהיכרות אבי מספר שהילה צמחונית ולא אוכלת כוסברה: העובדות מחכות לה, והשאלה מחכה לה (אין לה טלפון עדיין)', async () => {
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('onboard', ?)", JSON.stringify({ step: 'food', user: 1, started: Date.now(), people: [{ name: 'הילה', gender: 'f' }] }));
    answer = (b) => (b.tools?.[0]?.name === 'onboard_parse' ? { food: [{ name: 'הילה', key: 'diet', value: 'צמחונית', text: 'הילה צמחונית' }, { name: 'הילה', key: 'avoid', value: 'כוסברה', text: 'הילה לא אוכלת כוסברה' }] } : { reply: 'אני פה!', face: 'happy' });
    await say(avi, 'הילה צמחונית ולא אוכלת כוסברה');
    const f = sql("SELECT * FROM facts WHERE about = 'person' AND about_id = 4 AND ended IS NULL");
    assert.equal(f.length, 2, JSON.stringify(f)); assert.ok(f.every((x) => x.confirmed_by == null), 'confirmed without her');
    const q = JSON.parse(sql("SELECT value FROM settings WHERE key = 'askq:4'")[0]?.value || '[]');
    assert.equal(q.length, 2, JSON.stringify(q));
    assert.equal(q[0].bubble.reply, 'אבי ביקש שאזכור שהילה צמחונית. האם לזכור?');
  });
  let orit;
  await check('F3-2', 'הילה מתחברת ועונה על שאלת האוכל: אחרי התשובה מופיעה לה השאלה, ו"כן, תזכור" מאשר', async () => {
    orit = (await call(null, 'POST', '/api/pair', { code: '444444' })).data.token;
    answer = () => ({ reply: 'סגור!', face: 'happy' });
    await say(orit, 'אני אוכלת הכל חוץ ממה שאבי אמר');
    const asked = (await chatOf(orit)).filter((m) => m.role === 'shuki' && m.content.reply === 'אבי ביקש שאזכור שהילה צמחונית. האם לזכור?');
    assert.equal(asked.length, 1, 'the question is not in her chat');
    assert.deepEqual(asked[0].content.options, ['כן, תזכור', 'לא צריך']);
    await say(orit, 'כן, תזכור');
    assert.ok(sql("SELECT confirmed_by FROM facts WHERE about_id = 4 AND key = 'diet'")[0]?.confirmed_by === 4, 'not confirmed');
  });
  await check('F3-3', 'אחרי זה השאלה השנייה; "לא צריך" מוחק את העובדה, והמודל רואה את מה שהיא אישרה', async () => {
    const asked = (await chatOf(orit)).filter((m) => m.role === 'shuki' && m.content.reply === 'אבי ביקש שאזכור שהילה לא אוכלת כוסברה. האם לזכור?');
    assert.equal(asked.length, 1, 'the second question is not in her chat');
    await say(orit, 'לא צריך');
    assert.equal(sql("SELECT COUNT(*) AS n FROM facts WHERE about_id = 4 AND key = 'avoid'")[0].n, 0, 'not deleted');
    requests.length = 0; answer = () => ({ reply: 'אני פה!', face: 'happy' });
    await say(orit, 'מה לבשל הערב?');
    const sys = JSON.stringify(requests.find((b) => b.tools?.[0]?.name === 'respond')?.system || '');
    assert.ok(sys.includes('צמחונית'), 'the model does not see the confirmed fact');
  });
  await check('F3-5', 'שתי עובדות על מבוגר מחובר באותה הודעה בהיכרות: שתי השאלות, אחת אחרי השנייה, ו"כן" מאשר את הראשונה', async () => {
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('onboard', ?)", JSON.stringify({ step: 'food', user: 1, started: Date.now(), people: [{ name: 'מיכל', gender: 'f' }] }));
    sql("DELETE FROM settings WHERE key IN ('ask:2', 'askq:2')");
    answer = (b) => (b.tools?.[0]?.name === 'onboard_parse' ? { food: [{ name: 'מיכל', key: 'avoid', value: 'זיתים', text: 'מיכל לא אוכלת זיתים' }, { name: 'מיכל', key: 'avoid', value: 'חצילים', text: 'מיכל לא אוכלת חצילים' }] } : { reply: 'אני פה!', face: 'happy' });
    await say(avi, 'מיכל לא אוכלת זיתים וחצילים');
    const asked = () => sql("SELECT content FROM chat WHERE content LIKE '%שאזכור שמיכל לא אוכלת%'").map((x) => JSON.parse(x.content).reply);
    assert.deepEqual(asked(), ['אבי ביקש שאזכור שמיכל לא אוכלת זיתים. האם לזכור?'], JSON.stringify(asked()));
    await say(michal, 'כן, תזכור');
    assert.ok(sql("SELECT confirmed_by FROM facts WHERE about_id = 2 AND value = 'זיתים'")[0]?.confirmed_by === 2, 'the first is not confirmed');
    assert.equal(asked().length, 2, 'the second was not asked after it');
  });
  await check('F3-4', 'שאלה שהעובדה שלה כבר לא ממתינה (הילה אמרה בעצמה) לא נשאלת', async () => {
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('onboard', ?)", JSON.stringify({ step: 'food', user: 1, started: Date.now(), people: [{ name: 'מיכל', gender: 'f' }] }));
    sql("DELETE FROM settings WHERE key IN ('ask:2', 'askq:2')");
    answer = (b) => (b.tools?.[0]?.name === 'onboard_parse' ? { food: [{ name: 'מיכל', key: 'allergy', value: 'אגוזים', text: 'מיכל אלרגית לאגוזים' }] } : { reply: 'אני פה!', face: 'happy' });
    await say(avi, 'מיכל אלרגית לאגוזים');
    assert.equal(sql("SELECT COUNT(*) AS n FROM chat WHERE content LIKE '%אלרגית לאגוזים. האם לזכור%'")[0].n, 1, 'Michal has a phone: asked now');
    sql("DELETE FROM settings WHERE key = 'ask:2'");
    sql("UPDATE facts SET confirmed_by = 2 WHERE about_id = 2 AND key = 'allergy'");
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('askq:2', ?)", JSON.stringify([{ ask: { actions: [{ kind: 'fact_confirm', id: sql("SELECT id FROM facts WHERE about_id = 2 AND key = 'allergy'")[0].id, text: 'מיכל אלרגית לאגוזים' }], done: 'סגור, אזכור!', nope: 'בסדר, לא אזכור.' }, bubble: { reply: 'אבי ביקש שאזכור שמיכל אלרגית לאגוזים. האם לזכור?', face: 'happy', options: ['כן, תזכור', 'לא צריך'], for: 2 }, ts: Date.now() }]));
    answer = () => ({ reply: 'אני פה!', face: 'happy' });
    await say(michal, 'מה נשמע?');
    assert.equal(sql("SELECT COUNT(*) AS n FROM chat WHERE content LIKE '%אלרגית לאגוזים. האם לזכור%'")[0].n, 1, 'asked again');
  });
  await check('H7', 'היכרות: ילד רק כשנאמר. "אני גר עם שירה", "אשתי תמר", "יעל ואיתמר בן 4" (רק איתמר ילד), גם כשהמודל סימן את כולם ילדים', async () => {
    const role = (n) => sql('SELECT role FROM users WHERE name = ?', n)[0]?.role;
    for (const [text, people] of [['אני גר עם שירה', [['שירה', 'f']]], ['אשתי תמר גרה איתי', [['תמר', 'f']]], ['יעל ואיתמר בן 4', [['יעל', 'f'], ['איתמר', 'm']]]]) {
      sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('onboard', ?)", JSON.stringify({ step: 'people', user: 1, started: Date.now() }));
      answer = (b) => (b.tools?.[0]?.name === 'onboard_parse' ? { people: people.map(([name, gender]) => ({ name, gender, child: true })) } : { reply: 'אני פה!', face: 'happy' });
      await say(avi, text);
    }
    assert.deepEqual(['שירה', 'תמר', 'יעל', 'איתמר'].map(role), ['member', 'member', 'member', 'child']);
    sql("UPDATE settings SET value = json_set(value, '$.done', 1) WHERE key = 'onboard'");
  });
  await check('L1', 'רמות (16/10): כרטיס של מיפוי ומה שההיכרות מוסיפה מסומנים (source) ולא נספרים; הנקודות הן ימים (test/levels16.test.js)', async () => {
    sql("DELETE FROM settings WHERE key IN ('catalog_area', 'catalog_area_at')");
    answer = () => ({ reply: 'יש! הארון ממופה.', face: 'happy', catalog_area: 'מזווה', options: ['סיימנו למפות את מזווה', 'נמשיך למפות', 'נעצור כאן'], actions: [{ kind: 'create', product: { name: 'קינמון', count_type: 'level', level: 'plenty', category_id: 'תבלינים ושמנים', location_id: 'מזווה' } }] });
    await apply(avi, await say(avi, 'במזווה יש קינמון'));
    assert.equal(sql("SELECT source FROM events WHERE summary LIKE '%קינמון%'")[0]?.source, 'mapping');
    sql("DELETE FROM settings WHERE key IN ('catalog_area', 'catalog_area_at')");
    answer = respond([{ kind: 'create', product: { name: 'ציפורן', count_type: 'level', level: 'plenty', category_id: 'תבלינים ושמנים', location_id: 'מזווה' } }]);
    await apply(avi, await say(avi, 'קנינו ציפורן'));
    assert.equal(sql("SELECT source FROM events WHERE summary LIKE '%ציפורן%'")[0]?.source, null);
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('onboard', ?)", JSON.stringify({ step: 'place', place: 'מזווה', user: 1, started: Date.now() }));
    answer = (b) => (b.tools?.[0]?.name === 'onboard_parse' ? { items: [{ name: 'הל', count_type: 'level', category: 'תבלינים ושמנים', phrase: 'הל' }] } : { reply: 'אני פה!', face: 'happy' });
    await say(avi, 'יש הל');
    sql("UPDATE settings SET value = json_set(value, '$.done', 1) WHERE key = 'onboard'");
    const ev = sql("SELECT source FROM events WHERE summary LIKE '%הל%' AND summary NOT LIKE '%הלו%'").map((x) => x.source);
    assert.ok(ev.length && ev.every((x) => x === 'onboarding'), JSON.stringify(ev));
    // only days count: everything Avi did today is one point, with one more if he finished a trip today
    const days = new Set(sql("SELECT ts, type FROM events WHERE user_id = 1 AND undone IS NULL AND waste = 0 AND type NOT IN ('undo', 'delete', 'discard') AND source IS NULL").map((r) => new Date(r.ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })));
    assert.ok((await call(avi, 'GET', '/api/state')).data.growth.xp <= days.size * 2, 'more points than days');
  });
  await check('H8', 'מהמודל האמיתי (16/10): הכרטיס נשאר כשהבית ממפה גם בלי catalog_area בתשובה; edit של כמות בלבד הוא "לעדכן שיש"; קבוע עם target: "לסמן X כמוצר קבוע"', async () => {
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('catalog_area', 'מזווה'), ('catalog_area_at', ?)", String(Date.now()));
    await act(avi, [{ kind: 'create', product: { name: 'עדשים', count_type: 'units', unit: 'שקית', qty: 1, category_id: 'יבשים', location_id: 'מזווה' } }]);
    const len = product('עדשים').id;
    answer = () => ({ reply: 'יש! המזווה ממופה.', face: 'happy', options: ['סיימנו למפות את המזווה', 'נמשיך למפות', 'נעצור כאן'], actions: [{ kind: 'create', product: { name: 'גריסים', count_type: 'level', level: 'plenty', category_id: 'יבשים', location_id: 'מזווה' } }, { kind: 'edit', product_id: len, fields: { qty: 3 } }] });
    const r = await say(avi, 'במזווה יש גריסים ו-3 שקיות עדשים');
    assert.ok(lines(r).includes('לרשום שיש גריסים?') && lines(r).some((x) => /^לעדכן שיש 3 שקיות/.test(x)), JSON.stringify(lines(r)));
    assert.equal((r.options || []).length, 3, JSON.stringify(r.options));
    answer = () => ({ reply: 'האם לסמן כקבועים?', face: 'happy', actions: [{ kind: 'edit', product_id: len, fields: { is_basic: true, target: 2 } }] });
    const b = await say(avi, 'העדשים');
    assert.deepEqual(lines(b), ['לסמן עדשים כמוצר קבוע?'], JSON.stringify(b.proposal?.lines));
    sql("DELETE FROM settings WHERE key IN ('catalog_area', 'catalog_area_at')");
  });
  await check('H9', '"נשאר מעט" כשיש עוד בקבוק סגור (רוטב דגים): לא שואלים "להוסיף לרשימה?" ולא מוסיפים, ב-create וב-op low', async () => {
    answer = respond([{ kind: 'create', product: { name: 'רוטב דגים', count_type: 'inuse', level: 'little', qty: 1, category_id: 'שימורים ורטבים', location_id: 'מזווה' } }, { kind: 'list_add', text: 'רוטב דגים' }]);
    const r = await say(avi, 'רוטב דגים עומד להיגמר, ויש עוד בקבוק');
    assert.ok(!lines(r).some((x) => /לרשימה/.test(x)), JSON.stringify(lines(r)));
    await apply(avi, r);
    let low = (await call(avi, 'GET', '/api/state')).data.lowAsk; assert.ok(!low.some((x) => x.name === 'רוטב דגים'), JSON.stringify(low));
    await act(avi, [{ kind: 'create', product: { name: 'חומץ אורז', count_type: 'inuse', is_open: true, qty: 1, category_id: 'שימורים ורטבים', location_id: 'מזווה' } }]);
    answer = () => ({ reply: 'האם לעדכן?', face: 'happy', actions: [{ kind: 'op', product_id: product('חומץ אורז').id, op: { type: 'low' } }, { kind: 'list_add', product_id: product('חומץ אורז').id }] });
    const r2 = await say(avi, 'החומץ אורז כמעט נגמר, יש עוד אחד סגור');
    assert.ok(!lines(r2).some((x) => /לרשימה/.test(x)), JSON.stringify(lines(r2)));
    await apply(avi, r2);
    low = (await call(avi, 'GET', '/api/state')).data.lowAsk; assert.ok(!low.some((x) => x.name === 'חומץ אורז'), JSON.stringify(low));
    assert.ok(!onList('חומץ אורז') && !onList('רוטב דגים'), 'on the list');
  });
} catch (e) { console.log('setup failed:', e.message, log.slice(-800)); } finally {
  srv.kill(); mock.close();
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} first-use checks passed`);
  process.exit(ok === results.length && results.length ? 0 : 1);
}
