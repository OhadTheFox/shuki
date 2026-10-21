// Walkthrough finding 10 (approved 01/10): a phone disconnected from afar (401) gets the pairing screen on cream, with
// nothing of the screen it came from on <body> (it was blue after the chat), and the existing words "הטלפון הזה כבר
// לא מחובר אליי…" under the button, also when the 401 comes from the refresh in the background. Not after reopening.
// Paired again: the chat is blue again, and "kid" / "nobrain" come back where they belong. No model (so: nobrain).
// Run: node test/unpaired.itest.js   (needs playwright; without it, it fails)
import './fetch-retry.js';
import { spawn, execSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';

let chromium;
try { ({ chromium } = createRequire(import.meta.url)(process.env.PW || 'playwright')); }
catch { console.log('✗ playwright is missing: npm i playwright somewhere and set PW=/path/to/node_modules/playwright'); process.exit(1); }

const STATE = '/tmp/shuki-test/shuki-unpaired';
const PORT = 8808;
const d1 = (sql) => JSON.parse(execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --json --command "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^[^[]*/, ''))[0].results;
rmSync(STATE, { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply shuki --local --persist-to ${STATE}`, { stdio: 'ignore' });
const env = { ...process.env }; delete env.ANTHROPIC_API_KEY; delete env.OPENAI_API_KEY;
const dev = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(PORT), '--persist-to', STATE], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const base = `http://127.0.0.1:${PORT}`;
const api = async (t, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); return r.json(); };
const results = [];
async function check(id, name, fn) {
  try { const note = await fn(); results.push({ id, name, ok: true }); console.log('✓', id, name, note ? `— ${note}` : ''); }
  catch (e) { results.push({ id, name, ok: false }); console.log('✗', id, name, '\n   ', e.message.slice(0, 400)); }
}
const GONE = 'הטלפון הזה כבר לא מחובר אליי. אפשר לבקש קוד חדש מאחד מחברי הבית.'; // with a full stop (stage 5, p7)
const WRONG = 'הקוד לא נכון או שהוא כבר לא בתוקף';
const CREAM = 'rgb(255, 251, 240)';
let browser;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  await fetch(`${base}/api/setup`); await new Promise((r) => setTimeout(r, 500));
  const code = d1("SELECT value FROM settings WHERE key = 'setup_code'")[0].value;
  const avi = (await api(null, 'POST', '/api/setup', { code })).token;
  await api(avi, 'POST', '/api/members', { add: { name: 'דנה', gender: 'f' } });
  await api(avi, 'POST', '/api/members', { add: { name: 'יואב', gender: 'm', role: 'child' } });
  const users = (await api(avi, 'GET', '/api/state')).users;
  const uid = (n) => users.find((u) => u.name === n).id;
  const newCode = async (n) => (await api(avi, 'POST', '/api/devices/code', { user_id: uid(n) })).code;
  // a phone of `who`, paired through the app's own screen
  browser = await chromium.launch();
  const phone = async (who, hash) => {
    const p = await (await browser.newContext({ viewport: { width: 402, height: 874 }, locale: 'he-IL' })).newPage();
    await p.goto(base + '/'); await p.waitForSelector('#code');
    await pair(p, who);
    await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForTimeout(800);
    return p;
  };
  const pair = async (p, who) => {
    const before = (await api(avi, 'GET', '/api/devices')).devices.map((d) => d.id);
    await p.fill('#code', await newCode(who)); await p.click('#pair button[type=submit]');
    await p.waitForSelector('.nav'); await p.waitForTimeout(800);
    p.device = (await api(avi, 'GET', '/api/devices')).devices.find((d) => !before.includes(d.id)).id;
  };
  // disconnected from afar; the phone finds out on its next refresh (as when it comes back to the app)
  const cut = async (p) => {
    await api(avi, 'DELETE', `/api/devices/${p.device}`);
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await p.waitForSelector('#pair', { timeout: 8000 }); await p.waitForTimeout(400);
  };
  const look = (p) => p.evaluate(() => ({ cls: [...document.body.classList].join(' '), bg: getComputedStyle(document.body).backgroundColor, err: document.querySelector('#err')?.hidden ? '' : document.querySelector('#err')?.textContent || '' }));
  const bodyHas = (p, c) => p.evaluate((x) => document.body.classList.contains(x), c);

  const chat = await phone('דנה', '#chat');
  await check('U1', 'ניתוק מהצ\'אט: מסך החיבור על קרם, בלי מחלקות מהמסך הקודם, עם "הטלפון הזה כבר לא מחובר אליי"', async () => {
    assert.ok(await bodyHas(chat, 'on-chat') && await bodyHas(chat, 'nobrain'), 'blue chat (and no model) before');
    await cut(chat);
    const s = await look(chat);
    assert.equal(s.cls, '', 'body classes'); assert.equal(s.bg, CREAM, 'background'); assert.equal(s.err, GONE);
    return s.bg;
  });
  await check('U3', 'קוד שגוי אחרי הניתוק: ההודעה הקיימת לקוד שגוי, על קרם', async () => {
    await chat.fill('#code', '999998'); await chat.click('#pair button[type=submit]'); await chat.waitForTimeout(800);
    const s = await look(chat);
    assert.equal(s.err, WRONG); assert.equal(s.bg, CREAM);
  });
  await check('U4', 'פתיחה מחדש אחרי הניתוק: מסך החיבור בלי ההודעה', async () => {
    await chat.reload(); await chat.waitForSelector('#code'); await chat.waitForTimeout(600);
    const s = await look(chat);
    assert.equal(s.err, ''); assert.equal(s.bg, CREAM);
  });
  await check('U5', 'חיבור מחדש: הצ\'אט שוב כחול, ו-nobrain חוזר (אין מודל)', async () => {
    await pair(chat, 'דנה'); await chat.evaluate(() => { location.hash = '#chat'; }); await chat.waitForTimeout(800);
    assert.ok(await bodyHas(chat, 'on-chat'), 'on-chat'); assert.ok(await bodyHas(chat, 'nobrain'), 'nobrain');
    assert.notEqual((await look(chat)).bg, CREAM);
  });

  const inv = await phone('דנה', '#inventory');
  await check('U2', 'ניתוק ממסך אחר (מלאי), ברענון ברקע: אותו מסך חיבור עם ההודעה', async () => {
    await cut(inv);
    const s = await look(inv);
    assert.equal(s.cls, ''); assert.equal(s.bg, CREAM); assert.equal(s.err, GONE);
  });

  const out = await phone('דנה', '#list');
  await check('U7', 'p7 (c06, 02/10): מי שהוציא אותה מהבית: "{שם} הוציא אותך מהבית, אז הטלפון הזה כבר לא מחובר אליי. אם זו טעות…", על קרם', async () => {
    let me = (await api(avi, 'GET', '/api/state')).me;
    if (!me.name) { await api(avi, 'POST', '/api/members', { id: me.id, edit: { name: 'דני', gender: 'm' } }); me = (await api(avi, 'GET', '/api/state')).me; }
    assert.ok(me.name, 'the admin has no name');
    const orit = (await api(avi, 'GET', '/api/state')).users.find((u) => u.name === 'דנה');
    await api(avi, 'POST', '/api/members', { id: orit.id, remove: true });
    await out.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await out.waitForSelector('#pair', { timeout: 8000 }); await out.waitForTimeout(400);
    const s = await look(out);
    assert.equal(s.err, `${me.name} ${me.gender === 'f' ? 'הוציאה' : 'הוציא'} אותך מהבית, אז הטלפון הזה כבר לא מחובר אליי. אם זו טעות, אפשר לבקש קוד חדש מאחד מחברי הבית.`);
    assert.equal(s.bg, CREAM);
    return s.err;
  });
  const kid = await phone('יואב', '#settings');
  await check('U6', 'ילד: kid יורד במסך החיבור וחוזר אחרי חיבור מחדש', async () => {
    assert.ok(await bodyHas(kid, 'kid'), 'kid before');
    await cut(kid);
    assert.equal((await look(kid)).cls, '', 'nothing on the pairing screen');
    await pair(kid, 'יואב'); await kid.evaluate(() => { location.hash = '#settings'; }); await kid.waitForTimeout(800);
    assert.ok(await bodyHas(kid, 'kid'), 'kid again');
  });
} finally {
  await browser?.close();
  try { process.kill(-dev.pid); } catch {}
  const bad = results.filter((r) => !r.ok).length;
  console.log(`${results.length - bad}/${results.length} unpaired checks passed`);
  process.exit(bad || !results.length ? 1 : 0);
}
