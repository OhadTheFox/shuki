// Stage 5, p7 (approved 02/10, 05/10): someone taken out of the house by someone else hears it on their phones before
// they are disconnected (c05), right away and outside the two pushes a day; after that, the 401 says who took them out
// (c06), for 30 days. Not on "לצאת מהבית". On the Node server, with a push service that only counts.
// Run: node --disable-warning=ExperimentalWarning test/removed.itest.js
import './fetch-retry.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DIR = '/tmp/shuki-test/shuki-removed'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const PORT = 8811, MOCK = 8812;
const db = new DatabaseSync(`${DIR}/shuki.db`);
db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) { db.exec(readFileSync(`migrations/${f}`, 'utf8')); db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f); }
db.exec(readFileSync('test/fixture-house.sql', 'utf8'));
db.exec("INSERT INTO users (id, name, gender, role, active, created) VALUES (3, 'יואבי', 'm', 'child', 1, 0), (4, 'דנה', 'f', 'member', 1, 0)");
db.exec("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999), ('222222', 2, 9999999999999), ('333333', 3, 9999999999999), ('444444', 4, 9999999999999), ('444445', 4, 9999999999999)");
db.close();

const pushes = []; let failing = false; // the push service: who got one (by the path of their subscription); `failing`: it answers 500
const mock = http.createServer((req, res) => { req.on('data', () => {}); req.on('end', () => { pushes.push(req.url); res.writeHead(failing ? 500 : 201); res.end(); }); }).listen(MOCK, '127.0.0.1');
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/node.js'], { env: { ...process.env, PORT: String(PORT), DB_PATH: `${DIR}/shuki.db`, PUSH_ALLOW: `127.0.0.1:${MOCK}`, TEST_RESET: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
const call = async (t, m, p, b) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, data: await r.json().catch(() => ({})) }; };
const sql = (q, ...a) => { const d = new DatabaseSync(`${DIR}/shuki.db`); try { return /^\s*select/i.test(q) ? d.prepare(q).all(...a) : d.prepare(q).run(...a); } finally { d.close(); } };
const results = [];
async function check(id, name, fn) {
  try { await fn(); results.push({ id, ok: true }); console.log('✓', id, name); }
  catch (e) { results.push({ id, ok: false }); console.log('✗', id, name, '\n   ', e.message.slice(0, 500)); }
}
// a subscription key as a browser makes it (the push is encrypted to it), the one stories.itest uses
const SUBKEYS = JSON.stringify({ p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' });
const day = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(ts);

try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const [avi, michal, , dana, dana2] = await Promise.all(['111111', '222222', '333333', '444444', '444445'].map(async (code) => (await call(null, 'POST', '/api/pair', { code })).data.token));
  sql(`UPDATE devices SET push_sub = '{"endpoint":"http://127.0.0.1:${MOCK}/u' || user_id || '-' || id || '","keys":${SUBKEYS}}', push_on = 1`);

  await check('R1', 'אבי מוציא את דנה: לשני הטלפונים שלה "אבי הוציא אותך מהבית…", גם אחרי 2 התראות היום; אחר כך ה-401 אומר מי (c05, c06)', async () => {
    sql('INSERT INTO settings (key, value) VALUES (?, ?)', `pushes:4:${day(Date.now())}`, '2'); // her two of today already went
    pushes.length = 0;
    const r = await call(avi, 'POST', '/api/members', { id: 4, remove: true });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(pushes.filter((u) => /^\/u4-/.test(u)).length, 2, `pushes: ${JSON.stringify(pushes)}`);
    assert.ok(!pushes.some((u) => !/^\/u4-/.test(u)), `pushes to others: ${JSON.stringify(pushes)}`);
    assert.equal(sql("SELECT value FROM settings WHERE key LIKE 'pushes:4:%'")[0].value, '2', 'counted in the two a day');
    for (const t of [dana, dana2]) {
      const g = await call(t, 'GET', '/api/state');
      assert.equal(g.status, 401); assert.deepEqual(g.data, { error: 'הטלפון הזה כבר לא מחובר אליי', removed: { name: 'אבי', gender: 'm' } });
    }
  });

  await check('R2', 'הניתוק עצמו בלי שם: טוקן שלא מוכר, או טלפון שנותק ממסך המכשירים', async () => {
    const g = await call('a'.repeat(64), 'GET', '/api/state');
    assert.deepEqual(g.data, { error: 'הטלפון הזה כבר לא מחובר אליי' });
    const dev = sql('SELECT id FROM devices WHERE user_id = 2')[0].id;
    assert.equal((await call(avi, 'DELETE', `/api/devices/${dev}`)).status, 200);
    assert.deepEqual((await call(michal, 'GET', '/api/state')).data, { error: 'הטלפון הזה כבר לא מחובר אליי' });
  });

  await check('R3', '"לצאת מהבית": בלי התראה ובלי שם', async () => {
    const [m2] = [(await call(null, 'POST', '/api/pair', { code: (sql("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('222223', 2, 9999999999999)"), '222223') })).data.token];
    sql(`UPDATE devices SET push_sub = '{"endpoint":"http://127.0.0.1:${MOCK}/u2-x","keys":${SUBKEYS}}' WHERE user_id = 2`);
    sql("UPDATE users SET role = 'admin' WHERE id = 2");
    pushes.length = 0;
    assert.equal((await call(m2, 'POST', '/api/members', { id: 2, remove: true })).status, 200);
    assert.deepEqual(pushes, []);
    assert.deepEqual((await call(m2, 'GET', '/api/state')).data, { error: 'הטלפון הזה כבר לא מחובר אליי' });
  });

  await check('R5', 'מיכל, מנהלת, מוציאה את יואבי: "הוציאה"; התראה שנכשלת לא עוצרת את ההוצאה (53, 56)', async () => {
    sql("UPDATE users SET role = 'admin', active = 1, name = 'מיכל' WHERE id = 2"); // back, as the test's shortcut (a name freed when she left, stage 13)
    sql("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('222224', 2, 9999999999999), ('333334', 3, 9999999999999)");
    const m3 = (await call(null, 'POST', '/api/pair', { code: '222224' })).data.token, y = (await call(null, 'POST', '/api/pair', { code: '333334' })).data.token;
    sql(`UPDATE devices SET push_sub = '{"endpoint":"http://127.0.0.1:${MOCK}/fail","keys":${SUBKEYS}}' WHERE user_id = 3`);
    failing = true;
    assert.equal((await call(m3, 'POST', '/api/members', { id: 3, remove: true })).status, 200, 'a failed push stopped the removal');
    failing = false;
    assert.deepEqual((await call(y, 'GET', '/api/state')).data.removed, { name: 'מיכל', gender: 'f' });
  });

  await check('R4', 'אחרי 30 יום השם נמחק (runSchedule)', async () => {
    assert.ok(sql('SELECT COUNT(*) AS n FROM removed')[0].n >= 2);
    sql('UPDATE removed SET ts = ?', Date.now() - 31 * 86400e3);
    await call(avi, 'POST', '/api/__schedule', { now: Date.now() });
    assert.equal(sql('SELECT COUNT(*) AS n FROM removed')[0].n, 0);
    assert.deepEqual((await call(dana, 'GET', '/api/state')).data, { error: 'הטלפון הזה כבר לא מחובר אליי' });
  });
} finally {
  srv.kill(); mock.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} removed checks passed`);
if (failed.length) { console.log(log.split('\n').filter((l) => /error|Error/.test(l)).slice(-8).join('\n')); process.exit(1); }
