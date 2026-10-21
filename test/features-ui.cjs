// UI checks for shopping mode, learning and growth, with two phones (Avi, Michal).
// Run: test/ui-qa.sh test/features-ui.cjs
const { chromium } = require(process.env.PW);
const BASE = process.env.BASE || 'http://127.0.0.1:8791';
const results = [];
const check = async (id, name, fn) => {
  try { const note = await fn(); results.push({ id, name, ok: true, note: note || '' }); console.log('✓', id, name, note ? `— ${note}` : ''); }
  catch (e) { results.push({ id, name, ok: false, error: e.message.split('\n')[0] }); console.log('✗', id, name, '\n   ', e.message.split('\n')[0]); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };
const shot = (p, n) => p.screenshot({ path: `/tmp/shuki-test/f-${n}.png` });

(async () => {
  const b = await chromium.launch();
  const phone = async (code) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const p = await ctx.newPage(); p.errors = []; p.on('pageerror', (e) => p.errors.push(e.message));
    await p.goto(BASE + '/'); await p.fill('#code', code); await p.click('#pair button[type=submit]'); await p.waitForSelector('#say');
    return p;
  };
  const avi = await phone('111111');
  const michal = await phone('222222');
  // a catalog to shop from
  await avi.fill('#say', 'מתחילים מהמקרר, הכל קבוע'); await avi.click('#send'); await avi.waitForSelector('.coupon.pending');
  await avi.click('.coupon [data-do=apply]'); await avi.waitForSelector('.coupon.applied'); await avi.waitForTimeout(600);

  await check('U1', 'אבי כותב "אני עושה קניות": עובר לרשימה, ומופיע פס מצב קניות', async () => {
    await avi.fill('#say', 'אני עושה קניות'); await avi.click('#send');
    await avi.waitForFunction(() => location.hash === '#list', null, { timeout: 6000 });
    await avi.waitForSelector('.trip.mine');
    await shot(avi, 'u1-avi-trip');
    return (await avi.textContent('.trip.mine')).trim();
  });

  await check('U2', 'אצל מיכל: פס "אבי בקניות עכשיו"', async () => {
    await michal.goto(BASE + '/#list'); await michal.reload(); await michal.waitForSelector('.trip.other');
    const t = await michal.textContent('.trip.other');
    ok(/אבי בקניות עכשיו/.test(t), t);
    ok(await michal.$('#tripGo'), 'Michal can still start her own trip');
    ok(/יוצאת/.test(await michal.textContent('#tripGo')), 'feminine button for Michal');
    await shot(michal, 'u2-michal-banner');
    return t.trim();
  });

  await check('U3', 'מיכל מוסיפה במבה: אצל אבי היא מופיעה תוך שניות עם תג "חדש" והודעה', async () => {
    await michal.fill('#addTxt', 'במבה'); await michal.click('#adder button[type=submit]'); await michal.waitForTimeout(800);
    const t0 = Date.now();
    await avi.waitForSelector('.item .new', { timeout: 15000 });
    const secs = Math.round((Date.now() - t0) / 1000);
    const toastSeen = await avi.waitForSelector('.toast', { timeout: 3000 }).then((e) => e.textContent()).catch(() => '');
    await shot(avi, 'u3-avi-new');
    ok(/מיכל הוסיפה לרשימה: במבה/.test(toastSeen), `toast: ${toastSeen}`);
    return `הופיע אחרי ${secs} שניות`;
  });

  await check('U4', 'אבי לוחץ "סיימתי": המצב נסגר אצל שניהם', async () => {
    await avi.click('#tripEnd'); await avi.waitForSelector('#tripGo', { timeout: 5000 });
    ok(!(await avi.$('.trip.mine')), 'trip bar gone');
    await michal.reload(); await michal.waitForSelector('#tripGo');
    await michal.waitForFunction(() => !document.querySelector('.trip.other'), null, { timeout: 5000 }).catch(() => {});
    ok(!(await michal.$('.trip.other')), 'Michal banner gone');
  });

  // the level's line is .lvname since round 21 (b94bfb0); the check waited for .lvl and timed out (stage 5)
  await check('U5', 'הגדרות: כרטיס הרמה עם פס התקדמות; בלי כרטיס למידה ריק', async () => {
    await avi.goto(BASE + '/#settings'); await avi.waitForSelector('.grow .lvname b');
    const lvl = await avi.textContent('.grow .lvname b');
    ok(/רמה \d/.test(lvl), lvl);
    ok(await avi.$('.grow .xp i'), 'xp bar');
    ok(await avi.$('.grow .mini svg.shuki'), 'mini Shuki');
    ok(!/כל כמה זמן נגמר/.test(await avi.textContent('.set')), 'nothing learned yet: no empty card');
    await shot(avi, 'u5-settings');
    return `${lvl} · ${await avi.textContent('.grow .lvname span')}`;
  });

  await check('U6', 'עלייה ברמה: הודעה פעם אחת, והבובה מקבלת את המתנה', async () => {
    await avi.evaluate(() => { localStorage.removeItem('shuki.seenLevel'); localStorage.setItem('shuki.seenGrowth', '-1'); }); // stage 10: in points
    await avi.goto(BASE + '/#chat'); await avi.reload(); await avi.waitForSelector('#say');
    const t = await avi.waitForSelector('.toast', { timeout: 5000 }).then((e) => e.textContent());
    ok(/גדלתי! עליתי לרמה/.test(t), t);
    ok(await avi.evaluate(() => JSON.parse(localStorage.getItem('shuki.seenGrowth')) >= 0), 'remembered');
    await avi.reload(); await avi.waitForSelector('#say'); await avi.waitForTimeout(1500);
    ok(!/גדלתי/.test(await avi.evaluate(() => document.querySelector('.toast')?.textContent || '')), 'only once');
    return t;
  });

  await check('U7', 'הבובה לובשת את מה שנפתח: רמה 8 = פפיון, משקפיים, סרט; רמה 21 = כתר', async () => {
    const cls = await avi.evaluate(async () => {
      const { mount } = await import('./shuki.js');
      const d = document.createElement('div'); d.style.cssText = 'width:120px;height:120px'; document.body.append(d);
      const m = mount(d, 'happy', 8);
      const vis = (sel) => getComputedStyle(d.querySelector(sel)).display !== 'none';
      const r = [vis('.acc-bow'), vis('.acc-glasses'), vis('.acc-band'), vis('.acc-medal'), vis('.acc-crown')];
      m.setLook(21); r.push(vis('.acc-crown'), vis('.acc-band'));
      m.setLook({ level: 21, wear: { eyes: 'shades' } }); r.push(vis('.acc-shades'), vis('.acc-crown'));
      d.remove(); return r;
    });
    ok(JSON.stringify(cls) === JSON.stringify([true, true, true, false, false, true, false, true, false]), JSON.stringify(cls));
  });

  await check('JS', 'אין שגיאות JavaScript בשני הטלפונים', async () => ok(!avi.errors.length && !michal.errors.length, [...avi.errors, ...michal.errors].join(' | ')));
  require('fs').writeFileSync(__dirname + '/features-ui-results.json', JSON.stringify(results, null, 1));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} feature UI checks passed`);
  await b.close();
  process.exitCode = results.every((r) => r.ok) ? 0 : 1; // stage 5: a failed check fails the run (runall showed rc=0 with U5 failing)
})().catch((e) => { console.error(e); process.exit(1); });
