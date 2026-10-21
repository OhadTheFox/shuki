// Round 21 screens (phone-sized Chromium, fake model): the recipes tab and everything in it, Shuki's card, the month's
// cost, "מה יש בבית", and "?" on every card line. Safari itself: sim/ in the simulator (see the round-21 report).
// Run: test/ui-qa.sh test/r21-ui.cjs
const { chromium } = require(process.env.PW);
const { check, ok, phone, finish, d1, d1q } = require('./sweep-lib.cjs');
const SHOTS = '/tmp/shuki-test/r21';
require('node:fs').mkdirSync(SHOTS, { recursive: true });
const shot = (p, name) => p.screenshot({ path: `${SHOTS}/${name}.png` });
const face = (p) => p.evaluate(() => document.querySelector('.band .shuki').dataset.mood);
const sideways = (p) => p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || [...document.querySelectorAll('.sheet')].some((s) => s.scrollWidth > s.clientWidth + 1));
// the toast that says `t` (an older one may still be on screen); returns what the last toast said
const toastText = async (p, t) => { if (t) await p.waitForFunction((x) => document.querySelector('.toast span')?.textContent === x, t, { timeout: 6000 }).catch(() => {}); else await p.waitForSelector('.toast', { timeout: 4000 }); return p.textContent('.toast span'); };
const sheetText = (p) => p.textContent('.sheet');
const fresh = async (p) => { ok(!p.errors.length, `page errors: ${p.errors.join(' | ')}`); await p.evaluate(() => { localStorage.removeItem('shuki.recF'); localStorage.removeItem('shuki.recQ'); document.querySelector('.scrim')?.remove(); }); await p.go('#chat'); await p.go('#recipes'); };
const closeSheet = async (p) => { await p.click('.sheet-x'); await p.waitForTimeout(200); ok(!(await p.$('.scrim')), 'the ✕ did not close the window'); };

