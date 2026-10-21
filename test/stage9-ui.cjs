// Stage 9 screens (docs/stage9-plan.md): what the inventory gantt shows. Each check names its task; S9-U1… (U1–U18 are taken
// in test/packunits.itest.js). Run under tools/runall.sh (UIS="test/stage9-ui.cjs").
const browser = require(process.env.PW)[process.env.PW_BROWSER || 'chromium'];
const lib = require('./sweep-lib.cjs');
const { check, ok, phone, finish, d1, d1q } = lib;
(async () => {
  const b = await browser.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
  d1("INSERT OR REPLACE INTO users (id, name, gender, role, active, created) VALUES (3, 'יואבי', 'm', 'child', 1, 0)");
  d1("DELETE FROM settings WHERE key = 'house_mode'"); // a family house, not roommates
  const p = await phone(b, { w: 390, h: 844 });           // Avi, the admin
  const kid = await phone(b, { w: 390, h: 844, user: 3 }); // Yoavi, a child
  const op = () => `s9u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const act = (actions) => p.api('POST', '/api/actions', { op_id: op(), ts: Date.now(), actions, by: 1 });
  await act([{ kind: 'create', product: { name: 'חלב סויה', count_type: 'units', unit: 'קרטון', qty: 0, is_basic: 1, target: 1, location_id: 'מקרר' } },
    { kind: 'create', product: { name: 'קרם ידיים', count_type: 'units', qty: 1, location_id: 'מקרר' } }]);
  const id = (n) => d1q(`SELECT id FROM products WHERE name = '${n}'`)[0].id;
  await act([{ kind: 'edit', product_id: id('חלב סויה'), fields: { owner: 2 } }, { kind: 'list_add', product_id: id('חלב סויה'), amount: 1 }]);

  await check('S9-U1', 'מ2: בבית רגיל, "של מיכל" מתחת לשם ברשימה ובמלאי (אפשרות ב, מתחת לשם)', async () => {
    await p.reload2(); await p.go('#list');
    const sub = await p.$$eval('.item', (xs) => xs.filter((x) => x.textContent.includes('חלב סויה')).map((x) => x.querySelector('.nm small')?.textContent || ''));
    ok(sub.some((t) => t.includes('של מיכל')), JSON.stringify(sub));
    await p.screenshot({ path: 'docs/stage9-shots/S9-U1-list.png' });
    await p.go('#inventory');
    const row = await p.$$eval('.fr', (xs) => xs.filter((x) => x.querySelector('bdi')?.textContent === 'חלב סויה').map((x) => ({ own: x.querySelector('span .own')?.textContent, q: x.querySelector('.q')?.textContent })));
    ok(row[0]?.own === 'של מיכל' && !/של מיכל/.test(row[0].q), JSON.stringify(row));
    await p.evaluate(() => [...document.querySelectorAll('.fr')].find((x) => x.querySelector('bdi')?.textContent === 'חלב סויה')?.scrollIntoView({ block: 'center' })); await p.waitForTimeout(200);
    await p.screenshot({ path: 'docs/stage9-shots/S9-U1-inventory.png' });
  });

  await check('S9-U7', 'מ7 (שאלה 28, r9z): ברשימה, מתחת לשם, "רק אלפרו · של מיכל"; מותג בלי "רק": השם שלו בלבד', async () => {
    d1(`UPDATE products SET brand = 'אלפרו', only_brand = 1 WHERE id = ${id('חלב סויה')}`);
    await p.reload2(); await p.go('#list');
    const sub = () => p.$$eval('.item', (xs) => xs.filter((x) => x.textContent.includes('חלב סויה')).map((x) => x.querySelector('.nm small')?.textContent || ''));
    ok((await sub()).includes('רק אלפרו · של מיכל'), JSON.stringify(await sub()));
    await p.screenshot({ path: 'docs/stage9-shots/S9-U7-only-brand.png' });
    d1(`UPDATE products SET only_brand = 0 WHERE id = ${id('חלב סויה')}`);
    await p.reload2(); await p.go('#list');
    ok((await sub()).includes('אלפרו · של מיכל'), JSON.stringify(await sub()));
    d1(`UPDATE products SET brand = NULL WHERE id = ${id('חלב סויה')}`);
    await p.reload2(); await p.go('#inventory'); // where S9-U2 starts
  });

  await check('S9-U2', 'מ2: חלון המוצר: "של מי" (משותף וכל בני הבית) נשמר; אצל ילד הוא לא מופיע', async () => {
    await p.evaluate(() => [...document.querySelectorAll('.fr')].find((x) => x.querySelector('bdi')?.textContent === 'קרם ידיים')?.click());
    await p.waitForSelector('#f-owner');
    const opts = await p.$$eval('#f-owner option', (xs) => xs.map((x) => x.textContent));
    ok(opts[0] === 'משותף' && opts.includes('מיכל') && opts.includes('יואבי'), JSON.stringify(opts));
    await p.$eval('#f-owner', (e) => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(200);
    await p.screenshot({ path: 'docs/stage9-shots/S9-U2-sheet.png' });
    await p.selectOption('#f-owner', { label: 'מיכל' });
    await p.click('.sheet #save'); await p.waitForTimeout(900);
    ok(d1q(`SELECT owner FROM products WHERE id = ${id('קרם ידיים')}`)[0].owner === 2, 'not saved');
    await kid.reload2(); await kid.go('#inventory');
    await kid.evaluate(() => [...document.querySelectorAll('.fr')].find((x) => x.querySelector('bdi')?.textContent === 'קרם ידיים')?.click());
    await kid.waitForSelector('.sheet h2');
    ok(!(await kid.$('#f-owner')), 'a child has "של מי"');
    await kid.keyboard.press('Escape');
  });

  await check('S9-U3', 'מ2: מוצר פרטי: מנעול, בלי "של"', async () => {
    d1(`UPDATE products SET private_to = 1, owner = 1 WHERE id = ${id('קרם ידיים')}`);
    await p.reload2(); await p.go('#inventory');
    const row = await p.$$eval('.fr', (xs) => xs.filter((x) => x.querySelector('bdi')?.textContent === 'קרם ידיים').map((x) => ({ lock: !!x.querySelector('.lock'), own: x.querySelector('.own')?.textContent || '' })));
    ok(row[0]?.lock && !row[0].own, JSON.stringify(row));
    await p.evaluate(() => [...document.querySelectorAll('.fr')].find((x) => x.querySelector('bdi')?.textContent === 'קרם ידיים')?.click());
    await p.waitForSelector('.sheet h2');
    ok(!(await p.$('#f-owner')), 'a private product has "של מי"');
  });

  await check('S9-U5', 'מ24: "המשלוח הגיע" עם שני פריטים: "האם הגיע הכל?", הכל מסומן; מה שלא מסומן חוזר לרשימה הפתוחה', async () => {
    await act([{ kind: 'create', product: { name: 'אורז בסמטי', count_type: 'units', qty: 0, location_id: 'מזווה' } }, { kind: 'create', product: { name: 'שמן זית', count_type: 'units', qty: 0, location_id: 'מזווה' } }]);
    await act([{ kind: 'list_add', product_id: id('אורז בסמטי') }, { kind: 'list_add', product_id: id('שמן זית') }]);
    const item = (n) => d1q(`SELECT id, status, ordered FROM list_items WHERE product_id = ${id(n)} ORDER BY id DESC LIMIT 1`)[0];
    await act([{ kind: 'order', item_id: item('אורז בסמטי').id }, { kind: 'order', item_id: item('שמן זית').id }]);
    await p.reload2(); await p.go('#list');
    await p.click('#arrivedAll'); await p.waitForSelector('#cameGo');
    ok((await p.$eval('.sheet h2', (x) => x.textContent)) === 'האם הגיע הכל?', 'title');
    ok((await p.$$eval('[data-came]', (xs) => xs.every((x) => x.checked))) === true, 'not all ticked');
    await p.screenshot({ path: 'docs/stage9-shots/S9-U5-arrived.png' });
    await p.click(`label:has([data-came="${item('שמן זית').id}"])`);
    await p.click('#cameGo'); await p.waitForTimeout(900);
    ok(item('אורז בסמטי').status === 'done', JSON.stringify(item('אורז בסמטי')));
    const oil = item('שמן זית'); ok(oil.status === 'open' && oil.ordered == null, JSON.stringify(oil));
  });

  await check('S9-U6', 'מ27: "על האורחים" ב"מה למדתי", אחרי העובדות; לחיצה ו"מחיקה" עם "בטוח?"; ילד לא רואה', async () => {
    d1("INSERT INTO house_guests (name, eats, created, updated) VALUES ('גיסי', 'אוכל רק שניצל ותפוח אדמה', 1, 1)");
    await p.reload2(); await p.go('#settings');
    await p.evaluate(() => document.querySelectorAll('details').forEach((d) => { if (d.querySelector('.taught')) d.open = true; }));
    const t = await p.textContent('.taught'); ok(/על האורחים/.test(t) && /גיסי: אוכל רק שניצל ותפוח אדמה/.test(t), t.slice(0, 300));
    await p.$eval('[data-guest]', (e) => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(200);
    await p.screenshot({ path: 'docs/stage9-shots/S9-U6-guests.png' });
    await kid.reload2(); await kid.go('#settings');
    ok(!/על האורחים/.test(await kid.textContent('body')), 'a child sees them');
    await p.click('[data-guest]'); await p.waitForSelector('#g-del');
    await p.click('#g-del'); ok((await p.textContent('#g-del')) === 'למחוק באמת?', 'no "למחוק באמת?"');
    await p.click('#g-del'); await p.waitForTimeout(900);
    ok(d1q('SELECT COUNT(*) AS n FROM house_guests')[0].n === 0, 'not deleted');
  });

  await finish(b, 'test/stage9-ui-results.json');
})().catch((e) => { console.error(e); process.exit(1); });
