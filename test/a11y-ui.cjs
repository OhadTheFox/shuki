// Accessibility: axe-core on every main screen and the common sheets, at normal and at big text.
// Run: AXE=/path/to/axe.min.js test/ui-qa.sh test/a11y-ui.cjs   (npm i axe-core somewhere outside the project)
// PW_BROWSER=webkit: Safari's engine (פ25: what can be checked of Shuki's label before the simulator; VoiceOver is stage 12)
const chromium = require(process.env.PW)[process.env.PW_BROWSER || 'chromium'];
const fs = require('node:fs');
const lib = require('./sweep-lib.cjs');
const { check, ok, phone, finish } = lib;
const AXE = fs.readFileSync(process.env.AXE || '/tmp/shuki-test/axe/node_modules/axe-core/axe.min.js', 'utf8');
(async () => {
  const b = await chromium.launch();
  const p = await phone(b, { w: 390, h: 844, bypassCSP: true }); // axe goes in as an inline script, which the app's CSP blocks
  await p.api('POST', '/api/actions', { actions: [
    { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 0, is_basic: 1, target: 2 } },
    { kind: 'create', product: { name: 'עגבניות', count_type: 'level', level: 'little', store: 'greengrocer' } },
    { kind: 'list_add', text: 'נרות' },
  ] });
  await p.api('POST', '/api/chat', { text: 'היי' });
  const all = [];
  const scan = async (where) => {
    await p.addScriptTag({ content: AXE });
    const r = await p.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'], rules: { 'color-contrast': { enabled: true } } })).violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, where: v.nodes.slice(0, 3).map((x) => x.target.join(' ')) })));
    for (const v of r) all.push({ where, ...v });
    return r;
  };
  for (const [screen, big] of [['#chat', 0], ['#list', 0], ['#inventory', 0], ['#settings', 0], ['#chat', 23], ['#list', 23], ['#settings', 23]]) {
    await check(`A-${screen.slice(1)}${big ? '-big' : ''}`, `${screen}${big ? ' בטקסט גדול' : ''}: בלי בעיות נגישות חמורות`, async () => {
      await p.reload2();
      if (big) await p.addStyleTag({ content: `html { font-size: ${big}px !important }` });
      await p.go(screen); await p.waitForTimeout(400);
      const v = await scan(screen);
      const bad = v.filter((x) => x.impact === 'critical' || x.impact === 'serious');
      ok(!bad.length, bad.map((x) => `${x.id} (${x.impact}, ${x.n}): ${x.where.join(' | ')}`).join(' ;; '));
      return v.map((x) => `${x.id}:${x.impact}`).join(', ') || 'nothing';
    });
  }
  // פ27 (the owner 06/10, r7b): the fields' names come from labels on screen
  const named = async (role, name) => { const l = p.getByRole(role, { name, exact: true }); ok((await l.count()) === 1, `${role} "${name}": ${await l.count()}`); return l.evaluate((el) => ({ id: el.id, ph: el.placeholder, label: [...(el.labels || [])].concat((el.getAttribute('aria-labelledby') || '').split(' ').map((x) => document.getElementById(x)).filter(Boolean)).map((x) => x.getBoundingClientRect().height) })); };
  await check('A-lbl', 'כותרות גלויות: "להוסיף לרשימה" בלי placeholder; "שם", "לשון פנייה", "תפקיד"; "הערות לבית" דרך aria-labelledby', async () => {
    await p.reload2(); await p.go('#list');
    let x = await named('textbox', 'להוסיף לרשימה');
    ok(x.id === 'addTxt' && !x.ph && x.label.length === 1 && x.label[0] > 0, JSON.stringify(x));
    await p.go('#settings'); await p.waitForTimeout(300);
    for (const [role, name, id] of [['textbox', 'שם', 'm-name'], ['combobox', 'לשון פנייה', 'm-gender'], ['combobox', 'תפקיד', 'm-role'], ['textbox', 'הערות לבית', 'h-notes']]) {
      x = await named(role, name); ok(x.id === id && x.label.length === 1 && x.label[0] > 0, `${name}: ${JSON.stringify(x)}`);
    }
  });
  await check('A-basic', '"מוצר קבוע" בחלון המוצר: השורה כולה, 44px לפחות, והתיבה בתוכה', async () => {
    await p.reload2(); await p.go('#inventory'); await p.click('.fr'); await p.waitForSelector('#f-basic');
    const h = await p.evaluate(() => { const l = document.querySelector('#f-basic').closest('label'); return l.matches('.switch') && l.getBoundingClientRect().height; });
    ok(h >= 44, `the row: ${h}px`);
    return `${Math.round(h)}px`;
  });
  // פ25 (r12 q001, q002; the owner 06/10, r7b): what a screen reader hears from Shuki. "חלב 3%" is a basic, 0 of 2: hungry
  const HUNGRY = 'שוקי. מצב הרוח שלי: רעב. צריך להשלים מוצר קבוע אחד';
  const label = () => p.$eval('.band .mascot svg', (x) => x.getAttribute('aria-label'));
  await check('A-vo1', 'השם של שוקי: מצב הרוח והסיבה', async () => {
    await p.reload2(); await p.go('#chat');
    ok((await label()) === HUNGRY, await label());
  });
  await check('A-vo2', 'נגיעה בשוקי מחליפה את הפרצוף, לא את מה שנאמר', async () => {
    const was = await p.$eval('.band .mascot svg', (x) => x.dataset.mood);
    await p.click('.band .mascot'); await p.waitForTimeout(150);
    const now = await p.$eval('.band .mascot svg', (x) => x.dataset.mood);
    ok(now !== was, `data-mood stayed ${was}`); ok((await label()) === HUNGRY, await label());
    return `${was} → ${now}`;
  });
  await check('A-vo3', 'רק התשובה החדשה של שוקי נאמרת (#spoken); השיחה עצמה לא aria-live, ו-refresh לא משנה', async () => {
    await p.reload2(); await p.go('#chat');
    ok(!(await p.$eval('#thread', (x) => x.hasAttribute('aria-live'))), '#thread is aria-live');
    const sent = p.waitForResponse((r) => r.url().endsWith('/api/chat') && r.request().method() === 'POST');
    await p.fill('#say', 'היי'); await p.click('#send');
    const r = await (await sent).json();
    await p.waitForFunction(() => document.querySelector('#spoken')?.textContent);
    const spoken = await p.textContent('#spoken');
    ok(spoken === r.reply, `${spoken} ≠ ${r.reply}`);
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(1200); // refresh() and loadChat()
    await p.go('#list'); await p.go('#chat'); await p.waitForTimeout(500); // and a whole redraw
    ok((await p.textContent('#spoken')) === spoken, `after refresh: ${await p.textContent('#spoken')}`);
    // the same answer again: #spoken is emptied and written again, so it is said again
    await p.evaluate(() => { window.__spoken = []; new MutationObserver(() => window.__spoken.push(document.querySelector('#spoken').textContent)).observe(document.querySelector('#spoken'), { childList: true, characterData: true, subtree: true }); });
    await p.fill('#say', 'היי'); await p.click('#send');
    await p.waitForFunction((s) => window.__spoken.at(-1) === s, spoken);
    const seen = await p.evaluate(() => window.__spoken);
    ok(seen.includes('') && seen.at(-1) === spoken, JSON.stringify(seen));
    return spoken;
  });
  fs.writeFileSync('test/a11y-findings.json', JSON.stringify(all, null, 1));
  // stage 13, d10/d11 (Q13-2..Q13-5): what VoiceOver needs with no new words
  await check('A-13', 'גיליון: הדיאלוג כולל את ה-✕, שמו מהכותרת, המיקוד נכנס וחוזר; שורה ברשימה ושורה בכרטיס אומרות אם הן מסומנות; המצלמה כפתור "צילום קבלה או מוצר"', async () => {
    await p.reload2(); await p.go('#inventory'); await p.waitForTimeout(300);
    await p.evaluate(() => { const r = [...document.querySelectorAll('.fr')].find((x) => x.textContent.includes('חלב')); r.focus(); r.click(); });
    await p.waitForSelector('.scrim'); await p.waitForTimeout(200);
    const d = await p.evaluate(() => { const dlg = document.querySelector('.scrim [role=dialog]'); const lab = dlg && document.getElementById(dlg.getAttribute('aria-labelledby') || '');
      return { modal: dlg?.getAttribute('aria-modal'), x: !!dlg?.querySelector('.sheet-x'), name: lab?.textContent || '', inside: !!dlg?.contains(document.activeElement) }; });
    ok(d.modal === 'true' && d.x, `the dialog: ${JSON.stringify(d)}`); ok(/חלב/.test(d.name), `its name: ${d.name}`); ok(d.inside, 'the focus stayed outside');
    await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    ok(await p.evaluate(() => document.activeElement?.classList.contains('fr') && document.activeElement.textContent.includes('חלב')), 'the focus didn\'t go back to the row');
    await p.go('#list'); await p.waitForTimeout(300);
    const row = p.locator('button.item', { hasText: 'נרות' }).first();
    ok((await row.getAttribute('aria-pressed')) === 'false', `before: ${await row.getAttribute('aria-pressed')}`);
    await row.click(); await p.waitForTimeout(500);
    ok((await p.locator('button.item', { hasText: 'נרות' }).first().getAttribute('aria-pressed')) === 'true', 'after ticking');
    await p.go('#chat'); await p.waitForTimeout(300);
    await p.fill('#say', 'נגמר החלב'); await p.click('#send'); await p.waitForSelector('.coupon.pending li .tick', { timeout: 10000 });
    const t = p.locator('.coupon.pending li .tick').first();
    const t0 = await t.evaluate((b) => ({ pressed: b.getAttribute('aria-pressed'), desc: document.getElementById(b.getAttribute('aria-describedby') || '')?.textContent || '' }));
    ok(t0.pressed === 'true' && t0.desc.length > 0, `the tick: ${JSON.stringify(t0)}`);
    await t.click(); ok((await t.getAttribute('aria-pressed')) === 'false', 'after unticking');
    const cam = p.getByRole('button', { name: 'צילום קבלה או מוצר', exact: true });
    ok((await cam.count()) === 1, `the camera: ${await cam.count()}`);
    await cam.focus(); ok(await cam.evaluate((b) => document.activeElement === b), 'the camera can\'t be focused');
  });
  await finish(b, 'test/a11y-results.json');
})();