(async () => {
  const b = await chromium.launch();
  const p = await phone(b, { w: 390, h: 844 });
  await p.api('POST', '/api/actions', { actions: [
    { kind: 'create', product: { name: 'ביצים L', count_type: 'pack', pack_size: 12, qty: 4, is_basic: 1, target: 12 } },
    { kind: 'create', product: { name: 'עגבניות', count_type: 'level', level: 'plenty', store: 'greengrocer' } },
    { kind: 'create', product: { name: 'שמן זית', count_type: 'inuse', is_open: 1, qty: 0 } },
    { kind: 'create', product: { name: 'רסק עגבניות', count_type: 'units', unit: 'קופסה', qty: 1 } },
    { kind: 'create', product: { name: 'פלפל חריף', count_type: 'level', level: 'none', store: 'greengrocer' } },
    { kind: 'create', product: { name: 'מלח', count_type: 'units', unit: 'שקית', qty: 1 } },
    { kind: 'create', product: { name: 'פסטה', count_type: 'units', unit: 'חבילה', qty: 3 } },
    { kind: 'create', product: { name: 'טונה', count_type: 'units', unit: 'קופסה', qty: 2, is_basic: 1, target: 2 } },
  ], op_id: 'r21-seed' });

  await check('U1', 'סרגל: חמש לשוניות, "מתכונים" רביעית; ריק: הטקסט המאושר; בלי גלילה לצד', async () => {
    await p.go('#recipes');
    const tabs = await p.$$eval('.nav a', (xs) => xs.map((x) => x.textContent.trim()));
    ok(tabs.length === 5 && tabs[3] === 'מתכונים', tabs.join('|'));
    ok((await p.textContent('.band h1')) === 'מתכונים');
    ok((await p.textContent('.rlist .empty')).trim() === "עוד אין מתכונים. אפשר להדביק לי מתכון בצ'אט או ללחוץ על +");
    ok(!(await p.$('.rfilters')), 'no filters with no recipes'); ok(!(await sideways(p)), 'sideways');
    await shot(p, '01-empty');
  });

  await check('U2', '+ → "מתכון חדש" עם ארבע האפשרויות; "כתבו לי": בלי שם / בלי מצרכים → השאלות המאושרות; שמירה → "שמרתי את המתכון!"', async () => {
    await p.click('#addR');
    const ways = await p.$$eval('[data-way]', (xs) => xs.map((x) => x.textContent.trim()));
    ok(JSON.stringify(ways) === JSON.stringify(['כתבו לי את המתכון בעצמכם', 'הדביקו טקסט או קישור למתכון', 'צרפו צילום של המתכון', 'רוצים שאכתוב בעצמי מתכון לפי המוצרים?']), ways.join('|'));
    ok((await p.textContent('.sheet h2')) === 'מתכון חדש');
    await shot(p, '02-new');
    await p.click('[data-way="write"]');
    ok((await p.getAttribute('#rIngs', 'placeholder')) === 'כל מצרך בשורה, למשל: 4 ביצים');
    await p.click('#rForm [type=submit]'); ok((await toastText(p, 'איך תרצו לקרוא למתכון?')) === 'איך תרצו לקרוא למתכון?');
    await p.fill('#rName', 'שקשוקה'); await p.click('#rForm [type=submit]'); ok((await toastText(p, 'אילו מצרכים צריך?')) === 'אילו מצרכים צריך?');
    await p.fill('#rServes', '4');
    await p.fill('#rIngs', '6 ביצים\n4 עגבניות\n2 קופסאות רסק עגבניות\n4 שיני שום\n2 פלפלים חריפים\nחצי כוס שמן\nכפית פפריקה מתוקה\nכפית כמון\nמלח');
    await p.fill('#rText', 'מטגנים את השום והפלפל החריף בהרבה שמן.\nמוסיפים רסק עגבניות מרוכז.\nמוסיפים את התבלינים ונותנים להם להיפתח בשמן.\nמוסיפים עגבניות טריות חתוכות לשישיות, עד שהמחבת מלאה.\nשוברים פנימה את הביצים, מכסים ומבשלים על אש נמוכה.');
    await p.click('[data-cat="ארוחות בוקר"]'); await p.click('[data-cat="ישראלי"]');
    await shot(p, '03-form');
    await p.click('#rForm [type=submit]'); ok((await toastText(p, 'שמרתי את המתכון!')) === 'שמרתי את המתכון!');
    await p.waitForTimeout(400);
    ok(!(await p.$('.scrim')), 'the form closed');
    ok((await p.textContent('.rcard .rname')).includes('שקשוקה')); ok((await p.textContent('.rcard .rstat')) === 'חסרים 4 מוצרים');
    ok((await p.textContent('.band .sub')) === 'מתכון אחד');
  });

  await check('U3', 'דף מתכון: ✓/✗ לפי המלאי, "(יש 4)", כמה אנשים משנה כמויות, "אופן ההכנה"', async () => {
    await fresh(p);
    await p.click('.rcard'); await p.waitForSelector('.ings');
    const lines = await p.$$eval('.ings li', (xs) => xs.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    ok(lines[0] === '✗6 ביצים (יש 4 ביצים)', lines[0]); ok(lines.includes('✓מלח'), lines.join('|')); ok(lines.includes('✗2 פלפלים חריפים'), lines.join('|'));
    ok((await sheetText(p)).includes('אופן ההכנה'));
    // after review: two separate blocks, the steps numbered
    ok((await p.$$eval('.sheet .rbox', (xs) => xs.length)) === 2); ok((await p.$$eval('.rsteps li', (xs) => xs.length)) >= 1);
    await shot(p, '04-page');
    await p.click('#pPlus'); await p.click('#pPlus'); await p.click('#pPlus'); await p.click('#pPlus');
    ok((await p.textContent('#pN')) === '8'); ok((await p.textContent('.ings li')).includes('12 ביצים'));
    await shot(p, '05-page-8');
    await closeSheet(p);
  });

  await check('U4', '"להוסיף את מה שחסר לרשימה" → "הוספתי לרשימה 3 מוצרים" (הביצים כבר ברשימה)', async () => {
    await fresh(p);
    await p.click('.rcard'); await p.click('#rMiss');
    ok((await toastText(p, 'הוספתי לרשימה 3 מוצרים')) === 'הוספתי לרשימה 3 מוצרים', await p.textContent('.toast span'));
    const s = await p.state(); ok(s.list.some((i) => i.text === 'שום'), 'not at home: added as text');
    await closeSheet(p);
  });

  await check('U5', '"הכנו את זה": הכותרת המאושרת, פרצוף נהנה, כל שורה עם "?", "נשאר מעט" לא מסומן; אישור → "בתיאבון!" ושאריות', async () => {
    await fresh(p);
    await p.click('.rcard'); await p.click('#rMade');
    await p.waitForSelector('.sheet .coupon');
    ok((await p.textContent('.sheet h2')).replace(/\s+/g, ' ') === 'הכנו שקשוקה! איזה כיף! מה לעדכן במלאי?', await p.textContent('.sheet h2'));
    ok((await face(p)) === 'yummy', await face(p));
    const lis = await p.$$eval('.sheet .coupon li', (xs) => xs.map((x) => ({ t: x.querySelector('span:last-child').textContent.trim(), off: x.classList.contains('off') })));
    ok(lis.every((x) => /\?$/.test(x.t)), JSON.stringify(lis));
    ok(lis.some((x) => x.t === 'לסמן שהשתמשנו ב-4 ביצים L?' && !x.off), JSON.stringify(lis));
    ok(lis.some((x) => x.t === 'לעדכן שנשאר מעט עגבניות?' && x.off), JSON.stringify(lis));
    await shot(p, '06-made-card');
    await p.click('.sheet [data-do="apply"]');
    await p.waitForSelector('#lYes');
    ok((await p.textContent('.sheet h2')) === 'בתיאבון!'); ok((await sheetText(p)).includes('האם נשארו שאריות?'));
    ok((await p.textContent('#lYes')) === 'נשארו שאריות' && (await p.textContent('#lNo')) === 'לא נשארו שאריות');
    ok((await face(p)) === 'hungry', await face(p));
    await shot(p, '07-bon-appetit');
    await p.waitForTimeout(1500); ok((await face(p)) === 'happy', 'hungry → happy');
    await p.click('#lYes'); await p.waitForTimeout(900);
    const s = await p.state();
    ok(s.leftovers.some((x) => x.text === 'שקשוקה'), 'leftover'); ok(s.recipes[0].cooked === 1); ok(s.products.find((x) => x.name === 'ביצים L').qty === 0);
    await p.go('#recipes'); await p.click('.rcard');
    ok((await sheetText(p)).includes('הכנתם פעם אחת')); await closeSheet(p);
  });

  await check('U6', 'הדבקת טקסט: "תסדר לי" → "אני מסדר את המתכון…" → טופס מלא; אותו שם שוב → "כבר שמור" ונפתח', async () => {
    await fresh(p);
    await p.click('#addR'); await p.click('[data-way="paste"]');
    ok((await p.getAttribute('#rPaste', 'placeholder')) === 'הדביקו כאן את המתכון או את הקישור'); ok((await p.textContent('#rGo')) === 'תסדר לי');
    await p.fill('#rPaste', 'שקשוקה: 6 ביצים, 4 עגבניות, רסק. מטגנים.');
    await p.click('#rGo'); await p.waitForSelector('#rForm');
    ok((await p.inputValue('#rName')) === 'שקשוקה'); ok((await p.inputValue('#rIngs')).startsWith('6 ביצים\n4 עגבניות'));
    ok(await p.$eval('[data-cat="ארוחות בוקר"]', (x) => x.classList.contains('on')), 'categories from Shuki');
    await shot(p, '08-paste-filled');
    await p.click('#rForm [type=submit]'); ok((await toastText(p, 'כבר שמור')) === 'כבר שמור');
    await p.waitForSelector('.ings'); ok((await p.textContent('.sheet h2')).includes('שקשוקה')); await closeSheet(p);
  });

  await check('U7', 'קישור לטיקטוק: הטקסט המאושר ו"לצרף צילום" → צילום → טופס עם הקישור והתמונה', async () => {
    await fresh(p);
    await p.click('#addR'); await p.click('[data-way="paste"]');
    await p.fill('#rPaste', 'https://www.tiktok.com/@chef/video/123'); await p.click('#rGo');
    await p.waitForSelector('#vShot');
    ok((await sheetText(p)).includes('בסרטון אין מתכון כתוב, אז שמרתי את הקישור. צרפו לי צילום מסך של המצרכים ואסדר אותם.'));
    ok((await p.textContent('#vShot')) === 'לצרף צילום');
    await shot(p, '09-video');
    await p.setInputFiles('#vFile', 'test/product-sample.jpg');
    await p.waitForSelector('#rForm'); ok(await p.$('#rPh img.rprev'), 'the photo it was read from');
    await p.fill('#rName', 'שקשוקה ירוקה'); await p.click('#rForm [type=submit]'); ok((await toastText(p, 'שמרתי את המתכון!')) === 'שמרתי את המתכון!');
    await p.waitForTimeout(500);
    const card = await p.$('.rcard:has-text("שקשוקה ירוקה")'); ok(card, 'saved');
    ok((await card.textContent()).includes('מתכון מצילום מסך'), await card.textContent());
    await p.waitForSelector('.rcard:has-text("שקשוקה ירוקה") img.rthumb[src]', { timeout: 5000 }).catch(() => {}); ok(await card.$('img.rthumb[src]'), 'photo on the card');
    await shot(p, '10-list-photo');
    await card.click(); await p.waitForSelector('.sheet a.rfrom'); ok((await p.textContent('.sheet a.rfrom')) === 'למתכון המקורי'); await closeSheet(p);
  });

  await check('U8', '"רוצים שאכתוב?": הטקסטים המאושרים, 3 רעיונות, שמירה של אחד, "רעיונות אחרים"', async () => {
    await fresh(p);
    await p.click('#addR'); await p.click('[data-way="ideas"]');
    await p.waitForSelector('.idea');
    ok((await p.textContent('.sheet h2')) === '3 רעיונות למתכונים לפי המוצרים שיש בבית');
    ok((await p.textContent('.sheet .hint')) === 'את הרעיונות אני כותב בעצמי, לפי המוצרים שיש לכם בבית.');
    ok((await p.$$('.idea')).length === 3); ok((await p.textContent('#more')) === 'רעיונות אחרים');
    await shot(p, '11-ideas');
    await p.click('[data-idea="1"]'); ok((await toastText(p, 'שמרתי את המתכון!')) === 'שמרתי את המתכון!');
    await p.waitForTimeout(400); ok(await p.$('.rcard:has-text("פסטה ברוטב עגבניות")'));
    ok((await p.textContent('.rcard:has-text("פסטה ברוטב עגבניות") .rfrom')) === 'מתכון של שוקי');
    // the list tab says how many of what (decision, 30/09)
    const tab = (await p.textContent('.nav a[href="#list"]')).trim(); ok(/^רשימה( \((מוצר אחד|\d+ מוצרים)\))?$/.test(tab), tab);
  });

  await check('U9', 'סינון: "אפשר להכין עכשיו" + רק קטגוריות שיש בהן מתכונים, בפס שגוללים לצד; ריק → הטקסט והשני כפתורים', async () => {
    await fresh(p);
    const chips = await p.$$eval('.rfilters .chip', (xs) => xs.map((x) => x.textContent));
    ok(chips[0] === 'אפשר להכין עכשיו' && chips.includes('פסטה') && !chips.includes('סושי'), chips.join('|'));
    const fs = await p.$eval('.rfilters', (x) => [getComputedStyle(x).overflowX, getComputedStyle(x).flexWrap]); ok(fs[0] === 'auto' && fs[1] === 'nowrap', `one scrolling row: ${fs}`);
    await p.api('POST', '/api/recipes', { name: 'טונה בפיתה', ingredients: 'קופסת טונה', tags: "סנדוויץ'" });
    await p.reload2(); await p.go('#recipes'); ok(!p.errors.length, `page errors: ${p.errors.join(' | ')}`);
    await p.click('[data-rf="now"]');
    const names = await p.$$eval('.rcard .rname', (xs) => xs.map((x) => x.textContent));
    ok(names.length === 1 && names[0].includes('טונה בפיתה'), `can make now: ${names.join('|')}`);
    await p.click('[data-rf="now"]'); // off
    await p.fill('#recQ', 'זזזז'); await p.waitForTimeout(200); ok((await p.textContent('.rlist .empty')) === 'לא מצאתי מתכון כזה');
    await p.fill('#recQ', ''); await p.waitForTimeout(200);
    // nothing can be made: the pasta runs out
    const tuna = (await p.state()).products.find((x) => x.name === 'טונה').id;
    await p.api('POST', '/api/actions', { actions: [{ kind: 'op', product_id: tuna, op: { type: 'out' } }], op_id: 'r21-tuna' });
    await p.reload2(); await p.go('#recipes'); await p.click('[data-rf="now"]');
    ok((await p.textContent('.rlist .empty')).startsWith('אין מתכון שיש בשבילו את כל המוצרים בבית'));
    ok(await p.$('.empty [data-plan]') && await p.$('.empty [data-ideas]'), 'the two buttons');
    await shot(p, '12-none-now');
    await p.click('[data-rf="now"]');
  });

  await check('U10', 'עריכה: "עריכת המתכון", קישור למלאי ("מהמלאי: …" / "לא מהמלאי"), שורה חדשה, קטגוריה משלכם, הורדת תמונה', async () => {
    await fresh(p);
    await p.click('.rcard:has-text("שקשוקה ירוקה")'); await p.click('#rEdit');
    ok((await p.textContent('.sheet h2')) === 'עריכת המתכון');
    const opt = await p.$eval('[data-link="0"]', (s) => s.selectedOptions[0].textContent); ok(opt === 'מהמלאי: ביצים L', opt);
    ok(await p.$eval('[data-link="0"]', (s) => s.options[0].textContent === 'לא מהמלאי'));
    const n = (await p.$$('.ingrow')).length;
    await p.fill(`[data-ing="${n - 1}"]`, '100 גרם פטה'); ok((await p.$$('.ingrow')).length === n + 1, 'a new empty row');
    await p.selectOption('[data-link="0"]', '');
    await p.click('#catAdd'); ok((await p.getAttribute('#catName', 'placeholder')) === 'שם הקטגוריה'); ok((await p.textContent('#catOk')) === 'הוספה');
    await p.fill('#catName', 'רטבים'); await p.click('#catOk');
    ok((await p.textContent('#phDel')) === 'להוריד את התמונה' && (await p.textContent('#phNew')) === 'צילום חדש');
    await p.click('#phDel');
    await shot(p, '13-edit');
    await p.click('#rForm [type=submit]'); ok((await toastText(p, 'עודכן')) === 'עודכן');
    const x = (await p.state()).recipes.find((r) => r.name === 'שקשוקה ירוקה');
    ok(x.ings.at(-1).name === 'פטה' && x.ings[0].product_id === null && x.tags.includes('רטבים') && !x.photo, JSON.stringify(x).slice(0, 300));
    await closeSheet(p);
    ok(await p.$('[data-rf="רטבים"]'), 'the new category is a filter');
  });

  await check('U11', 'מחיקה: "האם למחוק את המתכון?" → "בטוח?" עם פרצוף מבוהל → נמחק', async () => {
    await fresh(p);
    await p.click('.rcard:has-text("שקשוקה ירוקה")');
    await p.click('#rDel'); ok((await p.textContent('#rDel')) === 'האם למחוק את המתכון?');
    await p.click('#rDel'); ok((await p.textContent('#rDel')) === 'למחוק באמת?'); ok((await face(p)) === 'scared');
    await shot(p, '14-delete');
    await p.click('#rDel'); await p.waitForTimeout(600);
    ok(!(await p.$('.rcard:has-text("שקשוקה ירוקה")')), 'gone'); ok(!(await p.$('[data-rf="רטבים"]')), 'an empty category goes by itself');
  });

  // home20 (section 16): "לתכנן את השבוע" opens the week on the recipes screen (its window went; test/home20-week-ui.cjs)
  await check('U12', '"לתכנן את השבוע": פותח את "השבוע" (סעיף 16), עם שבעה ימים ו"להוסיף מנה"', async () => {
    await fresh(p);
    await p.go('#recipes');
    await p.waitForTimeout(1200); await p.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 8000 }).catch(() => {}); // stage 10: a level-up party (level 2 at 5 points) goes first
    await p.click('#planR'); await p.waitForTimeout(400);
    ok(await p.$('.rec-segs [data-rview="week"].on'), 'not on the week');
    ok((await p.$$('.day')).length === 7 && (await p.$$('.addish')).length === 7, 'the days');
    await shot(p, '15-plan');
    await p.click('[data-rview="all"]'); await p.waitForTimeout(300);
  });

  await check('U13', 'בית כשר: "שימו לב: יש במתכון ערבוב של בשר וחלב" בדף, ו"שימו לב" בכרטיס', async () => {
    await fresh(p);
    await p.api('POST', '/api/settings', { house_notes: 'הכל כשר' });
    await p.api('POST', '/api/recipes', { name: 'עוף בשמנת', ingredients: 'חזה עוף\nשמנת מתוקה' });
    await p.reload2(); await p.go('#recipes');
    const card = await p.$('.rcard:has-text("עוף בשמנת")'); ok((await card.textContent()).includes('שימו לב'));
    await card.click(); ok((await p.textContent('.rwarnline')) === 'שימו לב: יש במתכון ערבוב של בשר וחלב');
    await shot(p, '16-kosher'); await closeSheet(p);
  });

  await check('U14', 'ילד: "להציע מתכון" → הטקסט המאושר; מבוגר רואה "{שם} הציע מתכון: …. האם לשמור?" ומאשר', async () => {
    d1("INSERT OR IGNORE INTO users (id, name, gender, role, active, created) VALUES (7, 'טל', 'f', 'child', 1, 0)");
    const kid = await phone(b, { user: 7 });
    await kid.go('#recipes'); await kid.click('#addR'); await kid.click('[data-way="write"]');
    ok((await kid.textContent('#rForm [type=submit]')) === 'להציע מתכון');
    await kid.fill('#rName', 'טוסט'); await kid.fill('#rIngs', '2 פרוסות לחם\nגבינה צהובה'); await kid.click('#rForm [type=submit]');
    ok((await toastText(kid, 'שמרתי והראיתי לאבא או לאמא. ברגע שאחד מהם יאשר, האישור יופיע כאן.')) === 'שמרתי והראיתי לאבא או לאמא. ברגע שאחד מהם יאשר, האישור יופיע כאן.');
    await kid.ctx.close();
    await p.reload2(); await p.go('#recipes');
    ok((await p.textContent('.rwait span')).replace(/\s+/g, ' ').trim() === 'טל הציעה מתכון: טוסט. האם לשמור?', await p.textContent('.rwait span'));
    ok((await p.textContent('[data-rok]')) === 'כן, תשמור' && (await p.textContent('[data-rno]')) === 'לא צריך');
    await shot(p, '17-child-waits');
    await p.click('[data-rok]'); ok((await toastText(p, 'שמרתי את המתכון!')) === 'שמרתי את המתכון!');
    await p.waitForTimeout(500); ok(await p.$('.rcard:has-text("טוסט")') && !(await p.$('.rwait')));
  });

  await check('U15', 'הגדרות: הכרטיס של שוקי ראשון ובסדר שנקבע; נגיעה בבובה פותחת את המלתחה; המתכונים יצאו מההגדרות', async () => {
    await p.go('#settings');
    const kids = await p.$$eval('.grow > *', (xs) => xs.map((x) => x.className || x.tagName));
    ok(JSON.stringify(kids) === JSON.stringify(['mini', 'lvname', 'xp', 'xpnext', 'moodbox', 'btn yel closet-go']), JSON.stringify(kids));
    const g = (await p.state()).growth; // stage 10: 21 levels, so the level by the points so far, not always 1
    ok((await p.textContent('.grow .lvname')).replace(/\s+/g, ' ').trim() === `רמה ${g.level} - ${g.name}`, await p.textContent('.grow .lvname'));
    ok(new RegExp(`^עוד \\d+ ימים לרמה ${g.level + 1}$|^עוד יום אחד לרמה ${g.level + 1}$`).test(await p.textContent('.grow .xpnext')), await p.textContent('.grow .xpnext'));
    ok(/^מצב הרוח שלי: \S+$/.test(await p.textContent('.grow .moodbox b')));
    ok(/^(צריך להשלים (\d+|מוצר אחד) מתוך \d+ מוצרים קבועים|צריך להשלים מוצר קבוע אחד|כל המוצרים הקבועים בבית)$/.test((await p.textContent('.grow .moodbox > span')).replace(/\s+/g, ' ')), await p.textContent('.grow .moodbox > span'));
    ok(await p.$eval('.set > section:first-child', (x) => x.classList.contains('grow')), 'first in settings');
    ok(!(await p.$('.panel h3:text-is("מתכונים")')), 'the old recipes panel is gone');
    await shot(p, '18-shuki-card');
    await p.click('#growShuki'); await p.waitForSelector('.scrim'); await closeSheet(p);
  });

  await check('U16', 'עלות החודש: שורה אחת ופס, בלי ההסבר וההערה על הקונסולה; נגיעה → חלון "תקרה חודשית ($)" עם ההסבר ופרצוף מרוצה', async () => {
    const row = (await p.textContent('#costRow')).replace(/\s+/g, ' ').trim();
    ok(/^החודש עליתי לכם בערך \$\d+\.\d\d מתוך \$\d+$/.test(row), row);
    const house = await p.textContent('.set'); ok(!house.includes('קונסולה') && !house.includes('ב-80% תגיע התראה'), 'no explanation, no console note');
    await p.click('#costRow');
    ok((await p.textContent('.sheet h2')) === 'תקרה חודשית ($)');
    ok((await p.textContent('.capwhy p')) === 'אני חייב להיות מחובר ל-Claude כדי לדבר איתכם, אבל אל תדאגו! כשנגיע ל-80% מהתקציב אודיע לכם שהקרדיטים עומדים להיגמר.');
    ok(await p.$eval('#capFace .shuki', (x) => x.dataset.mood === 'happy'));
    await shot(p, '19-cost');
    await p.fill('#capIn', '12'); await p.click('#capForm [type=submit]'); ok((await toastText(p, 'התקרה נשמרה')) === 'התקרה נשמרה');
    await p.waitForTimeout(500); ok((await p.textContent('#costRow')).includes('$12'));
  });

  await check('U17', '"מה יש בבית": כותרת, בלי "מנה" ובלי מצב הרוח, אחוזים רק לקבועים, ההערה בנוסח המאושר', async () => {
    await p.go('#inventory');
    ok((await p.textContent('.facts h3')) === 'מה יש בבית'); const t = await p.textContent('.facts');
    ok(!t.includes('מנה:') && !t.includes('מצב הרוח')); ok((await p.textContent('.facts .serv')).includes('מוצרים קבועים:'));
    ok((await p.textContent('.facts .fnote')) === '* כמה מוצרים יש בבית ביחס לכמות שהגדרתם.');
    const pct = await p.$$eval('.fr', (xs) => xs.map((x) => [x.querySelector('bdi').textContent, x.querySelector('.pct').textContent]));
    ok(pct.find((x) => x[0] === 'עגבניות')[1] === '' && /%$/.test(pct.find((x) => x[0] === 'טונה')[1]), JSON.stringify(pct));
    // the amount sits on the other side of the row, in its own column
    const g = await p.$eval('.fr', (x) => { const n = x.querySelector('bdi').getBoundingClientRect(); const q = x.querySelector('.q').getBoundingClientRect(); return q.right <= n.left; });
    ok(g, 'amount left of the name');
    await shot(p, '20-inventory');
  });

  await check('U19', '"מצב בישול": מסך מלא, צעד אחרי צעד, לא נסגר בנגיעה, "מצרכים", בצעד האחרון "הכנו את זה"', async () => {
    await fresh(p);
    await p.click('.rcard:has-text("שקשוקה")'); await p.click('#rCook'); await p.waitForSelector('.cook');
    ok(!(await p.$('.scrim')), 'the recipe window made way');
    ok((await p.textContent('.cook-n')) === 'צעד 1 מתוך 5', await p.textContent('.cook-n'));
    ok((await p.textContent('.cook-step')).startsWith('מטגנים את השום'));
    const box = await p.$eval('.cook', (x) => { const r = x.getBoundingClientRect(); return [r.width, r.height, innerWidth, innerHeight]; }); ok(box[0] === box[2] && box[1] === box[3], JSON.stringify(box));
    await shot(p, '21-cook');
    await p.mouse.click(200, 400); ok(await p.$('.cook'), 'a tap does not close it');
    await p.click('#cNext'); ok((await p.textContent('.cook-n')) === 'צעד 2 מתוך 5');
    await p.click('[data-tab="ings"]'); ok((await p.$$('.cook-ings li')).length === 9); await shot(p, '22-cook-ings');
    await p.click('[data-tab="steps"]'); for (let i = 0; i < 3; i++) await p.click('#cNext');
    ok(await p.$('#cMade') && !(await p.$('#cNext')), 'last step'); await shot(p, '23-cook-last');
    await p.click('.cook .sheet-x'); ok(!(await p.$('.cook')), '✕ closes');
  });

  await check('U18', 'כל החלונות החדשים: בלי גלילה לצד, ✕ סוגר; בלי שגיאות בדף', async () => {
    await p.go('#recipes'); await p.click('[data-rview="all"]'); await p.waitForTimeout(300);
    // home20: the week's "מה מכינים…?" in place of the old "לתכנן את השבוע" window
    for (const open of [() => p.click('#addR'), async () => { await p.click('[data-rview="week"]'); await p.waitForTimeout(300); await p.click('.addish'); }, async () => { await p.click('[data-rview="all"]'); await p.waitForTimeout(300); await p.click('.rcard'); }]) {
      await open(); await p.waitForSelector('.scrim'); ok(!(await sideways(p)), 'sideways'); await closeSheet(p);
    }
    ok(!p.errors.length, p.errors.join(' | '));
  });

  await check('U30', 'הגדרות (01/10): שוקי, הבית והתראות פתוחים; השאר מקופל תחת "עוד הגדרות"; "מתקדם" בסוף עם אזור הזמן, העלות ומחיקת הבית; מה שנפתח נשאר פתוח', async () => {
    const q = await phone(b, { w: 375, h: 667, unfoldAll: false });
    await q.go('#settings'); await q.waitForTimeout(400);
    const order = await q.$$eval('.set > *', (xs) => xs.map((x) => (x.matches('details') ? `[${x.dataset.fold}]` : x.matches('h2') ? x.textContent : x.querySelector('h3')?.textContent || x.className)));
    ok(order[0] === 'panel grow' && order[1] === 'הבית' && order[2] === 'התראות' && order[3] === 'עוד הגדרות' && order.at(-4) === '[מתקדם]' && order.at(-3) === 'המכשיר הזה' /* 17/10, ש3: its own panel */ && order.at(-2) === 'privacy' /* r13l: the privacy link, after it */ && order.at(-1) === 'appver' /* home19, item 14: the version, last */, order.join(' | '));
    ok(await q.$$eval('details.fold', (ds) => ds.every((d) => !d.open)), 'all folded');
    ok(!(await q.$('.house #tzSel')) && !(await q.$('.house #houseDel')), 'not in the house panel');
    ok(await q.$('details[data-fold="מתקדם"] #tzSel') && await q.$('details[data-fold="מתקדם"] #houseDel'), 'in מתקדם');
    await q.click('details[data-fold="מיקומים בבית"] > summary');
    await q.fill('#newLoc input', 'מרפסת'); await q.click('#newLoc button'); await q.waitForTimeout(900);
    ok(await q.$eval('details[data-fold="מיקומים בבית"]', (d) => d.open), 'still open after it was drawn again');
    await q.ctx.close();
  });

  await finish(b, require('node:path').join(__dirname, 'r21-ui-results.json'));
})();
