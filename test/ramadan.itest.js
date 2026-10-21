// Stage 9, מ15 (docs/stage9-plan.md): Ramadan, on the Node server with a fake model and the server's clock on the first day of
// Ramadan 1448 (8 February 2027, 10:00 in Jerusalem). The plan's I37–I39: Shuki's question once a year (q057), and the pace
// kept from last Ramadan (q058).
// Run: node --disable-warning=ExperimentalWarning test/ramadan.itest.js
import './fetch-retry.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DIR = '/tmp/shuki-test/shuki-ramadan'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const PORT = 8873, MOCK = 8874;
const RAMADAN = Date.UTC(2027, 1, 8, 8, 0); // 1 Ramadan 1448
const DAY = 86400e3;

// Avi (admin), Michal, Yoavi (a child)
const db = new DatabaseSync(`${DIR}/shuki.db`);
db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) { db.exec(readFileSync(`migrations/${f}`, 'utf8')); db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f); }
db.exec(readFileSync('test/fixture-house.sql', 'utf8'));
db.exec("INSERT INTO users (id, name, gender, role, active, created) VALUES (3, 'יואבי', 'm', 'child', 1, 0)");
db.exec("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999), ('222222', 2, 9999999999999), ('333333', 3, 9999999999999)");
db.close();

