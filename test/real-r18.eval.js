// Round 18, real model: the new instructions (decisions 78-118): delivery, weekly buys, returns, a wrong buy, brands,
// a second place, leftovers, renames, expiry dates, medicines, Shabbat, moving, other languages, recipes, transliteration.
// Run: bash test/real-eval.sh claude-sonnet-5 test/real-r18-results.txt test/real-r18.eval.js
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
await act(avi, [
  { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 1, is_basic: 1, target: 2, location_id: 'מקרר' } },
  { kind: 'create', product: { name: "קוטג'", count_type: 'units', unit: 'גביע', qty: 0, is_basic: 1, target: 2, brand: 'טרה', location_id: 'מקרר' } },
  { kind: 'create', product: { name: 'קולה', count_type: 'units', unit: 'בקבוק', qty: 2, is_basic: 1, target: 2, location_id: 'מקרר' } },
  { kind: 'create', product: { name: 'שמפו', count_type: 'units', unit: 'בקבוק', qty: 2, location_id: 'ארון אמבטיה' } },
  { kind: 'create', product: { name: 'חיתולים מידה 3', count_type: 'pack', pack_size: 40, qty: 20, is_basic: 1, target: 20, location_id: 'מחסן' } },
  { kind: 'create', product: { name: 'יוגורט', count_type: 'units', unit: 'גביע', qty: 3, shelf_days: 14, location_id: 'מקרר' } },
  { kind: 'create', product: { name: 'ביצים', count_type: 'pack', pack_size: 12, qty: 8, is_basic: 1, target: 6, location_id: 'מקרר' } },
]);
await act(avi, [{ kind: 'list_add', product_id: P(await S(), /^חלב 3%/).id }, { kind: 'list_add', text: 'נייר אפייה' }]);

