// Round 17 (27/09): 👍 and 👎, and what Shuki learned (rules the house approved, in every chat).
// Run: node test/round17.itest.js
import './fetch-retry.js';
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';

const STATE = '/tmp/shuki-test/shuki-r17';
const PORT = 8776, MOCK = 8774;
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
  res.end(JSON.stringify({ content: [{ type: 'tool_use', id: 'tu1', name: 'respond', input }], usage: { input_tokens: 100000, output_tokens: 10000 } }));
}); }).listen(MOCK);
const dev = spawn('npx', ['wrangler', 'dev', '--local', '--test-scheduled', '--port', String(PORT), '--persist-to', STATE, '--var', `ANTHROPIC_URL:http://127.0.0.1:${MOCK}/v1/messages`, '--var', 'ANTHROPIC_API_KEY:t', '--var', 'TEST_RESET:1', '--var', 'VAPID_PUBLIC:BMMdXvS-VuZiLvO1dnln5--ThCfc4M25IulaMpiMQcLf_Vr-OuNxtjBm4R-Gl8osOtEdudLwFZ0bBuVCLJwKEo'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = ''; dev.stdout.on('data', (d) => (log += d)); dev.stderr.on('data', (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
const call = async (t, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const txt = await r.text(); let data = null; try { data = JSON.parse(txt); } catch { /* text */ } return { status: r.status, data, text: txt }; };
const state = async (t) => (await call(t, 'GET', '/api/state')).data;
const results = [];
async function check(id, name, fn) {
  try { const note = await fn(); results.push({ id, name, ok: true, note: note || '' }); console.log('✓', id, name, note ? `— ${note}` : ''); }
  catch (e) { results.push({ id, name, ok: false, error: e.message.slice(0, 400) }); console.log('✗', id, name, '\n   ', e.message.slice(0, 400)); }
}
const DAY = 86400e3;
const act = (t, actions, extra = {}) => call(t, 'POST', '/api/actions', { actions, op_id: `op-${Math.random()}`, ...extra });
const tick = async () => { const n = log.length; await fetch(`${base}/__scheduled?cron=0+*+*+*+*`); await new Promise((r) => setTimeout(r, 1500)); const m = log.slice(n).match(/schedule \S+ (\{.*\})/); return m ? JSON.parse(m[1]) : null; };
const P = (s, name) => s.products.find((p) => p.name === name);
const month = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).format(new Date());
const chatSay = async (t, text, out) => { script.push(out); return (await call(t, 'POST', '/api/chat', { text })).data; };
const lastBot = async (t) => { const r = await call(t, 'GET', '/api/chat'); if (!r.data?.messages) throw new Error(r.status + ' ' + r.text.slice(0, 300)); return r.data.messages.filter((m) => m.role === 'shuki').at(-1); };

let avi, michal, kid;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  avi = (await call(null, 'POST', '/api/pair', { code: '481516', name: 'iPhone' })).data.token;
  michal = (await call(null, 'POST', '/api/pair', { code: '234234', name: 'iPhone' })).data.token;
  await act(avi, [
    { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 1, is_basic: 1, target: 2, shelf_days: 7 } },
    { kind: 'create', product: { name: 'משקה סויה', count_type: 'units', unit: 'קרטון', qty: 1 } },
  ]);
  const sysText = (c) => (c.system || []).map((x) => x.text).join('\n');
  const msgsText = (c) => JSON.stringify(c.messages);
  const RULE = 'כשמיכל אומרת חלב היא מתכוונת למשקה סויה';

  await check('T1', '👍 נשמר ונשאר לחוץ; 👎 אחריו מחליף אותו (אחד בכל פעם); ה-👍 לא שומר את המלאי', async () => {
    await chatSay(michal, 'יש חלב?', { reply: 'יש קרטון חלב 3%.', face: 'happy' });
    const m = await lastBot(michal);
    assert.equal((await call(michal, 'POST', '/api/feedback', { chat_id: m.id, up: true })).status, 200);
    let c = (await lastBot(michal)).content; assert.equal(c.up, true); assert.equal(c.down, undefined);
    const row = d1(`SELECT kind, question, state FROM feedback ORDER BY id DESC LIMIT 1`)[0];
    assert.equal(row.kind, 'up'); assert.equal(row.question, ''); assert.equal(row.state, ''); // r0t p3
    await call(michal, 'POST', '/api/feedback', { chat_id: m.id, note: '' });
    c = (await lastBot(michal)).content; assert.equal(c.down, true); assert.equal(c.up, undefined);
    assert.equal(d1(`SELECT kind FROM feedback ORDER BY id DESC LIMIT 1`)[0].kind, 'down');
  });

  await check('T2', '👎 עם הסבר: ההסבר מגיע לשוקי עם התשובה שעליה הוא; שאלת "לזכור?" (כן/לא, בלי כרטיס); אחרי "כן" הכלל ב"מה שוקי למד" ובכל שיחה', async () => {
    const m = await lastBot(michal);
    await call(michal, 'POST', '/api/feedback', { chat_id: m.id, note: 'התכוונתי לסויה' });
    script.push({ reply: 'סליחה! לזכור את זה להבא?', face: 'sad', actions: [{ kind: 'lesson', text: RULE }] });
    calls.length = 0;
    const r = (await call(michal, 'POST', '/api/chat', { text: 'התכוונתי לסויה', feedback: m.id })).data;
    assert.match(msgsText(calls[0]), /סימן 👎 על התשובה שלך \\"יש קרטון חלב 3%\.\\" והסביר\): התכוונתי לסויה/, msgsText(calls[0]).slice(-300));
    // decision 159: a plain yes-or-no question, no card
    assert.equal(r.proposal, undefined, JSON.stringify(r)); assert.deepEqual(r.options, ['כן, תזכור', 'לא צריך']); assert.match(r.reply, /^סליחה! האם תרצי שאזכור ש/, r.reply); // a vague "remember this?" becomes the rule itself
    const mine = (await call(michal, 'GET', '/api/chat')).data.messages.filter((x) => x.role === 'user').at(-1);
    assert.equal(mine.content.text, 'התכוונתי לסויה'); assert.equal(mine.content.fb, 'יש קרטון חלב 3%.');
    assert.doesNotMatch(sysText(calls[0]), /מה למדת בבית הזה \(בני/);
    calls.length = 0;
    const a = (await call(michal, 'POST', '/api/chat', { text: 'כן' })).data; assert.equal(a.applied, true, JSON.stringify(a)); assert.equal(a.reply, 'סגור, אזכור!'); assert.equal(calls.length, 0, 'the yes needs no model');
    const s = await state(avi); assert.equal(s.lessons.length, 1); assert.equal(s.lessons[0].text, RULE); assert.equal(s.lessons[0].by_name, 'מיכל');
    calls.length = 0; await chatSay(avi, 'נגמר החלב', { reply: 'איזה?', face: 'confused' });
    assert.match(sysText(calls[0]), new RegExp(`מה למדת בבית הזה[^\\n]*\\n- \\[כלל \\d+\\] ${RULE}`));
  });

  await check('T3', '"תזכור ש..." אותו כלל שוב: לא מוצע ולא נשמר פעמיים; מעל 30 כללים אין מקום', async () => {
    script.push({ reply: 'לזכור?', face: 'happy', actions: [{ kind: 'lesson', text: RULE }] }, { reply: 'כבר יודע!', face: 'happy' });
    calls.length = 0;
    const r = (await call(avi, 'POST', '/api/chat', { text: `תזכור ש${RULE}` })).data;
    assert.equal(r.proposal, undefined); assert.equal(calls.length, 2); assert.match(msgsText(calls[1]), /כבר למדת/);
    d1(`INSERT INTO lessons (text, added, added_by) VALUES ${Array.from({ length: 29 }, (_, i) => `('כלל ${i + 2}', ${Date.now()}, 1)`).join(',')}`);
    script.push({ reply: 'לזכור?', face: 'happy', actions: [{ kind: 'lesson', text: 'כלל חדש' }] }, { reply: 'אין לי מקום', face: 'sad' });
    calls.length = 0;
    await call(avi, 'POST', '/api/chat', { text: 'תזכור ש כלל חדש' });
    assert.match(msgsText(calls[1]), /כבר יש 30 כללים/);
    d1(`DELETE FROM lessons WHERE text LIKE 'כלל %'`);
  });

  await check('T4', 'ילד: רואה את הכללים, לא מאשר כלל חדש ולא עורך או מוחק', async () => {
    const add = await call(avi, 'POST', '/api/members', { add: { name: 'יובל', gender: 'm', role: 'child' } });
    kid = (await call(null, 'POST', '/api/pair', { code: add.data.code })).data.token;
    const s = await state(kid); assert.equal(s.lessons.length, 1);
    script.push({ reply: 'לזכור?', face: 'happy', actions: [{ kind: 'lesson', text: 'יובל אוהב במבה' }] });
    // decision 186: no card for the child; the grown-ups are asked, and the first answer counts
    const k = (await call(kid, 'POST', '/api/chat', { text: 'תזכור שאני אוהב במבה' })).data;
    assert.equal(k.proposal, undefined, JSON.stringify(k)); assert.match(k.reply, /שאלתי את אבי ומיכל\. אם הם יאשרו אני אזכור את זה\.$/); // the owner's words (r7e, question 113)
    const asked = (await call(avi, 'GET', '/api/chat')).data.messages.at(-1).content;
    assert.match(asked.reply, /^יובל ביקש שאזכור שיובל אוהב במבה\. האם לזכור\?$/); assert.deepEqual(asked.options, ['כן, תזכור', 'לא צריך']);
    assert.equal((await call(kid, 'POST', '/api/chat', { text: 'כן' })).data.applied, undefined, 'the child can\'t say yes');
    assert.equal((await call(avi, 'POST', '/api/chat', { text: 'כן' })).data.applied, true, 'a grown-up can');
    assert.equal(d1("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'ask:%'")[0].n, 0, 'Michal is no longer asked');
    const id = s.lessons[0].id;
    assert.equal((await call(kid, 'POST', '/api/lessons', { id, delete: true })).status, 403);
    assert.equal((await call(kid, 'POST', '/api/lessons', { id, text: 'x' })).status, 403);
  });

  await check('T5', 'עריכה ומחיקה של כלל (כל מבוגר); ריק נחסם; כלל שנמחק לא נשלח לשוקי', async () => {
    let s = await state(michal); const bamba = s.lessons.find((l) => l.text === 'יובל אוהב במבה');
    assert.equal((await call(michal, 'POST', '/api/lessons', { id: bamba.id, text: '  יובל   אוהב במבה אדומה ' })).status, 200);
    s = await state(michal); assert.equal(s.lessons.find((l) => l.id === bamba.id).text, 'יובל אוהב במבה אדומה');
    assert.equal((await call(michal, 'POST', '/api/lessons', { id: bamba.id, text: '   ' })).status, 400);
    assert.equal((await call(michal, 'POST', '/api/lessons', { id: bamba.id, delete: true })).status, 200);
    assert.equal((await call(michal, 'POST', '/api/lessons', { id: bamba.id, delete: true })).status, 404);
    calls.length = 0; await chatSay(avi, 'היי', { reply: 'היי', face: 'happy' });
    assert.doesNotMatch(sysText(calls[0]), /במבה אדומה/); assert.match(sysText(calls[0]), new RegExp(RULE));
  });

  await check('T6', 'גיבוי: הכללים וה-👍 בפנים; חזרה ליום קודם מחזירה כלל שנמחק', async () => {
    d1(`DELETE FROM backups`); await tick();
    const today = d1(`SELECT day FROM backups LIMIT 1`)[0].day;
    const exp = JSON.parse((await call(avi, 'GET', '/api/export')).text);
    // 0b: a 👍/👎 quotes the person's own chat, so a download has only the reader's own; the daily copy keeps all
    const mine = JSON.parse((await call(michal, 'GET', '/api/export')).text);
    assert.equal(exp.lessons.length, 1); assert.ok(mine.feedback.some((f) => f.kind === 'up')); assert.ok(!exp.feedback.length, 'Michal\'s 👍 in Avi\'s download');
    assert.ok(d1(`SELECT data FROM backups WHERE day = '${today}'`).map((r) => r.data).join('').includes('"kind":"up"'), 'the daily copy');
    const id = (await state(avi)).lessons[0].id;
    await call(avi, 'POST', '/api/lessons', { id, delete: true });
    assert.equal((await state(avi)).lessons.length, 0);
    assert.equal((await call(avi, 'POST', '/api/backups/restore', { day: today })).status, 200);
    assert.equal((await state(avi)).lessons[0]?.text, RULE);
  });
  await check('T7', '"איזה חלב?" של השרת לא נשאל כשכלל מסביר את המילה; בלי כלל כזה הוא נשאל כרגיל', async () => {
    d1(`INSERT INTO lessons (text, added, added_by) VALUES ('בבית הזה החלב של אבי הוא משקה סויה', ${Date.now()}, 1)`);
    d1(`UPDATE products SET name = 'חלב סויה' WHERE name = 'משקה סויה'`);
    let s = await state(avi); const soy = P(s, 'חלב סויה').id;
    const r = await chatSay(avi, 'נגמר החלב', { reply: 'לעדכן שנגמר חלב הסויה?', face: 'sad', actions: [{ kind: 'op', product_id: soy, op: { type: 'out' } }] });
    assert.ok(r.proposal, JSON.stringify(r)); assert.match(r.proposal.lines[0].text, /חלב סויה/);
    await call(avi, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
    d1(`DELETE FROM lessons`); // none that explains "milk"
    script.push({ reply: 'לעדכן?', face: 'sad', actions: [{ kind: 'op', product_id: soy, op: { type: 'out' } }] });
    const r2 = await chatSay(avi, 'נגמר החלב', { reply: 'לעדכן?', face: 'sad', actions: [{ kind: 'op', product_id: soy, op: { type: 'out' } }] });
    assert.equal(r2.proposal, undefined); assert.equal(r2.reply, 'איזה חלב?');
  });
  await check('T8', 'כלל שסותר כלל קיים: הכרטיס אומר "במקום", ובאישור הישן יוצא והחדש נכנס; מספר שלא קיים נדחה', async () => {
    d1(`INSERT INTO lessons (text, added, added_by) VALUES ('קונים רק קוטג תנובה', ${Date.now()}, 1)`);
    const old = (await state(avi)).lessons.find((l) => l.text === 'קונים רק קוטג תנובה');
    calls.length = 0;
    const r = await chatSay(michal, 'מעכשיו קוטג רק של טרה', { reply: 'להחליף?', face: 'happy', actions: [{ kind: 'lesson', text: 'קונים רק קוטג טרה', replaces: old.id }] });
    assert.match(sysText(calls[0]), new RegExp(`\\[כלל ${old.id}\\] קונים רק קוטג תנובה`));
    // "from now on..." said in so many words: remembered at once, no question back
    assert.equal(r.proposal, undefined); assert.equal(r.reply, 'סגור, אזכור שקונים רק קוטג טרה.'); // D10 (approved 02/10): says what
    const ls = (await state(avi)).lessons.map((l) => l.text); assert.deepEqual(ls, ['קונים רק קוטג טרה']);
    script.push({ reply: 'x', face: 'happy', actions: [{ kind: 'lesson', text: 'משהו', replaces: 99999 }] }, { reply: 'אין כזה', face: 'happy' });
    const r2 = (await call(avi, 'POST', '/api/chat', { text: 'מעכשיו משהו' })).data; assert.equal(r2.proposal, undefined);
  });
  await check('T9', 'שוקי יודע מי ילד (בשביל "רק מבוגר מלמד כלל")', async () => {
    calls.length = 0; await chatSay(kid, 'היי', { reply: 'היי', face: 'happy' });
    assert.match(sysText(calls[0]), /יובל \(זכר, ילד\)/);
  });
} finally {
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} round-17 checks passed`);
  writeFileSync('test/round17-results.json', JSON.stringify(results, null, 1)); writeFileSync('/tmp/shuki-test/r17-log.txt', log);
  try { process.kill(-dev.pid, 'SIGKILL'); } catch { /* gone */ }
  mock.close(); process.exit(ok === results.length ? 0 : 1);
}