const requests = [];
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { const b = Buffer.concat(parts).toString('utf8'); // bytes first: a Hebrew letter can be split between chunks
  const body = JSON.parse(b); requests.push(body);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'tool_use', id: `t${requests.length}`, name: body.tools?.[0]?.name || 'respond', input: { reply: 'בסדר.', face: 'happy' } }], usage: { input_tokens: 1, output_tokens: 1 } }));
}); }).listen(MOCK, '127.0.0.1');
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/node.js'], { env: { ...process.env, PORT: String(PORT), DB_PATH: `${DIR}/shuki.db`, ANTHROPIC_API_KEY: 't', ANTHROPIC_URL: `http://127.0.0.1:${MOCK}/v1/messages`, TEST_RESET: '1', CHAT_PER_MINUTE: '1000', FIXED_NOW: String(RAMADAN) }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
const call = async (t, m, p, b) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const x = await r.text(); let data; try { data = JSON.parse(x); } catch { data = x; } return { status: r.status, data }; };
const sql = (q, ...a) => { const d = new DatabaseSync(`${DIR}/shuki.db`); try { return /^\s*select/i.test(q) ? d.prepare(q).all(...a) : d.prepare(q).run(...a); } finally { d.close(); } };
const results = [];
async function check(id, name, fn) {
  try { await fn(); results.push({ id, ok: true }); console.log('✓', id, name); }
  catch (e) { results.push({ id, ok: false }); console.log('✗', id, name, '\n   ', e.message.slice(0, 500)); }
}
const say = async (t, text) => (await call(t, 'POST', '/api/chat', { text })).data;
const ASK = 'האם יש מוצרים שצריך מהם יותר ברמדאן?';
/** a new day for Shuki's own question (one a day: r12 q030), and no question left open */
const fresh = () => sql("DELETE FROM settings WHERE key LIKE 'learnask:%' OR key LIKE 'ask:%' OR key LIKE 'askq:%'");
const habit = (value) => sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('house', 0, 'habit', ?, 1, 1, 1, 0, 'chat', 1, 1)", value);
const fasting = (uid, value) => sql("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', ?, 'fasting', ?, 1, ?, ?, 0, 'chat', 1, 1)", uid, value, uid, uid);
let avi, michal, yoavi;
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  [avi, michal, yoavi] = await Promise.all(['111111', '222222', '333333'].map(async (code) => (await call(null, 'POST', '/api/pair', { code })).data.token));
  // the phones were just paired: the joiner's questions would take the first message; not what's tested here
  sql("DELETE FROM settings WHERE key LIKE 'joinfood:%' OR key LIKE 'joinlife:%'");
  sql('DELETE FROM chat'); // the welcome, at the same fixed time as every message: it may come after them
  sql("UPDATE users SET created = ? WHERE id IN (1, 2, 3)", RAMADAN - DAY); // not a week yet: ז4's question isn't in the way

  await check('I39', 'בית בלי עובדה (יהודי כברירת מחדל): אין שאלה, ואין קצב של רמדאן', async () => {
    fresh();
    assert.equal((await say(avi, 'תודה')).reply, 'בסדר.');
    await call(avi, 'POST', '/api/__schedule', { now: Date.UTC(2026, 2, 20, 5, 5) }); // 1 Shawwal 1447, 07:05
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'ramadan_pace'")[0].n, 0);
  });

  await check('I37', 'בית מוסלמי (habit), א׳ רמדאן: השאלה, פעם אחת; התשובה הולכת למודל עם שורה; ילד לא נשאל', async () => {
    habit('חוגגים חגים מוסלמיים'); fresh();
    assert.equal((await say(avi, 'תודה')).reply, `בסדר. ${ASK}`);
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key = 'ask_once:ramadan1448:1'")[0].n, 1);
    fresh();
    assert.equal((await say(avi, 'תמרים וחלב')).reply, 'בסדר.', 'asked twice');
    // asked already: the day's one question of Shuki's is left for another (the reviewer of 3720e8f)
    assert.equal(sql("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'learnask:1:%'")[0].n, 0, 'the day\'s question taken');
    const sent = JSON.stringify(requests.at(-1).messages);
    assert.ok(sent.includes(`תמרים וחלב\\n(קודם שאלת: \\"${ASK}\\"`), sent.slice(-400));
    fresh();
    assert.equal((await say(yoavi, 'תודה')).reply, 'בסדר.', 'a child was asked');
    sql("DELETE FROM facts WHERE key = 'habit'"); // back to a Jewish house
  });

  await check('I37א', 'בבית יהודי, מבוגרת שצמה ברמדאן (fasting "רמדאן"): נשאלת; מי שלא צם: לא', async () => {
    fasting(2, 'צמה ברמדאן'); fresh();
    assert.equal((await say(michal, 'תודה')).reply, `בסדר. ${ASK}`);
    sql("DELETE FROM settings WHERE key = 'ask_once:ramadan1448:1'"); fresh();
    assert.equal((await say(avi, 'תודה')).reply, 'בסדר.', 'Avi does not fast');
    sql("DELETE FROM facts WHERE key IN ('habit', 'fasting')");
  });

  await check('I38', 'אחרי א׳ שוואל: ramadan_pace נכתב והחלון ב-pace_skip; שנה אחרי, ברמדאן, learned.every הוא של רמדאן', async () => {
    habit('חוגגים חגים מוסלמיים');
    sql("INSERT INTO products (name, count_type, qty, is_basic, created, updated) VALUES ('תמרים', 'units', 1, 1, 1, 1)");
    const p = sql("SELECT id FROM products WHERE name = 'תמרים'")[0].id;
    const cycle = (start, len, gap, until) => { for (let t = start; t + len < until; t += gap) sql("INSERT INTO product_log (event_id, ts, product_id, kind) VALUES (0, ?, ?, 'purchase'), (0, ?, ?, 'out')", t, p, t + len * DAY, p); };
    cycle(Date.UTC(2026, 1, 18, 9), 3, 4 * DAY, Date.UTC(2026, 2, 19, 9)); // Ramadan 1447: three days
    cycle(Date.UTC(2026, 8, 1, 9), 10, 20 * DAY, RAMADAN - DAY); // the rest of the year: ten days
    const shawwal = Date.UTC(2026, 2, 20, 5, 5); // 1 Shawwal 1447, 07:05
    await call(avi, 'POST', '/api/__schedule', { now: shawwal });
    const kept = JSON.parse(sql("SELECT value FROM settings WHERE key = 'ramadan_pace'")[0].value);
    assert.equal(kept.year, 1447); assert.equal(kept.pace[p], 3, JSON.stringify(kept));
    const skip = JSON.parse(sql("SELECT value FROM settings WHERE key = 'pace_skip'")[0].value);
    assert.ok(skip.some((w) => w.product_id === p && w.from <= Date.UTC(2026, 1, 18, 9) && w.to >= Date.UTC(2026, 2, 19, 9)), JSON.stringify(skip));
    sql("UPDATE settings SET value = json_set(value, '$.pace', json('{}')) WHERE key = 'ramadan_pace'");
    await call(avi, 'POST', '/api/__schedule', { now: shawwal + DAY }); // once a year
    assert.deepEqual(JSON.parse(sql("SELECT value FROM settings WHERE key = 'ramadan_pace'")[0].value).pace, {});
    sql("UPDATE settings SET value = ? WHERE key = 'ramadan_pace'", JSON.stringify(kept));
    const every = async () => (await call(avi, 'GET', '/api/state')).data.products.find((x) => x.id === p).learned?.every;
    assert.equal(await every(), 3, 'not Ramadan\'s pace in Ramadan');
    sql("UPDATE settings SET value = json_set(value, '$.year', 1448) WHERE key = 'ramadan_pace'"); // this Ramadan's own: not used
    assert.equal(await every(), 10);
  });
} finally {
  srv.kill(); mock.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} ramadan checks passed`);
if (failed.length) { console.log(log.split('\n').filter((l) => /error|Error/.test(l)).slice(-8).join('\n')); process.exit(1); }
