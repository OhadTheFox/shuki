// Round 19, real model: decisions 120-149 (Shuki's voice, reactions, instincts, onboarding, recipes, the model).
// Run: bash test/real-eval.sh claude-sonnet-5 test/real-r19-results.txt test/real-r19.eval.js
// Run: bash test/real-eval.sh claude-sonnet-5 test/real-r18-results.txt test/real-r18.eval.js
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
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
  { kind: 'create', product: { name: "קוטג'", count_type: 'units', unit: 'גביע', qty: 2, is_basic: 1, target: 2, location_id: 'מקרר' } },
  { kind: 'create', product: { name: 'ביצים', count_type: 'pack', pack_size: 12, qty: 8, is_basic: 1, target: 6, location_id: 'מקרר' } },
  { kind: 'create', product: { name: 'טונה', count_type: 'units', unit: 'קופסה', qty: 4, location_id: 'מזווה' } },
  { kind: 'create', product: { name: 'בצל', count_type: 'level', level: 'plenty', location_id: 'מטבח' } },
]);
const PREACH = /כדאי|בפעם הבאה|בזבוז|לבזבז|חבל|אולי תנס|טיפ|חשוב ל/;

await scenario('PLAIN', '"נגמר החלב": ענייני, בלי דרמה', async () => {
  const r = await say(michal, 'נגמר החלב', 'reject');
  must(!/אוי|חבל|קפה|בוקר|!/.test(r.reply), r.reply); must(r.reply.length < 60, r.reply);
});
await scenario('TOSS', '"זרקנו את הקוטג\'": משפט קצר, בלי מוסר', async () => {
  const r = await say(avi, "זרקתי קוטג' אחד, התקלקל", 'reject');
  must(!PREACH.test(r.reply), r.reply); must(r.face === 'sad', r.face);
});
await scenario('SHAKSHUKA', '"מה חסר לי לשקשוקה?": חברותי, מה חסר ושאלה', async () => {
  await say(avi, 'תשמור מתכון שקשוקה: 4 ביצים, 3 עגבניות, פלפל אדום, בצל. מטגנים בצל ופלפל, מוסיפים עגבניות, שוברים ביצים.');
  const r = await say(michal, 'מה חסר לי לשקשוקה?', null);
  must(/עגבני/.test(r.reply) && /פלפל/.test(r.reply), r.reply); must(/\?/.test(r.reply), r.reply); must(!/^חסרות/.test(r.reply), r.reply);
});
await scenario('DONE', '"סיימתי קניות": שמחה קטנה', async () => {
  await say(avi, 'אני בסופר', null);
  const r = await say(avi, 'סיימתי קניות', null);
  must(r.reaction === 'shopDone', JSON.stringify(r.reaction)); must(!PREACH.test(r.reply), r.reply); // the app plays the confetti whatever face the model picked
});
await scenario('ASK', '"יש לנו טונה?": עובדה, בלי קישוטים', async () => {
  const r = await say(michal, 'יש לנו טונה?', null);
  must(/4/.test(r.reply) && /מזווה/.test(r.reply), r.reply); must((r.reply.match(/!/g) || []).length <= 1, r.reply); must(!PREACH.test(r.reply), r.reply);
});

