// Stage 5 screens (docs/stage5-plan.md): what stage 0 built on the server, on the screen. Each check names its decision.
// Run under tools/runall.sh (UIS="test/stage5-ui.cjs"); fails on the code before its commit.
const { chromium } = require(process.env.PW);
const lib = require('./sweep-lib.cjs');
const { check, ok, phone, finish, d1 } = lib;
(async () => {
  const b = await chromium.launch();
  d1("INSERT OR REPLACE INTO users (id, name, gender, role, active, created) VALUES (3, 'יואבי', 'm', 'child', 1, 0)");
  const p = await phone(b, { w: 390, h: 844 });           // Avi, the admin
  const kid = await phone(b, { w: 390, h: 844, user: 3 }); // Yoavi, a child

  await check('S5-b01', 'b01 (02/10, 05/10): בדף של ילד, מתג "אני רוצה לראות גם את השיחה של יואבי", של אבי בלבד; D9 אצל הילד לפי מי שרואה', async () => {
    await p.reload2(); await p.go('#settings');
    await p.click('[data-mem="3"]'); await p.waitForSelector('#e-see');
    const label = await p.textContent('label:has(#e-see)'); ok(label.trim() === 'אני רוצה לראות גם את השיחה של יואבי', label);
    ok(await p.$eval('#e-see', (x) => x.checked), 'not on for a grown-up who never chose');
    await p.click('#e-see'); await p.waitForTimeout(500);
    const s = await p.state(); ok(s.settings['child_chat:1:3'] === '0', JSON.stringify(s.settings));
    const d9 = (await kid.api('GET', '/api/chat')).messages.find((m) => m.content.fixed === 'parents_see')?.content.reply;
    ok(d9 === 'אמא יכולה לראות את השיחה שלנו.', d9);
    await p.click('#e-see'); await p.waitForTimeout(500);
    ok((await p.state()).settings['child_chat:1:3'] === '1', 'not back on');
    await kid.go('#settings'); await kid.click('[data-mem="3"]').catch(() => {}); await kid.waitForTimeout(300);
    ok(!(await kid.$('#e-see')), 'the child has the switch');
    return label;
  });

  await check('S5-b01m', 'ש1 (05/10): מיכל, מבוגרת שאינה מנהלת, פותחת את הדף של יואבי ורואה בו רק את המתג; השרת לא נותן לה לשנות שם', async () => {
    const m = await phone(b, { w: 390, h: 844, user: 2 });
    await m.go('#settings'); await m.click('[data-mem="3"]'); await m.waitForSelector('#e-see');
    ok(!(await m.$('[data-mem="1"]')), 'a button on an adult\'s page');
    ok(!(await m.$('#e-name')) && !(await m.$('#e-save')) && !(await m.$('#e-remove')) && !(await m.$('#e-code')), 'more than the switch');
    await m.click('#e-see'); await m.waitForTimeout(500);
    ok((await m.state()).settings['child_chat:2:3'] === '0', 'her switch did nothing');
    await m.click('#e-see'); await m.waitForTimeout(400);
    const r = await m.api('POST', '/api/members', { id: 3, edit: { name: 'אחר' } }); ok(/רק מנהל הבית/.test(r.error || ''), JSON.stringify(r));
  });

  await check('S5-row', '5 (05/10): בחברי הבית, שורה של ילד: "פנייה בלשון זכר · ילד", בלי הסוגריים; האפור של האפליקציה (4)', async () => {
    await p.reload2(); await p.go('#settings'); await p.waitForTimeout(400);
    const t = await p.$eval('[data-mem="3"]', (x) => x.closest('.member').querySelector('small').textContent);
    ok(t === 'פנייה בלשון זכר · ילד', t);
    ok(await p.$eval('.member small', (x) => getComputedStyle(x).color) === 'rgb(92, 83, 72)', 'not --mut');
  });

  await check('S5-41', 'שאלה 41: פעולה שלא שינתה כלום (nothing) לא מראה "עודכן" ו"לבטל"; פעולה רגילה כן', async () => {
    await p.api('POST', '/api/actions', { actions: [{ kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 2 } }] });
    await p.reload2(); await p.go('#inventory');
    await p.route('**/api/actions', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, nothing: true, eventId: null, summary: '', created: [], added: [], finished: [] }) }));
    await p.click('.fr:has-text("חלב 3%")'); await p.click('#outBtn'); await p.waitForTimeout(700);
    const t = await p.$eval('.toast', (x) => (x.hidden || !x.offsetParent ? '' : x.textContent)).catch(() => '');
    ok(!/לבטל|עודכן/.test(t), `toast after nothing: ${t}`);
    await p.unroute('**/api/actions');
    await p.click('.fr:has-text("חלב 3%")'); await p.click('#outBtn'); await p.waitForTimeout(500);
    const t2 = await p.textContent('.toast'); ok(/עודכן/.test(t2) && /לבטל/.test(t2), `no undo after a real action: ${t2}`);
    return t2;
  });

  await check('S5-d45', 'd45 "להחליף" (c01, c03): שלושה כפתורים מתחת לשאלה; "להחליף" פותח את הצ\'אט עם "מה לקנות במקום במבה?", התיבה נעלמת והשורה נשארת', async () => {
    await p.api('POST', '/api/actions', { actions: [{ kind: 'list_add', text: 'במבה' }] });
    lib.d1("UPDATE list_items SET skipped = 3 WHERE text = 'במבה'");
    await p.reload2(); await p.go('#list');
    const q = await p.$eval('.stale .staleq > span', (x) => x.getBoundingClientRect().bottom), btn = await p.$eval('.stale .three-btn', (x) => x.getBoundingClientRect().top);
    ok(btn >= q - 1, `the buttons aren't under the text: ${q} ${btn}`);
    await p.click('[data-stale][data-d=swap]'); await p.waitForTimeout(1200);
    ok(await p.evaluate(() => location.hash) === '#chat', 'not in the chat');
    ok(/מה לקנות במקום במבה\?/.test(await p.textContent('#thread')), 'no question');
    const s = await p.state(); ok(!s.stale.length, 'the box is still there'); ok(s.list.some((i) => i.text === 'במבה' && i.status === 'open'), 'the line went');
  });

  await check('S5-q17', 'דף של מוצר (q17, b05): הפעולות מעל "שמירה" ו"סגירה", "נגמר בבית" / "זרקנו לפח"; מוצר של אבי אצל מיכל: D15 במקום "מחיקה"; "בטוח? למחוק" לא נדבק', async () => {
    const m = await phone(b, { w: 390, h: 844, user: 2 }); // Michal, not the admin
    await p.api('POST', '/api/actions', { actions: [{ kind: 'create', product: { name: 'קפה של אבי', count_type: 'units', qty: 1 } }] });
    lib.d1("UPDATE products SET owner = 1 WHERE name = 'קפה של אבי'");
    await p.reload2(); await p.go('#inventory');
    await p.click('.fr:has-text("חלב 3%")'); await p.waitForSelector('#outBtn');
    const order = await p.$$eval('.sheet .acts', (xs) => xs.map((x) => x.textContent.trim()));
    ok(/נגמר בבית/.test(order[0]) && /זרקנו לפח/.test(order[0]) && /מחיקה/.test(order[0]) && /שמירה/.test(order[1]) && /סגירה/.test(order[1]), JSON.stringify(order));
    await p.click('#del'); const sticky = await p.$eval('.pacts', (x) => getComputedStyle(x).position); ok(sticky !== 'sticky', 'the actions stick after "בטוח"');
    await p.click('.sheet-x');
    await m.reload2(); await m.go('#inventory');
    await m.click('.fr:has-text("קפה של אבי")'); await m.waitForSelector('#outBtn');
    ok(!(await m.$('#del')), 'Michal has "מחיקה"');
    const t = await m.textContent('.nodel'); ok(t === 'את המוצר הזה רק אבי יכול למחוק.', t);
    return t;
  });

  await check('S5-exp', 'כרטיס התוקף בצ\'אט: "זרקנו" / "המוצר עדיין בתוקף" / "המוצר עדיין בסדר"', async () => {
    await p.api('POST', '/api/actions', { actions: [{ kind: 'create', product: { name: 'יוגורט פג', count_type: 'units', qty: 1, expires: Date.now() - 2 * 864e5 } }] });
    await p.reload2(); await p.go('#chat'); await p.waitForTimeout(500);
    const bs = await p.$$eval('.expired-card .three button', (xs) => xs.map((x) => x.textContent));
    ok(bs.slice(0, 3).join(' / ') === 'זרקנו / המוצר עדיין בתוקף / המוצר עדיין בסדר', JSON.stringify(bs));
  });

  await check('S5-tabs', 'q05 (02/10): אצל אבי לשוניות "הצ\'אט שלי" ו"יואבי"; נקודה אדומה כשיש חדש אצל יואבי; בלשונית שלו רק השיחה שלו, בלי 👍/👎', async () => {
    await kid.api('POST', '/api/chat', { text: 'שלום מיואבי' });
    await p.reload2(); await p.go('#chat'); await p.waitForTimeout(600);
    const tabs = await p.$$eval('.chattabs [role=tab]', (xs) => xs.map((x) => x.textContent.trim()));
    ok(tabs.join(' | ') === "הצ'אט שלי | יואבי", JSON.stringify(tabs));
    ok(!/שלום מיואבי/.test(await p.textContent('#thread')), "Yoavi's message in my chat");
    ok(await p.$('.chattabs [data-tab="3"] .dot'), 'no red dot');
    ok(await p.$eval('.chattabs [data-tab="3"] .dot', (x) => x.getAttribute('aria-label')) === 'יש הודעות חדשות', 'the dot says nothing (ש7)');
    ok(await p.$eval('.chattabs', (x) => getComputedStyle(x).position) === 'sticky', 'the tabs don\'t stick (59)');
    await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await p.waitForTimeout(300);
    const [bandB, tabsT] = await p.evaluate(() => [document.querySelector('.band').getBoundingClientRect().bottom, document.querySelector('.chattabs').getBoundingClientRect().top]);
    ok(tabsT >= bandB - 1, `the tabs cover the band: ${tabsT} < ${bandB}`);
    await p.focus('.chattabs [data-tab="3"]'); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
    const oc = await p.$eval('.chattabs [data-tab="3"]', (x) => getComputedStyle(x).outlineColor); ok(oc === 'rgb(255, 210, 26)', `focus on the blue: ${oc} (59)`);
    await p.click('.chattabs [data-tab="3"]'); await p.waitForTimeout(300);
    const t = await p.textContent('#thread'); ok(/שלום מיואבי/.test(t), t.slice(-200));
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(200);
    const [bb, tt] = await p.evaluate(() => [document.querySelector('.band').getBoundingClientRect().bottom, document.querySelector('.chattabs').getBoundingClientRect().top]);
    ok(tt - bb < 30, `the tabs aren't at the top of a short chat: ${tt} vs ${bb} (6)`);
    ok(!(await p.$('#thread .fb')), '👍/👎 in the child\'s chat');
    ok(!(await p.$('.chattabs [data-tab="3"] .dot')), 'the dot stays');
    await p.click('.chattabs [data-tab="me"]'); await p.waitForTimeout(200);
    ok(!(await p.$('.chattabs .dot')), 'a dot after seeing it');
  });

  await check('S5-c04', 'q06, c04 (02/10): כרטיס מהודעה של יואבי אצל אבי: "את זה רק יואבי יכול לאשר או לבטל." במקום הכפתורים; כרטיס להורים נשאר עם כפתורים', async () => {
    const card = (id, extra) => JSON.stringify({ reply: 'להוסיף במבה לרשימה?', face: 'happy', proposal: { id, status: 'pending', lines: [{ icon: 'list', text: 'להוסיף במבה לרשימה?' }] }, status: 'pending', ...extra }).replace(/'/g, "''");
    lib.d1(`INSERT INTO chat (ts, user_id, role, content, thread) VALUES (${Date.now()}, NULL, 'shuki', '${card('p-kid1', { for: 3 })}', 3)`);
    lib.d1(`INSERT INTO chat (ts, user_id, role, content, thread) VALUES (${Date.now() + 1}, NULL, 'shuki', '${card('p-kid2', { for: 3, to: [1], notFor: 3 })}', 1)`);
    await p.reload2(); await p.go('#chat'); await p.click('.chattabs [data-tab="3"]'); await p.waitForTimeout(300);
    const t = await p.textContent('.coupon[data-id="p-kid1"]');
    ok(/את זה רק יואבי יכול לאשר או לבטל\./.test(t), t); ok(!(await p.$('.coupon[data-id="p-kid1"] [data-do]')), 'buttons on his card');
    await p.click('.chattabs [data-tab="me"]'); await p.waitForTimeout(300);
    ok(await p.$('.coupon[data-id="p-kid2"] [data-do="apply"]'), 'no buttons on the card for the grown-ups');
  });

  await check('S5-gray', 'D7ב (q02, q03): שורה אפורה היא פתק קרטון; ארבע ברצף: שורה אחת עם שלוש ו"ועוד עדכון אחד" בקו תחתי (05/10), ולחיצה פותחת את כולן', async () => {
    const m = await phone(b, { w: 390, h: 844, user: 2 });
    await p.api('POST', '/api/chat', { text: 'היי' });
    const s = await m.state(), id = (n) => s.products.find((x) => x.name === n)?.id;
    for (const n of ['חלב 3%', 'יוגורט פג', 'קפה של אבי', 'חלב 3%']) await m.api('POST', '/api/actions', { actions: [{ kind: 'op', product_id: id(n), op: { type: 'low' } }] });
    await p.reload2(); await p.go('#chat'); await p.waitForTimeout(600);
    const note = await p.$$eval('#thread .gray', (xs) => xs.map((x) => x.textContent));
    ok(note.length === 1 && /ועוד עדכון אחד$/.test(note[0]), JSON.stringify(note));
    ok(await p.$eval('#thread .gray.more u', (x) => x.textContent) === 'ועוד עדכון אחד', 'not underlined (2)');
    ok(await p.$eval('#thread .gray', (x) => Number(getComputedStyle(x).fontWeight) >= 700), 'not bold (1)');
    ok(await p.$eval('#thread .gray', (x) => { const c = getComputedStyle(x); return c.borderStyle === 'dashed' && c.transform !== 'none'; }), 'not a tilted dashed note');
    ok(await p.$eval('#thread .gray.more', (x) => x.getBoundingClientRect().height) >= 44, 'the note is under 44px (59)');
    await p.click('#thread .gray.more'); await p.waitForSelector('.sheet .journal');
    ok((await p.$$('.sheet .journal .rowline')).length === 4, 'not all four in the sheet');
    await p.click('.sheet-x');
  });

  await check('S5-D13', 'D13 (q07): התשובה "סיימנו לדבר היום, נמשיך לדבר מחר!" מוצגת, ושורת הכתיבה נשארת פתוחה', async () => {
    await kid.reload2(); await kid.go('#chat');
    const first = await kid.$eval('#thread .msg.bot', (x) => ({ t: x.textContent, fb: !!x.querySelector('.fb') }));
    ok(/לראות את השיחה שלנו\./.test(first.t) && !first.fb, `D9 not first, or with 👍/👎: ${JSON.stringify(first)}`);
    await kid.route('**/api/chat', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: 'סיימנו לדבר היום, נמשיך לדבר מחר!', face: 'happy', limit: true }) }) : r.continue()));
    await kid.fill('#say', 'עוד אחד'); await kid.click('#send'); await kid.waitForTimeout(900);
    ok(/סיימנו לדבר היום, נמשיך לדבר מחר!/.test(await kid.textContent('#thread')), 'no D13');
    ok(!(await kid.$eval('#say', (x) => x.disabled)), 'the composer closed');
    await kid.unroute('**/api/chat');
  });

  await check('S5-D1', 'D1 (q12): המספרים בתשובת מצוקה מודגשים ולחיצים (tel:), בלי 👍/👎', async () => {
    await p.api('POST', '/api/chat', { text: 'אני לא רוצה לחיות' });
    await p.reload2(); await p.go('#chat'); await p.waitForTimeout(500);
    const links = await p.$$eval('#thread .msg.bot a[href^="tel:"]', (xs) => xs.map((x) => `${x.getAttribute('href')}:${x.querySelector('b')?.textContent}`));
    ok(links.includes('tel:1201:1201') && links.includes('tel:101:101'), JSON.stringify(links));
    ok(!(await p.$eval('#thread .msg.bot:has(a[href^="tel:"])', (x) => !!x.querySelector('.fb'))), '👍/👎 on it');
  });

  await check('S7-tel', 'פ13 (r7b): המספרים בנוסח הרפואי ובנוסח של בריאות הנפש לחיצים, כמו במצוקה (tel)', async () => {
    const words = 'זה לא התחום שלי. כדאי לפנות לגורם מוסמך כמו פסיכולוג. אם אתה חווה קושי עכשיו, אפשר לדבר עם ער״ן בטלפון 1201 בכל שעה. אם אתה חש סכנה מיידית, אני ממליץ לפנות למד״א במספר 101.';
    d1(`INSERT INTO chat (ts, user_id, role, content, thread) VALUES (${Date.now()}, NULL, 'shuki', '${JSON.stringify({ reply: words, face: 'neutral', tel: true, for: 1 })}', 1)`);
    await p.reload2(); await p.go('#chat'); await p.waitForTimeout(500);
    const links = await p.$$eval('#thread .msg.bot:has(a[href^="tel:"])', (xs) => xs.map((x) => [...x.querySelectorAll('a[href^="tel:"]')].map((a) => a.getAttribute('href')).join(',')));
    ok(links.includes('tel:1201,tel:101'), JSON.stringify(links));
  });

  await check('S5-lock', 'q10, q11 (02/10): מוצר פרטי עם מנעול ליד השם ברשימה ובמלאי, ולקורא מסך "רק אתה רואה"; למוצר משותף אין', async () => {
    await p.api('POST', '/api/actions', { actions: [{ kind: 'create', product: { name: 'קונדומים', count_type: 'units', qty: 1 } }, { kind: 'list_add', text: 'קונדומים' }] });
    const s = await p.state(); const mine = s.products.find((x) => x.name === 'קונדומים');
    ok(mine?.private_to === 1, `not private: ${JSON.stringify(mine)}`);
    await p.reload2(); await p.go('#inventory');
    ok(await p.$eval('.fr:has-text("קונדומים") .lock', (x) => x.getAttribute('aria-label')) === 'רק אתה רואה', 'no lock in the inventory');
    ok(!(await p.$('.fr:has-text("חלב 3%") .lock')), 'a lock on a shared one');
    await p.go('#list'); await p.waitForTimeout(300);
    ok(await p.$('.item:has-text("קונדומים") .lock svg'), 'no lock in the list');
    // a private line of a shared product (after a secret, question 21): the line is mine, so it has the lock too (the reviewer)
    lib.d1("UPDATE list_items SET private_to = 1 WHERE text = 'במבה' OR product_id IN (SELECT id FROM products WHERE name = 'במבה')");
    await p.reload2(); await p.go('#list'); await p.waitForTimeout(300);
    ok(await p.$('.item:has-text("במבה") .lock'), 'no lock on a private line of a shared product');
  });

  await check('S5-facts', 'q14, b06 (02/10): "מה למדתי": "עלייך" / "על הבית" / "על {שם}" / "כללים"; פרטי עם מנעול ורק אצלה; מבוגר מוחק גם של הבית ושל ילד; לא של מבוגר אחר', async () => {
    const f = (about, id, key, value, priv = 0) => `('${about}', ${id}, '${key}', '${value}', 0, ${id || 1}, ${id || 1}, ${priv}, 'chat', 0, 0)`;
    lib.d1(`INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ${[f('person', 2, 'avoid', 'בוטנים'), f('person', 2, 'pregnancy', 'שבוע 10', 1), f('house', 0, 'appliance', 'מיקסר'), f('person', 1, 'likes', 'פסטה'), f('person', 3, 'allergy', 'אגוזים'), f('person', 2, 'shabbat', 'כן')].join(', ')}`);
    lib.d1("INSERT INTO lessons (text, added, added_by) VALUES ('לא קונים במבה', 0, 1)");
    const m = await phone(b, { w: 390, h: 844, user: 2 });
    await m.go('#settings'); await m.waitForTimeout(400);
    const txt = await m.$eval('.taught', (x) => x.innerText);
    for (const t of ['עלייך', 'לא אוכלת: בוטנים', 'הריון: שבוע 10', 'שומרת שבת', 'על הבית', 'ציוד בבית: מיקסר', 'על אבי', 'אוהב: פסטה', 'על יואבי', 'אלרגיה: אגוזים', 'כללים', 'לא קונים במבה']) ok(txt.includes(t), `"${t}" missing: ${txt}`);
    ok(await m.$('[data-fact]:has-text("הריון") .lock'), 'no lock on her private fact');
    ok(!(await m.$('[data-fact]:has-text("אוהב: פסטה")')), 'Michal can delete Avi\'s');
    await p.reload2(); await p.go('#settings'); await p.waitForTimeout(400);
    const at = await p.$eval('.taught', (x) => x.innerText);
    ok(at.includes('עליך') && at.includes('על מיכל') && !at.includes('הריון'), `Avi: ${at}`);
    await p.click('[data-fact]:has-text("אלרגיה: אגוזים")'); await p.click('#f-del'); await p.click('#f-del'); await p.waitForTimeout(800);
    ok(!(await p.$eval('.taught', (x) => x.innerText)).includes('אלרגיה: אגוזים'), 'the child\'s fact wasn\'t deleted');
  });

  await check('S5-D1kid', 'D1–D6 (q12): גם בנוסחים של ילד ("ל-118") המספרים לחיצים', async () => {
    await kid.api('POST', '/api/chat', { text: 'אבא מרביץ לי' });
    await kid.reload2(); await kid.go('#chat'); await kid.waitForTimeout(500);
    const links = await kid.$$eval('#thread .msg.bot a[href^="tel:"]', (xs) => xs.map((x) => x.getAttribute('href')));
    ok(links.includes('tel:118') && links.includes('tel:100'), JSON.stringify(links));
  });

  await check('S5-one', 'ש2 (05/10): כרטיס אחד מהשרת בכל פעם: פג תוקף לפני ספירה; אחרי שעונים עליו, הבא', async () => {
    const s = await p.state(); const milk = s.products.find((x) => x.name === 'חלב 3%');
    await p.api('POST', '/api/actions', { actions: [{ kind: 'create', product: { name: 'שמנת פגה', count_type: 'units', qty: 1, expires: Date.now() - 3 * 864e5 } }] });
    lib.d1(`INSERT OR REPLACE INTO settings (key, value) VALUES ('recount_at', '${Date.now()}'), ('recount_ids', '[${milk.id}]')`);
    await p.reload2(); await p.go('#chat'); await p.waitForTimeout(500);
    ok(await p.$('.expired-card'), 'no expiry card');
    ok(!(await p.$('.coupon.recount:not(.expired-card)')), 'two cards at once');
    for (let k = 0; k < 6 && await p.$('.expired-card [data-ex-ok]'); k++) { await p.click('.expired-card [data-ex-ok]'); await p.waitForTimeout(700); }
    await p.waitForTimeout(500);
    ok(!(await p.$('.expired-card')) && await p.$('.coupon.recount'), 'the next card didn\'t come');
  });

  await check('S5-texts', 'נוסחים (05/10): תזכורת יומית של מיכל אצל אבי "מיכל ביקשה שאזכיר לה כל יום ב-…" (r0t-10); "קטניות בפסח: לא"; "לא לשאול: שאלות כדי ללמוד עליך"', async () => {
    lib.d1(`INSERT INTO maybe (text, added_by, added, due_at, kind, repeat) VALUES ('ויטמין די', 2, ${Date.now()}, ${Date.now() + 3600e3}, 'remind', 'daily'), ('אומגה', 1, ${Date.now()}, ${Date.now() + 3600e3}, 'remind', 'daily')`);
    lib.d1("INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated) VALUES ('house', 0, 'kitniyot', 'לא', 0, 1, 1, 0, 'chat', 0, 0), ('person', 1, 'no_ask', 'ללמוד', 0, 1, 1, 0, 'chat', 0, 0)");
    await p.reload2(); await p.go('#list'); await p.waitForTimeout(400);
    const t = await p.textContent('.listwrap');
    ok(/ויטמין די[^]*מיכל ביקשה שאזכיר לה כל יום ב-\d\d:\d\d/.test(t), t.slice(0, 400));
    ok(/אומגה[^]*אזכיר לך כל יום ב-/.test(t), 'mine changed');
    await p.go('#settings'); await p.waitForTimeout(400);
    const l = await p.$eval('.taught', (x) => x.innerText);
    ok(l.includes('קטניות בפסח: לא') && l.includes('לא לשאול: שאלות כדי ללמוד עליך'), l);
  });

  await check('S5-57', '57 (05/10): החותמת על כרטיס שלא קרה בו כלום: "לא היה מה לעדכן."; כרטיס שבוטל: "בוטל"', async () => {
    const card = (id, extra) => JSON.stringify({ reply: 'להוריד?', face: 'happy', proposal: { id, lines: [{ icon: 'list', text: 'להוריד?' }], ...extra }, status: extra.status, for: 1 }).replace(/'/g, "''");
    lib.d1(`INSERT INTO chat (ts, user_id, role, content, thread) VALUES (${Date.now()}, NULL, 'shuki', '${card('p57a', { status: 'applied', nothing: true })}', 1), (${Date.now() + 1}, NULL, 'shuki', '${card('p57b', { status: 'rejected' })}', 1)`);
    await p.reload2(); await p.go('#chat'); await p.waitForTimeout(500);
    ok(await p.textContent('.coupon[data-id="p57a"] .stampd') === 'לא היה מה לעדכן.', 'stamp of nothing');
    ok(await p.textContent('.coupon[data-id="p57b"] .stampd') === 'בוטל', 'stamp of skipped');
  });

  await check('S5-rowcard', '8 (05/10): כרטיס מהשרת שנשמר כשורה בצ\'אט ("התגעגעתי") קודם לכל השאר: כשהוא מחכה, הוא היחיד', async () => {
    await p.api('POST', '/api/actions', { actions: [{ kind: 'create', product: { name: 'חמאה פגה', count_type: 'units', qty: 1, expires: Date.now() - 3 * 864e5 } }] });
    const card = JSON.stringify({ reply: 'התגעגעתי! לעבור על מה שאולי השתנה?', face: 'happy', card: 1, options: ['כן, נעבור', 'לא עכשיו'] }).replace(/'/g, "''");
    lib.d1(`INSERT INTO chat (ts, user_id, role, content, thread) VALUES (${Date.now() + 5000}, NULL, 'shuki', '${card}', NULL)`);
    await p.reload2(); await p.go('#chat'); await p.waitForTimeout(500);
    ok(!(await p.$('.expired-card')) && !(await p.$('.coupon.recount')), 'another card with it');
    ok(await p.$('.chips [data-opt="כן, נעבור"]'), 'its buttons are missing');
    await kid.reload2(); await kid.go('#chat'); await kid.waitForTimeout(400);
    ok(!(await kid.$('.chips [data-opt="כן, נעבור"]')), 'a child sees its buttons (66)');
    lib.d1("UPDATE chat SET content = json_set(content, '$.answered', 1) WHERE content LIKE '%התגעגעתי! לעבור%'");
    await p.reload2(); await p.go('#chat'); await p.waitForTimeout(500);
    ok(await p.$('.expired-card'), 'the next card didn\'t come after it was answered');
  });

  await check('S5-left', '10, 11 (05/10): תזכורת יומית של מי שעזב בשם השמור; "לא לשאול" של אבי לא מופיע אצל מיכל', async () => {
    lib.d1("INSERT OR REPLACE INTO users (id, name, gender, role, active, created) VALUES (7, 'רותי', 'f', 'member', 0, 0)");
    lib.d1(`INSERT INTO maybe (text, added_by, added, due_at, kind, repeat) VALUES ('ברזל', 7, ${Date.now()}, ${Date.now() + 3600e3}, 'remind', 'daily')`);
    await p.reload2(); await p.go('#list'); await p.waitForTimeout(400);
    ok(/ברזל[^]*רותי ביקשה שאזכיר לה כל יום ב-\d\d:\d\d/.test(await p.textContent('.listwrap')), 'the reminder of one who left');
    const m = await phone(b, { w: 390, h: 844, user: 2 });
    await m.go('#settings'); await m.waitForTimeout(400);
    ok(!(await m.$eval('.taught', (x) => x.innerText)).includes('לא לשאול'), 'Avi\'s "לא לשאול" at Michal\'s');
  });

  await finish(b, 'test/stage5-ui-results.json');
})().catch((e) => { console.error(e); process.exit(1); });
