// פ22 (the owner 06/10, r7b), stage 7: changing how Shuki talks to me and my name, in the chat (q044, q045, q049), male and
// female only, on the Node server with a fake model. G1, G2, G6 and G7 are the plural's: 7ב. Stage 7ב's first step
// (G8, G11-G13): "בלשון רבים" ('p') is kept from end to end, with the words m gets until the plural's are approved.
// Run: node --disable-warning=ExperimentalWarning test/gender.itest.js
import './fetch-retry.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DIR = '/tmp/shuki-test/shuki-gender'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const PORT = 8831, MOCK = 8832, PORT2 = 8833;

// Avi (admin), Michal, and Dana, who will change her name
const db = new DatabaseSync(`${DIR}/shuki.db`);
db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) { db.exec(readFileSync(`migrations/${f}`, 'utf8')); db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f); }
db.exec(readFileSync('test/fixture-house.sql', 'utf8'));
db.exec("INSERT INTO users (id, name, gender, role, active, created) VALUES (4, 'דנה', 'f', 'member', 1, 0), (5, 'עידו', 'm', 'child', 1, 0)");
db.exec("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999), ('222222', 2, 9999999999999), ('444444', 4, 9999999999999), ('555555', 5, 9999999999999)");
db.close();

// the model answers the chat with `answer`, and "whose name is it?" (name_gender) with `nameIs`
let answer = () => ({ reply: 'אני פה!', face: 'happy' }), nameIs = 'f';
const requests = [];
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { const b = Buffer.concat(parts).toString('utf8'); // bytes first: a Hebrew letter can be split between chunks (question 29)
  const body = JSON.parse(b); requests.push(body);
  const tool = body.tools?.[0]?.name || 'respond';
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'tool_use', name: tool, input: tool === 'name_gender' ? { gender: nameIs } : answer(body) }], usage: { input_tokens: 1, output_tokens: 1 } }));
}); }).listen(MOCK, '127.0.0.1');
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/node.js'], { env: { ...process.env, PORT: String(PORT), DB_PATH: `${DIR}/shuki.db`, ANTHROPIC_API_KEY: 't', ANTHROPIC_URL: `http://127.0.0.1:${MOCK}/v1/messages`, TEST_RESET: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
// a second, empty house, for the first meeting (G13)
const DIR2 = `${DIR}/new`; mkdirSync(DIR2, { recursive: true });
const db2 = new DatabaseSync(`${DIR2}/shuki.db`);
db2.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) { db2.exec(readFileSync(`migrations/${f}`, 'utf8')); db2.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f); }
db2.close();
const srv2 = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/node.js'], { env: { ...process.env, PORT: String(PORT2), DB_PATH: `${DIR2}/shuki.db`, ANTHROPIC_API_KEY: 't', ANTHROPIC_URL: `http://127.0.0.1:${MOCK}/v1/messages`, TEST_RESET: '1', SETUP_CODE: '13572468' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d)); srv2.stdout.on('data', (d) => (log += d)); srv2.stderr.on('data', (d) => (log += d));
const call = async (t, m, p, b, port = PORT) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const x = await r.text(); let data; try { data = JSON.parse(x); } catch { data = x; } return { status: r.status, data }; };
const sql = (q, ...a) => { const d = new DatabaseSync(`${DIR}/shuki.db`); try { return /^\s*select/i.test(q) ? d.prepare(q).all(...a) : d.prepare(q).run(...a); } finally { d.close(); } };
const results = [];
async function check(id, name, fn) {
  try { await fn(); results.push({ id, ok: true }); console.log('✓', id, name); }
  catch (e) { results.push({ id, ok: false }); console.log('✗', id, name, '\n   ', e.message.slice(0, 500)); }
}
const say = async (t, text) => (await call(t, 'POST', '/api/chat', { text })).data;
const me = (id) => ({ ...sql('SELECT name, gender FROM users WHERE id = ?', id)[0] });
const D12 = { m: "בסדר, אפסיק לשאול אם לזכור דברים. אם תרצה שאחזור לשאול, תכתוב לי 'אפשר לשאול שוב'.", f: "בסדר, אפסיק לשאול אם לזכור דברים. אם תרצי שאחזור לשאול, תכתבי לי 'אפשר לשאול שוב'.", p: "בסדר, אפסיק לשאול אם לזכור דברים. אם תרצו שאחזור לשאול, תכתבו לי 'אפשר לשאול שוב'." };

