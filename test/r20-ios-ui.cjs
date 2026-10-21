// Round 20, found in Simulator Safari (iOS 26.5) and not in Chromium: what can be checked here of those fixes.
// The keyboard placement itself (composer right above the keyboard after sending) was checked by hand in the Simulator.
// Run: test/ui-qa.sh test/r20-ios-ui.cjs
// PW_BROWSER=webkit: Safari's engine (stage 5); its browser under $PW_HOME/browsers (PLAYWRIGHT_BROWSERS_PATH, set by tools/runall.sh)
const chromium = require(process.env.PW)[process.env.PW_BROWSER || 'chromium'];
const lib = require('./sweep-lib.cjs');
const { check, ok, phone, finish } = lib;

(async () => {
  const b = await chromium.launch();
  const p = await phone(b, { w: 390, h: 844 });
  await p.api('POST', '/api/actions', { actions: [
    { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 1, is_basic: 1, target: 1 } },
  ] });

  await check('I1', 'לחיצה על "שליחה" לא לוקחת את הפוקוס מהתיבה (ב-iOS זה הזיז את הדף והלחיצה אבדה)', async () => {
    await p.reload2(); await p.go('#chat');
    const prevented = await p.evaluate(() => { const e = new PointerEvent('pointerdown', { bubbles: true, cancelable: true }); document.querySelector('#send').dispatchEvent(e); return e.defaultPrevented; });
    ok(prevented, 'pointerdown on send not prevented');
  });

  await check('I2', 'בזמן ששוקי חושב, התיבה נשארת פתוחה (המקלדת לא יורדת), ושליחה שנייה לא מוחקת את הטקסט', async () => {
    await p.fill('#say', 'נגמר החלב');
    const r = await p.evaluate(() => {
      document.querySelector('#composer').requestSubmit();
      const say = document.querySelector('#say');
      const during = { disabled: say.disabled, send: document.querySelector('#send').disabled };
      say.value = 'עוד משהו'; document.querySelector('#composer').requestSubmit();
      return { ...during, kept: say.value };
    });
    ok(!r.disabled, 'text field disabled while waiting'); ok(r.send, 'send not disabled while waiting'); ok(r.kept === 'עוד משהו', `second text lost: ${r.kept}`);
    await p.waitForSelector('.msg.bot.typing', { state: 'detached', timeout: 15000 });
    await p.fill('#say', '');
  });

  await check('I3', 'לחיצה ארוכה על שורה ברשימה: Safari לא מתחיל לסמן טקסט', async () => {
    await p.api('POST', '/api/actions', { actions: [{ kind: 'list_add', text: 'לחם', amount: 2 }] });
    await p.reload2(); await p.go('#list');
    const s = await p.$eval('.item', (e) => { const c = getComputedStyle(e); return [c.webkitUserSelect || c.userSelect, c.webkitTouchCallout || '']; });
    ok(s[0] === 'none', `user-select ${s[0]}`);
  });

  await check('I4', 'בלי שגיאות בדף', async () => { ok(!p.errors.length, p.errors.join(' | ')); });
  await finish(b, `test/r20-ios-ui${process.env.PW_BROWSER === 'webkit' ? '-webkit' : ''}-results.json`); // a file of its own in WebKit (60)
})();
