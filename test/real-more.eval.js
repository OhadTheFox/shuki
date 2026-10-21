// Real model: the chat side of the 26/09 evening additions. Run: bash test/real-eval.sh claude-sonnet-5 out.txt test/real-more.eval.js
const base = process.env.BASE || 'http://127.0.0.1:8790';
const call = async (t, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const x = await r.text(); try { return JSON.parse(x); } catch { return x; } };
const avi = (await call(null, 'POST', '/api/pair', { code: '111111' })).token;
const michal = (await call(null, 'POST', '/api/pair', { code: '222222' })).token;
const results = []; const must = (c, m) => { if (!c) throw new Error(m); };
async function turn(tag, token, text, check, apply = false) {
  const r = await call(token, 'POST', '/api/chat', { text });
  let verdict = 'ok'; try { check?.(r); } catch (e) { verdict = `FAIL: ${e.message}`; }
  console.log(`\n[${tag}] > ${text}\n< [${r.face}] ${r.reply}${r.proposal ? '\n' + r.proposal.lines.map((l) => `   • ${l.text}${l.detail ? ` (${l.detail})` : ''}`).join('\n') : ''}${r.away ? `\n   away: ${JSON.stringify(r.away)}` : ''}\n   ${verdict}`);
  results.push({ tag, text, reply: r.reply, lines: r.proposal?.lines, away: r.away, verdict });
  if (apply && r.proposal) await call(token, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
  return r;
}
await turn('open_days', avi, 'מתחילים מהמקרר: 2 קרטוני חלב 3%, שמנת מתוקה, קוטג\' 5%, 4 קופסאות טונה, מיץ תפוזים סחוט', (r) => must(r.proposal?.lines.length >= 4, 'creates'), true);
const s = await call(avi, 'GET', '/api/state');
console.log('\nopen_days: ' + s.products.map((p) => `${p.name}=${p.open_days ?? '-'}`).join(', '));
const milk = s.products.find((p) => /חלב/.test(p.name));
results.push({ tag: 'open_days', verdict: milk?.open_days >= 2 && milk.open_days <= 5 && !s.products.find((p) => /טונה/.test(p.name))?.open_days ? 'ok' : `FAIL: ${s.products.map((p) => `${p.name}=${p.open_days}`).join(',')}` });
await turn('open', michal, 'פתחתי חלב', (r) => must(r.proposal?.lines.some((l) => /חלב/.test(l.text) && /פתחנו/.test(l.text)), 'open milk'), true);
const m2 = (await call(avi, 'GET', '/api/state')).products.find((p) => /חלב/.test(p.name));
results.push({ tag: 'open', verdict: m2.opened && (m2.next_expiry - Date.now()) / 864e5 <= 5 ? 'ok' : 'FAIL: not opened' });
await turn('warn', avi, 'תוסיף טונה לרשימה', (r) => must(/4|ארבע/.test(r.reply) && /יש/.test(r.reply), 'says there are 4'));
await turn('warn', michal, 'תוסיף חלב לרשימה', (r) => must(/יש/.test(r.reply) || r.proposal?.lines.some((l) => /^יש כבר/.test(l.detail || '')), 'says how much milk, in the reply or on the card'));
const until = new Date(Date.now() + 9 * 864e5);
const day = until.getDate();
await turn('away', avi, `אנחנו טסים לחו"ל, חוזרים ב-${day} לחודש`, (r) => must(r.away?.until && new Date(r.away.until).getDate() === day, `away until day ${day}`));
await turn('away', michal, 'מה המצב? יש לנו טונה?', (r) => must(/4|ארבע/.test(r.reply), 'normal answers while away'));
await turn('away', avi, 'חזרנו הביתה', (r) => must(r.away?.end === true, 'back'));
await turn('away', michal, 'טסים מחר לשבוע', (r) => must(r.away?.until, 'relative dates'));
await turn('notaway', avi, 'מיכל בחו"ל השבוע, אני בבית', (r) => must(!r.away?.until, 'only one of us away: the house is not away'));
console.log(`\n${results.filter((x) => x.verdict === 'ok').length}/${results.length} ok`);
(await import('node:fs')).writeFileSync('test/real-more-results.json', JSON.stringify(results, null, 1));
