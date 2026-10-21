// home19, after the approval (18/10, the owner: on the computer, in Chrome, in the inventory, the space doesn't go in): "חומץ " and
// then the inventory drawn again from what was kept (the search), as a real house does: a change from another phone while
// typing is drawn when the box is left (renderLater on focusout), and the way back to the screen (another tab, then back).
// The box holds "חומץ " and the rest goes after it: "חומץ בלסמי". Desktop size, no touch. Chromium and WebKit.
const pw = require(process.env.PW), BR = process.env.PW_BROWSER || 'chromium', browser = pw[BR];
const { check, ok, phone, finish, d1 } = require('./sweep-lib.cjs');
const WORD = 'חומץ בלסמי';
const typeIn = async (p, sel, s) => { for (const ch of s) { if (ch === ' ') await p.keyboard.press('Space'); else await p.keyboard.type(ch); await p.waitForTimeout(60); } };
const valueOf = (p, sel) => p.locator(sel).first().evaluate((el) => el.value);
const clear = (p, sel) => p.locator(sel).first().evaluate((el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });

(async () => {
  const b = await browser.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
  const ctxPage = await phone(b, { w: 1280, h: 800 });
  const p = ctxPage;
  for (const [id, scr, sel, other] of [['SB-1', '#inventory', '#invQ', '#list'], ['SB-2', '#recipes', '#recQ', '#inventory']]) {
    await check(id, `${sel} במחשב: "חומץ ", מעבר למסך אחר ובחזרה, והמשך "בלסמי": "חומץ בלסמי"`, async () => {
      await p.go(scr); await clear(p, sel); await p.waitForTimeout(250);
      await p.click(sel); await typeIn(p, sel, 'חומץ '); await p.waitForTimeout(300);
      await p.go(other); await p.go(scr); await p.waitForTimeout(300);
      const mid = await valueOf(p, sel);
      ok(mid === 'חומץ ', `back on the screen: ${JSON.stringify(mid)}`);
      await p.click(sel); await p.keyboard.press('End'); await typeIn(p, sel, 'בלסמי'); await p.waitForTimeout(300);
      const end = await valueOf(p, sel);
      ok(end === WORD, JSON.stringify(end));
      await clear(p, sel); await p.waitForTimeout(250);
    });
  }
  await check('SB-3', '#invQ במחשב: "חומץ ", שינוי מטלפון אחר בזמן ההקלדה, יציאה מהתיבה (המסך מצטייר אז), והמשך "בלסמי": "חומץ בלסמי"', async () => {
    await p.go('#inventory'); await clear(p, '#invQ'); await p.waitForTimeout(250);
    await p.click('#invQ'); await typeIn(p, '#invQ', 'חומץ '); await p.waitForTimeout(300);
    d1(`INSERT INTO products (name, aliases, count_type, qty, created, updated) VALUES ('מוצר מטלפון אחר ${Date.now()}', '[]', 'units', 1, 0, 0)`);
    await p.waitForTimeout(31000); // the app's own poll (every 30 s without a trip): drawn later, when the box is left
    await p.mouse.click(5, 790); await p.waitForTimeout(800);
    const mid = await valueOf(p, '#invQ');
    ok(mid === 'חומץ ', `after the redraw: ${JSON.stringify(mid)}`);
    await p.click('#invQ'); await p.keyboard.press('End'); await typeIn(p, '#invQ', 'בלסמי'); await p.waitForTimeout(300);
    ok((await valueOf(p, '#invQ')) === WORD, JSON.stringify(await valueOf(p, '#invQ')));
    await clear(p, '#invQ');
  });
  await finish(b, `/tmp/shuki-test/home19b-space-${BR}.json`);
})();
