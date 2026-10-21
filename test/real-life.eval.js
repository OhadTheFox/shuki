// 20 basic real-life scenarios, real model, empty house, both of us. Every approval is checked against the saved state.
// Run: bash test/real-eval.sh claude-sonnet-5 test/real-life-results.txt test/real-life.eval.js
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
  if (r.proposal && /(^|[\s,.!])(?<!לא )(רשמתי|עדכנתי|הוספתי|מחקתי|שכחתי|סימנתי|הורדתי)(?=[\s,.!:]|$)(?!\s*שבת)/.test(r.reply)) { claims.push(text); log('  !! claims it is done before approval'); }
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

await scenario('1', 'מילוי ראשון של המקרר', async () => {
  await say(avi, 'מתחילים מהמקרר: 6 ביצים, 2 קרטוני חלב 3%, גבינה צהובה פרוסה, 3 יוגורטים');
  const s = await S();
  must(P(s, /ביצ/)?.qty === 6 || /6/.test(P(s, /ביצ/)?.text), show(P(s, /ביצ/)));
  must(P(s, /חלב/)?.qty === 2, show(P(s, /חלב/)));
  must(P(s, /יוגורט/)?.qty === 3, show(P(s, /יוגורט/)));
  must(P(s, /גבינה/) && !P(s, /גבינה/).out, show(P(s, /גבינה/)));
});
await scenario('2', '"נשאר מעט" כשמוסיפים מוצר', async () => {
  await say(avi, 'יש לנו גם חלב נטול לקטוז ומשקה סויה, נשאר מעט מכל אחד. שניהם בסיסיים');
  const s = await S();
  for (const re of [/לקטוז/, /סויה/]) { const p = P(s, re); must(p && !p.out && /מעט/.test(p.text), show(p)); must(onList(s, re), `${p?.name} should be on the list (basic, running low)`); }
});
await scenario('3', '"כמעט נגמר" על מוצר קיים עם קרטון אחד', async () => {
  await say(michal, 'היוגורטים כמעט נגמרו');
  const p = P(await S(), /יוגורט/); must(p && !p.out, show(p));
});
await scenario('4', 'השתמשתי ב-2 ביצים', async () => {
  await say(michal, 'השתמשתי ב-2 ביצים לחביתה');
  const p = P(await S(), /ביצ/); must(p.qty === 4 || /4/.test(p.text), show(p));
});
await scenario('5', 'נגמר החלב', async () => {
  await say(avi, 'נגמר החלב 3%');
  const s = await S(); const p = P(s, /חלב 3/); must(p?.out, show(p));
});
await scenario('6', 'אין לנו לחם (מוצר שלא קיים)', async () => {
  await say(michal, 'אין לנו לחם');
  const s = await S(); must(onList(s, /לחם/), 'לחם on the list');
});
await scenario('7', 'להוסיף לרשימה ירקות', async () => {
  await say(michal, 'תוסיף לרשימה עגבניות ומלפפונים');
  const s = await S(); must(onList(s, /עגבני/) && onList(s, /מלפפונ/), 'both on the list');
  const it = s.list.find((i) => /עגבני/.test(i.product_id ? s.products.find((p) => p.id === i.product_id)?.name : i.text));
  must(it.store === 'greengrocer' || it.store === 'super', it.store);
});
await scenario('8', 'שאלה: יש לנו ביצים?', async () => {
  const r = await say(avi, 'יש לנו ביצים?', null);
  must(!r.proposal && /4|ארבע/.test(r.reply), 'answers 4, no changes');
});
await scenario('9', 'שאלה: מה חסר?', async () => {
  const r = await say(michal, 'מה חסר בבית?', null);
  must(!r.proposal && /חלב/.test(r.reply), 'mentions milk');
});
await scenario('10', 'זרקתי גבינה מקולקלת', async () => {
  await say(avi, 'זרקתי את הגבינה הצהובה, התקלקלה');
  const p = P(await S(), /גבינה/); must(p?.out, show(p));
});
await scenario('11', 'תיקון כמות', async () => {
  await say(michal, 'טעות, יש 5 יוגורטים ולא מה שכתוב');
  const p = P(await S(), /יוגורט/); must(p.qty === 5, show(p));
});
await scenario('12', 'ארון: אורז, פסטה, 2 קופסאות תירס', async () => {
  await say(avi, 'בארון המטבח יש אורז, פסטה ו-2 קופסאות תירס');
  const s = await S();
  for (const re of [/אורז/, /פסטה/, /תירס/]) { const p = P(s, re); must(p && !p.out, show(p)); must(s.locations.find((l) => l.id === p.location_id)?.name !== 'מקרר', `${p.name} not in the fridge`); }
  must(P(s, /תירס/).qty === 2, show(P(s, /תירס/)));
});
await scenario('13', 'ביטול הצעה לא משנה כלום', async () => {
  const before = P(await S(), /אורז/).text;
  await say(michal, 'נגמר האורז', 'reject');
  must(P(await S(), /אורז/).text === before, 'unchanged');
});
await scenario('14', 'שגיאות כתיב', async () => {
  await say(michal, 'נגמרו הביצם');
  const p = P(await S(), /ביצ/); must(p.out, show(p));
});
await scenario('15', 'היי מה קורה', async () => {
  const r = await say(avi, 'היי מה קורה', null);
  must(!r.proposal, 'no changes');
});
await scenario('16', 'יוצאים לסופר', async () => {
  const r = await say(avi, 'אני יוצא עכשיו לסופר', null);
  must(r.shopping === 'start' || (await S()).shopping.length, 'shopping mode');
  if (r.shopping === 'start' && !(await S()).shopping.length) await call(avi, 'POST', '/api/shopping', { on: true, store: 'super' });
});
await scenario('17', 'קניתי כמה דברים בסופר', async () => {
  await say(avi, 'קניתי חלב 3%, לחם ו-12 ביצים');
  const s = await S();
  must(!P(s, /חלב 3/).out, show(P(s, /חלב 3/)));
  const eggs = P(s, /ביצ/); must(eggs.qty >= 12 || /12/.test(eggs.text), show(eggs));
  must(P(s, /לחם/) && !P(s, /לחם/).out, show(P(s, /לחם/)));
  must(!onList(s, /חלב 3/) || s.list.find((i) => i.product_id === P(s, /חלב 3/).id)?.status === 'checked', 'milk off the list or in the cart');
});
await scenario('18', 'יש הרבה עגבניות (מהרשימה)', async () => {
  await say(michal, 'אמא הביאה המון עגבניות, יש הרבה');
  const s = await S(); const p = P(s, /עגבני/);
  must(p && !p.out, show(p)); must(!onList(s, /עגבני/) || s.list.find((i) => i.product_id === p.id)?.status !== 'open', 'not to buy anymore');
});
await scenario('19', 'מה נשאר ברשימה?', async () => {
  const r = await say(avi, 'מה נשאר לי לקנות?', null);
  must(!r.proposal && /מלפפונ/.test(r.reply), 'mentions cucumbers');
});
await scenario('20', 'סיימתי קניות', async () => {
  const r = await say(avi, 'סיימתי, אני בדרך הביתה', null);
  must(r.shopping === 'end' || !(await S()).shopping.length, 'shopping closed');
});
await scenario('21', '"צור לי רשימה" → מציע להוסיף את מה שנגמר או שנשאר ממנו מעט', async () => {
  const before = await S();
  const want = before.products.filter((p) => (p.out || p.level === 'little' || p.missing) && !before.list.some((i) => i.product_id === p.id && i.status !== 'done'));
  const r = await say(michal, 'צור לי רשימה');
  const s = await S();
  must(want.length === 0 || want.every((p) => onList(s, new RegExp(p.name.replace(/[%]/g, '')))), `missing on the list: ${want.filter((p) => !onList(s, new RegExp(p.name))).map((p) => p.name).join(', ')} (${r.reply})`);
  must(!/אין מוצרים|לא נוצרו|ריק/.test(r.reply) || !s.products.length, 'claims the catalog is empty');
});
await scenario('22', '"מה צריך לקנות?" היא שאלה: עונים, לא משנים', async () => {
  const r = await say(avi, 'מה צריך לקנות?', null); must(!r.proposal, 'proposed changes');
});
const s = await S();
log('\nSTATE:\n' + s.products.map((p) => `  ${p.name}[${p.count_type}${p.is_basic ? ',בסיס' : ''}] ${p.text}`).join('\n'));
log('LIST: ' + s.list.map((i) => `${i.product_id ? s.products.find((p) => p.id === i.product_id)?.name : i.text}(${i.status},${i.store})`).join(', '));
log(`claims before approval: ${claims.length}`);
log(`\n${results.filter((x) => x.verdict === 'ok').length}/${results.length} ok`);
writeFileSync('test/real-life-results.json', JSON.stringify(results, null, 1));
