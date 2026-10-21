// Sweep B: inventory screen and the product page. Run: test/ui-qa.sh test/sweep-b.cjs
const { chromium } = require(process.env.PW);
const lib = require('./sweep-lib.cjs');
const { d1, check, ok, phone, finish } = lib;
(async () => {
  const b = await chromium.launch();
  const p = await phone(b);
  const P = async (name) => (await p.state()).products.find((x) => x.name === name);
  const openNew = async () => { await p.go('#inventory'); await p.click('#addP'); await p.waitForSelector('#f-name'); };
  const save = async () => { await p.click('#save'); await p.waitForTimeout(900); };
  await p.go('#inventory');
  await check('I1', 'מלאי ריק: הסבר ו-+', async () => { const t = await p.textContent('.facts'); ok(/המלאי ריק/.test(t), t); ok(await p.$('#addP'), 'no +'); });
  await check('I2', 'מוצר חדש בלי שם → לא נשמר, הדף נשאר', async () => { await openNew(); await p.click('#save'); await p.waitForTimeout(400); ok(await p.$('#f-name'), 'closed'); ok(!(await p.state()).products.length, 'saved'); await p.click('.sheet-x'); });
  await check('I3', 'מוצר חדש, רק שם → נשמר עם יחידה אחת', async () => { await openNew(); await p.fill('#f-name', 'סוללות AA'); await save(); const x = await P('סוללות AA'); ok(x && x.qty === 1, JSON.stringify(x)); });
  await check('I4', 'החלפת סוג ספירה שומרת את מה שכבר הוקלד', async () => {
    await openNew(); await p.fill('#f-name', 'ביצים'); await p.selectOption('#f-type', 'pack'); ok((await p.inputValue('#f-name')) === 'ביצים', 'name lost');
    await p.fill('#f-pack', '12'); await p.selectOption('#f-type', 'units'); await p.selectOption('#f-type', 'pack'); ok((await p.inputValue('#f-name')) === 'ביצים', 'lost after 2 switches');
    for (let i = 0; i < 5; i++) await p.click('.sheet [data-q="1"]');
    await save(); const x = await P('ביצים'); ok(x.count_type === 'pack' && x.pack_size === 12 && x.qty === 6, JSON.stringify(x)); return x.text;
  });
  await check('I5', 'הרבה/מעט/אין: בוחרים "מעט" ונשמר', async () => {
    await openNew(); await p.fill('#f-name', 'עגבניות'); await p.selectOption('#f-type', 'level'); await p.click('#f-level [data-v=little]'); await save();
    ok((await P('עגבניות')).level === 'little');
  });
  await check('I6', 'בשימוש + רזרבה: אחד פתוח ו-2 סגורים', async () => {
    await openNew(); await p.fill('#f-name', 'סבון כלים'); await p.selectOption('#f-type', 'inuse');
    await p.click('.sheet [data-q="1"]'); await save(); const x = await P('סבון כלים'); ok(x.is_open === 1 && x.qty === 2, JSON.stringify(x)); return x.text;
  });
  await check('I7', 'כמות לא יורדת מתחת ל-0', async () => { await openNew(); for (let i = 0; i < 4; i++) await p.click('.sheet [data-q="-1"]'); ok((await p.textContent('#f-qty')) === '0'); await p.click('.sheet-x'); });
  await check('I8', 'בסיסי: מופיע שדה מינימום, נשמר, ואחוז בטבלה', async () => {
    await openNew(); await p.fill('#f-name', 'חלב 3%'); await p.fill('#f-unit', 'קרטון'); await p.check('#f-basic'); await p.waitForSelector('#f-target');
    await p.fill('#f-target', '2'); await save(); const x = await P('חלב 3%'); ok(x.is_basic === 1 && x.target === 2, JSON.stringify(x));
    const row = await p.textContent('.fr:has-text("חלב 3%")'); ok(/50%/.test(row), row); return row.replace(/\s+/g, ' ');
  });
  await check('I9', 'ערכים לא תקינים (אותיות, מינוס) → הודעה בדף ולא נסגר, בלי לאבד את מה שהוקלד', async () => {
    await openNew(); await p.fill('#f-name', 'קמח'); await p.fill('#f-shelf', 'abc'); await p.click('#save'); await p.waitForTimeout(700);
    const open = await p.$('#f-name'); ok(open, 'sheet closed and what was typed is lost');
    ok(!(await P('קמח')), 'saved with a broken value'); await p.click('.sheet-x');
  });
  await check('I10', 'שם ארוך מאוד (120 תווים) → נשמר מקוצר, בלי שבירת מסך', async () => {
    await openNew(); await p.fill('#f-name', 'ש'.repeat(120)); await save();
    const x = (await p.state()).products.find((y) => /^ש+$/.test(y.name)); ok(x && x.name.length <= 80, `${x?.name.length}`);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sideways');
  });
  await check('I11', 'חיפוש: מסנן, "לא מצאתי", ניקוי מחזיר הכל, הקלדה לא קופצת', async () => {
    await p.go('#inventory'); await p.click('#invQ'); await p.keyboard.type('חלב', { delay: 60 }); await p.waitForTimeout(400); // the results follow 150 ms after the last letter (16/10)
    ok((await p.inputValue('#invQ')) === 'חלב', 'typing broken'); ok((await p.$$('.fr')).length === 1, `${(await p.$$('.fr')).length} rows`);
    await p.fill('#invQ', 'אין כזה'); await p.waitForTimeout(400); ok(/לא מצאתי/.test(await p.textContent('.facts')));
    await p.fill('#invQ', ''); await p.waitForTimeout(400); ok((await p.$$('.fr')).length >= 5);
  });
  await check('I12', 'חיפוש עם ה הידיעה ("העגבניות")', async () => { await p.fill('#invQ', 'העגבניות'); await p.waitForTimeout(400); ok((await p.$$('.fr')).length === 1); await p.fill('#invQ', ''); });
  await check('I13', 'לפי מיקום / לפי קטגוריה, ונשאר אחרי רענון', async () => {
    await p.click('[data-mode=cat]'); await p.reload2(); await p.go('#inventory'); ok(await p.$('[data-mode=cat].on'), 'mode not kept'); await p.click('[data-mode=loc]');
  });
  await check('I14', 'עריכה: שינוי שם נשמר; שינוי לשם של מוצר אחר נחסם', async () => {
    await p.click('.fr:has-text("סוללות AA")'); await p.fill('#f-name', 'סוללות AAA'); await save(); ok(await P('סוללות AAA'), 'rename lost');
    await p.click('.fr:has-text("סוללות AAA")'); await p.fill('#f-name', 'חלב 3%'); await p.click('#save'); await p.waitForTimeout(400);
    ok(await p.$('#f-err:not([hidden])'), 'no twin message'); await p.click('.sheet-x');
  });
  await check('I15', '"נגמר" על מוצר בסיסי → נגמר ועולה לרשימה', async () => {
    await p.click('.fr:has-text("חלב 3%")'); await p.click('#outBtn'); await p.waitForTimeout(900); const s = await p.state(); const x = s.products.find((y) => y.name === 'חלב 3%');
    ok(x.out && s.list.some((i) => i.product_id === x.id), 'not out / not listed');
  });
  await check('I16', '"פתחנו" מופיע רק כשיש "אחרי פתיחה", ומוסיף תג "פתוח"', async () => {
    await p.click('.fr:has-text("סוללות AAA")'); ok(!(await p.$('#openBtn')), 'shown without open days'); await p.fill('#f-opend', '4'); await save();
    await p.click('.fr:has-text("סוללות AAA")'); await p.click('#openBtn'); await p.waitForTimeout(900); ok(/פתוח/.test(await p.textContent('.fr:has-text("סוללות AAA")')), 'no badge');
  });
  await check('I17', '"זרקנו" → נגמר, ונרשם ביומן כזריקה', async () => {
    await p.click('.fr:has-text("עגבניות")'); await p.click('#toss'); await p.waitForTimeout(900); const s = await p.state();
    ok(s.products.find((y) => y.name === 'עגבניות').out); ok(/זרק/.test(s.journal[0].summary), s.journal[0].summary);
  });
  await check('I18', 'מחיקה: לחיצה ראשונה שואלת "בטוח?", ✕ מבטל, שנייה מוחקת, "בטל" מחזיר', async () => {
    await p.click('.fr:has-text("סוללות AAA")'); await p.click('#del'); ok(/למחוק באמת\?/.test(await p.textContent('#del')), 'no confirm'); await p.click('.sheet-x'); await p.waitForTimeout(300);
    ok(await P('סוללות AAA'), 'deleted on first tap');
    await p.click('.fr:has-text("סוללות AAA")'); await p.click('#del'); await p.click('#del'); await p.waitForTimeout(900); ok(!(await P('סוללות AAA')), 'not deleted');
    await p.api('POST', '/api/undo'); ok(await P('סוללות AAA'), 'undo did not bring it back');
  });
  await check('I19', 'תוקף: חיי מדף → "פג ב..." בדף, ותג אדום כשקרוב', async () => {
    await openNew(); await p.fill('#f-name', 'שמנת'); await p.fill('#f-shelf', '2'); await save(); await p.reload2(); await p.go('#inventory');
    ok(/בתוקף|פג/.test(await p.textContent('.fr:has-text("שמנת")')), 'no expiry badge');
  });
  await check('I20', 'מיקום וקטגוריה שנבחרו קובעים את הקבוצה', async () => {
    await openNew(); await p.fill('#f-name', 'מלח'); const locs = await p.$$eval('#f-loc option', (xs) => xs.map((x) => [x.value, x.textContent]));
    const pantry = locs.find((l) => /מזווה/.test(l[1])); await p.selectOption('#f-loc', pantry[0]); await save();
    const grp = await p.evaluate(() => { const row = [...document.querySelectorAll('.fr')].find((r) => r.textContent.includes('מלח')); let e = row.previousElementSibling; while (e && !e.classList.contains('loc')) e = e.previousElementSibling; return e?.textContent; });
    ok(/מזווה/.test(grp), grp);
  });
  await check('I21', 'מוצר עם 0 → "נגמר" ברשימת המלאי ולא "0 יחידות"', async () => {
    await openNew(); await p.fill('#f-name', 'קטשופ'); await p.click('.sheet [data-q="-1"]'); await save(); const t = await p.textContent('.fr:has-text("קטשופ")'); ok(/נגמר/.test(t) && !/0 /.test(t), t);
  });
  await check('I22', 'שני טלפונים: מה שמיכל משנה מופיע אצלי אחרי רענון', async () => {
    const n = await phone(b, { user: 2 }); await n.api('POST', '/api/actions', { actions: [{ kind: 'create', product: { name: 'חומוס', count_type: 'units', qty: 2 } }] }); await n.ctx.close();
    lib.shotPage = p; await p.reload2(); await p.go('#inventory'); ok(await p.$('.fr:has-text("חומוס")'), 'not shown');
  });
  await check('JS', 'אין שגיאות JavaScript', async () => ok(!p.errors.length, p.errors.join(' | ')));
  await finish(b, 'test/sweep-b-results.json');
})();