await scenario('SCALE', '"שקשוקה ל-8" עם מתכון ל-4: מכפיל', async () => {
  await say(avi, 'תשמור מתכון שקשוקה ל-4 אנשים: 4 ביצים, 3 עגבניות, פלפל אדום, בצל. מטגנים, מוסיפים עגבניות, שוברים ביצים.');
  const r = await say(michal, 'אני מכינה שקשוקה ל-8, כמה ביצים צריך?', null);
  must(/8 ביצים|שמונה ביצים/.test(r.reply), r.reply);
});
await scenario('PLAN', '"תכנן לי 3 ארוחות ערב לשבוע": שלוש, קודם מהשמורים, כרטיס אחד למה שחסר', async () => {
  const r = await say(avi, 'תכנן לי 3 ארוחות ערב לשבוע ותוסיף לרשימה מה שחסר', 'reject');
  must(/שקשוקה/.test(r.reply), r.reply); must((r.proposal?.lines || []).length >= 1, lineOf(r));
});
await scenario('ALLERGY', 'מתכון עם בוטנים כשיש אלרגיה: מזכיר בעדינות', async () => {
  await set({ house_notes: 'יש בבית אלרגיה לבוטנים' });
  await say(avi, 'תשמור מתכון נודלס בוטנים: נודלס, חמאת בוטנים, סויה, בצל ירוק. מבשלים ומערבבים.');
  const r = await say(michal, 'מה אפשר לבשל הערב? משהו אסייתי', null);
  must(/בוטנים/.test(r.reply) && /אלרג|שימ/.test(r.reply), r.reply); must(!PREACH.test(r.reply.replace(/שימי לב|שימו לב/, '')), r.reply);
  await set({ house_notes: '' });
});
await scenario('CONFLICT', 'בקשה נגד כלל: מוסיף, ושואל אם הכלל עדיין נכון', async () => {
  const t = await say(avi, 'תזכור שאנחנו לא קונים במבה יותר');
  const r = await say(michal, 'תוסיף במבה לרשימה', 'reject');
  must(raw(r).some((a) => a.kind === 'list_add' || a.kind === 'create'), lineOf(r)); must(/כלל|למדתי|ביקשו|אמרו|לא קונים/.test(r.reply) && /\?/.test(r.reply), r.reply);
});
await scenario('FORGET', '"תשכח שלא קונים במבה": כרטיס לשכוח', async () => {
  const r = await say(avi, 'תשכח את הכלל על הבמבה', 'apply');
  must(raw(r).some((a) => a.kind === 'lesson' && a.forget), lineOf(r));
  must(!(await S()).lessons.some((l) => /במבה/.test(l.text)), 'still there');
});
await scenario('MCPCLIENT', 'Claude אמיתי כעוזר שמחובר לשוקי ב-MCP: "add milk and eggs to my list"', async () => {
  const conn = (await call(michal, 'POST', '/api/connectors', { name: 'Claude' })).path;
  const rpc = async (method, params) => call(null, 'POST', conn, { jsonrpc: '2.0', id: 1, method, params });
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'eval', version: '1' } });
  const tools = (await rpc('tools/list', {})).result.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  const key = readFileSync('.dev.vars', 'utf8').match(/^ANTHROPIC_API_KEY=(.+)$/m)[1].trim();
  const messages = [{ role: 'user', content: 'Add milk and 2 cartons of cottage cheese to my shopping list in Shuki, then tell me what is on the list.' }];
  const used = [];
  for (let turn = 0; turn < 6; turn++) {
    const res = await (await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 1000, tools, messages }) })).json();
    messages.push({ role: 'assistant', content: res.content });
    const uses = res.content.filter((c) => c.type === 'tool_use');
    if (!uses.length) { log(`  Claude: ${res.content.filter((c) => c.type === 'text').map((c) => c.text).join(' ').slice(0, 300)}`); break; }
    const out = [];
    for (const u of uses) { used.push(`${u.name} ${JSON.stringify(u.input)}`); const r = (await rpc('tools/call', { name: u.name, arguments: u.input })).result; out.push({ type: 'tool_result', tool_use_id: u.id, content: r.content, is_error: !!r.isError }); }
    messages.push({ role: 'user', content: out });
  }
  log(`  tools: ${used.join(' | ')}`);
  const s = await S();
  must(onList(s, /^חלב 3%/), 'no milk'); must(s.list.some((i) => i.status === 'open' && i.product_id === P(s, /קוטג/)?.id && i.want === 2), 'no cottage x2');
  must(/דרך Claude/.test(s.journal[0].summary), s.journal[0].summary);
});

log(`\n${results.filter((r) => r.verdict === 'ok').length}/${results.length} ok; claims before approval: ${claims.length}`);
writeFileSync('test/real-r19-results.json', JSON.stringify(results, null, 1));
