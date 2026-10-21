// Real model: an ambiguous name (4 kinds of Tabasco). Run: bash test/real-eval.sh claude-sonnet-5 out.txt test/real-ambig.eval.js
const base = 'http://127.0.0.1:8790';
const call = async (t, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const x = await r.text(); try { return JSON.parse(x); } catch { return x; } };
const avi = (await call(null, 'POST', '/api/pair', { code: '111111' })).token;
const michal = (await call(null, 'POST', '/api/pair', { code: '222222' })).token;
await call(avi, 'POST', '/api/actions', { actions: ['טבסקו אדום', 'טבסקו ירוק', 'טבסקו צ\'יפוטלה', 'טבסקו שום'].map((name) => ({ kind: 'create', product: { name, count_type: 'units', unit: 'בקבוק', qty: 1, location_id: 'מזווה' } })) });
const res = [];
for (const [who, text, want] of [[avi, 'נגמר הטבסקו', 'ask'], [michal, 'קניתי טבסקו', 'ask'], [avi, 'תוסיף טבסקו לרשימה', 'ask'], [michal, 'נגמר הטבסקו הירוק', 'act'], [avi, 'נגמרו כל הטבסקו', 'act4']]) {
  const r = await call(who, 'POST', '/api/chat', { text });
  const lines = r.proposal?.lines || [];
  const ok = want === 'ask' ? !lines.length && (r.options || []).filter((o) => /טבסקו|אדום|ירוק|צ'יפוטלה|שום/.test(o)).length >= 3
    : want === 'act' ? lines.length === 1 && /ירוק/.test(lines[0].text) : lines.length === 4;
  console.log(`\n> ${text}\n< ${r.reply}${r.options?.length ? `\n  options: ${r.options.join(' | ')}` : ''}${lines.map((l) => `\n  • ${l.text}`).join('')}\n  ${ok ? 'ok' : 'FAIL'}`);
  res.push(ok);
  if (r.proposal) await call(who, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
}
console.log(`\n${res.filter(Boolean).length}/${res.length} ok`);
