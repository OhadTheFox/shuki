// "a little left" of a non-basic product: the card in the chat and on the list, and its three answers.
// Run: test/ui-qa.sh test/low-ui.cjs
const { chromium } = require(process.env.PW);
const lib = require('./sweep-lib.cjs');
const { check, ok, phone, finish, d1 } = lib;
(async () => {
  const b = await chromium.launch();
  const p = await phone(b);
  await p.api('POST', '/api/actions', { actions: [
    { kind: 'create', product: { name: 'טחינה', count_type: 'units', unit: 'צנצנת', qty: 1 } },
    { kind: 'create', product: { name: 'חומוס', count_type: 'units', unit: 'קופסה', qty: 2 } },
    { kind: 'create', product: { name: 'ריבה', count_type: 'units', unit: 'צנצנת', qty: 1 } },
    { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 1, is_basic: 1, target: 1 } },
  ] });
  const id = async (n) => (await p.state()).products.find((x) => x.name === n).id;
  const low = async (n) => p.api('POST', '/api/actions', { actions: [{ kind: 'op', product_id: await id(n), op: { type: 'low' } }] });
  await check('N1', 'בסיסי שנשאר ממנו מעט → ישר לרשימה, בלי כרטיס', async () => {
    await low('חלב 3%'); const s = await p.state(); ok(s.list.some((i) => i.product_id === s.products.find((x) => x.name === 'חלב 3%').id), 'not listed'); ok(!s.lowAsk.length, 'asked about a basic');
  });
  await check('N2', 'לא בסיסי שנשאר ממנו מעט → כרטיס בצ\'אט עם שלוש תשובות', async () => {
    await low('טחינה'); await low('חומוס'); await low('ריבה'); await p.go('#chat'); await p.reload2();
    const t = await p.textContent('.low-card'); ok(/טחינה/.test(t) && /חומוס/.test(t) && /ריבה/.test(t), t);
    ok((await p.$$('.low-card [data-d=list]')).length === 3 && (await p.$$('.low-card [data-d=remind]')).length === 3 && (await p.$$('.low-card [data-d=no]')).length === 3, 'buttons');
    await p.screenshot({ path: '/tmp/shuki-test/low-chat.png' });
  });
  await check('N3', 'גם ברשימה, תחת "נשאר מעט"', async () => { await p.go('#list'); ok(/נשאר מעט/.test(await p.textContent('.lowbox')), 'no box'); await p.screenshot({ path: '/tmp/shuki-test/low-list.png', fullPage: true }); });
  await check('N4', '"לרשימה" → נכנס לרשימה והכרטיס יורד', async () => {
    await p.click('.lowbox .rq:has-text("טחינה") [data-d=list]'); await p.waitForTimeout(1200); const s = await p.state();
    ok(s.list.some((i) => i.product_id === s.products.find((x) => x.name === 'טחינה').id && i.status === 'open'), 'not listed'); ok(!s.lowAsk.some((x) => x.name === 'טחינה'), 'still asked');
  });
  await check('N5', '"בעוד 3 ימים" → לא ברשימה, תזכורת עם תאריך ב"נחשוב על זה"', async () => {
    await p.click('.lowbox .rq:has-text("חומוס") [data-d=remind]'); await p.waitForTimeout(1200); const s = await p.state();
    const m = s.maybe.find((x) => x.text === 'חומוס'); ok(m && m.kind === 'remind' && Math.round((m.due_at - Date.now()) / 864e5) === 3, JSON.stringify(m));
    ok(/אזכיר לך ב-/.test(await p.textContent('.maybe')), 'no date shown'); ok(!s.lowAsk.some((x) => x.name === 'חומוס'), 'still asked');
  });
  await check('N6', 'כשהתזכורת מגיעה → "הגיע הזמן. לקנות?" ו"לרשימה" מוסיף', async () => {
    lib.d1("UPDATE maybe SET due_at = 1 WHERE text = 'חומוס'"); await p.reload2(); await p.go('#list');
    ok(/הגיע הזמן/.test(await p.textContent('.maybe')), 'not due'); await p.click('.maybe [data-d=list]'); await p.waitForTimeout(1200);
    const s = await p.state(); ok(s.list.some((i) => i.product_id === s.products.find((x) => x.name === 'חומוס').id), 'not listed');
  });
  await check('N7', '"לא צריך" → לא שואל שוב, גם אחרי רענון ובטלפון השני', async () => {
    await p.click('.lowbox .rq:has-text("ריבה") [data-d=no]'); await p.waitForTimeout(1200); await p.reload2();
    ok(!(await p.state()).lowAsk.some((x) => x.name === 'ריבה'), 'asked again');
    const n = await phone(b, { user: 2 }); ok(!(await n.state()).lowAsk.some((x) => x.name === 'ריבה'), 'Michal still asked'); await n.ctx.close(); lib.shotPage = p;
  });
  await check('N8', 'ריבה נגמרה אחרי "לא צריך" → נכנסת לרשימה (נגמר זה נגמר)', async () => {
    await p.api('POST', '/api/actions', { actions: [{ kind: 'op', product_id: await id('ריבה'), op: { type: 'out' } }] }); const s = await p.state();
    ok(s.list.some((i) => i.product_id === s.products.find((x) => x.name === 'ריבה').id), 'out but not listed');
  });
  await check('N9', 'קנו → הסימון "נשאר מעט" יורד', async () => {
    await p.api('POST', '/api/actions', { actions: [{ kind: 'op', product_id: await id('טחינה'), op: { type: 'purchase', amount: 1 } }] });
    const x = (await p.state()).products.find((y) => y.name === 'טחינה'); ok(x.level !== 'little' && x.qty === 2, JSON.stringify(x));
  });
  await check('JS', 'אין שגיאות JavaScript', async () => ok(!p.errors.length, p.errors.join(' | ')));
  await check('N10', 'תזכורת יומית ב"תזכורות": "אזכיר לך כל יום ב-19:00" (r0t-10, אושר 04/10)', async () => {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(Date.now() + 86400e3);
    const hour = (ts) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }).format(ts));
    let at = Date.parse(`${day}T19:00:00Z`); at -= (hour(at) - 19) * 3600e3; // 19:00 in Israel
    d1(`INSERT INTO maybe (text, product_id, store, added_by, added, due_at, kind, repeat) VALUES ('להכין קופסאות', NULL, 'super', 1, ${Date.now()}, ${at}, 'remind', 'daily')`);
    await p.go('#list'); await p.reload2();
    const t = await p.textContent('.maybe.remind'); ok(/להכין קופסאות/.test(t) && /אזכיר לך כל יום ב-19:00/.test(t), t);
  });
  await finish(b, 'test/low-ui-results.json');
})();
