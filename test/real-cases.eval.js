// Real model: round 9 (twin names, product photo, bought for guests). Run: bash test/real-eval.sh claude-sonnet-5 out.txt test/real-cases.eval.js
import { readFileSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:8790';
const call = async (t, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const x = await r.text(); try { return JSON.parse(x); } catch { return x; } };
const avi = (await call(null, 'POST', '/api/pair', { code: '111111' })).token;
const michal = (await call(null, 'POST', '/api/pair', { code: '222222' })).token;
const results = []; const must = (c, m) => { if (!c) throw new Error(m); };
const creates = (r) => (r.proposal?.lines || []).filter((l) => /^(חדש|מוצר חדש)|חדש:/.test(l.text) || /חדש/.test(l.detail || ''));
async function turn(tag, token, msg, check, apply = false) {
  const r = await call(token, 'POST', '/api/chat', typeof msg === 'string' ? { text: msg } : msg);
  let verdict = 'ok'; try { check?.(r); } catch (e) { verdict = `FAIL: ${e.message}`; }
  console.log(`\n[${tag}] > ${msg.text || msg}\n< [${r.face}] ${r.reply}${r.options?.length ? `\n   options: ${r.options.join(' | ')}` : ''}${r.proposal ? '\n' + r.proposal.lines.map((l) => `   • ${l.text}${l.detail ? ` (${l.detail})` : ''}`).join('\n') : ''}\n   ${verdict}`);
  results.push({ tag, text: msg.text || msg, reply: r.reply, options: r.options, lines: r.proposal?.lines, verdict });
  if (apply && r.proposal) await call(token, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
  return r;
}
await call(avi, 'POST', '/api/actions', { actions: [
  { kind: 'create', product: { name: 'רוטב חריף סקורפיון', count_type: 'units', unit: 'בקבוק', qty: 1, location_id: 'מזווה' } },
  { kind: 'create', product: { name: 'קולה', count_type: 'units', unit: 'בקבוק', qty: 1, is_basic: 1, target: 2, location_id: 'מזווה' } },
  { kind: 'create', product: { name: 'במבה', count_type: 'units', unit: 'שקית', qty: 2, location_id: 'מזווה' } },
] });
const names = async () => (await call(avi, 'GET', '/api/state')).products.map((p) => p.name);

await turn('twin', avi, 'קניתי עוד רוטב חריף סקורפיון, אבל זה סוג אחר, לא אותו אחד שיש', (r) => must(!r.proposal || r.proposal.lines.every((l) => !/^רוטב חריף סקורפיון$/.test(l.text.split(' — ')[0].replace(/^(חדש|מוצר חדש):?\s*/, ''))), 'no twin name') || must(/מה|איזה|במה/.test(r.reply), 'asks what differs'));
await turn('twin-answer', avi, 'הירוק, עם חלפיניו', (r) => must(r.proposal?.lines.some((l) => /סקורפיון.*(ירוק|חלפיניו)|(ירוק|חלפיניו).*סקורפיון/.test(l.text)), 'creates a distinct name'), true);
let n = await names();
results.push({ tag: 'twin-result', verdict: n.filter((x) => /סקורפיון/.test(x)).length === 2 ? 'ok' : `FAIL: ${n.join(', ')}` });

const pic = (f) => { const data = readFileSync(f).toString('base64'); return { image: { media_type: 'image/jpeg', data }, kind: 'product', thumb: data.length < 90000 ? data : undefined }; };
// the green one is already in the house: save the photo on it (and say nothing about saving before approval)
await turn('photo-known', michal, { text: 'צילמתי מוצר', ...pic('test/product-sample.jpg') }, (r) => { must(r.proposal?.lines.some((l) => /שמירת התמונה על .*סקורפיון/.test(l.text)), 'proposes saving the photo'); must(!/נשמר|שמרתי|שם את התמונה/.test(r.reply), 'does not claim it saved'); }, true);
let st = await call(avi, 'GET', '/api/state');
results.push({ tag: 'photo-known-result', verdict: st.products.find((p) => /סקורפיון.*(ירוק|חלפיניו)/.test(p.name))?.photo ? 'ok' : 'FAIL no photo on the green one' });
// a new kind: a distinct name, and the photo on it
const r1 = await turn('photo-new', avi, { text: 'צילמתי מוצר', ...pic('test/product-sample-red.jpg') }, (r) => must(r.proposal?.lines.some((l) => /סקורפיון.*(אדום|הבנרו|habanero)/i.test(l.text)) || /(אדום|הבנרו)/.test(r.reply + (r.options || []).join()), 'reads RED HABANERO'), true);
if (!r1.proposal) await turn('photo-new-2', avi, 'כן, להוסיף', (r) => must(r.proposal, 'proposes'), true);
st = await call(avi, 'GET', '/api/state');
const red = st.products.find((p) => /סקורפיון.*(אדום|הבנרו)/.test(p.name));
results.push({ tag: 'photo-new-result', verdict: red?.photo ? 'ok' : `FAIL ${st.products.map((p) => `${p.name}${p.photo ? '📷' : ''}`).join(', ')}` });
n = await names();
results.push({ tag: 'no-twins', verdict: new Set(n.map((x) => x.replace(/\s+/g, ' '))).size === n.length ? 'ok' : `FAIL twin names: ${n.join(', ')}` });

const cola0 = (await call(avi, 'GET', '/api/state')).products.find((p) => p.name === 'קולה').qty;
await turn('event', avi, 'קניתי 6 קולה ו-5 במבות לארוחת החג', (r) => must(r.proposal?.lines.some((l) => /לאירוח/.test(l.text)), 'marked for guests'), true);
const s = await call(avi, 'GET', '/api/state');
results.push({ tag: 'event-result', verdict: s.products.find((p) => p.name === 'קולה').qty === cola0 + 6 ? 'ok' : 'FAIL qty' });
await turn('not-event', michal, 'קניתי 2 קולה', (r) => must(r.proposal?.lines.length && r.proposal.lines.every((l) => !/לאירוח/.test(l.text)), 'ordinary purchase'));
console.log(`\n${results.filter((x) => x.verdict === 'ok').length}/${results.length} ok`);
(await import('node:fs')).writeFileSync('test/real-cases-results.json', JSON.stringify(results, null, 1));
