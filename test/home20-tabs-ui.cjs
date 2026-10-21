// home20 round 2, fix 8 (the owner 19/10): a grown-up with a child has the tabs ("הצ'אט שלי" / the child) stuck at the top of the chat;
// a card taller than the room under them had its first line under them ("לתכנן דגים להיום?", ../shuki-shots/r20/3-chat.png).
// The newest card starts under the tabs (and the band, when it sticks): the plan's card and a long mapping card. Chromium at 375×667 (an iPhone SE)
// and WebKit's iPhone 15 (UIS="test/home20-tabs-ui.cjs test/home20-tabs-ui.cjs@webkit"). SHOTS=<dir> NAME=<file>: the
// WebKit screenshot of the plan's card (8-tabs-before on c7fe9e1, 8-tabs-after here).
const pw = require(process.env.PW), BR = process.env.PW_BROWSER || 'chromium', browser = pw[BR];
const lib = require('./sweep-lib.cjs');
const { BASE, d1, check, ok, finish } = lib;
let codeN = 773000;

async function open(b) {
  const ctx = BR === 'webkit' ? await b.newContext({ ...pw.devices['iPhone 15'], serviceWorkers: 'block' }) : await b.newContext({ viewport: { width: 375, height: 667 }, hasTouch: true, serviceWorkers: 'block' }); // an iPhone SE: at 390×844 these cards fit
  const p = await ctx.newPage(); p.errors = []; p.on('pageerror', (e) => p.errors.push(e.message)); p.ctx = ctx; lib.shotPage = p;
  const code = String(codeN++);
  d1(`INSERT OR REPLACE INTO pairing_codes (code, user_id, expires) VALUES ('${code}', 1, 9999999999999)`);
  await p.goto(BASE + '/'); await p.fill('#code', code); await p.click('#pair button[type=submit]'); await p.waitForSelector('#say');
  p.api = (m, u, bd) => p.evaluate(async ([m, u, bd]) => { const r = await fetch(u, { method: m, headers: { 'content-type': 'application/json', 'x-levels': '21', authorization: `Bearer ${JSON.parse(localStorage.getItem('shuki.token'))}` }, body: bd ? JSON.stringify(bd) : undefined }); return r.json(); }, [m, u, bd]);
  return p;
}
/** Where the newest card starts against the bottom of what sticks at the top (the tabs, the band), in the window's pixels. */
const gap = (p) => p.evaluate(() => {
  const cp = [...document.querySelectorAll('.coupon')].at(-1);
  const under = Math.max(0, ...[...document.querySelectorAll('.band, .chattabs')].filter((e) => ['sticky', 'fixed'].includes(getComputedStyle(e).position)).map((e) => e.getBoundingClientRect().bottom));
  return { top: Math.round(cp.getBoundingClientRect().top), under: Math.round(under), tabs: !!document.querySelector('.chattabs') };
});
/** Round 3, fix 3: where the newest card's buttons ("לעדכן / ביטול") end against the composer's top, and whether the tabs stick. */
const buttons = (p) => p.evaluate(() => {
  const cp = [...document.querySelectorAll('.coupon')].at(-1), bs = [...cp.querySelectorAll('[data-do]')];
  const c = document.querySelector('#composer');
  return { bottom: Math.round(Math.max(...bs.map((b) => b.getBoundingClientRect().bottom))), composer: Math.round(c.getBoundingClientRect().top), stuck: ['sticky', 'fixed'].includes(getComputedStyle(document.querySelector('.chattabs')).position) };
});
const send = async (p, t) => {
  const n = await p.locator('.coupon').count();
  await p.fill('#say', t); await p.click('#send');
  await p.waitForFunction((k) => document.querySelectorAll('.coupon').length > k, n, { timeout: 15000 });
  await p.waitForTimeout(900);
};

