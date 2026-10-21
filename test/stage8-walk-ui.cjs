// Stage 8, ט3 (docs/stage8-plan.md): a walk through what stage 8 added, on a phone, with a screenshot of each for the owner.
// The fake model (test/fake-claude.cjs); run under tools/runall.sh, in Chromium and in WebKit (UIS="test/stage8-walk-ui.cjs
// test/stage8-walk-ui.cjs@webkit"). The pictures: /tmp/shuki-test/s8-walk-<browser>/.
const pw = require(process.env.PW);
const lib = require('./sweep-lib.cjs');
const { check, ok, phone, finish, d1, d1q } = lib;
const fs = require('node:fs');
const engine = process.env.PW_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const DIR = `/tmp/shuki-test/s8-walk-${engine}`;
fs.mkdirSync(DIR, { recursive: true });
(async () => {
  const b = await pw[engine].launch();
  const p = await phone(b, { w: 390, h: 844 }); // Avi, the admin
  const shot = (name) => p.screenshot({ path: `${DIR}/${name}.png` });
  const send = async (t) => { await p.fill('#say', t); await p.click('#send'); await p.waitForTimeout(1500); };
  const lastBot = () => p.$$eval('.msg.bot', (xs) => xs.at(-1)?.textContent.trim() || '');

  await check('S8-walk-1', 'ב6 וז2 בהיכרות: "האם כל הבית אוכל כשר, או רק מיכל?" [כל הבית] [רק מיכל], ואחריו שאלת סגנון החיים עם [כן, אכתוב לך] [לא] [בוא נדלג על זה כרגע], "כן, אכתוב לך" בלי מילים, ו"רשמתי ש…"', async () => {
    d1(`INSERT OR REPLACE INTO settings (key, value) VALUES ('onboard', '${JSON.stringify({ step: 'food', user: 1, me: { name: 'אבי', gender: 'm' }, people: [{ name: 'מיכל', gender: 'f' }], started: Date.now() - 3600e3 })}')`);
    d1("DELETE FROM settings WHERE key = 'house_notes'");
    await p.reload2(); await p.go('#chat'); await p.waitForTimeout(600);
    await send('מיכל שומרת כשרות');
    ok(/^האם כל הבית אוכל כשר, או רק מיכל\?$/.test(await lastBot()), await lastBot());
    await shot('1-kosher');
    await p.click('[data-opt="כל הבית"]'); await p.waitForTimeout(1500);
    ok(/סגנון החיים שלך שכדאי שאדע\? למשל אימונים או דיאטה\./.test(await lastBot()), await lastBot());
    await p.waitForSelector('[data-opt="בוא נדלג על זה כרגע"]', { timeout: 6000 }).catch(() => {});
    const opts = await p.$$eval('[data-opt]', (xs) => xs.map((x) => x.dataset.opt));
    ok(['כן, אכתוב לך', 'לא', 'בוא נדלג על זה כרגע'].every((o) => opts.includes(o)), opts.join(' | ')); // r8z, question 46
    await shot('2-life');
    const bots = await p.$$eval('.msg.bot', (xs) => xs.length);
    await p.click('[data-opt="כן, אכתוב לך"]'); await p.waitForTimeout(1500);
    ok(await p.$$eval('.msg.bot', (xs) => xs.length) === bots, 'Shuki said something after "כן, אכתוב לך"');
    await send('אני מתאמן 4 פעמים בשבוע');
    const said = await p.$$eval('.msg.bot', (xs) => xs.map((x) => x.textContent.trim()).join(' | '));
    ok(/רשמתי שאתה מתאמן 4 פעמים בשבוע\./.test(said), said);
    await shot('3-life-answer');
    d1("DELETE FROM settings WHERE key = 'onboard'");
  });

  await check('S8-walk-2', 'א5: "מה שוקי למד" מראה "הצעות לארוחות", והבועה בתחתית הצ\'אט', async () => {
    d1("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 1, 'suggest_optin', 'כן', 1, 1, 1, 0, 'chat', 1, 1)");
    const t = new Date(Date.now() + 86400e3); t.setHours(12, 0, 0, 0);
    d1(`INSERT INTO products (id, name, count_type, qty, expires, created, updated) VALUES (88101, 'קוטג''', 'units', 1, ${t.getTime()}, 1, 1)`);
    await p.reload2(); await p.go('#settings'); await p.waitForTimeout(700);
    await p.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
    const taught = await p.$eval('.panel.taught', (x) => x.textContent);
    ok(/הצעות לארוחות/.test(taught), taught.slice(0, 200));
    await p.locator('.panel.taught').screenshot({ path: `${DIR}/4-learned.png` });
    await p.go('#chat'); await p.waitForTimeout(800);
    ok(/האם תרצה רעיון למנה איתו\?/.test(await lastBot()), await lastBot());
    await shot('5-a5-bubble');
    d1('DELETE FROM products WHERE id = 88101'); d1("DELETE FROM facts WHERE key = 'suggest_optin'");
  });

  await check('S8-walk-3', 'ג10: הכוכב, הסינון "מועדפות" והכפתור "מנה מועדפת"', async () => {
    await p.api('POST', '/api/recipes', { name: 'שקשוקה', ingredients: '4 ביצים\n3 עגבניות', text: 'מבשלים.', tags: 'ארוחות בוקר', serves: 2 });
    const id = d1q("SELECT id FROM recipes WHERE name = 'שקשוקה' ORDER BY id DESC LIMIT 1")[0].id;
    await p.api('POST', `/api/recipes/${id}/favorite`, { on: true });
    await p.reload2(); await p.go('#recipes'); await p.waitForTimeout(700);
    ok(!!(await p.$('.rcard .fav-mark')), 'no star');
    await shot('6-favorites');
    await p.click(`[data-rec="${id}"]`); await p.waitForSelector('#rFav');
    await shot('7-favorite-sheet');
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  });

  await check('S8-walk-4', 'ה1: הפרצוף השרירי אחרי "אני אחרי אימון"', async () => {
    await p.go('#chat'); await p.waitForTimeout(400);
    await send('אני אחרי אימון');
    const mood = await p.$eval('.mascot svg.shuki', (s) => s.dataset.mood);
    ok(mood === 'strong', mood);
    await p.locator('.mascot').screenshot({ path: `${DIR}/8-strong.png` });
  });

  await finish(b, `/tmp/shuki-test/stage8-walk-${engine}.json`);
})().catch((e) => { console.error(e); process.exit(1); });
