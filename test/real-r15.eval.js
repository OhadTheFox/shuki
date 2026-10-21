// Round 15, real model: mapping a new house, brand, weights, guests, hosting, a week of cooking, history, house notes,
// a sale, roommates. Run: bash test/real-eval.sh claude-sonnet-5 test/real-r15-results.txt test/real-r15.eval.js
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



const act = (t, actions) => call(t, 'POST', '/api/actions', { actions });
const set = (b) => call(avi, 'POST', '/api/settings', b);

const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const scenario0 = scenario;
scenario = async (id, ...rest) => (ONLY && !ONLY.includes(id) ? null : scenario0(id, ...rest));
await scenario('MAP', 'מיפוי ראשון בבית ריק: "כן, נתחיל" → מקרר → מקפיא → ... → מה בסיסי', async () => {
  d1(`INSERT INTO chat (ts, user_id, role, content) VALUES (${Date.now()}, NULL, 'shuki', '${JSON.stringify({ reply: 'היי אבי, אני שוקי! נתחיל למפות את המלאי בבית? עוברים אזור אחרי אזור (מקרר, מקפיא, מזווה...), זה לוקח כמה דקות.', face: 'excited', options: ['כן, נתחיל', 'אחר כך'] })}')`);
  const r1 = await say(avi, 'כן, נתחיל'); must(!r1.proposal && /מקרר/.test(r1.reply), r1.reply);
  const r2 = await say(avi, 'חלב, 6 ביצים, קוטג\' ו-2 יוגורטים'); must(r2.proposal, 'no card for the fridge'); must(/מקפיא/.test(r2.reply), `next area: ${r2.reply}`);
  await say(avi, 'שקית אפונה ועוף');
  const r4 = await say(avi, 'נעצור כאן'); must(/תמיד|קבוע|בסיסי/.test(r4.reply), r4.reply);
  await say(avi, 'חלב וביצים');
  const s = await S(); must(P(s, /חלב/)?.is_basic && P(s, /ביצ/)?.is_basic, s.products.map((p) => `${p.name}${p.is_basic ? '*' : ''}`).join(', '));
  must(s.products.length >= 6, `${s.products.length} products`);
});
await scenario('BRAND', '"קניתי 2 חלב תנובה" → נקנה, ומותג תנובה נשמר', async () => {
  await say(michal, 'קניתי 2 חלב תנובה');
  const p = P(await S(), /^חלב/); must(p && p.brand === 'תנובה', JSON.stringify(p && { brand: p.brand, qty: p.qty }));
});
await scenario('WEIGHT', '"תוסיף חצי קילו בשר טחון" → בשורה ברשימה: 0.5 ק"ג', async () => {
  await say(avi, 'תוסיף לרשימה חצי קילו בשר טחון');
  const s = await S(); const it = s.list.find((i) => /טחון/.test(i.product_id ? s.products.find((p) => p.id === i.product_id)?.name || '' : i.text));
  must(it && it.want === 0.5 && it.want_unit === 'ק"ג', JSON.stringify(it));
});
await scenario('GUESTS', '"סבתא אצלנו עד שישי" → אורחים (לא חופשה)', async () => {
  const r = await say(michal, 'סבתא אצלנו עד יום שישי'); must(!r.proposal, 'a card');
  const s = await S(); must(s.guests?.now && !s.away, JSON.stringify({ guests: s.guests, away: s.away }));
});
await scenario('HOST', '"אנחנו מארחים בשבת, תוסיף יין ופיתות" → לשונית אירוח עם שניהם', async () => {
  await say(avi, 'אנחנו מארחים בשבת בערב, תוסיף יין ופיתות');
  const s = await S(); const h = s.stores.find((x) => x.event);
  must(h, 'no hosting list'); const onH = s.list.filter((i) => i.store === h.id).map((i) => i.product_id ? s.products.find((p) => p.id === i.product_id)?.name : i.text);
  must(onH.some((n) => /יין/.test(n)) && onH.some((n) => /פית/.test(n)), JSON.stringify(onH));
});
await scenario('WEEK', 'מתכון שמור + "השבוע נכין שקשוקה" → מה שחסר לרשימה', async () => {
  await call(avi, 'POST', '/api/actions', { actions: [{ kind: 'create', product: { name: 'רסק עגבניות', count_type: 'units', unit: 'קופסה', qty: 0 } }, { kind: 'create', product: { name: 'עגבניות', count_type: 'level', level: 'none' } }] });
  d1(`INSERT INTO recipes (id, name, ingredients, text, added_by, added) VALUES (7, 'שקשוקה', '4 ביצים, 3 עגבניות, בצל, קופסת רסק עגבניות', 'מטגנים, מוסיפים, שוברים ביצים', 1, ${Date.now()})`);
  log(`  before: ${JSON.stringify((await S()).products.filter((p) => /רסק|עגבני|ביצ/.test(p.name)).map((p) => `${p.name}: ${p.text}`))}`);
  await say(michal, 'השבוע נכין שקשוקה');
  const s = await S(); must(onList(s, /רסק/) && onList(s, /עגבני/), s.list.map((i) => i.product_id ? s.products.find((p) => p.id === i.product_id)?.name : i.text).join(', '));
});
await scenario('HIST', '"מתי קנינו חלב?" → עונה עם תאריך ומי', async () => {
  const r = await say(avi, 'מתי קנינו חלב בפעם האחרונה?', null);
  must(/מיכל/.test(r.reply) && /היום|\d/.test(r.reply), r.reply);
});
await scenario('NOTES', 'הערה "יובל אלרגי לבוטנים" + "תוסיף במבה" → מוסיף ומזהיר', async () => {
  await set({ house_notes: 'יובל אלרגי לבוטנים' });
  const r = await say(michal, 'תוסיף במבה לרשימה');
  must(/בוטנים|אלרג/.test(r.reply), r.reply); must(onList(await S(), /במבה/), 'not added');
  await set({ house_notes: '' });
});
await scenario('SALE', '"היה מבצע, לקחתי 6 רסק" → נקנה, לא מלמד (event)', async () => {
  const r = await say(avi, 'היה מבצע 1+1, לקחתי 6 קופסאות רסק עגבניות');
  const raw = r.proposal ? JSON.parse(d1(`SELECT actions FROM proposals WHERE id = '${r.proposal.id}'`)[0].actions).actions : [];
  must(raw.some((a) => a.op?.type === 'purchase' && a.op.event), JSON.stringify(raw));
});
await scenario('ROOM', 'דירת שותפים: "קניתי לעצמי 6 בירות" → הבירה של אבי', async () => {
  await set({ house_mode: 'roommates' });
  await say(avi, 'קניתי לעצמי 6 בירות');
  const s = await S(); const p = P(s, /בירה/); must(p && p.owner === s.me.id, JSON.stringify(p && { owner: p.owner, me: s.me.id }));
  await set({ house_mode: 'family' });
});

const ok = results.filter((r) => r.verdict === 'ok').length;
log(`\n${ok}/${results.length} ok; claims before approval: ${claims.length}`);
writeFileSync('test/real-r15-results.json', JSON.stringify(results, null, 1));
