// Stage 0c, the facts table (docs/stage0-0c-proposal.md), on the Node server with a fake model. Each check fails on the
// code before 0c. Run: node --disable-warning=ExperimentalWarning test/facts.itest.js
import './fetch-retry.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DIR = '/tmp/shuki-test/shuki-facts'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const PORT = 8772, MOCK = 8773;
const NOW = Date.now();

// a house from before 0c, with data: Avi (admin), Michal, Yoavi (a child); Michal keeps Shabbat (the old setting)
const db = new DatabaseSync(`${DIR}/shuki.db`);
db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql') && x < '0016').sort()) { db.exec(readFileSync(`migrations/${f}`, 'utf8')); db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f); }
db.exec(readFileSync('test/fixture-house.sql', 'utf8'));
db.exec("INSERT INTO users (id, name, gender, role, active, created) VALUES (3, 'יואבי', 'm', 'child', 1, 0)");
db.exec("INSERT INTO settings (key, value) VALUES ('shabbat:2', '1')");
db.exec(`INSERT INTO products (id, name, count_type, qty, created, updated) VALUES (7, 'חלב', 'units', 2, 1, 1)`);
db.exec("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999), ('222222', 2, 9999999999999), ('333333', 3, 9999999999999)");
db.close();

// the fake model: answers what the check sets, keeps every request
let answer = () => ({ reply: 'אני פה!', face: 'happy' });
const requests = [];
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { const b = Buffer.concat(parts).toString('utf8'); // bytes first: a Hebrew letter can be split between chunks (question 29)

  const body = JSON.parse(b); requests.push(body);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'tool_use', name: body.tools?.[0]?.name || 'respond', input: answer(body) }], usage: { input_tokens: 1, output_tokens: 1 } }));
}); }).listen(MOCK, '127.0.0.1');

const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/node.js'], { env: { ...process.env, PORT: String(PORT), DB_PATH: `${DIR}/shuki.db`, ANTHROPIC_API_KEY: 't', ANTHROPIC_URL: `http://127.0.0.1:${MOCK}/v1/messages`, TEST_RESET: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
const call = async (t, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const x = await r.text(); let data; try { data = JSON.parse(x); } catch { data = x; } return { status: r.status, data }; };
const state = async (t) => (await call(t, 'GET', '/api/state')).data;
const sql = (q, ...a) => { const d = new DatabaseSync(`${DIR}/shuki.db`); try { return /^\s*select/i.test(q) ? d.prepare(q).all(...a) : d.prepare(q).run(...a); } finally { d.close(); } };
const fact = (aboutId, key, value, { priv = 0, confirmed = aboutId || 1, told = aboutId || 1, chat = null, about = 'person' } = {}) => sql('INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, chat_id, created, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', about, aboutId, key, value, NOW, told, confirmed, priv, 'chat', chat, NOW, NOW).lastInsertRowid;
const results = [];
async function check(id, name, fn) {
  try { await fn(); results.push({ id, ok: true }); console.log('✓', id, name); }
  catch (e) { results.push({ id, ok: false }); console.log('✗', id, name, '\n   ', e.message.slice(0, 400)); }
}

