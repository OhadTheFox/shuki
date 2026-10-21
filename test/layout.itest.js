// Walkthrough finding 4 (approved 01/10): the app fills the whole screen even when a page is short. On iOS the app
// opened from the Home Screen got a layout height 62pt short of the screen when a page had little in it (one recipe),
// and the tab bar floated above an empty strip. Here the short layout height is made by hand (html shorter than the
// window) and the app must still reach the bottom of the window. No model.
// Run: node test/layout.itest.js   (needs playwright; without it the test fails, it doesn't pass empty)
import './fetch-retry.js';
import { spawn, execSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';

let chromium;
try { ({ chromium } = createRequire(import.meta.url)(process.env.PW || 'playwright')); }
catch { console.log('✗ playwright is missing: npm i playwright somewhere and set PW=/path/to/node_modules/playwright'); process.exit(1); }

const STATE = '/tmp/shuki-test/shuki-layout';
const PORT = 8796;
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
let browser;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  await fetch(`${base}/api/setup`); await new Promise((r) => setTimeout(r, 500));
  const code = d1("SELECT value FROM settings WHERE key = 'setup_code'")[0].value;
  const tok = (await (await fetch(`${base}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) })).json()).token;
  await fetch(`${base}/api/recipes`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify({ name: 'שקשוקה', ingredients: '6 ביצים\n4 עגבניות', text: 'מטגנים.\nמבשלים.' }) });
  browser = await chromium.launch();
  const p = await (await browser.newContext({ viewport: { width: 402, height: 874 }, locale: 'he-IL' })).newPage();
  await p.addInitScript((t) => localStorage.setItem('shuki.token', JSON.stringify(t)), tok);
  await check('L1', 'מתכונים עם מתכון אחד: האפליקציה ממלאת את כל המסך גם כשגובה הדף קצר ממנו (כמו ב-iOS)', async () => {
    await p.goto(base + '/#recipes'); await p.waitForSelector('.nav');
    await p.addStyleTag({ content: 'html, body { height: 812px !important; }' }); // what iOS did: 62pt short of the 874pt screen
    const h = await p.$eval('#app', (a) => a.getBoundingClientRect().height);
    assert.ok(h >= 874 - 1, `the app is ${h}px, the screen 874px`);
    return `${Math.round(h)}px`;
  });
} finally {
  await browser?.close();
  try { process.kill(-dev.pid); } catch {}
  const bad = results.filter((r) => !r.ok).length;
  console.log(`${results.length - bad}/${results.length} layout checks passed`);
  process.exit(bad || !results.length ? 1 : 0);
}
