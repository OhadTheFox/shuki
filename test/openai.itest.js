// ChatGPT as Shuki's brain (decision 111): the request OpenAI gets, the repair round, a photo, the month's cost,
// running out of credit, and switching keys between Claude and ChatGPT in the app. Run: node test/openai.itest.js
import './fetch-retry.js';
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';

const STATE = '/tmp/shuki-test/shuki-openai';
const PORT = 8796, MOCK = 8794;
const d1 = (sql) => JSON.parse(execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --json --command "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^[^[]*/, ''))[0].results;
rmSync(STATE, { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply shuki --local --persist-to ${STATE}`, { stdio: 'ignore' });
execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --file test/fixture-house.sql`, { stdio: 'ignore' });
d1(`INSERT INTO pairing_codes (code, user_id, expires) VALUES ('481516', 1, 9999999999999), ('481517', 2, 9999999999999)`);

const script = []; const calls = []; let failNext = null;
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { const b = Buffer.concat(parts).toString('utf8'); // bytes first: a Hebrew letter can be split between chunks (question 29)

  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.url.endsWith('/models')) return send(req.headers.authorization === 'Bearer sk-proj-good0000000000000000000000' ? 200 : 401, { data: [] });
  if (req.url.endsWith('/messages')) return send(200, { content: [{ type: 'tool_use', id: 'x', name: 'respond', input: { reply: 'hi', face: 'happy' } }], usage: { input_tokens: 1, output_tokens: 1 } });
  calls.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(b) });
  if (failNext) { const f = failNext; failNext = null; return send(f.code, f.body); }
  const input = script.shift() || { reply: 'בסדר', face: 'happy' };
  send(200, { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: `call_${calls.length}`, type: 'function', function: { name: 'respond', arguments: JSON.stringify(input) } }] } }],
    usage: { prompt_tokens: 1000000, completion_tokens: 100000, prompt_tokens_details: { cached_tokens: 0 } } });
}); }).listen(MOCK);
const dev = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(PORT), '--persist-to', STATE, '--var', 'PROVIDER:openai', '--var', `OPENAI_URL:http://127.0.0.1:${MOCK}/v1/chat/completions`, '--var', 'OPENAI_API_KEY:sk-test000000000000000000000', '--var', 'ANTHROPIC_API_KEY:', '--var', `ANTHROPIC_URL:http://127.0.0.1:${MOCK}/v1/messages`, '--var', 'TEST_RESET:1'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = ''; dev.stdout.on('data', (d) => (log += d)); dev.stderr.on('data', (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
const call = async (t, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const txt = await r.text(); let data = null; try { data = JSON.parse(txt); } catch { /* text */ } return { status: r.status, data, text: txt }; };
const state = async (t) => (await call(t, 'GET', '/api/state')).data;
const results = [];
async function check(id, name, fn) {
  try { const note = await fn(); results.push({ id, name, ok: true, note: note || '' }); console.log('✓', id, name, note ? `— ${note}` : ''); }
  catch (e) { results.push({ id, name, ok: false, error: e.message.slice(0, 400) }); console.log('✗', id, name, '\n   ', e.message.slice(0, 400)); }
}
let avi;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  avi = (await call(null, 'POST', '/api/pair', { code: '481516', name: 'iPhone' })).data.token;
  await call(avi, 'POST', '/api/settings', { costCap: 1000 });
  await call(avi, 'POST', '/api/actions', { actions: [{ kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 1, is_basic: 1, target: 2 } }] });
  const milk = (await state(avi)).products[0].id;

  await check('OA1', 'הבקשה ל-OpenAI: המודל, ההנחיות כהודעת system, כלי respond חובה; והתשובה הופכת לכרטיס', async () => {
    script.push({ reply: 'לעדכן שנגמר החלב?', face: 'sad', actions: [{ kind: 'op', product_id: milk, op: { type: 'out' } }] });
    calls.length = 0; const r = (await call(avi, 'POST', '/api/chat', { text: 'נגמר החלב' })).data;
    const c = calls[0]; assert.match(c.url, /\/v1\/chat\/completions$/); assert.equal(c.auth, 'Bearer sk-test000000000000000000000');
    assert.equal(c.body.model, 'gpt-5.6-terra'); assert.equal(c.body.reasoning_effort, 'none', 'function tools need reasoning off (the real API, 30/09)'); assert.equal(c.body.messages[0].role, 'system'); assert.match(c.body.messages[0].content, /^אתה שוקי/);
    assert.match(c.body.messages[0].content, /חלב 3%/, 'the catalog is in the system message');
    assert.deepEqual(c.body.tool_choice, { type: 'function', function: { name: 'respond' } }); assert.equal(c.body.tools[0].function.name, 'respond');
    assert.equal(c.body.messages.at(-1).role, 'user'); assert.match(c.body.messages.at(-1).content, /נגמר החלב/);
    assert.match(r.proposal.lines[0].text, /^לסמן שנגמר החלב 3%( ולהוסיף לרשימה)?\?$/); assert.equal((await state(avi)).provider, 'openai');
  });

  await check('OA2', 'תיקון: מוצר שלא קיים חוזר למודל כקריאה + תשובת tool עם אותו מזהה', async () => {
    script.push({ reply: 'לעדכן?', face: 'sad', actions: [{ kind: 'op', product_id: 999, op: { type: 'out' } }] }, { reply: 'לעדכן?', face: 'sad', actions: [{ kind: 'op', product_id: milk, op: { type: 'out' } }] });
    calls.length = 0; const r = (await call(avi, 'POST', '/api/chat', { text: 'נגמר שוב' })).data;
    assert.equal(calls.length, 2); const m = calls[1].body.messages;
    const a = m.at(-2), t = m.at(-1);
    assert.equal(a.role, 'assistant'); assert.equal(a.tool_calls[0].id, 'call_1'); assert.match(a.tool_calls[0].function.arguments, /999/);
    assert.equal(t.role, 'tool'); assert.equal(t.tool_call_id, 'call_1'); assert.match(t.content, /לא קיים בקטלוג/);
    assert.match(r.proposal.lines[0].text, /^לסמן שנגמר החלב 3%( ולהוסיף לרשימה)?\?$/);
  });

  await check('OA3', 'תמונה נשלחת כ-data URL', async () => {
    calls.length = 0; await call(avi, 'POST', '/api/chat', { text: 'קבלה', image: { media_type: 'image/jpeg', data: 'QUJD' } });
    const u = calls[0].body.messages.at(-1); assert.equal(u.content[0].type, 'image_url'); assert.equal(u.content[0].image_url.url, 'data:image/jpeg;base64,QUJD'); assert.equal(u.content[1].type, 'text');
  });

  await check('OA4', 'עלות החודש במחיר של ChatGPT ($2 למיליון נכנסים, $12 ליוצאים)', async () => {
    const n = d1('SELECT micro FROM usage')[0].micro; const perCall = 2 * 1e6 + 12 * 1e5;
    assert.equal(n % perCall, 0, String(n)); assert.equal((await state(avi)).cost.spent, Math.round((n / 1e6) * 100) / 100);
  });

  await check('OA5', 'בלי קרדיט ב-OpenAI: הצ\'אט ננעל עם הסבר על ChatGPT ו-OpenAI', async () => {
    failNext = { code: 429, body: { error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } } };
    const r = (await call(avi, 'POST', '/api/chat', { text: 'היי' })).data;
    assert.equal(r.brainError, 'credit'); assert.match(r.reply, /ChatGPT/); assert.match(r.reply, /OpenAI/);
    d1("DELETE FROM settings WHERE key = 'brain_error'");
  });

  await check('OA6', 'מפתח באפליקציה: sk-... = ChatGPT, sk-ant-... = Claude; מפתח לא תקין נדחה; המפתח לא יוצא מהשרת', async () => {
    assert.equal((await call(avi, 'POST', '/api/settings', { anthropicKey: 'sk-proj-bad00000000000000000000000' })).status, 400);
    assert.equal((await call(avi, 'POST', '/api/settings', { anthropicKey: 'hello' })).status, 400);
    assert.equal((await call(avi, 'POST', '/api/settings', { anthropicKey: 'sk-proj-good0000000000000000000000' })).status, 200);
    let s = await state(avi); assert.equal(s.provider, 'openai'); assert.equal(s.keyFrom, 'app');
    calls.length = 0; await call(avi, 'POST', '/api/chat', { text: 'היי' }); assert.equal(calls[0].auth, 'Bearer sk-proj-good0000000000000000000000');
    assert.equal((await call(avi, 'POST', '/api/settings', { anthropicKey: 'sk-ant-api03-' + 'z'.repeat(40) })).status, 200);
    s = await state(avi); assert.equal(s.provider, 'anthropic');
    const all = JSON.stringify(s) + (await call(avi, 'GET', '/api/export')).text; assert.ok(!/sk-proj-good|sk-ant-api03-z/.test(all), 'a key left the server');
    // decision 172: both keys are kept, the newest is the main one; the other can become the main one, or be removed
    assert.equal(d1("SELECT COUNT(*) AS n FROM settings WHERE key = 'openai_key'")[0].n, 1, 'the ChatGPT key is kept as the backup');
    assert.deepEqual(s.keys, { anthropic: true, openai: true, app: { anthropic: true, openai: true } });
    assert.equal((await call(avi, 'POST', '/api/settings', { primary: 'openai' })).status, 200); assert.equal((await state(avi)).provider, 'openai');
    const michal = (await call(null, 'POST', '/api/pair', { code: '481517', name: 'iPhone' })).data.token;
    assert.equal((await call(michal, 'POST', '/api/settings', { primary: 'anthropic' })).status, 403, 'only the admin');
    assert.equal((await call(avi, 'POST', '/api/settings', { dropKey: 'openai' })).status, 200);
    s = await state(avi); assert.equal(s.provider, 'anthropic', 'the remaining key is the main one'); assert.equal(s.keys.app.openai, false, 'the key entered in the app is gone (the server\'s own stays)');
  });
} finally {
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} openai checks passed`);
  writeFileSync('test/openai-results.json', JSON.stringify(results, null, 1)); writeFileSync('/tmp/shuki-test/openai-log.txt', log);
  try { process.kill(-dev.pid, 'SIGKILL'); } catch { /* gone */ }
  mock.close(); process.exit(ok === results.length ? 0 : 1);
}
