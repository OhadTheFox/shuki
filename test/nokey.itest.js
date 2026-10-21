// A house set up with no model key (approved 01/10): the chat stays open for "מה השם שלך?", how to talk to them and the
// house's name, which need no model; after them it closes as before. Run: node test/nokey.itest.js
import './fetch-retry.js';
import { spawn, execSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';

const STATE = '/tmp/shuki-test/shuki-nokey';
const PORT = 8793;
const d1 = (sql) => JSON.parse(execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --json --command "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^[^[]*/, ''))[0].results;
rmSync(STATE, { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply shuki --local --persist-to ${STATE}`, { stdio: 'ignore' });
const env = { ...process.env }; delete env.ANTHROPIC_API_KEY; delete env.OPENAI_API_KEY;
const dev = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(PORT), '--persist-to', STATE], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = ''; dev.stdout.on('data', (d) => (log += d)); dev.stderr.on('data', (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
const call = async (t, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const text = await r.text(); let data; try { data = JSON.parse(text); } catch {} return { status: r.status, data, text }; };
const state = async (t) => (await call(t, 'GET', '/api/state')).data;
const results = [];
async function check(id, name, fn) {
  try { const note = await fn(); results.push({ id, name, ok: true }); console.log('✓', id, name, note ? `— ${note}` : ''); }
  catch (e) { results.push({ id, name, ok: false }); console.log('✗', id, name, '\n   ', e.message.slice(0, 400)); }
}
const say = async (t, text) => { const r = await call(t, 'POST', '/api/chat', { text }); assert.equal(r.status, 200, r.text); return r.data; };
let tok, browser;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  await call(null, 'GET', '/api/setup'); await new Promise((r) => setTimeout(r, 500));
  const code = d1("SELECT value FROM settings WHERE key = 'setup_code'")[0].value;
  tok = (await call(null, 'POST', '/api/setup', { code })).data.token;

  const { chromium } = createRequire(import.meta.url)(process.env.PW || 'playwright'); // runall's Playwright (stage 13, Q13-1: 'playwright' alone isn't here)
  browser = await chromium.launch();
  const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL' })).newPage();
  await p.addInitScript((t) => localStorage.setItem('shuki.token', JSON.stringify(t)), tok);

  await check('K1', 'בלי מפתח: השדה פתוח ל"מה השם שלך?", בלי הפס הצהוב, המצלמה כבויה', async () => {
    const s = await state(tok); assert.equal(s.brain, false); assert.equal(s.aboutMe, true);
    await p.goto(base + '/#chat'); await p.waitForSelector('#say');
    await p.waitForTimeout(800);
    assert.equal(await p.$eval('#say', (e) => e.disabled), false);
    assert.equal(await p.$('#brainBar'), null);
    assert.equal(await p.$eval('#photo', (e) => e.disabled), true);
  });
  await check('K2', 'השם, הלשון ושם הבית נשמרים בלי מודל', async () => {
    let r = await say(tok, 'דני'); assert.match(r.reply, /נעים מאוד, דני/);
    r = await say(tok, 'בלשון זכר'); assert.match(r.reply, /איך נקרא לבית/);
    assert.equal((await state(tok)).aboutMe, true);
    r = await say(tok, 'הבית של דני');
    const s = await state(tok);
    assert.equal(s.me.name, 'דני'); assert.equal(s.me.gender, 'm'); assert.equal(s.house, 'הבית של דני'); assert.equal(s.aboutMe, false);
  });
  await check('K3', 'אחרי שם הבית: הצ\'אט נסגר כמו קודם, עם הפס הצהוב', async () => {
    await p.reload(); await p.waitForSelector('#brainBar');
    assert.equal(await p.$eval('#say', (e) => e.disabled), true);
    assert.match(await p.$eval('#brainBar', (e) => e.textContent), /אין לי מפתח/);
  });
  await check('K4', 'ההגדרות: "המכשיר של דני", ובחברי הבית יש שם', async () => {
    const s = await state(tok); assert.equal(s.users[0].name, 'דני');
    await p.goto(base + '/#settings'); await p.waitForTimeout(800);
    assert.match(await p.textContent('body'), /דני/);
  });
} finally {
  await browser?.close();
  try { process.kill(-dev.pid); } catch {}
  const bad = results.filter((r) => !r.ok).length;
  console.log(`${results.length - bad}/${results.length}`);
  process.exit(bad || !results.length ? 1 : 0); // no check ran (the browser didn't start): a failure (stage 13, Q13-1)
}
