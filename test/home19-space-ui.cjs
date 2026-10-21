// home19, item 6 (17/10, the owner's iPhone: no space in the inventory's boxes): "חומץ בלסמי" typed key by key, with the space
// as a key of its own (keydown, keypress, input, keyup), in every text box of the inventory and the recipes screens, and the
// box holds exactly "חומץ בלסמי" afterwards, after the search's redraw too. Also V-1, V-2 (item 14): "גרסה vNN" at the bottom of the
// settings, from public/sw.js (the worker's answer, or the file). Chromium and WebKit (UIS="test/home19-space-ui.cjs test/home19-space-ui.cjs@webkit").
const pw = require(process.env.PW), BR = process.env.PW_BROWSER || 'chromium', browser = pw[BR];
const { BASE, check, ok, phone, finish, d1 } = require('./sweep-lib.cjs');
const fs = require('node:fs'), path = require('node:path');
const WORD = 'חומץ בלסמי';

/** A tap on the box, then the word key by key (the space too), then a pause longer than the search's 150 ms. */
async function typeKeys(p, sel) {
  await p.locator(sel).first().tap(); await p.waitForTimeout(150);
  let afterSpace = null;
  for (const ch of WORD) {
    if (ch !== ' ') { await p.keyboard.type(ch); await p.waitForTimeout(60); continue; }
    // the space, and the box right after it, before the next letter: past the search's 150 ms redraw (manager, h19)
    await p.keyboard.press('Space'); await p.waitForTimeout(300);
    afterSpace = await p.locator(sel).first().evaluate((el) => el.value);
  }
  await p.waitForTimeout(500);
  return p.locator(sel).first().evaluate((el, a) => ({ v: el.value, afterSpace: a, focused: document.activeElement === el }), afterSpace);
}
const same = (r) => r.v === WORD && r.afterSpace === 'חומץ ' && r.focused;
const closeSheet = (p) => p.evaluate(() => document.querySelector('.scrim')?.remove());
/** Clear a box (the app's own value) before typing in it. */
const clear = (p, sel) => p.locator(sel).first().evaluate((el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });

