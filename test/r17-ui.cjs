// Round 17 screens: 👍 and 👎 beside each answer, 👎 that teaches Shuki a rule, and "what Shuki learned" in the settings.
// Run: test/ui-qa.sh test/r17-ui.cjs
const { chromium } = require(process.env.PW);
const lib = require('./sweep-lib.cjs');
const { check, ok, phone, finish } = lib;
const RULE = 'כשאבי אומר חלב הוא מתכוון למשקה סויה';
const hit = (a, b) => a && b && a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
/** The thumbs of every answer: inside the screen, and on nothing else (messages, names, cards). */
async function thumbsClear(p) {
  return p.evaluate(() => {
    const box = (e) => e.getBoundingClientRect();
    const bad = [];
    const others = [...document.querySelectorAll('#thread .msg, #thread .gray, #thread .coupon, #thread .coupon .scis, #thread .chips, #thread .chattabs')];
    for (const fb of document.querySelectorAll('#thread .fb')) {
      const a = box(fb), mine = fb.closest('.msg');
      if (a.left < 0 || a.right > innerWidth) bad.push(`off screen ${Math.round(a.left)}–${Math.round(a.right)}`);
      for (const o of others) {
        if (o === mine) continue;
        const b = o.getBoundingClientRect();
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) bad.push(`${o.className}: ${o.textContent.slice(0, 30)}`);
      }
    }
    return bad;
  });
}

(async () => {
  const b = await chromium.launch();
  const p = await phone(b, { w: 390, h: 844 });
  await p.api('POST', '/api/actions', { actions: [
    { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 1, is_basic: 1, target: 2 } },
    { kind: 'create', product: { name: 'משקה סויה', count_type: 'units', unit: 'קרטון', qty: 1 } },
  ] });

  await check('L1', 'ליד כל תשובה של שוקי שני אגודלים; 👍 נלחץ ונשאר; שום דבר לא עולה על שום דבר', async () => {
    await p.api('POST', '/api/chat', { text: 'היי' }); // one-line answers: the shortest bubble, the tightest margin
    await p.api('POST', '/api/chat', { text: 'מה קורה' });
    await p.reload2(); await p.go('#chat'); await p.waitForTimeout(400);
    ok((await p.$$('.msg.bot [data-up]')).length >= 2 && (await p.$$('.msg.bot [data-down]')).length >= 2, 'thumbs missing');
    const bad = await thumbsClear(p); ok(!bad.length, bad.join(' | '));
    const ups = await p.$$('[data-up]'); await ups[ups.length - 1].click(); await p.waitForTimeout(600);
    ok(await p.$('.up.on'), 'not pressed');
    ok(lib.d1q("SELECT kind FROM feedback ORDER BY id DESC LIMIT 1")[0]?.kind === 'up', 'not saved');
    await p.reload2(); await p.go('#chat'); ok(await p.$('.up.on'), 'forgot after reload');
    await p.screenshot({ path: '/tmp/shuki-test/r17-thumbs.png' });
  });

  await check('L2', '👎 עם הסבר: ההסבר עולה לצ\'אט עם סימן, שוקי שואל "האם תרצה שאזכור...?" עם כן/לא (בלי כרטיס), ואחרי "כן" זה בהגדרות', async () => {
    const downs = await p.$$('[data-down]'); await downs[downs.length - 1].click(); await p.waitForSelector('#fb-note');
    ok(/חלב/.test(await p.getAttribute('#fb-note', 'placeholder')), 'no example');
    await p.screenshot({ path: '/tmp/shuki-test/r17-sheet.png' });
    await p.fill('#fb-note', 'כשאני אומר חלב אני מתכוון לסויה'); await p.click('#fb-send');
    await p.waitForSelector('#thread [data-opt="כן, תזכור"]', { timeout: 8000 });
    ok(await p.$('.msg.me .fbmark'), 'my note has no mark');
    ok(await p.$('.down.on'), '👎 not pressed');
    ok(!(await p.$('.coupon.pending')), 'a card for learning');
    const q = await p.$$eval('#thread .msg.bot', (xs) => xs.at(-1).textContent); ok(/שאזכור/.test(q), q);
    await p.screenshot({ path: '/tmp/shuki-test/r17-learn-question.png' });
    await p.click('#thread [data-opt="כן, תזכור"]'); await p.waitForTimeout(1500);
    ok((await p.state()).lessons?.[0]?.text === RULE, 'not saved');
    const bad = await thumbsClear(p); ok(!bad.length, bad.join(' | '));
  });

  await check('L3', '"מה שוקי למד" בהגדרות: הכלל עם מי ומתי; עריכה ומחיקה עם "בטוח?"', async () => {
    await p.go('#settings');
    const t = await p.textContent('.taught'); ok(t.includes(RULE) && /אבי/.test(t), t.slice(0, 200));
    await p.$eval('.taught', (e) => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(200); await p.screenshot({ path: '/tmp/shuki-test/r17-settings.png' });
    await p.click('[data-lesson]'); await p.waitForSelector('#l-text');
    await p.fill('#l-text', `${RULE} (אורגני)`); await p.click('#l-save'); await p.waitForTimeout(800);
    ok((await p.textContent('.taught')).includes('(אורגני)'), 'edit not shown');
    await p.click('[data-lesson]'); await p.waitForSelector('#l-del');
    await p.click('#l-del'); ok((await p.textContent('#l-del')) === 'למחוק באמת?', 'no second tap');
    ok((await p.state()).lessons.length === 1, 'deleted on the first tap');
    await p.click('#l-del'); await p.waitForTimeout(800);
    ok((await p.state()).lessons.length === 0, 'not deleted');
    ok(/עוד לא למדתי כלום על הבית/.test(await p.textContent('.taught')), 'empty text');
  });

  await check('L4', 'מסך צר (320) וטקסט גדול: האגודלים בתוך המסך ולא על הודעות; ההגדרות בלי גלילה הצידה', async () => {
    const s = await phone(b, { w: 320, h: 568 });
    for (const px of [17, 23]) {
      await s.addStyleTag({ content: `html { font-size: ${px}px !important }` });
      await s.go('#chat'); await s.waitForTimeout(400);
      const bad = await thumbsClear(s); ok(!bad.length, `${px}px: ${bad.join(' | ')}`);
      await s.go('#settings'); await s.waitForTimeout(300);
      const wide = await s.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); ok(!wide, `${px}px: settings scroll sideways`);
    }
    await s.go('#chat'); await s.screenshot({ path: '/tmp/shuki-test/r17-320.png' });
    ok(s.errors.length === 0, s.errors.join(' | '));
  });

  await check('L5', 'בלי שגיאות בדף', async () => ok(p.errors.length === 0, p.errors.join(' | ')));
  await finish(b, 'test/r17-ui-results.json');
})();
