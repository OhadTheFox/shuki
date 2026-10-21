// Typing in the inventory and recipes screens (16/10, the owner's iPhone: no typing in the searches, the screen was redrawn on
// every letter): letter by letter, in Hebrew, the field is the same element, it keeps the focus and the caret, every letter
// is there, and the results follow. Also the inventory's other fields (a new product, its edit sheet). Chromium and WebKit
// (UIS="test/search-ui.cjs test/search-ui.cjs@webkit").
const pw = require(process.env.PW), BR = process.env.PW_BROWSER || 'chromium', browser = pw[BR];
const { check, ok, phone, finish } = require('./sweep-lib.cjs');

/** Type letter by letter into `sel` and say whether it stayed the same element, focused, with all the text and the caret at its end. */
async function typeIn(p, sel, text) {
  await p.click(sel); await p.evaluate((s) => { document.querySelector(s).__same = 1; }, sel);
  await p.locator(sel).pressSequentially(text, { delay: 40 });
  await p.waitForTimeout(400);
  return p.evaluate((s) => { const el = document.querySelector(s); return { same: el?.__same === 1, focused: document.activeElement === el, v: el?.value, caret: el?.selectionStart }; }, sel);
}

(async () => {
  const b = await browser.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
  const p = await phone(b);
  await p.api('POST', '/api/actions', { actions: ['חלב 3%', 'חלבה', 'טחינה', 'במבה'].map((name) => ({ kind: 'create', product: { name, count_type: 'units', qty: 1 } })) });
  await p.api('POST', '/api/__recipes', { recipes: [{ name: 'שקשוקה', ingredients: '4 ביצים\nרסק עגבניות', text: 'מבשלים.' }, { name: 'חומוס ביתי', ingredients: 'גרגרי חומוס\nטחינה', text: 'טוחנים.' }] }).catch(() => {});

  await check('Q-1', 'חיפוש במלאי, אות-אות בעברית: אותה תיבה, פוקוס, כל האותיות, הסמן בסוף, והתוצאות מתעדכנות', async () => {
    await p.go('#inventory'); await p.reload2(); await p.go('#inventory');
    const r = await typeIn(p, '#invQ', 'חלב');
    ok(r.same && r.focused && r.v === 'חלב' && r.caret === 3, JSON.stringify(r));
    const names = await p.locator('#invList [data-p]').evaluateAll((els) => els.map((e) => e.querySelector('bdi').textContent));
    ok(names.length === 2 && names.every((n) => n.startsWith('חלב')), JSON.stringify(names));
    await p.locator('#invQ').pressSequentially('ה', { delay: 40 }); await p.waitForTimeout(400);
    ok(JSON.stringify(await p.locator('#invList [data-p]').evaluateAll((els) => els.map((e) => e.querySelector('bdi').textContent))) === '["חלבה"]', 'not narrowed');
    await p.fill('#invQ', ''); await p.evaluate(() => document.getElementById('invQ').dispatchEvent(new Event('input'))); await p.waitForTimeout(400);
  });
  await check('Q-2', 'חיפוש במתכונים, אות-אות בעברית: אותה תיבה, פוקוס, הסמן בסוף, והתוצאות מתעדכנות', async () => {
    await p.go('#recipes');
    const r = await typeIn(p, '#recQ', 'טחינה');
    ok(r.same && r.focused && r.v === 'טחינה' && r.caret === 5, JSON.stringify(r));
    const shown = await p.locator('.rlist [data-rec]').count();
    ok(shown <= 1, `${shown} recipes for "טחינה"`);
    await p.fill('#recQ', ''); await p.evaluate(() => document.getElementById('recQ').dispatchEvent(new Event('input'))); await p.waitForTimeout(400);
  });
  await check('Q-3', 'מוצר חדש במסך המלאי: השם אות-אות נשאר כמו שהוקלד', async () => {
    await p.go('#inventory'); await p.click('#addP'); await p.waitForSelector('#f-name');
    const r = await typeIn(p, '#f-name', 'רוטב דגים');
    ok(r.same && r.focused && r.v === 'רוטב דגים', JSON.stringify(r));
    await p.evaluate(() => document.querySelector('.scrim')?.remove());
  });
  await check('Q-4', 'עריכה של מוצר במסך המלאי: השם אות-אות נשאר', async () => {
    await p.evaluate(() => document.querySelector('.scrim')?.remove());
    await p.go('#inventory'); await p.click('#invList [data-p]'); await p.waitForSelector('#f-name');
    const field = '#f-name';
    await p.fill(field, '');
    const r = await typeIn(p, field, 'שם חדש');
    ok(r.same && r.focused && r.v === 'שם חדש', JSON.stringify(r));
    await p.keyboard.press('Escape');
    ok(!p.errors.length, p.errors.join(' | '));
  });
  await finish(b, `/tmp/shuki-test/search-ui${BR === 'chromium' ? '' : `-${BR}`}.json`);
})();