(async () => {
  const b = await browser.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
  const p = await phone(b);
  await p.api('POST', '/api/actions', { actions: [{ kind: 'create', product: { name: 'חומץ', count_type: 'units', qty: 1, unit: 'בקבוק' } }, { kind: 'create', product: { name: 'שמן זית', count_type: 'units', qty: 1 } }] });
  await p.api('POST', '/api/recipes', { name: 'סלט', ingredients: '2 עגבניות\nשמן זית', text: 'חותכים.' });

  await check('S-1', 'חיפוש במלאי: "חומץ בלסמי" מקש-מקש, כולל הרווח, נשאר בתיבה', async () => {
    await p.go('#inventory'); await p.reload2(); await p.go('#inventory');
    const r = await typeKeys(p, '#invQ');
    ok(same(r), JSON.stringify(r));
    await clear(p, '#invQ'); await p.waitForTimeout(300);
  });
  for (const [id, scr, sel] of [['S-7a', '#inventory', '#invQ'], ['S-7b', '#recipes', '#recQ']]) {
    await check(id, `${sel}: "חומץ " ואז המסך מצטייר מחדש (לפי קטגוריה / סינון), והרווח נשאר; ההמשך "בלסמי" נותן "חומץ בלסמי"`, async () => {
      await closeSheet(p); await p.go(scr); await clear(p, sel); await p.waitForTimeout(300);
      await p.locator(sel).tap();
      for (const ch of 'חומץ ') { if (ch === ' ') await p.keyboard.press('Space'); else await p.keyboard.type(ch); await p.waitForTimeout(60); }
      await p.waitForTimeout(300);
      // a whole redraw while the box holds "חומץ ": the order of the inventory, or a recipes filter (twice: on and off)
      if (scr === '#inventory') { await p.click('[data-mode="cat"]'); await p.waitForTimeout(300); await p.click('[data-mode="loc"]'); }
      else { const f = p.locator('[data-rf]').first(); await f.click(); await p.waitForTimeout(300); await p.locator('[data-rf]').first().click(); }
      await p.waitForTimeout(300);
      const mid = await p.locator(sel).evaluate((el) => el.value);
      ok(mid === 'חומץ ', `after the redraw: ${JSON.stringify(mid)}`);
      await p.locator(sel).evaluate((el) => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
      for (const ch of 'בלסמי') { await p.keyboard.type(ch); await p.waitForTimeout(60); }
      await p.waitForTimeout(400);
      const end = await p.locator(sel).evaluate((el) => el.value);
      ok(end === WORD, JSON.stringify(end));
      await clear(p, sel); await p.waitForTimeout(300);
    });
  }
  for (const [id, sel] of [['S-2a', '#f-name'], ['S-2b', '#f-unit'], ['S-2c', '#f-brand']]) {
    await check(id, `מוצר חדש במסך המלאי (${sel}): "חומץ בלסמי" מקש-מקש נשאר`, async () => {
      await closeSheet(p); await p.go('#inventory'); await p.click('#addP'); await p.waitForSelector(sel);
      await clear(p, sel);
      const r = await typeKeys(p, sel);
      ok(same(r), JSON.stringify(r));
    });
  }
  for (const [id, sel] of [['S-3a', '#f-name'], ['S-3b', '#f-unit'], ['S-3c', '#f-brand']]) {
    await check(id, `עריכה של מוצר במסך המלאי (${sel}): "חומץ בלסמי" מקש-מקש נשאר`, async () => {
      await closeSheet(p); await p.go('#inventory'); await clear(p, '#invQ'); await p.waitForTimeout(300); // a check before may have failed with a search left in it
      await p.locator('#invList [data-p]', { hasText: 'שמן זית' }).click(); await p.waitForSelector(sel);
      await clear(p, sel);
      const r = await typeKeys(p, sel);
      ok(same(r), JSON.stringify(r));
    });
  }
  await check('S-4', 'חיפוש במתכונים: "חומץ בלסמי" מקש-מקש נשאר', async () => {
    await closeSheet(p); await p.go('#recipes'); await clear(p, '#recQ'); await p.waitForTimeout(300);
    const r = await typeKeys(p, '#recQ');
    ok(same(r), JSON.stringify(r));
    await clear(p, '#recQ'); await p.waitForTimeout(300);
  });
  for (const [id, sel] of [['S-5a', '#rName'], ['S-5b', '[data-ing]'], ['S-5c', '#rText']]) {
    await check(id, `עריכה של מתכון (${sel}): "חומץ בלסמי" מקש-מקש נשאר`, async () => {
      await closeSheet(p); await p.go('#recipes'); await clear(p, '#recQ'); await p.waitForTimeout(300);
      await p.locator('.rlist [data-rec]').first().click(); await p.waitForSelector('#rEdit'); await p.click('#rEdit'); await p.waitForSelector(sel);
      await clear(p, sel);
      const r = await typeKeys(p, sel);
      ok(same(r), JSON.stringify(r));
    });
  }
  await check('S-6', 'מתכון חדש: השם והמצרכים (כתיבה) והתיבה של ההדבקה, מקש-מקש, נשארים', async () => {
    await closeSheet(p); await p.go('#recipes'); await p.click('#addR'); await p.waitForTimeout(400);
    await p.click('[data-way="write"]'); await p.waitForSelector('#rName');
    for (const sel of ['#rName', '#rIngs']) { const r = await typeKeys(p, sel); ok(same(r), `${sel} ${JSON.stringify(r)}`); }
    await closeSheet(p); await p.click('#addR'); await p.click('[data-way="paste"]'); await p.waitForSelector('#rPaste');
    const r = await typeKeys(p, '#rPaste'); ok(same(r), `#rPaste ${JSON.stringify(r)}`);
    await closeSheet(p);
    ok(!p.errors.length, p.errors.join(' | '));
  });

  // S-8: the same boxes in Playwright's iPhone (isMobile, the iPhone's user agent, touch), WebKit only
  if (BR === 'webkit') await check('S-8', 'באייפון של Playwright (isMobile, ה-UA של אייפון): החיפוש, השם והמותג במלאי, והחיפוש במתכונים', async () => {
    const ctx = await b.newContext({ ...pw.devices['iPhone 15'], serviceWorkers: 'block' });
    const q = await ctx.newPage(); q.errors = []; q.on('pageerror', (e) => q.errors.push(e.message));
    d1("INSERT OR REPLACE INTO pairing_codes (code, user_id, expires) VALUES ('919191', 1, 9999999999999)");
    await q.goto(BASE + '/'); await q.fill('#code', '919191'); await q.tap('#pair button[type=submit]'); await q.waitForSelector('#say');
    const go = async (h) => { await q.evaluate((x) => { location.hash = x; }, h); await q.waitForTimeout(500); };
    const bad = [];
    await go('#inventory'); let r = await typeKeys(q, '#invQ'); if (!same(r)) bad.push(`invQ ${JSON.stringify(r)}`); await clear(q, '#invQ'); await q.waitForTimeout(300);
    await q.tap('#addP'); await q.waitForSelector('#f-name');
    for (const sel of ['#f-name', '#f-brand']) { await clear(q, sel); r = await typeKeys(q, sel); if (!same(r)) bad.push(`${sel} ${JSON.stringify(r)}`); }
    await closeSheet(q);
    await go('#inventory'); await q.locator('#invList [data-p]', { hasText: 'שמן זית' }).tap(); await q.waitForSelector('#f-name');
    await clear(q, '#f-name'); r = await typeKeys(q, '#f-name'); if (!same(r)) bad.push(`edit f-name ${JSON.stringify(r)}`);
    await closeSheet(q);
    await go('#recipes'); r = await typeKeys(q, '#recQ'); if (!same(r)) bad.push(`recQ ${JSON.stringify(r)}`);
    ok(!bad.length && !q.errors.length, [...bad, ...q.errors].join(' | '));
    await ctx.close();
  });

  await check('V-1', 'בתחתית ההגדרות: "גרסה vNN", מה-VERSION של public/sw.js', async () => {
    const want = /VERSION\s*=\s*'(v\d+)'/.exec(fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8'))?.[1];
    await p.go('#settings'); await p.waitForTimeout(900);
    const r = await p.evaluate(() => { const el = document.getElementById('appVer'); const all = [...document.querySelectorAll('#main > *')]; return { t: el?.textContent, last: !!el && all[all.length - 1]?.contains(el) }; });
    ok(want && r.t === `גרסה ${want}`, `${JSON.stringify(r)} want ${want}`);
    ok(r.last, 'not at the bottom');
  });
  await check('V-2', 'ה-service worker עונה על "version" ב-VERSION שלו (מה שהאפליקציה מראה כשהוא מגיש אותה)', async () => {
    const src = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8'), want = /VERSION\s*=\s*'(v\d+)'/.exec(src)?.[1];
    const vm = require('node:vm'), handlers = {};
    vm.runInNewContext(src, { self: { addEventListener: (t, f) => (handlers[t] = f), registration: {}, skipWaiting() {}, clients: {} }, caches: {}, location: { origin: 'http://x' }, URL });
    const got = []; handlers.message?.({ data: 'version', ports: [{ postMessage: (m) => got.push(m) }] });
    ok(want && got[0]?.version === want, `${JSON.stringify(got)} want ${want}`);
  });
  await finish(b, `/tmp/shuki-test/home19-space-ui${BR === 'chromium' ? '' : `-${BR}`}.json`);
})();
