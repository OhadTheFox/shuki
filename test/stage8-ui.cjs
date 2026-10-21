// Stage 8 screens (docs/stage8-plan.md): what the food gantt shows. Each check names its task.
// Run under tools/runall.sh (UIS="test/stage8-ui.cjs").
const { chromium } = require(process.env.PW);
const lib = require('./sweep-lib.cjs');
const { check, ok, phone, finish, d1, d1q } = lib;
(async () => {
  const b = await chromium.launch();
  d1("INSERT OR REPLACE INTO users (id, name, gender, role, active, created) VALUES (3, 'יואבי', 'm', 'child', 1, 0)");
  const p = await phone(b, { w: 390, h: 844 });           // Avi, the admin
  const kid = await phone(b, { w: 390, h: 844, user: 3 }); // Yoavi, a child
  for (const r of [
    { name: 'שקשוקה', ingredients: '4 ביצים\n3 עגבניות', text: 'מבשלים.', tags: 'ארוחות בוקר', serves: 2 },
    { name: 'מרק עדשים', ingredients: 'עדשים\nבצל', text: 'מבשלים.', tags: 'מרקים', serves: 4 },
  ]) await p.api('POST', '/api/recipes', r);
  const shak = d1q("SELECT id FROM recipes WHERE name = 'שקשוקה'")[0].id;

  await check('S8-ui-g10a', 'ג10 (ב, כוכב): בלי מועדפות אין סינון "מועדפות" ואין כוכב; אחרי סימון: כוכב לפני השם (לקורא מסך "מנה מועדפת") וסינון "מועדפות" אחרי "אפשר להכין עכשיו"', async () => {
    await p.reload2(); await p.go('#recipes');
    ok(!(await p.$('.rfilters [data-rf="fav"]')), 'a filter with no favourites');
    ok(!(await p.$('.rcard .fav-mark')), 'a star with no favourites');
    await p.api('POST', `/api/recipes/${shak}/favorite`, { on: true });
    await p.reload2(); await p.go('#recipes');
    const chips = await p.$$eval('.rfilters [data-rf]', (xs) => xs.map((x) => x.dataset.rf));
    ok(chips[0] === 'now' && chips[1] === 'fav', JSON.stringify(chips));
    ok((await p.textContent('.rfilters [data-rf="fav"]')).trim() === 'מועדפות');
    const card = await p.$eval('.rcard .fav-mark', (x) => ({ label: x.getAttribute('aria-label'), name: x.closest('.rcard').querySelector('.rname bdi').textContent }));
    ok(card.label === 'מנה מועדפת' && card.name === 'שקשוקה', JSON.stringify(card));
    await p.click('.rfilters [data-rf="fav"]'); await p.waitForTimeout(300);
    const names = await p.$$eval('.rcard .rname bdi', (xs) => xs.map((x) => x.textContent));
    ok(names.join() === 'שקשוקה', JSON.stringify(names));
    await p.click('.rfilters [data-rf="fav"]'); await p.waitForTimeout(300);
  });

  await check('S8-ui-g10b', 'ג10: בדף המתכון הכפתור "מנה מועדפת" (aria-pressed, 44px לפחות) מוריד ומסמן; לילד אין כפתור', async () => {
    await p.click(`[data-rec="${shak}"]`); await p.waitForSelector('#rFav');
    const btn = await p.$eval('#rFav', (x) => ({ t: x.textContent.trim(), pressed: x.getAttribute('aria-pressed'), h: x.getBoundingClientRect().height }));
    ok(btn.t === 'מנה מועדפת' && btn.pressed === 'true' && btn.h >= 44, JSON.stringify(btn));
    await p.click('#rFav'); await p.waitForTimeout(800);
    ok(d1q(`SELECT favorite FROM recipes WHERE id = ${shak}`)[0].favorite === 0, 'not off');
    ok((await p.getAttribute('#rFav', 'aria-pressed')) === 'false', 'still pressed');
    await p.click('#rFav'); await p.waitForTimeout(800);
    ok(d1q(`SELECT favorite FROM recipes WHERE id = ${shak}`)[0].favorite === 1, 'not back on');
    await kid.reload2(); await kid.go('#recipes'); await kid.click(`[data-rec="${shak}"]`); await kid.waitForTimeout(500);
    ok(!(await kid.$('#rFav')), 'the child has the button');
  });

  await check('S8-ui-a5', 'א5 (ב, בועה בתחתית): למי שאמר כן, "התוקף של הקוטג\' עומד לפוג מחר. האם תרצי רעיון למנה איתו?" [כן, תציע] [לא עכשיו]; "לא עכשיו" מוריד אותה', async () => {
    const m = await phone(b, { w: 390, h: 844, user: 2 }); // Michal
    const t = new Date(Date.now() + 86400e3); t.setHours(12, 0, 0, 0);
    d1(`INSERT INTO products (id, name, count_type, qty, expires, created, updated) VALUES (88001, 'קוטג''', 'units', 1, ${t.getTime()}, 1, 1)`);
    d1("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('person', 2, 'suggest_optin', 'כן', 1, 2, 2, 0, 'chat', 1, 1)");
    await m.reload2(); await m.go('#chat'); await m.waitForTimeout(600);
    const last = await m.$$eval('.msg.bot', (xs) => xs.at(-1)?.textContent.trim());
    ok(last === "התוקף של הקוטג' עומד לפוג מחר. האם תרצי רעיון למנה איתו?", last);
    const chips = await m.$$eval('.chips.sug .chip', (xs) => xs.map((x) => ({ t: x.textContent.trim(), h: x.getBoundingClientRect().height })));
    ok(chips.map((c) => c.t).join('|') === 'כן, תציע|לא עכשיו' && chips.every((c) => c.h >= 44), JSON.stringify(chips));
    await m.screenshot({ path: '/tmp/shuki-test/s8-a5-card.png' });
    await m.click('[data-sug="no"]'); await m.waitForTimeout(800);
    ok(!(await m.$('.chips.sug')), 'still up after "לא עכשיו"');
    await m.reload2(); await m.go('#chat'); await m.waitForTimeout(600);
    ok(!(await m.$('.chips.sug')), 'back after a reload');
  });

  await check('S8-ui-e1', 'ה1 (א, בלי יד): אחרי face strong, לכמה שניות: הפרצוף השרירי, טיפת זיעה וסרט הזיעה (גם בלי המלתחה), ואז חזרה; "שרירי" ב-MOOD_NAMES; ב-Reduce Motion בלי קפיצה', async () => {
    const m = await phone(b, { w: 390, h: 844, user: 1 });
    await m.reload2(); await m.go('#chat'); await m.waitForTimeout(500);
    const look = () => m.evaluate(() => { const s = document.querySelector('.mascot svg.shuki'); const g = s.querySelector('.m-strong');
      return { mood: s.dataset.mood, face: g && getComputedStyle(g).opacity, band: getComputedStyle(s.querySelector('.acc-band')).display, sweat: getComputedStyle(s.querySelector('.fx-sweat')).opacity, jump: s.classList.contains('r-jump') }; });
    ok((await look()).band === 'none', 'the band before');
    await m.fill('#say', 'אני אחרי אימון'); await m.click('#send'); await m.waitForTimeout(1200);
    // stage 10 (t3): at night the first message wakes Shuki up for 2.5 s before the answer's face
    await m.waitForFunction(() => document.querySelector('.mascot svg.shuki').dataset.mood !== 'waking', null, { timeout: 4000 }).catch(() => {}); await m.waitForTimeout(300);
    const on = await look();
    ok(on.mood === 'strong' && on.face === '1' && on.band === 'inline' && on.sweat === '1', JSON.stringify(on));
    await m.locator('.mascot').screenshot({ path: '/tmp/shuki-test/s8-e1-strong.png' });
    ok(!/שאציע לך מנות/.test(await m.$$eval('.msg.bot', (xs) => xs.at(-1).textContent)), 'a second question after the model\'s');
    await m.waitForTimeout(3200);
    const after = await look();
    ok(after.mood !== 'strong' && after.band === 'none', JSON.stringify(after));
    const names = await m.evaluate(async () => (await import('./shuki.js')).MOOD_NAMES.strong);
    ok(names === 'שרירי', names);
    await m.emulateMedia({ reducedMotion: 'reduce' });
    await m.fill('#say', 'אני אחרי אימון'); await m.click('#send'); await m.waitForTimeout(1200);
    const calm = await m.evaluate(() => getComputedStyle(document.querySelector('.mascot svg.shuki .rig')).animationName);
    ok(!/jump/.test(calm), calm);
  });

  await finish(b, '/tmp/shuki-test/stage8-ui.json');
})().catch((e) => { console.error(e); process.exit(1); });
