// "להתחיל מהתחלה" in the chat (approved 01/10): only the admin, with a yes; the inventory, the list and the chat go,
// the people, phones and recipes stay; then who lives in the house now. Run: node test/restart.itest.js
import './fetch-retry.js';
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

const STATE = '/tmp/shuki-test/shuki-restart';
const PORT = 8791, MOCK = 8792;
const d1 = (sql) => JSON.parse(execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --json --command "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^[^[]*/, ''))[0].results;
rmSync(STATE, { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply shuki --local --persist-to ${STATE}`, { stdio: 'ignore' });

const script = []; const calls = [];
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { const b = Buffer.concat(parts).toString('utf8'); // bytes first: a Hebrew letter can be split between chunks (question 29)

  calls.push(JSON.parse(b));
  const input = script.shift() || { reply: 'ok', face: 'happy' };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'tool_use', id: 'tu1', name: 'respond', input }], usage: { input_tokens: 100, output_tokens: 10 } }));
}); }).listen(MOCK);
const dev = spawn('npx', ['wrangler', 'dev', '--local', '--test-scheduled', '--port', String(PORT), '--persist-to', STATE, '--var', `ANTHROPIC_URL:http://127.0.0.1:${MOCK}/v1/messages`, '--var', 'ANTHROPIC_API_KEY:t'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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




const sysText = (c) => c.system.map((x) => x.text).join('\n');

const bots = async (t) => (await call(t, 'GET', '/api/chat')).data.messages.filter((m) => m.role === 'shuki').map((m) => m.content);
const say = async (t, text) => { const r = await call(t, 'POST', '/api/chat', { text }); assert.equal(r.status, 200, r.text); return r.data; };
let dana, yoav;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }

  await check('R1', 'בית עם מלאי, רשימה, מתכון וצ\'אט', async () => {
    await call(null, 'GET', '/api/setup'); await new Promise((r) => setTimeout(r, 500));
    const code = d1("SELECT value FROM settings WHERE key = 'setup_code'")[0].value;
    dana = (await call(null, 'POST', '/api/setup', { code, house: 'הבית', name: 'דנה', gender: 'f' })).data.token;
    await say(dana, 'אחר כך');
    const a = await call(dana, 'POST', '/api/members', { add: { name: 'יואב', gender: 'm' } });
    yoav = (await call(null, 'POST', '/api/pair', { code: a.data.code, name: 'iPhone' })).data.token;
    await act(dana, [{ kind: 'create', product: { name: 'ביצים', count_type: 'units', qty: 4 } }, { kind: 'create', product: { name: 'חלב', count_type: 'units', qty: 0 } }, { kind: 'list_add', text: 'במבה' }]);
    assert.equal((await call(dana, 'POST', '/api/recipes', { name: 'שקשוקה', ingredients: '6 ביצים\nמלח' })).status, 200);
    const s = await state(dana);
    assert.ok(s.recipes[0].ings.find((i) => i.name === 'ביצים').product_id, 'eggs linked');
    return `${s.products.length} products, ${s.list.length} on the list`;
  });

  await check('R2', 'חבר בית שאומר "להתחיל מהתחלה" מקבל תשובה רגילה, לא את השאלה', async () => {
    script.push({ reply: 'רק מנהלת הבית יכולה.', face: 'happy' });
    const r = await say(yoav, 'בוא נתחיל מהתחלה');
    assert.equal(r.reply, 'רק מנהלת הבית יכולה.');
    assert.equal((await state(dana)).products.length, 2);
  });

  await check('R3', 'המנהלת: שוקי שואל, ו"לא" לא נוגע בכלום', async () => {
    const r = await say(dana, 'אני רוצה להתחיל מהתחלה');
    assert.equal(r.reply, "האם למחוק את המלאי, הרשימה והצ'אט ולהתחיל מחדש? חברי הבית והטלפונים נשארים. לפני כן אשמור גיבוי.");
    assert.deepEqual(r.options, ['כן, מתחילים מחדש', 'לא']);
    const n = await say(dana, 'לא');
    assert.equal(n.reply, 'בסדר, לא נגעתי בכלום.');
    assert.equal((await state(dana)).products.length, 2);
  });

  await check('R4', '"כן, מתחילים מחדש": המלאי, הרשימה והצ\'אט נמחקים; אנשים, טלפונים ומתכונים נשארים; יש גיבוי', async () => {
    await say(dana, 'לאפס את הכל');
    const r = await say(dana, 'כן, מתחילים מחדש');
    assert.equal(r.reply, 'האם היו שינויים בחברי הבית? האם מישהו הצטרף או עזב?');
    assert.deepEqual(r.options, ['כן', 'לא, הכל אותו דבר']);
    const s = await state(dana);
    assert.equal(s.products.length, 0); assert.equal(s.list.length, 0);
    assert.equal(s.recipes.length, 1, 'the recipe stays');
    assert.equal(s.users.length, 2);
    assert.equal((await state(yoav)).me.name, 'יואב', 'his phone still works');
    const b = await bots(dana); assert.equal(b.length, 1, JSON.stringify(b)); assert.equal(b[0].reply, r.reply);
    assert.equal(d1("SELECT COUNT(DISTINCT day) AS n FROM backups WHERE day LIKE 'before:%'")[0].n, 1, 'a copy first');
  });

  await check('R5', '"כן": מי גר בבית עכשיו; חדשים נכנסים (עם שאלה על הלשון), מי שעזב יוצא אחרי "כן, להוציא"', async () => {
    const r = await say(dana, 'כן');
    assert.equal(r.reply, 'ספרו לי מי גר בבית עכשיו.');
    script.push({ people: [{ name: 'אורית', gender: 'f', child: false }, { name: 'רוני', gender: 'unknown', child: true, age: 5 }] });
    const g1 = await say(dana, 'אני, אורית ורוני הקטן');
    assert.equal(g1.reply, 'איך לפנות לרוני?'); assert.deepEqual(g1.options, ['בלשון זכר', 'בלשון נקבה', 'בלשון רבים']);
    const out = await say(dana, 'בלשון זכר');
    assert.equal(out.reply, 'האם יואב כבר לא גר בבית?'); assert.deepEqual(out.options, ['כן, להוציא', 'לא, נשאר']);
    let b = await bots(dana);
    assert.ok(b.some((m) => m.reply === 'איזה כיף, עכשיו אני מכיר גם את אורית ורוני!'), JSON.stringify(b.map((m) => m.reply)));
    assert.equal(b.find((m) => m.codes)?.codes.length, 2);
    const fin = await say(dana, 'כן, להוציא');
    assert.equal(fin.reply, 'סיימנו! אפשר להתחיל לספר לי מה יש בבית.');
    b = await bots(dana); assert.ok(b.some((m) => m.reply === 'יואב יצא מהבית.'));
    const out401 = await call(yoav, 'GET', '/api/state');
    assert.equal(out401.status, 401, 'his phone is out');
    assert.deepEqual(out401.data.removed, { name: 'דנה', gender: 'f' }, `56: who took him out (c06): ${JSON.stringify(out401.data)}`);
    const us = (await state(dana)).users.map((u) => `${u.name}:${u.role}:${u.gender}`).sort();
    assert.deepEqual(us, ['דנה:admin:f', 'אורית:member:f', 'רוני:child:m']);
  });

  await check('R6', 'המתכון מתחבר שוב לביצים כשהן חוזרות למלאי', async () => {
    assert.ok(!(await state(dana)).recipes[0].ings.find((i) => i.name === 'ביצים').product_id);
    await act(dana, [{ kind: 'create', product: { name: 'ביצים', count_type: 'units', qty: 6 } }]);
    const s = await state(dana);
    assert.equal(s.recipes[0].ings.find((i) => i.name === 'ביצים').product_id, s.products.find((p) => p.name === 'ביצים').id);
  });

  await check('R7', '"לא, הכל אותו דבר": סיימנו, ואף אחד לא יוצא', async () => {
    await say(dana, 'בואו נתחיל מחדש');
    await say(dana, 'כן, מתחילים מחדש');
    const r = await say(dana, 'לא, הכל אותו דבר');
    assert.equal(r.reply, 'סיימנו! אפשר להתחיל לספר לי מה יש בבית.');
    assert.equal((await state(dana)).users.length, 3);
  });

  await check('R8', 'באמצע, הודעה שאינה תשובה עוברת לצ\'אט הרגיל ולא נמחק כלום', async () => {
    await act(dana, [{ kind: 'create', product: { name: 'אורז', count_type: 'units', qty: 1 } }]);
    await say(dana, 'להתחיל מהתחלה');
    const before = calls.length;
    const r = await say(dana, 'נגמר החלב');
    assert.ok(calls.length > before, 'the model answered it'); assert.ok(!/היו שינויים|למחוק את המלאי/.test(r.reply || ''), r.reply);
    assert.ok((await state(dana)).products.some((p) => p.name === 'אורז'));
    const r2 = await say(dana, 'כן, מתחילים מחדש');
    assert.notEqual(r2.reply, 'האם היו שינויים בחברי הבית? האם מישהו הצטרף או עזב?', 'the question is over');
  });
  // stage 9, מ29 (q108): whose a product was comes back with it, by its name; never a private one's name; not someone who left
  const orit = () => d1("SELECT id FROM users WHERE name = 'אורית'")[0].id;
  await check('R9א', 'מ29: מוצר של אורית; "להתחיל מהתחלה", ואז create באותו שם: owner של אורית; מוצר פרטי לא נשמר ב-relink_owner', async () => {
    await act(dana, [{ kind: 'create', product: { name: 'קפה של אורית', count_type: 'units', qty: 1 } }, { kind: 'create', private: true, product: { name: 'קרם פנים', count_type: 'units', qty: 1 } }]);
    d1(`UPDATE products SET owner = ${orit()} WHERE name IN ('קפה של אורית', 'קרם פנים')`); // the private one too: its name stays out
    // after R8's message in the middle, the first "להתחיל מהתחלה" may be answered as chat: ask until the question comes
    let q = ''; for (let i = 0; i < 3 && !/האם למחוק את המלאי/.test(q); i++) q = (await say(dana, 'להתחיל מהתחלה')).reply || '';
    assert.match(q, /האם למחוק את המלאי/);
    await say(dana, 'כן, מתחילים מחדש'); await say(dana, 'לא, הכל אותו דבר');
    const kept = JSON.parse(d1("SELECT value FROM settings WHERE key = 'relink_owner'")[0]?.value || '[]');
    assert.deepEqual(kept, [{ name: 'קפה של אורית', owner: orit() }], JSON.stringify(kept));
    await act(dana, [{ kind: 'create', product: { name: 'קפה של אורית', count_type: 'units', qty: 1 } }]);
    assert.equal((await state(dana)).products.find((p) => p.name === 'קפה של אורית')?.owner, orit(), 'the first state after it says whose');
    assert.equal(d1("SELECT COUNT(*) AS n FROM settings WHERE key = 'relink_owner'")[0].n, 0, 'the line stayed');
  });
  await check('R9ב', 'מ29: אורית יוצאת מהבית: השורות שלה יוצאות מ-relink_owner, של דנה נשארות', async () => {
    const id = orit();
    d1(`INSERT OR REPLACE INTO settings (key, value) VALUES ('relink_owner', '${JSON.stringify([{ name: 'שמפו', owner: id }, { name: 'תה', owner: 1 }])}')`);
    assert.equal((await call(dana, 'POST', '/api/members', { id, remove: true })).status, 200);
    assert.deepEqual(JSON.parse(d1("SELECT value FROM settings WHERE key = 'relink_owner'")[0].value), [{ name: 'תה', owner: 1 }]);
  });
} finally {
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} restart checks passed`);
  (await import('node:fs')).writeFileSync('test/restart-results.json', JSON.stringify(results, null, 1));
  try { process.kill(-dev.pid, 'SIGKILL'); } catch { /* gone */ }
  mock.close();
  process.exit(ok === results.length ? 0 : 1);
}
