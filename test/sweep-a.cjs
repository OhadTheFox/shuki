// Sweep A: pairing, chat, shopping list. Run: test/ui-qa.sh test/sweep-a.cjs
const { chromium } = require(process.env.PW);
const lib = require('./sweep-lib.cjs');
const { BASE, d1, check, ok, phone, finish } = lib;
(async () => {
  const b = await chromium.launch();

  /* ---------------- pairing ---------------- */
  const c0 = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const q = await c0.newPage(); const qerr = []; q.on('pageerror', (e) => qerr.push(e.message));
  await q.goto(BASE + '/'); lib.shotPage = q;
  await check('P1', 'צימוד: לחיצה בלי קוד לא שולחת ולא קורסת', async () => { await q.click('#pair button[type=submit]'); await q.waitForTimeout(300); ok(await q.$('#code'), 'still on pairing'); ok(!qerr.length, qerr.join()); });
  await check('P2', 'צימוד: קוד שגוי → הודעה, נשארים', async () => { await q.fill('#code', '000000'); await q.click('#pair button[type=submit]'); await q.waitForSelector('#err:not([hidden])'); return await q.textContent('#err'); });
  await check('P3', 'צימוד: 5 ספרות → הודעה', async () => { await q.fill('#code', '12345'); await q.click('#pair button[type=submit]'); await q.waitForTimeout(500); ok(await q.isVisible('#err'), 'no error'); });
  await check('P4', 'צימוד: אותיות לא נכנסות לשדה, מקף ורווח מוסרים', async () => {
    await q.fill('#code', ''); await q.type('#code', 'ab1c2'); ok((await q.inputValue('#code')) === '12', await q.inputValue('#code'));
    await q.fill('#code', ''); await q.type('#code', '944-080'); ok((await q.inputValue('#code')) === '944080', await q.inputValue('#code'));
  });
  await check('P5', 'צימוד: יותר מדי ניסיונות → נחסם עם הסבר', async () => {
    for (let i = 0; i < 4; i++) { await q.fill('#code', '99999' + i); await q.click('#pair button[type=submit]'); await q.waitForTimeout(300); }
    const t = await q.textContent('#err'); ok(/יותר מדי ניסיונות/.test(t), t); return t;
  });
  d1('DELETE FROM pair_attempts');
  d1(`INSERT OR REPLACE INTO settings (key, value) VALUES ('shop_produce', 'both'), ('shop_care', 'both')`); // home18 (5): the greengrocer's and pharmacy's tabs are there (else hidden)
  await check('P6', 'צימוד: קוד תקין (עם רווחים מסביב) → צ\'אט עם שלום של שוקי', async () => {
    d1(`INSERT OR REPLACE INTO pairing_codes (code, user_id, expires) VALUES ('424242', 1, 9999999999999)`);
    await q.fill('#code', ' 424242 '); await q.click('#pair button[type=submit]'); await q.waitForSelector('#say');
    await q.waitForTimeout(2500); const t = await q.textContent('#thread'); ok(/היי אבי! אני שוקי/.test(t), t); ok(!qerr.length, qerr.join()); // the first phone of someone in the house: hello (decision 168)
  });
  await check('P7', 'צימוד: אותו קוד בטלפון אחר → לא עובד (חד-פעמי)', async () => {
    const c1 = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }); const r = await c1.newPage();
    await r.goto(BASE + '/'); await r.fill('#code', '424242'); await r.click('#pair button[type=submit]'); await r.waitForSelector('#err:not([hidden])'); await c1.close();
  });
  await check('P8', 'צימוד: אחרי רענון נשארים מחוברים', async () => { await q.reload(); await q.waitForSelector('#say'); });
  await c0.close();

  /* ---------------- chat ---------------- */
  const p = await phone(b);
  await check('C1', 'צ\'אט: שליחה ריקה / רווחים בלבד לא עושה כלום', async () => {
    await p.click('#send'); await p.fill('#say', '   '); await p.click('#send'); await p.waitForTimeout(400);
    ok(!(await p.$('.msg.me')), 'sent something');
  });
  await check('C2', 'צ\'אט: "מתחילים מהמקרר" → כרטיס עם כל השורות, שום דבר לא נשמר לפני אישור', async () => {
    await p.fill('#say', 'מתחילים מהמקרר, הכל קבוע'); await p.click('#send'); await p.waitForSelector('.coupon.pending', { timeout: 8000 });
    const n = (await p.$$('.coupon.pending li')).length; ok(n === 7, `${n} lines`);
    ok((await p.state()).products.length === 0, 'saved before approval');
    return `${n} שורות`;
  });
  await check('C3', 'צ\'אט: מורידים שורה (טונה) ומאשרים → הכל חוץ ממנה נשמר', async () => {
    await p.click('.coupon.pending li:has-text("טונה") .tick'); await p.click('.coupon.pending [data-do=apply]'); await p.waitForSelector('.coupon.applied');
    const s = await p.state(); ok(s.products.length === 6 && !s.products.some((x) => /טונה/.test(x.name)), s.products.map((x) => x.name).join());
  });
  await check('C4', 'צ\'אט: "בטל" בהודעה אחרי אישור מחזיר הכל', async () => {
    const t = await p.$('.toast button'); ok(t, 'no undo toast'); await t.click(); await p.waitForTimeout(1000);
    ok((await p.state()).products.length === 0, 'not undone');
  });
  await check('C5', 'צ\'אט: ביטול הצעה → "בוטל", כלום לא נשמר, אי אפשר לאשר אחר כך', async () => {
    await p.fill('#say', 'מתחילים מהמקרר שוב, הכל קבוע'); await p.click('#send'); await p.waitForSelector('.coupon.pending');
    await p.click('.coupon.pending [data-do=reject]'); await p.waitForSelector('.coupon.rejected');
    ok((await p.state()).products.length === 0); ok(!(await p.$('.coupon.rejected [data-do=apply]')), 'apply still there');
  });
  await check('C6', 'צ\'אט: לחיצה כפולה על אישור שומרת פעם אחת', async () => {
    await p.fill('#say', 'מקרר בפעם השלישית'); await p.click('#send'); await p.waitForSelector('.coupon.pending');
    await p.evaluate(() => { const b = document.querySelector('.coupon.pending [data-do=apply]'); b.click(); b.click(); });
    await p.waitForTimeout(1200); const s = await p.state(); ok(s.products.length === 7, `${s.products.length} products`);
    ok(s.products.filter((x) => x.name === 'חלב 3%').length === 1, 'twice');
  });
  await check('C7', 'צ\'אט: שאלה עם כפתורי תשובה → רק בהודעה האחרונה, ולחיצה שולחת', async () => {
    await p.fill('#say', 'נגמרה הגבינה'); await p.click('#send'); await p.waitForSelector('.chips [data-opt]');
    const opt = await p.$('.chips [data-opt]'); const t = await opt.textContent(); await opt.click(); await p.waitForTimeout(1500);
    ok((await p.$$eval('.msg.me', (xs) => xs.map((x) => x.textContent))).includes(t), 'option not sent');
  });
  await check('C8', 'צ\'אט: הודעה ארוכה מאוד (3000 תווים) → נשלחת, בלי קריסה', async () => {
    await p.fill('#say', 'א'.repeat(3000)); await p.click('#send'); await p.waitForTimeout(1800);
    ok(!p.errors.length, p.errors.join()); ok(await p.$('#say:not([disabled])'), 'composer stuck');
  });
  await check('C9', 'צ\'אט: בזמן ששוקי חושב אי אפשר לשלוח שוב', async () => {
    await p.route('**/api/chat', async (r) => { if (r.request().method() === 'POST') { await new Promise((x) => setTimeout(x, 1500)); await r.continue(); } else await r.continue(); });
    await p.fill('#say', 'היי'); await p.click('#send'); await p.waitForTimeout(200);
    ok(await p.$('#send[disabled]'), 'send not disabled while waiting'); ok(await p.$('.typing'), 'no typing dots');
    await p.waitForTimeout(2200); await p.unroute('**/api/chat'); ok(await p.$('#send:not([disabled])'), 'still disabled');
  });
  await check('C10', 'צ\'אט: אין קליטה → השדה נעול עם הסבר; חוזרת → נפתח', async () => {
    await p.ctx.setOffline(true); await p.evaluate(() => window.dispatchEvent(new Event('offline'))); await p.waitForTimeout(300);
    const ph = await p.getAttribute('#say', 'placeholder'); ok(/אין קליטה/.test(ph), ph);
    await p.ctx.setOffline(false); await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(800);
    ok(await p.$('#say:not([disabled])'), 'still locked');
  });
  await check('C11', 'צ\'אט: ההיסטוריה נשארת אחרי רענון', async () => { await p.reload2(); ok((await p.$$('.msg.me')).length >= 4, 'history lost'); });
  await check('C12', 'צ\'אט: "אני עושה קניות" → עובר לרשימה עם מצב קניות', async () => {
    await p.go('#chat'); await p.fill('#say', 'אני עושה קניות'); await p.click('#send'); await p.waitForFunction(() => location.hash === '#list', null, { timeout: 6000 });
    await p.waitForSelector('.trip.mine');
  });
  await check('C13', 'צ\'אט: "סיימתי קניות" → מצב קניות נסגר', async () => {
    await p.go('#chat'); await p.fill('#say', 'סיימתי קניות'); await p.click('#send'); await p.waitForTimeout(1800);
    ok(!(await p.state()).shopping.length, 'trip open');
  });
  await check('C14', 'צ\'אט: מצלמה → "מה בתמונה" → ✕ → כלום לא נשלח', async () => {
    const before = (await p.$$('.msg.me')).length;
    await p.setInputFiles('#photo', { name: 'x.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('/9j/4AAQ', 'base64') }); await p.waitForSelector('.sheet-x');
    await p.click('.sheet-x'); await p.waitForTimeout(600); ok((await p.$$('.msg.me')).length === before, 'sent');
  });
  await check('C15', 'צ\'אט: אותה תמונה פעמיים ברצף נפתחת שוב (הקלט מתאפס)', async () => {
    await p.setInputFiles('#photo', { name: 'x.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('/9j/4AAQ', 'base64') }); await p.waitForSelector('.sheet-x'); await p.click('.sheet-x');
  });
  await check('C16', 'צ\'אט: המספר בלשונית הצ\'אט = בדיקה שבועית שמחכה', async () => {
    const ids = (await p.state()).products.filter((x) => !x.out).slice(0, 3).map((x) => x.id);
    d1(`INSERT OR REPLACE INTO settings (key, value) VALUES ('recount_at', '${Date.now()}'), ('recount_ids', '${JSON.stringify(ids)}')`);
    // stage 5, ש2: one card at a time, the recount last; so nothing expired, little or left over waits before it here
    d1("UPDATE products SET expires = NULL"); d1("UPDATE batches SET expires = NULL"); d1("UPDATE products SET level = 'plenty' WHERE level = 'little'"); d1('DELETE FROM leftovers');
    await p.reload2(); const t = await p.textContent('.nav a[href="#chat"]'); ok(t.includes("(3 שאלות פתוחות)"), t);
    await p.click('.rq [data-rc-yes]'); await p.waitForTimeout(1200); ok((await p.textContent('.nav a[href="#chat"]')).includes('(2 שאלות פתוחות)'), 'did not go down');
  });

  /* ---------------- list ---------------- */
  await p.go('#list'); await p.reload2();
  const add = async (t) => { await p.fill('#addTxt', t); await p.click('#adder button[type=submit]'); await p.waitForTimeout(700); };
  const lines = () => p.$$eval('.item .nm bdi', (xs) => xs.map((x) => x.textContent));
  await check('L1', 'רשימה: הוספה ריקה / רווחים לא מוסיפה', async () => { const n = (await lines()).length; await add(''); await add('   '); ok((await lines()).length === n, 'added blank'); });
  await check('L2', 'רשימה: הוספה בכפתור ובאנטר', async () => {
    await add('נרות'); await p.fill('#addTxt', 'בלונים'); await p.press('#addTxt', 'Enter'); await p.waitForTimeout(700);
    const l = await lines(); ok(l.includes('נרות') && l.includes('בלונים'), l.join());
  });
  await check('L3', 'רשימה: אותו חד-פעמי פעמיים → שורה אחת', async () => { await add('נרות'); ok((await lines()).filter((x) => x === 'נרות').length === 1, 'twice'); });
  await check('L4', 'רשימה: שם של מוצר קיים → המוצר (עם כמות), לא חד-פעמי', async () => {
    await add('לחם פרוס'); const s = await p.state(); ok(!s.list.some((i) => i.text === 'לחם פרוס'), 'one-off');
  });
  await check('L5', 'רשימה: הצעות תוך כדי הקלדה, ולחיצה מוסיפה', async () => {
    await p.fill('#addTxt', 'טונ'); await p.waitForSelector('.chip[data-add]'); await p.click('.chip[data-add]'); await p.waitForTimeout(600);
    if (await p.$('#w-yes')) await p.click('#w-yes'); await p.waitForTimeout(600);
    ok((await lines()).some((x) => /טונה/.test(x)), 'not added');
  });
  await check('L6', 'רשימה: "יש כבר בבית" באזהרה → "לא צריך" לא מוסיף', async () => {
    await p.api('POST', '/api/actions', { actions: [{ kind: 'create', product: { name: 'אורז', count_type: 'units', qty: 3 } }] }); await p.reload2();
    await add('אורז'); await p.waitForSelector('#w-no'); await p.click('#w-no'); await p.waitForTimeout(500); ok(!(await lines()).includes('אורז'), 'added');
  });
  await check('L7', 'רשימה: "לחשוב על זה" → נכנס ל"נחשוב על זה" ולא לרשימה', async () => {
    await p.fill('#addTxt', 'מכונת קפה'); await p.waitForSelector('#thinkChip'); await p.click('#thinkChip'); await p.waitForTimeout(900);
    ok(/מכונת קפה/.test(await p.textContent('.maybe')), 'not in maybe'); ok(!(await lines()).includes('מכונת קפה'), 'on the list');
  });
  await check('L8', 'רשימה: "ויתרנו" מוריד מ"נחשוב על זה"', async () => { await p.click('.maybe [data-d=drop]'); await p.waitForTimeout(900); ok(!(await p.$('.maybe .rowline')), 'still there'); });
  await check('L9', 'רשימה: לשוניות חנויות, פריט שנוסף בפארם נמצא רק בפארם', async () => {
    await p.click('.flap[data-store=pharm]'); await add('משחת שיניים'); ok((await lines()).includes('משחת שיניים'), 'not in pharm');
    await p.click('.flap[data-store=super]'); await p.waitForTimeout(300); ok(!(await lines()).includes('משחת שיניים'), 'also in super');
  });
  await check('L10', 'רשימה: המונה בלשונית ובכותרת תואמים', async () => {
    const n = (await p.$$('.listwrap > .itemw')).length; const tab = await p.textContent('.flap[data-store=super] .n'); ok(+tab === n, `${tab} vs ${n}`);
  });
  await check('L11', 'רשימה: סימון חד-פעמי → לעגלה, סימון שוב → חוזר', async () => {
    await p.click('.item:has-text("בלונים")'); await p.waitForTimeout(700); ok(await p.$('.item.done:has-text("בלונים")'), 'not in cart');
    await p.click('.item:has-text("בלונים")'); await p.waitForTimeout(700); ok(!(await p.$('.item.done:has-text("בלונים")')), 'still in cart');
  });
  await check('L12', 'רשימה: לחיצה ארוכה → חלון הכמות, מינוס לא יורד מ-1, ✕ לא מסמן', async () => {
    { const b = await p.waitForSelector('.item:has-text("לחם")'); const x = await b.boundingBox(); await p.mouse.move(x.x + x.width / 2, x.y + x.height / 2); await p.mouse.down(); await p.waitForTimeout(750); await p.mouse.up(); } // a long press (decision 171)
    await p.waitForSelector('#n'); for (let i = 0; i < 4; i++) await p.click('.sheet [data-d="-1"]');
    ok((await p.textContent('#n')) === '1', await p.textContent('#n')); await p.click('.sheet-x'); await p.waitForTimeout(300);
    ok(!(await p.$('.item.done:has-text("לחם")')), 'checked by closing');
  });
  await check('L13', 'רשימה: שליחת רשימה ריקה לא מוצגת', async () => { await p.click('.flap[data-store=greengrocer]'); await p.waitForTimeout(300); const has = await p.$('#shareList'); const l = await lines(); ok(!!has === l.some(Boolean) || (await p.$$('.item:not(.done)')).length > 0 === !!has, 'share shown on empty'); await p.click('.flap[data-store=super]'); });
  await check('L14', 'רשימה: "סיימתי קנייה" מופיע רק כשמשהו בעגלה', async () => {
    ok(!(await p.$('#finish')), 'shown with empty cart'); await p.click('.item:has-text("נרות")'); await p.waitForTimeout(700); ok(await p.$('#finish'), 'not shown');
  });
  await check('L15', 'רשימה: סיום קנייה → חשבונית, מה שנקנה יורד, השאר נשאר', async () => {
    await p.click('#finish'); await p.waitForSelector('.receipt'); const t = await p.textContent('.receipt'); await p.click('.sheet-x');
    const l = await lines(); ok(!l.includes('נרות') && l.includes('בלונים'), l.join()); return t.replace(/\s+/g, ' ');
  });
  await check('L16', 'רשימה: מצב קניות: יוצא → "יש לנו?" מופיע; "סיימתי" בלי עגלה סוגר', async () => {
    await p.click('#tripGo'); await p.waitForSelector('#haveQ'); await p.click('#tripEnd'); await p.waitForTimeout(900); ok(!(await p.$('#haveQ')), 'still in trip');
  });
  await check('L17', 'רשימה: בלי קליטה → סימון נשמר בטלפון, חוזרת קליטה → נשלח', async () => {
    await p.ctx.setOffline(true); await p.evaluate(() => window.dispatchEvent(new Event('offline')));
    await p.click('.item:has-text("בלונים")'); await p.waitForTimeout(500); ok(await p.$('.item.done:has-text("בלונים")'), 'not marked offline');
    ok(/אין קליטה/.test(await p.textContent('.listwrap')), 'no offline stamp');
    await p.ctx.setOffline(false); await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(2000);
    const s = await p.state(); const bal = s.products.find((x) => x.name === 'בלונים'); ok(s.list.find((i) => i.text === 'בלונים' || (bal && i.product_id === bal.id))?.status === 'checked', 'not sent');
  });
  await check('L18', 'רשימה: שם ארוך מאוד נשבר לשורות בלי גלילה לצדדים', async () => {
    await add('נייר אפייה עם שם ארוך במיוחד שנכתב בשביל לבדוק שבירת שורות במסך הקטן'); ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sideways');
  });
  await check('L19', 'רשימה: "⋯" → "לא צריך" מוריד; ✕ לא עושה כלום', async () => {
    const n = (await lines()).length; await p.click('.itemw:has-text("נייר אפייה") [data-more]'); await p.click('.sheet-x'); await p.waitForTimeout(300); ok((await lines()).length === n, 'changed');
    await p.click('.itemw:has-text("נייר אפייה") [data-more]'); await p.click('[data-m=skip]'); await p.waitForTimeout(800); ok((await lines()).length === n - 1, 'not removed');
  });
  await check('L20', 'רשימה: השני מוסיף בזמן שאני בקניות → מופיע עם "חדש" ובהודעה', async () => {
    const n = await phone(b, { user: 2 }); await p.go('#list'); await p.click('#tripGo'); await p.waitForSelector('.trip.mine');
    await n.api('POST', '/api/actions', { actions: [{ kind: 'list_add', text: 'גבינה בולגרית', store: 'super' }] });
    await p.waitForSelector('.item:has-text("גבינה בולגרית") .new', { timeout: 15000 }); await p.click('#tripEnd').catch(() => {}); await n.ctx.close();
  });
  await check('JS', 'אין שגיאות JavaScript', async () => ok(!p.errors.length, p.errors.join(' | ')));
  await finish(b, 'test/sweep-a-results.json');
})();
