// Round 19 screens: Shuki's momentary reactions, "I noticed that...", the connection to another assistant,
// sharing a recipe, and the note when Shuki thinks with the other provider. Run: test/ui-qa.sh test/r19-ui.cjs
const { chromium } = require(process.env.PW);
const lib = require('./sweep-lib.cjs');
const { check, ok, phone, finish, d1, d1q } = lib;
const clean = (p) => p.evaluate(() => {
  const bad = [];
  if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('sideways scroll');
  const xs = [...document.querySelectorAll('main .btn, main .rowline, main .keyrow, main .field')].filter((e) => { const r = e.getBoundingClientRect(); return e.offsetParent && r.width > 0 && r.height > 0; });
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) {
    const a = xs[i].getBoundingClientRect(), b = xs[j].getBoundingClientRect();
    if (xs[i].contains(xs[j]) || xs[j].contains(xs[i])) continue;
    if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) bad.push(`${xs[i].textContent.slice(0, 20)} / ${xs[j].textContent.slice(0, 20)}`);
  }
  return bad;
});
const face = (p) => p.evaluate(() => { const s = document.querySelector('.band .shuki'); return { mood: s.dataset.mood, fx: s.dataset.fx || '', moves: [...s.classList].filter((c) => c.startsWith('r-')) }; });

