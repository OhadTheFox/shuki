// Shopping mode and learning against the REAL model. Run: test/real-eval.sh claude-sonnet-5 out.txt test/real-features.eval.js
import { writeFileSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:8790';
const DAY = 86400e3;
const call = async (t, m, p, b) => (await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined })).json();
const t = (await call(null, 'POST', '/api/pair', { code: '111111' })).token;
const michal = (await call(null, 'POST', '/api/pair', { code: '222222' })).token;
const act = (tok, actions, ts) => call(tok, 'POST', '/api/actions', { actions, ts, op_id: `x${Math.random()}` });
await act(t, [
  { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 2, is_basic: 1, target: 2, category_id: 'מוצרי חלב, גבינות וביצים', location_id: 'מקרר' } },
  { kind: 'create', product: { name: 'קוטג׳ 5%', count_type: 'units', qty: 1, category_id: 'מוצרי חלב, גבינות וביצים', location_id: 'מקרר' } },
  { kind: 'create', product: { name: 'טונה בשמן', count_type: 'units', unit: 'קופסה', qty: 4, is_basic: 1, target: 2, category_id: 'שימורים ורטבים', location_id: 'מזווה' } },
]);
let S = await call(t, 'GET', '/api/state');
const cot = S.products.find((p) => p.name === 'קוטג׳ 5%').id;
const now = Date.now();
for (const [d, type] of [[6.5, 'out'], [6, 'purchase'], [4, 'out'], [3.9, 'purchase'], [1.9, 'out'], [1.8, 'purchase']]) await act(t, [{ kind: 'op', product_id: cot, op: { type, amount: 1 } }], now - d * DAY);

const results = [];
const out = (id, name, ok, detail) => { results.push({ id, name, ok, detail }); console.log(ok ? '✓' : '✗', id, name, '\n   ', detail); };
const say = (tok, text) => call(tok, 'POST', '/api/chat', { text });
const lines = (r) => (r.proposal?.lines || []).map((l) => l.text).join(' | ');

{ const r = await say(t, 'אני עושה קניות'); out('R1', '"אני עושה קניות" פותח מצב קניות, בלי כרטיס אישור', r.shopping === 'start' && r.store === 'super' && !r.proposal, `${r.reply} [${r.shopping}/${r.store}]`); }
{ const r = await say(t, 'קניתי חלב'); out('R2', '"קניתי חלב" הוא קנייה, לא מצב קניות', !r.shopping && /חלב 3%/.test(lines(r)), `${r.reply} — ${lines(r)} [${r.shopping || '-'}]`); if (r.proposal) await call(t, 'POST', `/api/proposals/${r.proposal.id}/reject`, {}); }
{ const r = await say(michal, 'אני קופצת לסופר-פארם'); out('R3', 'מיכל: "אני קופצת לסופר-פארם" = מצב קניות בפארם, בלשון נקבה', r.shopping === 'start' && r.store === 'pharm', `${r.reply} [${r.shopping}/${r.store}]`); }
{ const r = await say(t, 'סיימתי, חזרתי הביתה מהסופר'); out('R4', '"סיימתי, חזרתי מהסופר" סוגר את מצב הקניות', r.shopping === 'end', `${r.reply} [${r.shopping || '-'}]`); }
{ const r = await say(michal, 'מה צריך לקנות?'); out('R5', '"מה צריך לקנות?" מזכיר גם את הקוטג׳ שצפוי להיגמר', /קוטג/.test(r.reply), r.reply); }
writeFileSync(new URL('./real-features-results.json', import.meta.url), JSON.stringify(results, null, 1));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} real-model feature checks passed`);

// variants of the same thing (the questions Avi asked)
{
  const r = await say(t, 'קנינו חלב נטול לקטוז');
  const L = lines(r);
  out('R6', '"קנינו חלב נטול לקטוז" כשיש חלב 3%: מוצר חדש, בלי לגעת בחלב 3%', /נטול לקטוז/.test(L) && /מוצר חדש/.test(L) && !/^חלב 3%/.test(L) && !L.includes('חלב 3% —'), `${r.reply} — ${L}`);
  if (r.proposal) await call(t, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
}
{
  const r = await say(t, 'נגמר החלב');
  const L = lines(r);
  const asked = !r.proposal && (r.options || []).some((o) => /לקטוז/.test(o)) && (r.options || []).some((o) => /3%/.test(o));
  out('R7', '"נגמר החלב" כשיש שני חלבים: שואל איזה (או סוגר רק את חלב 3%), לא את נטול הלקטוז', asked || (/חלב 3% — נגמר/.test(L) && !/לקטוז/.test(L)), `${r.reply} [${(r.options || []).join(' | ')}] ${L}`);
  if (r.proposal) await call(t, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
}
{
  const r = await say(t, 'תמחק את החלב הרגיל מהמלאי');
  const L = lines(r);
  out('R8', '"תמחק את החלב הרגיל": מוחק רק את חלב 3%', /חלב 3% — למחוק/.test(L) && !/לקטוז/.test(L), `${r.reply} — ${L}`);
  if (r.proposal) await call(t, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
}
{
  const r = await say(t, 'קנינו חלב סויה');
  const S2 = await call(t, 'GET', '/api/state');
  const line = (r.proposal?.lines || []).find((l) => /סויה/.test(l.text));
  if (r.proposal) await call(t, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
  const S3 = await call(t, 'GET', '/api/state');
  const soy = S3.products.find((p) => /סויה/.test(p.name));
  const cat = S3.categories.find((c) => c.id === soy?.category_id)?.name;
  out('R9', '"קנינו חלב סויה": מוצר חדש בקטגוריה "מוצרי חלב, גבינות וביצים"', !!line && cat === 'מוצרי חלב, גבינות וביצים' && S2.products.length + 1 === S3.products.length, `${r.reply} — ${line?.text} · ${cat}`);
}
writeFileSync(new URL('./real-features-results.json', import.meta.url), JSON.stringify(results, null, 1));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} real-model feature checks passed (with variants)`);
