// UI QA in a phone-sized headless Chromium against `wrangler dev` + fake Claude (test/fake-claude.cjs).
// Run via test/ui-qa.sh. Prints one line per check; screenshots go to /tmp/shuki-test/qa-*.png
const { chromium } = require(process.env.PW);
const hold = async (p, sel) => { const b = await p.waitForSelector(sel); const box = await b.boundingBox(); await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.waitForTimeout(750); await p.mouse.up(); await p.waitForTimeout(300); }; // a long press (decision 171)
const BASE = process.env.BASE || 'http://127.0.0.1:8791';
const results = [];
const check = async (id, name, fn) => {
  try { await fn(); results.push({ id, name, ok: true }); console.log('✓', id, name); }
  catch (e) { results.push({ id, name, ok: false, error: e.message.split('\n')[0] }); console.log('✗', id, name, '\n   ', e.message.split('\n')[0]); }
};
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  const b = await chromium.launch();
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, userAgent: iphone, serviceWorkers: 'block', acceptDownloads: true });
  await ctx.addInitScript(() => { new MutationObserver(() => document.querySelectorAll('details.fold:not([data-t])').forEach((d) => { d.dataset.t = 1; d.open = true; })).observe(document, { childList: true, subtree: true }); }); // settings folds open (01/10)
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  const shot = (n) => p.screenshot({ path: `/tmp/shuki-test/qa-${n}.png` });
  const mood = () => p.$eval('.band .shuki', (s) => s.dataset.mood);
  const go = async (r) => { await p.evaluate((x) => { location.hash = x; }, r); await p.waitForTimeout(250); };
  const send = async (t) => { await p.fill('#say', t); await p.click('#send'); await p.waitForFunction(() => !document.querySelector('.msg.typing'), null, { timeout: 15000 }); await p.waitForTimeout(250); };

  await p.goto(BASE + '/');
  await check('1', 'צימוד: הסבר התקנה לאייפון ב-Safari, קוד שגוי מציג שגיאה, קוד נכון נכנס', async () => {
    await p.waitForSelector('#code');
    ok(await p.$('.howto'), 'iOS install hint shown');
    await p.fill('#code', '000000'); await p.click('#pair button[type=submit]'); await p.waitForSelector('#err:not([hidden])');
    ok((await p.textContent('#err')).length > 3, 'error text');
    await p.fill('#code', '111111'); await p.click('#pair button[type=submit]'); await p.waitForSelector('#say');
    await shot('01-chat-empty');
  });
  await check('E-empty', 'טלפון ראשון של מי שהצטרף: שלום קצר ומה שוקי עושה, בלי מיפוי (החלטה 168)', async () => {
    const t = await p.textContent('#thread'); ok(/היי אבי! אני שוקי/.test(t) && /נגמר החלב/.test(t), 'hello'); ok(!/נמפה|מי גר/.test(t), 'no first meeting');
  });
  await check('2', 'קטלוג: תלוש עם שורות, הורדת שורה, אישור → חותמת "עודכן במלאי"', async () => {
    await send('מתחילים מהמקרר: חלב, ביצים, גבינה צהובה, עגבניות, לחם, טונה, סבון כלים. הכל קבוע');
    await p.waitForSelector('.coupon.pending'); await shot('02-coupon');
    const n = await p.$$eval('.coupon li', (l) => l.length); eq(n, 7, 'lines');
    await p.click('.coupon li:nth-child(6) .tick'); // drop tuna
    ok(await p.$('.coupon li.off'), 'line marked off');
    await p.click('.coupon [data-do=apply]'); await p.waitForSelector('.coupon.applied');
    await p.waitForTimeout(600);
    const s = await p.evaluate(() => JSON.parse(localStorage.getItem('shuki.state')));
    ok(!s.products.find((x) => x.name === 'טונה בשמן'), 'dropped line not created'); eq(s.products.length, 6, 'products');
  });
  await check('13', 'ביטול מהטוסט אחרי אישור', async () => {
    await send('נגמר החלב'); await p.waitForSelector('.coupon.pending');
    await p.click('.coupon.pending [data-do=apply]'); await p.waitForSelector('.toast button');
    await p.waitForFunction(() => JSON.parse(localStorage.getItem('shuki.state')).products.find((x) => x.name === 'חלב 3%').qty === 0, null, { timeout: 5000 });
    await p.click('.toast button'); await p.waitForTimeout(1200);
    const s = await p.evaluate(() => JSON.parse(localStorage.getItem('shuki.state')));
    eq(s.products.find((x) => x.name === 'חלב 3%').qty, 1, 'milk restored');
  });
  await check('9', 'עמימות: כפתורים מתחת להודעה, לחיצה שולחת את הבחירה', async () => {
    await send('נגמרה הגבינה'); await p.waitForSelector('.chips .chip'); await shot('09-chips');
    await p.click('.chips .chip >> nth=0'); await p.waitForFunction(() => !document.querySelector('.msg.typing'));
    await p.waitForTimeout(300);
    ok((await p.$$eval('.msg.me', (m) => m.map((x) => x.textContent))).includes('גבינה צהובה'), 'choice sent as a message');
  });
  await check('24-ui', 'כפתור קבלה פותח בחירת תמונה', async () => {
    ok(await p.$('#photo[type=file][accept="image/*"]'), 'file input for photos');
  });

  // home18 (5): this house buys produce at the greengrocer (until it answers, the supermarket is first and nothing is "also from here")
  await p.evaluate(async () => { await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${JSON.parse(localStorage.getItem('shuki.token'))}` }, body: JSON.stringify({ shop_produce: 'greengrocer' }) }); });
  await p.reload(); await p.waitForTimeout(600);
  await go('#list');
  await check('18', 'רשימה: לשוניות חנות עם מספרים, "גם מכאן!" לעגבניות בסופר', async () => {
    await p.waitForSelector('.flaps'); await shot('18-list');
    ok(await p.$('.flap.on[data-store=super]'), 'super tab active');
    ok((await p.textContent('.also')).includes('עגבניות'), 'tomatoes under also-from-here');
  });
  await check('19', 'הוספה ידנית: השלמה אוטומטית ממוצרי הקטלוג, ודבר חדש נהיה מוצר (החלטה 185)', async () => {
    await p.fill('#addTxt', 'גבינ'); await p.waitForSelector('#sugg .chip');
    await p.fill('#addTxt', 'חלק לכיור'); await p.click('#adder button'); await p.waitForTimeout(1200);
    ok((await p.textContent('.listwrap')).includes('חלק לכיור'), 'added');
    ok(!(await p.$('.item:has-text("חלק לכיור") .oneoff')), 'a one-off, not a product');
  });
  await check('20', 'סימון: לחיצה ארוכה → חלון "כמה קניתם", מונה, לעגלה → מסומן (החלטה 171)', async () => {
    const first = await p.$('.item:not(.done)[data-item]');
    const name = await first.$eval('.nm', (n) => n.firstChild.textContent);
    await hold(p, `.item:not(.done)[data-item="${await first.getAttribute('data-item')}"]`); await p.waitForSelector('.sheet'); await shot('20-qty');
    await p.click('.stepper [data-d="1"]'); await p.click('#ok'); await p.waitForTimeout(900);
    ok(await p.$(`.item.done:has-text("${name}")`), 'item checked');
    { const bq = await p.$eval(`.item.done:has-text("${name}") .qty`, (q) => q.textContent); if (!/^2 [א-ת]+$/.test(bq)) throw new Error(`bought qty shown: ${bq}`); }
  });
  await check('20b', 'לחיצה על מסומן מבטלת סימון', async () => {
    const done = await p.$('.item.done'); await done.click(); await p.waitForTimeout(800);
    ok((await p.$$('.item.done')).length === 0, 'unchecked');
  });
  await check('29', 'אחרי רצף עדכונים שוקי צוחק עם אפרו', async () => {
    await p.evaluate(() => { window.__moods = []; new MutationObserver(() => { const s = document.querySelector('.band .shuki'); window.__moods.push(`${s.dataset.mood}${s.classList.contains('afro-on') ? '+afro' : ''}`); }).observe(document.querySelector('.band .shuki'), { attributes: true, attributeFilter: ['data-mood', 'class'] }); }); // the afro by afro-on since stage 10 (t7)
    for (let i = 0; i < 2; i++) { const it = await p.$('.item:not(.done)[data-item]'); await it.click(); if (await p.$('.sheet')) await p.click('#ok'); await p.waitForTimeout(700); }
    const it = await p.$('.item.done'); await it.click(); await p.waitForTimeout(700);
    const it2 = await p.$('.item:not(.done)[data-item]'); await it2.click(); if (await p.$('.sheet')) await p.click('#ok');
    await p.waitForTimeout(500);
    ok((await p.evaluate(() => window.__moods)).includes('laughing+afro'), `moods seen: ${await p.evaluate(() => window.__moods.join(','))}`); await shot('29-afro');
  });
  await check('22', 'סיימתי קנייה: המסומנים נעלמים, השאר נשארים', async () => {
    await p.waitForTimeout(2600);
    const before = await p.$$eval('.item:not(.done)', (l) => l.length);
    await p.click('#finish'); await p.waitForSelector('.receipt'); // since 26/09: a receipt of the trip
    ok(/מהרשימה/.test(await p.textContent('.receipt')), 'receipt lists what was bought'); await p.click('.sheet [data-close]'); await p.waitForTimeout(400);
    eq(await p.$$eval('.item.done', (l) => l.length), 0, 'no checked left');
    eq(await p.$$eval('.item:not(.done)', (l) => l.length), before, 'open items stay');
  });
  await check('21', 'בלי קליטה: סימון נשמר במכשיר, חותמת, נשלח כשחוזרים', async () => {
    await ctx.setOffline(true);
    const it = await p.$('.item:not(.done)[data-item]'); await it.click(); if (await p.$('.sheet')) await p.click('#ok');
    await p.waitForTimeout(500);
    ok((await p.textContent('.band')).includes('אין קליטה'), 'offline chip');
    ok(await p.$('.item.pending'), 'pending style'); await shot('21-offline');
    await ctx.setOffline(false); await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(1500);
    eq(await p.evaluate(() => JSON.parse(localStorage.getItem('shuki.queue') || '[]').length), 0, 'queue flushed');
  });

  await go('#inventory');
  await check('I1', 'מלאי: טבלת ערכים ביתיים, אחוז מהיעד, תג תוקף', async () => {
    await p.waitForSelector('.facts'); await shot('I1-inventory');
    ok((await p.textContent('.facts h3')) === 'מה יש בבית', 'title');
    ok((await p.$$('.fr .pct')).length >= 5, 'rows');
    ok(await p.$('.fr .exp'), 'expiry badge on cheese (2 days)');
  });
  await check('I2', 'מלאי: חיפוש ומעבר מיקום/קטגוריה', async () => {
    await p.fill('#invQ', 'חלב'); await p.waitForTimeout(300);
    eq(await p.$$eval('.fr', (l) => l.length), 1, 'search result');
    await p.fill('#invQ', ''); await p.waitForTimeout(200);
    await p.click('[data-mode=cat]'); await p.waitForTimeout(200);
    ok((await p.textContent('.facts')).includes('ירקות ופירות'), 'grouped by category');
    await p.click('[data-mode=loc]');
  });
  await check('12', 'עריכה: כל סוג ספירה מציג את השדות שלו; שמירה מעדכנת', async () => {
    await p.click('.fr:has-text("עגבניות")'); await p.waitForSelector('.sheet');
    ok(await p.$('#f-level'), 'level buttons for produce'); await p.click('[data-close]');
    await p.click('.fr:has-text("סבון כלים")'); await p.waitForSelector('.sheet');
    ok(await p.$('#f-open'), 'open switch for inuse'); await p.click('[data-close]');
    await p.click('.fr:has-text("ביצים")'); await p.waitForSelector('.sheet');
    ok(await p.$('#f-pack'), 'pack size for eggs'); await shot('12-edit');
    const before = await p.evaluate(() => JSON.parse(localStorage.getItem('shuki.state')).products.find((x) => x.name === 'ביצים L').qty);
    await p.click('.sheet [data-q="1"]'); await p.click('#save'); await p.waitForTimeout(900);
    const s = await p.evaluate(() => JSON.parse(localStorage.getItem('shuki.state')));
    eq(s.products.find((x) => x.name === 'ביצים L').qty, before + 1, 'eggs +1');
  });
  await check('11', 'זרקנו מהמלאי → שוקי בוכה רגע, ולא עצוב ליום (החלטה 131)', async () => {
    await p.click('.fr:has-text("לחם פרוס")'); await p.waitForSelector('.sheet');
    await p.click('#toss'); await p.waitForTimeout(1200);
    eq(await mood(), 'sad', 'the moment');
    await p.waitForTimeout(2500); // the reaction passes
    ok(await mood() !== 'sad', 'still sad');
  });
  await check('E3', 'מחיקה דורשת לחיצה שנייה', async () => {
    await p.click('#addP'); await p.waitForSelector('.sheet');
    await p.fill('#f-name', '<img src=x onerror="window.__xss=1">'); await p.click('#save'); await p.waitForTimeout(900);
    eq(await p.evaluate(() => window.__xss), undefined, 'no script from product names');
    await p.click('.fr:has-text("img src")'); await p.waitForSelector('.sheet');
    await p.click('#del'); ok(await p.$('.sheet'), 'first tap only arms');
    await p.click('#del'); await p.waitForTimeout(900);
    ok(!(await p.$('.fr:has-text("img src")')), 'deleted');
  });

  await go('#settings');
  await check('30-33', 'הגדרות: מיקום חדש, שינוי שם, קטגוריה חדשה, יומן, גיבוי', async () => {
    await p.waitForSelector('.set'); await shot('30-settings');
    await p.fill('#newLoc input', 'ארון נעליים'); await p.click('#newLoc button'); await p.waitForTimeout(800);
    ok(await p.$('[data-loc][value="ארון נעליים"]'), 'location added');
    await p.fill('#newCat input', 'אוכל לחתול'); await p.click('#newCat button'); await p.waitForTimeout(800);
    ok((await p.textContent('.set')).includes('אוכל לחתול'), 'category added');
    ok((await p.$$('.journal > div')).length > 5, 'journal');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#export')]);
    ok(/shuki-\d{4}-\d{2}-\d{2}\.json/.test(dl.suggestedFilename()), 'backup file');
  });
  await check('32', 'שעת סיכום נשמרת', async () => {
    await p.selectOption('#hour', '21'); await p.waitForTimeout(800);
    eq(await p.$eval('#hour', (s) => s.value), '21', 'hour');
  });
  await check('E-brain', 'הודעה כשהמודל לא זמין / אין קליטה בצ\'אט', async () => {
    await go('#chat'); await ctx.setOffline(true); await p.evaluate(() => window.dispatchEvent(new Event('offline'))); await p.waitForTimeout(300);
    ok(await p.$('#say[disabled]'), 'composer disabled offline');
    await ctx.setOffline(false); await p.evaluate(() => window.dispatchEvent(new Event('online')));
  });
  await check('logout', 'ניתוק המכשיר חוזר למסך הצימוד', async () => {
    await p.evaluate(async () => { const h = { 'content-type': 'application/json', authorization: `Bearer ${JSON.parse(localStorage.getItem('shuki.token'))}` }; const c = await (await fetch('/api/devices/code', { method: 'POST', headers: h, body: JSON.stringify({ user_id: 1 }) })).json(); await fetch('/api/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: c.code }) }); }); // the admin's second phone: the only one isn't disconnected (17/10, ש3)
    await go('#list'); await go('#settings'); await p.waitForSelector('#thisDevice #logout'); await p.click('#logout'); await p.click('#logout'); await p.waitForSelector('#code');
  });
  await check('JS', 'אין שגיאות JavaScript בדף', async () => { eq(errors.length, 0, `errors: ${errors.join(' | ')}`); });

  require('fs').writeFileSync(__dirname + '/qa-ui-results.json', JSON.stringify(results, null, 1));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} UI checks passed`);
  await b.close();
  process.exitCode = results.every((r) => r.ok) ? 0 : 1; // stage 5: a failed check fails the run
})().catch((e) => { console.error(e); process.exit(1); });