let avi, michal, yoavi;
try {
  for (let i = 0; i < 60; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  [avi, michal, yoavi] = await Promise.all(['111111', '222222', '333333'].map(async (code) => (await call(null, 'POST', '/api/pair', { code })).data.token));

  await check('F1', 'מיגרציה 0016 על בית עם נתונים: שומרת שבת עוברת לעובדה, העמודות החדשות במוצר, שום דבר לא נמחק', async () => {
    assert.match(log, /migration 0016_facts\.sql/);
    assert.deepEqual(sql("SELECT about, about_id, key, value, private FROM facts WHERE key = 'shabbat'").map((r) => ({ ...r })), [{ about: 'person', about_id: 2, key: 'shabbat', value: 'כן', private: 0 }]);
    assert.equal((await state(michal)).shabbat, true); assert.equal((await state(avi)).shabbat, false);
    const p = sql('SELECT name, qty, kosher_kind, only_brand, responsible FROM products WHERE id = 7')[0];
    assert.deepEqual({ ...p }, { name: 'חלב', qty: 2, kosher_kind: null, only_brand: 0, responsible: null });
  });

  // facts for the filter: Michal's pregnancy (private), her diet (shared), a peanut allergy Avi told about her (not
  // confirmed yet), Yoavi's private health fact, a house fact
  const preg = fact(2, 'pregnancy', 'בהריון', { priv: 1 });
  fact(2, 'diet', 'צמחונית, אוכלת דגים');
  fact(2, 'allergy', 'בוטנים', { confirmed: null, told: 1 });
  fact(3, 'health', 'אסתמה', { priv: 1 });
  fact(0, 'appliance', 'אייר פרייר', { about: 'house', told: 1, confirmed: 1 });

  await check('F2', 'מי שקורא: מיכל רואה את העובדות שלה, גם הפרטיות. אבי (מנהל) לא רואה את ההריון שלה, ולא את העובדה הפרטית של יואבי (ילד)', async () => {
    const keys = (s) => s.facts.map((f) => `${f.about_id}:${f.key}`).sort();
    assert.deepEqual(keys(await state(michal)), ['0:appliance', '2:allergy', '2:diet', '2:pregnancy', '2:shabbat']);
    assert.deepEqual(keys(await state(avi)), ['0:appliance', '2:allergy', '2:diet', '2:shabbat']);
    assert.deepEqual(keys(await state(yoavi)), ['0:appliance', '2:allergy', '2:diet', '2:shabbat', '3:health']);
  });

  await check('F3', 'למודל: בבלוק שבמטמון רק מה שגלוי (כולל האלרגיה, "עוד לא אושר"), זהה לכל מי שכותב; העובדות של מי שכותב בחלק בלי מטמון', async () => {
    requests.length = 0;
    await call(avi, 'POST', '/api/chat', { text: 'מה לבשל?' }); await call(michal, 'POST', '/api/chat', { text: 'מה לבשל?' });
    const [a, m] = requests.slice(-2).map((r) => r.system);
    const cached = (sys) => sys.filter((b) => b.cache_control).map((b) => b.text).join('\n');
    const plain = (sys) => sys.filter((b) => !b.cache_control).map((b) => b.text).join('\n');
    // the facts part of the cached block (the instructions themselves name the keys, "הריון ובריאות")
    const factsPart = (sys) => (cached(sys).match(/עובדות על הבית ועל האנשים[\s\S]*?(?=\n\n|$)/) || [''])[0];
    for (const sys of [a, m]) { assert.match(factsPart(sys), /מיכל: .*diet: צמחונית/); assert.match(factsPart(sys), /allergy: בוטנים \(עוד לא אושר\)/); assert.doesNotMatch(factsPart(sys), /בהריון|אסתמה/); }
    assert.match(plain(m), /pregnancy: בהריון/); assert.doesNotMatch(plain(a), /בהריון/);
    assert.equal(factsPart(a), factsPart(m), 'the cached facts are the same for both');
  });

  await check('F4', 'הגיבוי (הורדה) לא כולל עובדות פרטיות', async () => {
    const bk = (await call(avi, 'GET', '/api/export')).data;
    assert.deepEqual(bk.facts.map((f) => f.key).sort(), ['allergy', 'appliance', 'diet', 'shabbat']);
  });

  await check('F5', 'שחזור יום: העובדות של היום נשארות כמו שהן, ומה שנמחק לא חוזר', async () => {
    await call(avi, 'POST', '/api/__schedule', { now: Date.now() }); // today's copy
    const day = (await call(avi, 'GET', '/api/backups')).data.backups[0]?.day;
    assert.ok(day, 'a backup');
    sql("DELETE FROM facts WHERE key = 'appliance'"); fact(1, 'likes', 'שקשוקה');
    const r = await call(avi, 'POST', '/api/backups/restore', { day });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const keys = sql('SELECT key FROM facts ORDER BY key').map((x) => x.key);
    assert.ok(keys.includes('likes') && !keys.includes('appliance') && keys.includes('pregnancy'), keys.join(','));
  });

  // ---- part 2: the fact action, through the chat (the fake model proposes; the server decides) ----
  const say = async (t, text) => (await call(t, 'POST', '/api/chat', { text })).data;
  const factAnswer = (f, reply = 'האם תרצה שאזכור?') => () => ({ reply, face: 'happy', actions: [{ kind: 'fact', ...f }] });
  const count = (where, ...a) => sql(`SELECT COUNT(*) AS n FROM facts WHERE ${where}`, ...a)[0].n;

  await check('F8', 'עובדה על עצמי: שאלת כן/לא, לא נשמר לפני "כן"; אחרי "כן" נשמרת מאושרת, עם ההודעה שממנה נלמדה ושורה ביומן', async () => {
    answer = factAnswer({ key: 'diet', about: 'אבי', value: 'צמחוני', text: 'אבי צמחוני' }, 'האם תרצה שאזכור שאתה צמחוני?');
    const r = await say(avi, 'אני צמחוני');
    assert.deepEqual(r.options, ['כן, תזכור', 'לא צריך'], JSON.stringify(r));
    assert.equal(count("about_id = 1 AND key = 'diet'"), 0, 'saved before yes');
    const msg = sql("SELECT id FROM chat WHERE user_id = 1 AND role = 'user' ORDER BY id DESC LIMIT 1")[0].id;
    await say(avi, 'כן');
    const f = sql("SELECT * FROM facts WHERE about_id = 1 AND key = 'diet'")[0];
    assert.ok(f, 'saved after yes'); assert.equal(f.confirmed_by, 1); assert.equal(f.private, 0); assert.equal(f.chat_id, msg);
    assert.equal(sql('SELECT summary FROM events WHERE id = ?', f.event_id)[0]?.summary, 'אבי לימד אותי שהוא צמחוני.' /* the line approved 15/10 (test/firstuse.itest.js F4) */);
  });

  await check('F9', 'עובדה על מבוגר אחר: מחכה לו, והוא נשאל במילים הקיימות; "לא צריך" שלו מוחק אותה באמת', async () => {
    answer = factAnswer({ key: 'allergy', about: 'מיכל', value: 'אגוזים', text: 'למיכל יש אלרגיה לאגוזים' });
    await say(avi, 'למיכל יש אלרגיה לאגוזים'); await say(avi, 'כן');
    const f = sql("SELECT * FROM facts WHERE about_id = 2 AND key = 'allergy' AND value = 'אגוזים'")[0];
    assert.ok(f, 'saved, waiting'); assert.equal(f.confirmed_by, null); assert.equal(f.told_by, 1); assert.equal(f.event_id, null, 'no journal line before she confirms');
    assert.ok((await call(michal, 'GET', '/api/chat')).data.messages.some((m) => /אבי ביקש שאזכור שלמיכל יש אלרגיה לאגוזים\. האם לזכור\?/.test(m.content.reply || '')));
    await say(michal, 'לא צריך');
    assert.equal(count('id = ?', f.id), 0, 'her "no" deletes it');
  });

  await check('F10', 'ילד ששומר עובדה על עצמו: לא נשמר עד שמבוגר מאשר; אחרי ה"כן" של אבי: שמור, סיפר יואבי, אישר אבי', async () => {
    answer = factAnswer({ key: 'avoid', about: 'יואבי', value: 'פטריות', text: 'יואבי לא אוכל פטריות' });
    await say(yoavi, 'אני לא אוכל פטריות');
    assert.equal(count("about_id = 3 AND key = 'avoid'"), 0, 'not before a grown-up says yes');
    await say(avi, 'כן');
    const f = sql("SELECT * FROM facts WHERE about_id = 3 AND key = 'avoid'")[0];
    assert.ok(f, 'saved'); assert.equal(f.told_by, 3); assert.equal(f.confirmed_by, 1);
  });

  for (const [id, name, who, f] of [
    ['F11', 'ילד לא שומר עובדה על אחר', () => yoavi, { key: 'avoid', about: 'מיכל', value: 'בצל', text: 'מיכל לא אוכלת בצל' }],
    ['F12', 'על מי שלא גר בבית: לא נשמר', () => avi, { key: 'allergy', about: 'סבתא', value: 'בוטנים', text: 'לסבתא יש אלרגיה לבוטנים' }],
    ['F13', 'מצב רגשי: אין לו מפתח, לא נשמר', () => avi, { key: 'mood', about: 'אבי', value: 'עצוב', text: 'אבי עצוב' }],
    ['F14', 'עובדה פרטית על מישהו אחר: לא נשמרת (רק האדם עצמו)', () => michal, { key: 'pregnancy', about: 'אבי', value: 'כן', text: 'אבי בהריון' }],
  ]) {
    await check(id, name, async () => {
      const before = count('1 = 1'); const sent = requests.length;
      answer = factAnswer(f);
      const r = await say(who(), `תזכור ש${f.text}`);
      // the server refused it and told the model why (not just "nothing happened")
      assert.ok(requests.slice(sent).some((q) => /fact: /.test(JSON.stringify(q.messages))), 'the server did not tell the model it refused the fact');
      // whoever might have been asked says yes; the fake model no longer proposes anything on its own
      answer = () => ({ reply: 'בסדר', face: 'happy' });
      await say(avi, 'כן'); await say(michal, 'כן');
      assert.equal(count('1 = 1'), before, `a fact was saved: ${JSON.stringify(r)} ${JSON.stringify(sql('SELECT about_id, key, value, told_by FROM facts ORDER BY id DESC LIMIT 2'))}`);
    });
  }

  await check('F15', '"תשכח מה שאמרתי": ההודעה, התשובה שלי לה והעובדה שנלמדה ממנה נמחקות באמת', async () => {
    answer = factAnswer({ key: 'likes', about: 'אבי', value: 'שקשוקה', text: 'אבי אוהב שקשוקה' }, 'סגור.');
    await say(avi, 'תזכור שאני אוהב שקשוקה');
    const f = sql("SELECT * FROM facts WHERE about_id = 1 AND key = 'likes' AND value = 'שקשוקה'")[0];
    assert.ok(f?.chat_id, 'saved, with its message');
    // 65 (the owner 05/10): a question from it waiting in a queue goes too; another stays
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES ('askq:2', ?)", JSON.stringify([{ ask: { actions: [{ kind: 'lesson', text: 'x', chat_id: f.chat_id }] }, bubble: { reply: 'מזה' }, ts: Date.now() }, { ask: { actions: [], away: { until: '2030-01-01' }, from: f.chat_id }, bubble: { reply: 'חופשה מזה' }, ts: Date.now() }, { ask: { actions: [] }, bubble: { reply: 'אחר' }, ts: Date.now() }])); // 66: a vacation question of it goes too
    answer = () => ({ reply: 'לא אמור להגיע אליי', face: 'happy' });
    const r = await say(avi, 'תשכח מה שאמרתי');
    assert.deepEqual(JSON.parse(sql("SELECT value FROM settings WHERE key = 'askq:2'")[0].value).map((x) => x.bubble.reply), ['אחר'], 'the queue');
    sql("DELETE FROM settings WHERE key = 'askq:2'");
    assert.equal(r.reply, 'סגור, שכחתי.');
    assert.equal(count('id = ?', f.id), 0);
    assert.equal(sql('SELECT COUNT(*) AS n FROM chat WHERE id = ?', f.chat_id)[0].n, 0, 'the message is gone');
  });

  await check('F16', 'עובדה מבחוץ (עוזר מחובר, תמונה): נשארת על כרטיס, לא נשמרת עד שמאשרים, ובלי "לזכור?" (0ג-2.3, r0t b5)', async () => {
    const JPEG = '/9j/' + Buffer.from('x'.repeat(300)).toString('base64').replace(/=/g, 'A');
    const fid = () => sql("SELECT id FROM facts WHERE about = 'person' AND about_id = 1 AND key = 'avoid' AND value = 'כוסברה'")[0]?.id;
    answer = () => ({ reply: 'רשמתי.', face: 'happy', actions: [{ kind: 'fact', key: 'avoid', about: 'אבי', value: 'כוסברה', text: 'אבי לא אוכל כוסברה' }] });
    for (const body of [{ text: 'אבי לא אוכל כוסברה', via: 'mcp' }, { text: 'אני לא אוכל כוסברה', image: { media_type: 'image/jpeg', data: JPEG } }]) {
      const r = (await call(avi, 'POST', '/api/chat', body)).data;
      assert.ok(r.proposal?.lines?.some((l) => /כוסברה/.test(l.text)), `the fact on a card (${body.via || 'image'}): ${JSON.stringify(r).slice(0, 300)}`);
      assert.doesNotMatch(r.reply, /לזכור\?|שאזכור/); assert.equal(fid(), undefined, 'kept before the card was approved');
      if (r.proposal) await call(avi, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
    }
  });

  await check('F17', '/api/facts מחיקה: רק מי שמותר לו (שלו; מבוגר: של הבית ושל ילד); אחרת 404 "את זה כבר שכחתי" והעובדה נשארת (0ג-2.11, r0t b5)', async () => {
    const del = (t, id) => call(t, 'POST', '/api/facts', { id, delete: true });
    const gone = (id) => !sql('SELECT id FROM facts WHERE id = ?', id)[0];
    const mine = fact(1, 'likes', 'פלאפל'), michals = fact(2, 'likes', 'סושי'), kids = fact(3, 'likes', 'פיצה', { told: 1, confirmed: 1 }), house = fact(0, 'appliance', 'מיקרוגל', { about: 'house', told: 2, confirmed: 2 });
    let r = await del(avi, michals); assert.equal(r.status, 404); assert.equal(r.data.error, 'את זה כבר שכחתי'); assert.ok(!gone(michals), 'another grown-up\'s');
    r = await del(yoavi, house); assert.equal(r.status, 404); assert.ok(!gone(house), 'a child, the house\'s');
    r = await del(yoavi, mine); assert.equal(r.status, 404); assert.ok(!gone(mine), 'a child, a parent\'s');
    assert.equal((await del(avi, mine)).status, 200); assert.ok(gone(mine), 'his own');
    assert.equal((await del(avi, house)).status, 200); assert.ok(gone(house), 'the house\'s, by a grown-up');
    assert.equal((await del(avi, kids)).status, 200); assert.ok(gone(kids), 'a child\'s, by a grown-up');
    assert.equal((await del(avi, 999999)).status, 404, 'no such fact');
    assert.equal((await call(avi, 'POST', '/api/facts', { id: fact(1, 'likes', 'חומוס') })).status, 400, 'his own, without delete');
  });

  // ---- פ6 (question 50): a private fact of hers wins over the shared one, for her alone ----
  const apply = (t, id) => call(t, 'POST', `/api/proposals/${id}/apply`, {});
  const fresh = () => { sql('UPDATE chat SET ts = ts - 3600e3 WHERE user_id IN (1, 2)'); sql("DELETE FROM settings WHERE key IN ('ask:1', 'askq:1', 'ask:2', 'askq:2')"); };
  // a secret message, and its card or its "yes" (as P30 in test/private.itest.js)
  const secretly = async (text, out) => { fresh(); answer = () => out; const x = await say(michal, text); if (x.proposal) await apply(michal, x.proposal.id); else if (x.options?.[0]) await say(michal, x.options[0]); return x; };
  const factsOf = async (t) => (await state(t)).facts.filter((f) => f.about === 'person' && f.about_id === 2);
  // Friday at 10:00 in the house's zone, this week
  const friday = () => { for (let k = 0; k < 7; k++) { let ts = Date.UTC(...new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(NOW + k * 864e5).split('-').map((x, i) => (i === 1 ? x - 1 : +x)), 10, 5);
    ts -= (Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }).format(ts)) - 10) * 3600e3;
    if (new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short' }).format(ts) === 'Fri') return ts; } };

  await check('F18', '"בינינו, הפסקתי לשמור שבת" כשהמשותפת "כן": אצל אבי מיכל עדיין שומרת שבת; אצלה shabbat = false, וביום שישי ב-10:00 היא לא מקבלת "לשבת"', async () => {
    sql("DELETE FROM facts WHERE about = 'person' AND about_id IN (1, 2) AND key = 'shabbat'");
    fact(2, 'shabbat', 'כן'); fact(1, 'shabbat', 'כן');
    assert.equal((await state(michal)).shabbat, true);
    await secretly('בינינו, הפסקתי לשמור שבת', { reply: 'בסדר.', face: 'happy' });
    assert.equal((await state(michal)).shabbat, false);
    assert.ok((await state(avi)).facts.some((f) => f.about_id === 2 && f.key === 'shabbat' && f.value === 'כן'), 'Avi no longer sees her Shabbat');
    assert.equal(count("about_id = 2 AND key = 'shabbat' AND private = 0"), 1, 'the shared row went');
    sql(`UPDATE devices SET push_sub = '{"endpoint":"http://127.0.0.1:${MOCK}/push","keys":{"p256dh":"x","auth":"y"}}', push_on = 1`);
    sql('UPDATE products SET is_basic = 1, target = 1, qty = 0 WHERE id = 7');
    const sh = (await call(avi, 'POST', '/api/__schedule', { now: friday() })).data;
    assert.ok(sh.shabbatBodies?.[1], JSON.stringify(sh).slice(0, 300));
    assert.equal(sh.shabbatBodies[2], undefined, 'she got "לשבת"');
    // and on again, in a secret: her ended row goes, the shared one is hers again
    await secretly('בינינו, אני שוב שומרת שבת', { reply: 'בסדר.', face: 'happy' });
    assert.equal((await state(michal)).shabbat, true);
    assert.equal(count("about_id = 2 AND key = 'shabbat' AND private = 1"), 0);
  });

  await check('F19', 'fact_end בסוד על diet משותף: אצלה אין diet, ובחלק הכותב "נגמר (פרטי"; אצל אבי diet נשאר, והחלק שבמטמון זהה אצל שניהם', async () => {
    if (!count("about_id = 2 AND key = 'diet' AND private = 0")) fact(2, 'diet', 'צמחונית');
    const v = sql("SELECT value FROM facts WHERE about_id = 2 AND key = 'diet' AND private = 0")[0].value;
    await secretly('בינינו, אני כבר לא צמחונית', { reply: 'אשכח.', face: 'happy', actions: [{ kind: 'fact_end', key: 'diet', value: v }] });
    assert.ok(!(await factsOf(michal)).some((f) => f.key === 'diet'), JSON.stringify(await factsOf(michal)));
    assert.ok((await factsOf(avi)).some((f) => f.key === 'diet' && f.value === v), 'Avi lost her diet');
    assert.equal(count("about_id = 2 AND key = 'diet' AND private = 0"), 1, 'the shared row went');
    answer = () => ({ reply: 'יש פסטה.', face: 'happy' });
    await say(michal, 'מה לבשל?'); const m = requests.at(-1).system;
    await say(avi, 'מה לבשל?'); const a = requests.at(-1).system;
    const cached = (sys) => JSON.stringify(sys.slice(1, sys.findLastIndex((b) => b.cache_control) + 1));
    assert.equal(cached(m), cached(a), 'the cached part differs');
    assert.ok(cached(m).includes(v), 'the house\'s view lost her diet');
    assert.ok(JSON.stringify(m.slice(m.findLastIndex((b) => b.cache_control) + 1)).includes('נגמר (פרטי'), 'her part');
    assert.ok(!JSON.stringify(a).includes('נגמר (פרטי'), 'in Avi\'s prompt');
  });

  await check('F20', 'מפתח בלי multi, ערך אחר בסוד: אצלה רק הפרטי, אצל אבי המשותף', async () => {
    sql("DELETE FROM facts WHERE about_id = 2 AND key = 'training'"); fact(2, 'training', 'ריצה');
    await secretly('בינינו, עברתי לשחייה. תזכור', { reply: 'אזכור.', face: 'happy', actions: [{ kind: 'fact', key: 'training', about: 'מיכל', value: 'שחייה', text: 'מיכל שוחה' }] });
    assert.deepEqual((await factsOf(michal)).filter((f) => f.key === 'training').map((f) => f.value), ['שחייה']);
    assert.deepEqual((await factsOf(avi)).filter((f) => f.key === 'training').map((f) => f.value), ['ריצה']);
  });

  await check('F21', '"אפשר לשאול שוב" בסוד כשיש "לא לשאול" משותף: אצלה שואלים שוב, והתשובה היא לא "לא היה מה לעדכן."', async () => {
    sql("DELETE FROM facts WHERE about_id = 2 AND key = 'no_ask'"); fact(2, 'no_ask', 'ללמוד');
    fresh(); answer = () => ({ reply: 'בסדר.', face: 'happy' });
    await say(michal, 'בינינו, משהו קטן');
    const r = await say(michal, 'אפשר לשאול שוב');
    assert.equal(r.reply, 'סגור, אחזור לשאול לפעמים.');
    assert.ok(!(await factsOf(michal)).some((f) => f.key === 'no_ask'), 'still "no_ask" for her');
    assert.equal(count("about_id = 2 AND key = 'no_ask' AND private = 0"), 1, 'the shared row went');
    // "די לשאול" right after a secret message: the shared one is hers again
    fresh(); await say(michal, 'בינינו, עוד משהו קטן');
    const r2 = await say(michal, 'די לשאול');
    assert.match(r2.reply, /^בסדר, אפסיק לשאול/); assert.ok((await factsOf(michal)).some((f) => f.key === 'no_ask'));
  });

  await check('F22', 'ההורדה שלה בלי המשותפת שנגמרה אצלה; של אבי עם', async () => {
    const has = async (t) => (await call(t, 'GET', '/api/export')).data.facts.some((f) => f.about === 'person' && f.about_id === 2 && f.key === 'diet');
    assert.equal(await has(michal), false, 'her download has the diet she ended');
    assert.equal(await has(avi), true, 'Avi\'s lost it');
  });

  await check('F23', 'מחיקה של השורה הפרטית ב-/api/facts מחזירה אצלה את המשותפת', async () => {
    const id = sql("SELECT id FROM facts WHERE about_id = 2 AND key = 'diet' AND private = 1 AND ended = 1")[0].id;
    assert.equal((await call(michal, 'POST', '/api/facts', { id, delete: true })).status, 200);
    assert.ok((await factsOf(michal)).some((f) => f.key === 'diet'));
  });

  await check('F6', 'מי שעוזב: מה ששוקי ידע עליו נמחק באמת, יחד עם השורה ביומן; במה שסיפר על אחרים השם שלו יורד', async () => {
    const ev = 900001; sql("INSERT INTO events (id, ts, user_id, type, summary) VALUES (?, ?, 2, 'lesson', 'מיכל לימדה אותי: אני צמחונית')", ev, NOW);
    sql("UPDATE facts SET event_id = ? WHERE about_id = 2 AND key = 'diet'", ev);
    fact(1, 'kosher', 'שומר כשרות', { told: 2, confirmed: 1 });
    const r = await call(avi, 'POST', '/api/members', { id: 2, remove: true });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(sql("SELECT COUNT(*) AS n FROM facts WHERE about = 'person' AND about_id = 2")[0].n, 0);
    assert.equal(sql('SELECT COUNT(*) AS n FROM events WHERE id = ?', ev)[0].n, 0);
    assert.equal(sql("SELECT told_by FROM facts WHERE key = 'kosher'")[0].told_by, null);
  });

  await check('F7', 'מחיקת הבית מוחקת גם את העובדות', async () => {
    assert.ok(sql('SELECT COUNT(*) AS n FROM facts')[0].n > 0);
    const name = (await state(avi)).house;
    const r = await call(avi, 'POST', '/api/house/delete', { name });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(sql('SELECT COUNT(*) AS n FROM facts')[0].n, 0);
  });
} finally {
  srv.kill(); mock.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} facts checks passed`);
if (failed.length) { console.log(log.split('\n').filter((l) => /error|Error/.test(l)).slice(-8).join('\n')); process.exit(1); }
