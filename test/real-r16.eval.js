// Round 16, real model: the Hebrew pass. No present tense before approval, a kind no to what isn't groceries, why a buy
// is out of the ordinary, the writer's own gender, the house's words (always at home, minimum), units in numbers.
// Run: bash test/real-eval.sh claude-sonnet-5 test/real-r16-results.txt test/real-r16.eval.js
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
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
  if (r.proposal && /(^|[\s,.!])(?<!לא )(רשמתי|עדכנתי|הוספתי|מחקתי|שכחתי|סימנתי|הורדתי|מעדכן|מוסיף|רושם|שומר|מוחק|מסמן|מוריד)(?=[\s,.!:]|$)(?!\s*שבת)/.test(r.reply)) { claims.push(text); log('  !! claims it is done before approval'); }
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
const INTERNAL = /קטלוג|בסיסי|יעד|מסומן/;
await act(avi, [
  { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 0, is_basic: 1, target: 2, category_id: 'מוצרי חלב, גבינות וביצים', location_id: 'מקרר' } },
  { kind: 'create', product: { name: 'ביצים', count_type: 'pack', pack_size: 12, qty: 6, is_basic: 1, target: 12, location_id: 'מקרר' } },
  { kind: 'create', product: { name: 'טונה', count_type: 'units', unit: 'קופסה', qty: 2, location_id: 'מזווה' } },
  { kind: 'create', product: { name: 'לחם', count_type: 'units', unit: 'כיכר', qty: 1, is_basic: 1, target: 1, location_id: 'ארון מטבח' } },
  { kind: 'create', product: { name: 'אורז', count_type: 'inuse', is_open: 1, qty: 1, location_id: 'מזווה' } },
]);

await scenario('PRES', '"קניתי 2 חלב": כרטיס, והתשובה שאלה ולא "מעדכן"', async () => {
  const r = await say(michal, 'קניתי 2 חלב', 'reject');
  must(r.proposal, 'no card'); must(!/(^|\s)(מעדכן|מוסיף|רושם|שומר)(\s|$)/.test(r.reply), r.reply); must(/\?/.test(r.reply), `not a question: ${r.reply}`);
});
await scenario('OOS1', '"מה מזג האוויר מחר?": מסרב בחיוך, בעברית טבעית, ומחזיר לבית', async () => {
  const r = await say(avi, 'מה מזג האוויר מחר?', null);
  must(!r.proposal, 'a card'); must(!/מעלות|גשם צפוי|שמשי|°/.test(r.reply), r.reply); must(!/אני רק המלאי/.test(r.reply), r.reply);
  must(/חסר|נגמר|בבית|רשימה|קניות|מלאי/.test(r.reply), `no way back: ${r.reply}`);
});
await scenario('OOS2', '"תעזור לי עם שיעורי הבית בחשבון": לא עוזר, מחזיר לקניות', async () => {
  const r = await say(michal, 'תעזור לי עם שיעורי בית בחשבון? כמה זה 17 כפול 23', null);
  must(!r.proposal, 'a card'); must(!/391/.test(r.reply), r.reply);
});
await scenario('SALE', '"היה 1+1 על טונה, לקחתי 8": קנייה חריגה עם הסיבה, "(במבצע)"', async () => {
  const r = await say(avi, 'היה מבצע 1+1 על טונה, לקחתי 8 קופסאות', 'reject');
  must(/\(במבצע\)/.test(lineOf(r)), lineOf(r)); must(!/לאירוח/.test(lineOf(r)), lineOf(r));
});
await scenario('GIFT', '"אמא הביאה לנו 12 ביצים": לא "(לאירוח)"', async () => {
  const r = await say(michal, 'אמא הביאה לנו תבנית ביצים', 'reject');
  must(r.proposal, 'no card'); must(!/לאירוח/.test(lineOf(r)), lineOf(r));
});
await scenario('GENDER', 'הערה "יובל אלרגי לבוטנים", מיכל מוסיפה במבה: "שימי לב" ולא "שים לב"', async () => {
  await set({ house_notes: 'יובל אלרגי לבוטנים' });
  const r = await say(michal, 'תוסיף במבה לרשימה', 'reject');
  await set({ house_notes: '' });
  must(/בוטנים|אלרג/.test(r.reply), r.reply); must(!/(^|[\s,.])שים לב/.test(r.reply) && !/קנית[םן]/.test(r.reply), r.reply);
});
await scenario('UNKNOWN', '"יש לנו קינואה?": "זה לא רשום אצלי", בלי "קטלוג"', async () => {
  const r = await say(avi, 'יש לנו קינואה?', null);
  must(!r.proposal, 'a card'); must(!INTERNAL.test(r.reply), r.reply); must(/לא רשום/.test(r.reply), r.reply);
});
await scenario('TERMS', '"מה חסר?": בלי "בסיסי", "יעד", "קטלוג"', async () => {
  const r = await say(michal, 'מה חסר בבית?', null);
  must(/חלב/.test(r.reply), r.reply); must(!INTERNAL.test(r.reply), r.reply);
});
await scenario('EDIT', '"הטונה קבועה אצלנו, תמיד 3": שורת הכרטיס אומרת מה משתנה', async () => {
  const r = await say(avi, 'טונה זה קבוע אצלנו, צריך שיהיו תמיד 3', 'reject');
  must(r.proposal, 'no card'); must(!/עדכון פרטים/.test(lineOf(r)) && /קבוע|מינימום/.test(lineOf(r)), lineOf(r));
});
await scenario('UNITS', '"השתמשתי ב-3 ביצים": בלי "יחידות"', async () => {
  const r = await say(michal, 'השתמשתי ב-3 ביצים לחביתה', 'reject');
  must(r.proposal, 'no card'); must(!/יחידות/.test(r.reply), r.reply);
});
await scenario('NOPITA', '"אין לנו פיתות" (לא במלאי): כרטיס מיד, תשובה פשוטה בלי "רשום"', async () => {
  const r = await say(michal, 'אין לנו פיתות', 'reject');
  must(r.proposal, 'no card'); must(!/רשום|מוזכר/.test(r.reply), r.reply);
});
await scenario('LIST', '"מה צריך לקנות?": רשימה עם פסיקים ו-ו\' לפני האחרון, בלי " - "', async () => {
  await act(avi, [{ kind: 'op', product_id: P(await S(), /^לחם/).id, op: { type: 'out' } }, { kind: 'op', product_id: P(await S(), /^טונה/).id, op: { type: 'out' } }]);
  const r = await say(avi, 'מה צריך לקנות?', null);
  must(!/\s-\s/.test(r.reply), r.reply); must(!INTERNAL.test(r.reply), r.reply);
});

const ok = results.filter((r) => r.verdict === 'ok').length;
log(`\n${ok}/${results.length} ok; claims before approval: ${claims.length}`);
writeFileSync('test/real-r16-results.json', JSON.stringify(results, null, 1));
