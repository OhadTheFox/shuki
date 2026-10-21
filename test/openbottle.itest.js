// Walkthrough finding 9 (approved 01/10): in the inventory, a basic with an open bottle shows no percent and isn't red
// (its words already say it: "בקבוק אחד פתוח, אין בקבוקים סגורים"); red stays for "נגמר". The count, the list and
// what the model gets don't change. No model. פ26 (the owner 06/10, r7b, option ג): a ▼ before a low percent only, none by "נגמר".
// Run: node test/openbottle.itest.js   (needs playwright; without it, it fails)
import './fetch-retry.js';
import { spawn, execSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';

let chromium;
try { ({ chromium } = createRequire(import.meta.url)(process.env.PW || 'playwright')); }
catch { console.log('✗ playwright is missing: npm i playwright somewhere and set PW=/path/to/node_modules/playwright'); process.exit(1); }

const STATE = '/tmp/shuki-test/shuki-openbottle';
const PORT = 8807;
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
// the 9 states from the report (olive oil, minimum 1 unless said): [name, fields, "almost empty", percent shown, red, list]
const CASES = [
  ['O1', 'פתוח, אין סגור', { qty: 0, is_open: 1 }, false, '', false, false], // home18: the open one counts as one
  ['O2', 'פתוח כמעט נגמר, אין סגור', { qty: 0, is_open: 1 }, true, '', false, true],
  ['O3', 'פתוח וסגור אחד', { qty: 1, is_open: 1 }, false, '', false, false],
  ['O4', 'פתוח ו-2 סגורים', { qty: 2, is_open: 1 }, false, '', false, false],
  ['O5', 'פתוח כמעט נגמר וסגור אחד', { qty: 1, is_open: 1 }, true, '', false, false], // 17/10, ש15: one closed against a minimum of one: not on the list
  ['O6', 'לא פתוח, סגור אחד', { qty: 1, is_open: 0 }, false, '100%', false, false],
  ['O7', 'נגמר', { qty: 0, is_open: 0 }, false, '0%', true, true],
  ['O8', 'פתוח, אין סגור, מינימום 2', { qty: 0, is_open: 1, target: 2 }, false, '', false, true],
  ['O9', 'פתוח וסגור אחד, מינימום 2', { qty: 1, is_open: 1, target: 2 }, false, '', false, false], // home18: open (1) + closed (1) = the minimum
];
// the row, and what ::before puts by the percent and by the words ('' = nothing)
const SIGNS = (r) => {
  const before = (el) => { const c = el ? getComputedStyle(el, '::before').content : 'none'; return c === 'none' || c === 'normal' ? '' : c; };
  return { pct: r.querySelector('.pct').textContent.trim(), low: r.classList.contains('low'), out: r.classList.contains('out'), q: r.querySelector('.q').textContent.trim(), pctSign: before(r.querySelector('.pct')), qSign: before(r.querySelector('.q bdi')) };
};
let browser;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  await fetch(`${base}/api/setup`); await new Promise((r) => setTimeout(r, 500));
  const code = d1("SELECT value FROM settings WHERE key = 'setup_code'")[0].value;
  const avi = (await api(null, 'POST', '/api/setup', { code })).token;
  await api(avi, 'POST', '/api/actions', { actions: CASES.map(([id, , f]) => ({ kind: 'create', product: { name: `שמן ${id}`, count_type: 'inuse', unit: 'בקבוק', is_basic: true, target: 1, category_id: 1, ...f } })) });
  // פ26: a basic in units, 1 of 4 (25%); a product that isn't basic, gone ("נגמר" in words, no percent)
  await api(avi, 'POST', '/api/actions', { actions: [{ kind: 'create', product: { name: 'ביצים O10', count_type: 'units', qty: 1, is_basic: true, target: 4, category_id: 1 } }, { kind: 'create', product: { name: 'פלפל חריף O11', count_type: 'units', qty: 0, category_id: 1 } }] });
  let S = await api(avi, 'GET', '/api/state');
  const ids = Object.fromEntries(S.products.map((p) => [p.name, p.id]));
  await api(avi, 'POST', '/api/actions', { actions: CASES.filter((c) => c[3]).map(([id]) => ({ kind: 'op', product_id: ids[`שמן ${id}`], op: { type: 'low' } })) });
  S = await api(avi, 'GET', '/api/state');
  const listed = new Set(S.list.filter((i) => i.status !== 'done').map((i) => i.product_id));

  browser = await chromium.launch();
  const p = await (await browser.newContext({ viewport: { width: 402, height: 874 }, locale: 'he-IL' })).newPage();
  await p.addInitScript((t) => localStorage.setItem('shuki.token', JSON.stringify(t)), avi);
  const fresh = p.waitForResponse((r) => r.url().includes('/api/state') && r.ok());
  await p.goto(base + '/#inventory'); await fresh; await p.waitForSelector('.fr[data-p]'); await p.waitForTimeout(400);

  for (const [id, name, , , pct, red, list] of CASES) {
    await check(id, `${name}: ${pct || 'בלי אחוז'}${red ? ', אדום' : ', לא אדום'}; הרשימה לא השתנתה`, async () => {
      const pid = ids[`שמן ${id}`];
      const row = await p.$eval(`.fr[data-p="${pid}"]`, SIGNS);
      assert.equal(row.pct, pct, 'percent'); assert.equal(row.low || row.out, red, 'red');
      assert.equal(row.pctSign, '', `a sign by the percent: ${row.pctSign}`); assert.equal(row.qSign, '', `a sign by the words: ${row.qSign}`); // O7 "נגמר": none (ג)
      assert.equal(listed.has(pid), list, 'on the list (unchanged)');
      return `${row.q} | ${row.pct || '—'}`;
    });
  }
  await check('O10', 'קבוע ביחידות, 1 מתוך 4: 25%, אדום, ו-▼ לפני האחוז (פ26, ג)', async () => {
    const row = await p.$eval(`.fr[data-p="${S.products.find((x) => x.name === 'ביצים O10').id}"]`, SIGNS);
    assert.equal(row.pct, '25%'); assert.ok(row.low && !row.out, JSON.stringify(row));
    assert.match(row.pctSign, /^"▼"/, row.pctSign); assert.equal(row.qSign, '');
    return `${row.q} | ${row.pctSign} ${row.pct}`;
  });
  await check('O11', 'לא קבוע ונגמר: "נגמר" אדום, בלי אחוז ובלי סימן (פ26, ג)', async () => {
    const row = await p.$eval(`.fr[data-p="${S.products.find((x) => x.name === 'פלפל חריף O11').id}"]`, SIGNS);
    assert.ok(row.out && /נגמר/.test(row.q) && !row.pct, JSON.stringify(row));
    assert.equal(row.pctSign, ''); assert.equal(row.qSign, '');
    return row.q;
  });
  await check('O-axe', 'axe ב-#inventory: בלי בעיות נגישות חמורות', async () => {
    const AXE = (await import('node:fs')).readFileSync(process.env.AXE || `${process.env.HOME}/.cache/shuki-pw/axe.min.js`, 'utf8');
    const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, locale: 'he-IL', bypassCSP: true }); // axe goes in as an inline script
    const q = await ctx.newPage(); await q.addInitScript((t) => localStorage.setItem('shuki.token', JSON.stringify(t)), avi);
    await q.goto(base + '/#inventory'); await q.waitForSelector('.fr[data-p]'); await q.waitForTimeout(400);
    await q.addScriptTag({ content: AXE });
    const v = await q.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] })).violations.filter((x) => x.impact === 'critical' || x.impact === 'serious').map((x) => `${x.id}: ${x.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`));
    await ctx.close();
    assert.deepEqual(v, []);
  });
} finally {
  await browser?.close();
  try { process.kill(-dev.pid); } catch {}
  const bad = results.filter((r) => !r.ok).length;
  console.log(`${results.length - bad}/${results.length} open-bottle checks passed`);
  process.exit(bad || !results.length ? 1 : 0);
}
