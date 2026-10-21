// Walkthrough finding 3 (approved 01/10): the header stops sticking the moment a text field has focus (before iOS
// scrolls the field into view, which made it jump to the middle), and sticks again when the field is left.
// Three fields: the setup code, the chat, the house name in the settings. No model.
// Run: node test/focus.itest.js   (needs playwright; without it the test fails, it doesn't pass empty)
import './fetch-retry.js';
import { spawn, execSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';

let chromium;
try { ({ chromium } = createRequire(import.meta.url)(process.env.PW || 'playwright')); }
catch { console.log('✗ playwright is missing: npm i playwright somewhere and set PW=/path/to/node_modules/playwright'); process.exit(1); }

const STATE = '/tmp/shuki-test/shuki-focus';
const PORT = 8795;
const d1 = (sql) => JSON.parse(execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --json --command "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^[^[]*/, ''))[0].results;
rmSync(STATE, { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply shuki --local --persist-to ${STATE}`, { stdio: 'ignore' });
const env = { ...process.env }; delete env.ANTHROPIC_API_KEY; delete env.OPENAI_API_KEY;
const dev = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(PORT), '--persist-to', STATE], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const base = `http://127.0.0.1:${PORT}`;
const results = [];
async function check(id, name, fn) {
  try { const note = await fn(); results.push({ id, name, ok: true }); console.log('✓', id, name, note ? `— ${note}` : ''); }
  catch (e) { results.push({ id, name, ok: false }); console.log('✗', id, name, '\n   ', e.message.slice(0, 400)); }
}
const band = (p) => p.$eval('.band', (b) => getComputedStyle(b).position);
// focus the field, see the header let go; leave it, see it stick again
async function focusAndLeave(p, sel) {
  await p.waitForSelector(sel);
  assert.equal(await band(p), 'sticky', 'before: sticky');
  await p.focus(sel);
  assert.equal(await band(p), 'relative', 'in the field: not sticky');
  await p.$eval(sel, (e) => e.blur()); await p.waitForTimeout(50);
  assert.equal(await band(p), 'sticky', 'out of the field: sticky again');
}
let browser;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  await fetch(`${base}/api/setup`); await new Promise((r) => setTimeout(r, 500));
  browser = await chromium.launch();
  const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL' })).newPage();

  await check('F1', 'קוד ההקמה: הכותרת משתחררת בפוקוס וחוזרת אחרי יציאה מהשדה', async () => {
    await p.goto(base + '/'); await focusAndLeave(p, '#s-code');
  });
  const code = d1("SELECT value FROM settings WHERE key = 'setup_code'")[0].value;
  const tok = (await (await fetch(`${base}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) })).json()).token;
  await p.evaluate((t) => localStorage.setItem('shuki.token', JSON.stringify(t)), tok);
  await check('F2', 'שדה הצ\'אט', async () => { await p.goto(base + '/#chat'); await p.reload(); await focusAndLeave(p, '#say'); });
  await check('F3', 'הגדרות, שם הבית', async () => {
    await p.goto(base + '/#settings'); await p.waitForSelector('#houseName', { state: 'attached' });
    await p.$$eval('details.fold', (ds) => ds.forEach((d) => { d.open = true; }));
    await focusAndLeave(p, '#houseName input');
  });
} finally {
  await browser?.close();
  try { process.kill(-dev.pid); } catch {}
  const bad = results.filter((r) => !r.ok).length;
  console.log(`${results.length - bad}/${results.length} focus checks passed`);
  process.exit(bad || !results.length ? 1 : 0);
}
