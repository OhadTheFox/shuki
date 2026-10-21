// UI for round 9: photos, twin names, list-line menu, pack size, expired card, devices, share. Run: test/ui-qa.sh test/cases-ui.cjs
const { chromium } = require(process.env.PW);
const hold = async (p, sel) => { const b = await p.waitForSelector(sel); const box = await b.boundingBox(); await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.waitForTimeout(750); await p.mouse.up(); await p.waitForTimeout(300); }; // a long press (decision 171)
const { execSync } = require('node:child_process');
const BASE = process.env.BASE || 'http://127.0.0.1:8791';
const S = '/tmp/shuki-test/shuki-uiqa';
const d1 = (sql) => execSync(`npx wrangler d1 execute shuki --local --persist-to ${S} --command "${sql.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
const results = [];
const check = async (id, name, fn) => {
  try { const note = await fn(); results.push({ id, name, ok: true, note: note || '' }); console.log('✓', id, name, note ? `— ${note}` : ''); }
  catch (e) { results.push({ id, name, ok: false, error: e.message.split('\n')[0] }); console.log('✗', id, name, '\n   ', e.message.split('\n')[0]); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };
const shot = (p, n) => p.screenshot({ path: `/tmp/shuki-test/c-${n}.png` });

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] }); await ctx.addInitScript(() => { new MutationObserver(() => document.querySelectorAll('details.fold:not([data-t])').forEach((d) => { d.dataset.t = 1; d.open = true; })).observe(document, { childList: true, subtree: true }); }); // settings folds open (01/10)
  const p = await ctx.newPage(); const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(BASE + '/'); await p.fill('#code', '111111'); await p.click('#pair button[type=submit]'); await p.waitForSelector('#say');
  const api = (method, path, body) => p.evaluate(async ([m, u, bd]) => { const r = await fetch(u, { method: m, headers: { 'content-type': 'application/json', authorization: `Bearer ${JSON.parse(localStorage.getItem('shuki.token'))}` }, body: bd ? JSON.stringify(bd) : undefined }); return r.json(); }, [method, path, body]);
  await api('POST', '/api/actions', { actions: [
    { kind: 'create', product: { name: 'רוטב חריף סקורפיון', count_type: 'units', unit: 'בקבוק', qty: 1, location_id: 'מזווה' } },
    { kind: 'create', product: { name: 'ביצים', count_type: 'pack', pack_size: 6, qty: 0, is_basic: 1, target: 6, location_id: 'מקרר' } },
    { kind: 'create', product: { name: 'קולה', count_type: 'units', unit: 'בקבוק', qty: 0, is_basic: 1, target: 2, location_id: 'מזווה' } },
    { kind: 'create', product: { name: 'שמנת', count_type: 'units', unit: 'קופסה', qty: 1, shelf_days: 5, location_id: 'מקרר' } },
  ] });
  await api('POST', '/api/actions', { actions: [{ kind: 'list_add', text: 'נייר אפייה', store: 'super' }] });
  const go = async (hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForTimeout(400); };
  const reload = async () => { await p.reload(); await p.waitForTimeout(900); };
  // a real photo file: a red bottle on yellow, made in the page
  const jpeg = Buffer.from(await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 1200; const g = c.getContext('2d'); g.fillStyle = '#FFD21A'; g.fillRect(0, 0, 900, 1200); g.fillStyle = '#c21'; g.fillRect(330, 250, 240, 800); g.fillRect(400, 120, 100, 160); return c.toDataURL('image/jpeg', .9).split(',')[1]; }), 'base64');

  await check('U-A', 'מוצר חדש בשם שכבר קיים: הדף נשאר פתוח עם "מה מבדיל?"; שם אחר נשמר', async () => {
    await go('#inventory'); await reload(); await p.click('#addP');
    await p.fill('#f-name', 'רוטב חריף סקורפיון'); await p.click('#save'); await p.waitForTimeout(300);
    ok(await p.$('.sheet'), 'sheet stays open');
    const e = await p.textContent('#f-err'); ok(/כבר יש "רוטב חריף סקורפיון"\. אם זה מוצר אחר, ספרו לי מה ההבדל/.test(e), e);
    await shot(p, 'a-twin');
    await p.fill('#f-name', 'רוטב חריף סקורפיון ירוק'); await p.click('#save'); await p.waitForTimeout(900);
    ok(!(await p.$('.sheet')), 'closed');
    ok(await p.$('.fr:has-text("רוטב חריף סקורפיון ירוק")'), 'saved');
    // the other phone added a twin a moment ago (this phone doesn't know yet): the server says no, the sheet comes back
    await api('POST', '/api/actions', { actions: [{ kind: 'create', product: { name: 'חומוס אחלה' } }] });
    await p.click('#addP'); await p.fill('#f-name', 'חומוס אחלה'); await p.click('#save'); await p.waitForTimeout(1500);
    ok(await p.$('.sheet #f-err:not([hidden])'), 'sheet reopened with the reason');
    ok((await p.inputValue('#f-name')) === 'חומוס אחלה', 'what was typed is kept');
    await p.click('.sheet [data-close]');
    return e;
  });

  await check('U-B', 'צילום מוצר מדף המוצר: מוקטן, נשמר, מופיע במלאי, ברשימה ובדף; "בלי תמונה" מוחק', async () => {
    await p.click('.fr:has-text("רוטב חריף סקורפיון ירוק")');
    await p.setInputFiles('#f-pic', { name: 'sauce.jpg', mimeType: 'image/jpeg', buffer: jpeg }); await p.waitForTimeout(600);
    ok(await p.$('.sheet .pic img.photo[src^="data:image/jpeg"]'), 'preview in the sheet');
    await shot(p, 'b-sheet-photo');
    await p.click('#save'); await p.waitForTimeout(1500);
    const s = await api('GET', '/api/state'); const pr = s.products.find((x) => x.name === 'רוטב חריף סקורפיון ירוק');
    ok(pr.photo, 'saved on the server');
    const size = await p.evaluate(async (id) => (await (await fetch(`/api/photo/${id}`, { headers: { authorization: `Bearer ${JSON.parse(localStorage.getItem('shuki.token'))}` } })).blob()).size, pr.id);
    ok(size < 40000, `small: ${size}`);
    await p.waitForSelector('.fr:has-text("סקורפיון ירוק") img.thumb[src^="blob:"]', { timeout: 4000 });
    await shot(p, 'b-inventory');
    // offline: the photo comes from the phone's cache
    await reload(); await ctx.setOffline(true);
    await p.evaluate(() => { location.hash = '#list'; }); await p.waitForTimeout(200); await p.evaluate(() => { location.hash = '#inventory'; }); await p.waitForTimeout(800);
    ok(await p.$('.fr:has-text("סקורפיון ירוק") img.thumb[src^="blob:"]'), 'shows with no signal');
    await ctx.setOffline(false); await p.waitForTimeout(300);
    await api('POST', '/api/actions', { actions: [{ kind: 'list_add', product_id: pr.id, store: 'super' }] });
    await go('#list'); await reload();
    await p.waitForSelector('.item:has-text("סקורפיון ירוק") img.thumb[src^="blob:"]', { timeout: 4000 });
    await shot(p, 'b-list');
    await go('#inventory'); await p.click('.fr:has-text("רוטב חריף סקורפיון ירוק")'); await p.waitForTimeout(500);
    ok(await p.$('.sheet img.photo[src^="blob:"]'), 'in the sheet');
    await p.click('#f-nopic'); await p.click('#save'); await p.waitForTimeout(1500);
    ok(!(await api('GET', '/api/state')).products.find((x) => x.name === 'רוטב חריף סקורפיון ירוק').photo, 'removed');
    return `${size} bytes`;
  });

  await check('U-C', 'מצלמה בצ\'אט: "מה בתמונה?" קבלה / מוצר; מוצר נשלח עם kind=product ותמונה קטנה', async () => {
    await go('#chat');
    let sent = null;
    await p.route('**/api/chat', async (r) => { if (r.request().method() === 'POST') { sent = r.request().postDataJSON(); await r.fulfill({ json: { reply: 'ok' } }); } else await r.continue(); });
    await p.setInputFiles('#photo', { name: 'p.jpg', mimeType: 'image/jpeg', buffer: jpeg }); await p.waitForTimeout(400);
    ok(/מה בתמונה/.test(await p.textContent('.sheet h2')), 'asks');
    await shot(p, 'c-choice');
    await p.click('#k-prod'); await p.waitForTimeout(1200);
    ok(sent && sent.kind === 'product' && sent.text === 'צילמתי מוצר', JSON.stringify(sent || {}).slice(0, 80));
    ok(sent.image.data.length > sent.thumb.length && sent.thumb.length < 90000 && sent.thumb.startsWith('/9j/'), `thumb ${sent.thumb.length}`);
    await p.setInputFiles('#photo', { name: 'r.jpg', mimeType: 'image/jpeg', buffer: jpeg }); await p.waitForTimeout(400);
    sent = null; await p.click('#k-rec'); await p.waitForTimeout(1200);
    ok(sent && !sent.kind && !sent.thumb && sent.text === 'צילמתי קבלה', 'receipt');
    await p.unroute('**/api/chat');
    return `thumb ${sent ? '' : ''}ok`;
  });

  await check('U-D', 'שורה ברשימה "⋯": יש בבית (ספירה + הורדה), לא צריך הפעם, לא קונים יותר, חד-פעמי → מלאי', async () => {
    await go('#list'); await reload();
    await p.click('.itemw:has-text("קולה") [data-more]'); await p.waitForTimeout(300);
    const t = await p.textContent('.sheet .menu');
    ok(/יש בבית/.test(t) && /לא צריך הפעם/.test(t) && /לא קונים יותר/.test(t), t);
    await shot(p, 'd-menu');
    await p.click('[data-m=have]'); await p.waitForSelector('#c-ok');
    await p.click('.sheet [data-d="1"]'); await p.click('.sheet [data-d="1"]'); await p.click('#c-ok'); await p.waitForTimeout(1200);
    let s = await api('GET', '/api/state');
    ok(s.products.find((x) => x.name === 'קולה').qty === 2 && !s.list.some((i) => i.product_id === s.products.find((x) => x.name === 'קולה').id), 'counted and off the list');
    await p.click('.itemw:has-text("נייר אפייה") [data-more]'); await p.waitForTimeout(300);
    const o = await p.textContent('.sheet .menu'); ok(/להוסיף למלאי/.test(o) && !/יש בבית/.test(o), o);
    await p.click('[data-m=keep]'); await p.waitForSelector('#f-name');
    ok((await p.inputValue('#f-name')) === 'נייר אפייה', 'name filled');
    await p.click('#save'); await p.waitForTimeout(1500);
    s = await api('GET', '/api/state'); const np = s.products.find((x) => x.name === 'נייר אפייה');
    ok(np && s.list.filter((i) => i.product_id === np.id).length === 1 && !s.list.some((i) => i.text === 'נייר אפייה'), 'one line, linked');
    await p.click('.itemw:has-text("ביצים") [data-more]'); await p.waitForTimeout(300); await p.click('[data-m=stop]'); await p.waitForTimeout(1200);
    s = await api('GET', '/api/state');
    ok(s.products.find((x) => x.name === 'ביצים').is_basic === 0, 'not basic');
    await p.click('.itemw:has-text("נייר אפייה") [data-more]'); await p.waitForTimeout(300); await p.click('[data-m=skip]'); await p.waitForTimeout(1200);
    ok(!(await api('GET', '/api/state')).list.some((i) => i.product_id === np.id), 'skipped');
    return 'ארבע הפעולות';
  });

  await check('U-E', 'אריזה בגודל אחר: "בכל אריזה (הפעם)" 12 → המלאי מקבל 12', async () => {
    await api('POST', '/api/actions', { actions: [{ kind: 'list_add', text: 'ביצים', store: 'super' }] });
    await reload();
    await hold(p, '.item:has-text("ביצים")'); await p.waitForSelector('#psz');
    ok((await p.inputValue('#psz')) === '6', 'usual size shown');
    await p.fill('#psz', '12'); await shot(p, 'e-pack');
    await p.click('#ok'); await p.waitForTimeout(1200);
    const s = await api('GET', '/api/state');
    ok(s.products.find((x) => x.name === 'ביצים').qty === 12, `qty ${s.products.find((x) => x.name === 'ביצים').qty}`);
    return '12';
  });

  await check('U-F', 'שליחת הרשימה: טקסט לפי קטגוריות עם כמויות', async () => {
    await api('POST', '/api/actions', { actions: [{ kind: 'list_add', text: 'נרות', store: 'super' }, { kind: 'list_add', text: 'קולה', store: 'super' }] });
    await reload();
    await p.evaluate(() => { navigator.share = undefined; });
    await p.click('#shareList'); await p.waitForTimeout(500);
    const t = await p.evaluate(() => navigator.clipboard.readText());
    ok(/^רשימה לסופר:/.test(t) && /• קולה — \d+ בקבוקים|• קולה — בקבוק/.test(t) && /• נרות/.test(t), t.replace(/\n/g, ' | '));
    await shot(p, 'f-list');
    return t.replace(/\n/g, ' | ');
  });

  await check('U-G', 'עבר התאריך: כרטיס בצ\'אט; "עוד בסדר" מעלים ולא חוזר; "זרקנו"', async () => {
    d1(`UPDATE products SET expires = ${Date.now() - 864e5} WHERE name IN ('שמנת', 'רוטב חריף סקורפיון')`);
    await go('#chat'); await reload();
    const t = await p.textContent('.expired-card'); ok(/שמנת/.test(t) && /סקורפיון/.test(t), t);
    await shot(p, 'g-expired');
    await p.click('.expired-card .rq:has-text("שמנת") [data-ex-ok]'); await p.waitForTimeout(1200);
    await p.click('.expired-card .rq:has-text("סקורפיון") [data-ex-toss]'); await p.waitForTimeout(1200);
    await reload();
    ok(!(await p.$('.expired-card')), 'gone');
    const s = await api('GET', '/api/state');
    ok(s.products.find((x) => x.name === 'רוטב חריף סקורפיון').out, 'thrown away');
    return 'בסדר';
  });

  await check('U-H', 'מכשירים: רשימה, קוד צימוד למיכל, ניתוק טלפון אחר', async () => {
    d1(`INSERT INTO devices (user_id, token_hash, name, created, last_seen) VALUES (2, 'x', 'iPhone ישן', ${Date.now() - 30 * 864e5}, ${Date.now() - 20 * 864e5})`);
    await go('#settings'); await p.waitForTimeout(800);
    const t = await p.textContent('#devBox'); ok(/המכשיר הזה/.test(t) && /מיכל/.test(t) && /נראה לאחרונה/.test(t), t);
    // 16/10 (the owner): a grown-up who has a phone gets a code for another one too (only a child's is blocked, stage 13 d3)
    await p.click('[data-unpair]'); await p.click('[data-unpair]'); await p.waitForTimeout(900);
    ok(!/iPhone ישן/.test(await p.textContent('#devBox')), 'gone');
    await p.click('[data-code="2"]'); await p.waitForSelector('.paircode');
    const c = await p.textContent('.paircode b'); ok(/^\d{6}$/.test(c.trim()), c);
    await p.locator('.paircode').scrollIntoViewIfNeeded(); await shot(p, 'h-devices');
    return `קוד ${c.trim()}`;
  });

  await check('U-I', 'מסך 320: תמונות, תפריט שורה ודף מוצר בלי גלילה לצדדים', async () => {
    await p.setViewportSize({ width: 320, height: 600 });
    for (const h of ['#list', '#inventory', '#settings', '#chat']) { await go(h); ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${h} scrolls sideways`); }
    await go('#list'); await p.click('[data-more]'); await p.waitForTimeout(300);
    ok(await p.evaluate(() => document.querySelector('.sheet').scrollWidth <= document.querySelector('.sheet').clientWidth + 1), 'menu');
    await p.setViewportSize({ width: 390, height: 844 });
  });

  await check('U-J', 'מקלידים "טבסקו" כשיש 4: "איזה טבסקו?" עם כל הסוגים ו"משהו אחר"', async () => {
    await api('POST', '/api/actions', { actions: ['טבסקו אדום', 'טבסקו ירוק', "טבסקו צ'יפוטלה", 'טבסקו שום'].map((name) => ({ kind: 'create', product: { name, count_type: 'units', unit: 'בקבוק', qty: 0 } })) });
    await go('#list'); await reload();
    await p.fill('#addTxt', 'טבסקו'); await p.click('#adder button[type=submit]'); await p.waitForSelector('[data-pick]');
    const t = await p.textContent('.sheet'); ok(/איזה טבסקו\?/.test(t) && (await p.$$('[data-pick]')).length === 5, t);
    await shot(p, 'j-which');
    await p.click('[data-pick]:has-text("טבסקו ירוק")'); await p.waitForTimeout(1200);
    const s = await api('GET', '/api/state'); const g = s.products.find((x) => x.name === 'טבסקו ירוק');
    ok(s.list.some((i) => i.product_id === g.id) && !s.list.some((i) => i.text === 'טבסקו'), 'the green one, not a one-off');
    return 'ירוק';
  });

  await check('JS', 'אין שגיאות JavaScript', async () => { ok(!errors.length, errors.join(' | ')); });
  const n = results.filter((r) => r.ok).length;
  console.log(`\n${n}/${results.length} case UI checks passed`);
  require('node:fs').writeFileSync('test/cases-ui-results.json', JSON.stringify(results, null, 1));
  await b.close();
  process.exit(n === results.length ? 0 : 1);
})();
