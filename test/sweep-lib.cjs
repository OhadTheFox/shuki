// Shared bits for the sweep suites (phone-sized Chromium against wrangler dev + fake Claude).
const { execSync } = require('node:child_process');
const BASE = 'http://127.0.0.1:8791';
const S = '/tmp/shuki-test/shuki-uiqa';
const d1 = (sql) => execSync(`npx wrangler d1 execute shuki --local --persist-to ${S} --command "${sql.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
const d1q = (sql) => JSON.parse(execSync(`npx wrangler d1 execute shuki --local --persist-to ${S} --json --command "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^[^[]*/, ''))[0].results;
const results = [];
const check = async (id, name, fn) => {
  try { const note = await fn(); results.push({ id, name, ok: true, note: note || '' }); console.log('✓', id, name, note ? `— ${note}` : ''); }
  catch (e) { results.push({ id, name, ok: false, error: e.message.split('\n')[0] }); console.log('✗', id, name, '\n   ', e.message.split('\n')[0].slice(0, 300)); if (module.exports.shotPage) await module.exports.shotPage.screenshot({ path: `/tmp/shuki-test/fail-${id}.png` }).catch(() => {}); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };
let codeN = 500000;
// Settings fold most sections under their titles (01/10); tests that work inside them see them open.
// r21-ui U16 checks the folds themselves (a context without this).
const unfold = (ctx) => ctx.addInitScript(() => { new MutationObserver(() => document.querySelectorAll('details.fold:not([data-t])').forEach((d) => { d.dataset.t = 1; d.open = true; })).observe(document, { childList: true, subtree: true }); });
async function phone(b, { w = 390, h = 844, user = 1, bypassCSP = false, unfoldAll = true } = {}) {
  // WebKit has no clipboard permissions to grant (stage 5, PW_BROWSER=webkit)
  const ctx = await b.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block', hasTouch: true, ...(b.browserType().name() === 'webkit' ? {} : { permissions: ['clipboard-read', 'clipboard-write'] }), bypassCSP });
  if (unfoldAll) await unfold(ctx);
  const p = await ctx.newPage(); p.errors = []; p.on('pageerror', (e) => p.errors.push(e.message));
  const code = String(codeN++);
  d1(`INSERT OR REPLACE INTO pairing_codes (code, user_id, expires) VALUES ('${code}', ${user}, 9999999999999)`);
  await p.goto(BASE + '/'); await p.fill('#code', code); await p.click('#pair button[type=submit]'); await p.waitForSelector('#say');
  p.api = (m, u, bd) => p.evaluate(async ([m, u, bd]) => { const r = await fetch(u, { method: m, headers: { 'content-type': 'application/json', 'x-levels': '21' /* as the app (stage 10, question 18) */, authorization: `Bearer ${JSON.parse(localStorage.getItem('shuki.token'))}` }, body: bd ? JSON.stringify(bd) : undefined }); return r.json(); }, [m, u, bd]);
  p.state = () => p.api('GET', '/api/state');
  p.go = async (hash) => { await p.evaluate((x) => { location.hash = x; }, hash); await p.waitForTimeout(350); };
  p.reload2 = async () => { await p.reload(); await p.waitForTimeout(900); };
  p.ctx = ctx; module.exports.shotPage = p;
  return p;
}
const finish = async (b, file) => {
  const n = results.filter((r) => r.ok).length;
  console.log(`\n${n}/${results.length} checks passed`);
  require('node:fs').writeFileSync(file, JSON.stringify(results, null, 1));
  await b.close(); process.exit(n === results.length ? 0 : 1);
};
module.exports = { BASE, d1, d1q, check, ok, phone, finish, results, unfold };
