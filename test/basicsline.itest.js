// Walkthrough finding 7 (approved 01/10): the basics below their minimum, in the same words and the same number in the
// chat's header and in settings ("צריך להשלים 5 מוצרים קבועים" / "צריך להשלים 5 מתוך 6 מוצרים קבועים"), no percent.
// The house from the walkthrough's screenshot 07: 6 basics, only the milk is out. No model.
// Run: node test/basicsline.itest.js   (needs playwright; without it, it fails)
import './fetch-retry.js';
import { spawn, execSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';

let chromium;
try { ({ chromium } = createRequire(import.meta.url)(process.env.PW || 'playwright')); }
catch { console.log('✗ playwright is missing: npm i playwright somewhere and set PW=/path/to/node_modules/playwright'); process.exit(1); }

const STATE = '/tmp/shuki-test/shuki-basicsline';
const PORT = 8806;
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
// screenshot 07: eggs 4 of 12, cheese 2 of 3, milk out, tomatoes "a little", tuna 4 of 4, olive oil open with no closed one
const HOUSE = [
  { name: 'ביצים L', count_type: 'units', qty: 4, target: 12, location_id: 1 },
  { name: 'גבינה צהובה', count_type: 'units', unit: 'אריזה', qty: 2, target: 3, location_id: 1 },
  { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 0, target: 1, location_id: 1 },
  { name: 'עגבניות', count_type: 'level', level: 'little', location_id: 1 },
  { name: 'טונה בשמן', count_type: 'units', unit: 'קופסה', qty: 4, target: 4, location_id: 3 },
  { name: 'שמן זית', count_type: 'inuse', unit: 'בקבוק', qty: 0, is_open: 1, target: 1, location_id: 4 },
];
let browser;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  await fetch(`${base}/api/setup`); await new Promise((r) => setTimeout(r, 500));
  const code = d1("SELECT value FROM settings WHERE key = 'setup_code'")[0].value;
  const avi = (await api(null, 'POST', '/api/setup', { code })).token;
  await api(avi, 'POST', '/api/actions', { actions: HOUSE.map((p) => ({ kind: 'create', product: { ...p, is_basic: true, category_id: 1 } })) });
  const ids = Object.fromEntries((await api(avi, 'GET', '/api/state')).products.map((p) => [p.name, p.id]));
  const set = (changes) => api(avi, 'POST', '/api/actions', { actions: Object.entries(changes).map(([n, op]) => ({ kind: 'op', product_id: ids[n], op: { type: 'set', ...op } })) });

  browser = await chromium.launch();
  const p = await (await browser.newContext({ viewport: { width: 402, height: 874 }, locale: 'he-IL' })).newPage();
  await p.addInitScript((t) => localStorage.setItem('shuki.token', JSON.stringify(t)), avi);
  // both screens, from a fresh load (the house changed through the API). The app draws its own copy first, so wait for
  // the server's state to arrive before reading.
  const load = async (hash, sel) => {
    const fresh = p.waitForResponse((r) => r.url().includes('/api/state') && r.ok());
    // a fresh page each time: going from #settings to #chat is only a hash change, which loads the chat and not the
    // state, and the state then came only with the 30-second refresh (flaky in a busy full run; the reviewer of פ22)
    await p.goto('about:blank'); await p.goto(base + hash); await fresh; await p.waitForSelector(sel); await p.waitForTimeout(400);
  };
  const screens = async () => {
    await load('/#chat', '.band .sub');
    const chat = (await p.textContent('.band .sub')).trim();
    await load('/#settings', '.moodbox');
    const settings = (await p.textContent('.moodbox span')).trim();
    return { chat, settings };
  };
  const expect = async (chat, settings) => {
    const s = await screens();
    assert.equal(s.chat, chat, 'chat header'); assert.equal(s.settings, settings, 'settings');
    assert.doesNotMatch(s.settings, /%/, 'no percent in settings');
    return `${s.chat} | ${s.settings}`;
  };

  // home18 (1): the olive oil, open and full with nothing closed, counts as one: 4, not 5
  await check('B5', 'הבית מצילום 07: 4 מתוך 6 צריך להשלים, אותו מספר בשני המסכים', () =>
    expect('צריך להשלים 4 מוצרים קבועים', 'צריך להשלים 4 מתוך 6 מוצרים קבועים'));
  await check('B1', 'רק החלב: מוצר אחד', async () => {
    await set({ 'ביצים L': { qty: 12 }, 'גבינה צהובה': { qty: 3 }, 'עגבניות': { level: 'plenty' }, 'שמן זית': { qty: 1 } });
    return expect('צריך להשלים מוצר קבוע אחד', 'צריך להשלים מוצר אחד מתוך 6 מוצרים קבועים');
  });
  await check('B0', 'הכל במינימום או מעליו', async () => {
    await set({ 'חלב 3%': { qty: 1 } });
    return expect('כל המוצרים הקבועים בבית', 'כל המוצרים הקבועים בבית');
  });
  await check('BONE', 'בית עם מוצר קבוע אחד: בלי "מתוך 1"', async () => {
    await api(avi, 'POST', '/api/actions', { actions: ['ביצים L', 'גבינה צהובה', 'עגבניות', 'טונה בשמן', 'שמן זית'].map((n) => ({ kind: 'delete', product_id: ids[n] })) });
    await set({ 'חלב 3%': { qty: 0 } });
    const one = await expect('צריך להשלים מוצר קבוע אחד', 'צריך להשלים מוצר קבוע אחד');
    await set({ 'חלב 3%': { qty: 1 } });
    return `${one}; ${await expect('כל המוצרים הקבועים בבית', 'כל המוצרים הקבועים בבית')}`;
  });
} finally {
  await browser?.close();
  try { process.kill(-dev.pid); } catch {}
  const bad = results.filter((r) => !r.ok).length;
  console.log(`${results.length - bad}/${results.length} basics-line checks passed`);
  process.exit(bad || !results.length ? 1 : 0);
}
