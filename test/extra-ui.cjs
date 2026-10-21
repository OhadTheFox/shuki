// Extra UI checks (X4 offline cold start, X6 narrow phone, X10 push flow, X14 Hebrew search).
// Run: test/ui-qa.sh test/extra-ui.cjs
const { chromium } = require(process.env.PW);
const BASE = process.env.BASE || 'http://127.0.0.1:8791';
const results = [];
const check = async (id, name, fn) => {
  try { const note = await fn(); results.push({ id, name, ok: true, note: note || '' }); console.log('✓', id, name, note ? `— ${note}` : ''); }
  catch (e) { results.push({ id, name, ok: false, error: e.message.split('\n')[0] }); console.log('✗', id, name, '\n   ', e.message.split('\n')[0]); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['notifications'] }); // service workers ON
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(BASE + '/');
  await p.fill('#code', '111111'); await p.click('#pair button[type=submit]'); await p.waitForSelector('#say');
  // catalog through the fake Claude
  await p.fill('#say', 'מתחילים מהמקרר, הכל קבוע'); await p.click('#send'); await p.waitForSelector('.coupon.pending');
  await p.click('.coupon [data-do=apply]'); await p.waitForSelector('.coupon.applied'); await p.waitForTimeout(800);
  await p.evaluate(() => navigator.serviceWorker.ready); await p.waitForTimeout(800);

  await check('X4', 'פתיחה מאפס בלי קליטה: האפליקציה והרשימה נטענות מהמכשיר', async () => {
    await p.goto(BASE + '/#list'); await p.waitForSelector('.item'); await p.waitForTimeout(500);
    await ctx.setOffline(true);
    await p.reload(); await p.waitForSelector('.item', { timeout: 8000 });
    ok((await p.textContent('.band')).includes('אין קליטה'), 'offline chip after cold start');
    const n = await p.$$eval('.item', (l) => l.length);
    await p.screenshot({ path: '/tmp/shuki-test/x4-offline-cold.png' });
    const fontOk = await p.evaluate(() => document.fonts.check('700 20px Karantina'));
    await ctx.setOffline(false);
    ok(fontOk, 'display font available offline');
    return `${n} פריטים נטענו בלי רשת`;
  });

  await check('X4b', 'בלי קליטה, מההתחלה: גם הארון (wardrobe.js) נטען מהמכשיר, והמטמון הוא של הגרסה הנוכחית', async () => {
    await ctx.setOffline(true);
    await p.goto(BASE + '/#settings'); await p.reload(); await p.waitForSelector('#closetGo', { timeout: 8000 });
    await p.click('#closetGo'); await p.waitForSelector('.closet-prev svg');
    const keys = await p.evaluate(() => caches.keys());
    const sw = require('fs').readFileSync(__dirname + '/../public/sw.js', 'utf8').match(/VERSION = '(v\d+)'/)[1];
    ok(keys.includes(`shuki-${sw}`) && keys.length === 1, `caches: ${keys.join(',')} (expected only shuki-${sw})`);
    await p.click('.sheet [data-close]'); await ctx.setOffline(false);
    return keys.join(',');
  });

  await check('X14', 'חיפוש בעברית: "העגבניות" מוצא "עגבניות" במלאי וברשימה', async () => {
    await p.goto(BASE + '/#inventory'); await p.waitForSelector('#invQ');
    await p.fill('#invQ', 'העגבניות'); await p.waitForTimeout(300);
    ok((await p.$$('.fr')).length === 1, `inventory search found ${(await p.$$('.fr')).length}`);
    await p.fill('#invQ', ''); await p.waitForTimeout(200);
    await p.goto(BASE + '/#list'); await p.waitForSelector('#addTxt');
    await p.fill('#addTxt', 'הגבינה'); await p.waitForTimeout(300);
    ok(await p.$('#sugg .chip'), 'list autocomplete with ה');
  });

  await check('X10', 'התראות: הפעלה שולחת מנוי לשרת, והודעת פוש מוצגת כהתראה', async () => {
    await p.goto(BASE + '/#settings'); await p.waitForSelector('#pushOn');
    await p.evaluate(() => {
      Notification.requestPermission = async () => 'granted';
      PushManager.prototype.subscribe = async () => ({ toJSON: () => ({ endpoint: 'https://push.example.com/x1', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } }) });
    });
    await p.click('#pushOn'); await p.waitForSelector('.toast');
    const msg = await p.textContent('.toast');
    ok(/פועלות/.test(msg), `toast: ${msg}`);
    // the service worker's push handler, run in a sandbox with a fake registration
    const vm = require('vm'); const shown = []; const handlers = {};
    const sandbox = { self: { addEventListener: (t, f) => (handlers[t] = f), registration: { showNotification: async (title, opts) => shown.push({ title, ...opts }) }, skipWaiting() {}, clients: {} }, caches: {}, location: { origin: BASE }, URL, fetch };
    vm.runInNewContext(require('fs').readFileSync(__dirname + '/../public/sw.js', 'utf8'), sandbox);
    let waited; handlers.push({ data: { json: () => ({ title: 'שוקי: פג בקרוב', body: 'חלב, קוטג', url: './#inventory' }) }, waitUntil: (pr) => (waited = pr) });
    await waited;
    ok(shown[0]?.title === 'שוקי: פג בקרוב' && shown[0].body === 'חלב, קוטג' && shown[0].data.url === './#inventory' && shown[0].dir === 'rtl', JSON.stringify(shown));
    return msg.trim();
  });

  await check('X6', 'מסך צר (320px) ושם מוצר ארוך: אין גלילה לצדדים באף מסך', async () => {
    await p.setViewportSize({ width: 320, height: 640 });
    await p.goto(BASE + '/#inventory'); await p.waitForSelector('#addP');
    await p.click('#addP'); await p.fill('#f-name', 'רוטב עגבניות מבושל ברוטב פסטו של סבתא עם בזיליקום ושום קלוי במיוחד'); await p.click('#save'); await p.waitForTimeout(900);
    const wide = [];
    for (const r of ['chat', 'list', 'inventory', 'settings']) {
      await p.goto(`${BASE}/#${r}`); await p.waitForTimeout(500);
      const w = await p.evaluate(() => document.documentElement.scrollWidth);
      if (w > 322) wide.push(`${r}:${w}`);
      await p.screenshot({ path: `/tmp/shuki-test/x6-${r}.png` });
    }
    ok(!wide.length, `horizontal overflow: ${wide.join(' ')}`);
  });

  await check('JS', 'אין שגיאות JavaScript', async () => ok(!errors.length, errors.join(' | ')));
  require('fs').writeFileSync(__dirname + '/extra-ui-results.json', JSON.stringify(results, null, 1));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} extra UI checks passed`);
  await b.close();
  process.exitCode = results.every((r) => r.ok) ? 0 : 1; // stage 5: a failed check fails the run
})().catch((e) => { console.error(e); process.exit(1); });
