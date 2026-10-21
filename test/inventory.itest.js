// Stage 9: the inventory gantt (docs/stage9-plan.md), on the Node server with a fake model. The plan calls these I1, I2…;
// here they are S9-01, S9-02… (I0א–I0ד are S9-00א… : task 0ב, before the gantt's own).
// Run: node --disable-warning=ExperimentalWarning test/inventory.itest.js
import './fetch-retry.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DIR = '/tmp/shuki-test/shuki-inventory'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const PORT = 8871, MOCK = 8872;

// Avi (admin), Michal, Yoavi (a child), and Noam (who chose the plural)
const db = new DatabaseSync(`${DIR}/shuki.db`);
db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) { db.exec(readFileSync(`migrations/${f}`, 'utf8')); db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f); }
db.exec(readFileSync('test/fixture-house.sql', 'utf8'));
db.exec("INSERT INTO users (id, name, gender, role, active, created) VALUES (3, 'יואבי', 'm', 'child', 1, 0), (4, 'נועם', 'p', 'adult', 1, 0)");
db.exec("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999), ('222222', 2, 9999999999999), ('333333', 3, 9999999999999), ('444444', 4, 9999999999999)");
db.close();

let answer = () => ({ reply: 'אני פה!', face: 'happy' });
const requests = [];
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { const b = Buffer.concat(parts).toString('utf8'); // bytes first: a Hebrew letter can be split between chunks
  const body = JSON.parse(b); requests.push(body);
  const a = answer(body);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'tool_use', id: `t${requests.length}`, name: body.tools?.[0]?.name || 'respond', input: a }], usage: { input_tokens: 1, output_tokens: 1 } }));
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
const state = async (t) => (await call(t, 'GET', '/api/state')).data;
const act = (t, actions) => call(t, 'POST', '/api/actions', { actions, op_id: `op-${Math.random()}` });
const pid = (name) => sql('SELECT id FROM products WHERE name = ? AND deleted IS NULL', name)[0]?.id;
const ownerOf = (name) => sql('SELECT owner FROM products WHERE name = ?', name)[0]?.owner;
const prompt = () => requests.at(-1).system.map((x) => x.text).join('\n');
// the house's time today at `hour`:05 (Asia/Jerusalem)
const at = (hour, days = 0) => { const z = (ts) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }).format(ts));
  const [y, mo, dd] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(Date.now()).split('-').map(Number); let ts = Date.UTC(y, mo - 1, dd + days, hour, 5); ts -= (z(ts) - hour) * 3600e3; return ts; };
/** a new day for Shuki's own "want me to remember?" (at most one a day that he starts: r12 q030) and no question left open */
const fresh = () => { sql("DELETE FROM settings WHERE key LIKE 'learnask:%' OR key LIKE 'ask:%' OR key LIKE 'askq:%'"); sql("UPDATE chat SET ts = ts - 3600e3 WHERE role = 'user' AND ts > ?", Date.now() - 120e3); }; // and not 30 messages a minute

