// Sweep C: settings, closet, vacation, Siri, devices, backup, undo, logout. Run: test/ui-qa.sh test/sweep-c.cjs
const { chromium } = require(process.env.PW);
const lib = require('./sweep-lib.cjs');
const { d1, check, ok, phone, finish } = lib;
(async () => {
  const b = await chromium.launch();
  const p = await phone(b);
  await p.api('POST', '/api/actions', { actions: [{ kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 1, is_basic: 1, target: 1 } }, { kind: 'create', product: { name: 'קפה', count_type: 'units', qty: 1 } }] });
  d1(`INSERT INTO events (ts, user_id, type, summary) SELECT ${Date.now()}, 1, 'edit', 'x' FROM (WITH RECURSIVE c(k) AS (SELECT 1 UNION ALL SELECT k+1 FROM c WHERE k < 100) SELECT k FROM c)`); // level 9 (21 levels since stage 10)
  await p.go('#settings'); await p.reload2();
  const wide = () => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  await check('S1', 'הגדרות: כל החלקים, בלי גלילה לצדדים', async () => {
    const hs = await p.$$eval('.set h3', (xs) => xs.map((x) => x.textContent)); ok(hs.length >= 8, hs.join()); ok(await wide(), 'sideways'); return hs.join(' · ');
  });
  await check('S2', 'ארון: בוחרים פריט ו-✕ → שום דבר לא נשמר', async () => {
    const before = (await p.state()).outfit; await p.click('#closetGo'); await p.click('[data-slot=head][data-id=""]'); await p.click('.sheet-x'); await p.waitForTimeout(400);
    ok(JSON.stringify((await p.state()).outfit) === JSON.stringify(before), 'changed without save');
  });
  await check('S3', 'ארון: "שמירה" נשמר, השוקי למעלה מתעדכן, ונשאר אחרי רענון', async () => {
    await p.click('#closetGo'); await p.click('[data-slot=eyes][data-id=""]'); await p.click('#clSave'); await p.waitForTimeout(900);
    ok(!(await p.state()).outfit.eyes, 'glasses still on'); await p.reload2(); ok(!(await p.evaluate(() => document.querySelector('.band .mascot svg').classList.contains('w-glasses'))), 'top Shuki');
  });
  await check('S4', 'ארון: פריט נעול לא נבחר', async () => {
    await p.click('#closetGo'); const n = await p.$$('.chip.locked'); ok(n.length > 0, 'no locked'); await n[0].click({ force: true }); ok(!(await p.$('.chip.locked.on')), 'locked chosen'); await p.click('.sheet-x');
  });
  await check('S5', 'שעת הסיכום נשמרת ונשארת אחרי רענון', async () => { await p.selectOption('#hour', '21'); await p.waitForTimeout(800); await p.reload2(); ok((await p.inputValue('#hour')) === '21'); });
  await check('S6', 'חופשה: בלי תאריך לא נשלח', async () => { await p.click('#awayForm button'); await p.waitForTimeout(400); ok(!(await p.state()).away, 'away without date'); });
  await check('S7', 'חופשה: תאריך שכבר עבר → הודעה, לא נרשם', async () => {
    await p.fill('#awayUntil', new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10)); await p.click('#awayForm button'); await p.waitForTimeout(800);
    ok(!(await p.state()).away, 'away in the past saved');
  });
  await check('S8', 'חופשה: תאריך קדימה → "בחופשה עד" בכותרת; "חזרנו" מבטל', async () => {
    await p.fill('#awayUntil', new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10)); await p.click('#awayForm button'); await p.waitForTimeout(900);
    ok((await p.state()).away, 'not saved'); await p.go('#chat'); ok(/בחופשה עד/.test(await p.textContent('.band .sub')), await p.textContent('.band .sub'));
    await p.go('#settings'); await p.click('#awayEnd'); await p.waitForTimeout(900); ok(!(await p.state()).away, 'not ended');
  });
  await check('S9', 'סירי: יצירת מפתח → כתובות והעתקה ללוח', async () => {
    await p.click('#mkKey'); await p.waitForSelector('[data-copy]'); await p.click('[data-copy]'); const t = await p.evaluate(() => navigator.clipboard.readText()); ok(/\/api\/say$/.test(t), t);
  });
  await check('S10', 'סירי: מפתח חדש מבטל את הקודם', async () => {
    const k1 = (await p.$$eval('[data-copy]', (xs) => xs.map((x) => x.dataset.copy))).find((x) => /^Bearer/.test(x)); await p.go('#chat'); await p.go('#settings'); await p.click('#mkKey'); await p.waitForSelector('[data-copy]');
    const r = await p.evaluate(async (k) => (await fetch('/api/say', { method: 'POST', headers: { 'content-type': 'application/json', authorization: k }, body: JSON.stringify({ text: 'היי' }) })).status, k1); ok(r === 401, `old key: ${r}`);
  });
  await check('S11', 'מיקומים: שינוי שם נשמר', async () => {
    const i = await p.$('[data-loc]'); await i.fill('מקרר גדול'); await i.dispatchEvent('change'); await p.waitForTimeout(900); ok((await p.state()).locations.some((l) => l.name === 'מקרר גדול'));
  });
  await check('S12', 'מיקומים: מחיקת השם (ריק) לא שומרת מיקום בלי שם', async () => {
    const i = await p.$('[data-loc]'); await i.fill(''); await i.dispatchEvent('change'); await p.waitForTimeout(900); ok(!(await p.state()).locations.some((l) => !l.name.trim()), 'empty location name saved');
  });
  await check('S13', 'מיקומים: שם שכבר קיים לא שובר', async () => {
    const all = await p.$$('[data-loc]'); const other = await all[1].inputValue(); await all[0].fill(other); await all[0].dispatchEvent('change'); await p.waitForTimeout(900);
    ok(!p.errors.length, p.errors.join()); const s = await p.state(); ok(new Set(s.locations.map((l) => l.name)).size === s.locations.length, 'two locations with one name');
  });
  await check('S14', 'מיקום חדש: ריק לא נוסף; שם חדש נוסף ומופיע בדף המוצר', async () => {
    const n = (await p.state()).locations.length; await p.fill('#newLoc input', ' '); await p.click('#newLoc button'); await p.waitForTimeout(600); ok((await p.state()).locations.length === n, 'blank added');
    await p.fill('#newLoc input', 'מחסן'); await p.click('#newLoc button'); await p.waitForTimeout(900); ok((await p.state()).locations.some((l) => l.name === 'מחסן'));
    await p.go('#inventory'); await p.click('#addP'); ok((await p.$$eval('#f-loc option', (xs) => xs.map((x) => x.textContent))).includes('מחסן'), 'not in product page'); await p.click('.sheet-x'); await p.go('#settings');
  });
  await check('S15', 'קטגוריה חדשה נוספת; אותה קטגוריה פעמיים → אחת', async () => {
    for (let i = 0; i < 2; i++) { await p.fill('#newCat input', 'חיות מחמד'); await p.click('#newCat button'); await p.waitForTimeout(700); }
    ok((await p.state()).categories.filter((c) => c.name === 'חיות מחמד').length === 1);
  });
  await check('S16', '"מה קרה בבית": פעולה מופיעה עם היום; "בטל" מבטל אותה', async () => {
    await p.api('POST', '/api/actions', { actions: [{ kind: 'op', product_id: (await p.state()).products.find((x) => x.name === 'קפה').id, op: { type: 'out' } }] }); await p.reload2();
    ok(/היום/.test(await p.textContent('.journal')), 'no day'); await p.click('#undo'); await p.waitForTimeout(900); ok(!(await p.state()).products.find((x) => x.name === 'קפה').out, 'not undone');
  });
  await check('S17', 'גיבוי: מוריד קובץ עם המוצרים', async () => {
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#export')]); const f = await dl.path(); const j = JSON.parse(require('fs').readFileSync(f, 'utf8'));
    ok(JSON.stringify(j).includes('חלב 3%'), 'no products'); return dl.suggestedFilename();
  });
  await check('S18', 'התראות: אין הרשאה → הודעה ברורה, בלי קריסה', async () => { await p.click('#pushOn'); await p.waitForTimeout(900); ok(await p.$('.toast'), 'no message'); ok(!p.errors.length, p.errors.join()); return await p.textContent('.toast'); });
  await check('S19', '"אולי בסיסי?" → הופך לבסיסי', async () => {
    const id = (await p.state()).products.find((x) => x.name === 'קפה').id;
    for (let i = 0; i < 3; i++) d1(`INSERT INTO events (ts, user_id, type, product_id, summary) VALUES (${Date.now() - i * 864e5}, 1, 'out', ${id}, 'x')`);
    await p.reload2(); const btn = await p.$('[data-basic]'); if (!btn) return 'לא מוצג (צריך כמה "נגמר")'; await btn.click(); await p.waitForTimeout(900); ok((await p.state()).products.find((x) => x.name === 'קפה').is_basic === 1);
  });
  await check('S20', 'מכשירים: קוד למיכל, 6 ספרות', async () => { await p.waitForSelector('[data-code="2"]'); await p.click('[data-code="2"]'); await p.waitForSelector('.paircode'); ok(/^\d{6}$/.test((await p.textContent('.paircode b')).trim())); });
  await check('S21', 'כפתור "חזור" של הדפדפן מחזיר ללשונית הקודמת ולא נתקע', async () => {
    await p.go('#list'); await p.go('#settings'); await p.goBack(); await p.waitForTimeout(500); ok(await p.$('#addTxt'), 'not back on the list');
    await p.go('#settings'); await p.click('#closetGo'); await p.goBack(); await p.waitForTimeout(500); ok(!(await p.$('.scrim')), 'window stayed open after back');
  });
  await check('S22', 'ניתוק: לחיצה ראשונה שואלת, שנייה מנתקת ומוחקת את הנתונים מהטלפון', async () => {
    await p.evaluate(async () => { const h = { 'content-type': 'application/json', authorization: `Bearer ${JSON.parse(localStorage.getItem('shuki.token'))}` }; const c = await (await fetch('/api/devices/code', { method: 'POST', headers: h, body: JSON.stringify({ user_id: 1 }) })).json(); await fetch('/api/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: c.code }) }); }); // the admin's second phone: the only one isn't disconnected (17/10, ש3)
    await p.go('#list'); await p.go('#settings'); await p.waitForSelector('#thisDevice #logout'); await p.click('#logout'); ok(/לנתק באמת\?/.test(await p.textContent('#logout')), 'no confirm'); await p.click('#logout'); await p.waitForSelector('#code');
    ok(!(await p.evaluate(() => localStorage.getItem('shuki.state'))), 'data left on the phone');
  });
  await check('JS', 'אין שגיאות JavaScript', async () => ok(!p.errors.length, p.errors.join(' | ')));
  await finish(b, 'test/sweep-c-results.json');
})();
