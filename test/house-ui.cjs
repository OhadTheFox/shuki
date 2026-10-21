// A new house on a phone: the setup screen, the house panel, adding and removing people, the Claude key, time zone.
// Run: test/ui-qa.sh test/house-ui.cjs
const { chromium } = require(process.env.PW);
const lib = require('./sweep-lib.cjs');
const { check, ok, finish, BASE } = lib;
(async () => {
  lib.d1('DELETE FROM pairing_codes'); lib.d1('DELETE FROM users'); lib.d1("DELETE FROM settings WHERE key IN ('house_name', 'setup_code')");
  lib.d1("INSERT INTO settings (key, value) VALUES ('setup_code', '12345678')");
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 320, height: 568 }, serviceWorkers: 'block', hasTouch: true }); await ctx.addInitScript(() => { new MutationObserver(() => document.querySelectorAll('details.fold:not([data-t])').forEach((d) => { d.dataset.t = 1; d.open = true; })).observe(document, { childList: true, subtree: true }); }); // settings folds open (01/10)
  const p = await ctx.newPage(); p.errors = []; p.on('pageerror', (e) => p.errors.push(e.message)); lib.shotPage = p;
  const toast = async () => (await p.$eval('.toast', (x) => x.textContent).catch(() => '')) || '';

  await check('S1', 'התקנה חדשה (30/09): רק קוד ההקמה והמפתח; בלי שם, לשון, בית, אזור זמן ושחזור; בלי גלילה הצידה', async () => {
    await p.goto(BASE + '/'); await p.waitForSelector('#setup', { timeout: 8000 });
    for (const id of ['#s-code', '#s-key']) ok(await p.$(id), `missing ${id}`);
    for (const id of ['#s-house', '#s-name', '#s-gender', '#s-tz', '#s-backup']) ok(!(await p.$(id)), `still there: ${id}`);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= 320), 'sideways');
    await p.screenshot({ path: '/tmp/shuki-test/house-setup.png', fullPage: true });
  });
  await check('S2', 'קוד שגוי: הודעה, והקוד נשאר', async () => {
    await p.fill('#s-code', '11112222');
    await p.click('#setup button[type=submit]'); await p.waitForTimeout(900);
    ok(/קוד ההקמה לא נכון/.test(await p.textContent('#err')), await p.textContent('#err'));
    ok((await p.inputValue('#s-code')) === '11112222', 'kept');
  });
  const lastBot = () => p.$$eval('#thread .msg.bot', (xs) => xs.at(-1)?.textContent || '');
  const say = async (text) => { await p.fill('#say', text); await p.$eval('#composer', (f) => f.requestSubmit()); await p.waitForTimeout(1800); };
  await check('S3', 'קוד נכון: שוקי מציג את עצמו, ושואל בצ\'אט את השם, את הלשון ואת שם הבית; אזור הזמן מהטלפון', async () => {
    await p.fill('#s-code', '12345678');
    await p.click('#setup button[type=submit]'); await p.waitForSelector('#thread .msg', { timeout: 8000 });
    await p.waitForTimeout(4500); // four bubbles, one after the other (decisions 179, 180)
    const t0 = await p.textContent('#thread'); ok(/אני שוקי, הרובוט החמוד/.test(t0), 'the hello');
    ok((await lastBot()).includes('מה השם שלך?'), await lastBot());
    await p.screenshot({ path: '/tmp/shuki-test/house-ask-name.png' });
    await say('דנה');
    ok((await lastBot()).includes('איך לפנות אליך?'), await lastBot());
    await p.click('#thread .chips [data-opt="בלשון נקבה"]').catch(async () => say('בלשון נקבה')); await p.waitForTimeout(1800);
    ok((await lastBot()).includes('איך נקרא לבית?'), await lastBot());
    await p.screenshot({ path: '/tmp/shuki-test/house-ask-house.png' });
    await say('הבית ברחוב הגפן');
    ok(/מי מנהל את האפליקציה ומי עוד גר בבית\?/.test(await lastBot()), await lastBot());
    await say('אחר כך'); // the rest of the meeting waits
    await p.evaluate(() => { location.hash = '#settings'; }); await p.waitForSelector('.house', { timeout: 8000 });
    const t = await p.textContent('.house'); ok(/דנה/.test(t) && /מנהלת הבית/.test(t) && !/זו את/.test(t) && /הוסיפי חבר חדש לבית/.test(t), t); // "זו את" removed, 01/10
    ok((await p.inputValue('#houseName input')) === 'הבית ברחוב הגפן', 'house name');
    // the house's zone as the app gets it: the state's own tz (its settings carry only what the app reads, stage 9 task 0)
    const tz = (await p.evaluate(() => JSON.parse(localStorage.getItem('shuki.state')).tz)); ok(tz === await p.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), String(tz));
    await p.screenshot({ path: '/tmp/shuki-test/house-panel.png' });
  });
  let code;
  await check('S4', 'הוספת יואב: קוד צימוד מופיע, ויואב ברשימה', async () => {
    await p.fill('#m-name', 'יואב'); await p.selectOption('#m-gender', 'm'); await p.click('#addMem button'); await p.waitForTimeout(1200);
    code = (await p.textContent('#memCode .paircode b')).trim(); ok(/^\d{6}$/.test(code), code);
    ok(/יואב/.test(await p.textContent('.house')), 'listed');
    await p.screenshot({ path: '/tmp/shuki-test/house-added.png' });
  });
  let q;
  await check('S5', 'יואב מתחבר בקוד; אצלו אין הוספה ואין מפתח, ויש רק "קוד לטלפון חדש שלי"', async () => {
    const c2 = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }); await c2.addInitScript(() => { new MutationObserver(() => document.querySelectorAll('details.fold:not([data-t])').forEach((d) => { d.dataset.t = 1; d.open = true; })).observe(document, { childList: true, subtree: true }); }); q = await c2.newPage(); // settings folds open (01/10)
    await q.goto(BASE + '/'); await q.waitForSelector('#pair'); await q.waitForTimeout(600);
    ok(!(await q.$('#setup')), 'setup shown after the house exists');
    await q.fill('#code', code); await q.click('#pair button[type=submit]'); await q.waitForSelector('#say');
    await q.evaluate(() => { location.hash = '#settings'; }); await q.waitForSelector('.house');
    ok(!(await q.$('#addMem')) && !(await q.$('#keyForm')) && !(await q.$('#houseName')), 'admin controls shown to a member');
    const codes = await q.$$eval('[data-code]', (xs) => xs.map((x) => x.textContent)); ok(codes.length === 1 && /שלי/.test(codes[0]), JSON.stringify(codes));
  });
  await check('S6', 'עריכת בן בית: שינוי לשון, להפוך למנהל, להוציא מהבית (עם אישור) → הטלפון של יואב מתנתק', async () => {
    await p.click('.member:has-text("יואב") [data-mem]'); await p.waitForSelector('.sheet h2:has-text("יואב")');
    ok(await p.$('#e-admin') && await p.$('#e-remove') && await p.$('#e-code'), 'buttons');
    await p.click('#e-remove'); await p.waitForTimeout(200); ok(/להוציא באמת\?/.test(await p.textContent('#e-remove')), 'no confirm');
    await p.click('#e-remove'); await p.waitForTimeout(1200);
    ok(!/יואב/.test(await p.textContent('.house')), 'still listed');
    await q.reload(); await q.waitForSelector('#pair', { timeout: 8000 });
  });
  await check('S7', 'מפתח Claude: מפתח לא תקין → הודעה; תקין → "מחובר (מפתח שהוזן כאן)"; אזור זמן', async () => {
    await p.fill('#k-key', 'hello'); await p.click('#keyForm button'); await p.waitForTimeout(900);
    ok(/sk-ant/.test(await toast()), await toast());
    await p.fill('#k-key', 'sk-ant-api03-' + 'x'.repeat(40)); await p.click('#keyForm button'); await p.waitForTimeout(1500);
    ok(/מפתח שהוזן כאן/.test(await p.textContent('.house')), await p.textContent('.house'));
    await p.selectOption('#tzSel', 'Europe/London'); await p.waitForTimeout(1200);
    ok((await p.$eval('#tzSel', (x) => x.value)) === 'Europe/London', 'tz');
  });
  ok(!p.errors.length, p.errors.join('; '));
  await finish(b, 'test/house-ui-results.json');
})();
