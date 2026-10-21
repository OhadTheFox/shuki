// The last round for home use (17/10), what the app shows. Chromium and WebKit (UIS="test/home17-ui.cjs test/home17-ui.cjs@webkit").
//   H-1 (ש3): "ניתוק המכשיר הזה" in a panel of its own at the bottom of the settings, "המכשיר הזה"; an admin's only phone, with
//        no other admin who has one: the words and "לחבר טלפון נוסף" (the code for the same person) instead; with a second
//        phone: the button, and its second tap "לנתק באמת?"
//   H-2 (ש4): "כן, אכתוב לך" sends nothing, only puts the cursor in the box
//   H-4 (ש16): "עוד N ימים לרמה X"
//   H-11 (ש13): "לפי מיקום", a long press on a product opens the places and a tap on one moves it (WebKit: shots before and after
//        in ../shuki-shots/r16h/, not in the repo)
const pw = require(process.env.PW), BR = process.env.PW_BROWSER || 'chromium', browser = pw[BR];
const { check, ok, phone, finish, d1 } = require('./sweep-lib.cjs');
const fs = require('node:fs'), path = require('node:path');
const SHOTS = path.resolve(__dirname, '../../shuki-shots/r16h');

(async () => {
  const b = await browser.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
  const p = await phone(b);
  const shot = async (name) => { if (BR !== 'webkit') return; fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: `${SHOTS}/${name}.png` }); };

  await check('H-1a', 'הטלפון היחיד של המנהל: פאנל "המכשיר הזה" בתחתית ההגדרות, עם המשפט ו"לחבר טלפון נוסף" במקום הכפתור', async () => {
    await p.go('#settings'); await p.waitForTimeout(800);
    const panel = await p.$eval('#thisDevice', (x) => ({ h: x.querySelector('h3')?.textContent, text: x.textContent, logout: !!x.querySelector('#logout'), next: x.nextElementSibling?.className }));
    ok(panel.h === 'המכשיר הזה', JSON.stringify(panel));
    ok(panel.text.includes('זה המכשיר היחיד שלך, ואין עוד מנהל עם טלפון. כדי לנתק אותו, קודם חבר טלפון נוסף.'), panel.text);
    ok(!panel.logout, 'the button is there');
    ok(panel.next === 'privacy', `after it: ${panel.next}`);
    ok(!(await p.$('#devBox + * #logout, .panel #logout')), 'a logout button elsewhere');
    await p.click('#thisDevice [data-code]'); await p.waitForTimeout(600);
    const code = await p.$eval('#myCodeBox', (x) => x.textContent);
    ok(/הקוד של אבי/.test(code) && /\d{6}/.test(code), code);
  });
  await check('H-1b', 'עם טלפון נוסף של מנהל: הכפתור בפאנל, והלחיצה הראשונה "לנתק באמת?"', async () => {
    const q = await phone(b); await q.ctx.close();
    await p.reload2(); await p.go('#settings'); await p.waitForTimeout(800);
    ok(await p.$('#thisDevice #logout'), 'no button');
    await p.click('#thisDevice #logout');
    ok((await p.$eval('#thisDevice #logout', (x) => x.textContent)) === 'לנתק באמת?', 'second tap words');
    await p.go('#chat'); // not the second tap
  });
  await check('H-2', '"כן, אכתוב לך" לא שולח הודעה: רק הסמן עובר לתיבת הכתיבה', async () => {
    d1(`INSERT INTO chat (ts, user_id, role, thread, content) VALUES (${Date.now()}, NULL, 'shuki', 1, '${JSON.stringify({ reply: 'האם יש מישהו בבית שלא אוכל משהו?', face: 'happy', options: ['לא', 'כן, אכתוב לך'], for: 1 })}')`);
    await p.reload2(); await p.go('#chat'); await p.waitForSelector('[data-opt="כן, אכתוב לך"]');
    const n = async () => (await p.api('GET', '/api/chat')).messages.length, before = await n();
    const sent = []; p.on('request', (r) => { if (r.method() === 'POST' && /\/api\/chat$/.test(r.url())) sent.push(r.url()); });
    await p.click('[data-opt="כן, אכתוב לך"]'); await p.waitForTimeout(800);
    ok(!sent.length, `sent: ${sent.length}`);
    ok(await p.evaluate(() => document.activeElement?.id === 'say'), 'the box has no focus');
    ok(before === (await n()), 'the chat changed');
  });
  await check('H-4', 'בהגדרות: "עוד N ימים לרמה X" / "עוד יום אחד לרמה X"', async () => {
    await p.go('#settings'); await p.waitForTimeout(600);
    const t = await p.$eval('.xpnext', (x) => x.textContent);
    ok(/^עוד (\d+ ימים|יום אחד) לרמה \d+$/.test(t), t);
  });
  await check('H-11', 'לפי מיקום: לחיצה ארוכה פותחת את המקומות, הקשה על מקום מעבירה (2 צעדים)', async () => {
    await p.api('POST', '/api/actions', { actions: [{ kind: 'create', product: { name: 'פפריקה מעושנת', count_type: 'units', qty: 1, location_id: 'ארון מטבח' } }] });
    await p.evaluate(() => localStorage.setItem('shuki.invMode', JSON.stringify('loc')));
    await p.go('#inventory'); await p.reload2(); await p.go('#inventory');
    await shot('1-before');
    const row = p.locator('#invList [data-p]', { hasText: 'פפריקה מעושנת' });
    const box = await row.boundingBox();
    await p.mouse.move(box.x + 20, box.y + box.height / 2); await p.mouse.down(); await p.waitForTimeout(700); await p.mouse.up();
    await p.waitForSelector('.moveto [data-to]');
    await shot('2-places');
    const cur = await p.$eval('.moveto [aria-current]', (x) => x.textContent);
    ok(cur === 'ארון מטבח', `marked: ${cur}`);
    ok(!(await p.$('#f-name')), 'the product sheet opened too');
    await p.click('.moveto [data-to]:has-text("מזווה")'); await p.waitForTimeout(1200);
    const s = await p.state();
    const pp = s.products.find((x) => x.name === 'פפריקה מעושנת');
    ok(s.locations.find((l) => l.id === pp.location_id)?.name === 'מזווה', JSON.stringify(pp.location_id));
    await shot('3-after');
    const group = await p.evaluate(() => { const r = [...document.querySelectorAll('#invList [data-p]')].find((x) => x.textContent.includes('פפריקה מעושנת')); let e = r; while (e && !e.classList?.contains('loc')) e = e.previousElementSibling; return e?.textContent; });
    ok(group === 'מזווה', `under ${group}`);
    // a plain tap still opens the product
    await row.click(); await p.waitForSelector('#f-name'); await p.keyboard.press('Escape');
    ok(!p.errors.length, p.errors.join(' | '));
  });
  await finish(b, `/tmp/shuki-test/home17-ui${BR === 'chromium' ? '' : `-${BR}`}.json`);
})();
