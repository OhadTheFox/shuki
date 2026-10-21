// Runs the independent scenarios (test/stories-exec.json) against the real Shuki, and grades each one
// with a separate model call against what a person expects. Output: test/stories-results.json + .md
// Run: bash test/stories-run.sh [ids...]
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const base = `http://127.0.0.1:${process.env.PORT || 8790}`;
const KEY = readFileSync('.dev.vars', 'utf8').match(/ANTHROPIC_API_KEY=(\S+)/)[1];
const all = JSON.parse(readFileSync(process.env.STORIES || 'test/stories-exec.json', 'utf8')).scenarios;
const DBDIR = `/tmp/shuki-stories-${(Number(process.env.PORT) || 8800) - 8800}`;
const d1 = (sql) => execSync(`npx wrangler d1 execute shuki --local --persist-to ${DBDIR} --command "${sql.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
const only = process.argv.slice(2).filter((a) => /^[A-Z]\d+$/.test(a));
const [shard, shards] = (process.env.SHARD || '0/1').split('/').map(Number);
const list = (only.length ? all.filter((s) => only.includes(s.id)) : all).filter((_, i) => i % shards === shard);
const call = async (t, m, p, b) => { const r = await fetch(base + p, { signal: AbortSignal.timeout(150000), method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const x = await r.text(); try { return { status: r.status, ...JSON.parse(x) }; } catch { return { status: r.status, text: x }; } };
const tok = { 'אבי': (await call(null, 'POST', '/api/pair', { code: '111111' })).token, 'מיכל': (await call(null, 'POST', '/api/pair', { code: '222222' })).token };
const who = (w) => tok[w] || tok['אבי'];
const DECISIONS = readFileSync('test/decisions.txt', 'utf8');

const snap = (s) => ({
  inventory: s.products.map((p) => `${p.name}${p.is_basic ? ' (בסיסי)' : ''} [${s.locations.find((l) => l.id === p.location_id)?.name || ''}]: ${p.text}${p.level === 'little' && p.count_type !== 'level' ? ' [סימון נשאר מעט]' : ''}`),
  list: s.list.filter((i) => i.status !== 'done').map((i) => `${i.product_id ? s.products.find((p) => p.id === i.product_id)?.name : i.text}${i.want ? ` ×${i.want}` : ''} [${i.store}${i.status === 'checked' ? ', בעגלה' : ''}]`),
  app_cards: [...(s.lowAsk || []).map((x) => `כרטיס באפליקציה: "נשאר מעט: ${x.name}" עם כפתורים לרשימה / תזכיר לי בעוד 3 ימים / לא צריך`), ...(s.expired || []).map((x) => `כרטיס: עבר התאריך: ${x.name}`), ...(s.maybe || []).map((m) => `${m.kind === 'remind' ? 'תזכורת' : 'נחשוב על זה'}: ${m.text}`)],
  shopping: s.shopping.map((t) => `${t.name} בקניות ב-${t.store}`),
  house: `${s.house} · בני הבית: ${s.users.map((u) => `${u.name}${u.role === 'admin' ? ' (מנהל)' : ''}`).join(', ')} · חנויות: ${s.stores.map((x) => `${x.id}=${x.name}`).join(', ')}${s.pesach ? ' · מצב פסח פועל' : ''}`,
  recipes: (s.recipes || []).map((x) => x.name),
  lessons: (s.lessons || []).map((l) => l.text), // what Shuki learned (approved rules)
  reminders: (s.maybe || []).filter((m) => m.kind === 'remind').map((m) => `${m.text} @ ${new Date(m.due_at).toLocaleString('he-IL', { timeZone: s.tz })}`),
});
// a household store is written by its Hebrew name in the scenarios; its id is made when it's added
let storeIds = {};
const sid = (x) => (x && storeIds[x]) || x;
async function seed(sc) {
  const sd = sc.seed || {};
  // more people in the house: the admin (Avi) adds them, and each one pairs a phone
  for (const m of sd.members || []) {
    const a = await call(tok['אבי'], 'POST', '/api/members', { add: { name: m.name, gender: m.gender || 'm', ...(m.role && { role: m.role }) } });
    if (a.error) throw new Error(`member ${m.name}: ${a.error}`);
    tok[m.name] = (await call(null, 'POST', '/api/pair', { code: a.code })).token;
  }
  for (const st of sd.stores || []) await call(tok['אבי'], 'POST', '/api/settings', { addStore: st });
  storeIds = Object.fromEntries(((await call(tok['אבי'], 'GET', '/api/state')).stores || []).map((x) => [x.name, x.id]));
  if (sd.house_name) await call(tok['אבי'], 'POST', '/api/settings', { house_name: sd.house_name });
  if (sd.recipes?.length) await call(tok['אבי'], 'POST', '/api/__recipes', { recipes: sd.recipes });
  const creates = (sd.products || []).map((p) => { const { running_low, ...q } = p; return { kind: 'create', product: { ...q, store: sid(q.store), location_id: q.location_id || 'מקרר', category_id: q.category_id || 'אחר' } }; });
  if (creates.length) { const r = await call(tok['אבי'], 'POST', '/api/actions', { actions: creates }); if (r.error) throw new Error(`seed: ${r.error}`); }
  let s = await call(tok['אבי'], 'GET', '/api/state');
  const id = (n) => s.products.find((p) => p.name === n)?.id;
  const lows = (sd.products || []).filter((p) => p.running_low).map((p) => ({ kind: 'op', product_id: id(p.name), op: { type: 'low' } }));
  if (lows.length) await call(tok['אבי'], 'POST', '/api/actions', { actions: lows });
  for (const it of sd.list || []) {
    await call(tok['אבי'], 'POST', '/api/actions', { actions: [it.product ? { kind: 'list_add', product_id: id(it.product), store: sid(it.store), amount: it.amount } : { kind: 'list_add', text: it.text, store: sid(it.store) || 'super', amount: it.amount }] });
    if (it.status === 'checked') { s = await call(tok['אבי'], 'GET', '/api/state'); const li = s.list.find((i) => (it.product ? i.product_id === id(it.product) : i.text === it.text) && i.status === 'open'); if (li) await call(tok['אבי'], 'POST', '/api/actions', { actions: [{ kind: 'check', item_id: li.id }], context: 'shopping' }); }
  }
  if (sd.shopping) await call(who(sd.shopping.who), 'POST', '/api/shopping', { on: true, store: sid(sd.shopping.store) || 'super' });
  if (sd.pesach) await call(tok['אבי'], 'POST', '/api/settings', { pesach: true });
  if (sd.away) await call(tok['אבי'], 'POST', '/api/away', { until: new Date(Date.now() + sd.away.days * 864e5).toISOString().slice(0, 10) });
}
async function toAction(a, s) {
  const pid = (n) => s.products.find((p) => p.name === n)?.id;
  const item = (n) => s.list.find((i) => i.status !== 'done' && ((i.product_id && s.products.find((p) => p.id === i.product_id)?.name === n) || i.text === n))?.id;
  switch (a.type) {
    case 'check': return { kind: 'check', item_id: item(a.item), amount: a.amount, ...(a.units && { units: a.units }) };
    case 'uncheck': return { kind: 'uncheck', item_id: item(a.item) };
    case 'list_remove': return { kind: 'list_remove', item_id: item(a.item) };
    case 'list_add': return a.product && pid(a.product) ? { kind: 'list_add', product_id: pid(a.product), store: sid(a.store) } : { kind: 'list_add', text: a.text || a.product, store: sid(a.store) };
    case 'finish': return { kind: 'finish', ...(a.store && { store: a.store }) };
    case 'op': return { kind: 'op', product_id: pid(a.product), op: a.op };
    case 'create': return { kind: 'create', product: a.product };
    case 'edit': return { kind: 'edit', product_id: pid(a.product), fields: a.fields };
    case 'delete': return { kind: 'delete', product_id: pid(a.product) };
    default: throw new Error(`unknown act ${a.type}`);
  }
}
async function judge(sc, transcript, before, after) {
  const prompt = `אתה בודק איכות של אפליקציה ביתית בשם שוקי (צ'אט + רשימת קניות + מלאי) לבני בית (אבי מנהל הבית, מיכל, ולפעמים עוד אנשים שנוספו בתרחיש). היום ${new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' })}. שוקי מציע שינויים בכרטיס, והמשתמש מאשר; בבדיקה הזאת הכרטיס אושר כשכתוב "אושר". קבע אם מה שקרה עונה על מה שבן אדם אמיתי ציפה.

