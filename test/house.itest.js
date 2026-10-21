// A household of its own: setup with the one-time code, the admin and the members, Shuki's key, time zone, push keys,
// and an existing house going through migration 0007. Run: node test/house.itest.js
import './fetch-retry.js';
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

const STATE = '/tmp/shuki-test/shuki-house';
const PORT = 8776, MOCK = 8774;
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
let dana, yoav, tal;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }

  await check('H1', 'התקנה חדשה: ריקה, קוד הקמה חד-פעמי, קוד שגוי נדחה, הקמה יוצרת מנהל, ואי אפשר להקים פעמיים', async () => {
    assert.equal(d1('SELECT COUNT(*) AS n FROM users')[0].n, 0, 'the example people are gone');
    assert.deepEqual((await call(null, 'GET', '/api/setup')).data, { needed: true });
    const code = d1("SELECT value FROM settings WHERE key = 'setup_code'")[0].value;
    assert.match(code, /^\d{8}$/); await new Promise((r) => setTimeout(r, 800)); assert.match(log, new RegExp(`setup code ${code}`), 'in the server log: ' + log.slice(-300));
    assert.equal((await call(null, 'POST', '/api/setup', { code: '11111111', name: 'דנה', gender: 'f' })).status, 400);
    // (no name is fine since 30/09: Shuki asks for it in the chat; house-ui S3)
    const r = await call(null, 'POST', '/api/setup', { code, house: 'הבית ברחוב הגפן', name: 'דנה', gender: 'f', tz: 'Europe/London' });
    assert.equal(r.status, 200, r.text); dana = r.data.token;
    assert.equal((await call(dana, 'POST', '/api/chat', { text: 'אחר כך' })).status, 200); // the first meeting waits (decision 169)
    assert.equal((await call(null, 'POST', '/api/setup', { code, name: 'מישהו', gender: 'm' })).status, 409);
    assert.deepEqual((await call(null, 'GET', '/api/setup')).data, { needed: false });
    const s = await state(dana);
    assert.equal(s.house, 'הבית ברחוב הגפן'); assert.equal(s.tz, 'Europe/London'); assert.equal(s.me.role, 'admin'); assert.equal(s.users.length, 1);
    assert.equal(d1("SELECT COUNT(*) AS n FROM settings WHERE key = 'setup_code'")[0].n, 0, 'code used up');
    assert.ok(!('vapid' in s.settings) && !('setup_code' in s.settings), 'no secrets in the state');
    assert.match(s.vapid || '', /^[A-Za-z0-9_-]{80,}$/, 'push key made by the server');
    assert.equal((await state(dana)).vapid, s.vapid, 'the same key next time');
    return `${s.house} · ${s.me.name}`;
  });

  await check('H2', 'המנהלת מוסיפה בני בית; כל אחד מתחבר בקוד שלו; חבר בית לא מוסיף, לא יוצר קודים לאחרים, אבל משנה את השם שלו', async () => {
    const a = await call(dana, 'POST', '/api/members', { add: { name: 'יואב', gender: 'm' } });
    assert.equal(a.status, 200, a.text); assert.match(a.data.code, /^\d{6}$/);
    yoav = (await call(null, 'POST', '/api/pair', { code: a.data.code, name: 'iPhone' })).data.token; assert.ok(yoav);
    assert.equal((await call(dana, 'POST', '/api/members', { add: { name: 'יואב', gender: 'm' } })).status, 400, 'twice');
    assert.equal((await call(dana, 'POST', '/api/members', { add: { name: 'x' } })).status, 400, 'no gender');
    let s = await state(yoav); assert.equal(s.me.role, 'member'); assert.deepEqual(s.users.map((u) => u.name).sort(), ['דנה', 'יואב']);
    assert.equal((await call(yoav, 'POST', '/api/members', { add: { name: 'טל', gender: 'f' } })).status, 403);
    const danaId = s.users.find((u) => u.name === 'דנה').id, yoavId = s.me.id;
    assert.equal((await call(yoav, 'POST', '/api/members', { id: danaId, code: true })).status, 403);
    assert.equal((await call(yoav, 'POST', '/api/devices/code', { user_id: danaId })).status, 403);
    assert.equal((await call(yoav, 'POST', '/api/members', { id: yoavId, code: true })).status, 200, 'a code for my own new phone');
    assert.equal((await call(yoav, 'POST', '/api/members', { id: danaId, edit: { name: 'דנוש' } })).status, 403);
    assert.equal((await call(yoav, 'POST', '/api/members', { id: yoavId, edit: { name: 'יואבי' } })).status, 200);
    assert.equal((await call(yoav, 'POST', '/api/settings', { house_name: 'שלי' })).status, 403, 'house name: admin');
    const t = await call(dana, 'POST', '/api/members', { add: { name: 'טל', gender: 'f' } });
    tal = (await call(null, 'POST', '/api/pair', { code: t.data.code })).data.token;
    s = await state(dana); assert.deepEqual(s.users.map((u) => u.name).sort(), ['דנה', 'טל', 'יואבי']);
    return s.users.map((u) => `${u.name}:${u.role}`).join(', ');
  });

  await check('H3', 'שוקי יודע מי בבית; "תגיד לטל" מגיע רק לטל; שם שלא בבית נשלח חזרה למודל', async () => {
    for (const t of [yoav, tal]) await call(t, 'POST', '/api/push/subscribe', { subscription: SUB });
    script.push({ reply: 'לשלוח לטל?', face: 'happy', actions: [{ kind: 'tell', to: 'טל', text: 'תקני לחם' }] });
    const c = (await call(dana, 'POST', '/api/chat', { text: 'תגידי לטל לקנות לחם' })).data;
    const sys = sysText(calls.at(-1));
    assert.match(sys, /הבית: הבית ברחוב הגפן\. בני הבית: /); for (const x of [/דנה \(נקבה, מנהלת הבית\)/, /טל \(נקבה\)/, /יואבי \(זכר\)/]) assert.match(sys, x);
    assert.doesNotMatch(sys, /(^|[^א-ת])(אבי|מיכל)(?![א-ת])/, 'no fixed names');
    assert.ok(JSON.stringify(calls.at(-1).tools[0].input_schema).includes('"יואבי"'), 'names in the schema');
    assert.match(c.proposal.lines[0].text, /^להגיד לטל: תקני לחם/);
    const r = (await call(dana, 'POST', `/api/proposals/${c.proposal.id}/apply`, {})).data;
    assert.deepEqual(r.notify.map((x) => x.to), ['טל'], JSON.stringify(r.notify));
    const chat = (await call(tal, 'GET', '/api/chat')).data.messages;
    assert.ok(chat.some((m) => /^טל, דנה ביקשה שאגיד לך: תקני לחם/.test(m.content.reply || '')));
    script.push({ reply: 'לשלוח?', face: 'happy', actions: [{ kind: 'tell', to: 'משה', text: 'היי' }] });
    script.push({ reply: 'אין בבית מישהו בשם משה.', face: 'confused' });
    const n = calls.length; const c2 = (await call(dana, 'POST', '/api/chat', { text: 'תגיד למשה היי' })).data;
    assert.equal(calls.length, n + 2); assert.ok(!c2.proposal);
    return r.notify[0].body;
  });

  await check('H4', 'להוציא מהבית: הטלפונים מתנתקים, השם נשאר ביומן, מי שחוזר מקבל את אותו משתמש; תמיד נשאר מנהל', async () => {
    let s = await state(dana); const talId = s.users.find((u) => u.name === 'טל').id, danaId = s.me.id, yoavId = s.users.find((u) => u.name === 'יואבי').id;
    await call(tal, 'POST', '/api/actions', { actions: [{ kind: 'list_add', text: 'נרות' }] });
    assert.equal((await call(yoav, 'POST', '/api/members', { id: talId, remove: true })).status, 403);
    assert.equal((await call(dana, 'POST', '/api/members', { id: talId, remove: true })).status, 200);
    assert.equal((await call(tal, 'GET', '/api/state')).status, 401, 'her phone is out');
    s = await state(dana); assert.ok(!s.users.some((u) => u.name === 'טל')); assert.ok(s.journal.some((j) => /^מי שגרה כאן הוסיפה לרשימה נרות/.test(j.summary)) && !s.journal.some((j) => /טל/.test(j.summary)), 'her line stays, without her name (r0t p2)');
    const back = await call(dana, 'POST', '/api/members', { add: { name: 'טל', gender: 'f' } });
    assert.notEqual(back.data.id, talId, 'someone new with her name is a new person (stage 13, d4)');
    assert.equal((await call(dana, 'POST', '/api/members', { id: danaId, remove: true })).status, 400, 'the only admin');
    assert.equal((await call(dana, 'POST', '/api/members', { id: danaId, role: 'member' })).status, 400);
    assert.equal((await call(dana, 'POST', '/api/members', { id: yoavId, role: 'admin' })).status, 200);
    assert.equal((await call(yoav, 'POST', '/api/members', { id: danaId, role: 'member' })).status, 200, 'handed over');
    s = await state(dana); assert.equal(s.me.role, 'member');
    await call(yoav, 'POST', '/api/members', { id: danaId, role: 'admin' });
    assert.equal((await call(dana, 'POST', '/api/members', { id: yoavId, role: 'member' })).status, 200);
    return 'ok';
  });

  await check('H5', 'מפתח Claude מהאפליקציה: נבדק לפני שמירה, לא יוצא מהשרת (לא במצב, לא בגיבוי), רק מנהל, והסרה חוזרת למפתח של השרת', async () => {
    assert.equal((await call(dana, 'POST', '/api/settings', { anthropicKey: 'hello' })).status, 400);
    assert.equal((await call(yoav, 'POST', '/api/settings', { anthropicKey: 'sk-ant-api03-' + 'x'.repeat(40) })).status, 403, 'member');
    const r = await call(dana, 'POST', '/api/settings', { anthropicKey: 'sk-ant-api03-' + 'x'.repeat(40) });
    assert.equal(r.status, 200, r.text);
    let s = await state(yoav); assert.equal(s.keyFrom, 'app'); assert.ok(!JSON.stringify(s).includes('sk-ant'), 'not in the state');
    const exp = await call(dana, 'GET', '/api/export'); assert.ok(!exp.text.includes('sk-ant') && !exp.text.includes('privateJwk'), 'not in the backup');
    script.push({ reply: 'היי', face: 'happy' });
    await call(dana, 'POST', '/api/chat', { text: 'היי' });
    await call(dana, 'POST', '/api/settings', { anthropicKey: '' });
    s = await state(dana); assert.equal(s.keyFrom, 'server');
    return 'ok';
  });

  await check('H6', 'אזור זמן: רק אזור אמיתי, ורק מנהל', async () => {
    assert.equal((await call(dana, 'POST', '/api/settings', { tz: 'Mars/Olympus' })).status, 400);
    assert.equal((await call(yoav, 'POST', '/api/settings', { tz: 'Asia/Tokyo' })).status, 403, 'member');
    assert.equal((await call(dana, 'POST', '/api/settings', { tz: 'Asia/Tokyo' })).status, 200);
    assert.equal((await state(yoav)).tz, 'Asia/Tokyo');
    return 'ok';
  });

  await check('H7', 'בית קיים (אבי ומיכל עם טלפונים) עובר את מיגרציה 0007: אף אחד לא נמחק, אבי מנהל, לבית יש שם', async () => {
    const S2 = '/tmp/shuki-test/shuki-house-old';
    rmSync(S2, { recursive: true, force: true });
    const ex = (a) => execSync(`npx wrangler d1 execute shuki --local --persist-to ${S2} ${a}`, { stdio: 'ignore' });
    for (const f of ['0001_init', '0002_pair_attempts', '0003_shopping_growth', '0004_count_maybe_open_away', '0005_remind', '0006_recipes_pesach']) ex(`--file migrations/${f}.sql`);
    ex(`--command "INSERT INTO users (id, name, gender) VALUES (1, 'אבי', 'm'), (2, 'מיכל', 'f')"`); // an early install had these two
    ex(`--command "INSERT INTO devices (user_id, token_hash, name, created, last_seen) VALUES (1, 'a', 'x', 1, 1), (2, 'b', 'y', 1, 1)"`);
    ex('--file migrations/0007_household.sql');
    const q = (sql) => JSON.parse(execSync(`npx wrangler d1 execute shuki --local --persist-to ${S2} --json --command "${sql}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^[^[]*/, ''))[0].results;
    const users = q('SELECT id, name, role, active FROM users ORDER BY id');
    assert.deepEqual(users.map((u) => [u.id, u.role, u.active]), [[1, 'admin', 1], [2, 'member', 1]]);
    assert.equal(q("SELECT value FROM settings WHERE key = 'house_name'")[0].value, 'הבית של אבי ומיכל');
    return users.map((u) => `${u.name}:${u.role}`).join(', ');
  });
} finally {
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} household checks passed`);
  (await import('node:fs')).writeFileSync('test/house-results.json', JSON.stringify(results, null, 1));
  try { process.kill(-dev.pid, 'SIGKILL'); } catch { /* gone */ }
  mock.close();
  process.exit(ok === results.length ? 0 : 1);
}
