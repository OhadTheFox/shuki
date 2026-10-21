// The first use (15/10, the owner's own house, 21:43): back to the app while Shuki was still thinking showed his message twice,
// once from the server and once as "being sent". With a slow fake model (10 seconds, "תחשוב לאט" in test/fake-claude.cjs):
// hide the page and show it again, another tab of the app and back, lock and unlock, and a load that was already on its
// way when he sent. His message shows once all the time, and the answer once. Run under tools/runall.sh
// (UIS="test/firstuse-ui.cjs test/firstuse-ui.cjs@webkit").
const pw = require(process.env.PW), BR = process.env.PW_BROWSER || 'chromium', browser = pw[BR];
const { check, ok, phone, finish } = require('./sweep-lib.cjs');

const mine = (p, t) => p.locator('.msg.me', { hasText: t }).count();
let before = 0; // the answers already in the chat, from the checks before
const answers = async (p) => (await p.locator('.msg.bot', { hasText: 'חשבתי לאט.' }).count()) - before;
const typing = (p) => p.locator('.msg.bot.typing').count();
// the page hidden and shown again, as the phone does when he leaves the app (the browser's own event, its own `hidden`)
const hide = (p, h) => p.evaluate((h) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') }); document.dispatchEvent(new Event('visibilitychange')); }, h);
const send = async (p, t) => { before = await p.locator('.msg.bot', { hasText: 'חשבתי לאט.' }).count(); await p.fill('#say', t); await p.click('#send'); await p.waitForSelector('.msg.bot.typing'); };
/** One check, every 400 ms until the answer: his message once, and the answer not yet in, or in once without the dots. */
async function once(p, t, what) {
  await p.waitForTimeout(700);
  const n = await mine(p, t), a = await answers(p), d = await typing(p);
  ok(n === 1, `${what}: his message ${n} times`);
  ok(a === 0 ? d === 1 : a === 1 && d === 0, `${what}: ${a} answers, ${d} dots`);
}

(async () => {
  const b = await browser.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
  const avi = await phone(b);
  await avi.go('#chat');

  await check('FU-1', 'הדף מוסתר וחוזר בזמן ששוקי חושב: ההודעה פעם אחת, והתשובה פעם אחת', async () => {
    const t = 'תחשוב לאט 1';
    await send(avi, t);
    await hide(avi, true); await avi.waitForTimeout(300); await hide(avi, false);
    await once(avi, t, 'after hidden');
    await hide(avi, true); await avi.waitForTimeout(1500); await hide(avi, false);
    await once(avi, t, 'after hidden again');
    await avi.waitForSelector('.msg.bot >> text=חשבתי לאט.', { timeout: 15000 }); await avi.waitForTimeout(500);
    ok(await mine(avi, t) === 1 && await answers(avi) === 1 && await typing(avi) === 0, `after the answer: ${await mine(avi, t)} messages, ${await answers(avi)} answers`);
    ok(!avi.errors.length, avi.errors.join(' | '));
  });

  await check('FU-2', 'לשונית אחרת באפליקציה וחזרה לצ\'אט בזמן ששוקי חושב', async () => {
    const t = 'תחשוב לאט 2';
    await send(avi, t);
    await avi.go('#list'); await avi.go('#inventory'); await avi.go('#chat');
    await once(avi, t, 'back from the list');
    await avi.go('#settings'); await avi.go('#chat');
    await once(avi, t, 'back from settings');
    await avi.waitForSelector(`.msg.me:has-text("${t}") ~ .msg.bot:has-text("חשבתי לאט.")`, { timeout: 15000 }); await avi.waitForTimeout(500);
    ok(await mine(avi, t) === 1 && await typing(avi) === 0, `after the answer: ${await mine(avi, t)} messages`);
    ok(await answers(avi) === 1, `${await answers(avi)} answers`);
  });

  await check('FU-3', 'לשונית אחרת בדפדפן, נעילה ופתיחה, בזמן ששוקי חושב', async () => {
    const t = 'תחשוב לאט 3';
    await send(avi, t);
    const other = await avi.ctx.newPage(); await other.goto('about:blank'); await other.bringToFront(); await avi.waitForTimeout(800);
    await avi.bringToFront(); await hide(avi, false);
    await once(avi, t, 'back from another tab');
    // locked: the page frozen (Chromium's own lifecycle), then hidden and shown; WebKit: hidden and shown
    if (BR === 'chromium') { const s = await avi.ctx.newCDPSession(avi); await hide(avi, true); await s.send('Page.setWebLifecycleState', { state: 'frozen' }); await other.waitForTimeout(1500); await s.send('Page.setWebLifecycleState', { state: 'active' }); await hide(avi, false); }
    else { await hide(avi, true); await avi.waitForTimeout(1500); await hide(avi, false); }
    await once(avi, t, 'after the lock');
    await other.close();
    await avi.waitForSelector(`.msg.me:has-text("${t}") ~ .msg.bot:has-text("חשבתי לאט.")`, { timeout: 15000 }); await avi.waitForTimeout(500);
    ok(await mine(avi, t) === 1 && await typing(avi) === 0, `after the answer: ${await mine(avi, t)} messages`);
    ok(await answers(avi) === 1, `${await answers(avi)} answers`);
  });

  await check('FU-4', 'טעינה של הצ\'אט שיצאה לפני השליחה וחוזרת אחריה, עם ההודעה מהשרת: ההודעה פעם אחת', async () => {
    const t = 'תחשוב לאט 4';
    let posted, held = 0; const seen = new Promise((r) => { posted = r; });
    await avi.route('**/api/chat', async (route) => {
      if (route.request().method() === 'POST') { posted(); return route.continue(); }
      if (held++) return route.continue();
      await seen; await new Promise((r) => setTimeout(r, 1000)); return route.continue(); // reaches the server after it kept the message
    });
    await avi.go('#list'); await avi.evaluate(() => { location.hash = '#chat'; }); // a load on its way
    await send(avi, t);
    await avi.waitForTimeout(2500); await avi.unroute('**/api/chat');
    await once(avi, t, 'the load that was on its way');
    await avi.waitForSelector(`.msg.me:has-text("${t}") ~ .msg.bot:has-text("חשבתי לאט.")`, { timeout: 15000 }); await avi.waitForTimeout(500);
    ok(await mine(avi, t) === 1 && await typing(avi) === 0, `after the answer: ${await mine(avi, t)} messages`);
    ok(!avi.errors.length, avi.errors.join(' | '));
  });
  await finish(b, `/tmp/shuki-test/firstuse-ui${BR === 'chromium' ? '' : `-${BR}`}.json`);
})();