let avi, michal, yoavi, noam;
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  [avi, michal, yoavi, noam] = await Promise.all(['111111', '222222', '333333', '444444'].map(async (code) => (await call(null, 'POST', '/api/pair', { code })).data.token));
  // the phones were just paired: the joiner's questions would take the first message; not what's tested here
  sql("DELETE FROM settings WHERE key LIKE 'joinfood:%' OR key LIKE 'joinlife:%'");

  // ---------- 0ב: "לזכור?" about whoever writes, to them in the second person (the approved rule of D10) ----------
  const fact = (about, key, value, text) => ({ kind: 'fact', key, about, value, text });
  const asks = async (t, text, act, want) => {
    fresh();
    answer = () => ({ reply: 'הבנתי.', face: 'happy', actions: [act] });
    const r = await say(t, text);
    assert.ok((r.reply || '').includes(want), `${r.reply} — wanted ${want}`);
    assert.equal((await say(t, 'לא צריך')).reply, 'בסדר, לא אזכור.');
  };
  await check('S9-00א', 'אבי, "אני לא אוכל פטריות": "האם תרצה שאזכור שאתה לא אוכל פטריות?"', async () => {
    await asks(avi, 'אני לא אוכל פטריות', fact('אבי', 'avoid', 'פטריות', 'אבי לא אוכל פטריות'), 'האם תרצה שאזכור שאתה לא אוכל פטריות?');
  });
  await check('S9-00ב', 'אלרגיה: "…שאת אלרגית לבוטנים?" למיכל, "…שאתה אלרגי…" לאבי', async () => {
    await asks(michal, 'אני אלרגית לבוטנים', fact('מיכל', 'allergy', 'בוטנים', 'מיכל אלרגית לבוטנים'), 'האם תרצי שאזכור שאת אלרגית לבוטנים?');
    await asks(avi, 'אני אלרגי לבוטנים', fact('אבי', 'allergy', 'בוטנים', 'אבי אלרגי לבוטנים'), 'האם תרצה שאזכור שאתה אלרגי לבוטנים?');
  });
  await check('S9-00ג', '"לאבי יש…" → "שלך יש…"; מי שבחר רבים: "שאתם…", "שלכם יש…"', async () => {
    await asks(avi, 'יש לי מקרר קטן במשרד', { kind: 'lesson', text: 'לאבי יש מקרר קטן במשרד' }, 'האם תרצה שאזכור שלך יש מקרר קטן במשרד?');
    await asks(noam, 'אנחנו לא אוכלים פטריות', fact('נועם', 'avoid', 'פטריות', 'נועם לא אוכלים פטריות'), 'האם תרצו שאזכור שאתם לא אוכלים פטריות?');
    await asks(noam, 'יש לנו מקרר קטן במשרד', { kind: 'lesson', text: 'לנועם יש מקרר קטן במשרד' }, 'האם תרצו שאזכור שלכם יש מקרר קטן במשרד?');
  });
  await check('S9-00ה', 'כלל של מישהו אחר נשאר כמו שהוא ("כשמיכל אומרת… היא מתכוונת"); "במקום ש…" בגוף שני', async () => {
    await asks(avi, 'כשמיכל אומרת חלב היא מתכוונת לסויה', { kind: 'lesson', text: 'כשמיכל אומרת חלב היא מתכוונת לחלב סויה' }, 'האם תרצה שאזכור שכשמיכל אומרת חלב היא מתכוונת לחלב סויה?');
    sql("INSERT INTO lessons (text, added, added_by) VALUES ('אבי לא אוכל פטריות', 1, 1)");
    const id = sql("SELECT id FROM lessons WHERE text = 'אבי לא אוכל פטריות'")[0].id;
    await asks(avi, 'אני כן אוכל פטריות עכשיו', { kind: 'lesson', text: 'אבי אוכל פטריות', replaces: id }, 'האם תרצה שאזכור שאתה אוכל פטריות, במקום שאתה לא אוכל פטריות?');
    sql('DELETE FROM lessons WHERE id = ?', id);
  });
  await check('S9-00ד', 'עובדה על מישהו אחר נשארת כמו שהיא: "…שיואבי לא אוכל פטריות?"', async () => {
    await asks(avi, 'יואבי לא אוכל פטריות', fact('יואבי', 'avoid', 'פטריות', 'יואבי לא אוכל פטריות'), 'האם תרצה שאזכור שיואבי לא אוכל פטריות?');
  });

  // ---------- מ1: "של מי" in every house ----------
  await check('S9-01', 'בבית רגיל: create עם owner "אבי" נשמר עם owner = 1, ו-owner בכלי; edit מהאפליקציה עם owner: 2 נשמר', async () => {
    fresh(); answer = () => ({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'create', product: { name: 'דאודורנט', count_type: 'units', qty: 0, owner: 'אבי' } }] });
    const r = await say(avi, 'אני צריך דאודורנט');
    assert.ok(requests.at(-1).tools[0].input_schema.properties.actions.items.properties.product.properties.owner?.enum?.includes('מיכל'), 'owner in the tool');
    assert.equal((await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {})).status, 200);
    assert.equal(ownerOf('דאודורנט'), 1);
    await act(avi, [{ kind: 'edit', product_id: pid('דאודורנט'), fields: { owner: 2 } }]);
    assert.equal(ownerOf('דאודורנט'), 2);
  });
  await check('S9-02', 'מוצר פרטי עם owner נשמר עם owner = null', async () => {
    fresh(); answer = () => ({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'create', private: true, product: { name: 'טמפונים', count_type: 'units', qty: 0, owner: 'מיכל' } }] });
    const r = await say(michal, 'תוסיף לי טמפונים, שרק אני אראה');
    await call(michal, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    assert.equal(sql("SELECT private_to FROM products WHERE name = 'טמפונים'")[0]?.private_to, 2, 'private');
    assert.equal(ownerOf('טמפונים'), null);
    await act(michal, [{ kind: 'edit', product_id: pid('טמפונים'), fields: { owner: 2 } }]);
    assert.equal(ownerOf('טמפונים'), null, 'not by an edit either');
  });
  await check('S9-03', 'ילד ששולח fields: { owner: 3 } לא משנה את המוצר', async () => {
    sql("INSERT INTO products (name, count_type, qty, created, updated) VALUES ('דגני בוקר', 'units', 1, 1, 1)");
    await act(yoavi, [{ kind: 'edit', product_id: pid('דגני בוקר'), fields: { owner: 3 } }]);
    assert.equal(ownerOf('דגני בוקר'), null);
  });
  await check('S9-04', 'הכרטיס: edit עם owner מציג "של מיכל", ובלי owner "משותף"; אף פעם לא "פרטי"', async () => {
    fresh(); sql("INSERT INTO products (name, count_type, qty, created, updated) VALUES ('חלב סויה', 'units', 1, 1, 1)");
    answer = () => ({ reply: 'לעדכן?', face: 'happy', actions: [{ kind: 'edit', product_id: pid('חלב סויה'), fields: { owner: 'מיכל', is_basic: true } }] });
    let r = await say(avi, 'חלב הסויה של מיכל, והוא קבוע');
    const line = r.proposal.lines.find((l) => l.icon === 'edit');
    assert.match(line.detail, /של מיכל/); assert.doesNotMatch(line.detail, /פרטי/);
    await call(avi, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
    answer = () => ({ reply: 'לעדכן?', face: 'happy', actions: [{ kind: 'edit', product_id: pid('חלב סויה'), fields: { owner: null, is_basic: true } }] });
    r = await say(avi, 'חלב הסויה של כולם');
    assert.match(r.proposal.lines.find((l) => l.icon === 'edit').detail, /משותף/);
    await call(avi, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
  });
  // the pattern: Michal alone puts soy milk on the list, the other grown-ups add things of their own
  const add = (uid, name, n, days = 10) => { for (let i = 0; i < n; i++) sql("INSERT INTO list_items (product_id, text, store, source, status, added_by, added) VALUES (?, ?, 'super', 'manual', 'done', ?, ?)", name ? pid(name) : null, name ? null : `דבר ${uid}-${i}`, uid, Date.now() - (days + i) * 86400e3); };
  const morning = () => call(avi, 'POST', '/api/__schedule', { now: at(7) });
  await check('S9-05', 'הדפוס: מיכל מוסיפה חלב סויה 3 פעמים, ואבי ונועם 5 דברים אחרים: owner:{pid}; "תודה" של מיכל מקבל את השאלה; "כן, רק אני" כותב owner = 2', async () => {
    sql("DELETE FROM list_items"); sql("DELETE FROM noticed");
    add(2, 'חלב סויה', 3); add(1, null, 5); add(4, null, 5);
    await morning();
    const row = sql("SELECT * FROM noticed WHERE key = ?", `owner:${pid('חלב סויה')}:2`)[0];
    assert.ok(row, 'no pattern'); assert.equal(row.user_id, 2);
    fresh(); answer = () => ({ reply: 'בכיף!', face: 'happy' });
    const r = await say(michal, 'תודה');
    assert.equal(r.reply, 'בכיף! אגב, האם רק את שותה חלב סויה?'); assert.deepEqual(r.options, ['כן, רק אני', 'לא רק אני']);
    assert.equal((await say(michal, 'כן, רק אני')).reply, 'סגור, אזכור!');
    assert.equal(ownerOf('חלב סויה'), 2);
  });
  await check('S9-05א', 'אבי לא נשאל, ובהגדרות שלו השורה לא מופיעה; אצל מיכל היא מופיעה בגוף שני; ההורדה של אבי בלי השורה', async () => {
    sql("UPDATE products SET owner = NULL WHERE name = 'חלב סויה'"); sql("UPDATE noticed SET status = 'watching' WHERE kind = 'owner'");
    fresh(); answer = () => ({ reply: 'בכיף!', face: 'happy' });
    assert.equal((await say(avi, 'תודה')).reply, 'בכיף!');
    assert.ok(!(await state(avi)).noticed.some((n) => n.kind === 'owner'), 'in Avi\'s settings');
    assert.equal((await state(michal)).noticed.find((n) => n.kind === 'owner')?.text, 'רק את מוסיפה חלב סויה לרשימה.');
    assert.equal((await state(noam)).noticed.find((n) => n.kind === 'owner'), undefined);
    assert.ok(!(await call(avi, 'GET', '/api/export')).data.noticed.some((n) => n.kind === 'owner'), 'in Avi\'s download');
    const id = sql("SELECT id FROM noticed WHERE kind = 'owner'")[0].id;
    assert.equal((await call(avi, 'POST', '/api/noticed', { id, yes: true })).status, 404, 'Avi answered for her');
  });
  await check('S9-05ב', 'כשאבי לא הוסיף כלום לרשימה בחלון: אין דפוס. ומישהו אחר סימן שנגמר: אין דפוס', async () => {
    sql("DELETE FROM list_items"); sql("DELETE FROM noticed");
    add(2, 'חלב סויה', 3); add(4, null, 5);
    await morning();
    assert.equal(sql("SELECT COUNT(*) AS n FROM noticed WHERE kind = 'owner'")[0].n, 0, 'one person does all the adding');
    add(1, null, 5);
    const e = sql("INSERT INTO events (ts, user_id, type, summary) VALUES (?, 1, 'op', 'x')", Date.now() - 5 * 86400e3).lastInsertRowid;
    sql("INSERT INTO product_log (event_id, ts, product_id, kind) VALUES (?, ?, ?, 'out')", e, Date.now() - 5 * 86400e3, pid('חלב סויה'));
    await morning();
    assert.equal(sql("SELECT COUNT(*) AS n FROM noticed WHERE kind = 'owner'")[0].n, 0, 'Avi marked it out');
    sql('DELETE FROM product_log'); sql("INSERT INTO events (ts, user_id, type, summary, product_id) VALUES (?, 4, 'open', 'נועם פתח חלב סויה', ?)", Date.now() - 3 * 86400e3, pid('חלב סויה'));
    await morning();
    assert.equal(sql("SELECT COUNT(*) AS n FROM noticed WHERE kind = 'owner'")[0].n, 0, 'Noam used it');
    sql("DELETE FROM events WHERE user_id = 4 AND type = 'open'");
    const e2 = sql("INSERT INTO events (ts, user_id, type, summary, product_id) VALUES (?, 1, 'purchase', 'אבי קנה חלב סויה', ?)", Date.now() - 3 * 86400e3, pid('חלב סויה')).lastInsertRowid;
    await morning();
    assert.equal(sql("SELECT COUNT(*) AS n FROM noticed WHERE kind = 'owner'")[0].n, 1, 'Avi bought it for her: still hers alone');
    sql('DELETE FROM noticed'); sql('DELETE FROM events WHERE id = ?', e2);
    sql("UPDATE products SET category_id = (SELECT id FROM categories WHERE name = 'תינוק') WHERE name = 'חלב סויה'");
    await morning();
    assert.equal(sql("SELECT COUNT(*) AS n FROM noticed WHERE kind = 'owner'")[0].n, 0, 'the baby\'s things are the house\'s');
    sql("UPDATE products SET category_id = NULL WHERE name = 'חלב סויה'");
    await morning();
    assert.equal(sql("SELECT COUNT(*) AS n FROM noticed WHERE kind = 'owner'")[0].n, 1, 'with nothing in the way, it is noticed');
  });
  await check('S9-05ג', 'השורה החדשה ב-system[0]', async () => {
    fresh(); answer = () => ({ reply: 'כן.', face: 'happy' });
    await say(avi, 'מה נשמע?');
    assert.match(requests.at(-1).system[0].text, /"שלי", "הדאודורנט שלי", "אני צריך דאודורנט" \(מוצר אישי, ברור מהמשפט\): owner של מי שכותב, לא private/);
    assert.doesNotMatch(requests.at(-1).system[0].text, /"שלי", "הדאודורנט שלי" ומוצרי מחזור הם לא פרטיים/);
  });

  // ---------- מ3: a child's "שלי" through a grown-up; deleting what is someone's ----------
  await check('S9-06', 'יואבי, "הדגני בוקר שלי": כרטיס למבוגרים ותשובה לילד; אחרי אישור של מיכל owner = 3', async () => {
    fresh(); sql("UPDATE products SET owner = NULL WHERE name = 'דגני בוקר'");
    answer = () => ({ reply: 'סגור!', face: 'happy', actions: [{ kind: 'edit', product_id: pid('דגני בוקר'), fields: { owner: 'יואבי' } }] });
    const r = await say(yoavi, 'הדגני בוקר האלה שלי');
    assert.equal(r.reply, 'ביקשתי מההורים לאשר שדגני הבוקר יהיו שלך.'); // three grown-ups in this house
    assert.equal(r.proposal, undefined, 'a card for the child');
    const card = JSON.parse(sql("SELECT content FROM chat WHERE role = 'shuki' AND content LIKE '%notFor%' ORDER BY id DESC LIMIT 1")[0].content); // the grown-ups' bubble (not for the child)
    assert.equal(card.reply, 'יואבי ביקש שדגני הבוקר יהיו שלו. האם לאשר?');
    assert.deepEqual(card.proposal.lines.map((l) => l.text), ['לסמן שדגני הבוקר של יואבי']);
    assert.equal(ownerOf('דגני בוקר'), null, 'before a grown-up approved');
    assert.equal((await call(michal, 'POST', `/api/proposals/${card.proposal.id}/apply`, {})).status, 200);
    assert.equal(ownerOf('דגני בוקר'), 3);
  });
  await check('S9-07', 'בבית רגיל, מוצר של אבי (המנהל): מיכל לא מוחקת אותו, ומקבלת את הנוסח של onlyTheyDelete; noDelete במסך', async () => {
    sql("INSERT INTO products (name, count_type, qty, owner, created, updated) VALUES ('קפה של אבי', 'units', 1, 1, 1, 1)");
    const r = await act(michal, [{ kind: 'delete', product_id: pid('קפה של אבי') }]);
    assert.equal(r.data.error, 'את המוצר הזה רק אבי יכול למחוק.', JSON.stringify(r.data));
    assert.equal((await state(michal)).products.find((p) => p.name === 'קפה של אבי').noDelete, 'את המוצר הזה רק אבי יכול למחוק.');
    assert.equal((await act(avi, [{ kind: 'delete', product_id: pid('קפה של אבי') }])).status, 200, 'he can');
  });
  await check('S9-08', 'ילד שמבקש "שלו" על מוצר של אבי: אין כרטיס; owner של מישהו אחר מילד נופל', async () => {
    fresh(); sql("INSERT INTO products (name, count_type, qty, owner, created, updated) VALUES ('שוקו', 'units', 1, 1, 1, 1)");
    const n = sql("SELECT COUNT(*) AS n FROM proposals")[0].n;
    answer = () => ({ reply: 'סגור!', face: 'happy', actions: [{ kind: 'edit', product_id: pid('שוקו'), fields: { owner: 'יואבי' } }] });
    const r = await say(yoavi, 'השוקו שלי');
    assert.equal(sql("SELECT COUNT(*) AS n FROM proposals")[0].n, n, 'a card'); assert.doesNotMatch(r.reply, /ביקשתי/);
    answer = () => ({ reply: 'סגור!', face: 'happy', actions: [{ kind: 'edit', product_id: pid('שוקו'), fields: { owner: 'מיכל' } }] });
    await say(yoavi, 'השוקו של מיכל');
    assert.equal(ownerOf('שוקו'), 1);
  });

  // ---------- מ4: answers by who asks ----------
  await check('S9-09', 'הגיבוי של "נגמר החלב" אצל מיכל: "חלב סויה" ראשון; אצל אבי, הסדר של הקטלוג', async () => {
    fresh(); sql("UPDATE products SET owner = 2, category_id = NULL WHERE name = 'חלב סויה'");
    if (!pid('חלב 3%')) sql("INSERT INTO products (name, count_type, qty, created, updated) VALUES ('חלב 3%', 'units', 1, 1, 1)");
    const op = () => ({ reply: 'לסמן?', face: 'sad', actions: [{ kind: 'op', product_id: pid('חלב 3%'), op: { type: 'out' } }] });
    answer = op; assert.deepEqual((await say(michal, 'נגמר החלב')).options, ['חלב סויה', 'חלב 3%']);
    answer = op; assert.deepEqual((await say(avi, 'נגמר החלב')).options, ['חלב 3%', 'חלב סויה']);
  });
  await check('S9-09א', 'המודל המדומה מחזיר options ["חלב 3%", "חלב סויה"] למיכל, והשרת מחזיר ["חלב סויה", "חלב 3%"]; options אחרים לא זזים', async () => {
    fresh(); answer = () => ({ reply: 'איזה חלב?', face: 'confused', options: ['חלב 3%', 'חלב סויה'] });
    assert.deepEqual((await say(michal, 'יש חלב?')).options, ['חלב סויה', 'חלב 3%']);
    answer = () => ({ reply: 'מה להוסיף?', face: 'happy', options: ['חלב 3%', 'עגבניות'] });
    assert.deepEqual((await say(michal, 'מה להוסיף?')).options, ['חלב 3%', 'עגבניות']);
  });
  await check('S9-10', 'שתי השורות ב-system[0], ו"של מיכל" בקטלוג', async () => {
    fresh(); answer = () => ({ reply: 'כן.', face: 'happy' });
    await say(avi, 'יש חלב?');
    const sys = requests.at(-1).system;
    assert.match(sys[0].text, /"אין חלב רגיל\. יש את חלב הסויה של דנה\."/); // q006 in the owner's words (no name of a real house in the instructions, H3)
    assert.match(sys[0].text, /"האם הכוונה לדברים שלך, או לכל הבית\?"/);
    assert.ok(sys.slice(1).some((x) => /\|חלב סויה\|[^\n]*של מיכל/.test(x.text)), 'the catalog');
  });

  // ---------- מ6: a product of one person ----------
  await check('S9-11', 'מוצר של מיכל, קבוע, בלי אירוע 61 יום: "תודה" של מיכל מקבל את השאלה, פעם אחת; "תוריד מהקבועים" מוריד; לאבי היא לא מגיעה', async () => {
    const old = Date.now() - 90 * 86400e3;
    sql("INSERT INTO products (name, count_type, qty, is_basic, target, owner, created, updated) VALUES ('גבינה בולגרית', 'units', 1, 1, 1, 2, ?, ?)", old, old);
    fresh(); answer = () => ({ reply: 'בכיף!', face: 'happy' });
    assert.equal((await say(avi, 'תודה')).reply, 'בכיף!', 'Avi was asked');
    const r = await say(michal, 'תודה');
    assert.equal(r.reply, 'בכיף! אגב, נראה שלא היה צריך גבינה בולגרית בחודשיים האחרונים. האם להשאיר אותה במוצרים הקבועים?');
    assert.deepEqual(r.options, ['כן, תשאיר', 'תוריד מהקבועים']);
    assert.equal((await say(michal, 'תוריד מהקבועים')).reply, 'סגור!');
    assert.equal(sql("SELECT is_basic FROM products WHERE name = 'גבינה בולגרית'")[0].is_basic, 0);
    sql("UPDATE products SET is_basic = 1 WHERE name = 'גבינה בולגרית'"); fresh();
    assert.equal((await say(michal, 'תודה')).reply, 'בכיף!', 'asked twice');
  });
  await check('S9-11א', '"כן" בכתב משאיר (השאלה היא "האם להשאיר?"), ו"לא" בכתב מוריד', async () => {
    const old = Date.now() - 90 * 86400e3;
    sql("INSERT INTO products (name, count_type, qty, is_basic, target, owner, created, updated) VALUES ('דגני כוסמין', 'units', 1, 1, 1, 2, ?, ?), ('קרקרים', 'units', 1, 1, 1, 2, ?, ?)", old, old, old, old);
    fresh(); answer = () => ({ reply: 'בכיף!', face: 'happy' });
    assert.match((await say(michal, 'תודה')).reply, /אגב, נראה שלא היה צריך דגני כוסמין בחודשיים האחרונים\. האם להשאיר אותם במוצרים הקבועים\?$/);
    assert.equal((await say(michal, 'כן')).reply, 'סגור!');
    assert.equal(sql("SELECT is_basic FROM products WHERE name = 'דגני כוסמין'")[0].is_basic, 1, 'kept');
    fresh(); assert.match((await say(michal, 'תודה')).reply, /נראה שלא היה צריך קרקרים/);
    assert.equal((await say(michal, 'לא')).reply, 'סגור!');
    assert.equal(sql("SELECT is_basic FROM products WHERE name = 'קרקרים'")[0].is_basic, 0, 'taken off');
  });
  await check('S9-12', 'תרופה של אבי שהתוקף שלה עומד לפוג: 20:00 שולח לאבי בלבד; בלי owner לכולם; פרטית לאף אחד', async () => {
    sql(`UPDATE devices SET push_sub = '{"endpoint":"http://127.0.0.1:${MOCK}/push","keys":{"p256dh":"x","auth":"y"}}', push_on = 1, digest_sent = NULL`);
    const med = sql("SELECT id FROM categories WHERE name = 'תרופות ועזרה ראשונה'")[0].id, soon = at(12, 10);
    sql("INSERT INTO products (name, count_type, qty, category_id, owner, expires, created, updated) VALUES ('אקמול', 'units', 1, ?, 1, ?, 1, 1), ('נורופן', 'units', 1, ?, NULL, ?, 1, 1), ('ויטמין B12', 'units', 1, ?, NULL, ?, 1, 1)", med, soon, med, soon, med, soon);
    sql("UPDATE products SET private_to = 2 WHERE name = 'ויטמין B12'");
    const d = (await call(avi, 'POST', '/api/__schedule', { now: at(20) })).data;
    const to = (uid) => JSON.stringify(d.digestFor?.[uid] || '');
    assert.match(to(1), /אקמול/, JSON.stringify(d).slice(0, 300)); assert.doesNotMatch(to(2), /אקמול/); assert.doesNotMatch(to(4), /אקמול/);
    for (const u of [1, 2, 4]) { assert.match(to(u), /נורופן/, `${u}`); assert.doesNotMatch(to(u), /B12/); }
    // question 36: a child's medicine goes to the grown-ups, not to the child
    sql("UPDATE products SET owner = 3 WHERE name = 'אקמול'"); sql("DELETE FROM settings WHERE key LIKE 'med_warned:%'"); sql('UPDATE devices SET digest_sent = NULL');
    const d2 = (await call(avi, 'POST', '/api/__schedule', { now: at(20) })).data;
    const to2 = (uid) => JSON.stringify(d2.digestFor?.[uid] || '');
    for (const u of [1, 2, 4]) assert.match(to2(u), /אקמול/, `${u}: ${to2(u)}`);
    assert.doesNotMatch(to2(3), /אקמול/);
  });
  await check('S9-13', 'routine פרטית על מוצר משותף, ושלוש קניות שבועיות של הבית: scanPatterns כותב weekly', async () => {
    sql("INSERT INTO products (name, count_type, qty, created, updated) VALUES ('חלה', 'units', 1, 1, 1)");
    sql("INSERT INTO routines (product_id, text, weekday, store, added_by, private_to, added) VALUES (?, 'חלה', 5, 'super', 2, 2, 1)", pid('חלה'));
    for (const w of [1, 2, 3]) { const e = sql("INSERT INTO events (ts, user_id, type, summary) VALUES (?, 1, 'op', 'x')", at(10, -7 * w)).lastInsertRowid; sql("INSERT INTO product_log (event_id, ts, product_id, kind) VALUES (?, ?, ?, 'purchase')", e, at(10, -7 * w), pid('חלה')); }
    await morning();
    assert.equal(sql("SELECT COUNT(*) AS n FROM noticed WHERE key = ?", `weekly:${pid('חלה')}`)[0].n, 1);
  });
  await check('S9-08א', 'create של ילד עם "שלי" בתור סוד (private) עובר למבוגרים לא פרטי: אחרי האישור owner = 3, ולא פרטי של מי שאישר', async () => {
    fresh(); answer = () => ({ reply: 'סגור!', face: 'happy', personal: true, actions: [{ kind: 'create', private: true, product: { name: 'מסטיק', count_type: 'units', qty: 1, owner: 'יואבי' } }] });
    const r = await say(yoavi, 'אל תספרו לאף אחד, המסטיק הזה שלי');
    assert.match(r.reply, /ביקשתי מההורים לאשר שהמסטיק יהיה שלך\./);
    const card = JSON.parse(sql("SELECT content FROM chat WHERE role = 'shuki' AND content LIKE '%notFor%' ORDER BY id DESC LIMIT 1")[0].content);
    assert.equal((await call(avi, 'POST', `/api/proposals/${card.proposal.id}/apply`, {})).status, 200);
    const row = sql("SELECT owner, private_to FROM products WHERE name = 'מסטיק'")[0];
    assert.deepEqual([row?.owner, row?.private_to], [3, null], JSON.stringify(row));
  });

  // ---------- מ8: a substitute for each person ----------
  const cardOut = async (t, name) => {
    fresh(); answer = () => ({ reply: 'לסמן?', face: 'sad', actions: [{ kind: 'op', product_id: pid(name), op: { type: 'out' } }] });
    const r = await say(t, `נגמר ה${name}`);
    assert.ok(r.proposal, JSON.stringify(r).slice(0, 200));
    return (await call(t, 'POST', `/api/proposals/${r.proposal.id}/apply`, {})).data;
  };
  const lastFor = (uid) => JSON.parse(sql("SELECT content FROM chat WHERE role = 'shuki' AND content LIKE ? ORDER BY ts DESC, id DESC LIMIT 1", `%"to":[${uid}]%`)[0]?.content || '{}');
  await check('S9-14', 'אבי מסמן שחלב 3% נגמר, ויש חלב שקדים משותף: כרטיס; אחרי "כן" בכרטיס, השאלה; "כן, מחליף" כותב את העובדה, והיומן "אבי לימד אותי שאצלו…"', async () => {
    sql("UPDATE products SET qty = 2, owner = NULL WHERE name = 'חלב 3%'");
    sql("INSERT INTO products (name, count_type, qty, created, updated) VALUES ('חלב שקדים', 'units', 2, 1, 1)");
    await cardOut(avi, 'חלב 3%');
    const q = lastFor(1);
    assert.equal(q.reply, 'האם חלב השקדים מחליף אצלך חלב 3%?'); assert.deepEqual(q.options, ['כן, מחליף', 'לא מחליף']);
    assert.equal((await say(avi, 'כן, מחליף')).reply, 'סגור, אזכור!');
    const f = sql("SELECT value FROM facts WHERE key = 'substitute' AND about_id = 1")[0];
    assert.ok(f && JSON.parse(f.value).to.name === 'חלב שקדים', JSON.stringify(f));
    assert.ok(sql("SELECT summary FROM events WHERE type = 'lesson' ORDER BY ts DESC LIMIT 1")[0].summary === 'אבי לימד אותי שאצלו חלב שקדים מחליף חלב 3%.') // the line approved 15/10;
  });
  await check('S9-14א', 'פעם שנייה ש-X נגמר: בלי שאלה (וגם בלי העובדה: הסימן)', async () => {
    sql("DELETE FROM facts WHERE key = 'substitute'"); sql("UPDATE products SET qty = 2 WHERE name = 'חלב 3%'");
    const asked = () => sql("SELECT COUNT(*) AS n FROM chat WHERE content LIKE '%מחליף אצלך%'")[0].n;
    const n = asked();
    await cardOut(avi, 'חלב 3%');
    assert.equal(asked(), n, 'asked again');
  });
  await check('S9-15', 'כשהמוצר האחר הוא של מיכל (owner = 2), נועם לא נשאל; ומיכל, על החלב שלה, כן', async () => {
    sql("UPDATE products SET owner = 2, qty = 2 WHERE name = 'חלב שקדים'"); sql("UPDATE products SET qty = 2 WHERE name = 'חלב 3%'"); sql("UPDATE products SET qty = 0 WHERE name = 'חלב סויה'"); // only the almond milk is at home
    await cardOut(noam, 'חלב 3%');
    assert.doesNotMatch(lastFor(4).reply || '', /מחליף/);
    sql("UPDATE products SET qty = 2 WHERE name = 'חלב 3%'");
    await cardOut(michal, 'חלב 3%');
    assert.equal(lastFor(2).reply, 'האם חלב השקדים מחליף אצלך חלב 3%?');
    await say(michal, 'לא מחליף');
    sql("UPDATE products SET owner = NULL WHERE name = 'חלב שקדים'");
  });
  await check('S9-16', 'השורה של q039 ב-system[0]', async () => {
    fresh(); answer = () => ({ reply: 'כן.', face: 'happy' }); await say(avi, 'יש חלב?');
    assert.match(requests.at(-1).system[0].text, /כשמ-X עצמו אין: "אין את החלב שאתה שותה, אבל יש חלב שקדים\."/);
  });

  // ---------- מ9, מ10, מ36: lines in the instructions; the hour in "פעולות אחרונות" ----------
  await check('S9-19..22', 'מ9 "האם כל סוג פסטה מתאים?", מ10 "האם להשאיר את חלב השקדים ברשימה?", מ36 "קניתי X" תמיד קנייה חדשה (r9z c2) ב-system[0]; "פעולות אחרונות" עם שעה בחלק 4', async () => {
    fresh(); await act(avi, [{ kind: 'op', product_id: pid('חלב 3%'), op: { type: 'purchase', amount: 1 } }]);
    answer = () => ({ reply: 'כן.', face: 'happy' }); await say(michal, 'קניתי חלב');
    const sys = requests.at(-1).system;
    assert.match(sys[0].text, /"האם כל סוג פסטה מתאים\?"/);
    assert.match(sys[0].text, /"האם להשאיר את חלב השקדים ברשימה\?"/);
    assert.match(sys[0].text, /"קניתי X" הוא קנייה חדשה, גם כשב"פעולות אחרונות" יש קנייה של X: כרטיס purchase, ואף פעם לא "כבר רשום"/);
    assert.doesNotMatch(sys[0].text, /אותה קנייה\?/); // r9z c2: no such question
    assert.match(sys[0].text, /בלי לשאול אם זו אותה קנייה/);
    const part4 = sys.map((x) => x.text).join('\n');
    assert.match(part4, /פעולות אחרונות בבית[^]*\n\d{4}-\d{2}-\d{2} \d{2}:\d{2} אבי/, part4.slice(0, 400));
  });

  // ---------- מ7: "רק אלפרו" (the behaviour; the line on the list waits for the owner, question 28) ----------
  await check('S9-17', 'edit עם only_brand: true נשמר; הכרטיס "רק אלפרו", ובביטול "גם מותג אחר"; בקטלוג "רק מותג אלפרו (בלי תחליף)"', async () => {
    fresh(); answer = () => ({ reply: 'לעדכן?', face: 'happy', actions: [{ kind: 'edit', product_id: pid('חלב סויה'), fields: { brand: 'אלפרו', only_brand: true } }] });
    let r = await say(avi, 'אנחנו קונים רק אלפרו');
    assert.match(r.proposal.lines[0].detail || '', /רק אלפרו/, JSON.stringify(r.proposal.lines));
    await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    assert.equal(sql("SELECT only_brand FROM products WHERE name = 'חלב סויה'")[0].only_brand, 1);
    answer = () => ({ reply: 'כן.', face: 'happy' }); await say(avi, 'יש חלב סויה?');
    assert.ok(requests.at(-1).system.some((x) => /\|חלב סויה\|[^\n]*רק מותג אלפרו \(בלי תחליף\)/.test(x.text)), 'the catalog');
    answer = () => ({ reply: 'לעדכן?', face: 'happy', actions: [{ kind: 'edit', product_id: pid('חלב סויה'), fields: { only_brand: false, is_basic: true } }] });
    r = await say(avi, 'גם תנובה בסדר');
    assert.match(r.proposal.lines[0].detail || '', /גם מותג אחר/);
    await call(avi, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
  });
  await check('S9-18', 'השורות של מ7 ב-system[0], ו-only_brand בכלי', async () => {
    assert.match(requests.at(-1).system[0].text, /"אנחנו קונים רק אלפרו", "רק אלפרו" על מוצר של הבית: edit עם brand ו-only_brand=true/);
    assert.match(requests.at(-1).system[0].text, /מוצר עם "רק מותג X" שאין בסופר: לא purchase של מותג אחר, והוא נשאר ברשימה/);
    assert.ok(requests.at(-1).tools[0].input_schema.properties.actions.items.properties.product.properties.only_brand);
  });

  // ---------- מ11: a period and the basics ----------
  const period = (uid, value, untilDays = 30) => { sql("DELETE FROM facts WHERE key = 'period' AND about_id = ?", uid); return sql("INSERT INTO facts (about, about_id, key, value, since, until, told_by, confirmed_by, private, source, created, updated) VALUES ('person', ?, 'period', ?, ?, ?, ?, ?, 0, 'chat', ?, ?)", uid, value, Date.now() - 86400e3, untilDays == null ? null : Date.now() + untilDays * 86400e3, uid, uid, Date.now(), Date.now()).lastInsertRowid; };
  const linksOf = (id) => JSON.parse(sql('SELECT links FROM facts WHERE id = ?', id)[0]?.links || '[]');
  const editCard = async (t, text, edit) => { fresh(); answer = () => ({ reply: 'לעדכן?', face: 'happy', actions: [edit] }); const r = await say(t, text); return (await call(t, 'POST', `/api/proposals/${r.proposal.id}/apply`, {})).status; };
  await check('S9-23', 'אבי עם period קיטו עד בעוד חודש: edit של לחם, is_basic: false, for_period: true; ב-links { change: basic_off, from: 1, to: 0 }; target מ-2 ל-1', async () => {
    sql("INSERT INTO products (name, count_type, qty, is_basic, target, created, updated) VALUES ('לחם', 'units', 1, 1, 2, 1, 1), ('קולה', 'units', 2, 1, 2, 1, 1)");
    const f = period(1, 'קיטו');
    assert.equal(await editCard(avi, 'בלי לחם בקיטו', { kind: 'edit', product_id: pid('לחם'), for_period: true, fields: { is_basic: false } }), 200);
    assert.deepEqual(linksOf(f), [{ product_id: pid('לחם'), change: 'basic_off', from: 1, to: 0 }]);
    await editCard(avi, 'פחות קולה בקיטו', { kind: 'edit', product_id: pid('קולה'), for_period: true, fields: { target: 1 } });
    assert.deepEqual(linksOf(f).find((l) => l.change === 'target'), { product_id: pid('קולה'), change: 'target', from: 2, to: 1 });
  });
  await check('S9-24', 'period חדש מחליף את הקיטו, וה-links עוברים', async () => {
    const before = sql("SELECT links FROM facts WHERE key = 'period' AND about_id = 1")[0].links;
    fresh(); answer = () => ({ reply: 'לשמור?', face: 'happy', actions: [{ kind: 'fact', key: 'period', about: 'אבי', value: 'פליאו', text: 'אבי בפליאו', until: '2026-12-31' }] });
    await say(avi, 'עברתי לפליאו'); await say(avi, 'כן');
    const row = sql("SELECT value, links FROM facts WHERE key = 'period' AND about_id = 1 AND ended IS NULL")[0];
    // the same links, each with when its change began (the old period's since): the window learn() skips starts there
    const since = sql("SELECT since FROM facts WHERE key = 'period' AND about_id = 1 AND value = 'פליאו'")[0];
    assert.equal(row?.value, 'פליאו', JSON.stringify(row));
    const strip = (x) => JSON.parse(x).map(({ since: _s, ...l }) => l);
    assert.deepEqual(strip(row.links), strip(before)); assert.ok(JSON.parse(row.links).every((l) => l.since != null && l.since < since.since + 1), row.links);
  });
  await check('S9-25', 'edit עם for_period בלי תקופה: העריכה נעשית, ואין links', async () => {
    sql("DELETE FROM facts WHERE key = 'period'"); sql("UPDATE products SET is_basic = 1 WHERE name = 'לחם'");
    assert.equal(await editCard(michal, 'בלי לחם', { kind: 'edit', product_id: pid('לחם'), for_period: true, fields: { is_basic: false } }), 200);
    assert.equal(sql("SELECT is_basic FROM products WHERE name = 'לחם'")[0].is_basic, 0);
    assert.equal(sql("SELECT COUNT(*) AS n FROM facts WHERE links IS NOT NULL AND about_id = 2")[0].n, 0);
  });
  await check('S9-25א', 'בתור סוד: אין links', async () => {
    const f = period(2, 'דיאטה'); sql("UPDATE products SET is_basic = 1 WHERE name = 'לחם'");
    fresh(); answer = () => ({ reply: 'לעדכן?', face: 'happy', personal: true, actions: [{ kind: 'edit', product_id: pid('לחם'), for_period: true, fields: { is_basic: false } }] });
    const r = await say(michal, 'בינינו, אני בדיאטה ובלי לחם');
    if (r.proposal) await call(michal, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    assert.deepEqual(linksOf(f), []);
  });
  await check('S9-25ב', 'השורות של מ11 ב-system[0], ו-for_period בכלי', async () => {
    const sys = requests.at(-1).system[0].text;
    assert.match(sys, /"האם לשנות משהו במוצרים הקבועים בתקופה הזו\?"/); assert.match(sys, /"דנה עדיין אוכלת לחם\. האם להוריד את הכמות לכיכר אחת\?"/);
    assert.ok(requests.at(-1).tools[0].input_schema.properties.actions.items.properties.for_period);
  });

  // ---------- מ12: a period's end ----------
  const endCard = async (t, uid) => {
    fresh(); answer = () => ({ reply: 'לשכוח?', face: 'happy', actions: [{ kind: 'fact_end', key: 'period', about: uid === 1 ? 'אבי' : 'מיכל' }] });
    const r = await say(t, 'כבר לא');
    assert.ok(r.proposal, JSON.stringify(r).slice(0, 300));
    assert.equal((await call(t, 'POST', `/api/proposals/${r.proposal.id}/apply`, {})).status, 200);
    return JSON.parse(sql("SELECT content FROM chat WHERE role = 'shuki' AND content LIKE '%סגור, שכחתי.%' ORDER BY id DESC LIMIT 1")[0].content);
  };
  const withLinks = (uid, links) => { const id = period(uid, 'קיטו'); sql('UPDATE facts SET links = ? WHERE id = ?', JSON.stringify(links), id); return id; };
  await check('S9-26', 'התקופה עם links של הלחם, "כבר לא": בתשובה "סגור, שכחתי." והשאלה, וכרטיס; אישור מחזיר is_basic = 1', async () => {
    sql("UPDATE products SET is_basic = 0 WHERE name = 'לחם'"); sql("DELETE FROM settings WHERE key = 'pace_skip'");
    withLinks(1, [{ product_id: pid('לחם'), change: 'basic_off', from: 1, to: 0 }]);
    const b = await endCard(avi, 1);
    assert.equal(b.reply, 'סגור, שכחתי. האם להחזיר את הלחם למוצרים הקבועים?');
    assert.ok(b.proposal?.lines?.length === 1, JSON.stringify(b.proposal));
    assert.equal((await call(avi, 'POST', `/api/proposals/${b.proposal.id}/apply`, {})).status, 200);
    assert.equal(sql("SELECT is_basic FROM products WHERE name = 'לחם'")[0].is_basic, 1);
  });
  await check('S9-27', 'שני שינויים (לחם וקולה): כרטיס אחד, שתי שורות, ונוסח הרבים; כמות: "…ל-2 …"', async () => {
    sql("UPDATE products SET is_basic = 0 WHERE name = 'לחם'"); sql("UPDATE products SET target = 1 WHERE name = 'קולה'");
    withLinks(1, [{ product_id: pid('לחם'), change: 'basic_off', from: 1, to: 0 }, { product_id: pid('קולה'), change: 'target', from: 2, to: 1 }]);
    const b = await endCard(avi, 1);
    assert.equal(b.reply, 'סגור, שכחתי. האם להחזיר את מה שהשתנה בתקופה הזו?'); assert.equal(b.proposal.lines.length, 2);
    await call(avi, 'POST', `/api/proposals/${b.proposal.id}/reject`, {});
    sql("UPDATE products SET target = 1 WHERE name = 'קולה'");
    withLinks(1, [{ product_id: pid('קולה'), change: 'target', from: 2, to: 1 }]);
    assert.match((await endCard(avi, 1)).reply, /^סגור, שכחתי\. האם להחזיר את הכמות של הקולה ל-2[^?]*\?$/);
  });
  await check('S9-28', 'בלי links: רק "סגור, שכחתי."; מוצר שכבר הוחזר יוצא מהכרטיס', async () => {
    period(1, 'קיטו');
    assert.equal((await endCard(avi, 1)).reply, 'סגור, שכחתי.');
    sql("UPDATE products SET is_basic = 1 WHERE name = 'לחם'");
    withLinks(1, [{ product_id: pid('לחם'), change: 'basic_off', from: 1, to: 0 }]);
    const b = await endCard(avi, 1); assert.equal(b.reply, 'סגור, שכחתי.'); assert.equal(b.proposal, undefined);
  });
  await check('S9-26א', '"לא" בכתב לשאלה "האם אתה עדיין בקיטו?": אותו כרטיס', async () => {
    sql("UPDATE products SET is_basic = 0 WHERE name = 'לחם'");
    const f = withLinks(1, [{ product_id: pid('לחם'), change: 'basic_off', from: 1, to: 0 }]);
    sql('UPDATE facts SET ask_again = ? WHERE id = ?', Date.now() - 60e3, f);
    fresh(); answer = () => ({ reply: 'בכיף!', face: 'happy' });
    assert.match((await say(avi, 'תודה')).reply, /עדיין בקיטו\?/);
    const r = await say(avi, 'לא');
    assert.equal(r.reply, 'סגור, שכחתי. האם להחזיר את הלחם למוצרים הקבועים?'); assert.ok(r.proposal?.id, JSON.stringify(r).slice(0, 200));
  });
  await check('S9-26ב', 'הכפתור "כבר לא" לשאלה "האם אתה עדיין בקיטו?": אותו כרטיס (הסוקר של 18cf749)', async () => {
    sql("UPDATE products SET is_basic = 0 WHERE name = 'לחם'");
    const f = withLinks(1, [{ product_id: pid('לחם'), change: 'basic_off', from: 1, to: 0 }]);
    sql('UPDATE facts SET ask_again = ? WHERE id = ?', Date.now() - 60e3, f);
    fresh(); answer = () => ({ reply: 'בכיף!', face: 'happy' });
    assert.match((await say(avi, 'תודה')).reply, /עדיין בקיטו\?/);
    const r = await say(avi, 'כבר לא');
    assert.equal(r.reply, 'סגור, שכחתי. האם להחזיר את הלחם למוצרים הקבועים?'); assert.ok(r.proposal?.id, JSON.stringify(r).slice(0, 200));
    const row = JSON.parse(sql("SELECT content FROM chat WHERE role = 'shuki' ORDER BY id DESC LIMIT 1")[0].content);
    assert.equal(row.proposal?.id, r.proposal.id, 'the card is in the chat');
  });
  await check('S9-29', 'pace_skip נכתב: מוצר ותאריכים בלבד, בלי ערך ובלי מספר משתמש', async () => {
    const w = JSON.parse(sql("SELECT value FROM settings WHERE key = 'pace_skip'")[0]?.value || '[]');
    assert.ok(w.length && w.every((x) => Object.keys(x).sort().join() === 'from,product_id,to'), JSON.stringify(w));
    assert.doesNotMatch(JSON.stringify(w), /קיטו/);
  });

  // ---------- מ13: vegan for good ----------
  const veganSay = async (t, name, extra = {}) => { fresh(); answer = () => ({ reply: 'לשמור?', face: 'happy', actions: [{ kind: 'fact', key: 'diet', about: name, value: 'טבעונית', text: `${name} טבעונית`, ...extra }] }); await say(t, 'אני טבעונית מעכשיו'); return say(t, 'כן'); };
  const veganBubble = () => JSON.parse(sql("SELECT content FROM chat WHERE role = 'shuki' AND content LIKE '%מן החי%' ORDER BY id DESC LIMIT 1")[0]?.content || '{}');
  await check('S9-30', 'מיכל טבעונית, וכל שאר בני הבית טבעונים (גם הילד, שאלה 37): כרטיס עם החלב והביצים (של הבית); חלב הסויה לא בו', async () => {
    sql("INSERT INTO products (name, count_type, qty, is_basic, target, created, updated) VALUES ('ביצים L', 'units', 6, 1, 6, 1, 1)");
    sql("UPDATE products SET is_basic = 1, owner = NULL WHERE name IN ('חלב 3%', 'חלב סויה')"); sql("DELETE FROM facts WHERE key = 'diet'");
    for (const u of [1, 4]) sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', ?, 'diet', 'טבעוני', 1, ?, ?, 0, 'chat', 1, 1)", u, u, u);
    await veganSay(michal, 'מיכל');
    assert.doesNotMatch((veganBubble().proposal?.lines || []).map((l) => l.text).join(' | '), /חלב 3%/, 'the house\'s milk off the basics, with Yoavi who eats it'); // question 37
    sql("DELETE FROM settings WHERE key = 'ask_once:vegan:2'"); sql("DELETE FROM facts WHERE key = 'diet' AND about_id = 2");
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 3, 'diet', 'טבעוני', 1, 1, 1, 0, 'chat', 1, 1)");
    await veganSay(michal, 'מיכל');
    const b = veganBubble(); const lines = (b.proposal?.lines || []).map((l) => l.text).join(' | ');
    assert.equal(b.reply, 'האם להוריד מהמוצרים הקבועים את מה שמן החי?');
    assert.match(lines, /חלב 3%/); assert.match(lines, /ביצים L/); assert.doesNotMatch(lines, /סויה/);
  });
  await check('S9-31', 'בבית עם אבי (לא טבעוני): רק מה ששלה; בלי מוצרים שלה: אין כרטיס', async () => {
    sql("DELETE FROM facts WHERE key = 'diet'"); sql("DELETE FROM settings WHERE key = 'ask_once:vegan:2'"); sql("DELETE FROM chat WHERE content LIKE '%מן החי%'");
    sql('UPDATE products SET owner = NULL WHERE owner = 2'); // nothing of hers (her bulgarian cheese from S9-11 is from an animal)
    await veganSay(michal, 'מיכל'); assert.equal(veganBubble().reply, undefined, 'a card with nothing of hers');
    sql("DELETE FROM facts WHERE key = 'diet'"); sql("DELETE FROM settings WHERE key = 'ask_once:vegan:2'");
    sql("UPDATE products SET owner = 2 WHERE name = 'ביצים L'");
    await veganSay(michal, 'מיכל');
    const lines = (veganBubble().proposal?.lines || []).map((l) => l.text).join(' | ');
    assert.match(lines, /ביצים L/); assert.doesNotMatch(lines, /חלב 3%/);
  });
  await check('S9-32', 'פעם שנייה: אין כרטיס; diet עם until: אין כרטיס', async () => {
    const n = sql("SELECT COUNT(*) AS n FROM chat WHERE content LIKE '%מן החי%'")[0].n;
    sql("DELETE FROM facts WHERE key = 'diet'"); await veganSay(michal, 'מיכל');
    sql("DELETE FROM settings WHERE key = 'ask_once:vegan:2'"); sql("DELETE FROM facts WHERE key = 'diet'");
    await veganSay(michal, 'מיכל', { until: '2026-12-31' });
    assert.equal(sql("SELECT COUNT(*) AS n FROM chat WHERE content LIKE '%מן החי%'")[0].n, n);
  });

  // ---------- מ14: Passover is over ----------
  const nisan = (day) => { for (let ts = Date.UTC(2027, 2, 15, 4, 5); ts < Date.UTC(2027, 5, 1); ts += 86400e3) { const p = Object.fromEntries(new Intl.DateTimeFormat('en-u-ca-hebrew', { month: 'long', day: 'numeric', timeZone: 'Asia/Jerusalem' }).formatToParts(ts).map((x) => [x.type, x.value])); if (p.month === 'Nisan' && Number(p.day) === day) return ts; } };
  // the card as it is in real life: in the past (the morning, before the message), the last thing Shuki said; answered by
  // the next message (answerServerCard), so its buttons are read before that (the reviewer of 38d12ae)
  const pastCard = () => { sql("DELETE FROM chat WHERE ts > ? AND json_extract(content, '$.offer') IS NOT 'pesach_end'", Date.now()); // the scheduled runs' rows, in 2027
    sql("UPDATE chat SET ts = ?, content = json_remove(content, '$.answered') WHERE json_extract(content, '$.offer') = 'pesach_end'", Date.now() - 1); };
  const pesachCard = () => sql("SELECT id, content FROM chat WHERE json_extract(content, '$.offer') = 'pesach_end' ORDER BY id DESC LIMIT 1")[0];
  await check('S9-33', 'מצב פסח דולק, הבוקר של כ״ב ניסן: כרטיס לבית; "כן, תכבה" מכבה, והחמץ הקבוע שנגמר חוזר לרשימה', async () => {
    fresh(); await call(avi, 'POST', '/api/settings', { pesach: true }); fresh();
    sql("UPDATE products SET qty = 0, is_basic = 1, chametz = 1 WHERE name = 'לחם'"); sql("DELETE FROM list_items WHERE product_id = ?", pid('לחם'));
    sql("DELETE FROM chat WHERE json_extract(content, '$.card') = 1");
    await call(avi, 'POST', '/api/__schedule', { now: nisan(22) });
    const c = pesachCard(); assert.ok(c, 'no card'); const cc = JSON.parse(c.content);
    assert.equal(cc.reply, 'פסח נגמר. האם לכבות את מצב הפסח?'); assert.deepEqual(cc.options, ['כן, תכבה', 'עוד לא']);
    await call(avi, 'POST', '/api/__schedule', { now: nisan(22) + 86400e3 });
    assert.equal(sql("SELECT COUNT(*) AS n FROM chat WHERE json_extract(content, '$.offer') = 'pesach_end'")[0].n, 1, 'a second card');
    pastCard();
    // "עוד לא" typed by Avi after another answer of Shuki's isn't the card's (the reviewer of 38d12ae)
    answer = () => ({ reply: 'בכיף!', face: 'happy' }); fresh(); await say(avi, 'תודה');
    await say(avi, 'עוד לא'); assert.equal(sql("SELECT value FROM settings WHERE key = 'pesach'")[0].value, '1');
    pastCard(); fresh();
    const r = await say(michal, 'כן, תכבה');
    assert.match(r.reply, /^סגור!/);
    assert.equal(sql("SELECT value FROM settings WHERE key = 'pesach'")[0].value, '0');
    assert.ok(sql("SELECT 1 FROM list_items WHERE product_id = ? AND status = 'open'", pid('לחם')).length, 'the bread is back on the list');
  });
  await check('S9-34', 'מצות במלאי: אחרי הכיבוי, "נשארו מפסח: …. מה לעשות איתם?"; "תוריד מהמלאי" זורק', async () => {
    fresh(); await call(avi, 'POST', '/api/settings', { pesach: true }); fresh();
    sql("INSERT INTO products (name, count_type, qty, created, updated) VALUES ('מצות', 'units', 2, 1, 1), ('קמח מצה', 'units', 1, 1, 1)");
    sql("DELETE FROM settings WHERE key LIKE 'pesach_end:%'"); sql("DELETE FROM chat WHERE json_extract(content, '$.card') = 1");
    await call(avi, 'POST', '/api/__schedule', { now: nisan(22) }); pastCard();
    const r = await say(avi, 'כן, תכבה');
    assert.equal(r.reply, 'סגור! נשארו מפסח: מצות וקמח מצה. מה לעשות איתם?'); assert.deepEqual(r.options, ['תשאיר במלאי', 'תוריד מהמלאי']);
    await say(avi, 'תוריד מהמלאי');
    assert.equal(sql("SELECT qty FROM products WHERE name = 'מצות'")[0].qty, 0);
  });
  await check('S9-35', 'פסח כבוי: אין כרטיס; כרטיס אחר למעלה: מחכה', async () => {
    sql("DELETE FROM settings WHERE key LIKE 'pesach_end:%'"); sql("DELETE FROM chat WHERE json_extract(content, '$.card') = 1");
    await call(avi, 'POST', '/api/__schedule', { now: nisan(22) });
    assert.equal(pesachCard(), undefined, 'a card with the mode off');
    fresh(); await call(avi, 'POST', '/api/settings', { pesach: true }); fresh();
    sql("INSERT INTO chat (ts, user_id, role, content) VALUES (?, NULL, 'shuki', ?)", nisan(22) - 3600e3, JSON.stringify({ reply: 'כרטיס אחר', card: 1 }));
    await call(avi, 'POST', '/api/__schedule', { now: nisan(22) });
    assert.equal(pesachCard(), undefined, 'over another card');
    await call(avi, 'POST', '/api/settings', { pesach: false });
  });

  // ---------- מ16: a baby ----------
  await check('I40', 'מ16: אחרי "אני בהריון" ושאלת האוכל (ו5) ואחרי "לספר לבית?": "האם יש מוצרים שתרצי שיהיו תמיד בבית בתקופה הזו?", פעם אחת', async () => {
    sql("DELETE FROM facts WHERE key = 'pregnancy'"); sql('DELETE FROM noticed'); // what Shuki noticed is asked first (decision 121)
    fresh(); answer = () => ({ reply: 'לשמור?', face: 'happy', actions: [{ kind: 'fact', key: 'pregnancy', about: 'מיכל', value: 'בהריון', text: 'מיכל בהריון' }] });
    assert.match((await say(michal, 'אני בהריון')).reply, /^מזל טוב! האם לשים לב לאוכל שלך בהריון\?/);
    await say(michal, 'כן, תשים לב');
    answer = () => ({ reply: 'בכיף!', face: 'happy' });
    let r; const seen = [];
    for (let i = 0; i < 3; i++) { // her pregnancy is private: "לספר לבית?" (r9-79) comes first, on its own day
      fresh(); r = await say(michal, 'תודה'); seen.push(r.reply);
      if (/לספר לשאר הבית/.test(r.reply)) await say(michal, 'רק בינינו'); else break;
    }
    assert.ok(seen.some((x) => /לספר לשאר הבית/.test(x)), JSON.stringify(seen));
    assert.equal(r.reply, 'בכיף! האם יש מוצרים שתרצי שיהיו תמיד בבית בתקופה הזו?');
    fresh(); assert.doesNotMatch((await say(michal, 'תודה')).reply, /תמיד בבית בתקופה הזו/, 'asked twice'); // the day's question is another's now
  });
  await check('I41', 'מ16: השורה של הלידה ושל התמ"ל ב-system[0]', async () => {
    assert.ok(requests.at(-1).system[0].text.includes('אם זו לידה: "מזל טוב!", fact_end של pregnancy עם reason "birth", ו"מה התינוק צריך שיהיה תמיד בבית?".'));
    assert.ok(requests.at(-1).system[0].text.includes('תמ"ל (מטרנה, סימילאק): target של 2 לפחות.'));
  });
  await check('I41א', 'מ16: "התינוק נולד!": העובדה נגמרת בלי כרטיס, baby_born:2 נכתב, והשאלה נשארת', async () => {
    fresh(); answer = () => ({ reply: 'מזל טוב! מה התינוק צריך שיהיה תמיד בבית?', face: 'excited', actions: [{ kind: 'fact_end', key: 'pregnancy', about: 'מיכל', reason: 'birth', text: 'מיכל בהריון' }] });
    const r = await say(michal, 'התינוק נולד!');
    assert.equal(r.reply, 'מזל טוב! מה התינוק צריך שיהיה תמיד בבית?'); assert.equal(r.proposal, undefined);
    assert.equal(sql("SELECT COUNT(*) AS n FROM facts WHERE key = 'pregnancy' AND about_id = 2")[0].n, 0);
    assert.ok(Number(sql("SELECT value FROM settings WHERE key = 'baby_born:2'")[0]?.value) > 0, 'no baby_born');
    const st = await state(avi); assert.ok(!Object.keys(st.settings || {}).some((k) => k.startsWith('baby_born')), 'in the state');
  });
  await check('I43', 'מ16: שבועיים אחרי הלידה: השאלה, לה; "כן, תתעלם" כותב nolearn, שלא מגיע לחופשה במצב', async () => {
    const born = Date.now() - 15 * 86400e3; sql("UPDATE settings SET value = ? WHERE key = 'baby_born:2'", String(born));
    answer = () => ({ reply: 'בכיף!', face: 'happy' });
    fresh(); const r = await say(michal, 'תודה');
    assert.equal(r.reply, 'בכיף! האם להתעלם מהשבועיים שאחרי הלידה כשאני לומד כל כמה זמן דברים נגמרים?'); assert.deepEqual(r.options, ['כן, תתעלם', 'לא צריך']);
    assert.match((await say(michal, 'כן, תתעלם')).reply, /^סגור!/);
    const w = sql("SELECT * FROM away WHERE kind = 'nolearn'")[0];
    assert.ok(w && w.start === born && w.end === born + 14 * 86400e3 && w.set_by == null, JSON.stringify(w));
    const st = await state(michal); assert.equal(st.away, null, JSON.stringify(st.away));
    fresh(); assert.equal((await say(michal, 'תודה')).reply, 'בכיף!', 'asked twice');
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'learnask:%'")[0].n, 0, 'the day\'s one question taken'); // asked already (the reviewer of 87a7259)
  });
  await check('I44', 'מ16: המוצר הראשון בקטגוריה "תינוק": "האם להוסיף את חדר התינוק למקומות האחסון?"; "כן, תוסיף" מוסיף; פעם שנייה: אין שאלה', async () => {
    sql("INSERT INTO products (name, count_type, qty, category_id, created, updated) VALUES ('חיתולים', 'units', 1, (SELECT id FROM categories WHERE name = 'תינוק'), 1, 1)");
    answer = () => ({ reply: 'בכיף!', face: 'happy' });
    fresh(); const r = await say(avi, 'תודה');
    assert.equal(r.reply, 'בכיף! האם להוסיף את חדר התינוק למקומות האחסון?'); assert.deepEqual(r.options, ['כן, תוסיף', 'לא צריך']);
    await say(avi, 'כן, תוסיף');
    assert.equal(sql("SELECT COUNT(*) AS n FROM locations WHERE name = 'חדר התינוק'")[0].n, 1);
    sql("DELETE FROM locations WHERE name = 'חדר התינוק'");
    fresh(); assert.equal((await say(michal, 'תודה')).reply, 'בכיף!', 'asked twice');
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'learnask:2:%'")[0].n, 0, 'the day\'s one question taken'); // asked already (the reviewer of 87a7259)
  });

  // ---------- מ17: meat, dairy or parve ----------
  const kinds = () => Object.fromEntries(sql('SELECT name, kosher_kind FROM products WHERE deleted IS NULL').map((r) => [r.name, r.kosher_kind]));
  const catId = (n) => sql('SELECT id FROM categories WHERE name = ?', n)[0].id;
  const kosherTool = () => requests.at(-1).tools[0].input_schema.properties.actions.items.properties.product.properties.kosher_kind;
  await check('I46', 'מ17: בית לא כשר: אין מילוי, אין בכלי, ואין בקטלוג', async () => {
    sql("DELETE FROM settings WHERE key IN ('house_notes', 'kosher_filled')");
    sql("INSERT INTO products (name, count_type, qty, category_id, created, updated) VALUES ('חזה עוף', 'units', 1, ?, 5, 5)", catId('בשר, עוף ודגים'));
    await call(avi, 'POST', '/api/__schedule', { now: at(7) });
    assert.equal(kinds()['חזה עוף'], null);
    fresh(); answer = () => ({ reply: 'בכיף!', face: 'happy' }); await say(avi, 'תודה');
    assert.equal(kosherTool(), undefined); assert.doesNotMatch(prompt(), /\|בשרי/);
  });
  await check('I45', 'מ17: בית כשר עם 12 מוצרים: ריצת הבוקר ממלאת; "עוגת שמרים" נשארת ריקה; בכלי ובקטלוג', async () => {
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('house_notes', 'הבית כשר')");
    for (const [n, c] of [['חלב 3% כשר', 'מוצרי חלב, גבינות וביצים'], ['חלב סויה כשר', 'מוצרי חלב, גבינות וביצים'], ['עגבניות', 'ירקות ופירות'], ['עוגת שמרים', 'לחם ומאפים'],
      ['קמח', 'יבשים'], ['רסק עגבניות', 'שימורים ורטבים'], ['פפריקה', 'תבלינים ושמנים'], ['גבינה צהובה', 'מוצרי חלב, גבינות וביצים'], ['נקניקיות', 'בשר, עוף ודגים'],
      ['במבה', 'חטיפים ומתוקים'], ['מיץ תפוזים', 'משקאות']]) sql('INSERT INTO products (name, count_type, qty, category_id, created, updated) VALUES (?, \'units\', 1, ?, 5, 5)', n, catId(c));
    await call(avi, 'POST', '/api/__schedule', { now: at(7) });
    const k = kinds();
    assert.deepEqual([k['חזה עוף'], k['חלב 3% כשר'], k['חלב סויה כשר'], k['עגבניות'], k['עוגת שמרים'], k['קמח'], k['גבינה צהובה'], k['נקניקיות'], k['במבה']],
      ['meat', 'dairy', 'parve', 'parve', null, 'parve', 'dairy', 'meat', null]); // 44ב and 46: dry goods parve only by a basic word ("קמח")
    assert.equal(k['רסק עגבניות'], null); assert.equal(k['פפריקה'], 'parve');
    assert.ok(Number(sql("SELECT value FROM settings WHERE key = 'kosher_filled'")[0].value) > 0);
    // once: what was filled by hand later isn't touched, and only new ones are filled
    sql("UPDATE products SET kosher_kind = NULL WHERE name = 'עגבניות'");
    sql("INSERT INTO products (name, count_type, qty, category_id, created, updated) VALUES ('מלפפון', 'units', 1, ?, ?, ?)", catId('ירקות ופירות'), at(7) + 60e3, at(7) + 60e3); // after the last fill
    await call(avi, 'POST', '/api/__schedule', { now: at(7, 1) });
    assert.equal(kinds()['עגבניות'], null); assert.equal(kinds()['מלפפון'], 'parve');
    fresh(); await say(avi, 'תודה');
    assert.deepEqual(kosherTool()?.enum, ['meat', 'dairy', 'parve']);
    assert.match(prompt(), /חזה עוף\|[^\n]*\|בשרי/); assert.match(prompt(), /חלב סויה כשר\|[^\n]*\|פרווה/);
    assert.ok(requests.at(-1).system[0].text.includes('27א. בבית כשר, create של אוכל: kosher_kind'));
    sql("DELETE FROM settings WHERE key = 'house_notes'");
  });

  // ---------- מ18: using kosher ----------
  await check('I48', 'מ18: הקינוח הפרווה והגבינה שאינה כשרה ב-system[0]', async () => {
    fresh(); answer = () => ({ reply: 'בכיף!', face: 'happy' }); await say(avi, 'תודה');
    const sys = requests.at(-1).system[0].text;
    assert.ok(sys.includes('"האם יש משהו פרווה לקינוח?": ממה שבקטלוג מסומן פרווה. אם אין: "האם להוסיף לרשימה?", או מתכון פרווה.'));
    assert.ok(sys.includes('בבית כשר, מישהו קנה מוצר שאמר שהוא לא כשר: שאלה אחת, "האם הגבינה רק שלך?"'));
  });
  await check('I49', 'מ18: "הכנו" שניצל, ושארית: kosher_kind = meat, ו"(בשרי)" בפרומפט של בית כשר; בבית לא כשר: בלי', async () => {
    sql("INSERT INTO recipes (name, ingredients, text, added_by, added) VALUES ('שניצל', 'חזה עוף, פירורי לחם, ביצה', 'מטגנים', 1, 1)");
    const rid = sql("SELECT id FROM recipes WHERE name = 'שניצל'")[0].id;
    sql("INSERT INTO recipe_ingredients (recipe_id, pos, name, line) VALUES (?, 0, 'חזה עוף', 'חזה עוף'), (?, 1, 'פירורי לחם', 'פירורי לחם')", rid, rid);
    sql('INSERT INTO cooked_log (recipe_id, ts, user_id) VALUES (?, ?, 1)', rid, Date.now() - 3600e3);
    fresh(); answer = () => ({ reply: 'סגור!', face: 'happy', actions: [{ kind: 'leftover', text: 'שניצל' }] });
    const r = await say(avi, 'נשאר שניצל');
    if (r.proposal?.id) await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    assert.equal(sql("SELECT kosher_kind FROM leftovers WHERE text = 'שניצל' ORDER BY id DESC LIMIT 1")[0]?.kosher_kind, 'meat');
    answer = () => ({ reply: 'בכיף!', face: 'happy' });
    fresh(); await say(avi, 'תודה'); assert.doesNotMatch(prompt(), /שניצל \(בשרי\)/, 'in a house that isn\'t kosher');
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('house_notes', 'הבית כשר')");
    fresh(); await say(avi, 'תודה'); assert.match(prompt(), /#\d+ שניצל \(בשרי\)/);
    sql("DELETE FROM settings WHERE key = 'house_notes'");
  });

  // ---------- מ19: who is in charge of the coffee ----------
  await check('I50', 'מ19: "אבי אחראי על הקפה" נשמר ("אחראי: אבי" בכרטיס ובקטלוג); מיכל מסמנת שנגמר: push לאבי בלבד', async () => {
    sql("INSERT INTO products (name, count_type, qty, is_basic, target, created, updated) VALUES ('קפה', 'units', 1, 1, 1, 1, 1)");
    fresh(); answer = () => ({ reply: 'לעדכן?', face: 'happy', actions: [{ kind: 'edit', product_id: pid('קפה'), fields: { responsible: 'אבי' } }] });
    const r = await say(michal, 'אבי אחראי על הקפה');
    assert.ok(r.proposal?.lines?.some((l) => /אחראי: אבי/.test(l.detail || l.text)), JSON.stringify(r.proposal?.lines));
    await call(michal, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    assert.equal(sql("SELECT responsible FROM products WHERE name = 'קפה'")[0].responsible, 1);
    answer = () => ({ reply: 'בכיף!', face: 'happy' }); fresh(); await say(avi, 'תודה');
    assert.match(prompt(), /קפה\|[^\n]*אחראי: אבי/);
    assert.ok(requests.at(-1).system[0].text.includes('"דנה אחראית על הקפה": edit responsible.'));
    const n = (await act(michal, [{ kind: 'op', product_id: pid('קפה'), op: { type: 'out' } }])).data.notify || [];
    const mine = n.filter((x) => x.title === 'נגמר הקפה');
    assert.deepEqual(mine.map((x) => [x.to, x.body]), [['אבי', 'מיכל סימנה שהקפה נגמר. הוא כבר ברשימה.']], JSON.stringify(n));
  });
  await check('I51', 'מ19: אבי מסמן בעצמו: אין push; מי שאחראי ויוצא מהבית: responsible = NULL', async () => {
    sql("UPDATE products SET qty = 1 WHERE name = 'קפה'"); sql("DELETE FROM list_items WHERE product_id = ?", pid('קפה'));
    const n = (await act(avi, [{ kind: 'op', product_id: pid('קפה'), op: { type: 'out' } }])).data.notify || [];
    assert.ok(!n.some((x) => x.title === 'נגמר הקפה'), JSON.stringify(n));
    sql("INSERT INTO users (id, name, gender, role, active, created) VALUES (5, 'דנה', 'f', 'adult', 1, 0)");
    sql("UPDATE products SET responsible = 5 WHERE name = 'קפה'");
    assert.equal((await call(avi, 'POST', '/api/members', { id: 5, remove: true })).status, 200);
    assert.equal(sql("SELECT responsible FROM products WHERE name = 'קפה'")[0].responsible, null);
  });

  await check('I49א', 'מ18/מ19 אחרי הסוקר: "נשארו שאריות" מהאפליקציה מסומנת בשרי; קפה שכבר נגמר ומסומן שוב: אין push שני', async () => {
    sql('INSERT INTO cooked_log (recipe_id, ts, user_id) VALUES ((SELECT id FROM recipes WHERE name = \'שניצל\'), ?, 1)', Date.now() - 600e3);
    assert.equal((await call(avi, 'POST', '/api/leftovers', { text: 'שניצל' })).status, 200);
    assert.equal(sql("SELECT kosher_kind FROM leftovers WHERE text = 'שניצל' ORDER BY id DESC LIMIT 1")[0]?.kosher_kind, 'meat');
    sql("UPDATE products SET responsible = 1, qty = 0 WHERE name = 'קפה'");
    const n = (await act(michal, [{ kind: 'op', product_id: pid('קפה'), op: { type: 'out' } }])).data.notify || [];
    assert.ok(!n.some((x) => x.title === 'נגמר הקפה'), JSON.stringify(n));
  });
  await check('I52', 'מ20: "אני בדרך הביתה" ב-system[0]', async () => {
    fresh(); answer = () => ({ reply: 'בכיף!', face: 'happy' }); await say(avi, 'תודה');
    assert.ok(requests.at(-1).system[0].text.includes('"אני בדרך הביתה" (בלי שאמר שהוא בחנות): שאלה אחת, "האם לקנות בדרך את כל הרשימה, או רק את מה שדחוף?", עם options ["כל הרשימה", "רק מה שדחוף"].'));
  });

  await check('I53', 'מ21: "ראיתי בסופר X" ב-system[0]', async () => {
    fresh(); answer = () => ({ reply: 'בכיף!', face: 'happy' }); await say(avi, 'תודה');
    assert.ok(requests.at(-1).system[0].text.includes('- "ראיתי בסופר X, לקנות?": אם יש בבית, כמה יש. אם אין, והוא לא ברשימה: "המוצר לא ברשימה. האם תרצה שאוסיף?"'));
  });

  await check('I54', 'מ22: המבצעים ב-system[0]', async () => {
    fresh(); answer = () => ({ reply: 'בכיף!', face: 'happy' }); await say(avi, 'תודה');
    const sys = requests.at(-1).system[0].text;
    assert.ok(sys.includes('"יש מבצע על X" (בלי שאמרו כמה קנו): "יש בבית 4 קופסאות טונה. כמה להוסיף?".'));
    assert.ok(sys.includes('"יש בבית 4 קופסאות טונה, והתוקף שלהן יפוג ב-12.11. כמה להוסיף?"'));
    assert.ok(sys.includes('מוצר שקונים רק במבצע (כלל): "האם להוסיף לרשימה, או שנחכה למבצע?".'));
  });

  await check('I55', 'מ23: בסיכום של ה-1 בחודש: שני אנשים באותו יום (גם בתוך "קניתי חלב ולחם") כן; אותו אדם, ו-23:00 מול 08:00 למחרת, לא', async () => {
    const today = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', day: 'numeric' }).format(Date.now()));
    const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(Date.now()).split('-').map(Number);
    const first = at(20, new Date(Date.UTC(y, m, 0)).getUTCDate() - today + 1); // the 1st of next month, 20:05
    sql("DELETE FROM product_log WHERE kind = 'purchase' AND ts >= ?", Date.now() - 40 * 86400e3);
    const buy = (uid, ts, ...names) => { const e = sql('INSERT INTO events (ts, user_id, type, product_id) VALUES (?, ?, \'purchase\', ?)', ts, uid, pid(names[0])).lastInsertRowid;
      for (const n of names) sql("INSERT INTO product_log (event_id, ts, product_id, kind) VALUES (?, ?, ?, 'purchase')", e, ts, pid(n)); };
    const d0 = today > 2 ? -2 : 0; // inside this month
    buy(1, at(10, d0), 'לחם', 'קפה'); buy(2, at(18, d0), 'לחם'); buy(2, at(19, d0), 'קפה'); // two people, the same day
    buy(1, at(9, d0), 'קולה'); buy(1, at(12, d0), 'קולה'); // the same person
    if (today > 2) { buy(2, at(20, -2) + 3 * 3600e3, 'ביצים L'); buy(1, at(8, -1), 'ביצים L'); } // 23:00 and 08:00 the next day
    sql('UPDATE devices SET digest_sent = NULL');
    const d = (await call(avi, 'POST', '/api/__schedule', { now: first })).data;
    const words = JSON.stringify(d.digestFor?.[1] || d);
    assert.match(words, /קרה פעמיים שמוצר נקנה פעמיים באותו יום: (לחם וקפה|קפה ולחם)\./, words.slice(0, 600));
    assert.doesNotMatch(words, /קולה|ביצים L/);
  });

  await check('I56', 'מ24: "האם הגיע הכל?" ו"חסר X ש"ח למשלוח חינם" ב-system[0]', async () => {
    fresh(); answer = () => ({ reply: 'בכיף!', face: 'happy' }); await say(avi, 'תודה');
    const sys = requests.at(-1).system[0].text;
    assert.ok(sys.includes('"המשלוח הגיע": קודם שאלה אחת, "האם הגיע הכל?", עם options ["הכל הגיע", "חסר משהו"].'));
    assert.ok(sys.includes('"אפשר להוסיף משהו שעומד להיגמר: קפה, אורז או שמן זית. מה להוסיף?"'));
  });

  // ---------- מ25: the day of the big shop ----------
  const wdOf = (ts) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short' }).format(ts));
  const daysTo = (wd, from = 0) => { for (let d = from; d < from + 7; d++) if (wdOf(at(12, d)) === wd) return d; };
  await check('I57', 'מ25: שלוש יציאות לקניות בימי חמישי, בשלושה שבועות: shopday נכתב, ולא ב"שמתי לב ש..."', async () => {
    sql('DELETE FROM shopping');
    const thu = daysTo(4, -27); // the first Thursday of the last four weeks
    for (const d of [thu, thu + 7, thu + 14]) sql("INSERT INTO shopping (user_id, store, started, ended) VALUES (1, 'super', ?, ?)", at(10, d), at(11, d));
    await call(avi, 'POST', '/api/__schedule', { now: at(7) });
    const row = sql("SELECT data, count FROM noticed WHERE kind = 'shopday'")[0];
    assert.deepEqual(JSON.parse(row?.data || '{}').v, { weekday: 4, kind: 'trip' }, JSON.stringify(row));
    assert.ok(!(await state(avi)).noticed.some((n) => n.kind === 'shopday'), 'in the settings list');
  });
  await check('I60', 'מ25: ילד לא נשאל', async () => {
    answer = () => ({ reply: 'בכיף!', face: 'happy' }); fresh();
    assert.doesNotMatch((await say(yoavi, 'תודה')).reply, /קנייה גדולה/);
  });
  await check('I58', 'מ25: "תודה": "אגב, שמתי לב שאתם עושים קנייה גדולה בימי חמישי…"; "כן, תזכיר": העובדה', async () => {
    answer = () => ({ reply: 'בכיף!', face: 'happy' }); let r;
    for (let i = 0; i < 5; i++) { fresh(); r = await say(michal, 'תודה'); if (/קנייה גדולה/.test(r.reply)) break; } // Shuki's other questions first, one a day
    assert.equal(r.reply, 'בכיף! אגב, שמתי לב שאתם עושים קנייה גדולה בימי חמישי. האם תרצי שאזכיר לך ביום רביעי בערב מה ברשימה?');
    assert.deepEqual(r.options, ['כן, תזכיר', 'לא צריך']);
    assert.equal((await say(michal, 'כן, תזכיר')).reply, 'סגור!');
    assert.equal(sql("SELECT value FROM facts WHERE key = 'shopday_optin' AND about_id = 2")[0]?.value, 'כן');
  });
  await check('I59', 'מ25: יום רביעי ב-20:00: push עם מספר הפריטים, פעם אחת ביום; בלי פריטים ברשימה: אין', async () => {
    const wed = daysTo(3, 1);
    const n = sql("SELECT COUNT(*) AS n FROM list_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.status = 'open' AND i.ordered IS NULL AND i.private_to IS NULL AND (p.id IS NULL OR p.private_to IS NULL)")[0].n;
    assert.ok(n > 1, `${n}`);
    sql("DELETE FROM settings WHERE key LIKE 'pushes:%'");
    const d = (await call(avi, 'POST', '/api/__schedule', { now: at(20, wed) })).data;
    assert.deepEqual((d.shopday || []).map((x) => [x.to, x.title, x.body]), [['מיכל', 'מחר קניות', `ברשימה יש ${n} מוצרים.`]], JSON.stringify(d).slice(0, 300));
    const d2 = (await call(avi, 'POST', '/api/__schedule', { now: at(20, wed) + 60e3 })).data;
    assert.equal(d2.shopday, undefined, 'twice');
    sql("UPDATE list_items SET status = 'done' WHERE status = 'open'");
    const d3 = (await call(avi, 'POST', '/api/__schedule', { now: at(20, wed + 7) })).data;
    assert.equal(d3.shopday, undefined, 'an empty list');
  });

  // ---------- מ26: what is about to run out, when going shopping ----------
  const soonProduct = (name) => {
    sql("INSERT INTO products (name, count_type, qty, created, updated) VALUES (?, 'units', 1, 1, 1)", name);
    const id = pid(name), D = 86400e3, t = Date.now();
    for (const [b, o] of [[16, 11], [10, 5]]) sql("INSERT INTO product_log (event_id, ts, product_id, kind) VALUES (0, ?, ?, 'purchase'), (0, ?, ?, 'out')", t - b * D, id, t - o * D + 1, id);
    sql("INSERT INTO product_log (event_id, ts, product_id, kind) VALUES (0, ?, ?, 'purchase')", t - 4 * D, id);
    return id;
  };
  const trip = async (t) => { let r; for (let i = 0; i < 5; i++) { fresh(); r = await say(t, 'אני בסופר'); if (!/\?/.test(r.reply.replace(/עומד|עומדים/, '')) || /להיגמר/.test(r.reply)) break; } return r; };
  await check('I61', 'מ26: יציאה ראשונה לקניות בצ\'אט: "האם תרצה שאגיד לך מה עומד להיגמר כשאתה יוצא לקניות?", פעם אחת', async () => {
    sql("DELETE FROM away WHERE kind = 'nolearn'"); // I43's two weeks after the birth aren't learned from
    sql("DELETE FROM list_items WHERE status = 'open'"); soonProduct('טחינה'); soonProduct('קטשופ');
    sql("INSERT INTO list_items (product_id, store, source, status, added_by, added) VALUES (?, 'super', 'manual', 'open', 1, ?)", pid('קטשופ'), Date.now());
    answer = () => ({ reply: 'בהצלחה!', face: 'happy', shopping: 'start' });
    const r = await trip(avi);
    assert.equal(r.reply, 'בהצלחה! האם תרצה שאגיד לך מה עומד להיגמר כשאתה יוצא לקניות?'); assert.deepEqual(r.options, ['כן, תגיד', 'לא צריך']);
    answer = () => ({ reply: 'סבבה', face: 'happy' });
    assert.equal((await say(avi, 'כן, תגיד')).reply, 'סגור!');
    assert.equal(sql("SELECT value FROM facts WHERE key = 'soon_optin' AND about_id = 1")[0]?.value, 'כן');
  });
  await check('I62', 'מ26: אחרי "כן": ביציאה הבאה, המשפט והכרטיס; מה שכבר ברשימה לא בכרטיס', async () => {
    answer = () => ({ reply: 'בהצלחה!', face: 'happy', shopping: 'start' });
    fresh(); const r = await say(avi, 'אני בסופר');
    assert.equal(r.reply, 'בהצלחה! ועומדת להיגמר בקרוב: טחינה. האם להוסיף אותה לרשימה?', JSON.stringify(r).slice(0, 300));
    const lines = (r.proposal?.lines || []).map((l) => l.text).join(' | ');
    assert.match(lines, /טחינה/); assert.doesNotMatch(lines, /קטשופ/);
  });
  await check('I63', 'מ26: "לא צריך": בלי כרטיס, ובלי שאלה שנייה', async () => {
    answer = () => ({ reply: 'בהצלחה!', face: 'happy', shopping: 'start' });
    const r = await trip(michal); assert.match(r.reply, /מה עומד להיגמר כשאת יוצאת לקניות\?$/);
    answer = () => ({ reply: 'סבבה', face: 'happy' }); await say(michal, 'לא צריך');
    answer = () => ({ reply: 'בהצלחה!', face: 'happy', shopping: 'start' });
    fresh(); const r2 = await say(michal, 'אני בסופר');
    assert.equal(r2.proposal, undefined); assert.doesNotMatch(r2.reply, /להיגמר/);
  });

  await check('I64', 'מ31: /api/noticed על שורה שפגה (מסך הגדרות ישן): 200, והסטטוס yes', async () => {
    sql("INSERT INTO noticed (key, kind, product_id, data, count, first, last, status) VALUES ('weekly:i64', 'weekly', ?, '{\"v\":5}', 3, 1, 1, 'expired')", pid('לחם'));
    const id = sql("SELECT id FROM noticed WHERE key = 'weekly:i64'")[0].id;
    const r = await call(avi, 'POST', '/api/noticed', { id, yes: true });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(sql('SELECT status FROM noticed WHERE id = ?', id)[0].status, 'yes');
  });

  await check('I63א', 'מ24–מ26 אחרי הסוקר: "לבטל את ההזמנה של X"; אחרי "די לשאול" אין שאלת "עומד להיגמר"; הדפוס של יום הקנייה נעלם: התזכורת נפסקת', async () => {
    sql("INSERT INTO list_items (product_id, store, source, status, added_by, added, ordered) VALUES (?, 'super', 'manual', 'open', 1, ?, ?)", pid('קולה'), Date.now(), Date.now());
    const it = sql("SELECT id FROM list_items WHERE product_id = ? AND ordered IS NOT NULL ORDER BY id DESC LIMIT 1", pid('קולה'))[0].id;
    fresh(); answer = () => ({ reply: 'לעדכן?', face: 'happy', actions: [{ kind: 'order', item_id: it, off: true }] });
    const r = await say(avi, 'חסרה הקולה');
    assert.ok((r.proposal?.lines || []).some((l) => /^לבטל את ההזמנה של קולה/.test(l.text)), JSON.stringify(r.proposal?.lines));
    sql("DELETE FROM settings WHERE key LIKE 'ask_once:soon:%'"); sql("DELETE FROM facts WHERE key = 'soon_optin'");
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 1, 'no_ask', 'ללמוד', 1, 1, 1, 0, 'chat', 1, 1)");
    answer = () => ({ reply: 'בהצלחה!', face: 'happy', shopping: 'start' });
    fresh(); assert.equal((await say(avi, 'אני בסופר')).reply, 'בהצלחה!');
    sql("DELETE FROM facts WHERE key = 'no_ask'");
    sql('DELETE FROM shopping'); await call(avi, 'POST', '/api/__schedule', { now: at(7, 1) });
    assert.equal(sql("SELECT status FROM noticed WHERE key = 'shopday'")[0].status, 'expired');
  });

  // ---------- מ27: guests' food, and a guest who keeps coming ----------
  const stores = () => JSON.parse(sql("SELECT value FROM settings WHERE key = 'stores'")[0]?.value || '[]');
  const hostingOf = () => stores().find((x) => x.until);
  const endHosting = async () => { const s = stores().map((x) => (x.until ? { ...x, until: 1 } : x)); sql("UPDATE settings SET value = ? WHERE key = 'stores'", JSON.stringify(s)); await call(avi, 'POST', '/api/__schedule', { now: at(7) }); };
  const host = (food, extra = {}) => { answer = () => ({ reply: 'כיף!', face: 'happy', hosting: { name: 'אירוח שישי', date: '2030-01-04', ...(food && { guest_food: food }), ...extra } }); };
  const GISI = [{ name: 'גיסי', eats: 'אוכל רק שניצל ותפוח אדמה' }];
  await check('I65', 'מ27: guest_food נשמר על רשימת האירוח, עם by של מי שכתב; אין fact', async () => {
    sql("DELETE FROM settings WHERE key IN ('stores', 'hosting_items') OR key LIKE 'guest_seen:%'"); sql('DELETE FROM house_guests');
    const facts = sql('SELECT COUNT(*) AS n FROM facts')[0].n;
    fresh(); host(GISI); await say(avi, 'גיסי בא בשישי, הוא אוכל רק שניצל ותפוח אדמה');
    assert.deepEqual(hostingOf()?.guests, [{ name: 'גיסי', eats: 'אוכל רק שניצל ותפוח אדמה', by: 1 }], JSON.stringify(stores()));
    assert.equal(sql('SELECT COUNT(*) AS n FROM facts')[0].n, facts);
  });
  await check('I65ב', 'מ27: התיאור של eats בכלי והשורה של §14 ב-system[0]; השורה של האירוח עם מה שגיסי אוכל', async () => {
    const t = JSON.stringify(requests.at(-1).tools[0].input_schema.properties.hosting);
    assert.match(t, /Never a health condition, a diagnosis or a reason/);
    assert.ok(requests.at(-1).system[0].text.includes('אורח שאמרו עליו מצב בריאות ("הוא סוכרתי אז בלי סוכר"): ב-guest_food רק האוכל ("בלי סוכר"), בלי המצב ובלי הסיבה, ואף פעם לא fact.'));
    answer = () => ({ reply: 'בכיף!', face: 'happy' }); fresh(); await say(michal, 'תודה');
    assert.match(requests.at(-1).system[1].text, /לאורחים: גיסי: אוכל רק שניצל ותפוח אדמה/);
  });
  await check('I65א', 'מ27: שלוש הודעות על אותו אירוח מעלות את המונה פעם אחת; בהגדרות אין את השם, רק HMAC; guest_salt לא בהורדה', async () => {
    for (let i = 0; i < 2; i++) { fresh(); host(GISI); await say(avi, 'גיסי בא'); }
    const seen = sql("SELECT key, value FROM settings WHERE key LIKE 'guest_seen:%'");
    assert.equal(seen.length, 1); assert.equal(seen[0].value, '1');
    assert.ok(!sql("SELECT key, value FROM settings WHERE key NOT IN ('stores')").some((r) => /גיסי/.test(r.key + r.value)), 'the name is kept'); // I67
    const ex = JSON.stringify((await call(avi, 'GET', '/api/export')).data);
    assert.doesNotMatch(ex, /guest_salt|guest_seen/);
  });
  await check('I70', 'מ27: מוצרי אירוח: אחרי שהאירוח נגמר, "בפעם הקודמת: …" באירוח הבא', async () => {
    const id = hostingOf().id;
    sql("INSERT INTO list_items (text, store, source, status, added_by, added) VALUES ('יין אדום', ?, 'manual', 'done', 1, ?)", id, Date.now());
    await endHosting();
    assert.deepEqual(JSON.parse(sql("SELECT value FROM settings WHERE key = 'hosting_items'")[0].value), ['יין אדום']);
    fresh(); host(GISI); await say(avi, 'גיסי בא שוב');
    answer = () => ({ reply: 'בכיף!', face: 'happy' }); fresh(); await say(avi, 'תודה');
    assert.match(requests.at(-1).system[1].text, /בפעם הקודמת: יין אדום/);
  });
  await check('I66', 'מ27: אחרי האירוח השלישי, השאלה למי שסיפר; "כן, תזכור": שורה ב-house_guests; פעם אחרת "לא צריך": אין שורה, והמונה נמחק', async () => {
    await endHosting(); fresh(); host(GISI); await say(avi, 'גיסי בא בפעם השלישית');
    assert.equal(sql("SELECT value FROM settings WHERE key LIKE 'guest_seen:%'")[0].value, '3');
    answer = () => ({ reply: 'בכיף!', face: 'happy' });
    fresh(); assert.doesNotMatch((await say(michal, 'תודה')).reply, /לזכור לפעם הבאה/, 'asked whoever didn\'t tell');
    let r; for (let i = 0; i < 4; i++) { fresh(); r = await say(avi, 'תודה'); if (/לזכור לפעם הבאה/.test(r.reply)) break; }
    assert.equal(r.reply, 'בכיף! האם לזכור לפעם הבאה: גיסי, אוכל רק שניצל ותפוח אדמה?'); assert.deepEqual(r.options, ['כן, תזכור', 'לא צריך']);
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'guest_seen:%'")[0].n, 0, 'the count stayed');
    await say(avi, 'כן, תזכור');
    assert.deepEqual(sql('SELECT name, eats FROM house_guests').map((g) => [g.name, g.eats]), [['גיסי', 'אוכל רק שניצל ותפוח אדמה']]);
    // another guest, three hostings, "לא צריך"
    const DOD = [{ name: 'דודה רינה', eats: 'צמחונית' }];
    for (let i = 0; i < 3; i++) { await endHosting(); fresh(); host(DOD); await say(avi, 'דודה רינה באה'); }
    answer = () => ({ reply: 'בכיף!', face: 'happy' });
    for (let i = 0; i < 4; i++) { fresh(); r = await say(avi, 'תודה'); if (/לזכור לפעם הבאה/.test(r.reply)) break; }
    assert.match(r.reply, /דודה רינה, צמחונית\?$/); await say(avi, 'לא צריך');
    assert.equal(sql("SELECT COUNT(*) AS n FROM house_guests WHERE name = 'דודה רינה'")[0].n, 0);
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'guest_seen:%'")[0].n, 0);
  });
  await check('I68', 'מ27: אורח שמור ב-system[3] רק כשיש אירוח פתוח ומי שכותב מבוגר; לא ב-system[1]', async () => {
    answer = () => ({ reply: 'בכיף!', face: 'happy' });
    fresh(); await say(avi, 'מה להגיש בשישי?');
    assert.match(requests.at(-1).system[3].text, /אורחים שאני זוכר: גיסי: אוכל רק שניצל ותפוח אדמה/);
    assert.doesNotMatch(requests.at(-1).system[1].text, /אורחים שאני זוכר/);
    fresh(); await say(yoavi, 'מה להגיש בשישי?');
    assert.doesNotMatch(requests.at(-1).system.slice(1).map((x) => x.text).join('\n'), /אורחים שאני זוכר: /); // the instructions name the line; the list itself isn't there
    await endHosting(); fresh(); await say(avi, 'מה נאכל?');
    assert.doesNotMatch(requests.at(-1).system[3].text, /אורחים שאני זוכר/);
  });
  await check('I69', 'מ27: מבוגר מוחק; ילד לא רואה ולא מוחק (404)', async () => {
    const g = sql('SELECT id FROM house_guests')[0].id;
    assert.equal((await state(yoavi)).houseGuests, undefined);
    const kidEx = (await call(yoavi, 'GET', '/api/export')).data; assert.deepEqual(kidEx.house_guests, [], 'in a child\'s download'); // P64
    assert.equal((await call(avi, 'GET', '/api/export')).data.house_guests.length, 1);
    // a download carries no "who told" and no counted fingerprints (the reviewer of 0c24dd9)
    fresh(); host(GISI); await say(avi, 'גיסי בא שוב'); assert.ok(hostingOf()?.guests?.[0]?.by === 1 && hostingOf()?.counted?.length, JSON.stringify(stores()));
    const st = (await call(avi, 'GET', '/api/export')).data.settings.find((r) => r.key === 'stores');
    assert.match(st?.value || '', /"guests"/); assert.doesNotMatch(st?.value || '', /"by"|counted/, st?.value);
    const kidSt = (await call(yoavi, 'GET', '/api/export')).data.settings.find((r) => r.key === 'stores');
    assert.doesNotMatch(kidSt?.value || '', /guests|גיסי/, kidSt?.value);
    await endHosting();
    assert.equal((await call(yoavi, 'POST', '/api/house-guests', { id: g, delete: true })).status, 404);
    assert.equal((await state(michal)).houseGuests.length, 1);
    assert.equal((await call(michal, 'POST', '/api/house-guests', { id: g, delete: true })).status, 200);
    assert.equal(sql('SELECT COUNT(*) AS n FROM house_guests')[0].n, 0);
  });

  // ---------- מ28: back from a vacation ----------
  const backCard = () => sql("SELECT content FROM chat WHERE content LIKE '%ברוכים השבים%' ORDER BY id DESC LIMIT 1")[0];
  await check('I71', 'מ28: חופשה של 10 ימים, חלב (7) ואורז (בלי): למחרת בבוקר כרטיס עם החלב בלבד; מה שנקנה בזמן החופשה לא בו; אישור זורק', async () => {
    const D = 86400e3, start = at(7) - 11 * D, end = at(7) - D / 2;
    sql("DELETE FROM chat WHERE json_extract(content, '$.card') = 1"); sql("DELETE FROM away");
    sql("INSERT INTO away (start, end, set_by, kind) VALUES (?, ?, 1, 'away')", start, end);
    for (const [n, days, upd] of [['חלב טרי', 7, start - D], ['אורז מלא', null, start - D], ['יוגורט טרי', 7, start + 2 * D]]) {
      sql("INSERT INTO products (name, count_type, qty, shelf_days, created, updated) VALUES (?, 'units', 1, ?, 1, ?)", n, days, upd);
      sql("INSERT INTO product_log (event_id, ts, product_id, kind) VALUES (0, ?, ?, 'purchase')", upd, pid(n));
    }
    await call(avi, 'POST', '/api/__schedule', { now: at(7) });
    const c = JSON.parse(backCard()?.content || '{}');
    assert.equal(c.reply, 'ברוכים השבים! חלב טרי כנראה כבר לא טוב אחרי החופשה. האם לסמן שזרקתם אותו?', JSON.stringify(c)); // the article only where certain
    assert.deepEqual((c.proposal?.lines || []).map((l) => l.text), ['לסמן שזרקנו חלב טרי?']); // every card line is a question (r0t)
    // the owner 13/10: the morning's card is good until the day ends, not 12 hours: made 15 hours ago (as at 22:00), still approved
    assert.equal(JSON.parse(sql('SELECT actions FROM proposals WHERE id = ?', c.proposal.id)[0].actions).day, new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(at(7)));
    sql('UPDATE proposals SET created = ? WHERE id = ?', Date.now() - 15 * 3600e3, c.proposal.id);
    const ap = await call(michal, 'POST', `/api/proposals/${c.proposal.id}/apply`, {}); assert.equal(ap.status, 200);
    assert.equal(sql("SELECT qty FROM products WHERE name = 'חלב טרי'")[0].qty, 0, JSON.stringify(ap.data).slice(0, 300));
    await call(avi, 'POST', '/api/__schedule', { now: at(7) + 3600e3 * 24 });
    assert.equal(sql("SELECT COUNT(*) AS n FROM chat WHERE content LIKE '%ברוכים השבים%'")[0].n, 1, 'twice');
  });
  await check('I71ב', 'the owner 13/10: כרטיס של ריצת הבוקר מאתמול כבר לא מאושר היום', async () => {
    const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(Date.now() - 86400e3);
    sql("INSERT INTO proposals (id, user_id, created, actions) VALUES ('old-back', 0, ?, ?)", Date.now() - 3600e3, JSON.stringify({ actions: [], context: 'report', forAdults: true, day: yesterday }));
    const r = await call(avi, 'POST', '/api/proposals/old-back/apply', {});
    assert.equal(r.data.status, 'expired', JSON.stringify(r.data));    // its card isn't shown, isn't "up" and isn't answered; a morning question from yesterday isn't taken (the review of 611dfd7)
    sql("INSERT INTO chat (ts, user_id, role, content, thread) VALUES (?, NULL, 'shuki', ?, 2)", Date.now() - 3600e3, JSON.stringify({ reply: 'האם את עדיין בקיטו?', options: ['כן, עדיין', 'כבר לא'], card: 1, for: 2, to: [2], day: yesterday }));
    const msgs = (await call(michal, 'GET', '/api/chat')).data.messages;
    assert.ok(!msgs.some((m) => m.content.day === yesterday), 'yesterday\'s card is shown');
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('ask:2', ?)", JSON.stringify({ actions: [], done: 'סגור!', choices: { 'כן, עדיין': { actions: [], done: 'סגור!' } }, day: yesterday, ts: Date.now() - 3600e3 }));
    answer = () => ({ reply: 'מהמודל', face: 'happy' }); sql("UPDATE chat SET ts = ts - 3600e3 WHERE role = 'user' AND ts > ?", Date.now() - 120e3);
    assert.equal((await say(michal, 'כן, עדיין')).reply, 'מהמודל', 'yesterday\'s question was taken');
    assert.equal(sql("SELECT COUNT(*) AS n FROM chat WHERE json_extract(content, '$.day') = ? AND json_extract(content, '$.answered') = 1", yesterday)[0].n, 0, 'answered');
    sql("DELETE FROM chat WHERE json_extract(content, '$.day') = ?", yesterday);
  });
  await check('I72', 'מ28: חופשה של יומיים: אין כרטיס', async () => {
    const D = 86400e3, start = at(7) - 3 * D, end = at(7) - D / 2;
    sql("DELETE FROM chat WHERE json_extract(content, '$.card') = 1"); sql("DELETE FROM away");
    sql("UPDATE products SET qty = 1, updated = ? WHERE name = 'חלב טרי'", start - D);
    // a child doesn't turn the house's card down (the reviewer of ccb1e63)
    sql("INSERT INTO proposals (id, user_id, created, actions) VALUES ('kid-back', 0, ?, '{\"actions\":[],\"forAdults\":true}')", Date.now());
    assert.equal((await call(yoavi, 'POST', '/api/proposals/kid-back/reject', {})).data.status, 'pending');
    sql("INSERT INTO away (start, end, set_by, kind) VALUES (?, ?, 1, 'away')", start, end);
    await call(avi, 'POST', '/api/__schedule', { now: at(7) });
    assert.equal(backCard(), undefined);
    sql("DELETE FROM away");
  });

  await check('I36ג', 'אחרי הסוקר של c2b418f: hosting בתוך actions מתמונה לא פותח רשימת אירוח', async () => {
    sql("DELETE FROM settings WHERE key = 'stores'");
    answer = () => ({ reply: 'קיבלתי', face: 'happy', actions: [{ kind: 'hosting', name: 'אירוח שישי', guest_food: [{ name: 'גיסי', eats: 'שניצל' }] }] });
    fresh(); await call(avi, 'POST', '/api/chat', { text: 'מה זה?', image: { media_type: 'image/jpeg', data: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==' } });
    assert.ok(!stores().some((x) => x.until), JSON.stringify(stores()));
  });

  // ---------- r9z c3, מ10: the purchase's card first, the question after it ----------
  const swapSetup = () => {
    sql("DELETE FROM shopping"); sql("DELETE FROM list_items WHERE status = 'open'");
    for (const n of ['חלב שקדים', 'חלב סויה ב']) if (!pid(n)) sql("INSERT INTO products (name, count_type, qty, created, updated) VALUES (?, 'units', 0, 1, 1)", n);
    sql("INSERT INTO shopping (user_id, store, started) VALUES (2, 'super', ?)", Date.now() - 600e3);
    sql("INSERT INTO list_items (product_id, store, source, status, added_by, added) VALUES (?, 'super', 'manual', 'open', 2, ?)", pid('חלב שקדים'), Date.now());
    answer = () => ({ reply: 'סבבה, לרשום את הסויה?', face: 'happy', actions: [{ kind: 'op', product_id: pid('חלב סויה ב'), op: { type: 'purchase', amount: 1 } }] });
  };
  const lastShuki2 = () => JSON.parse(sql("SELECT content FROM chat WHERE role = 'shuki' ORDER BY ts DESC, id DESC LIMIT 1")[0].content);
  const almonds = () => sql("SELECT status FROM list_items WHERE product_id = ? ORDER BY id DESC LIMIT 1", pid('חלב שקדים'))[0]?.status;
  for (const [dir, word, after] of [['לא', 'לא', undefined], ['כן', 'כן', 'open']]) { // "לא": list_remove takes the line away
    await check(`I10-${dir}`, `מ10 (c3): "לא היו שקדים, לקחתי סויה": כרטיס הקנייה, בלי השאלה; אחרי שהכרטיס נסגר "האם להשאיר את חלב השקדים ברשימה?"; "${word}"`, async () => {
      swapSetup(); fresh();
      const r = await say(michal, 'לא היו שקדים, לקחתי סויה');
      assert.ok(r.proposal?.id, JSON.stringify(r).slice(0, 200)); assert.doesNotMatch(r.reply, /להשאיר/);
      assert.equal(almonds(), 'open');
      await call(michal, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
      assert.equal(lastShuki2().reply, 'האם להשאיר את חלב השקדים ברשימה?');
      answer = () => ({ reply: 'בכיף!', face: 'happy' });
      await say(michal, word);
      assert.equal(almonds(), after, `${word}: ${almonds()}`);
    });
  }

  await check('I10-ב', 'מ10 אחרי הסוקר: הפריט הנכון כש"חלב" ו"חלב שקדים" ברשימה; כרטיס שבוטל לוקח איתו את השאלה', async () => {
    swapSetup(); if (!pid('חלב')) sql("INSERT INTO products (name, count_type, qty, created, updated) VALUES ('חלב', 'units', 0, 1, 1)");
    sql("INSERT INTO list_items (product_id, store, source, status, added_by, added) VALUES (?, 'super', 'manual', 'open', 2, ?)", pid('חלב'), Date.now() - 60e3);
    fresh(); let r = await say(michal, 'לא היו שקדים, לקחתי חלב סויה');
    await call(michal, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    assert.equal(lastShuki2().reply, 'האם להשאיר את חלב השקדים ברשימה?');
    answer = () => ({ reply: 'בכיף!', face: 'happy' }); await say(michal, 'כן');
    swapSetup(); fresh(); r = await say(michal, 'לא היו שקדים, לקחתי סויה');
    await call(michal, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
    answer = () => ({ reply: 'בכיף!', face: 'happy' }); fresh(); const r2 = await say(michal, 'תודה');
    assert.ok(!sql("SELECT content FROM chat WHERE role = 'shuki' ORDER BY id DESC LIMIT 3").some((x) => /להשאיר את חלב השקדים/.test(x.content)), 'asked after a card turned down');
  });

  await check('I10-ג', 'מ10 אחרי הסוקר: "לא היה חלב 3%, לקחתי חלב סויה" ו"חלב שקדים לא היה, לקחתי סויה": השאלה על הפריט הנכון', async () => {
    for (const [msg, item, q] of [['לא היה חלב 3%, לקחתי חלב סויה', 'חלב 3%', 'האם להשאיר את החלב 3% ברשימה?'], ['חלב שקדים לא היה, לקחתי סויה', 'חלב שקדים', 'האם להשאיר את חלב השקדים ברשימה?'], ['לא היה חלב שקדים, לקחתי סויה, אין בעיה', 'חלב שקדים', 'האם להשאיר את חלב השקדים ברשימה?'], ['לא היה חלב שקדים, לקחתי סויה, אין לי שום בעיות', 'חלב שקדים', 'האם להשאיר את חלב השקדים ברשימה?'], ['אין מה לעשות, לא היה חלב שקדים, לקחתי סויה', 'חלב שקדים', 'האם להשאיר את חלב השקדים ברשימה?']]) { // the last: the review of 8c99f48
      swapSetup(); sql("DELETE FROM list_items WHERE status = 'open'");
      sql("INSERT INTO list_items (product_id, store, source, status, added_by, added) VALUES (?, 'super', 'manual', 'open', 2, ?)", pid(item), Date.now());
      fresh(); const r = await say(michal, msg);
      await call(michal, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
      assert.equal(lastShuki2().reply, q, msg);
      answer = () => ({ reply: 'בכיף!', face: 'happy' }); await say(michal, 'כן');
    }
  });
  await check('I10-ד', 'מ10 אחרי הסוקר של c2f14cb: "חלב 3%" ולא "חלב" כשהשניים ברשימה, "ו" לפני "לא היה"; כרטיס שהוחלף בתיקון: השאלה עוברת לכרטיס החדש', async () => {
    if (!pid('חלב')) sql("INSERT INTO products (name, count_type, qty, created, updated) VALUES ('חלב', 'units', 0, 1, 1)");
    swapSetup(); sql("DELETE FROM list_items WHERE status = 'open'");
    for (const n of ['חלב', 'חלב 3%']) sql("INSERT INTO list_items (product_id, store, source, status, added_by, added) VALUES (?, 'super', 'manual', 'open', 2, ?)", pid(n), Date.now());
    fresh(); let r = await say(michal, 'קניתי לחם ולא היה חלב 3%, לקחתי סויה');
    await call(michal, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    assert.equal(lastShuki2().reply, 'האם להשאיר את החלב 3% ברשימה?');
    answer = () => ({ reply: 'בכיף!', face: 'happy' }); await say(michal, 'כן');
    swapSetup(); fresh(); r = await say(michal, 'לא היה חלב שקדים, לקחתי סויה');
    const first = r.proposal.id;
    answer = () => ({ reply: 'סבבה, שתיים?', face: 'happy', actions: [{ kind: 'op', product_id: pid('חלב סויה ב'), op: { type: 'purchase', amount: 2 } }] });
    sql("UPDATE chat SET ts = ts - 3600e3 WHERE role = 'user' AND ts > ?", Date.now() - 120e3); r = await say(michal, 'בעצם שתיים'); // not fresh(): it empties the queue
    assert.notEqual(r.proposal.id, first);
    assert.equal(sql('SELECT status FROM proposals WHERE id = ?', first)[0].status, 'rejected');
    const asked = () => sql("SELECT COUNT(*) AS n FROM chat WHERE role = 'shuki' AND content LIKE '%האם להשאיר את חלב השקדים ברשימה?%'")[0].n, before = asked();
    await call(michal, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    assert.equal(asked(), before + 1, 'asked after the new card'); // by count: the turns here can share a millisecond
    answer = () => ({ reply: 'בכיף!', face: 'happy' }); await say(michal, 'כן');
  });
} finally {
  srv.kill(); mock.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} inventory checks passed`);
if (failed.length) { console.log(log.split('\n').filter((l) => /error|Error/.test(l)).slice(-8).join('\n')); process.exit(1); }
