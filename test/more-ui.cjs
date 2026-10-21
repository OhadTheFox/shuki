// UI for the eight additions, phone-sized Chromium. Run: test/ui-qa.sh test/more-ui.cjs
const { chromium } = require(process.env.PW);
const { execSync } = require('node:child_process');
const BASE = process.env.BASE || 'http://127.0.0.1:8791';
const S = '/tmp/shuki-test/shuki-uiqa';
const d1 = (sql) => execSync(`npx wrangler d1 execute shuki --local --persist-to ${S} --command "${sql.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
const results = [];
const check = async (id, name, fn) => {
  try { const note = await fn(); results.push({ id, name, ok: true, note: note || '' }); console.log('✓', id, name, note ? `— ${note}` : ''); }
  catch (e) { results.push({ id, name, ok: false, error: e.message.split('\n')[0] }); console.log('✗', id, name, '\n   ', e.message.split('\n')[0]); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };
const shot = (p, n) => p.screenshot({ path: `/tmp/shuki-test/m-${n}.png`, fullPage: true });

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', hasTouch: true }); await ctx.addInitScript(() => { new MutationObserver(() => document.querySelectorAll('details.fold:not([data-t])').forEach((d) => { d.dataset.t = 1; d.open = true; })).observe(document, { childList: true, subtree: true }); }); // settings folds open (01/10)
  const p = await ctx.newPage(); const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(BASE + '/'); await p.fill('#code', '111111'); await p.click('#pair button[type=submit]'); await p.waitForSelector('#say');
  const api = (method, path, body) => p.evaluate(async ([m, u, bd]) => { const r = await fetch(u, { method: m, headers: { 'content-type': 'application/json', authorization: `Bearer ${JSON.parse(localStorage.getItem('shuki.token'))}` }, body: bd ? JSON.stringify(bd) : undefined }); return r.json(); }, [method, path, body]);
  await api('POST', '/api/actions', { actions: [
    { kind: 'create', product: { name: 'טונה', count_type: 'units', unit: 'קופסה', qty: 4, is_basic: 1, target: 2, location_id: 'מזווה' } },
    { kind: 'create', product: { name: 'במבה', count_type: 'units', unit: 'שקית', qty: 3, location_id: 'מזווה' } },
    { kind: 'create', product: { name: 'ביצים', count_type: 'pack', pack_size: 12, qty: 0, is_basic: 1, target: 12, location_id: 'מקרר' } },
    { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 2, shelf_days: 7, open_days: 4, location_id: 'מקרר' } },
    { kind: 'create', product: { name: 'עגבניות', count_type: 'level', level: 'plenty', location_id: 'מקרר' } },
    { kind: 'create', product: { name: 'לחם', count_type: 'units', unit: 'כיכר', qty: 0, location_id: 'ארון מטבח' } },
  ] });
  const go = async (hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForTimeout(400); };
  const reload = async () => { await p.reload(); await p.waitForTimeout(800); };

  await check('W1', '"רגע, יש לנו?" רק במצב קניות; טונה → "לא צריך", ביצים → "נגמר", לא מוכר → "אין לי רשום"', async () => {
    await go('#list'); await reload();
    ok(!(await p.$('#haveQ')), 'no box before the trip');
    await p.click('#tripGo'); await p.waitForSelector('#haveQ');
    await p.fill('#haveQ', 'טונה');
    const t = await p.textContent('#haveA');
    ok(/יש 4 קופסאות · במזווה/.test(t) && /יש מספיק בבית/.test(t), t);
    await p.fill('#haveQ', 'הביצים');
    const e = await p.textContent('#haveA');
    ok(/נגמר · ברשימה/.test(e), e);
    await p.fill('#haveQ', 'עגבניות');
    ok(/יש הרבה · במקרר/.test(await p.textContent('#haveA')), 'level wording');
    await p.fill('#haveQ', 'אננס');
    ok(/זה לא רשום אצלי/.test(await p.textContent('#haveA')));
    await p.fill('#haveQ', 'טונה');
    await shot(p, 'w1-have');
    await p.waitForTimeout(11000); // a refresh passes (shopping: every 10s)
    ok((await p.inputValue('#haveQ')) === 'טונה', 'what I typed survives the refresh');
    return t.replace(/\s+/g, ' ').trim();
  });

  await check('W4', 'סיום קנייה: חשבונית "מהרשימה / נשאר ברשימה"', async () => {
    await p.fill('#haveQ', '');
    await p.click('.item:has-text("ביצים")'); await p.waitForTimeout(700); // a tap: in the cart as listed (decision 171)
    await p.click('#finish'); await p.waitForSelector('.receipt');
    const t = await p.textContent('.receipt');
    ok(/מהרשימה\s*ביצים/.test(t), t);
    await shot(p, 'w4-receipt');
    await p.click('.sheet [data-close]');
    return t.replace(/\s+/g, ' ').trim();
  });

  await check('W5', 'אזהרה בהוספה: "במבה" → "יש 3 שקיות · במזווה. להוסיף בכל זאת?"; לא צריך / להוסיף', async () => {
    await p.fill('#addTxt', 'במבה'); await p.click('#adder button[type=submit]');
    await p.waitForSelector('.sheet .warn');
    const t = await p.textContent('.sheet .warn');
    ok(/יש כבר 3 שקיות במבה במזווה\. האם תרצה שאוסיף לרשימה בכל זאת\?/.test(t), t);
    await shot(p, 'w5-warn');
    await p.click('#w-no'); await p.waitForTimeout(500);
    ok(!(await p.$('.item:has-text("במבה")')), 'not added');
    await p.fill('#addTxt', 'במב'); await p.click('.chip[data-add]'); await p.waitForSelector('#w-yes'); await p.click('#w-yes'); await p.waitForTimeout(900);
    ok(await p.$('.item:has-text("במבה")'), 'added anyway');
    await p.fill('#addTxt', 'לחם'); await p.click('#adder button[type=submit]'); await p.waitForTimeout(900);
    ok(!(await p.$('.sheet')), 'out of bread: no warning');
    ok(await p.$('.item:has-text("לחם")'), 'bread added straight away');
    return t;
  });

  await check('W6', '"לחשוב על זה" מההוספה; אחרי 48 שעות: לרשימה / ויתרנו', async () => {
    await p.fill('#addTxt', 'מכונת קפה'); await p.click('#thinkChip'); await p.waitForSelector('.maybe');
    ok(/אשאל שוב מחר/.test(await p.textContent('.maybe')), await p.textContent('.maybe'));
    d1(`UPDATE maybe SET added = added - ${49 * 3600e3}`);
    await reload(); await p.waitForSelector('.maybe [data-d=list]');
    ok(/האם עדיין רוצים לקנות מכונת קפה\?/.test(await p.textContent('.maybe')));
    await shot(p, 'w6-maybe');
    await p.click('.maybe [data-d=drop]'); await p.waitForTimeout(900);
    const t = await p.textContent('.maybe');
    ok(/החודש ויתרתם על מוצר אחד שכבר היה בבית/.test(t), t);
    return t.replace(/\s+/g, ' ').trim();
  });

  await check('W2', 'ספירה שבועית בצ\'אט: (3) על הלשונית; כן מוריד; תקן פותח כמה יש ושומר', async () => {
    const ids = await p.evaluate(() => JSON.parse(localStorage.getItem('shuki.state')).products.filter((x) => ['טונה', 'במבה', 'עגבניות'].includes(x.name)).map((x) => x.id));
    d1(`INSERT OR REPLACE INTO settings (key, value) VALUES ('recount_at', '${Date.now() - 1000}'), ('recount_ids', '${JSON.stringify(ids)}')`);
    await go('#chat'); await reload(); await p.waitForSelector('.coupon.recount');
    ok(/צ'אט \(3 שאלות פתוחות\)/.test(await p.textContent('.nav')), await p.textContent('.nav'));
    await shot(p, 'w2-recount');
    await p.click('.rq:has-text("טונה") [data-rc-yes]'); await p.waitForTimeout(1200);
    ok(!(await p.$('.rq:has-text("טונה")')), 'tuna answered');
    await p.click('.rq:has-text("עגבניות") [data-rc-fix]'); await p.waitForSelector('#c-level');
    await p.click('#c-level [data-v=little]'); await p.click('#c-ok'); await p.waitForTimeout(1200);
    ok(!(await p.$('.coupon.recount:not(.low-card) .rq:has-text("עגבניות")')), 'still in the recount');
    ok(await p.$('.low-card .rq:has-text("עגבניות")'), 'no "נשאר מעט" question after marking it low');
    // stage 5, ש2: one card at a time ("נשאר מעט" before the recount); answered, the recount comes back
    ok(!(await p.$('.rq:has-text("במבה") [data-rc-fix]')), 'two cards at once');
    await p.click('.low-card [data-low][data-d="no"]'); await p.waitForTimeout(1200); await p.waitForSelector('.rq:has-text("במבה") [data-rc-fix]');
    await p.click('.rq:has-text("במבה") [data-rc-fix]'); await p.waitForSelector('#c-n');
    await p.click('.sheet [data-d="-1"]'); await p.click('#c-ok'); await p.waitForTimeout(1200);
    ok(!(await p.$('.coupon.recount:not(.low-card)')), 'all answered: the card is gone');
    const st = await p.evaluate(() => JSON.parse(localStorage.getItem('shuki.state')).products.filter((x) => ['במבה', 'עגבניות'].includes(x.name)).map((x) => `${x.name}:${x.text}`));
    ok(st.includes('עגבניות:נשאר מעט'), st.join());
    return st.join(' · ');
  });

  await check('W7', 'מלאי: "אחרי פתיחה מחזיק"; "פתחנו" → תג "פתוח"', async () => {
    await go('#inventory'); await p.click('.fr:has-text("חלב 3%")'); await p.waitForSelector('#f-opend');
    ok((await p.inputValue('#f-opend')) === '4');
    await p.click('#openBtn'); await p.waitForTimeout(1200);
    const row = await p.textContent('.fr:has-text("חלב 3%")');
    ok(/פתוח/.test(row), row);
    return row.replace(/\s+/g, ' ').trim();
  });

  await check('W8', 'הגדרות: חופשה עד תאריך → בכותרת "בחופשה עד"; חזרנו', async () => {
    await go('#settings'); await p.waitForSelector('#awayUntil');
    const d = new Date(Date.now() + 4 * 86400e3).toISOString().slice(0, 10);
    await p.fill('#awayUntil', d); await p.click('#awayForm button[type=submit]'); await p.waitForSelector('#awayEnd');
    await go('#chat');
    const sub = await p.textContent('.band .sub');
    ok(/בחופשה עד .* · בלי תזכורות/.test(sub), sub);
    await go('#settings'); await shot(p, 'w8-away'); await p.click('#awayEnd'); await p.waitForSelector('#awayForm');
    return sub;
  });

  await check('W3', 'סירי: יצירת מפתח מציגה כתובות, כותרת Authorization וצעדים', async () => {
    await p.click('#mkKey'); await p.waitForSelector('.keyrow');
    const t = await p.textContent('#keyBox');
    ok(/\/api\/say/.test(t) && /Bearer [0-9a-f]{64}/.test(t) && /Dictate Text/.test(t) && /Run After Confirmation/.test(t), t.slice(0, 200));
    await p.locator('#keyBox').scrollIntoViewIfNeeded(); await shot(p, 'w3-siri');
    const noScroll = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    ok(noScroll, 'no sideways scroll with the long key');
    return 'ok';
  });

  await check('W9', 'מסך צר 320: "יש לנו?", חשבונית ואזהרה בלי גלילה לצדדים', async () => {
    await p.setViewportSize({ width: 320, height: 640 });
    await go('#list'); await reload();
    await p.click('#tripGo').catch(() => {}); await p.waitForSelector('#haveQ'); await p.fill('#haveQ', 'טונה');
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'list: no sideways scroll');
    await shot(p, 'w9-narrow');
    return 'ok';
  });

  await check('W10', 'רענון לא מוחק שדה שמולא ולא נשלח (תאריך חופשה), ומפתח סירי נשאר על המסך', async () => {
    await go('#settings'); await p.waitForSelector('#awayUntil');
    const d = new Date(Date.now() + 4 * 86400e3).toISOString().slice(0, 10);
    await p.fill('#awayUntil', d); await p.click('.panel h3'); // the picker closes, focus leaves
    await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(1500); // a refresh redraws the screen
    ok((await p.inputValue('#awayUntil')) === d, `date kept: ${await p.inputValue('#awayUntil')}`);
    await p.click('#mkKey'); await p.waitForSelector('.keyrow');
    const k1 = await p.textContent('#keyBox');
    await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(1500);
    ok((await p.textContent('#keyBox')) === k1, 'key still on screen after a refresh');
    await go('#chat'); await go('#settings');
    ok(await p.$('#mkKey'), 'leaving settings hides it');
    await go('#list'); await p.fill('#addTxt', 'חלב'); await p.click('#adder button[type=submit]'); await p.waitForTimeout(900);
    ok((await p.inputValue('#addTxt')) === '', 'the add field empties after adding');
    if (await p.$('.sheet')) await p.click('#w-no');
    return 'ok';
  });

  await check('W11', 'הארון: נפתח מהבובה, נעול מסומן ברמה, בחירה מלבישה מיד, שמירה נשארת אחרי רענון', async () => {
    d1(`INSERT INTO events (id, ts, user_id, type, summary) SELECT -(500 + n), ${Date.now()} - (500 + n) * 86400000, 1, 'edit', 'x' FROM (WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM c WHERE n < 100) SELECT n FROM c)`); // 100 days (points are days since 16/10)
    await go('#settings'); await reload(); await p.waitForSelector('#closetGo');
    const lvl = await p.textContent('.grow .lvname b');
    await p.click('#growShuki'); await p.waitForSelector('.closet-prev');
    ok(await p.$('.chip.locked:has-text("כתר · רמה 21")'), 'locked crown shows its level');
    await p.click('.slot [data-id=mustache]'); await p.click('.slot [data-slot=eyes][data-id=""]');
    ok(await p.evaluate(() => document.querySelector('#clPrev svg').classList.contains('w-mustache')), 'preview wears it');
    await shot(p, 'w11-closet');
    await p.click('#clSave'); await p.waitForTimeout(800);
    ok(await p.evaluate(() => { const c = document.querySelector('.band .mascot svg').classList; return c.contains('w-mustache') && !c.contains('w-glasses'); }), 'the Shuki at the top wears it');
    await reload();
    ok(await p.evaluate(() => document.querySelector('.band .mascot svg').classList.contains('w-mustache')), 'kept after reload');
    return lvl;
  });

  await check('JS', 'אין שגיאות JavaScript', async () => { ok(!errors.length, errors.join(' | ')); });
  const n = results.filter((r) => r.ok).length;
  console.log(`\n${n}/${results.length} more UI checks passed`);
  require('node:fs').writeFileSync('test/more-ui-results.json', JSON.stringify(results, null, 1));
  await b.close();
  process.exit(n === results.length ? 0 : 1);
})();