(async () => {
  const b = await browser.launch();
  d1("INSERT OR IGNORE INTO users (id, name, gender, role, active, created) VALUES (3, 'יואבי', 'm', 'child', 1, 0)");
  for (const t of ['meal_plan_items', 'meal_plan', 'list_items', 'recipe_ingredients', 'recipes', 'proposals']) d1(`DELETE FROM ${t}`);
  d1("INSERT INTO products (id, name, aliases, count_type, qty, is_basic, created, updated) VALUES (9501, 'ביצים', '[]', 'units', 1, 0, 0, 0), (9503, 'גבינה בולגרית', '[]', 'units', 0, 0, 0, 0)");
  d1("INSERT INTO products (id, name, aliases, count_type, level, qty, is_basic, created, updated) VALUES (9502, 'חלב', '[]', 'level', 'none', 0, 0, 0, 0)");
  d1("INSERT INTO recipes (id, name, ingredients, text, added_by, added, cooked, parsed) VALUES (9602, 'פשטידת התרד של דנה', '3 ביצים', 'אופים.', 2, 0, 0, 1)");
  d1("INSERT INTO recipe_ingredients (recipe_id, pos, qty, name, line, product_id) VALUES (9602, 0, 3, 'ביצים', '3 ביצים', 9501), (9602, 1, NULL, 'חלב', 'חלב', 9502), (9602, 2, 1, 'תרד', 'תרד', NULL), (9602, 3, 1, 'גבינה בולגרית', 'גבינה בולגרית', 9503)");
  const p = await open(b);
  await p.api('POST', '/api/chat', { text: 'אחר כך' }); // past the first meeting's question
  await p.reload(); await p.waitForSelector('#say');

  await check('T8-1', `${BR}: כרטיס התכנון (6 שורות) מתחיל מתחת ללשוניות "הצ'אט שלי / יואבי"`, async () => {
    await send(p, 'היום דגים, מחר המנה של דנה');
    const g = await gap(p);
    ok(g.tabs, 'no tabs: the test needs a child');
    if (process.env.SHOTS && BR === 'webkit') await p.screenshot({ path: `${process.env.SHOTS}/${process.env.NAME || '8-tabs-after'}.png` });
    if (process.env.SHOTS && BR === 'webkit' && process.env.NAME9) await p.screenshot({ path: `${process.env.SHOTS}/${process.env.NAME9}.png` });
    ok(g.top >= g.under, `the card starts at ${g.top}, under what sticks at ${g.under}`);
  });
  await check('T9-1', `${BR}: תיקון 3 (סבב 3): ליד כרטיס שמחכה הלשוניות לא תקועות למעלה, ו"לעדכן / ביטול" מעל תיבת הכתיבה`, async () => {
    const x = await buttons(p);
    ok(!x.stuck, 'the tabs stick');
    ok(x.bottom <= x.composer, `the buttons end at ${x.bottom}, the composer starts at ${x.composer}`);
  });
  await check('T9-2', `${BR}: אחרי שהכרטיס נענה, הלשוניות חוזרות להיות קבועות למעלה`, async () => {
    await p.locator('.coupon').last().locator('[data-do="reject"]').click(); await p.waitForTimeout(1200);
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('.chattabs')).position === 'sticky'), "the tabs don't stick again");
  });
  await check('T8-2', `${BR}: כרטיס ארוך אחר (מיפוי של המקרר, 7 שורות) מתחיל מתחת ללשוניות`, async () => {
    d1('DELETE FROM products WHERE id >= 9500'); await p.reload(); await p.waitForSelector('#say'); // the mapping's "חלב 3%" and "ביצים L" would ask "האם זה אותו…?" first
    await send(p, 'נתחיל למפות את המקרר');
    const g = await gap(p);
    ok(g.top >= g.under, `the card starts at ${g.top}, under what sticks at ${g.under}`);
  });
  await check('T8-3', `${BR}: אין שגיאות JavaScript`, async () => ok(!p.errors.length, p.errors.join(' | ')));
  await p.ctx.close();
  await finish(b, `/tmp/shuki-test/home20-tabs-${BR}.json`);
})();
