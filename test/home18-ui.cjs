// home18 (5, the owner 17/10): a tab of the list is a shopping trip, by where the house said it buys. Chromium and WebKit
// (UIS="test/home18-ui.cjs test/home18-ui.cjs@webkit").
//   H-5a: the house said "בסופר" and nothing is at the greengrocer's: no greengrocer tab; tomatoes in the supermarket's
//   H-5b: "בירקן": the tab is there, the tomatoes in it, and in the supermarket's too (as the other store)
//   H-5c: the answer in the settings, with the questions' words
const pw = require(process.env.PW), BR = process.env.PW_BROWSER || 'chromium', browser = pw[BR];
const { check, ok, phone, finish, d1 } = require('./sweep-lib.cjs');

(async () => {
  const b = await browser.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
  const p = await phone(b);
  const tabs = () => p.$$eval('.flaps .flap', (xs) => xs.map((x) => x.dataset.store));
  d1("INSERT OR REPLACE INTO settings (key, value) VALUES ('shop_asked', '1')");
  d1("INSERT INTO products (id, name, aliases, count_type, qty, created, updated, category_id, store, store2) VALUES (91801, 'עגבניות', '[]', 'units', 0, 0, 0, (SELECT id FROM categories WHERE name = 'ירקות ופירות'), 'super', NULL)");
  d1("INSERT INTO list_items (product_id, store, source, status, added_by, added) VALUES (91801, 'super', 'manual', 'open', 1, 0)");

  await check('H-5a', 'הבית ענה "בסופר" ואין כלום בירקן: אין לשונית ירקן, והעגבניות בסופר', async () => {
    await p.api('POST', '/api/settings', { shop_produce: 'super' });
    await p.reload2(); await p.go('#list'); await p.waitForTimeout(500);
    const t = await tabs();
    ok(!t.includes('greengrocer'), JSON.stringify(t)); ok(t.includes('super'), JSON.stringify(t));
    ok(/עגבניות/.test(await p.textContent('.listwrap')), 'the tomatoes');
  });
  await check('H-5b', '"בירקן": יש לשונית ירקן, העגבניות בה, וגם בסופר כחנות שנייה', async () => {
    await p.api('POST', '/api/settings', { shop_produce: 'greengrocer' });
    await p.reload2(); await p.go('#list'); await p.waitForTimeout(500);
    ok((await tabs()).includes('greengrocer'), JSON.stringify(await tabs()));
    await p.click('.flap[data-store="greengrocer"]'); await p.waitForTimeout(300);
    ok(/עגבניות/.test(await p.textContent('.listwrap')), 'not in the greengrocer\'s');
    await p.click('.flap[data-store="super"]'); await p.waitForTimeout(300);
    ok(/עגבניות/.test(await p.textContent('.also') || ''), 'not in the supermarket\'s as the other store');
  });
  await check('H-5c', 'בהגדרות: "איפה אתם קונים ירקות ופירות?" עם התשובה שנבחרה', async () => {
    await p.go('#settings'); await p.waitForTimeout(600);
    ok(await p.$eval('#shop-produce', (x) => x.value) === 'greengrocer', 'the answer');
    ok(/איפה אתם קונים ירקות ופירות\?/.test(await p.textContent('.panel.house')), 'the words');
    ok(!p.errors.length, p.errors.join(' | '));
  });
  await finish(b, `/tmp/shuki-test/home18-ui${BR === 'chromium' ? '' : `-${BR}`}.json`);
})();
