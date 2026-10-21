// home20 (section 16): the weekly plan on the recipes screen, as in ../shuki-shots/r19 (1-week, 1-week-bottom, 2-pick, 3-chat):
// the switch, the days from today, "+ להוסיף מנה" and its picker (a recipe at once, a dish without one), the toast's "להוסיף
// לרשימה", the summary and its card, "⋯" (move, off and the question about the list), yesterday's question, "הכנו את זה",
// "לתכנן ליום…" in a recipe, a child's view (read only), the chat's card, no sideways scroll. Chromium at 390×844 and WebKit's
// iPhone 15 (UIS="test/home20-week-ui.cjs test/home20-week-ui.cjs@webkit"). SHOTS=<dir>: the screenshots (WebKit only).
const pw = require(process.env.PW), BR = process.env.PW_BROWSER || 'chromium', browser = pw[BR];
const lib = require('./sweep-lib.cjs');
const { BASE, d1, d1q, check, ok, finish } = lib;
const SHOTS = BR === 'webkit' ? process.env.SHOTS : null;
let codeN = 772000;
const day = (k) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now() + k * 86400e3);
const WD = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const wd = (k) => WD[new Date(`${day(k)}T12:00:00Z`).getUTCDay()];

async function open(b, user = 1) {
  const ctx = BR === 'webkit' ? await b.newContext({ ...pw.devices['iPhone 15'], serviceWorkers: 'block' }) : await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
  await lib.unfold(ctx);
  const p = await ctx.newPage(); p.errors = []; p.on('pageerror', (e) => p.errors.push(e.message)); p.ctx = ctx; lib.shotPage = p;
  const code = String(codeN++);
  d1(`INSERT OR REPLACE INTO pairing_codes (code, user_id, expires) VALUES ('${code}', ${user}, 9999999999999)`);
  await p.goto(BASE + '/'); await p.fill('#code', code); await p.click('#pair button[type=submit]'); await p.waitForSelector('#say');
  p.api = (m, u, bd) => p.evaluate(async ([m, u, bd]) => { const r = await fetch(u, { method: m, headers: { 'content-type': 'application/json', 'x-levels': '21', authorization: `Bearer ${JSON.parse(localStorage.getItem('shuki.token'))}` }, body: bd ? JSON.stringify(bd) : undefined }); return r.json(); }, [m, u, bd]);
  p.go = async (hash) => { await p.evaluate((x) => { location.hash = x; }, hash); await p.waitForTimeout(500); };
  p.fresh = async () => { await p.evaluate(() => { document.querySelector('.scrim')?.remove(); location.hash = '#recipes'; }); await p.reload(); await p.waitForSelector('.rec-segs'); await p.waitForTimeout(500); };
  // a button under the fixed tab bar or a toast: clicked directly after 5 seconds, said in the log
  p.press = async (loc) => {
    try { await (BR === 'webkit' ? loc.tap({ timeout: 5000 }) : loc.click({ timeout: 5000 })); }
    catch { console.log(`   (${loc} covered, clicked directly)`); await loc.dispatchEvent('click'); }
    await p.waitForTimeout(700);
  };
  p.text = (sel) => p.locator(sel).first().innerText();
  return p;
}
const shot = async (p, name, full = false) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full }); };
// how far past the screen's width the page or the window goes (0: no sideways scroll)
const wide = (p) => p.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, document.querySelector('.scrim .sheet')?.scrollWidth || 0) - window.innerWidth);
const reset = () => {
  for (const t of ['meal_plan_items', 'meal_plan', 'list_items', 'cooked_log', 'recipe_ingredients', 'recipes', 'proposals']) d1(`DELETE FROM ${t}`);
  d1('DELETE FROM products WHERE id >= 9500');
  d1("INSERT INTO products (id, name, aliases, count_type, qty, is_basic, created, updated) VALUES (9501, 'ביצים', '[]', 'units', 4, 0, 0, 0), (9503, 'גבינה בולגרית', '[]', 'units', 0, 0, 0, 0), (9504, 'פסטה', '[]', 'units', 2, 0, 0, 0), (9505, 'עגבניות', '[]', 'units', 6, 0, 0, 0)");
  d1("INSERT INTO products (id, name, aliases, count_type, level, qty, is_basic, created, updated) VALUES (9502, 'חלב', '[]', 'level', 'none', 0, 0, 0, 0)");
  d1("INSERT INTO recipes (id, name, ingredients, text, added_by, added, cooked, parsed, tags) VALUES (9601, 'שקשוקה', '3 ביצים', 'מטגנים.', 1, 0, 3, 1, 'ארוחות בוקר'), (9602, 'פשטידת התרד של דנה', '3 ביצים', 'אופים.', 2, 0, 0, 1, 'אוכל ביתי'), (9603, 'פסטה ברוטב עגבניות', 'פסטה', 'מבשלים.', 1, 0, 1, 1, 'פסטה'), (9604, 'קציצות ברוטב', 'קציצות', 'מבשלים.', 1, 0, 0, 1, 'אוכל ביתי')");
  d1("INSERT INTO recipe_ingredients (recipe_id, pos, qty, name, line, product_id) VALUES (9601, 0, 3, 'ביצים', '3 ביצים', 9501), (9602, 0, 3, 'ביצים', '3 ביצים', 9501), (9602, 1, NULL, 'חלב', 'חלב', 9502), (9602, 2, 1, 'תרד', 'תרד', NULL), (9602, 3, 1, 'גבינה בולגרית', 'גבינה בולגרית', 9503), (9603, 0, 1, 'פסטה', 'פסטה', 9504), (9603, 1, 2, 'עגבניות', '2 עגבניות', 9505), (9604, 0, 4, 'עגבניות', '4 עגבניות', 9505)");
};
const plans = () => d1q('SELECT id, day, recipe_id, text, status FROM meal_plan ORDER BY day, pos, id');

