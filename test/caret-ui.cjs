// The text field (16/10, the owner's iPhone): the caret can't be moved back. Type, move the caret back, and then what redraws the
// screen in the middle of typing (back to the app: refresh and the chat's load; a hashchange that redraws the chat; the
// field growing a line): the text stays, the caret stays where it was, and the next letter goes there. Chromium and WebKit
// (UIS="test/caret-ui.cjs test/caret-ui.cjs@webkit").
const pw = require(process.env.PW), BR = process.env.PW_BROWSER || 'chromium', browser = pw[BR];
const { check, ok, phone, finish } = require('./sweep-lib.cjs');

const field = (p) => p.evaluate(() => { const t = document.getElementById('say'); return { v: t.value, s: t.selectionStart, e: t.selectionEnd, focused: document.activeElement === t }; });
async function start(p, text, back) {
  await p.go('#chat'); await p.click('#say'); await p.fill('#say', ''); await p.keyboard.type(text);
  await p.evaluate((n) => { const t = document.getElementById('say'); t.setSelectionRange(t.value.length - n, t.value.length - n); }, back); // a finger puts the caret back (RTL: the arrows go the other way)
  const f = await field(p); ok(f.s === text.length - back, `caret at ${f.s} before, expected ${text.length - back}`);
}

(async () => {
  const b = await browser.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
  const p = await phone(b);
  const hide = (h) => p.evaluate((h) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); document.dispatchEvent(new Event('visibilitychange')); }, h);

  await check('C-1', 'הסמן זז אחורה, חוזרים לאפליקציה (refresh וטעינת הצ\'אט): הטקסט והסמן נשארים, והאות הבאה נכנסת במקום', async () => {
    await start(p, 'קניתי חלב', 4);
    await hide(true); await hide(false); await p.waitForTimeout(1200);
    let f = await field(p); ok(f.v === 'קניתי חלב' && f.s === 5 && f.e === 5, JSON.stringify(f));
    await p.keyboard.type('ש'); f = await field(p);
    ok(f.v === 'קניתיש חלב' && f.s === 6, JSON.stringify(f));
  });
  await check('C-2', 'redraw של הצ\'אט באמצע הקלדה (hashchange): הטקסט, הפוקוס והסמן נשארים', async () => {
    await start(p, 'נגמר הקוטג', 3);
    await p.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange'))); await p.waitForTimeout(800);
    const f = await field(p); ok(f.v === 'נגמר הקוטג' && f.focused && f.s === 7 && f.e === 7, JSON.stringify(f));
  });
  await check('C-3', 'בחירה של מילה נשמרת אחרי redraw', async () => {
    await start(p, 'יש לנו טונה', 0);
    await p.evaluate(() => document.getElementById('say').setSelectionRange(3, 6));
    await p.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange'))); await p.waitForTimeout(800);
    const f = await field(p); ok(f.s === 3 && f.e === 6, JSON.stringify(f));
  });
  await check('C-4', 'שורה נוספת (התיבה גדלה) כשהסמן באמצע: הסמן לא קופץ לסוף', async () => {
    await start(p, 'אחת שתיים שלוש ארבע חמש שש שבע שמונה תשע עשר אחת עשרה שתים עשרה', 10);
    const at = (await field(p)).s;
    await p.keyboard.type('ז');
    const f = await field(p); ok(f.s === at + 1, JSON.stringify(f));
    ok(!p.errors.length, p.errors.join(' | '));
  });
  await finish(b, `/tmp/shuki-test/caret-ui${BR === 'chromium' ? '' : `-${BR}`}.json`);
})();
