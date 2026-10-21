// Round 13, real model: Avi's decisions (ask how many, which milk, "we don't have", when to remind) and the new features
// (reminders, messages, recipes, cooking, guests, history, Passover, own stores).
// Run: bash test/real-eval.sh claude-sonnet-5 test/real-r13-results.txt test/real-r13.eval.js
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
const ymd = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
const hm = (ts) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ts));
const wd = (ts) => new Date(Date.parse(`${ymd(ts)}T12:00:00Z`)).getUTCDay();
await act(avi, [
  { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 1, is_basic: 1, target: 2, location_id: 'מקרר' } },
  { kind: 'create', product: { name: 'חלב סויה', count_type: 'units', unit: 'קרטון', qty: 1, location_id: 'מקרר' } },
  { kind: 'create', product: { name: 'יוגורט', count_type: 'units', unit: 'גביע', qty: 2, location_id: 'מקרר' } },
  { kind: 'create', product: { name: 'טחינה', count_type: 'units', unit: 'צנצנת', qty: 1, location_id: 'מזווה' } },
  { kind: 'create', product: { name: 'ביצים', count_type: 'pack', pack_size: 12, qty: 12, is_basic: 1, target: 6, location_id: 'מקרר' } },
  { kind: 'create', product: { name: 'עגבניות', count_type: 'level', level: 'plenty', location_id: 'מקרר', store: 'greengrocer' } },
  { kind: 'create', product: { name: 'בצל', count_type: 'level', level: 'plenty', location_id: 'מזווה', store: 'greengrocer' } },
  { kind: 'create', product: { name: 'רסק עגבניות', count_type: 'units', unit: 'קופסה', qty: 2, location_id: 'מזווה' } },
  { kind: 'create', product: { name: 'פסטה', count_type: 'units', unit: 'שקית', qty: 0, is_basic: 1, target: 1, location_id: 'מזווה' } },
  { kind: 'create', product: { name: 'אורז', count_type: 'units', unit: 'שקית', qty: 0, is_basic: 1, target: 1, location_id: 'מזווה' } },
  { kind: 'list_add', text: 'חלב 3%', amount: 2 },
]);
// the rice and pasta lines came on by themselves; take them off so "make me a list" has something to do
{ const s = await S(); for (const i of s.list.filter((x) => x.product_id && /פסטה|אורז/.test(s.products.find((p) => p.id === x.product_id)?.name))) await act(avi, [{ kind: 'list_remove', item_id: i.id }]); }

