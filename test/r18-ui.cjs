// Round 18 screens: ordered online, weekly buys in the settings, a second place, leftovers, CSV, deleting the house.
// Run: test/ui-qa.sh test/r18-ui.cjs
const { chromium } = require(process.env.PW);
const lib = require('./sweep-lib.cjs');
const { check, ok, phone, finish } = lib;
/** Nothing on the page sits on anything else, and nothing runs off the side. */
const clean = (p) => p.evaluate(() => {
  const bad = [];
  if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('sideways scroll');
  const xs = [...document.querySelectorAll('main .btn, main .item, main .rowline, main .chip, main .msg, main .fr')].filter((e) => { const r = e.getBoundingClientRect(); return e.offsetParent && r.width > 0 && r.height > 0 && !e.closest('details:not([open])'); });
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) {
    const a = xs[i].getBoundingClientRect(), b = xs[j].getBoundingClientRect();
    if (xs[i].contains(xs[j]) || xs[j].contains(xs[i])) continue;
    if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) bad.push(`${xs[i].textContent.slice(0, 20)} / ${xs[j].textContent.slice(0, 20)}`);
  }
  return bad;
});

(async () => {
  const b = await chromium.launch();
  const p = await phone(b, { w: 390, h: 844 });
  await p.api('POST', '/api/actions', { actions: [
    { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 0, is_basic: 1, target: 2 } },
    { kind: 'create', product: { name: 'קולה', count_type: 'units', unit: 'בקבוק', qty: 1, is_basic: 1, target: 2 } },
  ] });
  const s0 = await p.state();
  await p.api('POST', '/api/actions', { actions: [{ kind: 'list_add', text: 'נייר אפייה' }] });

  await check('O1', 'הזמנו משלוח: הכל באפור עם "הוזמן, בדרך", לא נספר בלשונית; "המשלוח הגיע" מכניס למלאי', async () => {
    await p.reload2(); await p.go('#list');
    await p.click('#orderAll'); await p.waitForSelector('#ordGo'); await p.click('#ordGo'); await p.waitForTimeout(800);
    ok((await p.$$('.item.ordered')).length === 3, 'not greyed'); // milk, cola (basic, below its minimum) and the baking paper
    ok(/3 מוצרים בדרך במשלוח/.test(await p.textContent('header')), 'the line under the title');
    ok(/הוזמן, בדרך/.test(await p.textContent('.item.ordered')), 'no label');
    ok((await p.textContent('.flap.on .n')).trim() === '0', 'still counted');
    await p.screenshot({ path: '/tmp/shuki-test/r18-ordered.png' });
    const bad = await clean(p); ok(!bad.length, bad.join(' | '));
    await p.click('#arrivedAll'); await p.waitForSelector('#cameGo'); await p.click('#cameGo'); await p.waitForTimeout(900); // stage 9, מ24: "האם הגיע הכל?" first, all ticked
    const s = await p.state(); ok(s.products.find((x) => x.name === 'חלב 3%').qty > 0, 'stock'); ok(!s.list.some((i) => i.status === 'open'), 'still on the list');
  });

  await check('O2', 'שורה אחת: ⋯ → "הוזמן במשלוח"; נגיעה בשורה שהוזמנה → "הגיע" / "ביטול ההזמנה"', async () => {
    await p.api('POST', '/api/actions', { actions: [{ kind: 'list_add', text: 'מלח' }] }); await p.reload2(); await p.go('#list');
    await p.click('[data-more]'); await p.waitForSelector('[data-m="order"]'); await p.click('[data-m="order"]'); await p.waitForTimeout(700);
    ok(await p.$('.item.ordered'), 'not ordered');
    await p.click('.item.ordered'); await p.waitForSelector('#ordOff'); await p.screenshot({ path: '/tmp/shuki-test/r18-ordered-sheet.png' });
    await p.click('#ordOff'); await p.waitForTimeout(700); ok(!(await p.$('.item.ordered')), 'still ordered');
  });

  await check('W1', 'קונים כל שבוע: בהגדרות, תחת "מה שוקי למד", עם "להפסיק"', async () => {
    const id = s0.products.find((x) => x.name === 'חלב 3%').id;
    lib.d1(`INSERT INTO routines (product_id, weekday, store, added_by, added) VALUES (${id}, 5, 'super', 1, ${Date.now()})`);
    await p.reload2(); await p.go('#settings');
    const t = await p.textContent('.taught'); ok(/קניות קבועות/.test(t) && /חלב 3%/.test(t) && /קונים ביום שישי\. אני מוסיף לרשימה יום לפני/.test(t), t.slice(0, 300));
    await p.$eval('.taught', (e) => e.scrollIntoView({ block: 'center' })); await p.screenshot({ path: '/tmp/shuki-test/r18-weekly.png' });
    await p.click('[data-routine-off]'); await p.waitForTimeout(700); ok(!(await p.state()).routines.length, 'not stopped');
  });

  await check('R1', 'מקום נוסף בדף המוצר: כמות ומקום; במלאי "+ 6 במרפסת"; בלי מקום → הודעה', async () => {
    lib.d1(`INSERT INTO locations (name, sort) VALUES ('מרפסת', 70)`);
    await p.reload2(); await p.go('#inventory');
    await p.click(`[data-p="${s0.products.find((x) => x.name === 'קולה').id}"]`); await p.waitForSelector('#f-rq');
    await p.fill('#f-rq', '6'); await p.click('#save'); await p.waitForTimeout(400);
    ok(/איפה נמצא המקום הנוסף/.test(await p.textContent('#f-err')), 'no message');
    await p.selectOption('#f-rloc', { label: 'מרפסת' }); await p.click('#save'); await p.waitForTimeout(900);
    ok(/\+ 6 במרפסת/.test(await p.textContent('.facts')), (await p.textContent('.facts')).slice(0, 300));
    await p.screenshot({ path: '/tmp/shuki-test/r18-reserve.png' });
  });

  await check('L1', 'שאריות: במלאי למעלה עם "גמרנו"; אחרי 3 ימים שאלה בצ\'אט עם "גמרנו" / "עוד יש"', async () => {
    lib.d1(`INSERT INTO leftovers (text, made, added_by) VALUES ('פסטה', ${Date.now() - 4 * 864e5}, 1), ('מרק', ${Date.now() - 864e5}, 1)`);
    await p.reload2(); await p.go('#inventory');
    const t = await p.textContent('.leftovers'); ok(/פסטה/.test(t) && /מאתמול/.test(t), t);
    await p.go('#chat'); await p.waitForTimeout(400);
    const th = await p.textContent('#thread'); ok(/הפסטה מיום \S+ עוד במקרר\?/.test(th), th.slice(-200));
    ok(!/המרק/.test(th), 'asked about the soup too early');
    await p.screenshot({ path: '/tmp/shuki-test/r18-leftover.png' });
    await p.click('[data-lo-keep]'); await p.waitForTimeout(700); ok(!/הפסטה מיום/.test(await p.textContent('#thread')), 'still asking');
    await p.go('#inventory'); await p.click('.leftovers [data-lo-gone]'); await p.waitForTimeout(700);
    ok((await p.state()).leftovers.length === 1, 'not gone');
  });

  await check('C1', 'הגדרות: שני כפתורי אקסל מורידים CSV; שורת שעות השקט', async () => {
    await p.go('#settings');
    ok(/בלי התראות בין 23:00 ל-07:00/.test(await p.textContent('.set')), 'no quiet line');
    const [res] = await Promise.all([p.waitForResponse((r) => r.url().includes('/api/export.csv?what=inventory')), p.click('[data-csv="inventory"]')]);
    ok(res.status() === 200 && /text\/csv/.test(res.headers()['content-type']), String(res.status()));
  });

  await check('N1', 'מסך צר (320) וטקסט גדול: רשימה עם הזמנה, מלאי עם רזרבה ושאריות, הגדרות — בלי חפיפות ובלי גלילה הצידה', async () => {
    const s = await phone(b, { w: 320, h: 568 });
    await s.api('POST', '/api/actions', { actions: [{ kind: 'list_add', text: 'סוכר' }] });
    const st = await s.state(); await s.api('POST', '/api/actions', { actions: [{ kind: 'order', item_id: st.list.find((i) => i.text === 'סוכר').id }] });
    for (const px of [17, 23]) {
      await s.addStyleTag({ content: `html { font-size: ${px}px !important }` });
      for (const r of ['#list', '#inventory', '#settings', '#chat']) { await s.reload2(); await s.addStyleTag({ content: `html { font-size: ${px}px !important }` }); await s.go(r); await s.waitForTimeout(300); const bad = await clean(s); ok(!bad.length, `${px}px ${r}: ${bad.join(' | ')}`); }
    }
    await s.go('#list'); await s.screenshot({ path: '/tmp/shuki-test/r18-320-list.png' });
    ok(s.errors.length === 0, s.errors.join(' | '));
  });

  await check('D1', 'מחיקת הבית: גיבוי קודם, שם לא נכון = הודעה, שם נכון = חזרה למסך ההקמה', async () => {
    await p.go('#settings'); await p.click('#houseDel'); await p.waitForSelector('#delName');
    await p.screenshot({ path: '/tmp/shuki-test/r18-delete.png' });
    await p.fill('#delName', 'לא זה'); await p.click('#delGo'); await p.waitForTimeout(500);
    ok(/השם לא תואם/.test(await p.textContent('#delErr')), 'no error');
    await p.fill('#delName', (await p.state()).house); await p.click('#delGo'); await p.waitForTimeout(1200);
    ok(await p.$('#code, #s-code, input[inputmode="numeric"]'), 'not back at the start');
  });

  await check('E1', 'בלי שגיאות בדף', async () => ok(p.errors.length === 0, p.errors.join(' | ')));
  await finish(b, 'test/r18-ui-results.json');
})();
