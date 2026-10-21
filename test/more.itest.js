// The eight additions (26/09 evening), server side. Run: node test/more.itest.js
// M1 "do we have?" is client-only (see test/more-ui.cjs). Here: recount, Siri, trip summary, warn, maybe, open expiry, away.
import './fetch-retry.js';
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

const STATE = '/tmp/shuki-test/shuki-more';
// a fixed clock for the whole file (stage 9, 0ג; question 26): Tuesday 20/10/2026, 12:00 in Israel. M8 used to fail when the
// hour turned between M2 (which set the summary's hour to "now") and M8 (whose hourly run is checked at that hour). The hourly
// run takes FIXED_NOW too (worker/index.js, scheduled). On this clock nothing gets older: a limit by the minute (30 messages a
// person) counts the whole file, and a bubble saved "a moment later" (now + 1500) stays after what comes next
const NOW = Date.UTC(2026, 9, 20, 9, 0);
const houseDate = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(ts); // the house's day, not UTC's
const PORT = 8786, MOCK = 8784;
const d1 = (sql) => JSON.parse(execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --json --command "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^[^[]*/, ''))[0].results;
rmSync(STATE, { recursive: true, force: true });
execSync(`npx wrangler d1 migrations apply shuki --local --persist-to ${STATE}`, { stdio: 'ignore' });
execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --file test/fixture-house.sql`, { stdio: 'ignore' });
d1(`INSERT INTO pairing_codes (code, user_id, expires) VALUES ('481516', 1, 9999999999999), ('234234', 2, 9999999999999)`);

const script = []; const calls = [];
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { const b = Buffer.concat(parts).toString('utf8'); // bytes first: a Hebrew letter can be split between chunks (question 29)

  calls.push(JSON.parse(b));
  const input = script.shift() || { reply: 'ok', face: 'happy' };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'tool_use', id: 'tu1', name: 'respond', input }], usage: { input_tokens: 100, output_tokens: 10 } }));
}); }).listen(MOCK);
const dev = spawn('npx', ['wrangler', 'dev', '--local', '--test-scheduled', '--port', String(PORT), '--persist-to', STATE, '--var', `ANTHROPIC_URL:http://127.0.0.1:${MOCK}/v1/messages`, '--var', 'ANTHROPIC_API_KEY:t', '--var', `FIXED_NOW:${NOW}`], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = ''; dev.stdout.on('data', (d) => (log += d)); dev.stderr.on('data', (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
const call = async (t, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', 'x-levels': '21', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const txt = await r.text(); let data = null; try { data = JSON.parse(txt); } catch { /* text */ } return { status: r.status, data, text: txt, headers: r.headers }; };
const state = async (t) => (await call(t, 'GET', '/api/state')).data;
const results = [];
async function check(id, name, fn) {
  try { const note = await fn(); results.push({ id, name, ok: true, note: note || '' }); console.log('✓', id, name, note ? `— ${note}` : ''); }
  catch (e) { results.push({ id, name, ok: false, error: e.message.slice(0, 400) }); console.log('✗', id, name, '\n   ', e.message.slice(0, 400)); }
}
const DAY = 86400e3;
const SUB = { endpoint: 'https://push.example.com/x', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } };
const act = (t, actions, extra = {}) => call(t, 'POST', '/api/actions', { actions, op_id: `op-${Math.random()}`, ...extra });
const hourNow = () => +new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', hour: 'numeric', hourCycle: 'h23' }).format(NOW);
const tick = async () => { const n = log.length; await fetch(`${base}/__scheduled?cron=0+*+*+*+*`); await new Promise((r) => setTimeout(r, 1500)); const m = log.slice(n).match(/schedule \S+ (\{.*\})/); return m ? JSON.parse(m[1]) : null; };
const P = (s, name) => s.products.find((p) => p.name === name);

let avi, michal;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  avi = (await call(null, 'POST', '/api/pair', { code: '481516' })).data.token;
  michal = (await call(null, 'POST', '/api/pair', { code: '234234' })).data.token;
  // the hello bubbles of a new phone go a second or two "later" (now + 1500…); on a fixed clock later never comes, and they would
  // stay after every message of the test: they were sent before, as in a real house
  d1(`UPDATE chat SET ts = ts - ${DAY}`);
  await call(avi, 'POST', '/api/push/subscribe', { subscription: { ...SUB, endpoint: 'https://push.example.com/avi' } });
  await call(michal, 'POST', '/api/push/subscribe', { subscription: { ...SUB, endpoint: 'https://push.example.com/michal' } });
  await act(avi, [
    { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 2, is_basic: 1, target: 2, shelf_days: 7, open_days: 4, category_id: 'מוצרי חלב, גבינות וביצים', location_id: 'מקרר' } },
    { kind: 'create', product: { name: 'טונה', count_type: 'units', unit: 'קופסה', qty: 4, is_basic: 1, target: 2, location_id: 'מזווה' } },
    { kind: 'create', product: { name: 'במבה', count_type: 'units', unit: 'שקית', qty: 3, location_id: 'מזווה' } },
    { kind: 'create', product: { name: 'פסטה', count_type: 'units', unit: 'שקית', qty: 2, location_id: 'מזווה' } },
    { kind: 'create', product: { name: 'עגבניות', count_type: 'level', level: 'plenty', location_id: 'מקרר' } },
    { kind: 'create', product: { name: 'סבון כלים', count_type: 'inuse', is_open: 1, qty: 1, is_basic: 1, target: 1, location_id: 'ארון ניקיון' } },
    { kind: 'create', product: { name: 'ביצים', count_type: 'pack', pack_size: 12, qty: 0, is_basic: 1, target: 12, location_id: 'מקרר' } },
  ]);

  await check('M2', 'ספירה חוזרת: שבוע אחרי, בשעת הסיכום, נבחרים 3–5 מוצרים; "כן" ו"תקן" מורידים מהרשימה', async () => {
    await call(avi, 'POST', '/api/settings', { digest_hour: hourNow() });
    d1(`UPDATE products SET updated = updated - ${10 * DAY}, created = created - ${10 * DAY}`);
    let r = await tick(); // first run only starts the clock
    assert.equal((await state(avi)).recount.length, 0, 'nothing in the first week');
    d1(`UPDATE settings SET value = '${NOW - 8 * DAY}' WHERE key = 'recount_at'`);
    d1(`UPDATE devices SET digest_sent = NULL`);
    r = await tick();
    assert.ok(r?.recount >= 3, `recount picked: ${JSON.stringify(r)}\n${log.slice(-600)}`);
    let s = await state(michal);
    assert.ok(s.recount.length >= 3 && s.recount.length <= 5);
    assert.ok(!s.recount.includes(P(s, 'ביצים').id), 'out of eggs: nothing to recount');
    const [a, b] = s.recount;
    await act(michal, [{ kind: 'confirm', product_id: a }]);
    await act(avi, [{ kind: 'op', product_id: b, op: { type: 'set', qty: 1 } }]);
    s = await state(avi);
    assert.ok(!s.recount.includes(a) && !s.recount.includes(b), 'answered ones are gone, for both');
    assert.equal(s.journal[0].summary.includes('תיקן') || s.journal[1].summary.includes('אישרה'), true);
    const again = await tick();
    assert.ok(!again?.recount, 'not twice the same week');
    return `${s.recount.length + 2} נבחרו, 2 נענו`;
  });

  await check('M3', 'סירי: מפתח לקיצורי דרך; מדבר רק עם שוקי; תשובה בטקסט; הצעה → התראה לטלפון שלי', async () => {
    const key = (await call(avi, 'POST', '/api/shortcut/token')).data.token;
    assert.match(key, /^[0-9a-f]{64}$/);
    assert.equal((await call(key, 'GET', '/api/state')).status, 403, 'a Siri key cannot read the house');
    assert.equal((await call(key, 'POST', '/api/actions', { actions: [{ kind: 'op', product_id: 1, op: { type: 'out' } }] })).status, 403);
    const s = await state(avi);
    script.push({ reply: 'לסמן שנגמר החלב?', face: 'neutral', actions: [{ kind: 'op', product_id: P(s, 'חלב 3%').id, op: { type: 'out' } }] });
    const r = await call(key, 'POST', '/api/say', { text: 'נגמר החלב' });
    assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/plain/);
    assert.equal(r.text, 'לסמן שנגמר החלב? ההצעה מחכה לאישור שלך באפליקציה.');
    assert.equal(r.headers.get('x-shuki-pushed'), '1', 'my phone gets "האם לאשר?"');
    assert.equal(calls.at(-1).messages.at(-1).content.includes('אבי: נגמר החלב'), true, 'same chat as the app');
    assert.equal(P(await state(avi), 'חלב 3%').qty, 2, 'nothing changed before approval');
    const chat = (await call(avi, 'GET', '/api/chat')).data.messages;
    // Shuki's last message (a journal row of an earlier check has the same time on the fixed clock, and sorts after it)
    assert.equal(chat.filter((m) => m.role === 'shuki').at(-1).content.status, 'pending', 'the card waits in the chat');
    const shop = await call(key, 'POST', '/api/shortcut/shop', { store: 'super' });
    assert.match(shop.text, /^פתחתי מצב קניות בסופר\. ברשימה: /);
    assert.equal((await state(michal)).shopping[0]?.name, 'אבי', 'arriving opens the trip; Michal sees it');
    assert.equal((await call(key, 'POST', '/api/say', { text: '' })).text, 'לא שמעתי כלום. האם אפשר לנסות שוב?');
    const key2 = (await call(avi, 'POST', '/api/shortcut/token')).data.token;
    assert.equal((await call(key, 'POST', '/api/say', { text: 'x' })).status, 401, 'a new key retires the old one');
    assert.equal((await state(avi)).me.name, 'אבי', 'the phone itself stays paired');
    return `${shop.text} | ${key2.slice(0, 6)}…`;
  });

  await check('M4', 'סיכום אחרי קנייה: מהרשימה / מחוץ לרשימה / נשאר ברשימה, גם בהתראה למיכל', async () => {
    let s = await state(avi);
    await act(michal, [{ kind: 'list_add', text: 'נייר אפייה', store: 'super' }]);
    s = await state(avi);
    const eggs = s.list.find((i) => i.product_id === P(s, 'ביצים').id);
    await act(avi, [{ kind: 'check', item_id: eggs.id, amount: 1 }], { context: 'shopping' });
    script.push({ reply: 'לעדכן שקנית במבה?', face: 'happy', actions: [{ kind: 'op', product_id: P(s, 'במבה').id, op: { type: 'purchase', amount: 2 } }] });
    const c = (await call(avi, 'POST', '/api/chat', { text: 'קניתי במבה' })).data;
    await call(avi, 'POST', `/api/proposals/${c.proposal.id}/apply`, {});
    const r = (await act(avi, [{ kind: 'finish', store: 'super' }], { context: 'shopping' })).data;
    assert.deepEqual(r.trip.bought, ['ביצים']);
    assert.deepEqual(r.trip.offList, ['במבה']);
    assert.ok(r.trip.forgot.includes('נייר אפייה'), JSON.stringify(r.trip));
    const n = r.notify.find((x) => x.to === 'מיכל');
    assert.match(n.body, /מהרשימה: ביצים\. מחוץ לרשימה: במבה\. נשאר ברשימה: .*נייר אפייה/);
    assert.equal((await state(avi)).shopping.length, 0, 'trip closed');
    return n.body;
  });

  await check('M4b', 'סיכום גם בלי מצב קניות: "סיימתי קנייה" לבד', async () => {
    let s = await state(avi);
    const it = s.list.find((i) => i.text === 'נייר אפייה');
    await act(michal, [{ kind: 'check', item_id: it.id }], { context: 'shopping' });
    const r = (await act(michal, [{ kind: 'finish', store: 'super' }], { context: 'shopping' })).data;
    assert.deepEqual(r.trip.bought, ['נייר אפייה']);
    return r.notify[0]?.body;
  });

  await check('M5', 'אזהרה כשמוסיפים משהו שיש: המודל אומר כמה יש (ההנחיה נשלחת)', async () => {
    assert.match(calls.at(-1).system[0].text, /יש עוד 3 במזווה\. האם להוסיף בכל זאת\?/);
    return 'באפליקציה: test/more-ui.cjs';
  });

  await check('M6', '"נחשוב על זה": נכנס, אחרי 48 שעות שואל פעם אחת; לרשימה / ויתרנו; ספירת ויתורים', async () => {
    await call(michal, 'POST', '/api/maybe', { text: 'מכונת קפה' });
    await call(avi, 'POST', '/api/maybe', { text: 'במבה', product_id: (P(await state(avi), 'במבה')).id });
    let s = await state(avi);
    assert.equal(s.maybe.length, 2); assert.ok(s.maybe.every((m) => !m.due));
    d1(`UPDATE maybe SET added = added - ${49 * 3600e3}`);
    d1(`UPDATE devices SET digest_sent = NULL`);
    const r = await tick();
    assert.equal(r?.maybeAsked, 2, JSON.stringify(r));
    assert.equal((await tick())?.maybeAsked, undefined, 'asked once');
    s = await state(avi);
    assert.ok(s.maybe.every((m) => m.due));
    const coffee = s.maybe.find((m) => m.text === 'מכונת קפה'), bamba = s.maybe.find((m) => m.text === 'במבה');
    await call(michal, 'POST', '/api/maybe', { id: coffee.id, decision: 'drop' });
    await call(avi, 'POST', '/api/maybe', { id: bamba.id, decision: 'list' });
    s = await state(avi);
    assert.equal(s.maybe.length, 0); assert.equal(s.maybeDroppedThisMonth, 1);
    assert.ok(s.list.some((i) => i.product_id === P(s, 'במבה').id && i.status === 'open'), 'במבה went to the list');
    assert.equal((await call(avi, 'POST', '/api/maybe', { id: coffee.id, decision: 'list' })).status, 404, 'decided once');
    return 'ויתרנו על 1';
  });

  await check('M7', 'תוקף אחרי פתיחה: "פתחנו חלב" → 4 ימים, קנייה חדשה לא מסתירה; בחיפוש של שוקי: "פתוח"', async () => {
    let s = await state(avi);
    const milk = P(s, 'חלב 3%');
    await act(avi, [{ kind: 'op', product_id: milk.id, op: { type: 'purchase', amount: 2 } }]);
    await act(avi, [{ kind: 'op', product_id: milk.id, op: { type: 'open' } }]);
    s = await state(avi);
    const m = P(s, 'חלב 3%');
    assert.ok(m.opened); const days = (m.next_expiry - NOW) / DAY;
    assert.ok(days > 3.9 && days <= 4, `expires in ${days}`);
    await act(avi, [{ kind: 'op', product_id: milk.id, op: { type: 'purchase', amount: 1 } }]);
    assert.ok((P(await state(avi), 'חלב 3%').next_expiry - NOW) / DAY <= 4, 'still the opened one');
    d1(`UPDATE products SET expires = ${NOW + DAY} WHERE name = 'חלב 3%'`);
    s = await state(avi);
    assert.ok(s.expiring.some((x) => x.name === 'חלב 3%'), 'the evening reminder sees it');
    script.push({ reply: 'יש', face: 'happy' });
    await call(avi, 'POST', '/api/chat', { text: 'יש חלב?' });
    assert.match(calls.at(-1).system[2].text, /חלב 3%\|[^\n]*\(פתוח מ-/);
    return 'פג בעוד 4 ימים';
  });

  await check('M8', 'חופשה: "אנחנו בחו״ל עד…" מהצ\'אט; אין תזכורות; "חזרנו" מבטל', async () => {
    const until = houseDate(NOW + 5 * DAY);
    script.push({ reply: 'חופשה נעימה!', face: 'happy', away: { until } });
    // c12 (r0t trim): asked first, kept only after "yes"
    const [, mm, dd] = until.split('-').map(Number);
    assert.equal((await call(michal, 'POST', '/api/chat', { text: `אנחנו בחו"ל עד ${until}` })).data.reply, `האם להפעיל מצב חופשה עד ה-${dd}.${mm}?`);
    assert.equal((await state(avi)).away, null, 'not before the yes');
    assert.equal((await call(michal, 'POST', '/api/chat', { text: 'כן, להפעיל' })).data.reply, 'סגור!'); // the button (r0t-6)
    let s = await state(avi);
    assert.ok(s.away?.now, 'away now'); assert.ok(s.away.end > NOW + 4 * DAY);
    d1(`UPDATE devices SET digest_sent = NULL`);
    const r = await tick();
    assert.equal(r?.away, true, `no reminders: ${JSON.stringify(r)}`);
    script.push({ reply: 'ברוכים השבים', face: 'excited', away: { end: true } });
    await call(avi, 'POST', '/api/chat', { text: 'חזרנו' });
    assert.match(calls.at(-1).system[3].text, /חופשה: הבית בחופשה עד/, 'the next message knows the house is away');
    s = await state(avi);
    assert.equal(s.away, null);
    // learning skips those days: two cycles, one across the vacation → not enough to learn
    const pid = P(s, 'פסטה').id; const t0 = NOW - 40 * DAY;
    d1(`DELETE FROM product_log WHERE product_id = ${pid}`);
    d1(`INSERT INTO product_log (event_id, ts, product_id, kind) VALUES (1, ${t0}, ${pid}, 'purchase'), (1, ${t0 + 5 * DAY}, ${pid}, 'out'), (1, ${t0 + 6 * DAY}, ${pid}, 'purchase'), (1, ${t0 + 26 * DAY}, ${pid}, 'out')`);
    assert.equal(P(await state(avi), 'פסטה').learned?.every, 12.5, 'without a vacation on record: (5+20)/2');
    d1(`INSERT INTO away (start, end) VALUES (${t0 + 8 * DAY}, ${t0 + 22 * DAY})`);
    assert.equal(P(await state(avi), 'פסטה').learned, null, 'with it, the 20-day cycle is ignored');
    await call(avi, 'POST', '/api/away', { until: houseDate(NOW + 3 * DAY) });
    assert.ok((await state(avi)).away?.now, 'from settings too');
    await call(avi, 'POST', '/api/away', { until: null });
    assert.equal((await state(avi)).away, null);
    assert.equal((await call(avi, 'POST', '/api/away', { until: '2020-01-01' })).status, 400);
    return 'ok';
  });
  await check('M9', 'שוקי לכל אחד: רמה מהימים שלי, ארון משלי; עלייה ברמה מלבישה את החדש; אי אפשר ללבוש מה שנעול', async () => {
    const xp = (t) => state(t).then((s) => s.growth);
    // points are days since 16/10: Michal's updates of today go to one day long ago, and she gets one more day of her own
    let back = 100;
    const bulk = (n) => { if (n > 0) d1(`INSERT INTO events (id, ts, user_id, type, summary) SELECT -(${back} + k), ${NOW} - (${back} + k) * 86400000, 2, 'edit', 'x' FROM (WITH RECURSIVE c(k) AS (SELECT 1 UNION ALL SELECT k+1 FROM c WHERE k < ${n}) SELECT k FROM c)`); back += (n || 0) + 1; };
    d1(`UPDATE events SET ts = ts - 3000 * 86400000 WHERE user_id = 2 AND ts > ${Math.min(NOW, Date.now()) - 20 * 3600e3}`); bulk(1); // the server writes by the real clock
    const [go, gn] = [await xp(avi), await xp(michal)];
    assert.notEqual(go.xp, gn.xp, `each his own: ${go.xp} vs ${gn.xp}`);
    const s = await state(michal);
    const before = gn.xp;
    await act(michal, [{ kind: 'op', product_id: P(s, 'טונה').id, op: { type: 'use', amount: 1 } }]);
    assert.equal((await xp(michal)).xp, before + 1); assert.equal((await xp(avi)).xp, go.xp, "Michal's update doesn't grow Avi's Shuki");
    // push Michal to level 9 (80 days): the mustache goes on by itself, the rest stays as she chose
    bulk(60 - (await xp(michal)).xp); // level 8: bow, glasses, band
    assert.deepEqual((await state(michal)).outfit, { neck: 'bow', eyes: 'glasses', head: 'band' });
    await call(michal, 'POST', '/api/outfit', { wear: { neck: 'bow' } }); // she took off the glasses and the band
    const need = 80 - (await xp(michal)).xp;
    bulk(need);
    let n = await state(michal);
    assert.equal(n.growth.level, 9); assert.equal(n.growth.name, 'מומחה המזווה'); assert.equal(n.growth.next, 'עיפרון מאחורי האוזן');
    assert.deepEqual(n.outfit, { neck: 'bow', mouth: 'mustache' });
    // locked or in the wrong spot: dropped
    const r = (await call(michal, 'POST', '/api/outfit', { wear: { head: 'crown', eyes: 'glasses', neck: 'glasses' } })).data;
    assert.deepEqual(r.wear, { eyes: 'glasses' });
    assert.deepEqual((await state(michal)).outfit, { eyes: 'glasses' });
    assert.notDeepEqual((await state(avi)).outfit, { eyes: 'glasses' }, "Avi's closet is his own");
    return `מיכל רמה ${n.growth.level}, אבי רמה ${(await xp(avi)).level}`;
  });
} finally {
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} more checks passed`);
  (await import('node:fs')).writeFileSync('test/more-results.json', JSON.stringify(results, null, 1));
  try { process.kill(-dev.pid, 'SIGKILL'); } catch { /* gone */ }
  mock.close();
  process.exit(ok === results.length ? 0 : 1);
}