החלטות מוצר (מה שנקבע, לפיהן לשפוט כשהציפייה אומרת "לפי החלטה N"):
${DECISIONS}

התרחיש: ${sc.id}
מצב לפני (כפי שנכתב): ${sc.setup}
מה נאמר / נעשה: ${sc.says}
הציפייה: ${JSON.stringify(sc.expected)}

מה קרה בפועל:
${transcript.join('\n')}

מצב לפני (בפועל): ${JSON.stringify(before)}
מצב אחרי: ${JSON.stringify(after)}

כללים לשיפוט:
- שפוט את הכוונה, לא את הניסוח המדויק. תשובה אחרת במילים אבל עם אותה תוצאה = עבר.
- "fail" רק כשמשהו מהותי שגוי: המלאי או הרשימה לא נכונים, שוקי טוען דבר לא נכון, לא שואל כשצריך לשאול, מבצע משהו שלא ביקשו, או מפספס את מה שהאדם רצה.
- קיימים: תזכורות לתאריך ושעה, חנויות משלהם, מתכונים שמורים, מצב פסח, הודעה לבן בית אחר (התראה + בצ'אט), צילום מקרר/מתכון, "מי עדכן". לא קיימים: שגרה קבועה (כל שבוע), סימון "לא היה בחנות" (בכוונה: הפריט פשוט נשאר ברשימה), הזמנות אונליין, ניתוח תמונה בבדיקה הזאת (אין תמונות). אם הציפייה דורשת משהו שלא קיים ושוקי התנהג בצורה סבירה ולא הטעה, סמן "missing-feature".
- חוסר קטן בניסוח או פרט שולי = "pass" עם הערה.
- אם הציפייה סותרת את אחת ההחלטות למעלה, ההחלטה קובעת. אם התוצאה תואמת להחלטה, סמן "pass" וכתוב "לפי החלטה N".
החזר JSON בלבד: {"verdict":"pass|fail|missing-feature","why":"משפט או שניים בעברית: מה בדיוק לא תקין, או למה עבר"}`;
  for (let i = 0; i < 3; i++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', { signal: AbortSignal.timeout(150000), method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }) });
    const j = await r.json(); const t = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    const m = t.match(/\{[\s\S]*\}/); if (m) try { return JSON.parse(m[0]); } catch { /* retry */ }
    await new Promise((x) => setTimeout(x, 2000));
  }
  return { verdict: 'error', why: 'judge failed' };
}
const results = [];
for (const sc of list) {
  const transcript = []; storeIds = {};
  try {
    const rs = await call(tok['אבי'], 'POST', '/api/__reset'); if (!rs.ok) throw new Error(`reset failed: ${JSON.stringify(rs)}`);
    const empty = await call(tok['אבי'], 'GET', '/api/state'); if (empty.products.length || empty.list.length) throw new Error('house not empty after reset');
    await seed(sc);
    const before = snap(await call(tok['אבי'], 'GET', '/api/state'));
    let last = null;
    for (const st of sc.steps) {
      const t = who(st.who);
      if (st.chat != null || st.chat_option != null) {
        const text = st.chat != null ? st.chat : (last?.options || [])[st.chat_option - 1];
        if (text == null) { transcript.push(`(אין כפתור ${st.chat_option} ללחוץ עליו)`); continue; }
        const r = await call(t, 'POST', '/api/chat', { text }); last = r;
        transcript.push(`${st.who}: ${text}`, `שוקי: ${r.reply || r.error}${r.options?.length ? `  [כפתורים: ${r.options.join(' | ')}]` : ''}`);
        if (r.proposal) transcript.push(`כרטיס: ${r.proposal.lines.map((l) => l.text + (l.detail ? ` (${l.detail})` : '')).join(' ; ')}`);
        if (r.shopping) transcript.push(`(מצב קניות: ${r.shopping})`);
        if (r.away) transcript.push(`(חופשה: ${JSON.stringify(r.away)})`);
        const verb = st.chat != null ? st.then : 'apply';
        if (r.proposal && (verb === 'apply' || verb === 'reject')) { const a = await call(t, 'POST', `/api/proposals/${r.proposal.id}/${verb}`, {}); transcript.push(verb === 'apply' ? (a.status === 'applied' ? '→ אושר' : `→ אישור נכשל: ${a.error || a.status}`) : '→ בוטל'); }
      } else if (st.down != null || st.up) {
        // 👍 / 👎 on Shuki's last answer; 👎 with words goes to Shuki with the answer it's about
        const id = ((await call(t, 'GET', '/api/chat')).messages || []).filter((m) => m.role === 'shuki').at(-1)?.id;
        await call(t, 'POST', '/api/feedback', st.up ? { chat_id: id, up: true } : { chat_id: id, note: st.down });
        transcript.push(`${st.who}: ${st.up ? '👍' : '👎'} על התשובה האחרונה של שוקי${st.down ? `, וכתב: ${st.down}` : ''}`);
        if (st.down) {
          const r = await call(t, 'POST', '/api/chat', { text: st.down, feedback: id }); last = r;
          transcript.push(`שוקי: ${r.reply || r.error}${r.options?.length ? `  [כפתורים: ${r.options.join(' | ')}]` : ''}`);
          if (r.proposal) transcript.push(`כרטיס: ${r.proposal.lines.map((l) => l.text + (l.detail ? ` (${l.detail})` : '')).join(' ; ')}`);
          if (r.proposal && (st.then === 'apply' || st.then === 'reject')) { const a = await call(t, 'POST', `/api/proposals/${r.proposal.id}/${st.then}`, {}); transcript.push(st.then === 'apply' ? (a.status === 'applied' ? '→ אושר' : `→ אישור נכשל: ${a.error || a.status}`) : '→ בוטל'); }
        }
      } else if (st.act) {
        const s = await call(t, 'GET', '/api/state');
        const actions = []; for (const a of st.act) actions.push(await toAction(a, s));
        const r = await call(t, 'POST', '/api/actions', { actions, context: s.shopping.length ? 'shopping' : undefined });
        transcript.push(`${st.who} באפליקציה: ${st.act.map((a) => `${a.type} ${a.item || a.product || a.text || ''}`).join(', ')}${r.error ? ` → שגיאה: ${r.error}` : ''}${r.trip ? ` → סיכום: ${JSON.stringify(r.trip)}` : ''}`);
      } else if (st.api) {
        const map = { shopping_on: ['POST', '/api/shopping', { on: true, store: sid(st.store) || 'super' }], shopping_off: ['POST', '/api/shopping', { on: false }], undo: ['POST', '/api/undo'], away: ['POST', '/api/away', { until: new Date(Date.now() + (st.days || 7) * 864e5).toISOString().slice(0, 10) }] };
        if (st.api === 'low') { const s = await call(t, 'GET', '/api/state'); map.low = ['POST', '/api/low', { id: s.products.find((p) => p.name === st.product)?.id, decision: st.decision }]; }
        const r = await call(t, ...map[st.api]); transcript.push(`${st.who}: ${st.api}${r.error ? ` → ${r.error}` : ''}`);
      }
    }
    const after = snap(await call(tok['אבי'], 'GET', '/api/state'));
    after.pending_cards = ((await call(tok['אבי'], 'GET', '/api/chat')).messages || []).filter((m) => m.content?.proposal?.status === 'pending' || (m.content?.proposal && !m.content.proposal.status)).map((m) => m.content.proposal.lines.map((l) => l.text).join('; '));
    const j = await judge(sc, transcript, before, after);
    results.push({ id: sc.id, needs: sc.needs, says: sc.says, verdict: j.verdict, why: j.why, transcript, after });
    console.log(`${j.verdict === 'pass' ? '✓' : j.verdict === 'fail' ? '✗' : '~'} ${sc.id} ${sc.says?.slice(0, 50)} — ${j.why}`);
  } catch (e) {
    results.push({ id: sc.id, verdict: 'error', why: e.message, transcript });
    console.log(`! ${sc.id} ${e.message}`);
  }
  for (const k of Object.keys(tok)) if (!['אבי', 'מיכל'].includes(k)) delete tok[k];
  writeFileSync(`/tmp/shuki-test/stories-${shard}.json`, JSON.stringify(results, null, 1));
}
const c = (v) => results.filter((r) => r.verdict === v).length;
console.log(`\npass ${c('pass')} · fail ${c('fail')} · missing-feature ${c('missing-feature')} · error ${c('error')} / ${results.length}`);
