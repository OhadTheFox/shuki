// Round 19, real model: the first meeting in a new, empty house (decision 129).
// Run: bash test/real-eval.sh claude-sonnet-5 test/real-r19b-results.txt test/real-r19b.eval.js
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
const base = 'http://127.0.0.1:8790';
const call = async (t, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const x = await r.text(); try { return JSON.parse(x); } catch { return x; } };
const d1 = (sql) => JSON.parse(execSync(`npx wrangler d1 execute shuki --local --persist-to /tmp/shuki-real --json --command "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^[^[]*/, ''))[0].results;
const avi = (await call(null, 'POST', '/api/pair', { code: '111111' })).token;
const michal = (await call(null, 'POST', '/api/pair', { code: '222222' })).token;
const S = () => call(avi, 'GET', '/api/state');
const P = (s, re) => s.products.find((p) => re.test(p.name));
const onList = (s, re) => s.list.some((i) => i.status !== 'done' && re.test(i.product_id ? s.products.find((p) => p.id === i.product_id)?.name || '' : i.text));
const out = []; const results = []; const claims = [];
const log = (t) => { out.push(t); console.log(t); };
async function say(who, text, verb = 'apply') {
  const r = await call(who, 'POST', '/api/chat', { text });
  const raw = r.proposal ? JSON.parse(d1(`SELECT actions FROM proposals WHERE id = '${r.proposal.id}'`)[0].actions).actions : [];
  log(`\n> [${who === avi ? 'אבי' : 'מיכל'}] ${text}\n< ${r.reply}${r.options?.length ? `\n  [${r.options.join(' | ')}]` : ''}${(r.proposal?.lines || []).map((l, i) => `\n  • ${l.text}${l.detail ? ` (${l.detail})` : ''}   ${JSON.stringify(raw[i]).slice(0, 200)}`).join('')}`);
  if (r.proposal && /(^|[\s,.!])(?<!לא )(רשמתי|עדכנתי|הוספתי|מחקתי|שכחתי|סימנתי|הורדתי|מעדכן|מוסיף|רושם|שומר|מוחק|מסמן|מוריד|מעדכנת|מוסיפה|רושמת|שומרת|מסמנת|מורידה)(?=[\s,.!:]|$)(?!\s*שבת)/.test(r.reply)) { claims.push(text); log('  !! claims it is done before approval'); }
  if (r.proposal && verb) { const a = await call(who, 'POST', `/api/proposals/${r.proposal.id}/${verb}`, {}); log(`  → ${verb}: ${a.status}${a.error ? ' ' + a.error : ''}`); }
  return r;
}
async function scenario(id, name, fn) {
  log(`\n=== ${id} ${name}`);
  let v = 'ok'; try { await fn(); } catch (e) { v = `FAIL: ${e.message}`; }
  log(`=== ${id}: ${v}`); results.push({ id, name, verdict: v });
}
const must = (c, m) => { if (!c) throw new Error(m); };
const show = (p) => (p ? `${p.name}: ${p.text}${p.out ? ' (out)' : ''}` : 'missing');



const act = (t, actions) => call(t, 'POST', '/api/actions', { actions });
const set = (b) => call(avi, 'POST', '/api/settings', b);

const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const scenario0 = scenario;
scenario = async (id, ...rest) => (ONLY && !ONLY.includes(id) ? null : scenario0(id, ...rest));
const lineOf = (r) => (r.proposal?.lines || []).map((l) => l.text).join(' | ');
const raw = (r) => (r.proposal ? JSON.parse(d1(`SELECT actions FROM proposals WHERE id = '${r.proposal.id}'`)[0].actions).actions : []);
const HEB = /[א-ת]/;
d1('DELETE FROM list_items'); d1('DELETE FROM products');
const PREACH = /כדאי|בפעם הבאה|בזבוז|חבל/;
await scenario('HELLO', 'בית ריק, "בוא נכיר!": שאלה ראשונה עם options, בחמימות', async () => {
  const r = await say(avi, 'בוא נכיר!', null);
  must(/\?/.test(r.reply) && (r.options || []).length >= 2, r.reply + JSON.stringify(r.options)); must(!PREACH.test(r.reply), r.reply);
});
await scenario('WHERE', 'איפה קונים → כלל, והשאלה הבאה', async () => {
  const r = await say(avi, 'במשלוחים בדרך כלל');
  must(raw(r).some((a) => a.kind === 'lesson'), lineOf(r)); must(/אסור|ייגמר|תמיד/.test(r.reply), r.reply);
});
await scenario('MUST', 'מה אסור שייגמר → מוצרים קבועים, ושאלה על אלרגיות', async () => {
  const r = await say(avi, 'קפה, חלב וביצים');
  must(raw(r).filter((a) => a.kind === 'create' && a.product?.is_basic).length >= 3, lineOf(r)); must(/אלרג|כשר|צמחונ|חשוב/.test(r.reply), r.reply);
});
await scenario('NOTES', 'אלרגיה → כלל, ואז "נמפה את הבית" עם מקומות', async () => {
  const r = await say(avi, 'כן, יש אלרגיה לבוטנים');
  must(raw(r).some((a) => a.kind === 'lesson' && /בוטנים/.test(a.text)), lineOf(r)); must(/נמפה|מאיפה|מתחילים/.test(r.reply) && (r.options || []).length >= 2, r.reply + JSON.stringify(r.options));
});
await scenario('MAP', 'בוחרים מקרר → שואל מה יש שם', async () => {
  const r = await say(avi, 'מקרר', null);
  must(/מקרר/.test(r.reply) && /\?/.test(r.reply), r.reply);
});
log(`\n${results.filter((r) => r.verdict === 'ok').length}/${results.length} ok; claims before approval: ${claims.length}`);
writeFileSync('test/real-r19b-results.json', JSON.stringify(results, null, 1));
