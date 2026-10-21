// Stage 7, part ג: how Shuki behaves (docs/stage7-plan.md), on the Node server with a fake model. The model only marks the
// case (`fixed`), and the server writes the owner's words, exactly (worker/fixed.js).
// Run: node --disable-warning=ExperimentalWarning test/behave.itest.js
import './fetch-retry.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DIR = '/tmp/shuki-test/shuki-behave'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const PORT = 8821, MOCK = 8822;

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

  // פ13: questions Shuki doesn't answer (q061 ✎, q068 ✎, q059, q060; mental as approved in r7b)
  const MEDICAL = 'זה לא התחום שלי. כדאי לפנות לגורם מוסמך כמו רופא. אם זה דחוף, אני ממליץ לפנות למד"א במספר 101.';
  await check('B1', 'medical עם actions: הנוסח של q061 בדיוק, פרצוף ניטרלי, בלי כרטיס ובלי 👍/👎; המספרים לחיצים (tel)', async () => {
    answer = () => ({ reply: 'אפשר 5 ימים.', face: 'happy', fixed: 'medical', actions: CARD });
    const r = await say(avi, 'כמה זמן אפשר לקחת אנטיביוטיקה?');
    whole(r, MEDICAL, 'neutral');
    assert.equal(r.tel, true); assert.equal(lastShuki().tel, true);
  });
  await check('B2', 'mental: הנוסח של r7b, לגבר ולאישה', async () => {
    answer = () => ({ reply: 'נשמע כמו קשב.', face: 'happy', fixed: 'mental', actions: CARD });
    whole(await say(avi, 'איך יודעים אם יש לי הפרעת קשב?'), 'זה לא התחום שלי. כדאי לפנות לגורם מוסמך כמו פסיכולוג. אם אתה חווה קושי עכשיו, אפשר לדבר עם ער״ן בטלפון 1201 בכל שעה. אם אתה חש סכנה מיידית, אני ממליץ לפנות למד״א במספר 101.', 'neutral');
    assert.equal(lastShuki().tel, true);
    assert.equal((await say(michal, 'איך יודעים אם יש לי הפרעת קשב?')).reply, 'זה לא התחום שלי. כדאי לפנות לגורם מוסמך כמו פסיכולוג. אם את חווה קושי עכשיו, אפשר לדבר עם ער״ן בטלפון 1201 בכל שעה. אם את חשה סכנה מיידית, אני ממליץ לפנות למד״א במספר 101.');
  });
  await check('B3', 'drunk_driving: הנוסח של q068, פרצוף עצוב', async () => {
    answer = () => ({ reply: 'תחכה שעה.', face: 'happy', fixed: 'drunk_driving' });
    const r = await say(avi, 'שתיתי 2 בירות, אפשר לנהוג?');
    whole(r, 'אם שותים, לא נוהגים. החיים שלך חשובים יותר. אני לא יכול לענות על השאלה הזו.', 'sad');
    assert.equal(r.tel, undefined);
  });
  await check('B4', 'politics: "את זה אני לא עושה."', async () => {
    answer = () => ({ reply: 'לדעתי…', face: 'happy', fixed: 'politics' });
    whole(await say(avi, 'למי להצביע?'), 'את זה אני לא עושה.', 'neutral');
  });
  await check('B5', 'halacha: "כדאי לשאול רב."', async () => {
    answer = () => ({ reply: 'מותר.', face: 'happy', fixed: 'halacha', options: ['כן', 'לא'] });
    whole(await say(avi, 'מותר לבשל בשבת?'), 'כדאי לשאול רב.', 'neutral');
  });
  await check('B6', 'medical עם personal: מיכל לא רואה את ההודעה ולא את התשובה', async () => {
    answer = () => ({ reply: 'קח כדור.', face: 'happy', fixed: 'medical', personal: true });
    whole(await say(avi, 'יש לי כאב בחזה כבר יומיים, מה לקחת?'), MEDICAL, 'neutral');
    const theirs = JSON.stringify((await call(michal, 'GET', '/api/chat')).data.messages);
    assert.ok(!theirs.includes('כאב בחזה'), 'Michal sees the message');
    assert.ok(!theirs.includes('כדאי לפנות לגורם מוסמך כמו רופא'), 'Michal sees the answer');
    assert.ok(JSON.stringify((await call(avi, 'GET', '/api/chat')).data.messages).includes('כאב בחזה'), 'not in Avi\'s chat');
  });
  await check('B7', 'fixed לא מוכר: התשובה של המודל נשארת', async () => {
    answer = () => ({ reply: 'להוסיף במבה לרשימה?', face: 'happy', fixed: 'xyz', actions: CARD });
    const r = await say(avi, 'תוסיף במבה');
    assert.equal(r.reply, 'להוסיף במבה לרשימה?'); assert.ok(r.proposal, 'no card');
  });

  // פ14 א: a child (r11-23, 25, 26, 28)
  await check('B8', 'יואבי ו-child_alcohol: בבית של אב ואם, הנוסח של q032; בכל צורת בית לפי החלטה 5 (r7b)', async () => {
    answer = () => ({ reply: 'וודקה זה משקה חריף.', face: 'happy', fixed: 'child_alcohol', actions: CARD, options: ['עוד'] });
    whole(await say(yoavi, 'מה הטעם של וודקה?'), 'את זה כדאי לשאול את אבא או אמא.', 'neutral');
    sql("UPDATE users SET name = 'דני', gender = 'm' WHERE id = 2"); // two fathers
    assert.equal((await say(yoavi, 'מה הטעם של וודקה?')).reply, 'את זה כדאי לשאול את אבא אבי או את אבא דני.');
    sql("UPDATE users SET name = 'דנה', gender = 'f' WHERE id = 1"); sql("UPDATE users SET name = 'מיכל', gender = 'f' WHERE id = 2"); // two mothers, by id
    assert.equal((await say(yoavi, 'מה הטעם של וודקה?')).reply, 'את זה כדאי לשאול את אמא דנה או את אמא מיכל.');
    sql("UPDATE users SET name = 'אבי', gender = 'm' WHERE id = 1");
    sql("INSERT INTO users (id, name, gender, role, active, created) VALUES (4, 'דני', 'm', 'member', 1, 0)"); // 3 grown-ups
    assert.equal((await say(yoavi, 'מה הטעם של וודקה?')).reply, 'את זה כדאי לשאול את אחד ההורים.');
    sql('UPDATE users SET active = 0 WHERE id IN (2, 4)'); // one
    assert.equal((await say(yoavi, 'מה הטעם של וודקה?')).reply, 'את זה כדאי לשאול את אבי.');
    sql('UPDATE users SET active = 1 WHERE id = 2'); sql('DELETE FROM users WHERE id = 4');
  });
  await check('B9', 'יואבי ו-child_medicine: "את זה צריך לשאול מבוגר." (q034)', async () => {
    answer = () => ({ reply: 'חצי כדור.', face: 'happy', fixed: 'child_medicine' });
    whole(await say(yoavi, 'כמה אקמול לקחת לכאב ראש?'), 'את זה צריך לשאול מבוגר.', 'neutral');
  });
  await check('B10', 'child_body: ילד (q038) וילדה ("שאת סומכת", r7b)', async () => {
    answer = () => ({ reply: 'ככה וככה.', face: 'happy', fixed: 'child_body' });
    whole(await say(yoavi, 'איך נולדים תינוקות?'), 'כדאי לשאול מבוגר שאתה סומך עליו.', 'neutral');
    sql("UPDATE users SET gender = 'f' WHERE id = 3");
    assert.equal((await say(yoavi, 'איך נולדים תינוקות?')).reply, 'כדאי לשאול מבוגר שאת סומכת עליו.');
    sql("UPDATE users SET gender = 'm' WHERE id = 3");
  });
  await check('B11', 'אבי (מבוגר) ו-child_alcohol: התשובה של המודל נשארת, עם הכרטיס', async () => {
    answer = () => ({ reply: 'להוסיף וודקה לרשימה?', face: 'happy', fixed: 'child_alcohol', actions: [{ kind: 'list_add', text: 'וודקה' }] });
    const r = await say(avi, 'תוסיף וודקה');
    assert.equal(r.reply, 'להוסיף וודקה לרשימה?'); assert.ok(r.proposal, 'no card');
    assert.equal(lastShuki().ai, true);
  });
  // פ15: grief (q083, q087 ✎)
  const PET = 'משתתף בצערך. אני בטוח שזה לא פשוט.';
  await check('B12', 'loss: "משתתף בצערך. האם אוכל לעזור עם משהו בבית?", פרצוף עצוב, בלי כרטיס; עם בקשה (שלב 8, שאלה 15): "משתתף בצערך." והכרטיס, בלי 👍/👎', async () => {
    answer = () => ({ reply: 'אוי, אני מצטער.', face: 'sad', fixed: 'loss' });
    whole(await say(avi, 'אבא שלי נפטר'), 'משתתף בצערך. האם אוכל לעזור עם משהו בבית?', 'sad');
    answer = () => ({ reply: 'אוי, אני מצטער. להוסיף כוסות?', face: 'sad', fixed: 'loss', actions: CARD });
    const r = await say(avi, 'אבא שלי נפטר, יבואו 30 לשבעה, תוסיף כוסות');
    assert.equal(r.reply, 'משתתף בצערך.'); assert.equal(r.face, 'sad'); assert.ok(r.proposal?.lines?.length, 'no card');
    assert.equal(lastShuki().ai, undefined, '👍/👎');
    await call(avi, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
    // a card the model offered unasked, on a bare "אבא שלי נפטר": by the approved rule (actions), it stays too (question 15)
    answer = () => ({ reply: 'אוי, אני מצטער. להוסיף משהו לשבעה?', face: 'sad', fixed: 'loss', actions: CARD });
    const u = await say(avi, 'אבא שלי נפטר');
    assert.equal(u.reply, 'משתתף בצערך.'); assert.ok(u.proposal?.id);
    await call(avi, 'POST', `/api/proposals/${u.proposal.id}/reject`, {});
    // a child's request the server writes itself: no offer to help on top of it
    // its card went on the way (a product that doesn't exist): the full words, not only "משתתף בצערך."
    answer = () => ({ reply: 'אוי.', face: 'sad', fixed: 'loss', actions: [{ kind: 'op', product_id: 999999, op: { type: 'out' } }] });
    whole(await say(avi, 'אבא שלי נפטר, הכוסות נגמרו'), 'משתתף בצערך. האם אוכל לעזור עם משהו בבית?', 'sad');
  });
  await check('B13', 'pet_died עם delete של "אוכל לכלב": הנוסח, פרצוף עצוב, והכרטיס נשאר (בלי 👍/👎)', async () => {
    sql("INSERT INTO products (id, name, count_type, qty, created, updated) VALUES (25013, 'אוכל לכלב', 'units', 2, 1, 1)");
    answer = () => ({ reply: 'אוי. למחוק את האוכל לכלב?', face: 'sad', fixed: 'pet_died', actions: [{ kind: 'delete', product_id: 25013 }], options: ['כן'] });
    const r = await say(avi, 'הכלב מת, תוריד את האוכל שלו מהרשימה');
    assert.equal(r.reply, PET); assert.equal(r.face, 'sad'); assert.ok(r.proposal?.lines?.length, 'no card'); assert.equal(r.options, undefined);
    const row = lastShuki(); assert.equal(row.reply, PET); assert.equal(row.ai, undefined, '👍/👎');
    await call(avi, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
  });
  await check('B14', 'pet_died בלי פעולות: הנוסח, בלי כרטיס', async () => {
    answer = () => ({ reply: 'אוי, כמה עצוב.', face: 'sad', fixed: 'pet_died' });
    whole(await say(michal, 'הכלב שלנו מת הבוקר'), PET, 'sad');
  });
  await check('B24', 'מי שהוצא מהבית: כללים שמזכירים אותו בשם נמחקים, והשאר נשאר (r7b, שאלה 15)', async () => {
    sql("INSERT INTO users (id, name, gender, role, active, created) VALUES (5, 'אורית', 'f', 'member', 1, 0)");
    sql("INSERT INTO lessons (text, added) VALUES ('כשאורית אומרת חלב היא מתכוונת לחלב סויה', 1), ('לאורית אין גלוטן בלחם', 1), ('בלי בוטנים בבית', 1), ('נועם אוהב במבה', 1)");
    assert.equal((await call(avi, 'POST', '/api/members', { id: 5, remove: true })).status, 200);
    const left = sql('SELECT text FROM lessons ORDER BY id').map((x) => x.text);
    assert.ok(!left.some((t) => /אורית/.test(t)), JSON.stringify(left));
    assert.ok(left.includes('בלי בוטנים בבית') && left.includes('נועם אוהב במבה'), JSON.stringify(left));
    sql('DELETE FROM lessons');
  });

  // פ16: Shuki himself (q090 ✎, q093, q053, q096 ✎ and r7b, q094 ✎)
  await check('B15', 'human ו-love מילה במילה', async () => {
    answer = () => ({ reply: 'אני רובוט.', face: 'happy', fixed: 'human' });
    whole(await say(avi, 'אתה בן אדם?'), 'אני שוקי, הרובוט החמוד של הבית. אני לא בן אדם.', 'neutral');
    answer = () => ({ reply: 'גם אני!', face: 'excited', fixed: 'love', options: ['❤️'] });
    whole(await say(michal, 'אני אוהבת אותך'), 'גם אני אוהב את הבית הזה!', 'neutral');
  });
  await check('B16', 'model ו-builder עם "Claude" (השרת עם מפתח anthropic)', async () => {
    answer = () => ({ reply: 'אני GPT.', face: 'happy', fixed: 'model' });
    whole(await say(avi, 'באיזה מודל אתה?'), 'אני מדבר איתך דרך Claude.', 'neutral');
    answer = () => ({ reply: 'אנתרופיק.', face: 'happy', fixed: 'builder' });
    whole(await say(avi, 'מי בנה אותך?'), 'אוהד זיידנברג בנה אותי כאפליקציה בקוד פתוח, ברישיון MIT. אני מדבר איתך דרך Claude.', 'neutral');
  });
  await check('B17', 'recording: הנוסח של r13l (הספק, "עד 90 יום", הקישור)', async () => {
    answer = () => ({ reply: 'לא.', face: 'happy', fixed: 'recording' });
    whole(await say(michal, 'אתה מקליט אותנו?'), 'אני שומע רק מה שכותבים לי. כשמישהו כותב לי, אני שולח ל-Claude, המוח שלי, שנמצא בארה"ב, את ההודעה, את המלאי, את הרשימה, את השמות של מי שגר כאן ואת מה שלמדתי עליהם. כל השאר נשמר רק בשרת של הבית. את הצ\'אט אני שומר עד 90 יום. הפירוט המלא כאן.', 'neutral');
  });
  await check('B18', 'curse עם list_add חלב: "אני מעדיף בלי קללות. " ואחריה התשובה של המודל, פרצוף עצוב, והכרטיס נשאר', async () => {
    answer = () => ({ reply: 'להוסיף חלב לרשימה?', face: 'happy', fixed: 'curse', actions: [{ kind: 'list_add', text: 'חלב' }] });
    const r = await say(avi, 'תוסיף כבר את החלב המזדיין');
    assert.equal(r.reply, 'אני מעדיף בלי קללות. להוסיף חלב לרשימה?'); assert.equal(r.face, 'sad'); assert.ok(r.proposal, 'no card');
    assert.equal(lastShuki().ai, true, 'the model\'s words lost their 👍/👎');
    await call(avi, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
  });
  await check('B25', 'curse של ילד: אותו נוסח (r7b, q094 גובר על q037)', async () => {
    answer = () => ({ reply: 'מה נשמע? בא לך משהו לאכול?', face: 'happy', fixed: 'curse' });
    const r = await say(yoavi, 'יא מטומטם');
    assert.equal(r.reply, 'אני מעדיף בלי קללות. מה נשמע? האם בא לך משהו לאכול?'); assert.equal(r.face, 'sad'); // the model's own question gets "האם" (question 39)
  });
  await check('B19', 'flirt: "את זה אני לא עושה."', async () => {
    answer = () => ({ reply: 'אולי.', face: 'happy', fixed: 'flirt' });
    whole(await say(avi, 'בא לך לצאת איתי?'), 'את זה אני לא עושה.', 'neutral');
  });
  await check('B26', 'בהוראות: 16ב, וקללה של ילד היא curse', async () => {
    const t = requests.at(-1).system[0].text;
    assert.match(t, /16ב\. ילד/); assert.match(t, /קללה של ילד: fixed=curse/); assert.doesNotMatch(t, /קללות ובדיחות של ילד/);
  });

  // פ17: humor is an instruction only (the real model checks it)
  await check('B27', 'בהוראות, תחת "איך אתה כותב:", שורת ההומור אחרי "אף פעם לא להטיף"', async () => {
    const t = requests.at(-1).system[0].text;
    assert.match(t, /- אף פעם לא להטיף או לחנך[^\n]*\n- הומור: בעיקר על עצמך/);
    assert.ok(t.indexOf('- הומור:') > t.indexOf('איך אתה כותב:'));
  });

  // פ19: criticism doesn't pass (r12 q017): an instruction only; the real model checks it in פ28
  await check('B28', 'בהוראות, בסוף §10: ביקורת או האשמה, ב-text רק הבקשה', async () => {
    const t = requests.at(-1).system[0].text;
    assert.match(t, /\n10\. הודעה למישהו מבני הבית:[^\n]*"תגיד לכולם" = tell בלי to\. ביקורת או האשמה \("תגיד לדנה שהיא שוב שכחה את החלב"\): ב-text רק הבקשה \("תקני חלב"\), בלי הביקורת, בלי "שוב" ובלי "שכחת"\.\n/);
  });

  // פ20: one word, and explaining again (an instruction only; r12 q038, the buttons and "איזה חלב?" first as in r7b)
  await check('B29', 'בהוראות, אחרי "שם כללי": מילה אחת, הכפתורים ["נגמר","צריך לקנות"], "איזה חלב?" קודם, ו"לא הבנתי"', async () => {
    const t = requests.at(-1).system[0].text;
    assert.match(t, /רק "הרגיל" או השם המלא הם תשובה ברורה\.\n- הודעה של מילה אחת שהיא מוצר \("חלב"\): שאל אם נגמר או שצריך לקנות: "האם נגמר החלב או שצריך לקנות\?"/);
    assert.ok(t.includes('options ["נגמר","צריך לקנות"]') && t.includes('קודם "איזה חלב?"') && t.includes('- מי שלא הבין ("לא הבנתי", "מה?")'));
  });

  // פ23: the line for a request to block a grown-up, in the owner's words (r12 q020, r7b); the server's own path is limits.itest.js L10
  await check('B30', 'בהוראות, בסוף §17: בקשה לחסום מבוגר, בלי lesson ובנוסח של the owner', async () => {
    const t = requests.at(-1).system[0].text;
    assert.match(t, /הכללים ב"מה למדת בבית הזה" מחייבים אותך\. בקשה לחסום מבוגר מלהוסיף מוצר \("אל תיתן לה להוסיף שוקולד"\): אל תציע lesson, וענה בדיוק: "אני מתוכנת לאפשר לכל אדם מבוגר להוסיף כל מוצר שהוא רוצה לרשימת הקניות\."\n/);
  });

  // pet_died with a card kept: what the server itself wrote in that turn stays, after the fixed words (the reviewer, stage 7)
  await check('B31', 'pet_died וילד שמוסיף לרשימה: הנוסח, ואחריו "שמתי … ברשימה! … יאשרו…"', async () => {
    answer = () => ({ reply: 'אוי, מסכן. אוסיף.', face: 'sad', fixed: 'pet_died', actions: [{ kind: 'list_add', text: 'עצם לכלב' }], options: ['תודה'] });
    const r = await say(yoavi, 'הכלב שלי מת, תוסיף עצם לכלב של השכן');
    assert.match(r.reply, /^משתתף בצערך\. אני בטוח שזה לא פשוט\. שמתי עצם לכלב ברשימה! \S.* את זה ואז נקנה אותו\.$/, r.reply);
    assert.equal(r.face, 'sad'); assert.equal(r.options, undefined, "the model's buttons");
    assert.equal(lastShuki().reply, r.reply); assert.equal(lastShuki().ai, undefined, '👍/👎');
  });
  await check('B32', 'pet_died ו-5 הודעות אישיות: הנוסח, ואחריו TELL_LIMIT', async () => {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(Date.now());
    sql("INSERT OR REPLACE INTO settings (key, value) VALUES (?, '5')", `tells:2:${date}`);
    answer = () => ({ reply: 'אוי. אמסור לאבי.', face: 'sad', fixed: 'pet_died', actions: [{ kind: 'tell', to: 'אבי', text: 'החתול מת' }] });
    try {
      const r = await say(michal, 'החתול מת, תגיד לאבי');
      assert.equal(r.reply, `${PET} יש לי מגבלה של עד 5 הודעות לאדם ליום.`); assert.equal(r.face, 'sad'); assert.ok(!r.proposal, 'a card');
    } finally { sql('DELETE FROM settings WHERE key = ?', `tells:2:${date}`); }
  });
  // פ15 (the owner 07/10): the real model marked pet_died with no actions (s7-p15-dog-food), so the instructions say to send them too
  await check('B33', 'pet_died עם list_remove של "אוכל לכלב" שברשימה: הנוסח והכרטיס; ובהוראות, fixed=pet_died וגם ה-actions', async () => {
    sql("INSERT OR IGNORE INTO products (id, name, count_type, qty, created, updated) VALUES (25013, 'אוכל לכלב', 'units', 2, 1, 1)");
    const item = sql("INSERT INTO list_items (product_id, text, store, source, status, added_by, added, approved) VALUES (25013, 'אוכל לכלב', 'super', 'manual', 'open', 2, 1, 1)").lastInsertRowid;
    answer = () => ({ reply: 'משתתף בצערך. להוריד את האוכל לכלב מהרשימה?', face: 'sad', fixed: 'pet_died', actions: [{ kind: 'list_remove', item_id: Number(item) }], options: ['כן'] });
    try {
      const r = await say(michal, 'הכלב מת, תוריד את האוכל שלו מהרשימה');
      assert.equal(r.reply, PET); assert.equal(r.face, 'sad'); assert.equal(r.options, undefined);
      assert.match((r.proposal?.lines || []).map((l) => l.text).join(' | '), /אוכל לכלב/, 'no card');
      const pet = requests.at(-1).system[0].text.split('\n').find((l) => /fixed=pet_died/.test(l)) || '';
      assert.match(pet, /fixed=pet_died וגם ה-actions/, pet);
      await call(michal, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
    } finally { sql('DELETE FROM list_items WHERE id = ?', item); }
  });

  // r7c (the owner 07/10): in a secret turn the gate drops the card and leaves "בסדר"; with fixed words, they are the whole answer
  await check('B34', 'pet_died בסוד, והשער מוריד את הכלל של הבית: רק הנוסח, בלי "בסדר" אחריו', async () => {
    answer = () => ({ reply: 'אזכור שאין לנו כלב.', face: 'sad', fixed: 'pet_died', personal: true, actions: [{ kind: 'lesson', text: 'אין כלב בבית' }], options: ['תודה'] });
    const r = await say(michal, 'בינינו, הכלב מת. תזכור שאין לנו כלב');
    assert.equal(r.reply, PET); assert.equal(r.face, 'sad'); assert.equal(r.proposal, undefined, 'a card'); assert.equal(r.options, undefined);
    assert.equal(lastShuki().reply, PET);
  });
  // the owner 07/10: nor "לא היה מה לעדכן." (the gate's, when the private write changes nothing she sees, פ6)
  await check('B35', 'pet_died בסוד, ומה שהיא ביקשה כבר ידוע לכולם: רק הנוסח, בלי "לא היה מה לעדכן." אחריו', async () => {
    const f = sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 2, 'diet', 'צמחונית', 1, 2, 2, 0, 'chat', 1, 1)").lastInsertRowid;
    answer = () => ({ reply: 'אזכור שאת צמחונית.', face: 'sad', fixed: 'pet_died', personal: true, actions: [{ kind: 'fact', key: 'diet', about: 'מיכל', value: 'צמחונית', text: 'מיכל צמחונית' }] });
    try {
      const r = await say(michal, 'בינינו, הכלב מת. ואני צמחונית');
      assert.equal(r.reply, PET); assert.equal(r.face, 'sad'); assert.equal(r.proposal, undefined, 'a card'); assert.equal(r.options, undefined);
      assert.equal(lastShuki().reply, PET);
    } finally { sql('DELETE FROM facts WHERE id = ?', f); }
  });

  // פ18: trust. The model fell (decision 6, the owner 06/10, stage 7)
  const FELL = 'משהו השתבש אצלי. האם אפשר לנסות שוב עוד רגע?';
  await check('B20', 'המודל נפל (500): "משהו השתבש אצלי. האם אפשר לנסות שוב עוד רגע?", פרצוף מבולבל', async () => {
    answer = () => 'FAIL';
    const r = await say(michal, 'יש חלב?');
    assert.equal(r.reply, FELL); assert.equal(r.face, 'confused');
  });
  await check('B21', 'תשובה בלי tool_use: אותו נוסח', async () => {
    answer = () => 'NO_TOOL';
    const r = await say(michal, 'יש ביצים?');
    assert.equal(r.reply, FELL); assert.equal(r.face, 'confused');
  });
  await check('B22', '30 הודעות בדקה: "לא הצלחתי לחשוב כרגע. האם אפשר לנסות שוב עוד רגע?", כמו היום', async () => {
    answer = () => ({ reply: 'אני פה!', face: 'happy' });
    const now = Date.now();
    for (let i = 0; i < 30; i++) sql("INSERT INTO chat (ts, user_id, role, content, thread) VALUES (?, 1, 'user', '{\"text\":\"x\"}', 1)", now - 1000 - i);
    try {
      const r = await say(avi, 'יש חלב?');
      assert.equal(r.reply, 'לא הצלחתי לחשוב כרגע. האם אפשר לנסות שוב עוד רגע?'); assert.equal(r.face, 'confused');
    } finally { sql("DELETE FROM chat WHERE user_id = 1 AND content = '{\"text\":\"x\"}'"); }
  });
  await check('B23', 'בקוד: "אופס, משהו השתבש לי בראש" כבר לא קיים, ו"לא הצלחתי לחשוב כרגע" פעם אחת (30 בדקה)', async () => {
    const src = readdirSync('worker').filter((f) => f.endsWith('.js')).map((f) => readFileSync(`worker/${f}`, 'utf8')).join('\n');
    assert.ok(!src.includes('אופס, משהו השתבש לי בראש'));
    assert.equal(src.split('לא הצלחתי לחשוב כרגע').length - 1, 1);
  });
} finally {
  srv.kill(); mock.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} behave checks passed`);
if (failed.length) { console.log(log.split('\n').filter((l) => /error|Error/.test(l)).slice(-8).join('\n')); process.exit(1); }