const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const scenario0 = scenario;
scenario = async (id, ...rest) => (ONLY && !ONLY.includes(id) ? null : scenario0(id, ...rest));
await scenario('D2a', '"קניתי חלב" בלי כמות → שוקי שואל כמה, ואז מעדכן', async () => {
  const s0 = await S(); const q0 = P(s0, /^חלב 3/).qty;
  const r = await say(michal, 'קניתי חלב');
  must(!r.proposal, 'proposed without asking how many');
  must(/כמה/.test(r.reply), r.reply);
  await say(michal, r.options?.find((o) => /2/.test(o)) || '2');
  const p = P(await S(), /^חלב 3/); must(p.qty === q0 + 2, show(p));
});
await scenario('D2b', '"קניתי 3 יוגורטים" עם מספר → כרטיס מיד', async () => {
  const r = await say(avi, 'קניתי 3 יוגורטים');
  must(r.proposal, 'asked instead of proposing'); must(P(await S(), /יוגורט/).qty === 5, show(P(await S(), /יוגורט/)));
});
await scenario('D14', '"נגמר החלב" כשיש 3% וסויה → שואל איזה', async () => {
  const r = await say(avi, 'נגמר החלב');
  must(!r.proposal, 'picked one'); must((r.options || []).some((o) => /3%/.test(o)) && (r.options || []).some((o) => /סויה/.test(o)), JSON.stringify(r.options));
});
await scenario('D10', '"אין לנו טחינה" כשבמלאי יש → "להוסיף לרשימה?", ו"כן" מכניס', async () => {
  const r = await say(michal, 'אין לנו טחינה');
  must(!r.proposal, 'acted without asking'); must(/רשימה/.test(r.reply), r.reply);
  await say(michal, r.options?.find((o) => /כן/.test(o)) || 'כן, להוסיף');
  const s = await S(); must(onList(s, /טחינה/), 'not on the list');
});
await scenario('D8a', '"תזכיר לי לקנות נרות בשבוע הבא" → שואל מתי; "ביום ראשון בבוקר" → תזכורת לראשון', async () => {
  const r = await say(avi, 'תזכיר לי לקנות נרות בשבוע הבא');
  must(!r.proposal, 'guessed a time');
  await say(avi, 'ביום ראשון בבוקר');
  const m = (await S()).maybe.find((x) => x.kind === 'remind' && /נרות/.test(x.text));
  must(m, 'no reminder'); must(wd(m.due_at) === 0 && m.due_at > Date.now(), `${ymd(m.due_at)} ${hm(m.due_at)}`);
  log(`  reminder: ${ymd(m.due_at)} ${hm(m.due_at)}`);
});
await scenario('D8b', '"תזכיר לי מחר ב-6 בערב לקנות סוללות" → תזכורת מחר 18:00', async () => {
  await say(michal, 'תזכיר לי מחר ב-6 בערב לקנות סוללות');
  const m = (await S()).maybe.find((x) => x.kind === 'remind' && /סוללות/.test(x.text));
  must(m, 'no reminder'); must(ymd(m.due_at) === ymd(Date.now() + 86400e3) && hm(m.due_at) === '18:00', `${ymd(m.due_at)} ${hm(m.due_at)}`);
});
await scenario('TELL', '"תגיד למיכל לקנות לחם בדרך הביתה" → הודעה למיכל והלחם ברשימה', async () => {
  const r = await say(avi, 'תגיד למיכל לקנות לחם בדרך הביתה');
  const raw = r.proposal ? JSON.parse(d1(`SELECT actions FROM proposals WHERE id = '${r.proposal.id}'`)[0].actions).actions : [];
  must(raw.some((a) => a.kind === 'tell'), 'no message');
  const chat = (await call(michal, 'GET', '/api/chat')).messages;
  must(chat.some((m) => /ביקש שאגיד לך/.test(m.content.reply || '')), 'not in the chat');
  must(onList(await S(), /לחם/), 'bread not on the list');
});
await scenario('RECIPE', 'מדביקים מתכון → נשמר', async () => {
  await say(michal, 'תשמור לי מתכון: שקשוקה. מצרכים: 4 ביצים, 3 עגבניות, בצל, קופסת רסק עגבניות, מלח ופפריקה. מטגנים בצל, מוסיפים עגבניות ורסק, מבשלים 10 דקות, שוברים את הביצים ומכסים עד שהן מתייצבות.');
  const x = (await S()).recipes.find((y) => /שקשוקה/.test(y.name)); must(x && /ביצים/.test(x.ingredients), JSON.stringify(x));
});
await scenario('COOK', '"מה אפשר לבשל הערב?" → מציע את השקשוקה השמורה, בלי כרטיס', async () => {
  const r = await say(avi, 'מה אפשר לבשל הערב?', null);
  must(!r.proposal, 'a card'); must(/שקשוקה/.test(r.reply), r.reply);
});
await scenario('D19', '"הכנתי שקשוקה" → שואל במה השתמשו (לפי המתכון); "כן" מוריד ביצים', async () => {
  const r = await say(michal, 'הכנתי שקשוקה');
  must(!r.proposal, 'acted without asking');
  await say(michal, r.options?.find((o) => /כן/.test(o)) || 'כן, ככה');
  const p = P(await S(), /ביצ/); must(p.qty === 8, show(p));
});
await scenario('D3', 'יין לאירוח (מוצר חדש) → במלאי, לא חוזר לרשימה', async () => {
  await say(avi, 'קניתי 2 בקבוקי יין לארוחת שישי עם אורחים');
  const p = P(await S(), /יין/); must(p && p.qty === 2 && p.occasional === 1, JSON.stringify(p && { qty: p.qty, occasional: p.occasional }));
});
await scenario('WHO', '"מי עדכן את היוגורט?" → אבי', async () => {
  const r = await say(michal, 'מי עדכן את היוגורט ומתי?', null);
  must(/אבי/.test(r.reply), r.reply);
});
await scenario('STORE', 'חנות "קצב" בבית: "צריך לקנות חזה עוף" → לשונית הקצב', async () => {
  await call(avi, 'POST', '/api/settings', { addStore: 'קצב' });
  await say(avi, 'צריך לקנות חזה עוף');
  const s = await S(); const k = s.stores.find((x) => x.name === 'קצב');
  const it = s.list.find((i) => /חזה עוף/.test(i.product_id ? s.products.find((p) => p.id === i.product_id)?.name || '' : i.text));
  must(it && it.store === k.id, JSON.stringify(it));
});
await scenario('PESACH', 'מצב פסח: "צור לי רשימה" לא מכניס פסטה, כן אורז', async () => {
  const r0 = await call(avi, 'POST', '/api/settings', { pesach: true });
  log(`  chametz at home: ${JSON.stringify(r0.chametz)}`);
  await say(avi, 'צור לי רשימה');
  const s = await S(); must(!onList(s, /פסטה/), 'pasta on the list'); must(onList(s, /אורז/), 'rice missing');
  await call(avi, 'POST', '/api/settings', { pesach: false });
});

const ok = results.filter((r) => r.verdict === 'ok').length;
log(`\n${ok}/${results.length} ok; claims before approval: ${claims.length}`);
writeFileSync('test/real-r13-results.json', JSON.stringify(results, null, 1));
