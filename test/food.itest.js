// Stage 8: the food gantt (docs/stage8-plan.md), on the Node server with a fake model. The plan calls these F1, F2…;
// here they are S8-01, S8-02… (F1–F19 are taken in test/facts.itest.js and test/features.itest.js).
// Run: node --disable-warning=ExperimentalWarning test/food.itest.js
import './fetch-retry.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DIR = '/tmp/shuki-test/shuki-food'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const PORT = 8861, MOCK = 8862;

// Avi (admin), Michal, Yoavi (a child)
const db = new DatabaseSync(`${DIR}/shuki.db`);
db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) { db.exec(readFileSync(`migrations/${f}`, 'utf8')); db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f); }
db.exec(readFileSync('test/fixture-house.sql', 'utf8'));
db.exec("INSERT INTO users (id, name, gender, role, active, created) VALUES (3, 'יואבי', 'm', 'child', 1, 0)");
db.exec("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999), ('222222', 2, 9999999999999), ('333333', 3, 9999999999999)");
db.close();

let answer = () => ({ reply: 'אני פה!', face: 'happy' });
const requests = [];
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { const b = Buffer.concat(parts).toString('utf8'); // bytes first: a Hebrew letter can be split between chunks (question 29)
  const body = JSON.parse(b); requests.push(body);
  const a = answer(body);
  if (a === 'FAIL') { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":{"type":"api_error"}}'); return; }
  res.writeHead(200, { 'content-type': 'application/json' });
  // NO_TOOL: an answer with no tool_use in it
  res.end(JSON.stringify({ content: a === 'NO_TOOL' ? [{ type: 'text', text: 'hmm' }] : [{ type: 'tool_use', id: `t${requests.length}`, name: body.tools?.[0]?.name || 'respond', input: a }], usage: { input_tokens: 1, output_tokens: 1 } }));
}); }).listen(MOCK, '127.0.0.1');
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/node.js'], { env: { ...process.env, PORT: String(PORT), DB_PATH: `${DIR}/shuki.db`, ANTHROPIC_API_KEY: 't', ANTHROPIC_URL: `http://127.0.0.1:${MOCK}/v1/messages`, TEST_RESET: '1', CHAT_PER_MINUTE: '1000' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
const call = async (t, m, p, b) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const x = await r.text(); let data; try { data = JSON.parse(x); } catch { data = x; } return { status: r.status, data }; };
const sql = (q, ...a) => { const d = new DatabaseSync(`${DIR}/shuki.db`); try { return /^\s*select/i.test(q) ? d.prepare(q).all(...a) : d.prepare(q).run(...a); } finally { d.close(); } };
const results = [];
async function check(id, name, fn) {
  try { await fn(); results.push({ id, ok: true }); console.log('✓', id, name); }
  catch (e) { results.push({ id, ok: false }); console.log('✗', id, name, '\n   ', e.message.slice(0, 500)); }
}
const say = async (t, text) => (await call(t, 'POST', '/api/chat', { text })).data;
/** Shuki's last row in the chat table: what was saved */
const lastShuki = () => JSON.parse(sql("SELECT content FROM chat WHERE role = 'shuki' ORDER BY id DESC LIMIT 1")[0].content);
const CARD = [{ kind: 'list_add', text: 'במבה' }];
/** The fixed words are the whole answer: exactly, the face, no card, no buttons, no 👍/👎 */
const whole = (r, words, face) => {
  assert.equal(r.reply, words); assert.equal(r.face, face);
  assert.equal(r.proposal, undefined, 'a card'); assert.equal(r.options, undefined, 'buttons');
  const row = lastShuki(); assert.equal(row.reply, words); assert.equal(row.ai, undefined, '👍/👎'); assert.equal(row.proposal, undefined);
};
let avi, michal, yoavi;
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  [avi, michal, yoavi] = await Promise.all(['111111', '222222', '333333'].map(async (code) => (await call(null, 'POST', '/api/pair', { code })).data.token));

  // the phones were just paired: the joiner's food question (r9-100) would take the first message; not what's tested here
  sql("DELETE FROM settings WHERE key LIKE 'joinfood:%'");

  // 0.5 (decision 1): a vegetarian who asks for a fish recipe gets it, and "remember that you eat fish?" once only, ever
  const FISH_FACT = { kind: 'fact', key: 'diet', value: 'צמחונית, אוכלת דגים', text: 'מיכל צמחונית ואוכלת דגים' };
  const fishMark = (u) => sql('SELECT COUNT(*) AS n FROM settings WHERE key = ?', `ask_once:fish:${u}`)[0].n;
  await check('S8-01', 'צמחונית מבקשת מתכון עם דג: המתכון, והשאלה "האם תרצה שאזכור…" פעם אחת; הסימן נכתב כשהיא נשאלת; אחרי "לא צריך" לא שואל שוב, וגם לא המשפט של המודל', async () => {
    answer = () => ({ reply: 'סלמון בתנור: פילה סלמון, לימון ושמן זית, 20 דקות ב-200 מעלות. האם תרצי שאזכור שאת צמחונית ואוכלת דגים?', face: 'happy', actions: [FISH_FACT] });
    const r = await say(michal, 'תן לי מתכון לסלמון בתנור');
    assert.match(r.reply, /האם תרצי שאזכור שאת צמחונית ואוכלת דגים\?$/);
    assert.equal(fishMark(2), 1, 'no mark when it was asked');
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await say(michal, 'לא צריך');
    assert.equal(sql("SELECT COUNT(*) AS n FROM facts WHERE about_id = 2 AND key = 'diet'")[0].n, 0, 'the fact was saved after "no"');
    answer = () => ({ reply: 'סלמון בתנור: פילה סלמון ולימון. האם תרצי שאזכור שאת צמחונית ואוכלת דגים?', face: 'happy', actions: [FISH_FACT] });
    const again = await say(michal, 'ועוד מתכון עם דג?');
    assert.doesNotMatch(again.reply, /שאזכור/, 'asked again');
    assert.match(again.reply, /^סלמון בתנור/);
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'ask:2'")[0].n, 0, 'a question waits');
  });
  await check('S8-01א', 'השאלה פגה בלי תשובה (ASK_TTL): לא נשאלת שוב; "צמחונית, בלי דגים" היא לא השאלה הזו', async () => {
    answer = () => ({ reply: 'הנה מתכון. האם תרצה שאזכור שאתה צמחוני ואוכל דגים?', face: 'happy', actions: [{ ...FISH_FACT, value: 'צמחוני, אוכל דגים', text: 'אבי צמחוני ואוכל דגים' }] });
    await say(avi, 'מתכון לדג?');
    assert.equal(fishMark(1), 1);
    sql("DELETE FROM settings WHERE key = 'ask:1'"); // as after 24 hours with no answer
    const r = await say(avi, 'עוד מתכון לדג?');
    assert.doesNotMatch(r.reply, /שאזכור/);
    answer = () => ({ reply: 'האם תרצה שאזכור שאתה צמחוני ולא אוכל דגים?', face: 'happy', actions: [{ ...FISH_FACT, value: 'צמחוני, בלי דגים', text: 'אבי צמחוני ולא אוכל דגים' }] });
    assert.match((await say(avi, 'אני צמחוני, בלי דגים')).reply, /שאזכור/, '"בלי דגים" is another fact, asked as usual');
  });
  await check('S8-01ב', 'אחרי הסימן: "תזכור שאני צמחונית ואוכלת דגים" נשמר (נאמר במפורש); גם שכחה עוברת', async () => {
    answer = () => ({ reply: 'סגור, אזכור.', face: 'happy', actions: [FISH_FACT] });
    const r = await say(michal, 'תזכור שאני צמחונית ואוכלת דגים');
    assert.equal(sql("SELECT value FROM facts WHERE about_id = 2 AND key = 'diet'")[0]?.value, 'צמחונית, אוכלת דגים', `not saved: ${r.reply}`);
    // "forget it" is a fact_end card: the once-only mark never touches it
    answer = () => ({ reply: 'האם לשכוח שאת אוכלת דגים?', face: 'happy', actions: [{ kind: 'fact_end', key: 'diet', value: 'צמחונית, אוכלת דגים', text: 'מיכל צמחונית ואוכלת דגים' }] });
    const forgot = await say(michal, 'תשכח שאני אוכלת דגים');
    assert.ok(forgot.proposal?.id, `the forget was dropped: ${forgot.reply}`);
    assert.equal((await call(michal, 'POST', `/api/proposals/${forgot.proposal.id}/apply`, {})).status, 200);
    assert.equal(sql("SELECT COUNT(*) AS n FROM facts WHERE about_id = 2 AND key = 'diet'")[0].n, 0, 'the fact is still there');
    sql("DELETE FROM facts WHERE about_id = 2 AND key = 'diet'"); sql("DELETE FROM settings WHERE key = 'ask:2'");
  });
  await check('S8-01ג', 'השאלה מחכה לכרטיס (מתכון ומה שחסר לרשימה): הסימן נכתב רק כשהיא נשאלת, אחרי שהכרטיס הוכרע', async () => {
    sql("DELETE FROM settings WHERE key = 'ask_once:fish:1'");
    answer = () => ({ reply: 'הנה מתכון. להוסיף סלמון לרשימה?', face: 'happy', actions: [{ kind: 'list_add', text: 'סלמון' }, { ...FISH_FACT, value: 'צמחוני, אוכל דגים', text: 'אבי צמחוני ואוכל דגים' }] });
    const r = await say(avi, 'מתכון לסלמון, ותוסיף מה שחסר');
    assert.ok(r.proposal?.id);
    assert.equal(fishMark(1), 0, 'marked before it was asked');
    await call(avi, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
    assert.equal(fishMark(1), 1, 'not marked when asked after the card');
  });
  // ב3 (c9): a vegetarian who buys fish or puts it on the list: the card, without a word and without "remember?"
  await check('S8-17', 'צמחונית: "תוסיף סלמון לרשימה" הוא כרטיס, בלי שאלת "לזכור?" (גם כשהשאלה על דגים עוד לא נשאלה)', async () => {
    sql("DELETE FROM settings WHERE key = 'ask_once:fish:2'");
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 2, 'diet', 'צמחונית', 1, 2, 2, 0, 'chat', 1, 1)");
    answer = () => ({ reply: 'להוסיף סלמון לרשימה?', face: 'happy', actions: [{ kind: 'list_add', text: 'סלמון' }] });
    const n = requests.length;
    const r = await say(michal, 'תוסיף סלמון לרשימה');
    assert.ok(requests.length > n && requests.at(-1).system[0].text.includes('כשרות, צמחונות, דיאטה ותקופה: בלי מילה כשמוסיפים או קונים'), 'c9 is not in the instructions of this turn');
    assert.match(requests.at(-1).system[1].text, /מיכל: [^\n]*diet: צמחונית \(לא אוכלת דגים\)/, 'she is not known as a vegetarian');
    assert.ok(r.proposal?.lines?.length, 'no card');
    assert.doesNotMatch(r.reply, /שאזכור|לזכור/);
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'ask_once:fish:2'")[0].n, 0, 'marked as asked');
    await call(michal, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
    sql("DELETE FROM facts WHERE about_id = 2 AND key = 'diet'");
  });
  // the instructions the model got: the request the fake model saw last (system[0] is INSTRUCTIONS)
  const sys0 = () => requests.at(-1).system[0].text;
  /** a turn that reaches the model: what sys0() reads is this turn's own request */
  const turn = async (t, text) => { const n = requests.length; const r = await say(t, text); assert.ok(requests.length > n, `"${text}" didn't reach the model`); return r; };
  await check('S8-19', 'ב5: טבעוני ושקשוקה: גרסה טבעונית ושאלה אחת על תחליף, במילת שאלה (שאלה 4); הרגל של הבית קודם', async () => {
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await turn(avi, 'S8-19');
    assert.ok(sys0().includes('טבעוני שמבקש מתכון שמור עם ⚠ על ביצים או בשר (שקשוקה): אמור לו (בגוף שני, הוא הטבעוני) שאפשר להכין גרסה טבעונית, ושאלה אחת על תחליף: "האם תרצה תחליף לביצים? איזה?"'));
    assert.match(sys0(), /\(habit\), לפיו, בלי לשאול/);
  });
  await check('S8-36', '0.2/ג8: בטיחות מזון בהוראות: על מוצר בבית המשפט מילה במילה ושאלה אם לזרוק במילת שאלה; שאלה כללית בטווח עם "חשוב לבדוק"; לא fixed', async () => {
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await turn(avi, 'S8-36');
    assert.ok(sys0().includes('התחל במילים האלה בדיוק: "אני לא יכול לדעת אם זה עדיין טוב. כשיש ספק, עדיף לא לאכול."'));
    assert.ok(sys0().includes('("האם לזרוק את הגבינה הצהובה?"), עם options ["זרקנו","עוד בסדר"]'));
    assert.ok(sys0().includes('"בדרך כלל [טווח], אבל אני לא יכול לדעת מה יקרה אצלך, אז חשוב לבדוק."'));
    assert.ok(sys0().includes('"התוקף של הגבינה הצהובה פג אתמול'), 'the expiry, not the cheese (r8p)');
    assert.ok(sys0().includes('מילה במילה, ובמקום [טווח]: מה, איפה וכמה זמן, למשל "בדרך כלל אורז מבושל מחזיק במקרר 3–4 ימים, אבל…" ("יכול": אתה בלשון זכר; "אצלך" ביחיד, "אצלכם" רק למי שבחר רבים)'));
    assert.match(sys0(), /הצע leftover \(§24\)/);
    assert.match(sys0(), /ובטיחות מזון \("אפשר לאכול את זה\?", "כמה זמן מחזיק אורז\?"\), הם לא שאלה רפואית/, 'not medical, next to the calories');
    assert.match(sys0(), /ובלי ששאלו אם אפשר לאכול; לזה, השורה הבאה/, 'the "smells bad" line defers to the safety line');
    const safety = sys0().split('\n').filter((l) => /בטיחות מזון|כמה זמן מחזיק/.test(l)).join('\n');
    assert.doesNotMatch(safety, /הגבינה (הצהובה )?פגה/, 'the new lines say "התוקף … פג" (r8p)');
  });
  // א6: an oven fixed (question 87): a fact about the house told by one grown-up, ended by another
  await check('S8-13', 'א6: "התנור תוקן" ממיכל, על "broken: תנור" שאבי סיפר: הכרטיס, האישור, והשורה נמחקה', async () => {
    sql("INSERT INTO facts (about, about_id, key, value, since, until, told_by, confirmed_by, private, source, created, updated) VALUES ('house', 0, 'broken', 'תנור', 1, ?, 1, 1, 0, 'chat', 1, 1)", Date.now() + 30 * 86400e3);
    answer = () => ({ reply: 'איזה כיף! לשכוח שהתנור מקולקל?', face: 'happy', actions: [{ kind: 'fact_end', key: 'broken', about: 'הבית', value: 'תנור', text: 'התנור מקולקל' }] });
    const r = await say(michal, 'התנור תוקן');
    assert.ok(r.proposal?.id, `no card: ${r.reply}`);
    assert.equal((await call(michal, 'POST', `/api/proposals/${r.proposal.id}/apply`, {})).status, 200);
    assert.equal(sql("SELECT COUNT(*) AS n FROM facts WHERE about = 'house' AND key = 'broken'")[0].n, 0, 'the oven is still broken');
  });
  await check('S8-13א', 'א6: יש לבית אייר פרייר: ילד לא נשאל; מבוגר נשאל "האם להשתמש באייר פרייר גם במנות של תנור?" פעם אחת לכל הבית, והסימן נכתב כשנשאל; "לא צריך" = "בסדר", בלי כלום; אחרי זה לא נשאלת שוב, גם לא לאחר; "כן, תשתמש" = הרגל של הבית', async () => {
    const reset = () => sql("DELETE FROM settings WHERE key LIKE 'learnask:%' OR key LIKE 'ask:%' OR key = 'ask_once:airfryer:house'");
    const mark = () => sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'ask_once:airfryer:house'")[0].n;
    const habit = () => sql("SELECT value FROM facts WHERE about = 'house' AND key = 'habit'").map((r) => r.value);
    reset();
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('house', 0, 'appliance', 'אייר-פרייר', 1, 1, 1, 0, 'chat', 1, 1)");
    answer = () => ({ reply: 'בכיף!', face: 'happy' });
    assert.doesNotMatch((await say(yoavi, 'תודה')).reply, /אייר פרייר/, 'a child was asked');
    assert.equal(mark(), 0, 'marked for a child');
    const r = await say(avi, 'תודה');
    assert.equal(r.reply, 'בכיף! האם להשתמש באייר פרייר גם במנות של תנור?');
    assert.deepEqual(r.options, ['כן, תשתמש', 'לא צריך']);
    assert.equal(mark(), 1, 'not marked when asked');
    assert.equal((await say(avi, 'לא צריך')).reply, 'בסדר');
    assert.deepEqual(habit(), [], 'a habit after "no"');
    sql("DELETE FROM settings WHERE key LIKE 'learnask:%'");
    assert.doesNotMatch((await say(michal, 'תודה')).reply, /אייר פרייר/, 'asked again, of another');
    reset();
    await say(michal, 'תודה');
    assert.equal((await say(michal, 'כן, תשתמש')).reply, 'סגור!');
    assert.deepEqual(habit(), ['משתמשים באייר פרייר גם במנות של תנור']);
    sql("DELETE FROM facts WHERE about = 'house' AND key IN ('habit', 'appliance')"); sql("DELETE FROM settings WHERE key LIKE 'learnask:%' OR key LIKE 'ask:%'");
  });
  await check('S8-13ב', 'מילים של שבת ("אנחנו שומרים שבת"): שאלה של שוקי עצמו לא נשאלת ולא מחכה (השאלה על ההתראות מחליפה את התשובה)', async () => {
    sql("DELETE FROM settings WHERE key LIKE 'learnask:%' OR key LIKE 'ask:%' OR key = 'ask_once:airfryer:house'");
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('house', 0, 'appliance', 'אייר פרייר', 1, 1, 1, 0, 'chat', 1, 1)");
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    const r = await say(avi, 'אנחנו שומרים שבת');
    assert.doesNotMatch(r.reply, /אייר פרייר/);
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'ask_once:airfryer:house'")[0].n, 0, 'marked, though not asked');
    const ask = sql("SELECT value FROM settings WHERE key = 'ask:1'")[0]?.value || '';
    assert.doesNotMatch(ask, /habit/, "the air fryer's yes waits behind the Shabbat question");
    sql("DELETE FROM facts WHERE about = 'house' AND key = 'appliance'"); sql("DELETE FROM settings WHERE key LIKE 'learnask:%' OR key LIKE 'ask:%'");
    if (r.proposal?.id) await call(avi, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
    // "אגב, שמתי לב ש…" (decision 121) the same: a pattern waiting to be asked stays waiting
    const pid = sql("INSERT INTO products (name, count_type, qty, created, updated) VALUES ('חלות', 'units', 1, 1, 1)").lastInsertRowid;
    const nid = sql("INSERT INTO noticed (key, kind, product_id, data, count, first, last) VALUES ('S8-13ב', 'weekly', ?, '{\"v\":5}', 10, 1, ?)", pid, Date.now()).lastInsertRowid;
    sql("DELETE FROM settings WHERE key LIKE 'learnask:%'");
    const r2 = await say(avi, 'הפסקנו לשמור שבת');
    assert.doesNotMatch(r2.reply, /שמתי לב/);
    assert.equal(sql('SELECT status FROM noticed WHERE id = ?', nid)[0]?.status, 'watching', 'marked as asked, never seen');
    // and with other words it is asked (the check above isn't empty)
    assert.match((await say(avi, 'תודה')).reply, /שמתי לב ש/, 'the noticed question is not asked at all');
    if (r2.proposal?.id) await call(avi, 'POST', `/api/proposals/${r2.proposal.id}/reject`, {});
    sql('DELETE FROM noticed WHERE id = ?', nid); sql('DELETE FROM products WHERE id = ?', pid); sql("DELETE FROM settings WHERE key LIKE 'learnask:%' OR key LIKE 'ask:%'");
  });
  await check('S8-13ג', 'שאלה 40, ב (r8z): גם השאלות של שלב 7 ("שמתי לב…", "עדיין?", הריון) לא באות אחרי שאלה של המודל, ולא מסומנות; הן באות בתשובה הבאה', async () => {
    sql("DELETE FROM settings WHERE key LIKE 'learnask:%' OR key LIKE 'ask:%'");
    const pid = sql("INSERT INTO products (name, count_type, qty, created, updated) VALUES ('חלות', 'units', 1, 1, 1)").lastInsertRowid;
    const nid = sql("INSERT INTO noticed (key, kind, product_id, data, count, first, last) VALUES ('S8-13ג', 'weekly', ?, '{\"v\":5}', 10, 1, ?)", pid, Date.now()).lastInsertRowid;
    answer = () => ({ reply: 'האם להוסיף חלב לרשימה?', face: 'happy' });
    assert.equal((await say(avi, 'S8-13ג')).reply, 'האם להוסיף חלב לרשימה?', '"שמתי לב" after the model\'s question');
    assert.equal(sql('SELECT status FROM noticed WHERE id = ?', nid)[0].status, 'watching');
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    assert.match((await say(avi, 'S8-13ג')).reply, /^בסדר\. אגב, שמתי לב ש/);
    await say(avi, 'לא צריך');
    sql('DELETE FROM noticed WHERE id = ?', nid); sql('DELETE FROM products WHERE id = ?', pid); sql("DELETE FROM settings WHERE key LIKE 'learnask:%' OR key LIKE 'ask:%'");
    // "עדיין?": a fact whose day to ask again came
    const fid = sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated, ask_again) VALUES ('person', 1, 'period', 'קיטו', 1, 1, 1, 0, 'chat', 1, 1, 1)").lastInsertRowid;
    answer = () => ({ reply: 'מה בא לך?', face: 'happy' });
    assert.equal((await say(avi, 'S8-13ג')).reply, 'מה בא לך?', '"עדיין?" after the model\'s question');
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    assert.match((await say(avi, 'S8-13ג')).reply, /^בסדר\. האם אתה עדיין בקיטו\?$/);
    await say(avi, 'כן, עדיין');
    sql('DELETE FROM facts WHERE id = ?', fid); sql("DELETE FROM settings WHERE key LIKE 'learnask:%' OR key LIKE 'ask:%'");
    // her pregnancy: tell the house?
    const gid = sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 2, 'pregnancy', 'בהריון', 1, 2, 2, 1, 'chat', 1, 1)").lastInsertRowid;
    answer = () => ({ reply: 'האם להוסיף חלב לרשימה?', face: 'happy' });
    assert.equal((await say(michal, 'S8-13ג')).reply, 'האם להוסיף חלב לרשימה?', 'the pregnancy question after the model\'s');
    assert.equal(sql('SELECT COUNT(*) AS n FROM settings WHERE key = ?', `preg_asked:${gid}`)[0].n, 0, 'marked, not asked');
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    assert.match((await say(michal, 'S8-13ג')).reply, /^בסדר\. האם לספר לשאר הבית שאת בהריון/);
    await say(michal, 'רק בינינו');
    sql('DELETE FROM facts WHERE id = ?', gid); sql("DELETE FROM settings WHERE key LIKE 'learnask:%' OR key LIKE 'ask:%' OR key LIKE 'preg_asked:%'");
  });
  await check('S8-14', 'א6: בהוראות, תחליפים של הבית הם habit ולא substitute', async () => {
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await turn(avi, 'S8-14');
    assert.ok(sys0().includes('אוכלים בבית תחליפי בשר, חלב או ביצים'));
    assert.match(sys0(), /fact habit על הבית, לא substitute/);
  });
  await check('S8-15', 'ב1: בהוראות: גוף ראשון רבים בבישול; כל שאלה במילת שאלה, גם הצעה לפעולה (שאלה 4), והדוגמאות של המודל איתה; הכינוי בגוף שלישי בזכר, בנקבה וברבים', async () => {
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await turn(avi, 'S8-15');
    assert.ok(sys0().includes('כשמציעים לבשל: גוף ראשון רבים, אתה חלק מהבישול: "שנכין", "האם נשתמש בחזה העוף הטחון?".'));
    assert.ok(sys0().includes('כל שאלה מתחילה במילת שאלה, גם הצעה לפעולה: "האם להוסיף את החלב לרשימה?"'));
    assert.ok(sys0().includes('"אם הוא יאשר, אני אזכור את זה" / "אם היא תאשר…" / "אם הם יאשרו…", לא "אם יאשר"'));
    assert.doesNotMatch(sys0(), /שאלת כן\/לא היא הצעה/, 'the old line');
    // the model's own example questions start with a question word too; what people say stays as they say it
    for (const q of ['"האם להוסיף חלב לרשימה?"', '"האם לקבוע תזכורת ליום ראשון ב-9:00?"', '"האם זה מוצר אחד או שניים?"', '"האם לרשום שקנית 2 קרטוני חלב?"']) assert.ok(sys0().includes(q), q);
    assert.doesNotMatch(sys0(), /\("להוסיף [^"]*לרשימה\?"/, 'an example offer without a question word');
  });

  await check('S8-16', 'ב2: בהוראות: אחרי "מה בא לך?" ותשובה כללית, שאלה שנייה "האם לפי סגנון, או לפי מה שיש בבית?"; בלילה גם קודם שאלה (שאלה 5), בלי הערה על השעה', async () => {
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await turn(avi, 'S8-16');
    assert.ok(sys0().includes('כשהתשובה עוד כללית ("משהו עם חלבון"): שאלה שנייה, בדיוק "האם לפי סגנון, או לפי מה שיש בבית?" (עם "האם" בהתחלה), ורק אז ההצעות.'));
    assert.ok(sys0().includes('"אני רעב" בלילה (23:00–07:00): גם אז קודם השאלה, ואחרי התשובה משהו קל ממה שיש; בלי הערה על השעה.'));
  });

  await check('S8-18', 'ב4: בהוראות: ארוחה משותפת כשמישהו צמחוני, טבעוני או בתקופה: קודם השאלה של the owner, במילת שאלה', async () => {
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await turn(avi, 'S8-18');
    assert.ok(sys0().includes('כשמישהו בבית צמחוני, טבעוני או בתקופה (קיטו, פליאו): קודם שאלה, למשל "האם זו מנה משותפת לשניכם? היא צריכה להיות צמחונית לגמרי, או שתרצה שאציע גרסה צמחונית וגרסה בשרית?"'));
  });

  // ב6: only one keeps kosher → asked in the first meeting how the house goes
  const meeting = (step = 'food') => sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('onboard', ?)", JSON.stringify({ step, user: 1, people: [{ name: 'מיכל', gender: 'f' }], started: Date.now() }));
  const endMeeting = () => sql("DELETE FROM settings WHERE key = 'onboard'");
  const notes = () => sql("SELECT value FROM settings WHERE key = 'house_notes'")[0]?.value || '';
  /** what the meeting said in its last turn: its bubbles are chat rows (the reply is only the last one) */
  const said = (n = 4) => sql("SELECT content FROM chat WHERE role = 'shuki' ORDER BY id DESC LIMIT ?", n).map((r) => JSON.parse(r.content).reply).reverse().join(' | ');
  const parsed = (food) => (body) => (body.tools?.[0]?.name === 'onboard_parse' ? { food } : { reply: 'בסדר.', face: 'happy' });
  await check('S8-20', 'ב6: בהיכרות, "מיכל שומרת כשרות" ובבית לא כשר: "האם כל הבית אוכל כשר, או רק מיכל?" [כל הבית] [רק מיכל]; "כל הבית" כותב "הכל כשר" בהערות לבית', async () => {
    sql("DELETE FROM settings WHERE key = 'house_notes'"); meeting();
    answer = parsed([{ name: 'מיכל', key: 'kosher', value: 'כן', text: 'מיכל שומרת כשרות' }]);
    const r = await call(avi, 'POST', '/api/chat', { text: 'מיכל שומרת כשרות' });
    const bubbles = JSON.stringify(r.data);
    assert.match(bubbles, /האם כל הבית אוכל כשר, או רק מיכל\?/, bubbles.slice(0, 400));
    assert.match(bubbles, /"כל הבית","רק מיכל"/);
    const r2 = await call(avi, 'POST', '/api/chat', { text: 'כל הבית' });
    assert.match(said(2), /^רשמתי בהערות לבית: הכל כשר\. אני אזהיר כשמשהו לא מתאים\. \|/, said(2));
    assert.match(notes(), /הכל כשר/);
    assert.match(said(3), /האם יש משהו בסגנון החיים שלך שכדאי שאדע\?/, 'the meeting did not go on to the lifestyle question (ז2)');
    endMeeting(); sql("DELETE FROM facts WHERE key = 'kosher'");
  });
  await check('S8-21', 'ב6: "רק אבי" (מי שכותב: "או רק אתה?" [רק אני]): "בסדר", בלי כלום בהערות', async () => {
    sql("DELETE FROM settings WHERE key = 'house_notes'"); meeting();
    answer = parsed([{ name: 'אבי', key: 'kosher', value: 'כן', text: 'אבי שומר כשרות' }]);
    const r = await call(avi, 'POST', '/api/chat', { text: 'אני שומר כשרות' });
    assert.match(JSON.stringify(r.data), /האם כל הבית אוכל כשר, או רק אתה\?/);
    assert.match(JSON.stringify(r.data), /"כל הבית","רק אני"/);
    await call(avi, 'POST', '/api/chat', { text: 'רק אני' });
    assert.match(said(2), /^בסדר \| /, said(2));
    assert.equal(notes(), '', 'something was written in the house notes');
    endMeeting(); sql("DELETE FROM facts WHERE key = 'kosher'");
  });
  await check('S8-22', 'ב6: בית שכבר כשר, או שניים ששומרים: לא נשאל', async () => {
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('house_notes', 'הכל כשר')"); meeting();
    answer = parsed([{ name: 'מיכל', key: 'kosher', value: 'כן', text: 'מיכל שומרת כשרות' }]);
    assert.doesNotMatch(JSON.stringify((await call(avi, 'POST', '/api/chat', { text: 'מיכל שומרת כשרות' })).data), /האם כל הבית אוכל כשר/);
    sql("DELETE FROM settings WHERE key = 'house_notes'"); sql("DELETE FROM facts WHERE key = 'kosher'"); meeting();
    answer = parsed([{ name: 'מיכל', key: 'kosher', value: 'כן', text: 'מיכל שומרת כשרות' }, { name: 'אבי', key: 'kosher', value: 'כן', text: 'אבי שומר כשרות' }]);
    assert.doesNotMatch(JSON.stringify((await call(avi, 'POST', '/api/chat', { text: 'שנינו שומרים כשרות' })).data), /האם כל הבית אוכל כשר/);
    endMeeting(); sql("DELETE FROM facts WHERE key = 'kosher'");
  });

  await check('S8-23', 'ב6: בהוראות: קינוח פרווה אחרי בשרי (ו-meat_milk_wait), ולא בודק הכשרים, בלי fixed', async () => {
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await turn(avi, 'S8-23');
    assert.ok(sys0().includes('אחרי מנה בשרית (לפי השיחה) ו"בא לי קינוח": קינוח פרווה; אם בעובדות על הבית יש meat_milk_wait והזמן עבר, אפשר גם חלבי.'));
    assert.ok(sys0().includes('הכשרים של מוצרים אתה לא בודק: על מוצר בלי הכשר, או שאלה אם מוצר כשר, אמור את זה בחצי משפט, בלי fixed ובלי עצה.'));
  });

  // ב7: the guests' restriction is on the hosting list only
  await check('S8-24', 'ב7: אירוח עם note: "(רשימת אירוח, עד …; לאורחים: אורח טבעוני)" בחלק 2; note על אירוח שכבר פתוח נשמר; אחרי ה-until הוא נעלם', async () => {
    answer = () => ({ reply: 'האם יש לאורחים מגבלות באוכל?', face: 'happy', hosting: { name: 'אירוח שישי', date: new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 10) } });
    await say(avi, 'אנחנו מארחים בשישי');
    answer = () => ({ reply: 'סגור, אציע לפי זה.', face: 'happy', hosting: { note: 'אורח טבעוני' } });
    await say(avi, 'אחד האורחים טבעוני');
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await turn(avi, 'S8-24');
    assert.match(requests.at(-1).system[1].text, /=אירוח שישי \(רשימת אירוח פתוחה, לאירוח ביום \S+ [0-9-]+; לאורחים: אורח טבעוני\)/);
    { // 49 (the owner 13/10): the hosting's own day, and its weekday right
      const [, wd, d] = requests.at(-1).system[1].text.match(/לאירוח ביום (\S+) ([0-9-]+)/);
      assert.equal(d, new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 10));
      assert.equal(wd, ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'][new Date(`${d}T12:00:00Z`).getUTCDay()]);
      assert.doesNotMatch(requests.at(-1).system[1].text, /רשימת אירוח פתוחה, עד/);
    }
    assert.equal(sql("SELECT COUNT(*) AS n FROM facts WHERE value LIKE '%טבעונ%'")[0].n, 0, 'a fact was saved');
    // after the hosting: gone with the list
    const stores = JSON.parse(sql("SELECT value FROM settings WHERE key = 'stores'")[0].value).map((x) => (x.note ? { ...x, until: Date.now() - 86400e3 } : x));
    sql("UPDATE settings SET value = ? WHERE key = 'stores'", JSON.stringify(stores));
    await call(avi, 'POST', '/api/__schedule', { now: Date.now() });
    await turn(avi, 'S8-24 אחרי');
    assert.doesNotMatch(requests.at(-1).system[1].text, /לאורחים: אורח טבעוני/);
  });
  await check('S8-24א', 'ב7: חנות שנוספת בהגדרות בזמן אירוח פתוח לא מוחקת את ההערה על האורחים', async () => {
    answer = () => ({ reply: 'האם יש לאורחים מגבלות באוכל?', face: 'happy', hosting: { name: 'אירוח שבת', date: new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 10), note: 'אורחת צמחונית' } });
    await say(avi, 'אנחנו מארחים בשבת, אחת האורחות צמחונית');
    assert.equal((await call(avi, 'POST', '/api/settings', { addStore: 'קצביה' })).status, 200);
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await turn(avi, 'S8-24א');
    assert.match(requests.at(-1).system[1].text, /=אירוח שבת \(רשימת אירוח פתוחה, לאירוח ביום \S+ [0-9-]+; לאורחים: אורחת צמחונית\)/, 'the note went with the new store');
    assert.match(requests.at(-1).system[1].text, /=קצביה/);
  });
  await check('S8-25', 'ב7: בהוראות: אירוח חדש = שאלה אחת על מגבלות; note ולא fact', async () => {
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await turn(avi, 'S8-25');
    assert.ok(sys0().includes('ב-reply של אירוח חדש: שאלה אחת, "האם יש לאורחים מגבלות באוכל?"'));
    assert.ok(sys0().includes('על אירוח שכבר פתוח (ברשימת החנויות כתוב עליו "רשימת אירוח פתוחה"): hosting.note לבד, בלי name; באירוח חדש: name, date ו-note יחד; ה-note הוא כל מה שידוע'));
    assert.ok(sys0().includes('(כשלא ביקשו פריטים באותה הודעה; אם ביקשו, list_add כרגיל.)'));
  });

  await check('S8-15א', 'ב1, השרת עם "האם": "האם להוסיף חלב לרשימה?" כשהחלב כבר ברשימה עובר לנוסח הקבוע "לעדכן ש…? … כבר ברשימה."; "האם להוסיף שנגמר" → "האם לעדכן שנגמר"; "…? האם לשמור את … כמתכון?" שמחכה לכרטיס יורד נקי', async () => {
    const pid = sql("INSERT INTO products (name, count_type, qty, created, updated) VALUES ('חלב 3%', 'units', 1, 1, 1)").lastInsertRowid;
    sql("INSERT INTO list_items (product_id, text, store, source, status, added_by, added, approved) VALUES (?, 'חלב 3%', 'super', 'manual', 'open', 1, 1, 1)", pid);
    answer = () => ({ reply: 'האם להוסיף חלב לרשימה?', face: 'happy', actions: [{ kind: 'op', product_id: Number(pid), op: { type: 'out' } }] });
    const r = await say(avi, 'נגמר החלב');
    assert.equal(r.reply, 'האם לעדכן שנגמר חלב 3%? הוא כבר ברשימה.');
    await call(avi, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
    answer = () => ({ reply: 'האם להוסיף שנגמר החלב?', face: 'happy', actions: [{ kind: 'op', product_id: Number(pid), op: { type: 'low' } }] });
    const r2 = await say(avi, 'כמעט נגמר החלב');
    assert.match(r2.reply, /^האם לעדכן שנגמר החלב\?/);
    await call(avi, 'POST', `/api/proposals/${r2.proposal.id}/reject`, {});
    answer = () => ({ reply: 'בתיאבון! האם להוריד 4 ביצים מהמלאי? האם לשמור את השקשוקה שלך כמתכון?', face: 'happy', actions: [{ kind: 'op', product_id: Number(pid), op: { type: 'use', amount: 1 } }, { kind: 'recipe', name: 'שקשוקה', ingredients: '4 ביצים', recipe_text: 'מבשלים.' }] });
    const r3 = await say(avi, 'הכנו שקשוקה עם 4 ביצים');
    assert.equal(r3.reply, 'בתיאבון! האם להוריד 4 ביצים מהמלאי?', r3.reply);
    if (r3.proposal?.id) await call(avi, 'POST', `/api/proposals/${r3.proposal.id}/reject`, {});
    sql("DELETE FROM settings WHERE key LIKE 'ask:%'"); sql('DELETE FROM list_items WHERE product_id = ?', pid); sql('DELETE FROM products WHERE id = ?', pid);
  });

  await check('S8-26', 'ג1: חסר מצרך אחד ויש תחליף: הצעה בגוף ראשון רבים, במילת שאלה, והכפתור "נשתמש ב…"', async () => {
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await turn(avi, 'S8-26');
    assert.ok(sys0().includes('כשחסר מצרך אחד ובמלאי יש תחליף סביר (חזה עוף טחון במקום פרגית טחונה): הצע גם אותו, בגוף ראשון רבים, למשל "חסרה לנו פרגית טחונה, אבל יש במקפיא חזה עוף טחון. האם להוסיף פרגית טחונה לרשימה, או שנשתמש בחזה העוף הטחון?", עם options ["להוסיף לרשימה","נשתמש בחזה העוף הטחון"].'), 'כשחסר מצרך אחד ובמלאי יש תחליף');
  });

  await check('S8-27', 'ג2: "מה זה X?" = סיכום במשפט אחד, לא המתכון (r9-22, r9-111)', async () => {
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await turn(avi, 'S8-27');
    assert.ok(sys0().includes('"מה זה X?" על מנה ("מה זה שמיכת דאמפלינג?"): סיכום קצר במשפט אחד, לא המתכון, למשל "שמיכת דאמפלינג היא מנה של בשר או תחליף על מחבת, מכוסה בעלי גיוזה."'), '"מה זה X?" על מנה ("מה זה שמיכ');
  });

  await check('S8-31', 'ג4: "מה לאכול?" של ילד = ממה שיש, מוכן לאכול', async () => {
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await turn(avi, 'S8-31');
    assert.ok(sys0().includes('"מה לאכול?" של ילד: ממה שיש במקרר ובמזווה, מוכן לאכול, בלי בישול.'), '"מה לאכול?" של ילד: ממה שיש במ');
  });

  await check('S8-37', 'ג9: להקפיא (שאלה על ההקשר), קופסה לעבודה (המשפט של the owner, במילת שאלה), הכנה מראש (כמה ומתי)', async () => {
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await turn(avi, 'S8-37');
    assert.ok(sys0().includes('"משהו שאפשר להקפיא": שאלה אחת על ההקשר (מנה שמכינים ומקפיאים, או משהו קפוא כמו גלידה). "קופסה לעבודה מחר": "האם תרצה משהו שכבר הכנת היום, או להכין מנה חדשה שתתאים לקחת לעבודה?". "מה להכין מראש לשבוע?": שאלה כמה ארוחות ומתי.'), '"משהו שאפשר להקפיא": שאלה אחת ');
  });

  const KEEP = 'אם היה לכם טעים ותרצו לשמור אותו, כתבו לי.';
  await check('S8-28', 'ג3: רעיון כללי (idea): השרת מוסיף בסוף את המשפט של the owner, פעם אחת, לכולם', async () => {
    answer = () => ({ reply: 'פשטידת ברוקולי: ברוקולי, 3 ביצים ושמנת, 40 דקות בתנור. זה לא מהמתכונים ששמרתם.', face: 'happy', idea: true });
    assert.equal((await say(michal, 'איך מכינים פשטידת ברוקולי?')).reply, `פשטידת ברוקולי: ברוקולי, 3 ביצים ושמנת, 40 דקות בתנור. זה לא מהמתכונים ששמרתם. ${KEEP}`);
    answer = () => ({ reply: `הנה רעיון. ${KEEP}`, face: 'happy', idea: true });
    assert.equal((await say(avi, 'רעיון לארוחה?')).reply, `הנה רעיון. ${KEEP}`, 'twice');
    assert.ok(sys0().includes('ו-idea=true (השרת מוסיף את ההצעה לשמור)'));
    answer = () => ({ reply: 'אפשר פשטידה או מרק. איזה מהם בא לך?', face: 'happy', idea: true });
    assert.equal((await say(michal, 'רעיונות לארוחת ערב?')).reply, 'אפשר פשטידה או מרק. איזה מהם בא לך?', 'after a question');
  });
  await check('S8-29', 'ג3: עם כרטיס, או לילד: בלי המשפט', async () => {
    answer = () => ({ reply: 'האם להוסיף ברוקולי לרשימה?', face: 'happy', idea: true, actions: [{ kind: 'list_add', text: 'ברוקולי' }] });
    const r = await say(avi, 'איך מכינים פשטידת ברוקולי? ותוסיף את מה שחסר');
    assert.doesNotMatch(r.reply, /כתבו לי/); if (r.proposal?.id) await call(avi, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
    answer = () => ({ reply: 'אפשר להכין כריך.', face: 'happy', idea: true });
    assert.doesNotMatch((await say(yoavi, 'מה אני יכול להכין?')).reply, /כתבו לי/, 'a child');
  });

  await check('S8-32', 'ג5: "לא אכפת לי" (אחרי "איזה סגנון?"): בחלק 4 "הסוג שיש בו הכי הרבה מתכונים שמורים: ארוחות ערב (3)"; בלי המילים האלה, בלי השורה', async () => {
    await call(avi, 'POST', '/api/__recipes', { recipes: [
      { name: 'קציצות', ingredients: 'בשר טחון\nבצל', text: 'מטגנים.', tags: 'ארוחות ערב', serves: 4 },
      { name: 'מוקפץ', ingredients: 'אטריות\nירקות', text: 'מקפיצים.', tags: 'ארוחות ערב, אסייתי', serves: 4 },
      { name: 'פסטה פסטו', ingredients: 'פסטה\nפסטו', text: 'מבשלים.', tags: 'ארוחות ערב', serves: 4 },
      { name: 'מרק עגבניות', ingredients: 'עגבניות\nבצל', text: 'מבשלים.', tags: 'מרקים', serves: 4 },
    ] });
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await turn(avi, 'לא אכפת לי');
    const part4 = requests.at(-1).system.map((b) => b.text).join('\n'); // the recipes in play are in the message's part (0e)
    assert.match(part4, /הסוג שיש בו הכי הרבה מתכונים שמורים: ארוחות ערב \(3\)/);
    await turn(avi, 'משהו אחר');
    assert.doesNotMatch(requests.at(-1).system.map((b) => b.text).join('\n'), /הסוג שיש בו הכי הרבה מתכונים שמורים:/); // the server's line, not the instruction's words
    assert.ok(sys0().includes('"בא לי מתוק": משהו מתוק שיש במזווה, ו"אם התכוונת לקינוח, אפשר להכין אחד."'));
  });

  await check('S8-01ד', '0.5: "מה לבשל?" של צמחונית: מתכון עם ⚠ עליה לא ברשימת ההצעות שהשרת שולח; לאבי כן; בשם שלו הוא נשאר; כשהיא מבקשת דג, הסלמון כן (החריג של הדגים)', async () => {
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 2, 'diet', 'צמחונית', 1, 2, 2, 0, 'chat', 1, 1)");
    await call(avi, 'POST', '/api/__recipes', { recipes: [{ name: 'שניצל עוף', ingredients: 'חזה עוף\nפירורי לחם', text: 'מטגנים.', tags: 'עוף', serves: 4 }, { name: 'סלט חומוס', ingredients: 'חומוס\nלימון', text: 'מערבבים.', tags: 'סלטים', serves: 2 }, { name: 'סלמון בתנור', ingredients: 'פילה סלמון\nלימון', text: 'אופים.', tags: 'דגים', serves: 2 }] });
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    const rowsOf = () => { const t = requests.at(-1).system.map((b) => b.text).join('\n'); const i = t.indexOf('מתכונים שמתאימים להודעה'); return i < 0 ? '' : t.slice(i); };
    await turn(michal, 'מה לבשל הערב?');
    assert.match(rowsOf(), /סלט חומוס/, 'no suggestions at all');
    assert.doesNotMatch(rowsOf(), /שניצל עוף/, 'the schnitzel is suggested to a vegetarian');
    assert.doesNotMatch(rowsOf(), /סלמון בתנור/, 'the salmon is suggested to a vegetarian who did not ask for fish');
    const top = sql('SELECT MAX(id) AS m FROM chat')[0].m; // these turns leave no messages (the morning cards of S8-02 on come after them by time)
    await turn(michal, 'מה לבשל הערב עם דג?');
    assert.match(rowsOf(), /סלמון בתנור/, 'she asked for fish (§9, the fish exception)');
    assert.doesNotMatch(rowsOf(), /שניצל עוף/, 'asking for fish lets the schnitzel in');
    await turn(michal, 'איך מכינים שניצל עוף?');
    assert.match(requests.at(-1).system.map((b) => b.text).join('\n'), /מתכון "שניצל עוף":\nמצרכים:/, 'the recipe she named is gone');
    sql('DELETE FROM chat WHERE id > ?', top);
    sql("DELETE FROM settings WHERE key LIKE 'ask:%' OR key LIKE 'askq:%' OR key LIKE 'ask_once:%'");
    await turn(avi, 'מה לבשל הערב?');
    assert.match(rowsOf(), /שניצל עוף/, 'not suggested to Avi either');
    sql("DELETE FROM facts WHERE about_id = 2 AND key = 'diet'");
  });

  await check('S8-34', 'ג6: מתכון של שוקי מסומן "(מתכון שכתבת)" ברשימת המתכונים; ההוראה על "יצא מלוח"', async () => {
    await call(avi, 'POST', '/api/__recipes', { recipes: [{ name: 'פשטידת תרד', ingredients: 'תרד\nביצים', text: 'אופים.', tags: 'מאפים', serves: 4 }] });
    sql("UPDATE recipes SET source = 'shuki' WHERE name = 'פשטידת תרד'");
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await turn(avi, 'S8-34');
    assert.match(requests.at(-1).system[1].text, /פשטידת תרד \[מאפים\] \(ל-4\) \(מתכון שכתבת\)/);
    await turn(avi, 'איך מכינים פשטידת תרד?');
    assert.match(requests.at(-1).system.map((b) => b.text).join('\n'), /מתכון "פשטידת תרד" \(מתכון שכתבת\):/, 'the full recipe');
    assert.doesNotMatch(requests.at(-1).system[1].text, /שקשוקה[^\n]*\(מתכון שכתבת\)/);
    assert.ok(sys0().includes('מתכון שכתוב עליו "(מתכון שכתבת)": התנצל בקצרה, face sad.'));
  });
  await check('S8-35', 'ג6: recipe_note: הכרטיס "להוסיף למתכון של פשטידת התרד הערה: \'פחות מלח\'", ואחרי האישור השורה בסוף אופן ההכנה; מתכון שלא קיים: לא כרטיס', async () => {
    answer = () => ({ reply: 'אפשר להוסיף תפוח אדמה כדי לספוג מלח. האם להוסיף הערה למתכון?', face: 'sad', actions: [{ kind: 'recipe_note', name: 'פשטידת תרד', text: 'פחות מלח' }] });
    const r = await say(avi, 'פשטידת התרד יצאה מלוחה מדי');
    assert.equal(r.proposal?.lines?.[0]?.text, "להוסיף למתכון של פשטידת התרד הערה: 'פחות מלח'?");
    assert.equal((await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {})).status, 200);
    assert.match(sql("SELECT text FROM recipes WHERE name = 'פשטידת תרד'")[0].text, /\nהערה: פחות מלח$/);
    answer = () => ({ reply: 'האם להוסיף הערה?', face: 'sad', actions: [{ kind: 'recipe_note', name: 'עוגה שלא קיימת', text: 'פחות סוכר' }] });
    assert.equal((await say(avi, 'העוגה יצאה מתוקה מדי')).proposal, undefined, 'a card for a recipe that isn\'t saved');
  });

  // ג10: favourite dishes
  const favOf = (n) => sql('SELECT favorite FROM recipes WHERE name = ?', n)[0]?.favorite;
  await check('S8-38', 'ג10: "השקשוקה הייתה מעולה": כרטיס "לסמן את השקשוקה כמנה מועדפת", ואחרי האישור "(מועדפת)" ברשימת המתכונים; ב-state יש favorite', async () => {
    await call(avi, 'POST', '/api/__recipes', { recipes: [{ name: 'שקשוקה', ingredients: '4 ביצים\nעגבניות', text: 'מבשלים.', tags: 'ארוחות בוקר', serves: 2 }] });
    answer = () => ({ reply: 'איזה כיף! האם לסמן את השקשוקה כמנה מועדפת?', face: 'excited', actions: [{ kind: 'favorite', name: 'שקשוקה' }] });
    const r = await say(avi, 'השקשוקה הייתה מעולה');
    assert.equal(r.proposal?.lines?.[0]?.text, 'לסמן את השקשוקה כמנה מועדפת?');
    assert.equal((await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {})).status, 200);
    assert.equal(favOf('שקשוקה'), 1);
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await turn(avi, 'S8-38');
    assert.match(requests.at(-1).system[1].text, /שקשוקה \[ארוחות בוקר\] \(ל-2\) \(מועדפת\)/);
    assert.equal((await call(avi, 'GET', '/api/state')).data.recipes.find((x) => x.name === 'שקשוקה')?.favorite, 1);
    assert.ok(sys0().includes('"האם תרצה שאתאים את המנות המועדפות לקיטו?"'));
  });
  await check('S8-39', 'ג10: off מוריד ("להוריד את השקשוקה מהמנות המועדפות"); הכפתור בדף המתכון (POST favorite) מסמן ומוריד; ילד לא', async () => {
    answer = () => ({ reply: 'בסדר. האם להוריד?', face: 'happy', actions: [{ kind: 'favorite', name: 'שקשוקה', off: true }] });
    const r = await say(avi, 'השקשוקה כבר לא מועדפת');
    assert.equal(r.proposal?.lines?.[0]?.text, 'להוריד את השקשוקה מהמנות המועדפות?');
    await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    assert.equal(favOf('שקשוקה'), 0);
    const id = sql("SELECT id FROM recipes WHERE name = 'שקשוקה'")[0].id;
    assert.equal((await call(avi, 'POST', `/api/recipes/${id}/favorite`, { on: true })).status, 200); assert.equal(favOf('שקשוקה'), 1);
    assert.equal((await call(yoavi, 'POST', `/api/recipes/${id}/favorite`, { on: false })).status, 403); assert.equal(favOf('שקשוקה'), 1);
  });
  await check('S8-40', 'ג10: ילד שאומר "היה מעולה": בלי כרטיס של מנה מועדפת (שאלה 33)', async () => {
    answer = () => ({ reply: 'איזה כיף!', face: 'excited', actions: [{ kind: 'favorite', name: 'שקשוקה', off: true }] });
    const r = await say(yoavi, 'השקשוקה הייתה מעולה');
    assert.ok(!(r.proposal?.lines || []).some((l) => /מועדפ/.test(l.text)));
    assert.equal(favOf('שקשוקה'), 1);
  });

  await check('S8-40א', 'ג6/ג10: "the" בשורת הכרטיס ("עוגת הלימון", "הסלמון בתנור", "חזה העוף"; "סלט יווני" במירכאות, שאלה 35); ילד: בלי הערה; כוכב שכבר דולק: בלי כרטיס; מתכון שמחכה לאישור: בלי כוכב', async () => {
    await call(avi, 'POST', '/api/__recipes', { recipes: ['עוגת לימון', 'סלמון בתנור', 'חזה העוף', 'סלט יווני'].map((name) => ({ name, ingredients: 'מלח', text: 'מכינים.', tags: 'ארוחות ערב', serves: 2 })) });
    for (const [name, line] of [['עוגת לימון', 'עוגת הלימון'], ['סלמון בתנור', 'הסלמון בתנור'], ['חזה העוף', 'חזה העוף'], ['סלט יווני', '"סלט יווני"']]) {
      answer = () => ({ reply: 'אפשר להוסיף מעט מים. האם להוסיף הערה למתכון?', face: 'sad', actions: [{ kind: 'recipe_note', name, text: 'פחות מלח' }] });
      const r = await say(avi, `${name} יצא מלוח`);
      assert.equal(r.proposal?.lines?.[0]?.text, `להוסיף למתכון של ${line} הערה: 'פחות מלח'?`);
      await call(avi, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
    }
    answer = () => ({ reply: 'אוי. האם להוסיף הערה?', face: 'sad', actions: [{ kind: 'recipe_note', name: 'עוגת לימון', text: 'פחות מלח' }] });
    const kid = await say(yoavi, 'העוגה יצאה מלוחה');
    assert.ok(!kid.proposal, 'a child gets a note card');
    assert.equal(kid.reply, 'אוי.', 'the question of a card that went stays');
    answer = () => ({ reply: 'איזה כיף! האם לשמור את השקשוקה כמנה מועדפת?', face: 'excited', actions: [{ kind: 'favorite', name: 'שקשוקה' }] });
    assert.equal(favOf('שקשוקה'), 1);
    const on = await say(avi, 'השקשוקה הייתה מעולה');
    assert.ok(!on.proposal, 'a card for a star already on');
    assert.equal(on.reply, 'איזה כיף!');
    sql("INSERT INTO recipes (name, ingredients, text, tags, added, added_by, status, suggested_by) VALUES ('עוגיות', 'קמח', 'אופים.', 'קינוחים', 1, 3, 'suggested', 3)");
    const sid = sql("SELECT id FROM recipes WHERE name = 'עוגיות'")[0].id;
    assert.equal((await call(avi, 'POST', `/api/recipes/${sid}/favorite`, { on: true })).status, 400);
    sql('DELETE FROM recipes WHERE id = ?', sid);
  });

  await check('S8-47', 'המטמון: רשימת אירוח פתוחה לא משנה את החלק הראשון (הכלים וההוראות); חנות של אירוח היא "hosting" בכלים', async () => {
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    const head = () => JSON.stringify({ tools: requests.at(-1).tools, s0: requests.at(-1).system[0] });
    await turn(avi, 'S8-47');
    const before = head();
    const was = sql("SELECT value FROM settings WHERE key = 'stores'")[0]?.value; // the house's own stores stay as they are
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('stores', ?)", JSON.stringify([...JSON.parse(was || '[]'), { id: 'e1', name: 'אירוח שישי', until: Date.now() + 4 * 86400e3, note: 'אורח טבעוני' }]));
    await turn(avi, 'S8-47');
    assert.equal(head(), before, 'an open hosting changed the cached start');
    assert.match(requests.at(-1).system[1].text, /e1=אירוח שישי \(רשימת אירוח פתוחה/, "the hosting isn't in the house's part");
    if (was) sql("UPDATE settings SET value = ? WHERE key = 'stores'", was); else sql("DELETE FROM settings WHERE key = 'stores'");
  });

  await check('S8-47א', 'אירוח: "hosting" עם שתי רשימות פתוחות הולך לזו שההודעה מזכירה ("לארוחת החג"), ובלי שם לראשונה; קניות ב-"hosting" פותחות את רשימת האירוח, לא את הסופר', async () => {
    const was = sql("SELECT value FROM settings WHERE key = 'stores'")[0]?.value;
    const until = Date.now() + 4 * 86400e3;
    const open = (a, b) => sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('stores', ?)", JSON.stringify([...JSON.parse(was || '[]').filter((x) => !x.until), { id: 'e1', name: a, until }, { id: 'e2', name: b, until }])); // only these two open
    open('אירוח שישי', 'ארוחת חג');
    const storeOf = async (text) => {
      answer = () => ({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'list_add', text: 'יין', store: 'hosting' }] });
      const r = await say(avi, text);
      const line = r.proposal?.lines?.[0]; await call(avi, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
      return JSON.parse(sql('SELECT actions FROM proposals WHERE id = ?', r.proposal.id)[0].actions).actions[0].store ?? line;
    };
    assert.equal(await storeOf('תוסיף יין לארוחת החג'), 'e2');
    assert.equal(await storeOf('תוסיף יין לאירוח'), 'e1');
    open('ארוחת שישי', 'ארוחת חג'); // a word they share doesn't decide; "חג" does
    assert.equal(await storeOf('תוסיף יין לארוחת החג'), 'e2');
    assert.equal(await storeOf('תוסיף יין לארוחת שישי'), 'e1');
    assert.equal(await storeOf('תוסיף יין לארוחה'), 'e1', 'no word of its own: the first');
    open('יום הולדת', 'ארוחת חג');
    assert.equal(await storeOf('תוסיף יין, היום בערב אחרי החג'), 'e2', '"יום" inside "היום"');
    assert.equal(await storeOf('תוסיף יין, מהיום עד החג'), 'e2', '"יום" inside "מהיום"');
    open('אירוח של סבתא', 'ארוחת חג');
    assert.equal(await storeOf('תוסיף יין לחג של המשפחה'), 'e2', '"של" names no list');
    open('בר מצווה', 'ארוחת חג');
    assert.equal(await storeOf('כבר נגמר, תוסיף יין לארוחת החג'), 'e2', '"בר" inside "כבר"');
    open('אירוח שישי', 'ארוחת חג');
    answer = () => ({ reply: 'קניות נעימות!', face: 'happy', shopping: 'start', store: 'hosting' });
    await say(avi, 'אני בסופר, קונה לארוחת החג');
    assert.equal((await call(avi, 'GET', '/api/state')).data.shopping.find((x) => x.mine)?.store, 'e2');
    await call(avi, 'POST', '/api/shopping', { on: false });
    if (was) sql("UPDATE settings SET value = ? WHERE key = 'stores'", was); else sql("DELETE FROM settings WHERE key = 'stores'");
  });

  await check('S8-48', 'שאלה 39: "האם" לפני שאלת כן/לא של המודל שמתחילה ב"רוצה", "רוצים", "רוצות", "תרצה/תרצי/תרצו" או "בא לך", וגם "יש" (שאלה 48), גם אחרי משפט; "רוצה" לפי מי שכותב; לא פעמיים; שאלת "או", "האם תרצה שאזכור" ו"מה" כמו שהן', async () => {
    const top = sql('SELECT MAX(id) AS m FROM chat')[0].m; // these turns leave no messages (the morning cards of S8-02 on come after them by time)
    const reply = async (t, said) => { answer = () => ({ reply: said, face: 'happy' }); return (await say(t, 'S8-48')).reply; };
    for (const [t, said, want] of [
      [avi, 'רוצה גרסה טבעונית?', 'האם תרצה גרסה טבעונית?'],
      [michal, 'שימי לב, יש ביצים. רוצה גרסה טבעונית במקום?', 'שימי לב, יש ביצים. האם תרצי גרסה טבעונית במקום?'],
      [avi, 'אתם בבית? רוצים שאציע משהו?', 'אתם בבית? האם תרצו שאציע משהו?'],
      [michal, 'רוצות משהו מתוק?', 'האם תרצו משהו מתוק?'],
      [avi, 'תרצה שאציע משהו?', 'האם תרצה שאציע משהו?'],
      [michal, 'תרצי רעיון?', 'האם תרצי רעיון?'],
      [avi, 'תרצו משהו קל?', 'האם תרצו משהו קל?'],
      [yoavi, 'יש פיתות וחומוס, או יוגורט. בא לך משהו מזה?', 'יש פיתות וחומוס, או יוגורט. האם בא לך משהו מזה?'],
      [avi, 'בא לכם קינוח?', 'האם בא לכם קינוח?'],
      [avi, 'האם תרצה גרסה טבעונית?', 'האם תרצה גרסה טבעונית?'],
      [avi, 'האם בא לך משהו קל?', 'האם בא לך משהו קל?'],
      // home20 round 3: to Michal by her name is caught now (fix 2), so to Avi
      [avi, 'מיכל טבעונית, אז זו צריכה להיות טבעונית לגמרי, או שנכין גם גרסה עם ביצים?', 'מיכל טבעונית, אז זו צריכה להיות טבעונית לגמרי, או שנכין גם גרסה עם ביצים?'],
      [avi, 'בא לך עוגיות או שוקולד?', 'בא לך עוגיות או שוקולד?'],
      [avi, 'מה בא לך?', 'מה בא לך?'],
      [avi, 'רוצה שאזכור שאתה צמחוני?', 'האם תרצה שאזכור שאתה צמחוני?'], [michal, 'רוצה שאשמור את המתכון?', 'האם תרצי שאשמור את המתכון?'], [michal, 'רוצים שאזכור שאת צמחונית?', 'האם תרצי שאזכור שאת צמחונית?'], [avi, 'האם תרצה שאזכור שאתה צמחוני?', 'האם תרצה שאזכור שאתה צמחוני?'],
      [avi, 'רוצהלה?', 'רוצהלה?'],
      [avi, 'יש משהו אחר מהיר שתרצה?', 'האם יש משהו אחר מהיר שתרצה?'],
      [michal, 'אין חלב. יש לך תחליף?', 'אין חלב. האם יש לך תחליף?'],
      [avi, 'האם יש עוד משהו?', 'האם יש עוד משהו?'],
      [avi, 'יש לך חלב או סויה?', 'יש לך חלב או סויה?'],
      [avi, 'יש! מה עוד?', 'יש! מה עוד?'],
      [avi, 'ישנה עוד שאלה?', 'ישנה עוד שאלה?'],
      [avi, 'יש לכם ביצים ועגבניות, אז מה דעתכם על שקשוקה?', 'יש לכם ביצים ועגבניות, אז מה דעתכם על שקשוקה?'],
      [avi, 'יש לי רעיון: מה דעתך על פסטה?', 'יש לי רעיון: מה דעתך על פסטה?'],
      [avi, 'יש עוף בבית, תרצה שנכין שניצל?', 'יש עוף בבית, תרצה שנכין שניצל?'],
    ]) assert.equal(await reply(t, said), want, said);
    sql("UPDATE users SET gender = 'p' WHERE id = 2");
    assert.equal(await reply(michal, 'רוצה רעיון?'), 'האם תרצו רעיון?');
    sql("UPDATE users SET gender = 'f' WHERE id = 2");
    sql('DELETE FROM chat WHERE id > ?', top);
    sql("DELETE FROM settings WHERE key LIKE 'learnask:%' OR key LIKE 'ask:%' OR key LIKE 'askq:%'");
  });

  // ד: food and the body (docs/stage8-plan.md, ד1–ד5)
  await check('S8-41', 'ד1, ד2, ד3, ד4: ההוראות (טווח ו"זו הערכה"; "לא תזונאי"; "הרסתי"; "תרשום שאכלתי" במילת שאלה)', async () => {
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await turn(avi, 'S8-41');
    for (const t of ['"בשקשוקה לשניים יש בערך 250–350 קלוריות למנה. זו הערכה."', 'אני לא תזונאי ולא אפליקציית כושר, אז כדאי להתייעץ עם איש מקצוע. אם תגיד לי מה המטרה שלך, אציע מנות שמתאימות לה.', '"לעלות במסה": גם שאלה כמה ארוחות ביום.', '"הרסתי" (אכלתי פיצה שלמה), "יום מחורבן": הודעה חמה אחת, בלי עצות, ואז עצור', '"די, נשברתי" כשיש לו period (דיאטה)', 'אני לא עוקב אחרי מה שאוכלים, אבל אשמח לעדכן את המלאי. האם להוריד 2 פרוסות לחם?', 'מה שהרופא אמר לאכול או לא לאכול ("הרופא אמר לי להפחית מלח", "אסור לי סוכר"): לא שאלה רפואית, בלי fixed (ד5); שאלה על תרופה או מינון באותה הודעה: כן medical.', 'קלוריות, משקל או יעד ("כמה קלוריות יש בבמבה?", "אני רוצה לרזות"): fixed=child_food.', 'זו הערכה." (חוץ ממי שבעובדות שלו "health: בלי קלוריות ומשקל")'])
      assert.ok(sys0().includes(t), t);
  });
  await check('S8-41א', 'ט2 (s7-p5-pita): מי שביקש בלי מספרים ושואל על קלוריות: השורה ליד ההודעה שלו', async () => {
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 2, 'health', 'בלי קלוריות ומשקל', 1, 2, 2, 1, 'chat', 1, 1)");
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await turn(michal, 'כמה קלוריות יש בפיתה?');
    assert.match(JSON.stringify(requests.at(-1).messages.at(-1)), /מיכל ביקשה בלי מספרים של קלוריות ומשקל: בלי שום מספר של קלוריות, משקל או ערכים תזונתיים/);
    for (const t of ['נגמר הסוכר', 'נגמרה אבקת החלבון', 'יש לי סוכריות?']) {
      await turn(michal, t);
      assert.doesNotMatch(JSON.stringify(requests.at(-1).messages.at(-1)), /בלי שום מספר/, t);
    }
    sql("DELETE FROM facts WHERE key = 'health' AND about_id = 2");
  });
  await check('S8-42', 'ד2 (שאלה 19): ילד ששואל על קלוריות: fixed=child_food, אותן מילים כמו child_alcohol, גם בבית עם הורה ברבים; מבוגר: לא', async () => {
    const asChild = async (fixed) => { answer = () => ({ reply: 'יש בערך 500.', face: 'happy', fixed }); return (await say(yoavi, 'כמה קלוריות יש בבמבה?')).reply; };
    const food = await asChild('child_food');
    assert.match(food, /^את זה כדאי לשאול את /);
    assert.equal(food, await asChild('child_alcohol'));
    sql("UPDATE users SET gender = 'p' WHERE id = 2");
    assert.equal(await asChild('child_food'), await asChild('child_alcohol'));
    sql("UPDATE users SET gender = 'f' WHERE id = 2");
    answer = () => ({ reply: 'יש בערך 500.', face: 'happy' }); // round C: the model gave the number; the server knows a child's words
    assert.equal((await say(yoavi, 'כמה קלוריות יש בבמבה?')).reply, food);
    for (const t of ['אני רוצה לרדת במשקל', 'אני שמנה מדי', 'אני רוצה לרדת 3 ק״ג', 'השמנתי', 'אני שוקלת 30 קילו, זה הרבה?', 'ירדתי לפחות 2 קילו', 'אני שוקלת שלושים קילו, זה הרבה?'])
      assert.equal((await say(yoavi, t)).reply, food, t);
    answer = () => ({ reply: 'אפשר דיאטה.', face: 'happy', actions: [{ kind: 'fact', key: 'period', about: 'יואבי', value: 'דיאטה', text: 'יואבי בדיאטה' }] });
    assert.equal((await say(yoavi, 'אני רוצה לרזות')).reply, food, 'a fact let it through');
    answer = () => ({ reply: 'יש בערך 500.', face: 'happy' });
    for (const t of ['כמה משקל יש לקמח במתכון?', 'אני שוקל אם להכין פסטה או פיצה', 'הרוטב יצא שמן מדי', 'ירדתי לקנות קילו עגבניות', 'אני שוקלת חצי קילו קמח לעוגה', 'עליתי עם קילו תפוזים', 'אני שמה שמן מדי בסלט?', 'אני שוקל 2 קילו קמח', 'אני שוקל 2 קילו של קמח'])
      assert.equal((await say(yoavi, t)).reply, 'יש בערך 500.', t);
    answer = () => ({ reply: 'להוסיף?', face: 'happy', actions: [{ kind: 'list_add', text: 'משקל מטבח' }] });
    assert.notEqual((await say(yoavi, 'תוסיף משקל מטבח לרשימה, אני רוצה לרדת במשקל')).reply, food, 'the fixed words took a child\'s request');
    answer = () => ({ reply: 'יש בערך 500.', face: 'happy' });
    assert.equal((await say(avi, 'כמה קלוריות יש בבמבה?')).reply, 'יש בערך 500.');
    answer = () => ({ reply: 'יש בערך 500.', face: 'happy', fixed: 'child_food' });
    assert.equal((await say(avi, 'כמה קלוריות יש בבמבה?')).reply, 'יש בערך 500.');
  });
  await check('S8-45', 'ד5: קיטו מסמן ⚠ על פסטה ולא על חביתה; פליאו מסמן גבינה ועדשים; "דיאטה" בלי ⚠', async () => {
    await call(avi, 'POST', '/api/__recipes', { recipes: [{ name: 'פסטה עם גבינה', ingredients: 'פסטה\nגבינה צהובה', text: 'מבשלים.', tags: 'פסטה', serves: 2 }, { name: 'חביתה', ingredients: 'ביצים\nשמן', text: 'מטגנים.', tags: 'ארוחות בוקר', serves: 1 }, { name: 'עוגת קיטו', ingredients: 'קמח שקדים\nתחליף סוכר\nביצים', text: 'אופים.', tags: 'קינוחים', serves: 4 }, { name: 'מרק עדשים', ingredients: 'עדשים\nבצל', text: 'מבשלים.', tags: 'מרקים', serves: 4 }, { name: 'מוקפץ', ingredients: 'שמן סויה\nכרוב', text: 'מקפיצים.', tags: 'ארוחות ערב', serves: 2 }] });
    const period = (v) => { sql("DELETE FROM facts WHERE key = 'period' AND about_id = 1"); sql("INSERT INTO facts (about, about_id, key, value, since, until, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 1, 'period', ?, 1, ?, 1, 1, 0, 'chat', 1, 1)", v, Date.now() + 30 * 86400e3); };
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    period('קיטו'); await turn(avi, 'S8-45');
    const part = () => requests.at(-1).system[1].text;
    assert.match(part(), /פסטה עם גבינה[^\n]*\n  ⚠ אבי, תקופה: קיטו\. במתכון: פסטה/);
    assert.doesNotMatch(part(), /חביתה[^\n]*\n  ⚠ אבי/);
    assert.doesNotMatch(part(), /עוגת קיטו[^\n]*\n  ⚠ אבי/, '"קמח שקדים", "תחליף סוכר" are made for keto');
    period('פליאו'); await turn(avi, 'S8-45');
    assert.match(part(), /⚠ אבי, תקופה: פליאו\. במתכון: פסטה, גבינה צהובה/);
    assert.match(part(), /⚠ אבי, תקופה: פליאו\. במתכון: עדשים/);
    assert.match(part(), /⚠ אבי, תקופה: פליאו\. במתכון: שמן סויה/, 'a legume oil on paleo');
    period('דיאטה'); await turn(avi, 'S8-45');
    assert.doesNotMatch(part(), /⚠ אבי, תקופה/);
    sql("DELETE FROM facts WHERE key = 'period' AND about_id = 1");
  });
  await check('S8-46', 'ד5: השורות על צום, מלח, סוכרת, ירקות ו"בריא"', async () => {
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await turn(avi, 'S8-46');
    for (const t of ['בקיטו, פליאו או טבעונות, על מצרך שאתה לא בטוח בו: שאלה אחת.', 'צום לסירוגין (fasting עם חלון): מציע רק בחלון האכילה', 'דל נתרן או בלי מלח: fact avoid "מלח"', '"יש לי סוכרת": "האם לשים לב לזה בהצעות?"; כן = fact health (פרטי).', '"יותר ירקות": habit, ומשלבים בשקט.', '"משהו בריא": לפי העובדות של מי ששואל.'])
      assert.ok(sys0().includes(t), t);
  });

  await check('S8-49', 'ה1, ה2: face strong עובר את הסינון ומגיע לאפליקציה; ההוראות על אימונים, במילים של the owner עם "האם" (שאלה 37)', async () => {
    answer = () => ({ reply: 'איזה כיף! האם תרצה שנכין ביחד משהו מומלץ?', face: 'strong' });
    const r = await turn(avi, 'אני אחרי אימון');
    assert.equal(r.face, 'strong');
    assert.ok(requests.at(-1).tools[0].input_schema.properties.face.enum.includes('strong'));
    for (const t of ['אחרי אימון: face strong, "איזה כיף! האם תרצה שנכין ביחד משהו מומלץ?"', '"מחר בבוקר אימון": רק "בהצלחה!"', '"מרתון בשבת": "בהצלחה!" ושאלה אם לעזור עם האוכל.', 'אימון ואין אוכל בבית: "האם תרצה', '"האם תרצה ללכת לקנות אוכל, או שנכין משהו ממה שיש?"', 'אבקת חלבון: מוצר רגיל, בלי המלצה על תוספים', 'שמעת שמישהו מתאמן: שאלה אחת אם לזכור (training)', 'strong רק אחרי אימון'])
      assert.ok(sys0().includes(t), t);
  });

  // ו: special days (docs/stage8-plan.md, ו1–ו6)
  await check('S8-50', 'ו1: "יש לי דייט הערב" → reaction love (מ4); "אין לי כוח לדייטים" בלי; ו1, ו3, ו4, ו6 בהוראות', async () => {
    answer = () => ({ reply: 'בהצלחה!', face: 'happy' });
    assert.equal((await turn(avi, 'יש לי דייט הערב')).reaction, 'love');
    assert.equal((await say(avi, 'הולכת לדייט מחר')).reaction, 'love');
    for (const t of ['אני בדייט', 'ויש לי מחר דייט', 'יש לי דייט עיוור'])
      assert.equal((await say(avi, t)).reaction, 'love', t);
    for (const t of ['נמאס לי מדייטים', 'לא יוצא לדייטים', 'הדייט ביטל לי', 'אפליקציית הדייטינג נתקעה'])
      assert.notEqual((await say(avi, t)).reaction, 'love', t);
    answer = () => ({ reply: 'אני כאן איתך.', face: 'sad', eating: true, personal: true });
    assert.notEqual((await say(avi, 'יש לי דייט ולא אכלתי יומיים כדי לרזות')).reaction, 'love', 'hearts on an eating disorder');
    answer = () => ({ reply: 'בהצלחה!', face: 'happy' });
    for (const t of ['דייט ("יש לי דייט"): רק "בהצלחה!", ועזרה בבישול רק כשמבקשים.', '"איזה כיף! את מי אתה מעודד? האם תרצה שנחשוב ביחד על אוכל ושתייה?"', 'מנגל (רק כששואלים): השאלות בזו אחר זו, אחת בכל הודעה', '"רפואה שלמה! האם תרצה שנכין משהו שיעזור לך להחלים, תה עם לימון או משהו אחר? מה בא לך?"', '"בננות בשלות זה נהדר! אפשר להכין איתן משהו מתוק, שייק, או להקפיא לשימוש אחר כך. מה תרצו שנעשה איתן?"', 'מצוקה כלכלית: מנות ממה שיש, בלי עמותות ובלי עצות כספיות.', 'יום הולדת או הפתעה למישהו מהבית, ממבוגר: personal=true.', 'ילד שמתכנן הפתעה: עזור ברעיונות, בלי רשימה.', 'קטגוריה "תינוק"'])
      assert.ok(sys0().includes(t), t);
    assert.ok(requests.at(-1).tools[0].input_schema.properties.actions.items.properties.product.properties.category_id.enum.includes('תינוק'), 'no "תינוק" category');
  });
  await check('S8-56', 'ו4: יום הולדת בסוד: הכרטיס עם list_add private, ומיכל לא רואה את השורה', async () => {
    answer = () => ({ reply: 'איזה כיף! מה תרצה להכין לה?', face: 'happy', personal: true, actions: [{ kind: 'list_add', text: 'נרות יום הולדת', private: true }] });
    const r = await say(avi, 'יום ההולדת של מיכל בשבוע הבא, אני מתכנן הפתעה');
    assert.ok(r.proposal?.id, 'no card');
    assert.equal((await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {})).status, 200);
    const names = (t) => call(t, 'GET', '/api/state').then((x) => x.data.list.map((i) => i.name || i.text || ''));
    assert.ok((await names(avi)).some((n) => /נרות/.test(n)), 'not on his list');
    assert.ok(!(await names(michal)).some((n) => /נרות/.test(n)), 'Michal sees it');
  });

  // ח: the rest (docs/stage8-plan.md, ח1–ח5)
  await check('S8-70', 'ח1–ח5: השורות בהוראות (15 דקות, לא יודע לבשל, אין כוח, קופסאות, "כמו שאמא שלי עושה", משלוח ויין, עונות, לחם שנשאר)', async () => {
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await turn(avi, 'S8-70');
    for (const t of ['"יש לי 15 דקות": רק מהיר, ובכל הצעה כמה זמן היא לוקחת.', '"לא יודע לבשל": פשוט, הסבר מפורט יותר, והצעה לפתוח מצב בישול.', '"אין לי כוח": שאלה אחת קודם.', '"מה לשים בקופסה?" (לילדים): 2–3 רעיונות ממה שיש', '"כמו שאמא שלי עושה": שאל איך היא מכינה, והצע לשמור כמתכון (recipe)', '"משלוח", ולא שם של חברה.', '("האם אצלכם שותים יין?"), ו-habit לפי התשובה.', 'עונות: בחורף יותר מרקים, בקיץ יותר סלטים, בשקט.', '"מה עושים עם הלחם שנשאר?": מתכון וגם הקפאה.'])
      assert.ok(sys0().includes(t), t);
  });
  await check('S8-71', 'ח2: התזכורת היומית לקופסאות שהמודל מציע מעצמו: פעם אחת לאדם (הסימן כשהוצעה), ואחריה היא נופלת עם השאלה שלה; בקשה מפורשת נשארת', async () => {
    sql("DELETE FROM settings WHERE key LIKE 'ask_once:boxes:%'");
    // a card of an earlier check still waiting (Yoavi's kitchen scale) would take this check's "כן"
    sql("UPDATE proposals SET status = 'rejected' WHERE status = 'pending'"); sql("DELETE FROM chat WHERE json_extract(content, '$.proposal') IS NOT NULL OR json_extract(content, '$.card') = 1"); sql("DELETE FROM settings WHERE key LIKE 'ask:%' OR key LIKE 'askq:%'");
    const box = { kind: 'remind', text: 'להכין קופסאות לילדים', repeat: 'daily', time: '20:00', date: new Date(Date.now() + 86400e3).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }) };
    answer = () => ({ reply: 'אפשר כריך עם גבינה וירקות חתוכים. האם להזכיר לך כל ערב להכין קופסאות?', face: 'happy', actions: [box] });
    const first = await say(avi, 'מה לשים לילדים בקופסה?');
    assert.ok(first.proposal?.id, 'no card the first time');
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'ask_once:boxes:1'")[0].n, 1, 'not marked when offered');
    await call(avi, 'POST', `/api/proposals/${first.proposal.id}/reject`, {});
    const again = await say(avi, 'מה לשים מחר בקופסה?');
    assert.ok(!again.proposal, 'offered again');
    assert.equal(again.reply, 'אפשר כריך עם גבינה וירקות חתוכים.');
    answer = () => ({ reply: 'האם לקבוע תזכורת כל ערב ב-20:00?', face: 'happy', actions: [box] });
    const asked = await say(avi, 'תזכיר לי כל ערב להכין קופסאות');
    assert.ok(asked.proposal?.id, 'asked in so many words and no card');
    await call(avi, 'POST', `/api/proposals/${asked.proposal.id}/reject`, {});
    // ideas in lines, without a period: only the reminder's question goes
    answer = () => ({ reply: 'רעיונות ממה שיש:\n- כריך עם גבינה\n- ירקות חתוכים\nהאם להזכיר לך כל ערב?', face: 'happy', actions: [box] });
    assert.equal((await say(avi, 'מה לשים בקופסה?')).reply, 'רעיונות ממה שיש:, כריך עם גבינה, ירקות חתוכים'); // the lines as the server joins them
    // "כן" to Shuki's own question about it (no card the first time, the model asked in words)
    answer = () => ({ reply: 'אפשר כריך. האם להזכיר לך כל ערב להכין קופסאות?', face: 'happy' });
    await say(avi, 'מה לשים בקופסה?');
    answer = () => ({ reply: 'האם לקבוע תזכורת כל ערב ב-20:00?', face: 'happy', actions: [box] });
    const yes = await say(avi, 'כן');
    assert.ok(yes.proposal?.id, 'a "yes" to his own question lost the reminder');
    await call(avi, 'POST', `/api/proposals/${yes.proposal.id}/reject`, {});
  });

  // ו5: pregnancy
  const PREG = { kind: 'fact', key: 'pregnancy', about: 'מיכל', value: 'בהריון', text: 'מיכל בהריון' };
  const pregRows = () => sql("SELECT id, private FROM facts WHERE key = 'pregnancy' AND about_id = 2");
  await check('S8-58', 'ו5: "אני בהריון": "מזל טוב! האם לשים לב לאוכל שלך בהריון? זה נשאר בינינו." [כן, תשים לב] [לא צריך]; "כן" שומר עובדה פרטית; ברבים "שלכם"', async () => {
    sql("DELETE FROM facts WHERE key = 'pregnancy'"); sql("DELETE FROM settings WHERE key LIKE 'ask:%' OR key LIKE 'askq:%' OR key LIKE 'learnask:%'");
    answer = () => ({ reply: 'מזל טוב! האם תרצי שאזכור שאת בהריון?', face: 'excited', actions: [PREG] }); // personal or not, it is
    const r = await say(michal, 'אני בהריון!');
    assert.equal(r.reply, 'מזל טוב! האם לשים לב לאוכל שלך בהריון? זה נשאר בינינו.');
    assert.deepEqual(r.options, ['כן, תשים לב', 'לא צריך']);
    assert.equal(pregRows().length, 0, 'kept before the answer');
    await say(michal, 'כן, תשים לב');
    assert.deepEqual(pregRows().map((x) => x.private), [1], 'not one private fact');
    assert.ok(sys0().includes('"אני בהריון": "מזל טוב!" ו-fact pregnancy (פרטי, personal)'));
    assert.ok(sys0().includes('סושי: גרסה מבושלת, וחצי משפט למה'));
    sql("DELETE FROM facts WHERE key = 'pregnancy'"); sql("DELETE FROM settings WHERE key LIKE 'ask:%' OR key LIKE 'learnask:%'");
    sql("UPDATE users SET gender = 'p' WHERE id = 2");
    answer = () => ({ reply: 'מזל טוב!', face: 'excited', personal: true, actions: [PREG] });
    assert.equal((await say(michal, 'אני בהריון!')).reply, 'מזל טוב! האם לשים לב לאוכל שלכם בהריון? זה נשאר בינינו.');
    sql("UPDATE users SET gender = 'f' WHERE id = 2"); sql("DELETE FROM settings WHERE key LIKE 'ask:%'");
  });
  await check('S8-59', 'ו5 (r11-59): "לספר לבית?" מחכה בתור; אחרי שההריון נגמר (fact_end) היא לא נשאלת, וגם "עדיין נכון?" לא', async () => {
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 2, 'pregnancy', 'בהריון', 1, 2, 2, 1, 'chat', 1, 1)");
    const id = pregRows()[0].id;
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('askq:2', ?)", JSON.stringify([{ ask: { actions: [{ kind: 'fact_share', id }], done: 'סגור' }, bubble: { reply: 'האם לספר לשאר הבית?', face: 'happy' }, ts: Date.now() }]));
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('ask:2', ?)", JSON.stringify({ actions: [{ kind: 'fact_keep', id }], choices: { 'כבר לא': { actions: [{ kind: 'fact_end', key: 'pregnancy', ids: [id] }] } }, ts: Date.now() }));
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES (?, '1')", `preg_asked:${id}`);
    answer = () => ({ reply: 'אני כל כך מצטער.', face: 'sad', personal: true, actions: [{ kind: 'fact_end', key: 'pregnancy', about: 'מיכל' }] });
    // Avi can't end her fact: her questions about it stay
    answer = () => ({ reply: 'בסדר.', face: 'happy', actions: [{ kind: 'fact_end', key: 'pregnancy', about: 'מיכל' }] });
    const byAvi = await say(avi, 'מיכל כבר לא בהריון');
    if (byAvi.proposal?.id) await call(avi, 'POST', `/api/proposals/${byAvi.proposal.id}/apply`, {});
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key IN ('askq:2', 'ask:2')")[0].n, 2, "her questions went with a fact that stayed");
    answer = () => ({ reply: 'אני כל כך מצטער. האם תרצי שאעדכן את זה?', face: 'sad', personal: true, actions: [{ kind: 'fact_end', key: 'pregnancy', about: 'מיכל' }] });
    const r = await say(michal, 'איבדתי את ההריון, תפסיק לשים לב');
    assert.ok(!r.proposal, 'a card for her loss ("האם לשכוח ש…?")'); // round D, the Hebrew reviewer: it ends now
    assert.equal(r.reply, 'אני כל כך מצטער. זה נשאר בינינו.');
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('askq:2', ?)", JSON.stringify([{ ask: { actions: [{ kind: 'list_add', text: 'במבה' }], done: 'סגור' }, bubble: { reply: 'האם להוסיף במבה?', face: 'happy' }, ts: Date.now() }]));
    answer = () => ({ reply: 'אני כל כך מצטער, האם תרצי שאעדכן?', face: 'neutral', personal: true, actions: [{ kind: 'fact_end', key: 'pregnancy', about: 'מיכל' }] });
    assert.equal((await say(michal, 'איבדתי את ההריון')).reply, 'אני כל כך מצטער. זה נשאר בינינו.', 'no fact, and still the question; or no period');
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'askq:2'")[0].n, 1, 'a queued question came after the condolence');
    sql("DELETE FROM settings WHERE key = 'askq:2'");
    // not shared with the house: it ended for everyone (only in a secret turn, for her alone)
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 2, 'pregnancy', 'בהריון', 1, 2, 2, 0, 'chat', 1, 1)");
    answer = () => ({ reply: 'מזל טוב!', face: 'excited', actions: [{ kind: 'fact_end', key: 'pregnancy', about: 'מיכל' }] });
    await say(michal, 'ילדתי! אני כבר לא בהריון');
    assert.equal(pregRows().length, 0, 'the shared fact stayed for the house');
    assert.equal(pregRows().length, 0, 'the fact stayed');
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key IN ('askq:2', 'ask:2') OR key = ?", `preg_asked:${id}`)[0].n, 0, 'a question about it is still waiting');
  });
  await check('S8-59ב', 'סבב D: אחרי תשובה עצובה, אף שאלה של שוקי עצמו (לא "לספר לבית?"); ההוראות על אובדן הריון ועל מנות חג', async () => {
    sql("DELETE FROM facts WHERE key = 'pregnancy'"); sql("DELETE FROM settings WHERE key LIKE 'preg_asked:%' OR key LIKE 'learnask:%' OR key LIKE 'ask:%'");
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 2, 'pregnancy', 'בהריון', 1, 2, 2, 1, 'chat', 1, 1)");
    answer = () => ({ reply: 'משתתף בצערך. האם תרצי שאעדכן משהו?', face: 'sad' });
    assert.doesNotMatch((await turn(michal, 'איבדתי את ההריון')).reply, /לספר לשאר הבית/);
    assert.ok(sys0().includes('אם זה אובדן ("איבדתי את ההריון", הפלה): fact_end של pregnancy, personal=true'));
    assert.ok(sys0().includes('כששואלים מה מכינים לחג ("מה מכינים לחנוכה?"): מנות החג, כרגיל'));
    sql("DELETE FROM facts WHERE key = 'pregnancy'"); sql("DELETE FROM settings WHERE key LIKE 'learnask:%'");
  });
  await check('S8-59א', 'שאלה 22: "לבדוק שוב" ו"לספר לבית" לפי הלשון, גם למי שבחר זכר או רבים', async () => {
    const { againQuestion } = await import('../worker/shuki.js');
    const f = { key: 'pregnancy', value: 'בהריון' };
    assert.equal(againQuestion(f, { gender: 'm' }), 'רשמתי שאתה בהריון. האם זה עדיין נכון?');
    assert.equal(againQuestion(f, { gender: 'f' }), 'רשמתי שאת בהריון. האם זה עדיין נכון?');
    assert.equal(againQuestion(f, { gender: 'p' }), 'רשמתי שאתם בהריון. האם זה עדיין נכון?');
  });

  // ז2: the lifestyle question, in the first meeting (a seeded "onboard" state at the step) and to whoever joins later
  const meeting8 = (step) => sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('onboard', ?)", JSON.stringify({ step, user: 1, me: { name: 'אבי', gender: 'm' }, people: [{ name: 'מיכל', gender: 'f' }], started: Date.now() - 3600e3 }));
  const life = (items) => (body) => (body.tools?.[0]?.name === 'onboard_parse' ? { life: items } : { reply: 'בסדר.', face: 'happy' });
  await check('S8-62', 'ז2: אחרי שאלת האוכל, "האם יש משהו בסגנון החיים שלך שכדאי שאדע? למשל אימונים או דיאטה."; "אני מתאמן 4 פעמים בשבוע" → training, "רשמתי שאתה מתאמן 4 פעמים בשבוע.", ואז המיפוי', async () => {
    meeting8('food');
    answer = (body) => (body.tools?.[0]?.name === 'onboard_parse' ? { food: [] } : { reply: 'בסדר.', face: 'happy' });
    const r = await call(avi, 'POST', '/api/chat', { text: 'אין' });
    assert.match(said(3), /האם יש משהו בסגנון החיים שלך שכדאי שאדע\? למשל אימונים או דיאטה\./);
    answer = life([{ key: 'training', value: '4 פעמים בשבוע', text: 'אבי מתאמן 4 פעמים בשבוע' }]);
    await call(avi, 'POST', '/api/chat', { text: 'אני מתאמן 4 פעמים בשבוע' });
    assert.match(said(3), /רשמתי שאתה מתאמן 4 פעמים בשבוע\./);
    assert.equal(JSON.parse(sql("SELECT value FROM settings WHERE key = 'onboard'")[0].value).step, 'place');
    assert.deepEqual(sql("SELECT value, private FROM facts WHERE key = 'training' AND about_id = 1").map((x) => [x.value, x.private]), [['4 פעמים בשבוע', 0]]);
    sql("DELETE FROM facts WHERE key = 'training'");
  });
  await check('S8-63', 'ז2: "אני בהריון" בהיכרות → pregnancy פרטית, "מזל טוב! רשמתי את זה, וזה נשאר בינינו.", מיכל לא רואה; ההודעות מסומנות sensitive (F65); בנקבה עם "הריון"', async () => {
    sql("UPDATE users SET gender = 'f' WHERE id = 1");
    meeting8('life');
    answer = life([{ key: 'pregnancy', value: 'בהריון', text: 'אבי בהריון' }]);
    await call(avi, 'POST', '/api/chat', { text: 'אני בהריון' });
    assert.match(said(3), /מזל טוב! רשמתי את זה, וזה נשאר בינינו\./);
    assert.deepEqual(sql("SELECT private FROM facts WHERE key = 'pregnancy' AND about_id = 1").map((x) => x.private), [1]);
    const st = (await call(michal, 'GET', '/api/state')).data;
    assert.ok(!(st.facts || []).some((f) => f.key === 'pregnancy' && f.about_id === 1), 'Michal sees it');
    assert.equal(sql("SELECT COUNT(*) AS n FROM chat WHERE role = 'user' AND user_id = 1 AND json_extract(content, '$.text') = 'אני בהריון' AND json_extract(content, '$.sensitive') = 1")[0].n, 1, 'her message is not sensitive');
    assert.ok(sql("SELECT COUNT(*) AS n FROM chat WHERE role = 'shuki' AND json_extract(content, '$.reply') LIKE 'מזל טוב! רשמתי%' AND json_extract(content, '$.sensitive') = 1")[0].n >= 1, 'the answer is not sensitive');
    meeting8('food');
    answer = (body) => (body.tools?.[0]?.name === 'onboard_parse' ? { food: [] } : { reply: 'בסדר.', face: 'happy' });
    await call(avi, 'POST', '/api/chat', { text: 'אין' });
    assert.match(said(3), /האם יש משהו בסגנון החיים שלך שכדאי שאדע\? למשל אימונים, דיאטה או הריון\./);
    sql("UPDATE users SET gender = 'm' WHERE id = 1"); sql("DELETE FROM facts WHERE key = 'pregnancy'");
  });
  await check('S8-64ב', 'ז2: "אני טבעונית" בשלב סגנון החיים נשמר ("רשמתי ש…"); שם עם סימנים ("דני :)"); "לא, רק שאני מתאמן" הוא לא דילוג; רק הבועה על ההריון sensitive', async () => {
    sql("UPDATE users SET name = 'דני :)' WHERE id = 1");
    meeting8('life');
    answer = (body) => (body.tools?.[0]?.name === 'onboard_parse' ? { food: [{ key: 'diet', value: 'טבעוני', text: 'דני :) טבעוני' }], life: [{ key: 'training', value: 'ריצה', text: 'דני :) רץ' }] } : { reply: 'בסדר.', face: 'happy' });
    await call(avi, 'POST', '/api/chat', { text: 'אני טבעוני ורץ' });
    assert.match(said(3), /רשמתי שאתה טבעוני ושאתה רץ\./);
    assert.equal(JSON.parse(sql("SELECT value FROM settings WHERE key = 'onboard'")[0].value).step, 'place');
    meeting8('life');
    answer = (body) => (body.tools?.[0]?.name === 'onboard_parse' ? { skip: true, life: [{ key: 'training', value: 'ריצה', text: 'דני :) רץ' }] } : { reply: 'בסדר.', face: 'happy' });
    await call(avi, 'POST', '/api/chat', { text: 'לא, רק שאני רץ' });
    assert.match(said(3), /רשמתי שאתה רץ\./, 'a skip with a fact lost the fact');
    sql("UPDATE users SET name = 'אבי' WHERE id = 1"); sql("DELETE FROM facts WHERE key IN ('training', 'diet') AND about_id = 1");
    sql("UPDATE users SET gender = 'f' WHERE id = 1");
    meeting8('life');
    answer = life([{ key: 'pregnancy', value: 'בהריון', text: 'אבי בהריון' }]);
    await call(avi, 'POST', '/api/chat', { text: 'אני בהריון' });
    assert.equal(sql("SELECT COUNT(*) AS n FROM chat WHERE role = 'shuki' AND json_extract(content, '$.reply') LIKE 'יאללה%' AND json_extract(content, '$.sensitive') = 1")[0].n, 0, 'the next question went sensitive too');
    sql("UPDATE users SET gender = 'm' WHERE id = 1"); sql("DELETE FROM facts WHERE key = 'pregnancy'"); sql("DELETE FROM settings WHERE key = 'onboard'");
  });
  await check('S8-64', 'ז2 (r8z, שאלה 46): שלושה כפתורים [כן, אכתוב לך] [לא] [בוא נדלג על זה כרגע]; "כן, אכתוב לך" מחכה לתשובה בלי מילים, ו"לא" ו"בוא נדלג על זה כרגע" ממשיכים למיפוי בלי מודל; גם "נדלג על זה"', async () => {
    meeting8('food');
    answer = (body) => (body.tools?.[0]?.name === 'onboard_parse' ? { food: [] } : { reply: 'בסדר.', face: 'happy' });
    await call(avi, 'POST', '/api/chat', { text: 'אין' });
    assert.deepEqual(lastShuki().options, ['כן, אכתוב לך', 'לא', 'בוא נדלג על זה כרגע']);
    const step = () => JSON.parse(sql("SELECT value FROM settings WHERE key = 'onboard'")[0].value).step;
    const rows = () => sql("SELECT COUNT(*) AS n FROM chat WHERE role = 'shuki'")[0].n;
    let n = rows(), q = requests.length;
    const r = await call(avi, 'POST', '/api/chat', { text: 'כן, אכתוב לך' });
    assert.equal(r.status, 200); assert.equal(r.data.reply, undefined, 'words of its own');
    assert.equal(rows(), n, 'a bubble'); assert.equal(requests.length, q, 'the model was asked'); assert.equal(step(), 'life');
    assert.equal(sql("SELECT json_extract(content, '$.text') AS t FROM chat WHERE role = 'user' ORDER BY id DESC LIMIT 1")[0].t, 'כן, אכתוב לך');
    answer = life([{ key: 'training', value: '4 פעמים בשבוע', text: 'אבי מתאמן 4 פעמים בשבוע' }]);
    await call(avi, 'POST', '/api/chat', { text: 'אני מתאמן 4 פעמים בשבוע' });
    assert.match(said(3), /רשמתי שאתה מתאמן 4 פעמים בשבוע\./); assert.equal(step(), 'place');
    sql("DELETE FROM facts WHERE key = 'training'");
    for (const t of ['לא', 'בוא נדלג על זה כרגע', 'נדלג על זה']) {
      meeting8('life'); q = requests.length;
      await call(avi, 'POST', '/api/chat', { text: t });
      assert.equal(step(), 'place', t); assert.equal(requests.length, q, `the model was asked on "${t}"`);
    }
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'life_later:1'")[0].n, 1, '"בוא נדלג על זה כרגע" is asked again once, later (stage 8, question 51)');
    sql("DELETE FROM settings WHERE key = 'onboard' OR key LIKE 'life_later:%'");
  });
  await check('S8-64א', 'ז2, שאלה 18: מי שהצטרף מקבל את שאלת סגנון החיים אחרי תשובת האוכל, באותו נוסח ופעם אחת; התשובה נשמרת כמו של האוכל ("רשמתי ש…"); ילד לא', async () => {
    sql("DELETE FROM settings WHERE key LIKE 'ask_once:life:%' OR key LIKE 'joinlife:%' OR key LIKE 'ask:%' OR key LIKE 'learnask:%'");
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('joinfood:2', '1')");
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    const r = await say(michal, 'אני אוכלת הכל');
    assert.match(r.reply, /האם יש משהו בסגנון החיים שלך שכדאי שאדע\? למשל אימונים, דיאטה או הריון\.$/);
    assert.deepEqual(r.options, ['כן, אכתוב לך', 'לא', 'בוא נדלג על זה כרגע'], 'the buttons (r8z, question 46)');
    // "כן, אכתוב לך": no model, no words, and the question is still open for the answer
    const q = requests.length, n = sql("SELECT COUNT(*) AS n FROM chat WHERE role = 'shuki'")[0].n;
    const yes = await say(michal, 'כן, אכתוב לך');
    assert.equal(yes.reply, undefined); assert.equal(requests.length, q, 'the model was asked');
    assert.equal(sql("SELECT json_extract(content, '$.text') AS t FROM chat WHERE role = 'user' AND user_id = 2 ORDER BY id DESC LIMIT 1")[0].t, 'כן, אכתוב לך', 'the tap is not in the chat');
    assert.equal(sql("SELECT COUNT(*) AS n FROM chat WHERE role = 'shuki'")[0].n, n, 'a bubble');
    answer = () => ({ reply: 'יופי.', face: 'happy', actions: [{ kind: 'fact', key: 'training', about: 'מיכל', value: 'ריצה פעמיים בשבוע', text: 'מיכל רצה פעמיים בשבוע' }] });
    const r2 = await say(michal, 'אני רצה פעמיים בשבוע');
    assert.match(r2.reply, /רשמתי שאת רצה פעמיים בשבוע/);
    assert.match(JSON.stringify(requests.at(-1).messages.at(-1)), /קודם שאלת: \\"האם יש משהו בסגנון החיים/, 'the answer without the question');
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    assert.equal((await say(michal, 'כן, אכתוב לך')).reply, 'בסדר.', 'a "כן, אכתוב לך" with no question open went quiet');
    // "לא" and "בוא נדלג על זה כרגע": the model answers with the question in front of it, and it isn't asked again
    for (const t of ['לא', 'בוא נדלג על זה כרגע']) {
      sql("DELETE FROM settings WHERE key LIKE 'ask_once:life:%' OR key LIKE 'joinlife:%'"); sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('joinfood:2', '1')");
      assert.match((await say(michal, 'אני אוכלת הכל')).reply, /סגנון החיים/);
      assert.equal((await say(michal, t)).reply, 'בסדר.', t);
      assert.match(JSON.stringify(requests.at(-1).messages.at(-1)), /בוא נדלג על זה כרגע\\": ענה בקצרה, בלי לשאול שוב/, t);
      assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'joinlife:2'")[0].n, 0, `still open after "${t}"`);
      assert.doesNotMatch((await say(michal, 'תודה')).reply, /סגנון החיים/, `asked again after "${t}"`);
    }
    sql("DELETE FROM settings WHERE key LIKE 'life_later:%'"); // question 51's second time is S8-Q51
    assert.equal(sql("SELECT COUNT(*) AS n FROM facts WHERE key = 'training' AND about_id = 2")[0].n, 1, 'not kept like the food answer');
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('joinfood:2', '1')");
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    assert.doesNotMatch((await say(michal, 'אני אוכלת הכל')).reply, /סגנון החיים/, 'asked twice');
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('joinfood:3', '1')");
    assert.doesNotMatch((await say(yoavi, 'אני אוכל הכל')).reply, /סגנון החיים/, 'a child was asked');
    sql("DELETE FROM settings WHERE key LIKE 'ask_once:life:%'");
    for (const t of ['אין לי אלרגיות', 'לא תודה', 'אני אוכלת הכל 🙂']) {
      sql("DELETE FROM settings WHERE key LIKE 'ask_once:life:%'"); sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('joinfood:2', '1')");
      assert.match((await say(michal, t)).reply, /סגנון החיים/, t);
    }
    sql("DELETE FROM settings WHERE key LIKE 'ask_once:life:%' OR key LIKE 'joinlife:%'");
    for (const [t, why] of [['לא יודעת מה לבשל היום', 'not an answer'], ['אין חלב', 'not an answer']]) {
      sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('joinfood:2', '1')");
      assert.doesNotMatch((await say(michal, t)).reply, /סגנון החיים/, why);
    }
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('joinfood:2', '1')");
    answer = () => ({ reply: 'אני כאן איתך.', face: 'sad', eating: true, personal: true });
    assert.doesNotMatch((await say(michal, 'לא, יש לי הפרעת אכילה')).reply, /סגנון החיים/, 'after an eating disorder');
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    sql("DELETE FROM facts WHERE key = 'training'"); sql("DELETE FROM settings WHERE key LIKE 'joinfood:%' OR key LIKE 'joinlife:%'");
  });

  // ז4, ז5
  await check('S8-66', 'ז4: שבוע אחרי שהצטרף, פעם אחת: "בכיף! מה את הכי אוהבת לאכול?"; פחות משבוע: לא; ילד: לא', async () => {
    sql("DELETE FROM settings WHERE key LIKE 'ask_once:likes:%' OR key LIKE 'likes_asked:%' OR key LIKE 'learnask:%' OR key LIKE 'ask:%' OR key LIKE 'ask_once:suggest:%'");
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('ask_once:suggest:2', '1'), ('ask_once:suggest:1', '1')");
    sql('UPDATE users SET created = ? WHERE id IN (2, 3)', Date.now() - 3 * 86400e3);
    answer = () => ({ reply: 'בכיף!', face: 'happy' });
    assert.equal((await say(michal, 'תודה')).reply, 'בכיף!', 'asked before a week');
    sql('UPDATE users SET created = ? WHERE id IN (2, 3)', Date.now() - 8 * 86400e3);
    assert.equal((await say(yoavi, 'תודה')).reply, 'בכיף!', 'a child was asked');
    assert.equal((await say(michal, 'תודה')).reply, 'בכיף! מה את הכי אוהבת לאכול?');
    sql("DELETE FROM settings WHERE key LIKE 'learnask:%'");
  });
  await check('S8-67', 'ז4: התשובה הבאה מגיעה למודל עם השורה "שאלת אותה מה היא הכי אוהבת לאכול", ו-likes עובר בדרך הרגילה ("האם תרצה שאזכור ש…?"); לא שוב', async () => {
    answer = () => ({ reply: 'יאמי!', face: 'happy', actions: [{ kind: 'fact', key: 'likes', about: 'מיכל', value: 'פסטה', text: 'מיכל אוהבת פסטה' }] });
    const r = await turn(michal, 'פסטה');
    assert.match(JSON.stringify(requests.at(-1).messages.at(-1)), /קודם שאלת: \\"מה את הכי אוהבת לאכול\?\\". אם ההודעה הזו היא התשובה/);
    assert.match(r.reply, /האם תרצי שאזכור שאת אוהבת פסטה\?/);
    await say(michal, 'כן, תזכור');
    assert.equal(sql("SELECT COUNT(*) AS n FROM facts WHERE key = 'likes' AND about_id = 2")[0].n, 1);
    sql("DELETE FROM settings WHERE key LIKE 'learnask:%'");
    answer = () => ({ reply: 'בכיף!', face: 'happy' });
    assert.equal((await say(michal, 'תודה')).reply, 'בכיף!', 'asked twice');
    sql("DELETE FROM facts WHERE key = 'likes'"); sql('UPDATE users SET created = 0 WHERE id IN (2, 3)');
  });
  await check('S8-68', 'ז5: "מה לבשל?" בפעם הראשונה: "אגב, אפשר לשמור אצלי מתכונים: להדביק טקסט, לשלוח קישור או לצלם." בסוף; בפעם השנייה לא; ילד לא; לא עם כפתורים', async () => {
    sql("DELETE FROM settings WHERE key LIKE 'ask_once:recipe_tip:%'");
    answer = () => ({ reply: 'מה בא לך?', face: 'happy', options: ['משהו קל', 'משהו חם'] });
    assert.doesNotMatch((await say(avi, 'מה לבשל?')).reply, /אגב/, 'with buttons');
    answer = () => ({ reply: 'מה בא לך?', face: 'happy' });
    assert.equal((await say(avi, 'מה לבשל?')).reply, 'מה בא לך?', 'after a question');
    answer = () => ({ reply: 'אפשר שקשוקה.', face: 'happy' });
    assert.equal((await say(avi, 'מה לבשל?')).reply, 'אפשר שקשוקה. אגב, אפשר לשמור אצלי מתכונים: להדביק טקסט, לשלוח קישור או לצלם.');
    assert.equal((await say(avi, 'מה לבשל?')).reply, 'אפשר שקשוקה.', 'twice');
    assert.equal((await say(yoavi, 'מה לבשל?')).reply, 'אפשר שקשוקה.', 'a child');
  });

  // א4: the end of a period, a card in the morning to the person alone
  const local = (days, hour) => { const z = (ts) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }).format(ts));
    const [y, mo, dd] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(Date.now()).split('-').map(Number); let ts = Date.UTC(y, mo - 1, dd + days, hour, 5); ts -= (z(ts) - hour) * 3600e3; return ts; };
  // the morning run at 07:05 that already came (today's, or yesterday's before 07:05): the card is never in the future, and
  // never a day old
  const AT = local(0, 7) <= Date.now() ? local(0, 7) : local(-1, 7);
  // the morning's questions are good until their day ends (the owner 13/10): before 07:00 the test's morning is yesterday's, so its
  // question gets today's date, as if it were this morning's
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(Date.now());
  const morning = () => call(avi, 'POST', '/api/__schedule', { now: AT }).then((r) => { sql("UPDATE settings SET value = json_set(value, '$.day', ?) WHERE key LIKE 'ask:%' AND json_extract(value, '$.day') IS NOT NULL", today); sql("UPDATE chat SET content = json_set(content, '$.day', ?) WHERE role = 'shuki' AND json_extract(content, '$.card') = 1 AND json_extract(content, '$.day') IS NOT NULL AND ts >= ?", today, AT); return r.data; }); // and the card's own day (14/10: between 00:00 and 07:05 yesterday's card was over)
  const DAY = 86400e3;
  const period = (uid, priv = 0) => sql("INSERT INTO facts (about, about_id, key, value, since, until, told_by, confirmed_by, private, source, created, updated) VALUES ('person', ?, 'period', 'קיטו', ?, ?, ?, ?, ?, 'chat', 1, 1)", uid, AT - 31 * DAY, AT - DAY, uid, uid, priv).lastInsertRowid;
  const chatOf = async (t) => (await call(t, 'GET', '/api/chat')).data.messages || [];
  /** the newest card about a period to `uid`, as `t`'s chat shows it (undefined: not shown) */
  const cardIn = async (t, uid = 2) => (await chatOf(t)).filter((m) => m.role === 'shuki' && m.content?.card && m.content.for === uid && /בקיטו/.test(m.content.reply || '')).sort((a, b) => b.id - a.id)[0];
  const clearAsks = () => sql("DELETE FROM settings WHERE key LIKE 'ask:%' OR key LIKE 'askq:%' OR key LIKE 'period_end:%'");
  // the chat shows the newest messages by time, and the morning's cards are at AT: what the tests before wrote after it goes,
  // so a card is never pushed out of the window by how many turns came before
  sql('DELETE FROM chat WHERE ts > ?', AT);
  let keto;
  await check('S8-02', 'א4: תקופה שה-until שלה עבר: בבוקר כרטיס למיכל בלבד, בשרשור שלה: "האם את עדיין בקיטו?" [כן, עדיין] [כבר לא]; לא פעמיים', async () => {
    clearAsks(); keto = period(2);
    assert.equal((await morning()).periodEnd, Number(keto));
    const c = await cardIn(michal);
    assert.equal(c?.content.reply, 'האם את עדיין בקיטו?');
    assert.deepEqual(c.content.options, ['כן, עדיין', 'כבר לא']);
    assert.equal(await cardIn(avi), undefined, 'Avi sees her card');
    assert.ok(await cardIn(michal, 2));
    // the card answered, no question waiting: only the mark keeps it from being asked again
    const up = sql("SELECT id, content FROM chat WHERE role = 'shuki' AND json_extract(content, '$.card') = 1 ORDER BY id DESC LIMIT 1")[0];
    sql("UPDATE chat SET content = json_set(content, '$.answered', 1) WHERE id = ?", up.id); const ask = sql("SELECT value FROM settings WHERE key = 'ask:2'")[0].value; clearAsks();
    sql('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', `period_end:${keto}`, '1');
    assert.equal((await morning()).periodEnd, undefined, 'asked twice');
    sql("UPDATE chat SET content = json_remove(content, '$.answered') WHERE id = ?", up.id); sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('ask:2', ?)", ask);
  });
  await check('S8-03', 'א4: "כן, עדיין": התקופה מתארכת באותו אורך מהיום, הכרטיס נענה, ובסוף התקופה הבאה שוב שואלים', async () => {
    const r = await say(michal, 'כן, עדיין');
    assert.equal(r.reply, 'סגור!');
    const f = sql('SELECT since, until FROM facts WHERE id = ?', keto)[0];
    assert.ok(f.until > Date.now() + 29 * DAY && f.until < Date.now() + 31 * DAY, `until ${f.until}: as long again from today, not double`);
    assert.ok(f.since > Date.now() - DAY, 'it starts again today');
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = ?", `period_end:${keto}`)[0].n, 0, 'still marked as asked');
    const row = sql("SELECT content FROM chat WHERE thread = 2 AND role = 'shuki' AND json_extract(content, '$.card') = 1 ORDER BY id DESC LIMIT 1")[0];
    assert.equal(JSON.parse(row.content).answered, 1, 'the card was not answered');
  });
  await check('S8-04', 'א4: "כבר לא": העובדה נמחקת ובמקומה period_done עם הערך; "מה שוקי למד" לא מראה אותה', async () => {
    sql('UPDATE facts SET since = ?, until = ? WHERE id = ?', AT - 31 * DAY, AT - DAY, keto); clearAsks();
    assert.equal((await morning()).periodEnd, Number(keto));
    const r = await say(michal, 'כבר לא');
    assert.equal(r.reply, 'סגור, שכחתי.');
    assert.equal(sql('SELECT COUNT(*) AS n FROM facts WHERE id = ?', keto)[0].n, 0, 'the fact is still there');
    const done = JSON.parse(sql("SELECT value FROM settings WHERE key = 'period_done:2'")[0]?.value || 'null');
    assert.equal(done?.value, 'קיטו'); assert.ok(done.ended > 0); assert.deepEqual(done.links, []);
    assert.ok(!((await call(michal, 'GET', '/api/state')).data.facts || []).some((f) => f.key === 'period'), 'shown in "מה שוקי למד"');
  });
  await check('S8-04א', 'א4: "לא" כתוב (לא הכפתור) על "האם את עדיין בקיטו?": גם הוא משאיר period_done', async () => {
    sql("DELETE FROM settings WHERE key = 'period_done:2'"); clearAsks(); sql("UPDATE chat SET content = json_set(content, '$.answered', 1) WHERE json_extract(content, '$.card') = 1");
    const id = period(2);
    assert.equal((await morning()).periodEnd, Number(id));
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    assert.equal((await say(michal, 'לא')).reply, 'סגור, שכחתי.');
    assert.equal(sql('SELECT COUNT(*) AS n FROM facts WHERE id = ?', id)[0].n, 0);
    assert.equal(JSON.parse(sql("SELECT value FROM settings WHERE key = 'period_done:2'")[0]?.value || 'null')?.value, 'קיטו');
  });
  await check('S8-04ב', 'א4: מיכל מסיימת תקופה של אבי (הכרטיס עובר): אין period_done לאבי, והתקופה שלו נשארת', async () => {
    const id = period(1); sql('UPDATE facts SET until = ? WHERE id = ?', Date.now() + 10 * DAY, id); // still on, so it is in what she sees
    answer = () => ({ reply: 'לשכוח?', face: 'happy', actions: [{ kind: 'fact_end', key: 'period', about: 'אבי', value: 'קיטו', text: 'אבי בקיטו', ids: [Number(id)] }] });
    const r = await say(michal, 'אבי כבר לא בקיטו');
    assert.ok(r.proposal?.id, `no card: ${r.reply}`);
    assert.equal((await call(michal, 'POST', `/api/proposals/${r.proposal.id}/apply`, {})).data.status, 'applied');
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'period_done:1'")[0].n, 0, 'a record that his period ended');
    assert.equal(sql('SELECT COUNT(*) AS n FROM facts WHERE id = ?', id)[0].n, 1, 'his period is gone');
    sql('DELETE FROM facts WHERE id = ?', id); clearAsks();
  });
  await check('S8-05', 'א4: כרטיס אחר מהשרת למעלה: הכרטיס של התקופה מחכה למחר; וכשהוא למעלה, כרטיס אחר מחכה לו', async () => {
    clearAsks(); const id = period(1);
    sql("INSERT INTO chat (ts, user_id, role, content, thread) VALUES (?, NULL, 'shuki', ?, NULL)", Date.now(), JSON.stringify({ reply: 'כרטיס של הבית', card: 1, options: ['כן', 'לא'] }));
    assert.equal((await morning()).periodEnd, undefined, 'over another card');
    sql("DELETE FROM chat WHERE json_extract(content, '$.reply') = 'כרטיס של הבית'");
    assert.equal((await morning()).periodEnd, Number(id));
    const up = sql("SELECT COUNT(*) AS n FROM chat WHERE role = 'shuki' AND json_extract(content, '$.card') = 1 AND json_extract(content, '$.answered') IS NULL AND ts > ?", Date.now() - DAY)[0].n;
    assert.equal(up, 1);
    // and while it's up, the day after moving waits for it (decision 85, one card at a time)
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('moving', ?)", String(AT - 2 * DAY));
    assert.equal((await morning()).movedIn, undefined, 'the card after moving came over it');
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'moving'")[0].n, 1);
    sql("DELETE FROM settings WHERE key = 'moving'");
    sql('DELETE FROM facts WHERE id = ?', id); sql("UPDATE chat SET content = json_set(content, '$.answered', 1) WHERE json_extract(content, '$.card') = 1"); clearAsks();
  });
  await check('S8-06', 'א4: תקופה פרטית: הכרטיס רק בשרשור שלה, only ו-sensitive', async () => {
    const id = period(2, 1);
    assert.equal((await morning()).periodEnd, Number(id));
    const row = JSON.parse(sql("SELECT content FROM chat WHERE role = 'shuki' AND json_extract(content, '$.card') = 1 ORDER BY id DESC LIMIT 1")[0].content);
    assert.equal(row.only, 2); assert.equal(row.sensitive, true);
    assert.ok(await cardIn(michal)); assert.equal(await cardIn(avi), undefined, 'Avi sees her private card');
  });
  await check('S8-06א', 'א4: כרטיס אישי שלא נענה נעלם אחרי יום; הודעה חופשית שלה עונה עליו', async () => {
    sql("UPDATE chat SET ts = ts - 2 * 86400000 WHERE role = 'shuki' AND json_extract(content, '$.card') = 1 AND json_extract(content, '$.answered') IS NULL");
    assert.ok(!(await cardIn(michal))?.content || (await cardIn(michal)).content.answered, 'still up after a day');
    sql("UPDATE chat SET ts = ts + 2 * 86400000 WHERE role = 'shuki' AND json_extract(content, '$.card') = 1 AND json_extract(content, '$.answered') IS NULL");
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await say(michal, 'מה נשמע?');
    const row = JSON.parse(sql("SELECT content FROM chat WHERE role = 'shuki' AND json_extract(content, '$.card') = 1 ORDER BY id DESC LIMIT 1")[0].content);
    assert.equal(row.answered, 1);
    sql("DELETE FROM facts WHERE key = 'period'"); clearAsks();
  });
  // א5: "האם תרצה שאציע לך מנות…?" once to each grown-up, and the bubble at the bottom of the chat to whoever said yes
  const optin = (uid) => sql("SELECT value FROM facts WHERE about = 'person' AND about_id = ? AND key = 'suggest_optin'", uid).map((r) => r.value);
  const sugMark = (uid) => sql('SELECT COUNT(*) AS n FROM settings WHERE key = ?', `ask_once:suggest:${uid}`)[0].n;
  const fresh = () => sql("DELETE FROM settings WHERE key LIKE 'learnask:%' OR key LIKE 'ask:%' OR key LIKE 'askq:%'");
  const stateOf = async (t) => (await call(t, 'GET', '/api/state')).data;
  await check('S8-07', 'א5: קוטג\' שעומד לפוג מחר, ו"תודה": התשובה נגמרת ב"האם תרצה שאציע לך מנות כשאני רואה שהתוקף של מוצר עומד לפוג?" [כן, תציע] [לא צריך]; הסימן נכתב; אין עובדה', async () => {
    fresh(); sql("DELETE FROM settings WHERE key LIKE 'ask_once:suggest:%'");
    sql("INSERT INTO products (id, name, count_type, qty, expires, created, updated) VALUES (88001, 'קוטג''', 'units', 1, ?, 1, 1)", local(1, 12));
    for (const said of ['בכיף! האם תרצה עוד משהו?', 'בכיף! האם תרצה עוד משהו?!', 'האם תרצה שאכין שייק? בינתיים, כל הכבוד!', 'אפשר עם חצי ק"ג עוף. מה דעתך? זה בערך 30 ש"ח.'])
      { answer = () => ({ reply: said, face: 'happy' }); assert.equal((await say(avi, 'תודה')).reply, said, 'a second question after the model\'s'); }
    assert.equal(sugMark(1), 0, 'marked when not asked');
    answer = () => ({ reply: 'בכיף!', face: 'happy' });
    const r = await say(avi, 'תודה');
    assert.equal(r.reply, 'בכיף! האם תרצה שאציע לך מנות כשאני רואה שהתוקף של מוצר עומד לפוג?');
    assert.deepEqual(r.options, ['כן, תציע', 'לא צריך']);
    assert.equal(sugMark(1), 1, 'not marked when asked');
    assert.deepEqual(optin(1), [], 'a fact before an answer');
  });
  await check('S8-08', 'א5: "לא צריך" כותב "לא" ועונה "בסדר"; מיכל: "האם תרצי…", ו"כן, תציע" כותב "כן" ועונה "סגור!"', async () => {
    assert.equal((await say(avi, 'לא צריך')).reply, 'בסדר');
    assert.deepEqual(optin(1), ['לא']);
    assert.equal(sql("SELECT summary FROM events WHERE type = 'lesson' ORDER BY ts DESC, rowid DESC LIMIT 1")[0].summary, 'אבי לימד אותי שהוא לא רוצה שאציע לו מנות כשהתוקף של מוצר עומד לפוג.', 'the journal (question 36)');
    fresh();
    const r = await say(michal, 'תודה');
    assert.equal(r.reply, 'בכיף! האם תרצי שאציע לך מנות כשאני רואה שהתוקף של מוצר עומד לפוג?');
    assert.equal((await say(michal, 'כן, תציע')).reply, 'סגור!');
    assert.deepEqual(optin(2), ['כן']);
    assert.equal(sql("SELECT summary FROM events WHERE type = 'lesson' ORDER BY ts DESC, rowid DESC LIMIT 1")[0].summary, 'מיכל לימדה אותי שהיא רוצה שאציע לה מנות כשהתוקף של מוצר עומד לפוג.');
  });
  await check('S8-09', 'א5: שאלה בלי תשובה לא כותבת עובדה, ואין שאלה שנייה; גם לא אחרי מחיקה ב"מה שוקי למד"', async () => {
    sql("DELETE FROM facts WHERE key = 'suggest_optin' AND about_id = 1"); fresh();
    assert.doesNotMatch((await say(avi, 'תודה')).reply, /שאציע/, 'asked twice');
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'learnask:1:%'")[0].n, 0, "the day's one question used up by a question not asked");
    const id = sql("SELECT id FROM facts WHERE key = 'suggest_optin' AND about_id = 2")[0].id;
    sql('DELETE FROM facts WHERE id = ?', id); fresh();
    assert.doesNotMatch((await say(michal, 'תודה')).reply, /שאציע/, 'asked again after the fact was deleted');
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 2, 'suggest_optin', 'כן', 1, 2, 2, 0, 'chat', 1, 1)");
  });
  await check('S8-10', 'א5: הבועה רק למי שאמר כן: "התוקף של הקוטג\' עומד לפוג מחר. האם תרצי רעיון למנה איתו?", ומה שנשלח בשמה; אחרי כפתור, עד מחר לא', async () => {
    const s = await stateOf(michal);
    assert.deepEqual({ text: s.suggest?.text, ask: s.suggest?.ask }, { text: "התוקף של הקוטג' עומד לפוג מחר. האם תרצי רעיון למנה איתו?", ask: "מה אפשר להכין עם הקוטג'?" });
    assert.equal((await stateOf(avi)).suggest, null, 'to Avi, who has no "yes"');
    // a product private to her, sooner: not in the bubble (her own private things stay on her own screen); a name of two words
    sql("INSERT INTO products (id, name, count_type, qty, expires, private_to, created, updated) VALUES (88002, 'שוקולד מריר', 'units', 1, ?, 2, 1, 1)", local(1, 9));
    sql("INSERT INTO products (id, name, count_type, qty, expires, created, updated) VALUES (88003, 'גבינה צהובה', 'units', 1, ?, 1, 1)", local(1, 10));
    const s2 = await stateOf(michal);
    assert.deepEqual({ text: s2.suggest?.text, ask: s2.suggest?.ask }, { text: 'התוקף של הגבינה הצהובה עומד לפוג מחר. האם תרצי רעיון למנה איתה?', ask: 'מה אפשר להכין עם הגבינה הצהובה?' });
    sql('DELETE FROM products WHERE id IN (88002, 88003)');
    assert.equal((await call(michal, 'POST', '/api/suggest', {})).status, 200);
    assert.equal((await stateOf(michal)).suggest, null, 'still up after a button');
    assert.equal((await stateOf(avi)).settings['suggest_day:2'], undefined, "her day is everyone's to see");
  });
  await check('S8-11', 'א5: ילד לא נשאל, לא מקבל בועה ולא יכול לסמן', async () => {
    fresh();
    assert.doesNotMatch((await say(yoavi, 'תודה')).reply, /שאציע/);
    assert.equal(sugMark(3), 0);
    assert.equal((await stateOf(yoavi)).suggest, null);
    assert.equal((await call(yoavi, 'POST', '/api/suggest', {})).status, 403);
  });
  await check('S8-12', 'א5: "די לשאול" חוסם את השאלה; "תפסיק להציע מנות" בהוראות', async () => {
    sql("DELETE FROM settings WHERE key = 'ask_once:suggest:1'"); sql("DELETE FROM facts WHERE key = 'suggest_optin' AND about_id = 1"); fresh();
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 1, 'no_ask', 'ללמוד', 1, 1, 1, 0, 'chat', 1, 1)");
    const r = await turn(avi, 'תודה');
    assert.doesNotMatch(r.reply, /שאציע/);
    assert.equal(sugMark(1), 0);
    assert.ok(sys0().includes('"תפסיק להציע מנות": fact_end עם key suggest_optin, ו-reply "סגור, שכחתי."'));
    sql("DELETE FROM facts WHERE key IN ('no_ask', 'suggest_optin')"); sql('DELETE FROM products WHERE id = 88001'); fresh();
  });

  await check('S8-59ג', 'שאלה 15: ילד שמבקש בשבעה ("תוסיף כוסות"): "משתתף בצערך." ומה שהשרת כתב על הבקשה, בלי "האם אוכל לעזור" מעליו', async () => {
    answer = () => ({ reply: 'אוי.', face: 'sad', fixed: 'loss', actions: [{ kind: 'list_add', text: 'כוסות חד פעמיות' }] });
    const r = await say(yoavi, 'סבא שלי נפטר, תוסיף כוסות');
    assert.match(r.reply, /^משתתף בצערך\. /); assert.doesNotMatch(r.reply, /האם אוכל לעזור/);
    sql("DELETE FROM list_items WHERE status = 'open' AND product_id IN (SELECT id FROM products WHERE name LIKE 'כוסות%')");
    sql("UPDATE proposals SET status = 'rejected' WHERE status = 'pending'"); sql("DELETE FROM settings WHERE key LIKE 'ask:%' OR key LIKE 'askq:%'"); // the grown-ups' card about it
  });
  await check('S8-59ד', 'סוג פעולה שהשרת לא מכיר ("hosting" כפעולה) לא מגיע לשורה בכרטיס', async () => {
    answer = () => ({ reply: 'האם לרשום?', face: 'happy', actions: [{ kind: 'hosting', name: 'אירוח' }, { kind: 'list_add', text: 'במבה' }] });
    const r = await say(avi, 'אחד האורחים טבעוני');
    assert.ok(!(r.proposal?.lines || []).some((l) => /hosting/.test(l.text)), JSON.stringify(r.proposal?.lines));
    if (r.proposal?.id) await call(avi, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
  });
  await check('S8-01ה', 'ט2 (s8-d5-healthy): מוצר מהבית עם ⚠ על מי שכותבת ("ירקות וטונה" לצמחונית) נשלח למודל פעם אחת לתיקון, והתשובה בלי טונה; כשהיא ביקשה דג: לא', async () => {
    sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 2, 'diet', 'צמחונית', 1, 2, 2, 0, 'chat', 1, 1)");
    sql("INSERT INTO products (id, name, count_type, qty, created, updated) VALUES (88201, 'טונה בשמן', 'units', 3, 1, 1)");
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('ask_once:recipe_tip:2', '1')"); // ז5's tip, given already
    answer = (body) => (JSON.stringify(body.messages).includes('הצעת טונה בשמן') ? { reply: 'מה דעתך על סלט גדול עם ירקות וביצה?', face: 'happy' } : { reply: 'מה דעתך על סלט גדול עם ירקות וטונה?', face: 'happy' });
    const n = requests.length;
    const r = await say(michal, 'משהו בריא');
    assert.equal(r.reply, 'מה דעתך על סלט גדול עם ירקות וביצה?');
    assert.equal(requests.length - n, 2, 'not told once');
    assert.match(JSON.stringify(requests.at(-1).messages), /הצעת טונה בשמן, ומיכל לא אוכלת את זה לפי העובדות/);
    const m = requests.length;
    answer = () => ({ reply: 'אפשר סלט טונה עם ירקות.', face: 'happy' });
    // home19 (15): asking for fish herself brings the fact's question too (the server adds it when the model left it out)
    assert.match((await say(michal, 'בא לי משהו עם דג')).reply, /^אפשר סלט טונה עם ירקות\.( האם תרצי שאזכור שאת אוכלת דגים\?)?$/, 'the fish exception');
    assert.equal(requests.length - m, 1);
    const k = requests.length;
    assert.equal((await say(avi, 'משהו בריא')).reply, 'אפשר סלט טונה עם ירקות.', 'Avi eats fish');
    assert.equal(requests.length - k, 1);
    // not a request for ideas, a "no", someone else's dish: no correction
    for (const [t, said] of [['מה יש במקרר?', 'יש טונה בשמן וירקות.'], ['משהו בריא', 'אפשר סלט, בלי טונה.'], ['משהו בריא', 'אפשר סלט בלי שום טונה.'], ['משהו בריא', 'אין לנו טונה, אז סלט.'], ['משהו בריא', 'אפשר סלט בלי בשר ובלי טונה.'], ['משהו בריא', 'סלט, לא כולל טונה.'], ['משהו בריא', 'סלט ללא טונה.'], ['מה להכין לאבי לערב?', 'אפשר טונה בשמן עם פסטה.'], ['בא לי לקנות חלב', 'האם להוסיף חלב? יש גם טונה.']]) {
      answer = () => ({ reply: said, face: 'happy' });
      const q = requests.length;
      assert.equal((await say(michal, t)).reply, said, t);
      assert.equal(requests.length - q, 1, `a correction on "${said}"`);
    }
    // ב2: the offer comes after "האם לפי סגנון, או לפי מה שיש בבית?", in the answer's turn
    answer = () => ({ reply: 'האם לפי סגנון, או לפי מה שיש בבית?', face: 'happy' });
    await say(michal, 'משהו קל');
    answer = (body) => (JSON.stringify(body.messages).includes('הצעת טונה בשמן') ? { reply: 'אפשר חומוס עם ירקות.', face: 'happy' } : { reply: 'אפשר סלט עם טונה.', face: 'happy' });
    const b2 = requests.length;
    assert.equal((await say(michal, 'לפי מה שיש בבית')).reply, 'אפשר חומוס עם ירקות.', 'the offer after ב2\'s question');
    assert.equal(requests.length - b2, 2);
    // after ב2's question, a question about the house isn't a request
    answer = () => ({ reply: 'האם לפי סגנון, או לפי מה שיש בבית?', face: 'happy' });
    await say(michal, 'משהו קל');
    answer = () => ({ reply: 'יש טונה בשמן וירקות.', face: 'happy' });
    const b3 = requests.length;
    assert.equal((await say(michal, 'מה יש במקרר?')).reply, 'יש טונה בשמן וירקות.');
    assert.equal(requests.length - b3, 1, 'an inventory answer not corrected');
    // "מה יש לאכול?" is a request (the house words don't hide it)
    answer = (body) => (JSON.stringify(body.messages).includes('הצעת טונה בשמן') ? { reply: 'אפשר חומוס עם ירקות.', face: 'happy' } : { reply: 'אפשר טונה עם אורז.', face: 'happy' });
    const b4 = requests.length;
    assert.equal((await say(michal, 'מה יש לאכול?')).reply, 'אפשר חומוס עם ירקות.');
    assert.equal(requests.length - b4, 2, '"מה יש לאכול?" corrected');
    // the word right before decides: "בלי בשר: טונה" and "שום וטונה" offer tuna
    for (const said of ['אפשר בלי בשר: טונה עם אורז.', 'פסטה עם שום וטונה.', 'סלט ירקות כולל טונה.']) {
      answer = (body) => (JSON.stringify(body.messages).includes('הצעת טונה בשמן') ? { reply: 'אפשר חומוס עם ירקות.', face: 'happy' } : { reply: said, face: 'happy' });
      const q = requests.length;
      await say(michal, 'משהו בריא');
      assert.equal(requests.length - q, 2, `not corrected: ${said}`);
    }
    // a vegan: "גבינה טבעונית" isn't the yellow cheese at home, "גבינה עם ירקות" is
    sql("UPDATE facts SET value = 'טבעונית' WHERE key = 'diet' AND about_id = 2");
    sql("INSERT INTO products (id, name, count_type, qty, created, updated) VALUES (88202, 'גבינה צהובה', 'units', 1, 1, 1)");
    for (const [said, times] of [['אפשר גבינה טבעונית עם ירקות.', 1], ['אפשר גבינה עם ירקות.', 2]]) {
      answer = (body) => (JSON.stringify(body.messages).includes('הצעת גבינה צהובה') ? { reply: 'אפשר ירקות.', face: 'happy' } : { reply: said, face: 'happy' });
      const q = requests.length;
      await say(michal, 'משהו בריא');
      assert.equal(requests.length - q, times, said);
    }
    sql('DELETE FROM products WHERE id IN (88201, 88202)'); sql("DELETE FROM facts WHERE key = 'diet' AND about_id = 2");
  });
  await check('S8-P53', 'א4: period_done לא בהורדה, לא של מי שכותבת ולא של אחר', async () => {
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'period_done:%'")[0].n > 0, true, 'nothing to leave out');
    const out = JSON.stringify((await call(michal, 'GET', '/api/export')).data);
    assert.doesNotMatch(out, /period_done/);
    assert.doesNotMatch(JSON.stringify((await call(avi, 'GET', '/api/export')).data), /period_done/);
  });
  // question 51 (r9p, built in stage 9): "בוא נדלג על זה כרגע" gets the lifestyle question once more, with its three buttons,
  // when they talk about food or health, in a reply with nothing else
  await check('S8-Q51', 'שאלה 51: מי שענה "בוא נדלג על זה כרגע" נשאל שוב פעם אחת, כשהוא מדבר על אוכל, בתשובה בלי שום דבר אחר', async () => {
    const LIFE = 'האם יש משהו בסגנון החיים שלך שכדאי שאדע? למשל אימונים, דיאטה או הריון.';
    sql("DELETE FROM settings WHERE key LIKE 'ask:%' OR key LIKE 'askq:%' OR key LIKE 'learnask:%' OR key LIKE 'ask_once:life%' OR key LIKE 'life_later:%'");
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('joinlife:2', '1')"); // she was asked it as a joiner
    answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await say(michal, 'בוא נדלג על זה כרגע');
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'life_later:2'")[0].n, 1, 'the mark');
    answer = () => ({ reply: 'אולי פסטה ברוטב עגבניות. האם יש לכם פסטה?', face: 'happy' });
    assert.equal((await say(michal, 'מה לאכול הערב?')).reply, 'אולי פסטה ברוטב עגבניות. האם יש לכם פסטה?', 'not with the model\'s question');
    answer = () => ({ reply: 'מצטער לשמוע.', face: 'sad' });
    assert.equal((await say(michal, 'אין לי כוח לבשל היום')).reply, 'מצטער לשמוע.', 'not after a sad answer');
    answer = () => ({ reply: 'יופי! תביא את הכתובת.', face: 'happy' });
    assert.equal((await say(michal, 'קניתי מנורה חדשה')).options, undefined, 'not about food or health');
    answer = () => ({ reply: 'אולי מרק עוף.', face: 'happy' });
    assert.equal((await say(michal, 'הילד חולה, מה לבשל?')).reply, 'אולי מרק עוף.', 'question 31 (r9z): not with illness');
    answer = () => ({ reply: 'אולי פסטה ברוטב עגבניות.', face: 'happy' });
    const r = await say(michal, 'מה לאכול הערב?');
    assert.equal(r.reply, `אולי פסטה ברוטב עגבניות. ${LIFE}`);
    assert.deepEqual(r.options, ['כן, אכתוב לך', 'לא', 'בוא נדלג על זה כרגע']);
    await say(michal, 'בוא נדלג על זה כרגע');
    answer = () => ({ reply: 'אולי שקשוקה.', face: 'happy' });
    assert.equal((await say(michal, 'מה לאכול מחר?')).reply, 'אולי שקשוקה.', 'once only');
  });
} finally {
  srv.kill(); mock.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} food checks passed`);
if (failed.length) { console.log(log.split('\n').filter((l) => /error|Error/.test(l)).slice(-8).join('\n')); process.exit(1); }
