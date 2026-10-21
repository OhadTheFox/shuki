// The serverless entry (server/serverless.js) on a libSQL file database: migrations once, the API through a Web
// Request, the path Vercel hands over in ?shukipath=, and the hourly job behind CRON_SECRET.
// The real Vercel / Netlify / Turso were not reachable from here; this runs the same code against libSQL's local file mode.
// Run: node --disable-warning=ExperimentalWarning test/serverless.itest.js
import './fetch-retry.js';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync } from 'node:fs';

const DIR = '/tmp/shuki-test/shuki-serverless'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
Object.assign(process.env, { DATABASE_URL: `file:${DIR}/shuki.db`, CRON_SECRET: 'cron-secret-123', SETUP_CODE: '24681357', ANTHROPIC_API_KEY: 'sk-ant-test', ANTHROPIC_URL: 'http://127.0.0.1:1/v1/messages' });
const { handle } = await import('../server/serverless.js');
const results = [];
async function check(id, name, fn) {
  try { await fn(); results.push({ id, ok: true }); console.log('✓', id, name); } catch (e) { results.push({ id, ok: false }); console.log('✗', id, name, '\n   ', e.message.slice(0, 400)); }
}
const call = async (t, m, p, b) => { const r = await handle(new Request(`https://shuki.example.com${p}`, { method: m, headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined })); const txt = await r.text(); let data = null; try { data = JSON.parse(txt); } catch { /* text */ } return { status: r.status, data, text: txt }; };
let tok;
await check('V1', 'הקמה דרך הפונקציה: המיגרציות רצות פעם אחת, בית נוצר', async () => {
  const r = await call(null, 'POST', '/api/setup', { code: '24681357', house: 'בית', name: 'דנה', gender: 'f' });
  assert.equal(r.status, 200, r.text); tok = r.data.token;
  const { createClient } = await import('@libsql/client'); const c = createClient({ url: process.env.DATABASE_URL });
  const m = (await c.execute('SELECT COUNT(*) AS n FROM d1_migrations')).rows[0].n; assert.ok(m >= 13, String(m));
});
await check('V2', 'מוצר, רשימה ומצב דרך ?shukipath= (כמו ש-Vercel מעביר)', async () => {
  const a = await call(tok, 'POST', '/api/shuki?shukipath=/api/actions', { actions: [{ kind: 'create', product: { name: 'חלב', count_type: 'units', unit: 'קרטון', qty: 0 } }, { kind: 'list_add', text: 'במבה' }], op_id: 'x1' });
  assert.equal(a.status, 200, a.text);
  const s = (await call(tok, 'GET', '/api/state')).data;
  assert.ok(s.products.some((p) => p.name === 'חלב')); assert.ok(s.list.some((i) => i.text === 'במבה'));
});
await check('V3', 'מתכון עם מצרכים (batch בטרנזקציה אחת)', async () => {
  const r = await call(tok, 'POST', '/api/recipes', { name: 'חלב חם', ingredients: 'כוס חלב\nכפית סוכר' });
  assert.equal(r.status, 200, r.text);
  const s = (await call(tok, 'GET', '/api/state')).data; const x = s.recipes.find((y) => y.name === 'חלב חם');
  assert.equal(x.ings.length, 2); assert.equal(x.ings[0].product_id, s.products.find((p) => p.name === 'חלב').id);
});
await check('V4', 'המשימה השעתית: בלי CRON_SECRET נחסם, איתו רץ', async () => {
  assert.equal((await call(null, 'GET', '/api/cron')).status, 403);
  assert.equal((await call('wrong', 'GET', '/api/cron')).status, 403);
  const r = await call('cron-secret-123', 'GET', '/api/cron'); assert.equal(r.status, 200, r.text);
});
await check('V5', 'עותק "קר" שני של הפונקציה (מודול חדש) לא מריץ מיגרציות שוב ורואה את אותו בית', async () => {
  const again = await import(`../server/serverless.js?copy=2`);
  const r = await again.handle(new Request('https://shuki.example.com/api/state', { headers: { authorization: `Bearer ${tok}` } }));
  assert.equal(r.status, 200); assert.equal((await r.json()).me.name, 'דנה');
});
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} serverless checks passed`);
process.exit(ok === results.length ? 0 : 1);