(async () => {
  const b = await chromium.launch();
  const p = await phone(b, { w: 390, h: 844 });
  await p.api('POST', '/api/actions', { actions: [
    { kind: 'create', product: { name: 'עגבניות', count_type: 'level', level: 'plenty' } },
    { kind: 'create', product: { name: 'מלח', count_type: 'units', unit: 'שקית', qty: 1, is_basic: 1, target: 1 } },
  ] });
  const salt = (await p.state()).products.find((x) => x.name === 'מלח').id;

  await check('X1', 'זרקנו: שוקי בוכה כמה שניות, וחוזר למצב הקבוע', async () => {
    await p.reload2(); await p.go('#inventory');
    const base = (await face(p)).mood;
    await p.click('.fr:has-text("עגבניות")'); await p.click('#toss'); await p.waitForTimeout(1300);
    const f = await face(p); ok(f.mood === 'sad' && f.fx === 'cry' && f.moves.includes('r-droop'), JSON.stringify(f));
    await p.screenshot({ path: '/tmp/shuki-test/r19-cry.png', clip: { x: 0, y: 0, width: 390, height: 160 } });
    await p.waitForTimeout(2600);
    const g = await face(p); ok(g.fx === '' && !g.moves.length && g.mood !== 'sad', JSON.stringify(g) + ' base ' + base);
  });

  await check('X2', '"שמתי לב ש..." בהגדרות: כן / לא; "כן" מלמד, ושוקי קופץ עם נורה', async () => {
    const now = Date.now();
    d1(`INSERT INTO noticed (key, kind, product_id, data, count, first, last) VALUES ('rejects:${salt}', 'rejects', ${salt}, '{"v":null}', 3, ${now}, ${now})`);
    await p.reload2(); await p.go('#settings');
    const row = p.locator('.noticed', { hasText: 'נראה שאתם לא צריכים מלח ברשימה.' }) // 17/10, ש5; ok(await row.count() === 1, 'no row');
    ok(await row.locator('button', { hasText: 'נכון, תזכור' }).count() === 1 && await row.locator('button', { hasText: 'לא נכון' }).count() === 1, 'buttons');
    const bad = await clean(p); ok(!bad.length, bad.join(' | '));
    await p.screenshot({ path: '/tmp/shuki-test/r19-noticed.png', fullPage: true });
    await row.locator('button', { hasText: 'נכון, תזכור' }).click(); await p.waitForTimeout(700);
    const f = await face(p); ok(f.fx === 'bulb' && f.moves.includes('r-jump'), JSON.stringify(f));
    const s = await p.state(); ok(s.lessons.some((l) => l.text === 'לא אציע יותר מלח לרשימה'), 'no lesson'); ok(!s.products.find((x) => x.id === salt).is_basic, 'still regular');
    await p.waitForTimeout(600); ok(await p.locator('.noticed button', { hasText: 'להפסיק' }).count() === 1, 'a yes can be stopped');
  });

  await check('X3', 'חיבור לעוזר: יוצרים כתובת, היא מוצגת פעם אחת עם העתקה, ואפשר לנתק', async () => {
    await p.go('#settings');
    await p.fill('#c-name', 'Claude'); await p.click('#connForm button'); await p.waitForTimeout(900);
    const code = await p.textContent('#connBox code'); ok(/^http:\/\/127\.0\.0\.1:8791\/mcp\/[0-9a-f]{64}$/.test(code), code);
    ok(/Custom connector/.test(await p.textContent('#connBox')), 'no steps');
    await p.click('#connBox [data-copy]'); ok((await p.evaluate(() => navigator.clipboard.readText())) === code, 'copy');
    const bad = await clean(p); ok(!bad.length, bad.join(' | '));
    await p.screenshot({ path: '/tmp/shuki-test/r19-connector.png', fullPage: true });
    await p.go('#list'); await p.go('#settings');
    ok(!(await p.$('#connBox code')), 'shown twice'); ok(/Claude/.test(await p.textContent('.rowline:has([data-conn-del])')), 'not listed');
    const r = await p.evaluate(async (u) => (await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) })).status, code);
    ok(r === 200, `ping ${r}`);
    await p.click('[data-conn-del]'); await p.click('[data-conn-del]'); await p.waitForTimeout(800);
    ok(!(await p.$('[data-conn-del]')), 'still there');
    const r2 = await p.evaluate(async (u) => (await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) })).status, code);
    ok(r2 === 401, `after cutting off ${r2}`);
  });

  await check('X4', 'מתכון: כמה מנות, כמה פעמים הכנתם, ו"שיתוף" שולח אותו כטקסט', async () => {
    d1(`INSERT INTO recipes (id, name, ingredients, text, serves, cooked, added) VALUES (777, 'שקשוקה', '4 ביצים, 3 עגבניות, בצל', 'מטגנים בצל, מוסיפים עגבניות, שוברים ביצים', 4, 2, ${Date.now()})`);
    // round 21: recipes have their own tab; how many it serves is the "כמה אנשים?" stepper
    await p.reload2(); await p.go('#recipes');
    await p.click('[data-rec="777"]'); await p.waitForSelector('#rShare');
    ok((await p.textContent('.recipe-meta')) === 'הכנתם 2 פעמים', await p.textContent('.recipe-meta')); ok((await p.textContent('#pN')) === '4');
    await p.evaluate(() => { delete navigator.share; });
    await p.click('#rShare'); await p.waitForTimeout(300);
    const t = await p.evaluate(() => navigator.clipboard.readText());
    ok(t === 'שקשוקה (ל-4)\n\nמצרכים:\n• 4 ביצים\n• 3 עגבניות\n• בצל\n\nאופן ההכנה:\nמטגנים בצל, מוסיפים עגבניות, שוברים ביצים', JSON.stringify(t));
  });

  await check('X5', 'המנהל רואה ששוקי חושב עכשיו עם הספק השני', async () => {
    d1(`INSERT OR REPLACE INTO settings (key, value) VALUES ('fell_back', '{"from":"anthropic","to":"openai","why":"credit","ts":${Date.now()}}')`);
    await p.reload2(); await p.go('#settings');
    ok((await p.textContent('.house')).includes('נגמר הקרדיט ב-Claude, אז בינתיים אני חושב עם ChatGPT. כש-Claude יחזור, אחזור אליו לבד.'), 'no note');
    d1(`DELETE FROM settings WHERE key = 'fell_back'`);
  });

  await check('X6', 'בלי שגיאות בדף', async () => { ok(!p.errors.length, p.errors.join(' | ')); });
  await finish(b, 'test/r19-ui-results.json');
})();