let avi, michal, dana, ido;
try {
  for (const port of [PORT, PORT2]) for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${port}`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  [avi, michal, dana, ido] = await Promise.all(['111111', '222222', '444444', '555555'].map(async (code) => (await call(null, 'POST', '/api/pair', { code })).data.token));

  await check('G3', '"תפנה אליי בלשון נקבה": משנה מיד, בלי מודל, ועונה בנוסח; אחר כך "די לשאול" עונה "תרצי"; ובחזרה לזכר', async () => {
    const n = requests.length;
    let r = await say(avi, 'תפנה אליי בלשון נקבה');
    assert.equal(r.reply, 'בסדר, מעכשיו אפנה אלייך בלשון נקבה.'); assert.equal(me(1).gender, 'f');
    assert.equal(requests.length, n, 'the model was asked');
    assert.equal((await call(avi, 'GET', '/api/state')).data.me.gender, 'f');
    assert.equal((await say(avi, 'די לשאול')).reply, D12.f);
    r = await say(avi, 'תדבר איתי בלשון זכר!');
    assert.equal(r.reply, 'בסדר, מעכשיו אפנה אליך בלשון זכר.'); assert.equal(me(1).gender, 'm');
    assert.equal((await say(avi, 'די לשאול')).reply, D12.m);
    sql("DELETE FROM facts WHERE key = 'no_ask'");
  });

  await check('G3b', '7ב, 22ד: "תפנה אליי בלשון רבים" משנה מיד, בלי מודל: "בסדר, מעכשיו אפנה אליכם בלשון רבים."; ובחזרה לנקבה', async () => {
    const n = requests.length;
    assert.equal((await say(michal, 'תפנה אליי בלשון רבים')).reply, 'בסדר, מעכשיו אפנה אליכם בלשון רבים.');
    assert.equal(requests.length, n); assert.equal(me(2).gender, 'p');
    assert.equal((await say(michal, 'די לשאול')).reply, D12.p);
    sql("DELETE FROM facts WHERE key = 'no_ask'");
    assert.equal((await say(michal, 'תפני אליי בלשון נקבה')).reply, 'בסדר, מעכשיו אפנה אלייך בלשון נקבה.'); assert.equal(me(2).gender, 'f');
  });

  await check('G4', '"שיניתי שם לאורית": השם משתנה, "נעים להכיר"; שם תפוס: "השם מיכל כבר תפוס"', async () => {
    nameIs = 'f';
    let r = await say(dana, 'שיניתי שם לאורית');
    assert.equal(r.reply, 'נעים להכיר, אורית! מעכשיו אקרא לך אורית.'); assert.deepEqual(me(4), { name: 'אורית', gender: 'f' });
    assert.equal((await call(dana, 'GET', '/api/state')).data.me.name, 'אורית');
    r = await say(dana, 'החלפתי את השם שלי למיכל');
    assert.equal(r.reply, 'השם מיכל כבר תפוס'); assert.equal(me(4).name, 'אורית');
    // a name the model says is a man's: the verbs follow it (q049, warmly, no questions)
    nameIs = 'm';
    r = await say(dana, 'שיניתי את השם לדן.');
    assert.equal(r.reply, 'נעים להכיר, דן! מעכשיו אקרא לך דן.'); assert.deepEqual(me(4), { name: 'דן', gender: 'm' });
  });

  await check('G4b', 'שם שמתאים לשניהם (q045): "נעים להכיר, נועם! איך לפנות אליך?" עם שני הכפתורים; "בלשון נקבה" עונה בנוסח', async () => {
    nameIs = 'both';
    let r = await say(dana, 'שיניתי שם לנועם');
    assert.equal(r.reply, 'נעים להכיר, נועם! איך לפנות אליך?'); assert.deepEqual(r.options, ['בלשון זכר', 'בלשון נקבה', 'בלשון רבים']);
    assert.deepEqual(me(4), { name: 'נועם', gender: 'm' }, 'the verbs stay until she says');
    const n = requests.length;
    r = await say(dana, 'בלשון נקבה');
    assert.equal(r.reply, 'בסדר, מעכשיו אפנה אלייך בלשון נקבה.'); assert.equal(me(4).gender, 'f'); assert.equal(requests.length, n);
    // without the question, "בלשון זכר" alone is the model's, and changes nothing
    await say(dana, 'בלשון זכר');
    assert.equal(requests.length, n + 1); assert.equal(me(4).gender, 'f');
    // another message lets the question go
    r = await say(dana, 'שיניתי שם לטל');
    assert.equal(r.reply, 'נעים להכיר, טל! איך לפנות אליך?');
    await say(dana, 'יש חלב?');
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'ask:4'")[0].n, 0, 'the question still waits');
  });

  await check('G5', '"בינינו, שיניתי שם ל…" ו"בינינו, תפנה אליי…": לא משנים, "לא היה מה לעדכן.", ושתי השורות רק שלה', async () => {
    const was = me(2), t0 = sql('SELECT MAX(id) AS n FROM chat')[0].n;
    assert.equal((await say(michal, 'בינינו, שיניתי שם לרותי')).reply, 'לא היה מה לעדכן.');
    assert.equal((await say(michal, 'בינינו, תפנה אליי בלשון זכר')).reply, 'לא היה מה לעדכן.');
    assert.deepEqual(me(2), was);
    const rows = sql('SELECT content FROM chat WHERE id > ? AND thread = 2', t0);
    assert.equal(rows.length, 4); assert.ok(rows.every((r) => r.content.includes('"only":2') && r.content.includes('"sensitive":true')), JSON.stringify(rows));
  });

  await check('G9', 'השם נעצר בפיסוק: "שיניתי שם לאורית, תזכור" ו"…לאורית?" הולכים למודל, והשם לא משתנה', async () => {
    const was = me(2), n = requests.length;
    await say(michal, 'שיניתי שם לאורית, תזכור'); // two words: the old pattern took "אורית, תזכור" as the name
    await say(michal, 'שיניתי שם לאורית?');
    assert.deepEqual(me(2), was); assert.equal(requests.length, n + 2, 'both went to the model');
  });

  await check('G10', 'ילד: "בינינו, שיניתי שם ל…" משנה כרגיל, ושום שורה לא נשמרת רק אצלו (לילד אין סוד, שאלה 98)', async () => {
    const t0 = sql('SELECT MAX(id) AS n FROM chat')[0].n;
    nameIs = 'm';
    assert.equal((await say(ido, 'בינינו, שיניתי שם לרועי')).reply, 'נעים להכיר, רועי! מעכשיו אקרא לך רועי.');
    assert.equal(me(5).name, 'רועי');
    const rows = sql('SELECT content FROM chat WHERE id > ?', t0);
    assert.ok(rows.length >= 2 && rows.every((r) => !r.content.includes('"only"') && !r.content.includes('"sensitive"')), JSON.stringify(rows));
  });

  await check('G8', '7ב: gender "p" נשמר בהגדרות ונקרא בחזרה ב-/api/state', async () => {
    assert.equal((await call(michal, 'POST', '/api/members', { id: 2, edit: { gender: 'p' } })).status, 200);
    assert.equal(me(2).gender, 'p');
    const s = (await call(michal, 'GET', '/api/state')).data;
    assert.equal(s.me.gender, 'p'); assert.equal(s.users.find((u) => u.id === 2).gender, 'p');
    // an edit that doesn't say a gender keeps it
    assert.equal((await call(michal, 'POST', '/api/members', { id: 2, edit: { name: 'מיכל' } })).status, 200);
    assert.equal(me(2).gender, 'p');
    // anything else is still not a gender
    assert.equal((await call(michal, 'POST', '/api/members', { id: 2, edit: { gender: 'x' } })).status, 200);
    assert.equal(me(2).gender, 'p');
  });

  await check('G2', '7ב, 22א: "די לשאול" אצל מי שבחר רבים: D12 ברבים, מילה במילה', async () => {
    assert.equal((await say(michal, 'די לשאול')).reply, D12.p);
    sql("DELETE FROM facts WHERE key = 'no_ask'");
  });

  await check('G7', '7ב, 22ג (שאלה 17): המודל קורא "רבים" על מי שבחרה, ואיך לפנות אליה', async () => {
    const n = requests.length;
    await say(michal, 'מה נשמע?');
    const sent = JSON.stringify(requests.slice(n).at(-1)?.system || '');
    assert.ok(sent.includes('מיכל (רבים)'), 'houseText');
    assert.ok(sent.includes('המשתמש שכותב עכשיו: מיכל (פנה אליו/אליה בלשון רבים: \\"קניתם\\", \\"שימו לב\\").'), 'the writer');
    // after the model: "שים לב" / "שימי לב" to her is "שימו לב" (the reviewer of 22ג)
    answer = () => ({ reply: 'שים לב, החלב פג תוקף מחר. שימי לב גם לגבינה.', face: 'happy' });
    assert.equal((await say(michal, 'מה פג תוקף?')).reply, 'שימו לב, החלב פג תוקף מחר. שימו לב גם לגבינה.');
    answer = () => ({ reply: 'אני פה!', face: 'happy' });
  });

  await check('G2b', '7ב, 22א (שאלה 16): הודעה מאבי לנמענת אחת שבחרה רבים: "…ביקש שאגיד לכם: …"', async () => {
    answer = () => ({ reply: 'לשלוח למיכל?', face: 'happy', actions: [{ kind: 'tell', to: 'מיכל', text: 'תקנו חלב' }] });
    const r = await say(avi, 'תגיד למיכל לקנות חלב');
    answer = () => ({ reply: 'אני פה!', face: 'happy' });
    assert.equal((await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {})).status, 200);
    const got = (await call(michal, 'GET', '/api/chat')).data.messages.filter((m) => m.role === 'shuki').map((m) => m.content.reply);
    assert.ok(got.includes('מיכל, אבי ביקש שאגיד לכם: תקנו חלב'), JSON.stringify(got.slice(-3)));
  });

  await check('G4c', '7ב, 22ד (שאלה 14): מי שבחרה רבים ומשנה שם נשארת ברבים: "נעים להכיר, דני! מעכשיו אקרא לכם דני."', async () => {
    const was = me(2).name; nameIs = 'm';
    const n = requests.length;
    assert.equal((await say(michal, 'שיניתי שם לדני')).reply, 'נעים להכיר, דני! מעכשיו אקרא לכם דני.');
    assert.deepEqual(me(2), { name: 'דני', gender: 'p' }); assert.equal(requests.length, n, 'nameGender is not asked');
    nameIs = 'both';
    assert.equal((await say(michal, 'שיניתי שם לעדי')).reply, 'נעים להכיר, עדי! מעכשיו אקרא לכם עדי.', 'no question: the plural stays');
    sql('UPDATE users SET name = ? WHERE id = 2', was);
  });

  await check('G15', '7ב, 22ד (שאלה 9): "אני טרנס" (fixed=trans) בנוסח המאושר, בלי שינוי; "בינינו, אני טרנס" נשאר רק אצלה', async () => {
    const T = { p: 'תודה ששיתפתם אותי. היום אני פונה אליכם בלשון רבים. אם תרצו שאפנה אליכם אחרת, אפשר לכתוב לי "תפנה אליי בלשון זכר" או "תפנה אליי בלשון נקבה", או לשנות בהגדרות → הבית, בלחיצה על השם שלכם. אם שיניתם שם, אפשר לכתוב לי "שיניתי שם ל…".',
      m: 'תודה ששיתפת אותי. היום אני פונה אליך בלשון זכר. אם תרצה שאפנה אליך אחרת, אפשר לכתוב לי "תפנה אליי בלשון נקבה" או "תפנה אליי בלשון רבים", או לשנות בהגדרות → הבית, בלחיצה על השם שלך. אם שינית שם, אפשר לכתוב לי "שיניתי שם ל…".' };
    answer = () => ({ reply: 'כל הכבוד!', face: 'happy', fixed: 'trans' });
    const was = me(2);
    assert.equal((await say(michal, 'אני טרנס')).reply, T.p); assert.deepEqual(me(2), was);
    assert.equal((await say(ido, 'אני טרנס')).reply, T.m, 'a child too');
    const t0 = sql('SELECT MAX(id) AS n FROM chat')[0].n;
    assert.equal((await say(michal, 'בינינו, אני טרנס')).reply, T.p);
    answer = () => ({ reply: 'אני פה!', face: 'happy' });
    const rows = sql('SELECT content FROM chat WHERE id > ?', t0);
    assert.ok(rows.length >= 2 && rows.every((r) => r.content.includes('"only":2')), JSON.stringify(rows));
  });

  await check('G14', '7ב, 22ב: ביומן, מי שבחרה רבים: "מיכל הוסיפו לרשימה", "מיכל סיימו קניות", "מיכל ביטלו: …"', async () => {
    const act = (t, actions) => call(t, 'POST', '/api/actions', { actions, op_id: `op-${Math.random()}` });
    const t0 = sql('SELECT MAX(ts) AS t FROM events')[0].t || 0;
    assert.equal((await act(michal, [{ kind: 'list_add', text: 'במבה' }])).status, 200);
    assert.equal((await act(michal, [{ kind: 'finish', store: 'super' }])).status, 200);
    assert.equal((await call(michal, 'POST', '/api/undo', {})).status, 200);
    const lines = sql('SELECT summary FROM events WHERE ts >= ? AND user_id = 2 ORDER BY ts', t0).map((r) => r.summary);
    assert.ok(lines.includes('מיכל הוסיפו לרשימה במבה'), JSON.stringify(lines));
    assert.ok(lines.some((l) => l.startsWith('מיכל סיימו קניות בסופר')), JSON.stringify(lines));
    assert.ok(lines.some((l) => l.startsWith('מיכל ביטלו: סיימו קניות')), JSON.stringify(lines));
  });

  await check('G11', '7ב: הוספת חבר בית עם "p" שומרת p; מי שהוצא מהבית על ידי מי שבחר p: by_gender "p" במסך אחרי 401', async () => {
    const r = await call(avi, 'POST', '/api/members', { add: { name: 'שחר', gender: 'p', role: 'member' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(sql("SELECT gender FROM users WHERE name = 'שחר'")[0].gender, 'p');
    assert.equal((await call(avi, 'POST', '/api/members', { add: { name: 'גל', gender: 'x', role: 'member' } })).status, 400);
    // 22ד (question 13): no choice is a 400 in the existing words, not 'm'; 15: no name, "מה השם שלהם?"
    let e = await call(avi, 'POST', '/api/members', { add: { name: 'גל', role: 'member' } });
    assert.equal(e.status, 400); assert.equal(e.data.error, 'איך לפנות אליו או אליה?');
    e = await call(avi, 'POST', '/api/members', { add: { name: '', gender: 'p', role: 'member' } });
    assert.equal(e.data.error, 'מה השם שלהם?');
    assert.equal((await call(avi, 'POST', '/api/members', { id: 1, edit: { gender: 'p' } })).status, 200);
    assert.equal(me(1).gender, 'p');
    assert.equal((await call(avi, 'POST', '/api/members', { id: 4, remove: true })).status, 200);
    assert.equal(sql('SELECT by_gender FROM removed')[0]?.by_gender, 'p');
    const out = await call(dana, 'GET', '/api/state');
    assert.equal(out.status, 401); assert.deepEqual(out.data.removed, { name: 'אבי', gender: 'p' });
  });

  await check('G12', '7ב: "להתחיל מהתחלה", "איך לפנות לרוני?" ותשובה "בלשון רבים": רוני נכנס עם p', async () => {
    assert.match((await say(avi, 'אני רוצה להתחיל מהתחלה')).reply, /^האם למחוק את המלאי/);
    assert.equal((await say(avi, 'כן, מתחילים מחדש')).reply, 'האם היו שינויים בחברי הבית? האם מישהו הצטרף או עזב?');
    assert.equal((await say(avi, 'כן')).reply, 'ספרו לי מי גר בבית עכשיו.');
    const others = sql('SELECT name FROM users WHERE active = 1 AND id != 1').map((u) => ({ name: u.name, gender: 'm', child: false }));
    answer = () => ({ people: [...others, { name: 'רוני', gender: 'unknown', child: true, age: 5 }] });
    const g = await say(avi, 'כולם, ועוד רוני');
    assert.equal(g.reply, 'איך לפנות לרוני?'); assert.deepEqual(g.options, ['בלשון זכר', 'בלשון נקבה', 'בלשון רבים']);
    await say(avi, 'בלשון רבים');
    assert.equal(sql("SELECT gender FROM users WHERE name = 'רוני'")[0]?.gender, 'p');
    answer = () => ({ reply: 'אני פה!', face: 'happy' });
  });

  await check('G13', '7ב: בהיכרות, "איך לפנות אליך?" → "בלשון רבים" שומר p למנהל; "איך לפנות לטל?" → "בלשון רבים" שומר p לטל', async () => {
    const r = await call(null, 'POST', '/api/setup', { code: '13572468' }, PORT2);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const t = r.data.token, say2 = async (text) => (await call(t, 'POST', '/api/chat', { text }, PORT2)).data;
    const db2q = (q) => { const d = new DatabaseSync(`${DIR2}/shuki.db`); try { return d.prepare(q).all(); } finally { d.close(); } };
    nameIs = 'both';
    const hi = await say2('נועם');
    assert.equal(hi.reply, 'נעים מאוד, נועם! איך לפנות אליך?'); assert.deepEqual(hi.options, ['בלשון זכר', 'בלשון נקבה', 'בלשון רבים']);
    // the reviewer of bf7ba1d: "ערבים" and "בערבים" are not the plural
    for (const w of ['בערבים', 'ערבים']) { assert.equal((await say2(w)).reply, 'איך לפנות אליך?'); assert.notEqual(db2q("SELECT gender FROM users WHERE name = 'נועם'")[0]?.gender, 'p', w); }
    await say2('בלשון רבים');
    assert.equal(db2q("SELECT gender FROM users WHERE name = 'נועם'")[0]?.gender, 'p');
    assert.equal((await call(t, 'GET', '/api/state', null, PORT2)).data.me.gender, 'p');
    await say2('הבית של נועם');
    answer = () => ({ people: [{ name: 'טל', gender: 'unknown', child: true, age: 9 }] });
    const q = await say2('גר איתי טל, בן 9');
    assert.equal(q.reply, 'איך לפנות לטל?'); assert.deepEqual(q.options, ['בלשון זכר', 'בלשון נקבה', 'בלשון רבים']);
    answer = () => ({ people: [{ name: 'טל', gender: 'm', child: true }] }); // the model has no plural: the words win
    const g = await say2('בלשון רבים');
    assert.equal(db2q("SELECT gender FROM users WHERE name = 'טל'")[0]?.gender, 'p');
    assert.equal(g.reply, 'האם טל צריכים קוד לטלפון?', '22ב');
    const codes = (await say2('כן')).bubbles; void codes;
    const withCode = (await call(t, 'GET', '/api/chat', null, PORT2)).data.messages.find((m) => m.content.codes)?.content;
    assert.equal(withCode?.codes?.[0]?.gender, 'p', '22ד (question 6): the code carries the gender, for the share message');
    answer = () => ({ reply: 'אני פה!', face: 'happy' });
    // 22ג (8ב): a child whose only parent chose the plural hears the name in D9, and the parent's line as it is
    const d = new DatabaseSync(`${DIR2}/shuki.db`); d.prepare("INSERT INTO pairing_codes (code, user_id, expires) SELECT '777777', id, 9999999999999 FROM users WHERE name = 'טל'").run(); d.close();
    const tal = (await call(null, 'POST', '/api/pair', { code: '777777' }, PORT2)).data.token;
    const msgs = (await call(tal, 'GET', '/api/chat', null, PORT2)).data.messages;
    assert.equal(msgs[0].content.reply, 'נועם יכולים לראות את השיחה שלנו.', JSON.stringify(msgs[0]));
    assert.equal((await call(t, 'POST', '/api/actions', { actions: [{ kind: 'list_add', text: 'במבה' }], op_id: 'op-g13' }, PORT2)).status, 200);
    const gray = (await call(tal, 'GET', '/api/chat', null, PORT2)).data.messages.filter((m) => m.role === 'event').map((m) => m.content.gray);
    assert.ok(gray.includes('נועם הוסיפו לרשימה במבה'), JSON.stringify(gray));
  });
} finally {
  srv.kill(); srv2.kill(); mock.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} gender checks passed`);
if (failed.length) { console.log(log.split('\n').filter((l) => /error|Error/.test(l)).slice(-8).join('\n')); process.exit(1); }
