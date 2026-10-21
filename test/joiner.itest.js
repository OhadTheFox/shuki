// Walkthrough finding 2 (approved 01/10, b): the admin's first meeting is theirs alone; whoever joins sees their own
// hello, then what Shuki knows about the house, then the shared chat. No model key: the first meeting here needs none.
// Run: node test/joiner.itest.js
import './fetch-retry.js';
import { spawn, execSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

const STATE = '/tmp/shuki-test/shuki-joiner';
const PORT = 8794;
const d1 = (sql) => JSON.parse(execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --json --command "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^[^[]*/, ''))[0].results;
rmSync(STATE, { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply shuki --local --persist-to ${STATE}`, { stdio: 'ignore' });
const env = { ...process.env }; delete env.ANTHROPIC_API_KEY; delete env.OPENAI_API_KEY;
const dev = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(PORT), '--persist-to', STATE], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = ''; dev.stdout.on('data', (d) => (log += d)); dev.stderr.on('data', (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
const call = async (t, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch { /* text */ } return { status: r.status, data, text }; };
const chatOf = async (t) => (await call(t, 'GET', '/api/chat')).data.messages;
const said = (msgs) => msgs.map((m) => m.content.reply || m.content.text || '');
const results = [];
async function check(id, name, fn) {
  try { const note = await fn(); results.push({ id, name, ok: true }); console.log('✓', id, name, note ? `— ${note}` : ''); }
  catch (e) { results.push({ id, name, ok: false }); console.log('✗', id, name, '\n   ', e.message.slice(0, 600)); }
}
const say = async (t, text) => { const r = await call(t, 'POST', '/api/chat', { text }); assert.equal(r.status, 200, r.text); return r.data; };
const SUMMARY = 'אני רוצה לספר לך מה אני יודע על הבית. קוראים לו "הבית של דנה ודני". את גרה בו עם דני. במלאי יש 3 מוצרים ב-2 מקומות: מקרר ומזווה.';
const FOOD = 'מה שאני יודע על האוכל בבית: את לא אוכלת חריף.';
let admin, orit;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  await call(null, 'GET', '/api/setup'); await new Promise((r) => setTimeout(r, 500));
  const code = d1("SELECT value FROM settings WHERE key = 'setup_code'")[0].value;
  admin = (await call(null, 'POST', '/api/setup', { code })).data.token;
  // the first meeting, without a model: the name, how to talk to him, the house
  await say(admin, 'דני'); await say(admin, 'בלשון זכר'); await say(admin, 'הבית של דנה ודני');
  const r = await call(admin, 'POST', '/api/actions', { actions: [
    { kind: 'create', product: { name: 'חלב', count_type: 'units', qty: 1, location_id: 'מקרר' } },
    { kind: 'create', product: { name: 'גבינה', count_type: 'units', qty: 1, location_id: 'מקרר' } },
    { kind: 'create', product: { name: 'אורז', count_type: 'units', qty: 1, location_id: 'מזווה' } }] });
  assert.equal(r.status, 200, r.text);
  assert.equal((await call(admin, 'POST', '/api/settings', { house_notes: 'דנה לא אוכלת חריף' })).status, 200);
  const add = await call(admin, 'POST', '/api/members', { add: { name: 'דנה', gender: 'f' } });
  orit = (await call(null, 'POST', '/api/pair', { code: add.data.code })).data.token;

  await check('J1', 'דנה לא רואה את ההיכרות של דני: לא את בועות הפתיחה, לא "מה השם שלך?" ולא את התשובות שלו', async () => {
    const t = said(await chatOf(orit));
    assert.ok(!t.some((x) => /מה השם שלך\?/.test(x)), t.join(' | '));
    assert.ok(!t.some((x) => /^אני שוקי, הרובוט/.test(x)), 'the admin\'s opening bubbles');
    assert.ok(!t.some((x) => /נעים מאוד, דני/.test(x)), 'Shuki\'s answers to him');
    assert.ok(!t.includes('דני') && !t.includes('בלשון זכר'), 'his own answers');
  });
  await check('J2', 'דנה רואה את הברוכים הבאים שלה, ואחריהם מה ששוקי יודע על הבית', async () => {
    const t = said(await chatOf(orit));
    const hi = t.findIndex((x) => /^היי דנה!/.test(x));
    assert.ok(hi >= 0, t.join(' | '));
    assert.equal(t[hi + 3], SUMMARY);
    assert.equal(t[hi + 4], FOOD);
    assert.equal(t[hi + 5], 'האם יש משהו שאת לא אוכלת?', 'one question about her food (r0t r9-100)');
    return t[hi + 3];
  });
  await check('J3', 'דני עדיין רואה את כל ההיכרות שלו', async () => {
    const t = said(await chatOf(admin));
    assert.ok(t.some((x) => /מה השם שלך\?/.test(x)));
    assert.ok(t.includes('דני') && t.includes('הבית של דנה ודני'));
    assert.ok(!t.includes(SUMMARY), 'the summary is Orit\'s alone');
  });
  await check('J4', 'q16 (02/10): לדנה "הצ\'אט שלך איתי אישי. המלאי, הרשימה והמתכונים משותפים לכל הבית."; לדני "דנה הצטרפה לבית שלך! ברוכה הבאה!" בלי ההמשך; וגבר: "הצטרף… ברוך הבא!"', async () => {
    const n = said(await chatOf(orit)), hi = n.findIndex((x) => /^היי דנה!/.test(x));
    assert.equal(n[hi + 2], "הצ'אט שלך איתי אישי. המלאי, הרשימה והמתכונים משותפים לכל הבית.");
    assert.ok(said(await chatOf(admin)).includes('דנה הצטרפה לבית שלך! ברוכה הבאה!'), said(await chatOf(admin)).join(' | '));
    const add2 = await call(admin, 'POST', '/api/members', { add: { name: 'יוני', gender: 'm' } });
    await call(null, 'POST', '/api/pair', { code: add2.data.code });
    for (const t of [admin, orit]) assert.ok(said(await chatOf(t)).includes('יוני הצטרף לבית שלך! ברוך הבא!'));
    assert.ok(![...said(await chatOf(admin)), ...said(await chatOf(orit))].some((x) => /השיחה שלי עם שוקי/.test(x)), 'the old words');
  });
} finally {
  try { process.kill(-dev.pid); } catch {}
  const bad = results.filter((r) => !r.ok).length;
  console.log(`${results.length - bad}/${results.length} joiner checks passed`);
  process.exit(bad ? 1 : 0);
}
