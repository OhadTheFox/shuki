// Round 16 screens: "since you were here", "only mine", 👎, the month's cost and the cap, going back a day,
// opening on the list while shopping, Android install steps, a card that deletes a lot. Run: test/ui-qa.sh test/r16-ui.cjs
const { chromium, devices } = require(process.env.PW);
const lib = require('./sweep-lib.cjs');
const { check, ok, phone, finish } = lib;
(async () => {
  const b = await chromium.launch();
  const p = await phone(b, { w: 390, h: 844 });           // Avi, the admin
  const n = await phone(b, { w: 390, h: 844, user: 2 });  // Michal
  await p.api('POST', '/api/actions', { actions: [
    { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 1, is_basic: 1, target: 2 } },
    ...['א', 'ב', 'ג', 'ד', 'ה', 'ו'].map((x) => ({ kind: 'create', product: { name: `תבלין ${x}`, count_type: 'level', level: 'plenty' } })),
  ] });

  // stage 5 (q04, q02, approved 02/10): the "מאז שהיית כאן" bar is gone; what Michal did meanwhile is a gray line in the chat
  await check('V1', 'חוזרים אחרי חצי יום: בלי הפס "מאז שהיית כאן"; מה שמיכל עשתה בינתיים הוא שורה אפורה בצ\'אט (פתק קרטון)', async () => {
    await p.ctx.addInitScript(() => { if (!sessionStorage.getItem('planted')) { sessionStorage.setItem('planted', '1'); localStorage.setItem('shuki.seenAt', JSON.stringify(Date.now() - 13 * 3600e3)); } });
    const s = await n.state();
    await n.api('POST', '/api/actions', { actions: [{ kind: 'op', product_id: s.products.find((x) => x.name === 'חלב 3%').id, op: { type: 'purchase', amount: 2 } }] });
    await p.reload2(); await p.go('#chat'); await p.waitForTimeout(600);
    ok(!(await p.$('.since')) && !/מאז שהיית כאן/.test(await p.textContent('#thread')), 'the bar is still there');
    const t = (await p.$$eval('#thread .gray', (xs) => xs.map((x) => x.textContent))).join(' | '); ok(/מיכל קנתה/.test(t), t);
    ok(await p.$eval('#thread .gray', (x) => getComputedStyle(x).borderStyle === 'dashed'), 'not a kraft note');
    await p.screenshot({ path: '/tmp/shuki-test/r16-since.png' });
    return t;
  });

  // 0b (architecture, "החלטה מרכזית: צ'אט אישי"): each person has their own chat, so Michal's messages were never in Avi's.
  // Stage 5 (q01): the "השיחה שלי עם שוקי" switch and the names above the messages are gone.
  await check('V2', 'צ\'אט אישי: ההודעות של מיכל והתשובות אליה לא בצ\'אט של אבי; שלו שם; בלי המתג ובלי שם מעל ההודעות', async () => {
    await n.api('POST', '/api/chat', { text: 'יש לנו חלב?' });
    await p.api('POST', '/api/chat', { text: 'מה חסר?' });
    await p.reload2(); await p.go('#chat'); await p.waitForTimeout(600);
    const t = await p.textContent('#thread');
    ok(!/יש לנו חלב\?/.test(t) && /מה חסר\?/.test(t), t.slice(-200));
    ok(!(await p.$('#mineOnly')) && !(await p.$('#thread .who')) && !/השיחה שלי עם שוקי/.test(t), 'the switch or a name is still there');
  });

  await check('V3', '👎 על תשובה: דף קטן עם "מה לא היה טוב?", שליחה, והאגודל נשאר מסומן', async () => {
    await p.go('#chat'); await p.waitForTimeout(300);
    const btns = await p.$$('[data-down]'); ok(btns.length >= 1, 'no thumb');
    await btns[btns.length - 1].click(); await p.waitForSelector('#fb-note');
    await p.fill('#fb-note', 'לא ענה על השאלה'); await p.click('#fb-send'); await p.waitForTimeout(700);
    ok(await p.$('.down.on'), 'not pressed');
    const f = lib.d1q('SELECT note FROM feedback ORDER BY id DESC LIMIT 1')[0]; ok(f?.note === 'לא ענה על השאלה', JSON.stringify(f));
  });

  await check('V4', 'הגדרות למנהל: עלות החודש בדולרים, פס, ותקרה שנשמרת; למיכל אין', async () => {
    await p.go('#settings');
    // round 21: one line and a bar; the cap is in a window that opens from the line
    const t = await p.textContent('details[data-fold="מתקדם"]'); ok(/החודש עליתי לכם בערך \$\d+\.\d\d מתוך \$10/.test(t), t.slice(0, 400)); // the cost is in "מתקדם" since 01/10
    await p.click('#costRow'); await p.fill('#capIn', '15'); await p.click('#capForm button'); await p.waitForTimeout(800);
    ok((await p.state()).cost.cap === 15, 'cap');
    await p.screenshot({ path: '/tmp/shuki-test/r16-cost.png', fullPage: true });
    await n.go('#settings'); ok(!(await n.$('#costRow')) && !/עלות החודש/.test(await n.textContent('.set')), 'Michal sees money');
    ok(!(await n.$('#restoreDay')), 'Michal can restore');
  });

  await check('V5', 'להחזיר ליום קודם: רשימת הימים, "בטוח?", והבית חוזר', async () => {
    // yesterday's copy = the house as it is now (the same content the nightly job keeps)
    const exp = await p.api('GET', '/api/export'); exp.events = []; exp.feedback = [];
    const day = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    lib.d1(`INSERT INTO backups (day, part, data, created) VALUES ('${day}', 0, CAST(X'${Buffer.from(JSON.stringify(exp)).toString('hex')}' AS TEXT), ${Date.now() - 864e5})`); // hex: no shell quoting
    ok(lib.d1q(`SELECT COUNT(*) AS n FROM backups WHERE day = '${day}'`)[0].n === 1, 'the copy was not planted');
    const s = await p.state();
    await p.api('POST', '/api/actions', { actions: [{ kind: 'delete', product_id: s.products.find((x) => x.name === 'חלב 3%').id }] });
    await p.reload2(); await p.go('#settings');
    await p.click('#restoreDay'); await p.waitForSelector('[data-day]');
    await p.screenshot({ path: '/tmp/shuki-test/r16-restore.png' });
    await p.click(`[data-day="${day}"]`); ok(/להחזיר באמת\?/.test(await p.textContent(`[data-day="${day}"]`)), 'no sure');
    await p.click(`[data-day="${day}"]`); await p.waitForTimeout(1500);
    if (!(await p.state()).products.some((x) => x.name === 'חלב 3%')) { const toast = await p.$eval('.toast', (x) => x.textContent).catch(() => ''); const r = await p.api('POST', '/api/backups/restore', { day }); throw new Error(`milk did not come back; toast: ${toast}; api: ${JSON.stringify(r).slice(0, 300)}`); }
  });

  await check('V6', 'כרטיס שמוחק 6 מוצרים: "אישור" מבקש "בטוח?" לפני שמוחקים', async () => {
    const s = await p.state();
    const ids = s.products.filter((x) => x.name.startsWith('תבלין')).map((x) => x.id);
    lib.d1(`INSERT INTO proposals (id, user_id, created, actions) VALUES ('p16', 1, ${Date.now()}, '${JSON.stringify({ actions: ids.map((id) => ({ kind: 'delete', product_id: id })) })}')`);
    lib.d1(`INSERT INTO chat (ts, user_id, role, content) VALUES (${Date.now()}, NULL, 'shuki', '${JSON.stringify({ reply: 'למחוק את כל התבלינים?', face: 'neutral', for: 1, proposal: { id: 'p16', status: 'pending', lines: ids.map((id, i) => ({ icon: 'delete', text: `תבלין ${i} — למחוק מהמלאי` })) }, status: 'pending' })}')`);
    await p.go('#settings'); await p.go('#chat'); await p.waitForTimeout(900);
    await p.click('.coupon[data-id="p16"] [data-do=apply]'); await p.waitForTimeout(700);
    ok(/למחוק באמת\? 6 מוצרים יימחקו/.test(await p.textContent('.coupon[data-id="p16"]')), 'no sure');
    ok((await p.state()).products.filter((x) => x.name.startsWith('תבלין')).length === 6, 'deleted already');
    await p.click('.coupon[data-id="p16"] [data-do=apply]'); await p.waitForTimeout(900);
    ok((await p.state()).products.filter((x) => x.name.startsWith('תבלין')).length === 0, 'not deleted');
  });

  await check('V7', 'פותחים את האפליקציה באמצע קניות: נפתח על הרשימה; בלי קניות: על הצ\'אט', async () => {
    await n.api('POST', '/api/shopping', { on: true, store: 'super' });
    await n.goto(lib.BASE + '/'); await n.waitForTimeout(1500);
    ok(/#list$/.test(n.url()), n.url());
    await n.api('POST', '/api/shopping', { on: false });
    await n.goto(lib.BASE + '/'); await n.waitForTimeout(1200);
    ok(!/#list$/.test(n.url()) && await n.$('#say'), n.url());
  });

  await check('V8', 'אנדרואיד (Pixel 7, Chrome): הסבר התקנה במסך הצימוד, וההתראות קיימות בדפדפן', async () => {
    const ctx = await b.newContext({ ...devices['Pixel 7'], serviceWorkers: 'allow' }); const a = await ctx.newPage();
    await a.goto(lib.BASE + '/'); await a.waitForSelector('#code');
    const t = await a.textContent('.howto'); ok(/Chrome/.test(t) && /התקנת האפליקציה/.test(t), t);
    ok(await a.evaluate(() => 'PushManager' in window && 'serviceWorker' in navigator), 'no push API');
    await a.screenshot({ path: '/tmp/shuki-test/r16-android.png' });
    await ctx.close();
  });

  // walkthrough finding 8 (approved 01/10): in Safari 26 "הוספה למסך הבית" is behind "הצגת עוד"; older Safari unchanged
  await check('V8b', 'אייפון: ב-Safari 26 ⋯ ← שיתוף ואז "הצגת עוד"; ב-Safari ישן כפתור השיתוף, כמו קודם', async () => {
    const ua = (v) => `Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${v} Mobile/15E148 Safari/604.1`;
    const steps = async (v) => {
      const ctx = await b.newContext({ ...devices['iPhone 15'], userAgent: ua(v) }); const a = await ctx.newPage();
      await a.goto(lib.BASE + '/'); await a.waitForSelector('#code');
      const t = await a.$$eval('.howto li', (xs) => xs.map((x) => x.textContent.trim())); await ctx.close(); return t;
    };
    const s26 = await steps(26), s18 = await steps(18);
    ok(JSON.stringify(s26) === JSON.stringify(['ב-Safari לוחצים על ⋯ (שלוש הנקודות) ← שיתוף', 'לוחצים על "הצגת עוד" ואז על "הוספה למסך הבית"', 'פותחים אותי מהאייקון ומקלידים שם את הקוד']), JSON.stringify(s26));
    ok(JSON.stringify(s18) === JSON.stringify(['ב-Safari לוחצים על כפתור השיתוף', '"הוספה למסך הבית"', 'פותחים אותי מהאייקון ומקלידים שם את הקוד']), JSON.stringify(s18));
  });

  await check('V9', 'גודל הטקסט עוקב אחרי הטלפון: טקסט גדול מגדיל את ההודעות ואת הכפתורים', async () => {
    await p.go('#chat');
    const small = await p.$eval('.msg.bot', (x) => parseFloat(getComputedStyle(x).fontSize));
    await p.addStyleTag({ content: 'html { font-size: 23px !important }' }); await p.waitForTimeout(200);
    const big = await p.$eval('.msg.bot', (x) => parseFloat(getComputedStyle(x).fontSize));
    ok(big > small * 1.2, `${small} → ${big}`);
    return `${small}px → ${big}px`;
  });

  await check('V10', 'בלי שגיאות בדף', async () => ok(p.errors.length === 0 && n.errors.length === 0, [...p.errors, ...n.errors].join(' | ')));
  await finish(b, 'test/r16-ui-results.json');
})();
