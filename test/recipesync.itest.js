// Walkthrough finding 5 (approved 01/10): a recipe window that's open catches up with what someone else changed, in
// place, keeping "כמה אנשים"; a recipe deleted while the window is open: the window stays, and an action on it gets
// the server's usual error. No model. Run: node test/recipesync.itest.js   (needs playwright; without it, it fails)
import './fetch-retry.js';
import { spawn, execSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';

let chromium;
try { ({ chromium } = createRequire(import.meta.url)(process.env.PW || 'playwright')); }
catch { console.log('✗ playwright is missing: npm i playwright somewhere and set PW=/path/to/node_modules/playwright'); process.exit(1); }

const STATE = '/tmp/shuki-test/shuki-recipesync';
const PORT = 8797;
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
const STEPS = Array.from({ length: 14 }, (_, i) => `שלב ${i + 1}: מערבבים טוב ומחכים.`).join('\n');
let browser;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  await fetch(`${base}/api/setup`); await new Promise((r) => setTimeout(r, 500));
  const code = d1("SELECT value FROM settings WHERE key = 'setup_code'")[0].value;
  const avi = (await api(null, 'POST', '/api/setup', { code })).token;
  const orit = (await api(null, 'POST', '/api/pair', { code: (await api(avi, 'POST', '/api/members', { add: { name: 'דנה', gender: 'f' } })).code })).token;
  const { id } = await api(avi, 'POST', '/api/recipes', { name: 'שקשוקה', ingredients: '6 ביצים\n4 עגבניות', text: STEPS, serves: 4 });
  browser = await chromium.launch();
  const p = await (await browser.newContext({ viewport: { width: 402, height: 874 }, locale: 'he-IL' })).newPage();
  await p.addInitScript((t) => localStorage.setItem('shuki.token', JSON.stringify(t)), avi);
  await p.goto(base + '/#recipes'); await p.waitForSelector(`.rcard[data-rec="${id}"]`);
  await p.click(`.rcard[data-rec="${id}"]`); await p.waitForSelector('.scrim .sheet > h2');
  const catchUp = async () => { await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(1500); };

  await check('S1', 'החלון הפתוח מציג את מה שדנה שינתה, ו"כמה אנשים" שנבחר נשאר', async () => {
    await p.click('#pPlus'); await p.click('#pPlus'); await p.waitForTimeout(400); // 4 → 6
    assert.equal(await p.textContent('#pN'), '6');
    await p.$eval('.scrim .sheet', (s) => { s.scrollTop = 300; });
    await api(orit, 'POST', `/api/recipes/${id}/edit`, { text: STEPS.replace('שלב 1:', 'שלב 1 (חדש):') });
    await catchUp();
    assert.match(await p.textContent('.scrim .rsteps'), /שלב 1 \(חדש\)/, 'the open window shows the change');
    assert.equal(await p.textContent('#pN'), '6', 'how many people stays');
    const top = await p.$eval('.scrim .sheet', (s) => s.scrollTop);
    assert.ok(Math.abs(top - 300) < 5, `the scroll stays (${top})`);
  });
  await check('S2', 'מתכון שנמחק בזמן שהחלון פתוח: החלון נשאר, ופעולה עליו מחזירה את השגיאה הקיימת', async () => {
    await api(orit, 'POST', `/api/recipes/${id}/delete`, {});
    await catchUp();
    assert.ok(await p.$('.scrim .sheet > h2'), 'the window is still open');
    assert.match(await p.textContent('.scrim .rsteps'), /שלב 1 \(חדש\)/, 'not redrawn');
    await p.click('#rMade'); await p.waitForTimeout(800);
    assert.match(await p.textContent('body'), /המתכון לא נמצא/);
  });
} finally {
  await browser?.close();
  try { process.kill(-dev.pid); } catch {}
  const bad = results.filter((r) => !r.ok).length;
  console.log(`${results.length - bad}/${results.length} recipe-sync checks passed`);
  process.exit(bad || !results.length ? 1 : 0);
}
