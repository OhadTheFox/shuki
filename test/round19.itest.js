// Round 19 (28/09): decisions 120-149 — reactions, what Shuki notices, recipes, the other provider, MCP.
// Run: node test/round19.itest.js
import './fetch-retry.js';
import { israelAt, israelDate } from './israel-time.js';
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';

const STATE = '/tmp/shuki-test/shuki-r19';
const PORT = 8783, MOCK = 8782;
const d1 = (sql) => JSON.parse(execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --json --command "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^[^[]*/, ''))[0].results;
rmSync(STATE, { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply shuki --local --persist-to ${STATE}`, { stdio: 'ignore' });
execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --file test/fixture-house.sql`, { stdio: 'ignore' });
d1(`INSERT INTO pairing_codes (code, user_id, expires) VALUES ('481516', 1, 9999999999999), ('234234', 2, 9999999999999)`);

// one mock for both providers: Claude answers from the script (or fails once), ChatGPT answers "from ChatGPT"
const script = []; const calls = []; let claudeFails = 0;
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { const b = Buffer.concat(parts).toString('utf8'); // bytes first: a Hebrew letter can be split between chunks (question 29)

  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const body = JSON.parse(b || '{}');
  if (req.url.endsWith('/chat/completions')) {
    calls.push({ provider: 'openai', body });
    return send(200, { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'respond', arguments: JSON.stringify({ reply: 'עניתי מ-ChatGPT', face: 'happy' }) } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
  }
  calls.push({ provider: 'anthropic', body });
  if (claudeFails) { claudeFails--; return send(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }); }
  const input = script.shift() || { reply: 'ok', face: 'happy' };
  send(200, { content: [{ type: 'tool_use', id: 'tu1', name: 'respond', input }], usage: { input_tokens: 100, output_tokens: 10 } });
}); }).listen(MOCK);
const dev = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(PORT), '--persist-to', STATE, '--var', `ANTHROPIC_URL:http://127.0.0.1:${MOCK}/v1/messages`, '--var', 'ANTHROPIC_API_KEY:t', '--var', `OPENAI_URL:http://127.0.0.1:${MOCK}/v1/chat/completions`, '--var', 'OPENAI_API_KEY:sk-test000000000000000000000', '--var', 'PROVIDER:anthropic', '--var', 'TEST_RESET:1', '--var', 'VAPID_SUBJECT:mailto:t@example.com', '--var', 'RETRY_MS:50'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = ''; dev.stdout.on('data', (d) => (log += d)); dev.stderr.on('data', (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
const call = async (t, m, p, b, headers = {}) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}), ...headers }, body: b ? JSON.stringify(b) : undefined }); const txt = await r.text(); let data = null; try { data = JSON.parse(txt); } catch { /* text */ } return { status: r.status, data, text: txt }; };
const state = async (t) => (await call(t, 'GET', '/api/state')).data;
const results = [];
async function check(id, name, fn) {
  try { const note = await fn(); results.push({ id, name, ok: true, note: note || '' }); console.log('✓', id, name, note ? `— ${note}` : ''); }
  catch (e) { results.push({ id, name, ok: false, error: e.message.slice(0, 400) }); console.log('✗', id, name, '\n   ', e.message.slice(0, 400)); }
}
const DAY = 86400e3;
const act = (t, actions) => call(t, 'POST', '/api/actions', { actions, op_id: `op-${Math.random()}` });
const chatSay = async (t, text, out) => { if (out) script.push(out); return (await call(t, 'POST', '/api/chat', { text })).data; };
const P = (s, name) => s.products.find((p) => p.name === name);
const sysText = (c) => (c.body.system || []).map((x) => x.text).join('\n');
let avi, michal;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  avi = (await call(null, 'POST', '/api/pair', { code: '481516', name: 'iPhone' })).data.token;
  michal = (await call(null, 'POST', '/api/pair', { code: '234234', name: 'iPhone' })).data.token;
  await call(avi, 'POST', '/api/settings', { costCap: 1000 });
  await act(avi, [
    { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 1, is_basic: 1, target: 2 } },
    { kind: 'create', product: { name: 'מלח', count_type: 'units', unit: 'שקית', qty: 1, is_basic: 1, target: 1 } },
    { kind: 'create', product: { name: "קוטג'", count_type: 'units', unit: 'גביע', qty: 2 } },
    { kind: 'create', product: { name: 'ביצים L', count_type: 'pack', pack_size: 12, qty: 12 } },
  ]);
  let s = await state(avi);
  const milk = P(s, 'חלב 3%').id, salt = P(s, 'מלח').id, cottage = P(s, "קוטג'").id;

  await check('R131', 'זריקה: תגובה רגעית (toss), בלי "עצוב ליום"', async () => {
    const r = await chatSay(avi, "זרקתי קוטג'", { reply: "אוי, הקוטג'... ביי ביי. לעדכן?", face: 'sad', actions: [{ kind: 'op', product_id: cottage, op: { type: 'discard', amount: 1 } }] });
    const a = await call(avi, 'POST', `/api/proposals/${r.proposal.id}/apply`, {});
    assert.equal(a.data.reaction, 'toss');
    assert.notEqual((await state(avi)).mood.mood, 'sad');
  });

  await check('R132', 'רגעים: הכנתי (cooked, והמתכון נספר), תודה, סיום קניות, כלל שאושר', async () => {
    const r1 = await chatSay(avi, 'תשמור מתכון שקשוקה ל-4: 4 ביצים, 3 עגבניות', { reply: 'לשמור?', face: 'happy', actions: [{ kind: 'recipe', name: 'שקשוקה', ingredients: '4 ביצים, 3 עגבניות', recipe_text: 'מבשלים', serves: 4 }] });
    assert.equal((await call(avi, 'POST', `/api/proposals/${r1.proposal.id}/apply`, {})).data.reaction, 'recipeSaved');
    assert.equal((await chatSay(avi, 'הכנתי שקשוקה', { reply: 'בתיאבון! במה השתמשת?', face: 'excited' })).reaction, 'cooked');
    s = await state(avi); const rec = s.recipes.find((x) => x.name === 'שקשוקה'); assert.equal(rec.cooked, 1); assert.equal(rec.serves, 4);
    assert.equal((await chatSay(avi, 'תודה שוקי', { reply: 'בכיף!', face: 'happy' })).reaction, 'thanks');
    assert.equal((await chatSay(avi, 'סיימתי קניות', { reply: 'יש! הכל קנוי', face: 'ecstatic', shopping: 'end' })).reaction, 'shopDone');
    const l = await chatSay(avi, 'תזכור שאין לנו מדיח', { reply: 'לזכור?', face: 'happy', actions: [{ kind: 'lesson', text: 'אין בבית מדיח' }] });
    assert.equal(l.reply, 'סגור, אזכור שאין בבית מדיח.'); assert.equal(l.reaction, 'learned'); // D10 (approved 02/10): says what
    // the catalog tells the model what's missing for each saved recipe, and how many times it was made
    const c = calls.filter((x) => x.provider === 'anthropic').at(-1); assert.match(sysText(c), /שקשוקה \[?.*\(ל-4\): ביצים, עגבניות/); assert.equal((await state(avi)).recipes.find((r) => r.name === 'שקשוקה')?.cooked, 1, 'counted'); // 0e: the list in part 2 has no count; it's in part 4 when the recipe is talked about
  });

  await check('R133', '"שים לב" בלשון של מי שכותב', async () => {
    assert.equal((await chatSay(avi, 'יש לנו במבה?', { reply: 'אין. שימי לב: יש אלרגיה לבוטנים.', face: 'happy' })).reply, 'אין. שים לב: יש אלרגיה לבוטנים.');
    assert.equal((await chatSay(michal, 'יש לנו במבה?', { reply: 'אין, שים לב.', face: 'happy' })).reply, 'אין, שימי לב.');
  });
  await check('R125', 'לשכוח כלל מהצ\'אט (forget)', async () => {
    const id = (await state(avi)).lessons.find((x) => x.text === 'אין בבית מדיח').id;
    const r = await chatSay(avi, 'תשכח את זה שאין מדיח', { reply: 'לשכוח?', face: 'happy', actions: [{ kind: 'lesson', forget: true, replaces: id }] });
    assert.equal(r.proposal, undefined); assert.equal(r.reply, 'סגור, שכחתי.');
    assert.ok(!(await state(avi)).lessons.some((x) => x.id === id));
  });

  await check('R125b', 'בקשה נגד כלל: קודם שאלה בלי כרטיס (החלטות 125, 160), "כן" מוסיף ו"לא" לא; "נגמר" על מה שכבר ברשימה', async () => {
    await chatSay(avi, 'תזכור שלא קונים קוטג', { reply: 'לזכור?', face: 'happy', actions: [{ kind: 'lesson', text: "לא קונים קוטג'" }] });
    const r = await chatSay(michal, "תוסיפי קוטג'", { reply: "להוסיף קוטג' לרשימה?", face: 'happy', actions: [{ kind: 'list_add', product_id: cottage }] });
    assert.equal(r.reply, "זכור לי שלא קונים קוטג'. האם תרצי שאוסיף את קוטג'?"); // 17/10, ש5 assert.deepEqual(r.options, ['כן, רק הפעם', 'כן, וזה כבר לא נכון', 'לא צריך']); assert.equal(r.proposal, undefined);
    assert.equal((await call(michal, 'POST', '/api/chat', { text: 'לא' })).data.reply, 'בסדר, לא הוספתי.');
    assert.ok(!(await state(avi)).list.some((i) => i.product_id === cottage && i.status === 'open'));
    await chatSay(michal, "תוסיפי קוטג'", { reply: "להוסיף קוטג' לרשימה?", face: 'happy', actions: [{ kind: 'list_add', product_id: cottage }] });
    assert.equal((await call(michal, 'POST', '/api/chat', { text: 'כן, רק הפעם' })).data.reply, 'הוספתי, רק הפעם.');
    let ci = (await state(avi)).list.find((i) => i.product_id === cottage && i.status === 'open'); assert.ok(ci); await act(avi, [{ kind: 'list_remove', item_id: ci.id }]);
    assert.ok((await state(avi)).lessons.some((x) => x.text === "לא קונים קוטג'"), 'only this time: the rule stays');
    await chatSay(michal, "תוסיפי קוטג'", { reply: "להוסיף קוטג' לרשימה?", face: 'happy', actions: [{ kind: 'list_add', product_id: cottage }] });
    assert.equal((await call(michal, 'POST', '/api/chat', { text: 'כן, וזה כבר לא נכון' })).data.reply, 'סגור! הוספתי ושכחתי את מה שלמדתי.');
    assert.ok(!(await state(avi)).lessons.some((x) => x.text === "לא קונים קוטג'"), 'the rule is gone');
    ci = (await state(avi)).list.find((i) => i.product_id === cottage && i.status === 'open'); assert.ok(ci); await act(avi, [{ kind: 'list_remove', item_id: ci.id }]);

    await act(avi, [{ kind: 'list_add', product_id: milk }]);
    const o = await chatSay(michal, 'נגמר החלב', { reply: 'להוסיף חלב לרשימה? הוא כבר שם', face: 'happy', actions: [{ kind: 'op', product_id: milk, op: { type: 'out' } }] });
    assert.equal(o.reply, 'האם לעדכן שנגמר חלב 3%? הוא כבר ברשימה.');
    await call(michal, 'POST', `/api/proposals/${o.proposal.id}/reject`, {});
    const it = (await state(avi)).list.find((i) => i.product_id === milk && i.status === 'open'); await act(avi, [{ kind: 'list_remove', item_id: it.id }]);
    // "saved!" said before anything was approved goes back to the model
    const n = calls.length;
    await chatSay(avi, 'תשמור מתכון פסטה: פסטה, רוטב', { reply: 'שמור! פסטה זה תמיד טוב', face: 'happy', actions: [{ kind: 'recipe', name: 'פסטה', ingredients: 'פסטה, רוטב' }] });
    assert.equal(calls.length - n, 1, 'a second try'); // home18 (4): the server drops "שמור!" instead of asking again
  });
  await check('R122', 'מיכל מוסיפה חלב ×2 שלוש פעמים: מעכשיו 2 מראש, ורואים את זה ב"שמתי לב ש..."; "לא" מפסיק', async () => {
    for (let k = 0; k < 3; k++) {
      await act(michal, [{ kind: 'list_add', product_id: milk, amount: 2 }]);
      const it = (await state(michal)).list.find((i) => i.product_id === milk && i.status === 'open'); await act(michal, [{ kind: 'list_remove', item_id: it.id }]);
    }
    await act(michal, [{ kind: 'list_add', product_id: milk }]);
    s = await state(michal); assert.equal(s.list.find((i) => i.product_id === milk && i.status === 'open').want, 2);
    const n = s.noticed.find((x) => x.kind === 'want'); /* home19 (11): michal reads her own, in the second person */ assert.equal(n.text, 'כשאת מוסיפה חלב 3% לרשימה, את תמיד מוסיפה 2 קרטונים. אני שם אוטומטית 2. האם זה בסדר?');
    // avi adds without an amount: his own habit, not hers
    const it = s.list.find((i) => i.product_id === milk && i.status === 'open'); await act(avi, [{ kind: 'list_remove', item_id: it.id }]);
    await act(avi, [{ kind: 'list_add', product_id: milk }]); assert.equal((await state(avi)).list.find((i) => i.product_id === milk && i.status === 'open').want, null);
    const it2 = (await state(avi)).list.find((i) => i.product_id === milk && i.status === 'open'); await act(avi, [{ kind: 'list_remove', item_id: it2.id }]);
    assert.equal((await call(avi, 'POST', '/api/noticed', { id: n.id, yes: false })).status, 200);
    await act(michal, [{ kind: 'list_add', product_id: milk }]); assert.equal((await state(michal)).list.find((i) => i.product_id === milk && i.status === 'open').want, null, 'a no stops the default');
  });

  await check('R123', 'שוקי הציע מלח לרשימה 3 פעמים ונדחה: שואל פעם אחת, בתשובה שאין בה כרטיס; "כן" = כלל ומלח לא קבוע', async () => {
    for (let k = 0; k < 3; k++) {
      const r = await chatSay(avi, 'מה חסר?', { reply: 'להוסיף מלח?', face: 'happy', actions: [{ kind: 'list_add', product_id: salt }] });
      await call(avi, 'POST', `/api/proposals/${r.proposal.id}/reject`, {});
    }
    const q = await chatSay(avi, 'יש לנו ביצים?', { reply: 'יש 12 ביצים.', face: 'happy' });
    assert.match(q.reply, /^יש 12 ביצים\. אגב, נראה שאתם לא צריכים מלח ברשימה\. האם תרצה שאזכור את זה\?$/, q.reply);
    assert.equal(q.proposal, undefined); assert.deepEqual(q.options, ['כן, תזכור', 'לא צריך']);
    const a = await call(avi, 'POST', '/api/chat', { text: 'כן' }); assert.equal(a.data.reaction, 'learned');
    s = await state(avi); assert.ok(s.lessons.some((l) => l.text === 'לא אציע יותר מלח לרשימה')); assert.ok(!P(s, 'מלח').is_basic);
    const again = await chatSay(avi, 'היי', { reply: 'היי', face: 'happy' }); assert.equal(again.reply, 'היי', 'asked twice');
  });

  await check('R121', 'קנייה באותו יום שלוש שבועות: "שמתי לב ש..." בהגדרות, בלי ששוקי כותב ראשון; ילד לא עונה', async () => {
    const seven = israelAt(israelDate(), '7:30'); // 07:30 in Israel today
    d1(`INSERT INTO product_log (event_id, ts, product_id, kind) VALUES ${[0, 1, 2].map((w) => `(0, ${seven - w * 7 * DAY - 3600e3}, ${cottage}, 'purchase')`).join(',')}`);
    const before = (await call(avi, 'GET', '/api/chat')).data.messages.length;
    await call(avi, 'POST', '/api/__schedule', { now: seven });
    assert.equal((await call(avi, 'GET', '/api/chat')).data.messages.length, before);
    const n = (await state(avi)).noticed.find((x) => x.kind === 'weekly'); assert.match(n.text, /^אתם קונים קוטג' בכל יום \S+\.$/);
  });

  await check('R135', 'מוצר שקונים תמיד 3 ממנו: העגלה מציעה 3', async () => {
    for (let k = 0; k < 3; k++) {
      await act(avi, [{ kind: 'list_add', product_id: cottage }]);
      const it = (await state(avi)).list.find((i) => i.product_id === cottage && i.status === 'open');
      await act(avi, [{ kind: 'check', item_id: it.id, amount: 3 }]);
      await act(avi, [{ kind: 'uncheck', item_id: it.id }]); await act(avi, [{ kind: 'list_remove', item_id: it.id }]);
    }
    assert.equal(P(await state(avi), "קוטג'").suggested, 3);
  });

  await check('R139', 'קישור לטיקטוק: בקשה לצילום מסך, בלי לקרוא למודל; קישור פנימי לא נפתח', async () => {
    const n = calls.length;
    const r = await chatSay(michal, 'תשמור את המתכון https://www.tiktok.com/@chef/video/123');
    assert.equal(r.reply, 'אני לא מצליח להיכנס לקישור. האם תשלחי לי צילום מסך של המתכון, ואשמור אותו?'); assert.equal(calls.length, n);
    const r2 = await chatSay(michal, 'https://127.0.0.1:8783/api/state');
    assert.match(r2.reply, /^לא הצלחתי לפתוח את הקישור/); assert.equal(calls.length, n);
  });

  await check('R143', 'Claude לא עונה (529) ויש מפתח ChatGPT: התשובה מ-ChatGPT, והמנהל רואה את זה', async () => {
    claudeFails = 3; const n = calls.length; // a busy moment is tried again twice (round 20); three in a row = down
    const r = await chatSay(michal, 'יש לנו חלב?');
    assert.match(r.reply, /^עניתי מ-ChatGPT\. אגב, שמתי לב שאתם קונים קוטג' בכל יום \S+\. האם תרצי שאזכור את זה\?$/); // and the weekly habit is asked about once, in a reply
    assert.deepEqual(calls.slice(n).map((c) => c.provider), ['anthropic', 'anthropic', 'anthropic', 'openai']);
    assert.deepEqual((await state(avi)).fellBack && { from: (await state(avi)).fellBack.from, to: (await state(avi)).fellBack.to }, { from: 'anthropic', to: 'openai' });
    assert.equal((await state(michal)).fellBack, undefined, 'only the admin');
    await chatSay(avi, 'היי', { reply: 'היי', face: 'happy' }); assert.equal((await state(avi)).fellBack, null, 'back to Claude');
  });

  let conn;
  await check('R145a', 'MCP: כתובת לכל אדם, initialize ו-tools/list; בלי כתובת תקפה 401; דפדפן מאתר אחר 403; GET 405', async () => {
    const c = await call(michal, 'POST', '/api/connectors', { name: 'Claude' }); conn = c.data.path; assert.match(conn, /^\/mcp\/[0-9a-f]{64}$/);
    assert.equal(d1(`SELECT COUNT(*) AS n FROM connectors WHERE token_hash = '${conn.slice(5)}'`)[0].n, 0, 'only the hash is kept');
    const init = await call(null, 'POST', conn, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    assert.equal(init.data.result.protocolVersion, '2025-06-18'); assert.match(init.data.result.instructions, /מיכל/);
    assert.equal((await call(null, 'POST', conn, { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
    const tools = (await call(null, 'POST', conn, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).data.result.tools.map((t) => t.name);
    assert.deepEqual(tools, ['whats_at_home', 'shopping_list', 'add_to_list', 'ran_out', 'bought', 'ask_shuki']);
    assert.equal((await call(null, 'POST', `/mcp/${'0'.repeat(64)}`, { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 401);
    assert.equal((await call(null, 'POST', conn, { jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await call(null, 'GET', conn)).status, 405);
    assert.equal((await state(michal)).connectors[0].name, 'Claude');
  });

  await check('R145b', 'MCP: מה יש, להוסיף לרשימה (ביומן "דרך Claude"), נגמר, קניתי, ושוקי בצ\'אט עם כרטיס שמחכה באפליקציה', async () => {
    const tool = async (name, args) => (await call(null, 'POST', conn, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } })).data.result;
    assert.match((await tool('whats_at_home', { query: 'ביצים' })).content[0].text, /^ביצים L: /);
    const add = await tool('add_to_list', { items: [{ name: 'חלב 3%', amount: 2 }, { name: 'נרות' }] }); assert.ok(!add.isError, JSON.stringify(add));
    s = await state(avi); assert.ok(s.list.some((i) => i.product_id === milk && i.want === 2)); assert.ok(s.list.some((i) => i.text === 'נרות'));
    assert.match(s.journal[0].summary, /^מיכל \(דרך Claude\) .*הוסיפה לרשימה נרות/);
    assert.match((await tool('shopping_list', {})).content[0].text, /נרות/);
    assert.ok(!(await tool('ran_out', { name: 'ביצים' })).isError); assert.equal(P(await state(avi), 'ביצים L').qty, 0);
    assert.ok(!(await tool('bought', { name: 'ביצים L', amount: 1 })).isError); assert.equal(P(await state(avi), 'ביצים L').qty, 12);
    script.push({ reply: 'להוסיף טחינה לרשימה?', face: 'happy', actions: [{ kind: 'create', product: { name: 'טחינה', count_type: 'units', qty: 0 }, reported: true }] });
    const ask = await tool('ask_shuki', { message: 'נגמרה הטחינה' });
    assert.match(ask.content[0].text, /^להוסיף טחינה לרשימה\?\n\nמחכה לאישור באפליקציה שלי:\n• /);
    assert.ok(!P(await state(avi), 'טחינה'), 'nothing changed before approval');
    assert.equal((await tool('nope', {})).isError, true);
  });

  await check('R145p', 'MCP: העוזר המחובר לא מקבל עובדה פרטית, גם לא של האדם עצמו (r11 q028, r0t p4)', async () => {
    d1(`INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 2, 'health', 'סוכרת סוג 1', 0, 2, 2, 1, 'chat', 0, 0)`);
    const tool = async (name, args) => (await call(null, 'POST', conn, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } })).data.result;
    script.push({ reply: 'אין.', face: 'happy' });
    const n = calls.length;
    await tool('ask_shuki', { message: 'יש לנו חלב?' });
    const sys = calls.slice(n).map(sysText).join('\n');
    assert.ok(sys.length, 'no call to the model');
    assert.ok(!sys.includes('סוכרת סוג 1'), 'a private fact went to the connected assistant');
    // in the app, her own private fact still reaches the model in her chat (part 4)
    script.push({ reply: 'אין.', face: 'happy' });
    const m = calls.length; await chatSay(michal, 'יש לנו חלב?');
    assert.ok(calls.slice(m).map(sysText).join('\n').includes('סוכרת סוג 1'), 'her own chat');
  });

  await check('R145c', 'ניתוק: הכתובת מפסיקה לעבוד; חיבורים לא בגיבוי', async () => {
    const exp = await call(avi, 'GET', '/api/export'); assert.ok(!/connectors|token_hash/.test(exp.text));
    const id = (await state(michal)).connectors[0].id;
    await call(avi, 'POST', '/api/connectors', { id, delete: true }); // someone else's: nothing happens
    assert.equal((await call(null, 'POST', conn, { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 200);
    await call(michal, 'POST', '/api/connectors', { id, delete: true });
    assert.equal((await call(null, 'POST', conn, { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 401);
  });

  await check('R145d', 'מי שיצא מהבית: גם החיבור שלו לעוזר מנותק; ילד לא נשאל על דפוסים', async () => {
    const add = (await call(avi, 'POST', '/api/members', { add: { name: 'יובל', gender: 'm', role: 'child' } })).data;
    const kid = (await call(null, 'POST', '/api/pair', { code: add.code })).data.token;
    const c = (await call(kid, 'POST', '/api/connectors', { name: 'ChatGPT' })).data.path;
    assert.equal((await call(null, 'POST', c, { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 200);
    const n = d1("SELECT COUNT(*) AS n FROM noticed WHERE status = 'watching' AND count >= 3")[0].n;
    if (n) { const q = await chatSay(kid, 'יש לנו חלב?', { reply: 'יש.', face: 'happy' }); assert.equal(q.reply, 'יש.', 'a child was asked'); }
    const uid = (await state(avi)).users.find((u) => u.name === 'יובל').id;
    await call(avi, 'POST', '/api/members', { id: uid, remove: true });
    assert.equal((await call(null, 'POST', c, { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 401);
  });
  await check('R129', 'בית חדש: ארבע בועות של מי אני, בפנים שנבחרו, והאחרונה שואלת מי בבית (החלטות 150, 179; ההיכרות עצמה: test/e2e-onboarding)', async () => {
    const { introBubbles } = await import('../worker/onboarding.js'); const b = introBubbles();
    assert.equal(b.length, 4); assert.deepEqual(b.map((x) => x.face), ['hungry', 'laughing', 'happy', 'excited']);
    assert.match(b[3].reply, /ספרו לי קצת עליכם: מי מנהל את האפליקציה ומי עוד גר בבית\?$/);
  });
} finally {
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} round-19 checks passed`);
  writeFileSync('test/round19-results.json', JSON.stringify(results, null, 1)); writeFileSync('/tmp/shuki-test/r19-log.txt', log);
  try { process.kill(-dev.pid, 'SIGKILL'); } catch { /* gone */ }
  mock.close(); process.exit(ok === results.length ? 0 : 1);
}
