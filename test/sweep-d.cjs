// Sweep D: offline, two phones, stale sessions, double taps, big houses. Run: test/ui-qa.sh test/sweep-d.cjs
const { chromium } = require(process.env.PW);
const hold = async (p, sel) => { const b = await p.waitForSelector(sel); const box = await b.boundingBox(); await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.waitForTimeout(750); await p.mouse.up(); await p.waitForTimeout(300); }; // a long press (decision 171)
const lib = require('./sweep-lib.cjs');
const { d1, check, ok, phone, finish } = lib;
(async () => {
  const b = await chromium.launch();
  const p = await phone(b);
  const n = await phone(b, { user: 2 }); lib.shotPage = p;
  await p.api('POST', '/api/actions', { actions: [
    { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 0, is_basic: 1, target: 1 } },
    { kind: 'create', product: { name: 'עגבניות', count_type: 'level', level: 'none', is_basic: 1, store: 'greengrocer', store2: 'super' } },
    { kind: 'create', product: { name: 'יוגורט', count_type: 'units', qty: 3, shelf_days: 10 } },
  ] });
  const P = async (name, ph = p) => (await ph.state()).products.find((x) => x.name === name);
  await p.go('#list'); await p.reload2();
  await check('D1', 'בלי קליטה: פותחים מחדש את האפליקציה → הרשימה מהטלפון, ואפשר לסמן', async () => {
    await p.ctx.setOffline(true); await p.reload().catch(() => {}); await p.waitForTimeout(500);
    if (!(await p.$('#main'))) return 'דורש service worker (נבדק ב-X4b)';
    await p.click('.item:has-text("חלב")'); await p.waitForTimeout(300);
  });
  await p.ctx.setOffline(false); await p.goto(lib.BASE + '/#list'); await p.waitForTimeout(900);
  await check('D2', 'פעולות מבלי קליטה נשמרות גם אחרי סגירת האפליקציה, ונשלחות כשחוזרת קליטה', async () => {
    await p.ctx.setOffline(true); await p.evaluate(() => window.dispatchEvent(new Event('offline')));
    await p.click('.item:has-text("עגבניות")'); await p.waitForTimeout(400);
    ok((await p.evaluate(() => JSON.parse(localStorage.getItem('shuki.queue') || '[]').length)) >= 1, 'not queued');
    await p.ctx.setOffline(false); await p.reload(); await p.waitForTimeout(2500);
    const s = await p.state(); ok(s.list.find((i) => i.product_id === s.products.find((x) => x.name === 'עגבניות').id)?.status === 'checked', 'lost');
  });
  await check('D3', 'לחיצה כפולה מהירה על "לעגלה" → קנייה אחת', async () => {
    await hold(p, '.item:not(.done):has-text("חלב")'); await p.waitForSelector('#ok');
    await p.evaluate(() => { const b = document.querySelector('#ok'); b.click(); b.click(); }); await p.waitForTimeout(1200); ok((await P('חלב 3%')).qty === 1, `qty ${(await P('חלב 3%')).qty}`);
  });
  await check('D4', 'שני טלפונים מסמנים את אותו פריט באותו רגע → נספר פעם אחת', async () => {
    await p.api('POST', '/api/actions', { actions: [{ kind: 'op', product_id: (await P('יוגורט')).id, op: { type: 'out' } }] });
    const s = await p.state(); const it = s.list.find((i) => i.product_id === s.products.find((x) => x.name === 'יוגורט').id); ok(it, 'yogurt not listed');
    await Promise.all([p.api('POST', '/api/actions', { actions: [{ kind: 'check', item_id: it.id, amount: 2 }], op_id: 'a1' }), n.api('POST', '/api/actions', { actions: [{ kind: 'check', item_id: it.id, amount: 2 }], op_id: 'a2' })]);
    ok((await P('יוגורט')).qty === 2, `qty ${(await P('יוגורט')).qty}`);
  });
  await check('D5', '"בטל" אחרי שהשני שינה את אותו מוצר → הסבר, לא דורס', async () => {
    const id = (await P('יוגורט')).id; await p.api('POST', '/api/actions', { actions: [{ kind: 'op', product_id: id, op: { type: 'set', qty: 7 } }] });
    await n.api('POST', '/api/actions', { actions: [{ kind: 'op', product_id: id, op: { type: 'set', qty: 1 } }] });
    const r = await p.api('POST', '/api/undo'); ok(r.error || r.conflict, JSON.stringify(r)); ok((await P('יוגורט')).qty === 1, 'overwrote Michal'); return r.error || r.conflict;
  });
  await check('D6', 'טלפון שנותק מהטלפון השני → מסך צימוד עם הסבר, בלי לולאה', async () => {
    const x = await phone(b); const devs = (await p.api('GET', '/api/devices')).devices; const mine = devs.filter((d) => d.who === 'אבי' && !d.mine).pop();
    await p.api('DELETE', `/api/devices/${mine.id}`); lib.shotPage = x; await x.reload(); await x.waitForTimeout(1200);
    ok(await x.$('#code'), 'not on pairing'); ok(!x.errors.length, x.errors.join()); await x.ctx.close(); lib.shotPage = p;
  });
  await check('D7', 'ירקן עם "אפשר גם בסופר" → "גם מכאן" בסופר, וסימון שם עובד', async () => {
    await p.api('POST', '/api/actions', { actions: [{ kind: 'finish' }], context: 'shopping' });
    await p.api('POST', '/api/actions', { actions: [{ kind: 'op', product_id: (await P('עגבניות')).id, op: { type: 'out' } }] });
    await p.go('#list'); await p.reload2(); const also = await p.$('.also .item:has-text("עגבניות")');
    ok(also, 'no "גם מכאן" in super');
    await also.click(); await p.waitForTimeout(800); ok(await p.$('.item.done:has-text("עגבניות")'), 'not checked from super');
  });
  await check('D8', '"עומד להיגמר" → "לרשימה" מוסיף', async () => {
    const id = (await P('יוגורט')).id; const now = Date.now();
    for (const [d, k] of [[6, 'purchase'], [4, 'out'], [4, 'purchase'], [2, 'out'], [2, 'purchase']]) d1(`INSERT INTO product_log (event_id, ts, product_id, kind) VALUES (0, ${now - d * 864e5}, ${id}, '${k}')`);
    await p.go('#list'); await p.reload2(); const btn = await p.$('[data-soon]'); ok(btn, `no "עומד להיגמר" (${JSON.stringify((await p.state()).soon)})`); await btn.click(); await p.waitForTimeout(900);
    ok((await p.state()).list.some((i) => i.product_id === id && i.status === 'open'), 'not added');
  });
  await check('D9', 'הצעה ישנה (13 שעות) → "ישנה מדי", לא נשמרת', async () => {
    await p.go('#chat'); await p.fill('#say', 'נגמר החלב'); await p.click('#send'); await p.waitForSelector('.coupon.pending'); d1(`UPDATE proposals SET created = created - ${13 * 3600e3}`);
    await p.click('.coupon.pending [data-do=apply]'); await p.waitForTimeout(1200); ok(await p.$('.coupon.expired'), 'no expired stamp');
  });
  await check('D10', 'בית עם 200 מוצרים: המלאי נפתח מהר, בלי גלילה לצדדים', async () => {
    const acts = Array.from({ length: 200 }, (_, i) => ({ kind: 'create', product: { name: `מוצר ${i + 1}`, count_type: 'units', qty: i % 4 } }));
    await p.api('POST', '/api/actions', { actions: acts }); await p.reload2(); const t0 = Date.now(); await p.go('#inventory'); await p.waitForSelector('.fr:has-text("מוצר 200")');
    const ms = Date.now() - t0; ok(ms < 2500, `${ms}ms`); ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sideways');
    await p.fill('#invQ', 'מוצר 17'); await p.waitForTimeout(200); ok((await p.$$('.fr')).length >= 1, 'search'); await p.fill('#invQ', ''); return `${ms}ms`;
  });
  await check('D11', 'כתובת לא מוכרת (#xyz) → נפתח הצ\'אט', async () => { await p.goto(lib.BASE + '/#xyz'); await p.waitForTimeout(900); ok(await p.$('#say'), 'blank screen'); });
  await check('D12', 'טוקן פגום בטלפון → מסך צימוד', async () => {
    const x = await phone(b); await x.evaluate(() => localStorage.setItem('shuki.token', JSON.stringify('f'.repeat(64)))); lib.shotPage = x; await x.reload(); await x.waitForTimeout(1200);
    ok(await x.$('#code'), 'not pairing'); await x.ctx.close(); lib.shotPage = p;
  });
  await check('D13', 'המספר בלשונית "רשימה" = פריטים פתוחים', async () => {
    await p.go('#list'); const s = await p.state(); const open = s.list.filter((i) => i.status === 'open').length; const t = await p.textContent('.nav a[href="#list"]');
    ok(open ? t.includes(open === 1 ? '(מוצר אחד)' : `(${open} מוצרים)`) : !/\(/.test(t), `${t} vs ${open}`); // round 21: "how many of what"
  });
  await check('D14', 'עלייה ברמה: הודעה פעם אחת, לא שוב אחרי רענון', async () => {
    d1(`INSERT INTO events (id, ts, user_id, type, summary) SELECT -(700 + k), ${Date.now()} - (700 + k) * 86400000, 1, 'edit', 'x' FROM (WITH RECURSIVE c(k) AS (SELECT 1 UNION ALL SELECT k+1 FROM c WHERE k < 60) SELECT k FROM c)`); // 60 days (points are days since 16/10)
    await p.reload2(); await p.waitForTimeout(600); await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(1500);
    const seen = await p.evaluate(() => localStorage.getItem('shuki.seenGrowth')); ok(+seen >= 60, `seen ${seen}`); // in points since stage 10: 60 updates more, at least level 8 (60)
    await p.reload2(); await p.waitForTimeout(1500); ok(!(await p.$('.toast:has-text("גדלתי")')), 'again after reload');
  });
  await check('JS', 'אין שגיאות JavaScript', async () => ok(!p.errors.length && !n.errors.length, [...p.errors, ...n.errors].join(' | ')));
  await finish(b, 'test/sweep-d-results.json');
})();
