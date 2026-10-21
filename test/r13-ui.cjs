// Round 13 screens: own stores (tabs, product sheet, delete), Passover, recipes, the four photo kinds, reminder time.
// Run: test/ui-qa.sh test/r13-ui.cjs
const { chromium } = require(process.env.PW);
const lib = require('./sweep-lib.cjs');
const { check, ok, phone, finish } = lib;
(async () => {
  const b = await chromium.launch();
  const p = await phone(b, { w: 320, h: 568 }); // the narrowest phone
  await p.api('POST', '/api/actions', { actions: [
    { kind: 'create', product: { name: 'פסטה', count_type: 'units', unit: 'שקית', qty: 1, is_basic: 1, target: 1 } },
    { kind: 'create', product: { name: 'חלב', count_type: 'units', unit: 'קרטון', qty: 1 } },
  ] });
  const bodyW = () => p.evaluate(() => document.documentElement.scrollWidth);

  await check('U1', 'הוספת חנות בהגדרות → לשונית ברשימה; 5 חנויות משלכם במסך צר: הלשוניות נגללות, בלי גלילה של הדף', async () => {
    await p.go('#settings');
    for (const n of ['קצב', 'טרמפ', 'חנות טבע', 'מאפייה', 'יין']) { await p.fill('#newStore input', n); await p.click('#newStore button'); await p.waitForTimeout(700); }
    const t = await p.textContent('.set'); ok(/קצב/.test(t) && /יין/.test(t), 'not listed');
    await p.fill('#newStore input', 'עוד אחת'); await p.click('#newStore button'); await p.waitForTimeout(700);
    ok(/עד 5/.test(await p.textContent('#toast, .toast, body')), 'no limit message');
    await p.go('#list');
    const tabs = await p.$$eval('.flap', (xs) => xs.map((x) => x.textContent));
    // home18 (5): a greengrocer's or pharmacy's tab only when the house goes there or something is in it: the supermarket and the five
    ok(tabs.length === 6 && tabs.some((x) => /קצב/.test(x)), JSON.stringify(tabs));
    ok(await bodyW() <= 320, `page scrolls sideways: ${await bodyW()}`);
    await p.click('.flap:has-text("קצב")'); await p.waitForTimeout(400);
    ok(/אין כלום לקנות בקצב/.test(await p.textContent('main')), 'empty butcher tab');
    await p.screenshot({ path: '/tmp/shuki-test/r13-tabs.png' });
    return tabs.join(' ');
  });

  await check('U2', 'בדף מוצר אפשר לבחור את החנות החדשה, והפריט עובר ללשונית שלה', async () => {
    const s = await p.state(); const k = s.stores.find((x) => x.name === 'קצב');
    await p.api('POST', '/api/actions', { actions: [{ kind: 'create', product: { name: 'שניצל', count_type: 'units', qty: 0, store: k.id } }, { kind: 'list_add', text: 'שניצל' }] });
    await p.reload2(); await p.go('#list'); await p.click('.flap:has-text("קצב")'); await p.waitForTimeout(400);
    ok(/שניצל/.test(await p.textContent('main')), 'not on the butcher tab');
    await p.go('#inventory'); await p.waitForTimeout(300);
    await p.click('text=שניצל'); await p.waitForTimeout(500);
    const opts = await p.$$eval('#f-store option', (xs) => xs.map((x) => x.textContent));
    ok(opts.includes('קצב'), JSON.stringify(opts));
    ok((await p.$eval('#f-store', (x) => x.value)) === k.id, 'selected');
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    return opts.join(',');
  });

  await check('U3', 'מחיקת חנות: דורשת אישור, והשניצל חוזר לסופר', async () => {
    await p.go('#settings');
    const s = await p.state(); const k = s.stores.find((x) => x.name === 'קצב');
    await p.click(`[data-store-del="${k.id}"]`); await p.waitForTimeout(300);
    ok(/למחוק באמת\?/.test(await p.textContent(`[data-store-del="${k.id}"]`)), 'no confirm step');
    await p.click(`[data-store-del="${k.id}"]`); await p.waitForTimeout(900);
    const s2 = await p.state(); ok(!s2.stores.some((x) => x.id === k.id), 'still there');
    ok(s2.products.find((x) => x.name === 'שניצל').store === 'super', 'product store');
    for (const x of s2.stores.filter((y) => y.custom)) { await p.click(`[data-store-del="${x.id}"]`); await p.waitForTimeout(200); await p.click(`[data-store-del="${x.id}"]`); await p.waitForTimeout(700); }
    await p.go('#list'); ok((await p.$$('.flap')).length === 1, `one tab again (home18, 5): ${(await p.$$('.flap')).length}`);
  });

  await check('U4', 'מצב פסח: הפעלה מראה מה חמץ בבית, הכפתור מתחלף, כיבוי', async () => {
    // the panel is there only around Passover or after it came up in the chat (16/10): a message about it this week
    lib.d1(`INSERT INTO chat (ts, user_id, role, content, thread) VALUES (${Date.now()}, 1, 'user', '{"text":"מתי פסח השנה?"}', 1)`); await p.reload2();
    await p.go('#settings'); await p.click('#pesach'); await p.waitForSelector('.sheet h2:has-text("מצב פסח")');
    const t = await p.textContent('.sheet'); ok(/פסטה/.test(t) && !/חלב/.test(t), t);
    await p.screenshot({ path: '/tmp/shuki-test/r13-pesach.png' });
    await p.click('.sheet [data-close]'); await p.waitForTimeout(700);
    ok(/לכבות/.test(await p.textContent('#pesach')), 'button');
    await p.click('#pesach'); await p.waitForTimeout(800);
    ok(/להפעיל/.test(await p.textContent('#pesach')), 'off again');
    return t.trim().slice(0, 80);
  });

  await check('U5', 'מתכונים (מסבב 21 בלשונית שלהם): פתיחה, סגירה, מחיקה עם אישור', async () => {
    lib.d1("INSERT INTO recipes (id, name, ingredients, text, added_by, added) VALUES (1, 'שקשוקה', '4 ביצים, 3 עגבניות, בצל', 'מטגנים בצל. מוסיפים עגבניות. שוברים ביצים.', 1, 1)");
    await p.reload2(); await p.go('#recipes');
    await p.click('[data-rec="1"]'); await p.waitForSelector('.sheet h2:has-text("שקשוקה")');
    ok(/שוברים ביצים/.test(await p.textContent('.sheet')), 'steps');
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await p.click('[data-rec="1"]'); for (let i = 0; i < 3; i++) { await p.click('#rDel'); await p.waitForTimeout(200); } await p.waitForTimeout(800);
    ok(!(await p.state()).recipes.length, 'not deleted');
  });

  await check('U6', 'צילום בצ\'אט: ארבע אפשרויות (קבלה, מוצר אחד, מקרר / מדף, מתכון), כולן על המסך, ויש ביטול', async () => {
    await p.go('#chat');
    await p.setInputFiles('#photo', 'test/product-sample.jpg'); await p.waitForSelector('.sheet h2:has-text("מה בתמונה")');
    const vis = await p.$$eval('.sheet .kinds .btn', (xs) => xs.map((x) => { const r = x.getBoundingClientRect(); return [x.textContent, r.bottom <= innerHeight && r.top >= 0]; }));
    ok(vis.length === 4 && vis.every((v) => v[1]), JSON.stringify(vis));
    await p.screenshot({ path: '/tmp/shuki-test/r13-kinds.png' });
    await p.click('.sheet [data-close]'); await p.waitForTimeout(300);
    ok(!(await p.$('.sheet')), 'did not close');
    return vis.map((v) => v[0]).join(' / ');
  });

  await check('U7', 'תזכורת עם שעה ב"נחשוב על זה": תאריך ושעה', async () => {
    const at = new Date(); at.setDate(at.getDate() + 2); at.setHours(18, 30, 0, 0);
    lib.d1(`INSERT INTO maybe (text, store, added_by, added, due_at, kind) VALUES ('נרות', 'super', 1, ${Date.now()}, ${at.getTime()}, 'remind')`);
    await p.reload2(); await p.go('#list');
    const t = await p.textContent('.maybe'); ok(/נרות/.test(t) && /18:30/.test(t), t);
    return t.replace(/\s+/g, ' ').trim();
  });
  ok(!p.errors.length, p.errors.join('; '));
  await finish(b, 'test/r13-ui-results.json');
})();
