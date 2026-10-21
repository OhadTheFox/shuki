// Talks to the REAL model through a local worker (needs ANTHROPIC_API_KEY in .dev.vars and `wrangler dev --port 8790`).
// Not an automatic test: prints what Shuki proposes for typical Hebrew messages, with light checks.
const base = process.env.BASE || 'http://127.0.0.1:8790';
const call = async (t, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); return r.json(); };
const avi = (await call(null, 'POST', '/api/pair', { code: '111111' })).token;
const michal = (await call(null, 'POST', '/api/pair', { code: '222222' })).token;

const results = [];
async function turn(token, text, check, autoApply = false) {
  const t0 = Date.now();
  const r = await call(token, 'POST', '/api/chat', { text });
  const ms = Date.now() - t0;
  const lines = r.proposal?.lines?.map((l) => `   • ${l.text}${l.detail ? ` (${l.detail})` : ''}`).join('\n') || '';
  let verdict = 'ok';
  try { check?.(r); } catch (e) { verdict = `CHECK FAILED: ${e.message}`; }
  console.log(`\n> ${text}\n< [${r.face}] ${r.reply}${r.options ? `\n   options: ${r.options.join(' | ')}` : ''}${lines ? `\n${lines}` : ''}\n   (${ms}ms) ${verdict}`);
  results.push({ text, reply: r.reply, face: r.face, lines: r.proposal?.lines, options: r.options, ms, verdict });
  if (autoApply && r.proposal) await call(token, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
  return r;
}
const must = (c, msg) => { if (!c) throw new Error(msg); };

await turn(avi, 'מתחילים מהמקרר: 2 קרטוני חלב 3%, תבנית ביצים שנשארו בה 6, גבינה צהובה, קוטג\' 5%, עגבניות ומלפפונים, וחצי בקבוק רוטב סויה', (r) => {
  must(r.proposal && r.proposal.lines.length >= 6, 'expected ~7 creates');
}, true);
await turn(michal, 'עכשיו המזווה: 4 קופסאות טונה, שקית אורז פתוחה ועוד אחת סגורה, 2 שקיות פסטה, שמן זית', (r) => must(r.proposal?.lines.length >= 4, 'expected 4 creates'), true);
await turn(avi, 'ובארון הניקיון: סבון כלים בשימוש ואחד רזרבי, אריזת נייר טואלט של 32 שנשארו בה 10', (r) => must(r.proposal, 'expected creates'), true);
const s = await call(avi, 'GET', '/api/state');
console.log('\nCATALOG:\n' + s.products.map((p) => `  ${p.name} | ${p.count_type}${p.pack_size ? '×' + p.pack_size : ''} | ${p.text} | ${s.locations.find((l) => l.id === p.location_id)?.name} | ${s.categories.find((c) => c.id === p.category_id)?.name} | ${p.is_basic ? 'בסיסי יעד ' + p.target : '-'} | ${p.store}${p.store2 ? '/' + p.store2 : ''} | ${p.shelf_days ?? '-'}d`).join('\n'));

await turn(michal, 'נגמר החלב', (r) => must(r.proposal?.lines.some((l) => /חלב/.test(l.text) && /נגמר/.test(l.text)), 'milk out'), true);
await turn(avi, 'נגמרה הגבינה', (r) => must(r.options?.length || r.proposal, 'either ask or act'));
await turn(michal, 'יש לנו טונה?', (r) => must(!r.proposal && /4|ארבע/.test(r.reply), 'answer with 4, no proposal'));
await turn(avi, 'מה חסר לנו?', (r) => must(!r.proposal, 'no proposal for a question'));
await turn(michal, 'איפה האורז?', (r) => must(/מזווה/.test(r.reply), 'pantry'));
await turn(avi, 'זרקנו את הקוטג\', התקלקל', (r) => must(r.proposal?.lines.some((l) => /קוטג/.test(l.text) && /זרקנו|נזרק/.test(l.text)), 'discard cottage'));
// if the catalog step made it basic with a target above 10, it is already missing and on the list: saying so is right too
await turn(michal, 'כמעט נגמר נייר טואלט', (r) => must(r.proposal?.lines.some((l) => /נייר טואלט/.test(l.text)) || (!r.proposal && /ברשימ/.test(r.reply)), 'toilet paper low'));
await turn(avi, 'קניתי רכז רימונים במבצע', (r) => must(r.proposal?.lines.some((l) => /רימונים/.test(l.text)), 'new product bought'));
await turn(michal, 'פתחנו את הסבון כלים האחרון', (r) => must(r.proposal?.lines.some((l) => /סבון/.test(l.text)), 'soap'));
await turn(avi, 'תוסיף לרשימה סוללות AA', (r) => must(r.proposal?.lines.some((l) => /סוללות/.test(l.text)), 'batteries on list'));
await turn(michal, 'מה המצב שלך שוקי?', null);

const u = await call(avi, 'GET', '/api/export');
console.log('\nUSAGE:', JSON.stringify(u.settings), '\nfailed checks:', results.filter((r) => r.verdict !== 'ok').length, '/', results.length);
await import('node:fs').then((fs) => fs.writeFileSync(new URL('./real-model-results.json', import.meta.url), JSON.stringify(results, null, 1)));
