// Round 15 screens: a child's request and the grown-up's answer, weights and brands on the list, three trips without it,
// a hosting tab, notification switches, house notes and roommates, the "Shuki can't think" bar. Run: test/ui-qa.sh test/r15-ui.cjs
const { chromium } = require(process.env.PW);
const lib = require('./sweep-lib.cjs');
const { check, ok, phone, finish } = lib;
(async () => {
  const b = await chromium.launch();
  const p = await phone(b, { w: 360, h: 740 });
  await p.api('POST', '/api/actions', { actions: [
    { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 0, is_basic: 1, target: 1, brand: 'תנובה' } },
    { kind: 'create', product: { name: 'בשר טחון', count_type: 'level', level: 'none' } },
    { kind: 'list_add', text: 'בשר טחון', amount: 0.5, unit: 'ק"ג' },
  ] });
  const add = await p.api('POST', '/api/members', { add: { name: 'יובל', gender: 'm', role: 'child' } });
  const kid = await b.newContext({ viewport: { width: 360, height: 740 }, serviceWorkers: 'block' }); const k = await kid.newPage();
  await k.goto(lib.BASE + '/'); await k.fill('#code', add.code); await k.click('#pair button[type=submit]'); await k.waitForSelector('#say');
  await k.evaluate(async () => { await fetch('/api/actions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${JSON.parse(localStorage.getItem('shuki.token'))}` }, body: JSON.stringify({ actions: [{ kind: 'list_add', text: 'במבה' }] }) }); });

  await check('R1', 'ברשימה: מותג מתחת לשם, "חצי קילו", ובקשה של הילד עם "לאשר / לא"', async () => {
    await p.reload2(); await p.go('#list');
    const t = await p.textContent('.listwrap');
    ok(/תנובה/.test(t), 'brand'); ok(/חצי קילו/.test(t), 'weight'); ok(/יובל ביקש(?!\/)/.test(t), 'request');
    await p.screenshot({ path: '/tmp/shuki-test/r15-list.png', fullPage: true });
    await p.click('[data-approve][data-yes]'); await p.waitForTimeout(900);
    const s = await p.state(); ok(s.list.find((i) => i.text === 'במבה').approved === 1, 'not approved');
  });
  await check('R2', 'אצל הילד: "מחכה לאישור", בלי כפתורים', async () => {
    await k.evaluate(async () => { await fetch('/api/actions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${JSON.parse(localStorage.getItem('shuki.token'))}` }, body: JSON.stringify({ actions: [{ kind: 'list_add', text: 'שוקולד' }] }) }); });
    await k.reload(); await k.waitForTimeout(900); await k.evaluate(() => { location.hash = '#list'; }); await k.waitForTimeout(500);
    const t = await k.textContent('.listwrap'); ok(/שוקולד/.test(t) && /מחכה לאישור/.test(t), t);
    ok(!(await k.$('[data-approve]')), 'the child sees approve buttons');
  });
  await check('R3', 'שלוש קניות בלי: "לא נקנה כבר שלוש פעמים" עם להוריד / להשאיר', async () => {
    lib.d1("UPDATE list_items SET skipped = 3 WHERE text = 'במבה'");
    await p.reload2(); await p.go('#list');
    const t = await p.textContent('.listwrap');
    ok(/במבה ברשימת הקניות אבל לא קניתם אותה שלוש פעמים כשהייתם בסופר\. מה לעשות איתה\?/.test(t), `no card: ${t.slice(0, 300)}`); // d45 (c02)
    ok((await p.$$eval('.stale .three-btn button', (bs) => bs.map((x) => x.textContent))).join(' · ') === 'להוריד · להחליף · להשאיר', 'the three buttons (c01)');
    await p.click('[data-stale][data-d=keep]'); await p.waitForTimeout(900);
    ok(!(await p.$('.stale')), 'card stays');
  });
  await check('R4', 'לשונית אירוח מופיעה ליד החנויות', async () => {
    lib.d1(`INSERT OR REPLACE INTO settings (key, value) VALUES ('stores', '${JSON.stringify([{ id: 'etest', name: 'אירוח שישי', until: Date.now() + 5 * 864e5 }])}')`);
    await p.reload2(); await p.go('#list');
    const tabs = await p.$$eval('.flap', (xs) => xs.map((x) => x.textContent)); ok(tabs.some((x) => /אירוח שישי/.test(x)), JSON.stringify(tabs));
    await p.go('#settings'); ok(/רשימת אירוח, נסגרת/.test(await p.textContent('.set')), 'hosting in settings');
  });
  await check('R5', 'הגדרות: מתגי התראות, הערות לבית, דירת שותפים, הוספת ילד', async () => {
    await p.go('#settings');
    const n = await p.$$('[data-notify]'); ok(n.length === 6, `toggles ${n.length}`);
    await p.click('[data-notify="expiry"]'); await p.waitForTimeout(800); ok((await p.state()).notify.expiry === false, 'expiry off');
    await p.fill('#h-notes', 'אלרגיה לבוטנים'); await p.click('#notesForm button'); await p.waitForTimeout(800);
    ok((await p.state()).notes === 'אלרגיה לבוטנים', 'notes');
    await p.click('#h-room'); await p.waitForTimeout(800); ok((await p.state()).roommates === true, 'roommates');
    ok(await p.$('#m-role'), 'role select');
    await p.screenshot({ path: '/tmp/shuki-test/r15-settings.png', fullPage: true });
    await p.click('#h-room'); await p.waitForTimeout(600);
  });
  await check('R6', 'שוקי בלי קרדיט: פס צהוב בצ\'אט, התיבה נעולה; למנהל יש "בדיקה"', async () => {
    lib.d1(`INSERT OR REPLACE INTO settings (key, value) VALUES ('brain_error', '{"kind":"credit","ts":${Date.now()}}')`);
    await p.reload2(); await p.go('#chat'); await p.waitForTimeout(400);
    ok(/נגמר לי הקרדיט/.test(await p.textContent('#brainBar')), 'bar'); ok(await p.$eval('#say', (x) => x.disabled), 'not locked'); ok(await p.$('#brainCheck'), 'check button');
    await p.screenshot({ path: '/tmp/shuki-test/r15-nobrain.png' });
    await k.evaluate(() => { location.hash = '#chat'; }); await k.reload(); await k.waitForTimeout(900);
    ok(/לא זמין כרגע/.test(await k.textContent('#brainBar')), 'kid bar'); ok(!(await k.$('#brainCheck')), 'kid check');
    lib.d1("DELETE FROM settings WHERE key = 'brain_error'");
  });
  ok(!p.errors.length, p.errors.join('; '));
  await finish(b, 'test/r15-ui-results.json');
})();