(async () => {
  const b = await browser.launch();
  d1("INSERT OR IGNORE INTO users (id, name, gender, role, active, created) VALUES (3, 'יואבי', 'm', 'child', 1, 0)");
  reset();
  const p = await open(b);
  await p.go('#recipes');

  await check('W-1', `${BR}: בלי תכנון המסך נפתח על "כל המתכונים" עם המתג; "לתכנן את השבוע" פותח את "השבוע"`, async () => {
    const segs = await p.locator('.rec-segs button').allInnerTexts();
    ok(segs.join('|') === 'השבוע|כל המתכונים', segs.join('|'));
    ok(await p.locator('.rec-segs [data-rview="all"].on').count() === 1, 'not on "all"');
    ok(await p.locator('.rcard').count() === 4, 'the recipes');
    await p.press(p.locator('#planR'));
    ok(await p.locator('.rec-segs [data-rview="week"].on').count() === 1, 'not on the week');
  });
  await check('W-2', `${BR}: שבעה ימים מהיום: "היום" כחול ו"מחר" עם היום והתאריך, ו"להוסיף מנה" בכל יום`, async () => {
    const heads = await p.locator('.day > h3').allInnerTexts();
    ok(heads.length === 7, heads.join('|'));
    const [, m, d] = day(0).split('-').map(Number);
    ok(heads[0].replace(/\s+/g, ' ').trim() === `היום ${wd(0)} ${d}/${m}`, heads[0]);
    ok(heads[1].startsWith('מחר') && heads[2].startsWith(wd(2)), heads.slice(0, 3).join('|'));
    ok(await p.locator('.day.today').count() === 1);
    ok(await p.locator('.addish').count() === 7);
    ok(await p.locator('.wsum, .wask').count() === 0, 'nothing to say yet');
  });
  await check('W-3', `${BR}: "להוסיף מנה" ביום השלישי: "מה מכינים ביום X?", "אפשר להכין עכשיו" דלוק; מתכון נכנס מיד, עם "עודכן"`, async () => {
    await p.press(p.locator('.day').nth(2).locator('.addish'));
    ok((await p.text('.scrim .sheet h2')) === `מה מכינים ביום ${wd(2)}?`, await p.text('.scrim .sheet h2'));
    ok(await p.locator('.scrim [data-pf="now"].on').count() === 1, 'the filter is off');
    const rows = await p.locator('.scrim .prow').allInnerTexts();
    ok(rows.some((r) => /שקשוקה/.test(r) && /יש הכל/.test(r) && /הכנתם 3 פעמים/.test(r)), rows.join(' | '));
    ok(!rows.some((r) => /פשטידת/.test(r)), 'the quiche misses things: not "now"');
    ok(await wide(p) <= 0, `wide: ${await wide(p)}`);
    await shot(p, '2-pick');
    await p.press(p.locator('.scrim [data-pick="9601"]'));
    ok(await p.locator('.scrim').count() === 0, 'the window stayed');
    ok(/עודכן/.test(await p.text('.toast')), await p.text('.toast'));
    const x = plans(); ok(x.length === 1 && x[0].day === day(2) && x[0].recipe_id === 9601, JSON.stringify(x));
    await p.waitForTimeout(500);
    ok(/שקשוקה/.test(await p.locator('.day').nth(2).innerText()) && /יש הכל/.test(await p.locator('.day').nth(2).innerText()));
  });
  await check('W-4', `${BR}: מתכון שחסר לו: "חסרים N מוצרים. האם להוסיף לרשימה?" והכפתור מוסיף`, async () => {
    await p.press(p.locator('.day').nth(3).locator('.addish'));
    await p.press(p.locator('.scrim [data-pf="now"]')); // off: every recipe
    await p.press(p.locator('.scrim [data-pick="9602"]'));
    const t = await p.text('.toast');
    ok(t.startsWith('חסרים 4 מוצרים. האם להוסיף לרשימה?'), t); // eggs (1 left after the shakshuka), milk, spinach, cheese
    await p.press(p.locator('.toast button'));
    await p.waitForTimeout(600);
    ok(d1q('SELECT COUNT(*) AS n FROM list_items')[0].n === 4, 'the list');
    ok(d1q('SELECT COUNT(*) AS n FROM meal_plan_items')[0].n === 4, 'the dish\'s lines');
    const dish = await p.locator('.day').nth(3).innerText();
    ok(/חסרים 4 מוצרים/.test(dish) && /ברשימה/.test(dish), dish);
  });
  await check('W-5', `${BR}: מנה בלי מתכון: "דגים" ו-Enter; "בלי מתכון"`, async () => {
    await p.press(p.locator('.day').nth(1).locator('.addish'));
    ok((await p.text('.scrim .sheet h2')) === 'מה מכינים מחר?');
    await p.locator('#pFree').fill('דגים'); await p.locator('#pFree').press('Enter'); await p.waitForTimeout(900);
    const dish = await p.locator('.day').nth(1).innerText();
    ok(/דגים/.test(dish) && /בלי מתכון/.test(dish), dish);
  });
  await check('W-6', `${BR}: הסיכום "למנות של השבוע חסרים…" והכרטיס שלו ("בשביל…"); אחרי האישור הוא נעלם`, async () => {
    await p.api('POST', '/api/plan', { op: 'add', day: day(5), recipe_id: 9604 }); // 4 tomatoes after the pasta's 2 of 6: none missing
    await p.api('POST', '/api/plan', { op: 'add', day: day(4), recipe_id: 9603 });
    d1('UPDATE products SET qty = 4 WHERE id = 9505'); // 2 for the pasta, 4 for the meatballs: 2 short on day 5
    await p.fresh();
    const t = await p.text('.wsum p');
    ok(t === 'למנות של השבוע חסר מוצר אחד שעוד לא ברשימה', t);
    await shot(p, '1-week');
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(400);
    await shot(p, '1-week-bottom');
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.press(p.locator('#wList'));
    const lines = await p.locator('.scrim .coupon li').allInnerTexts();
    ok(lines.length === 1 && /עגבניות/.test(lines[0]) && /בשביל הקציצות/.test(lines[0]), lines.join(' | '));
    await p.press(p.locator('.scrim [data-do="apply"]'));
    await p.waitForTimeout(800);
    ok(await p.locator('.wsum').count() === 0, 'still there');
    ok(d1q("SELECT want FROM list_items WHERE product_id = 9505")[0]?.want === 2, 'want');
  });
  await check('W-7', `${BR}: "⋯": להעביר ליום אחר, ואז להוריד מהתכנון עם "האם להוריד מהרשימה…?" ו"כן, להוריד"`, async () => {
    const quiche = p.locator('.day').nth(3).locator('[data-wmore]');
    ok((await quiche.getAttribute('aria-label')) === 'מה לעשות עם המנה');
    await p.press(quiche);
    const menu = await p.locator('.scrim .menu .btn').allInnerTexts();
    ok(menu.join('|') === 'הכנו את זה|להעביר ליום אחר|להוריד מהתכנון', menu.join('|'));
    await p.press(p.locator('.scrim [data-dm="move"]'));
    await p.press(p.locator(`.scrim [data-day="${day(6)}"]`));
    ok(plans().find((x) => x.recipe_id === 9602).day === day(6), 'not moved');
    ok(d1q('SELECT COUNT(*) AS n FROM list_items WHERE product_id IN (9501, 9502, 9503) OR text = \'תרד\'')[0].n === 4, 'the list stays');
    await p.press(p.locator('.day').nth(6).locator('[data-wmore]'));
    await p.press(p.locator('.scrim [data-dm="off"]'));
    ok((await p.text('.scrim .sheet h2')) === 'האם להוריד מהרשימה את מה שנכנס בשבילה?', await p.text('.scrim .sheet h2'));
    await p.press(p.locator('#uYes'));
    ok(d1q("SELECT COUNT(*) AS n FROM list_items WHERE product_id IN (9502, 9503) OR text = 'תרד'")[0].n === 0, 'the lines stayed');
    ok(!plans().some((x) => x.recipe_id === 9602));
  });
  await check('W-8', `${BR}: אתמול: "האם הכנתם אתמול את הקציצות ברוטב?"; "לא, להעביר להיום"`, async () => {
    d1(`INSERT INTO meal_plan (id, day, pos, recipe_id, status, created, updated) VALUES (9901, '${day(-1)}', 0, 9604, 'planned', 0, 0)`);
    await p.fresh();
    ok((await p.text('.wask p')) === 'האם הכנתם אתמול את הקציצות ברוטב?', await p.text('.wask p'));
    ok((await p.locator('.wask .btn').allInnerTexts()).join('|') === 'כן, הכנו|לא, להעביר להיום|לא');
    await shot(p, '1-week-yesterday');
    await p.press(p.locator('#wMove'));
    ok(plans().find((x) => x.id === 9901).day === day(0));
    ok(await p.locator('.wask').count() === 0);
  });
  await check('W-9', `${BR}: "הכנו את זה" על המנה של היום: הכרטיס, ואחרי האישור "✓ הכנו את זה" בלי כפתורים`, async () => {
    d1(`UPDATE meal_plan SET recipe_id = 9601 WHERE id = 9901`); await p.fresh();
    ok(await p.locator('.day.today .cookit').count() === 1);
    await p.press(p.locator('.day.today .cookit'));
    ok(/הכנו/.test(await p.text('.scrim .sheet h2')), await p.text('.scrim .sheet h2'));
    await p.press(p.locator('.scrim [data-do="apply"]'));
    await p.evaluate(() => document.querySelector('.scrim')?.remove()); await p.waitForTimeout(600);
    ok(plans().find((x) => x.id === 9901).status === 'cooked');
    const today = await p.locator('.day.today').innerText();
    ok(/הכנו את זה/.test(today) && await p.locator('.day.today .cookit, .day.today [data-wmore]').count() === 0, today);
  });
  await check('W-10', `${BR}: במתכון: "לתכנן ליום…" ליד "הכנו את זה"`, async () => {
    await p.press(p.locator('.day').nth(2).locator('[data-wrec]'));
    ok(await p.locator('.scrim #rPlan').count() === 1);
    await p.press(p.locator('.scrim #rPlan'));
    await p.press(p.locator(`.scrim [data-day="${day(5)}"]`));
    ok(plans().some((x) => x.day === day(5) && x.recipe_id === 9601), JSON.stringify(plans()));
  });
  await check('W-11', `${BR}: אין גלילה לרוחב, ואין שגיאות JavaScript`, async () => {
    await p.fresh();
    ok(await wide(p) <= 0, `wide: ${await wide(p)}`);
    ok(!p.errors.length, p.errors.join(' | '));
  });
  await check('W-12', `${BR}: הצ'אט: "היום דגים, מחר המנה של דנה" — כרטיס עם שורות התכנון ושורות הרשימה "בשביל הפשטידה"`, async () => {
    d1('DELETE FROM meal_plan'); d1('DELETE FROM meal_plan_items'); d1('DELETE FROM list_items');
    await p.api('POST', '/api/chat', { text: 'אחר כך' }); // past the first meeting's question
    await p.go('#chat'); await p.reload(); await p.waitForSelector('#say');
    await p.fill('#say', 'היום דגים, מחר המנה של דנה'); await p.click('#send'); // as test/firstuse-ui.cjs sends
    await p.waitForSelector('.coupon', { timeout: 15000 }); await p.waitForTimeout(700);
    const lines = await p.locator('.coupon').last().locator('li').allInnerTexts();
    ok(/לתכנן דגים להיום/.test(lines[0]) && /בלי מתכון/.test(lines[0]), lines.join(' | '));
    ok(/לתכנן את פשטידת התרד של דנה למחר/.test(lines[1]), lines.join(' | '));
    // eggs too: W-9's shakshuka took 3 of the 4
    ok(lines.slice(2).length === 4 && lines.slice(2).every((l) => /^להוסיף .* לרשימה/.test(l) && /בשביל הפשטידה/.test(l)) && /להוסיף 2 ביצים לרשימה/.test(lines[2]), lines.join(' | '));
    await p.locator('.coupon').last().evaluate((el) => el.scrollIntoView({ block: 'center' })); await p.waitForTimeout(300); // not under the threads' tabs
    await shot(p, '3-chat');
    await p.press(p.locator('.coupon').last().locator('[data-do="apply"]'));
    await p.waitForTimeout(800);
    ok(plans().length === 2, JSON.stringify(plans()));
  });
  await check('W-14', `${BR}: תיקון 1 (19/10): ביצים באריזה של 12: בכרטיס של הסיכום "להוסיף 6 ביצים L לרשימה?", לא "אריזות"`, async () => {
    d1('DELETE FROM meal_plan'); d1('DELETE FROM meal_plan_items'); d1('DELETE FROM list_items'); d1('DELETE FROM proposals');
    d1("UPDATE products SET name = 'ביצים L', count_type = 'pack', pack_size = 12, qty = 0 WHERE id = 9501");
    await p.api('POST', '/api/plan', { op: 'add', day: day(1), recipe_id: 9601 }); await p.api('POST', '/api/plan', { op: 'add', day: day(2), recipe_id: 9601 });
    await p.fresh();
    await p.press(p.locator('#wList'));
    const lines = await p.locator('.scrim .coupon li').allInnerTexts();
    ok(lines.some((l) => /להוסיף 6 ביצים L לרשימה/.test(l)) && !lines.some((l) => /אריזות/.test(l)), lines.join(' | '));
    await shot(p, '1-week-eggs');
    await p.evaluate(() => document.querySelector('.scrim')?.remove());
  });
  await check('W-15', `${BR}: תיקון 2 (ז): "מחר נכין את המנה של מיכל", המודל שאל בעצמו: השאלה של השרת עם השמות המלאים, והכפתור נותן כרטיס`, async () => {
    d1("INSERT OR REPLACE INTO recipes (id, name, ingredients, text, added_by, added, cooked, parsed) VALUES (9605, 'עוגת הגזר של מיכל', 'גזר', 'אופים.', 2, 0, 0, 1)");
    await p.go('#chat'); await p.reload(); await p.waitForSelector('#say');
    await p.fill('#say', 'מחר נכין את המנה של מיכל'); await p.click('#send');
    await p.waitForFunction(() => [...document.querySelectorAll('.msg.bot')].some((m) => m.textContent.includes('איזו מנה של מיכל?')), null, { timeout: 15000 });
    await p.waitForTimeout(600);
    const opts = await p.locator('.msg.bot').last().locator('button').allInnerTexts().catch(() => []);
    const all = await p.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent.trim()));
    ok(all.includes('פשטידת התרד של דנה') && all.includes('עוגת הגזר של מיכל'), JSON.stringify(opts));
    await shot(p, '5-which-dish');
  });
  await p.ctx.close();

  // a child: the plan is seen, not changed
  const c = await open(b, 3);
  await c.go('#recipes');
  await check('W-13', `${BR}: ילד רואה את השבוע בלי "להוסיף מנה", בלי "⋯", בלי הסיכום והשאלה`, async () => {
    ok(await c.locator('.rec-segs [data-rview="week"].on').count() === 1, 'the week opens by itself');
    ok(/שקשוקה/.test(await c.locator('.week').innerText())); // W-14's two shakshukas
    ok(await c.locator('.addish, [data-wmore], .cookit, .wsum, .wask').count() === 0, 'something to change');
    await shot(c, '4-child');
    ok(!c.errors.length, c.errors.join(' | '));
  });
  await c.ctx.close();
  await finish(b, `/tmp/shuki-test/home20-week-${BR}.json`);
})();
