// home19, recipes (the owner 17/10): the recipe screen at iPhone size, Chromium and WebKit
// (UIS="test/home19-recipes-ui.cjs test/home19-recipes-ui.cjs@webkit"). Each check fails on 6142af5.
//   R-3: "שמן חמניות או קנולה" ✓ with "(יש שמן קנולה)", "3 פילה אנשובי" ✓, "עגבנייה סחוטה" ✓ (shown by its base name, as every line)
//   R-5: a ✗ is a button: it puts only that one on the list, by its base name, once
//   R-6 (18/10): the ✗ row shows a small "+"
//   R-7 (18/10): an ingredient added in the edit that a fact of someone in the house (allergy) finds: "שימו לב: יש במתכון X"
//   R-4: "שימו לב: יש במתכון כוסברה" goes when the edit makes the cilantro parsley, and the parsley is linked
const pw = require(process.env.PW), BR = process.env.PW_BROWSER || 'chromium', browser = pw[BR];
const { check, ok, phone, finish, d1, d1q } = require('./sweep-lib.cjs');

(async () => {
  const b = await browser.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
  const p = await phone(b);
  d1("INSERT INTO products (id, name, aliases, count_type, qty, is_open, created, updated) VALUES (91901, 'שמן קנולה', '[]', 'inuse', 0, 1, 0, 0), (91902, 'פילה אנשובי', '[]', 'units', 1, 0, 0, 0), (91903, 'עגבניות', '[]', 'units', 4, 0, 0, 0), (91904, 'פטרוזיליה', '[]', 'units', 1, 0, 0, 0)");
  const r = await p.api('POST', '/api/recipes', { name: 'פסטה של אנשובי', ingredients: 'שמן חמניות או קנולה\n3 פילה אנשובי\nעגבנייה סחוטה\n2 כפות כוסברה קצוצה\nחצי כוס צלפים קצוצים', text: 'מבשלים.', warn: 'יש במתכון כוסברה', serves: 2 });
  ok(r.id, JSON.stringify(r));
  const lines = () => p.$$eval('.ings li', (xs) => xs.map((x) => `${x.className}|${x.textContent.replace(/\s+/g, ' ').trim()}`));
  const open = async () => { await p.go('#recipes'); await p.waitForTimeout(500); await p.click('.rcard'); await p.waitForSelector('.ings'); };

  await check('R-3', 'קישור למלאי: "שמן חמניות או קנולה" ✓ (יש שמן קנולה), "3 פילה אנשובי" ✓, "עגבנייה סחוטה" ✓', async () => {
    await p.reload2(); await open();
    const l = await lines();
    ok(l.some((x) => x === 'ok|✓שמן חמניות או קנולה (יש שמן קנולה)'), JSON.stringify(l));
    ok(l.some((x) => x === 'ok|✓3 פילה אנשובי'), JSON.stringify(l));
    ok(l.some((x) => x === 'ok|✓עגבנייה'), JSON.stringify(l));
  });
  // home19 (manager 18/10): a small "+" on the ✗ row, so it is seen that a tap adds it; SHOT_DIR + SHOT_TAG: a screenshot
  await check('R-6', 'שורת ✗ מראה "+" קטן (בצד השמאלי, בלי טקסט חדש), ושורת ✓ לא', async () => {
    if (process.env.SHOT_DIR) { await p.waitForTimeout(400); await p.screenshot({ path: `${process.env.SHOT_DIR}/plus-${process.env.SHOT_TAG || 'shot'}${BR === 'webkit' ? '' : `-${BR}`}.png` }); }
    const plus = await p.$$eval('.ings li', (xs) => xs.map((li) => { const x = li.querySelector('.ing-plus'); if (!x) return null; const r = x.getBoundingClientRect(), b = li.getBoundingClientRect(); return { content: getComputedStyle(x, '::before').content, w: r.width, h: r.height, left: r.left - b.left, hidden: x.getAttribute('aria-hidden') }; }));
    const cls = await p.$$eval('.ings li', (xs) => xs.map((x) => x.className));
    cls.forEach((c, k) => { if (c === 'no') ok(plus[k] && /\+/.test(plus[k].content) && plus[k].w >= 16 && plus[k].h >= 16 && plus[k].hidden === 'true', `✗ row ${k}: ${JSON.stringify(plus[k])}`); else ok(!plus[k], `✓ row ${k} has a +`); });
    ok(plus.filter(Boolean).every((x) => x.left < 60), `the + at the left end: ${JSON.stringify(plus)}`);
    ok((await lines()).some((x) => x === 'no|✗2 כפות כוסברה'), 'the line\'s words as they were');
  });
  await check('R-5', 'הקשה על ✗ מוסיפה רק אותו לרשימה, בשם הבסיס; פעם שנייה: "כבר ברשימה."', async () => {
    ok(await p.$$eval('.ings li.no > button.ing-add', (xs) => xs.length) === 2, 'the two ✗ are buttons');
    ok(await p.$$eval('.ings li.ok > button', (xs) => xs.length) === 0, 'a ✓ is not');
    const box = await p.$eval('.ings li.no > button.ing-add', (x) => x.getBoundingClientRect().height);
    ok(box >= 32, `the tap target: ${box}px`);
    await p.click('.ings li.no >> text=כוסברה'); await p.waitForTimeout(900);
    ok(/הוספתי לרשימה מוצר אחד/.test(await p.textContent('body')), 'the toast');
    const rows = d1q("SELECT text, product_id, want FROM list_items WHERE status = 'open' AND text IS NOT NULL");
    ok(rows.length === 1 && rows[0].text === 'כוסברה' && rows[0].want == null, JSON.stringify(rows));
    await p.waitForTimeout(2500); // the toast goes
    await p.click('.ings li.no >> text=כוסברה'); await p.waitForTimeout(500);
    ok(/כבר ברשימה\./.test(await p.textContent('body')), 'the second time');
    ok(d1q("SELECT count(*) AS n FROM list_items WHERE status = 'open'")[0].n === 1, 'once');
    ok(!p.errors.length, p.errors.join(' | '));
  });
  await check('R-4', '"שימו לב: יש במתכון כוסברה" יורד אחרי עריכה שמחליפה אותה בפטרוזיליה, והפטרוזיליה מקושרת', async () => {
    await p.reload2(); await open();
    ok(/שימו לב: יש במתכון כוסברה/.test(await p.textContent('.sheet')), 'before');
    await p.click('#rEdit'); await p.waitForSelector('#ingRows');
    const k = await p.$$eval('[data-ing]', (xs) => xs.findIndex((x) => /כוסברה/.test(x.value)));
    await p.fill(`[data-ing="${k}"]`, '2 כפות פטרוזיליה קצוצה');
    await p.click('#rForm [type=submit]'); await p.waitForTimeout(1200);
    await p.waitForSelector('.ings');
    ok(!/שימו לב/.test(await p.textContent('.sheet')), 'after: no warning');
    ok((await lines()).some((x) => x === 'ok|✓2 כפות פטרוזיליה'), JSON.stringify(await lines()));
    const row = d1q(`SELECT warn, swap FROM recipes WHERE id = ${r.id}`)[0];
    ok(row.warn == null, JSON.stringify(row));
    ok(!p.errors.length, p.errors.join(' | '));
  });
  await check('R-7', 'עריכה שמוסיפה "בוטנים" כשלמיכל יש עובדה של אלרגיה לבוטנים: "שימו לב: יש במתכון בוטנים"; מחיקה שלהם מורידה אותה', async () => {
    d1("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 2, 'allergy', 'בוטנים', 1, 2, 2, 0, 'chat', 1, 1)");
    await p.reload2(); await open();
    ok(!/שימו לב/.test(await p.textContent('.sheet')), 'before: no warning');
    await p.click('#rEdit'); await p.waitForSelector('#ingRows');
    const n = await p.$$eval('[data-ing]', (xs) => xs.length);
    await p.fill(`[data-ing="${n - 1}"]`, '50 גרם בוטנים קלויים');
    await p.click('#rForm [type=submit]'); await p.waitForTimeout(1200); await p.waitForSelector('.ings');
    const t = await p.textContent('.sheet');
    ok(/שימו לב: יש במתכון בוטנים קלויים/.test(t), t.slice(0, 300));
    await p.reload2(); await p.go('#recipes'); await p.waitForTimeout(500);
    ok(/שימו לב/.test(await p.textContent('.rcard')), 'the list\'s mark too');
    await p.click('.rcard'); await p.waitForSelector('.ings');
    await p.click('#rEdit'); await p.waitForSelector('#ingRows');
    const k = await p.$$eval('[data-ing]', (xs) => xs.findIndex((x) => /בוטנים/.test(x.value)));
    await p.fill(`[data-ing="${k}"]`, '');
    await p.click('#rForm [type=submit]'); await p.waitForTimeout(1200); await p.waitForSelector('.ings');
    ok(!/שימו לב/.test(await p.textContent('.sheet')), 'after the peanuts went: no warning');
    ok(!p.errors.length, p.errors.join(' | '));
  });
  await finish(b, `/tmp/shuki-test/home19-recipes-ui${BR === 'chromium' ? '' : `-${BR}`}.json`);
})();