await scenario('ORDER', '"הזמנתי משלוח מהסופר": כל מה שברשימה של הסופר הוזמן', async () => {
  const r = await say(avi, 'הזמנתי משלוח מהסופר עם כל הרשימה');
  must(raw(r).filter((a) => a.kind === 'order').length >= 2, lineOf(r));
});
await scenario('ARRIVE', '"המשלוח הגיע": הגיע, והמלאי עולה', async () => {
  const before = P(await S(), /^חלב 3%/).qty;
  const r = await say(michal, 'המשלוח הגיע');
  must(raw(r).some((a) => a.kind === 'arrived'), lineOf(r)); must(P(await S(), /^חלב 3%/).qty > before, 'stock');
});
await scenario('WEEKLY', '"חלות כל שישי": קנייה קבועה ביום שישי', async () => {
  const r = await say(michal, 'אנחנו קונים חלות כל שישי');
  const w = raw(r).find((a) => a.kind === 'routine'); must(w && w.weekday === 5, lineOf(r));
});
await scenario('RETURN', '"החזרתי את השמפו": החזרה, לא זריקה', async () => {
  const r = await say(avi, 'החזרתי בקבוק שמפו לחנות, היה פתוח', 'reject');
  must(raw(r).some((a) => a.op?.type === 'return'), lineOf(r)); must(!raw(r).some((a) => a.op?.type === 'discard'), 'discard');
});
await scenario('WRONG', '"קניתי בטעות 1% במקום 3%": 1% חדש, 3% לא נקנה', async () => {
  const r = await say(michal, 'קניתי בטעות חלב 1% במקום 3%', 'reject');
  const a = raw(r); const reg = P(await S(), /^חלב 3%/).id;
  must(a.some((x) => x.kind === 'create' && /1%/.test(x.product?.name || '')), lineOf(r));
  must(!a.some((x) => x.kind === 'op' && x.product_id === reg && x.op?.type === 'purchase'), `bought 3%: ${lineOf(r)}`);
});
await scenario('BRAND', 'לא היה טרה, לקחו תנובה: קנייה, המותג הקבוע לא משתנה', async () => {
  const r = await say(avi, "לא היה טרה אז לקחתי 2 קוטג' של תנובה", 'reject');
  must(raw(r).some((a) => a.op?.type === 'purchase'), lineOf(r)); must(!/מותג/.test(lineOf(r)), lineOf(r));
});
await scenario('NOBRAND', '"קניתי אורז": לא שואל על מותג', async () => {
  const r = await say(michal, 'קניתי אורז', 'reject');
  must(!/מותג|איזה חברה|של איזו חברה/.test(r.reply), r.reply);
});
await scenario('RESERVE', '"יש עוד 6 קולה במרפסת", ואז "נגמרה הקולה": לא לרשימה, ושוקי אומר שיש במרפסת', async () => {
  const r = await say(avi, 'יש עוד 6 בקבוקי קולה במקרר במרפסת');
  must(raw(r).some((a) => a.kind === 'edit' && Number(a.fields?.reserve_qty) === 6), lineOf(r));
  const r2 = await say(michal, 'נגמרה הקולה');
  must(/מרפסת/.test(r2.reply), r2.reply);
  const st = await S(); const cola = P(st, /^קולה/).id;
  must(!st.list.some((i) => i.status === 'open' && i.product_id === cola), 'on the list');
});
await scenario('LEFTOVER', '"נשארה פסטה מאתמול": שאריות, לא מוצר', async () => {
  const r = await say(michal, 'נשארה פסטה מאתמול במקרר');
  must(raw(r).some((a) => a.kind === 'leftover'), lineOf(r)); must(!raw(r).some((a) => a.kind === 'create'), 'create');
});
await scenario('RENAME', '"עברנו לחיתולים מידה 4": אותו מוצר, שם חדש', async () => {
  const r = await say(avi, 'עברנו לחיתולים מידה 4');
  must(raw(r).some((a) => a.kind === 'edit' && /4/.test(a.fields?.name || '')), lineOf(r)); must(!raw(r).some((a) => a.kind === 'create'), 'create');
});
await scenario('EXPIRES', '"היוגורט בתוקף עד ה-5 לחודש הבא": תאריך', async () => {
  const r = await say(michal, 'היוגורט בתוקף עד ה-5 לחודש הבא', 'reject');
  must(raw(r).some((a) => a.kind === 'edit' && /^\d{4}-\d{2}-05$/.test(a.fields?.expires || '')), lineOf(r) + JSON.stringify(raw(r)));
});
await scenario('MED', '"יש לנו אקמול": בתרופות', async () => {
  const r = await say(avi, `יש לנו קופסת אקמול בארון, בתוקף עד ינואר ${new Date().getFullYear() + 1}`, 'reject'); // always next January, never past
  const c = raw(r).find((a) => a.kind === 'create'); must(c && c.product?.category_id === 'תרופות ועזרה ראשונה', JSON.stringify(c));
});
await scenario('SHABBAT', '"אני שומר שבת": כרטיס שבת', async () => {
  const r = await say(avi, 'אני שומר שבת', 'reject');
  must(raw(r).some((a) => a.kind === 'shabbat' && a.on !== false), lineOf(r) + ' / ' + r.reply);
});
await scenario('MOVING', '"עוברים דירה ב-1 בנובמבר": מעבר', async () => {
  const r = await say(michal, 'אנחנו עוברים דירה ב-1 בנובמבר', 'reject');
  must(raw(r).some((a) => a.kind === 'moving' && /-11-01$/.test(a.date || '')), lineOf(r));
});
await scenario('ENGLISH', '"we ran out of eggs": מבין, ועונה בעברית', async () => {
  const r = await say(avi, 'we ran out of eggs', 'reject');
  must(HEB.test(r.reply) && !/[a-z]{3,}/i.test(r.reply), r.reply); must(raw(r).some((a) => a.op?.type === 'out'), lineOf(r));
});
await scenario('CAKE', '"איך מכינים עוגת גבינה?": מתכון קצר, ואומר שזה לא מהשמורים', async () => {
  const r = await say(michal, 'איך מכינים עוגת גבינה?', null);
  must(/לא מה|לא שמור|לא מתכון ש|אין לי מתכון שמור|לא מהמתכונים/.test(r.reply), r.reply);
});
await scenario('COOKED', '"הכנתי שקשוקה": חם, ושואל במה השתמשו', async () => {
  const r = await say(avi, 'הכנתי שקשוקה', null);
  must(/בתיאבון|מעולה|נשמע|יאמי|טעים/.test(r.reply), r.reply); must(/\?/.test(r.reply), r.reply);
});
await scenario('BRITA', '"צריך פילטר לבריטה": בריטה ולא בריתה', async () => {
  const r = await say(michal, 'צריך לקנות פילטר לבריטה', 'reject');
  must(!/בריתה/.test(r.reply + lineOf(r)), r.reply + lineOf(r));
});
await scenario('EXPIRY', '"מה עומד לפוג?": התוקף פג, לא המוצר', async () => {
  const r = await say(avi, 'מה עומד לפוג בקרוב?', null);
  must(/תוקף/.test(r.reply), r.reply); must(!/(^|[\s,])(ה?[א-ת']+)\s+(פג|פגה|פגים|פגות)(?=[\s,.]|$)/.test(r.reply.replace(/התוקף\s+(של\s+\S+\s+)?(פג|פגה)/g, '')), r.reply);
});
await scenario('QUIET', '"מה צריך לקנות?": בלי חגים, בלי מתכונים', async () => {
  const r = await say(avi, 'מה צריך לקנות?', null);
  must(!/ראש השנה|חג|מתכון|לבשל/.test(r.reply), r.reply);
});

const ok = results.filter((r) => r.verdict === 'ok').length;
log(`\n${ok}/${results.length} ok; claims before approval: ${claims.length}`);
writeFileSync('test/real-r18-results.json', JSON.stringify(results, null, 1));
