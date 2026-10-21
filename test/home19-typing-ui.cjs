// home19, typing (18/10, the owner: in Chrome on the computer the space "doesn't go in at all", in the inventory and then in the
// chat too): every box in the app where one types, on the computer (1280×800, no touch) and, in WebKit, in Playwright's
// iPhone 15. In each box "חומץ בלסמי" key by key (the space as a key of its own), and the box is read right after the space,
// after more letters, and after everything that redraws in a real house: a change from another phone (the app's refresh, as
// its poll and its return to the front do), leaving the box and coming back (renderLater on focusout), another screen and
// back, a window opened and closed, `online`. Also: the focus stays (the keyboard doesn't drop), the caret doesn't jump,
// a letter typed and deleted in the middle, a paste, Hebrew with English and numbers, and Enter (send or a new line).
// T-1… one check per box; the steps that failed are named in its error. Chromium and WebKit
// (UIS="test/home19-typing-ui.cjs test/home19-typing-ui.cjs@webkit").
const pw = require(process.env.PW), BR = process.env.PW_BROWSER || 'chromium', browser = pw[BR];
const lib = require('./sweep-lib.cjs');
const { BASE, d1, check, ok, finish } = lib;
const WORD = 'חומץ בלסמי';
const CONFIGS = BR === 'webkit' ? ['desktop', 'iphone'] : ['desktop'];
let codeN = 771000, other = 0;
const steps = []; // [box, config, step, ok, info]: the report's table

async function open(b, kind) {
  const ctx = kind === 'iphone' ? await b.newContext({ ...pw.devices['iPhone 15'], serviceWorkers: 'block' })
    : await b.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: false, serviceWorkers: 'block', ...(BR === 'chromium' ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}) });
  await lib.unfold(ctx);
  const p = await ctx.newPage(); p.errors = []; p.on('pageerror', (e) => p.errors.push(e.message));
  p.kind = kind; p.ctx = ctx; lib.shotPage = p;
  const code = String(codeN++);
  d1(`INSERT OR REPLACE INTO pairing_codes (code, user_id, expires) VALUES ('${code}', 1, 9999999999999)`);
  await p.goto(BASE + '/'); await p.waitForSelector('#code');
  p.pairBox = await (async () => { // the pairing code: digits only, a space typed in it goes (the box keeps the digits)
    await (kind === 'iphone' ? p.locator('#code').tap() : p.locator('#code').click());
    for (const ch of '944 080') { if (ch === ' ') await p.keyboard.press('Space'); else await p.keyboard.type(ch); await p.waitForTimeout(40); }
    return p.locator('#code').evaluate((el) => ({ v: el.value, f: document.activeElement === el }));
  })();
  await p.fill('#code', code); await p.click('#pair button[type=submit]'); await p.waitForSelector('#say');
  p.api = (m, u, bd) => p.evaluate(async ([m, u, bd]) => { const r = await fetch(u, { method: m, headers: { 'content-type': 'application/json', 'x-levels': '21', authorization: `Bearer ${JSON.parse(localStorage.getItem('shuki.token'))}` }, body: bd ? JSON.stringify(bd) : undefined }); return r.json(); }, [m, u, bd]);
  p.go = async (hash) => { await p.evaluate((x) => { location.hash = x; }, hash); await p.waitForTimeout(400); };
  // a button or a box under the fixed tab bar (or a toast) can't be reached by Playwright, which doesn't scroll it out as a
  // finger would: after 5 seconds, the click itself (and the focus), said in the log
  p.press = async (loc) => {
    try { await (kind === 'iphone' ? loc.tap({ timeout: 5000 }) : loc.click({ timeout: 5000 })); }
    catch { console.log(`   (${kind}: ${loc} covered, clicked directly)`); await loc.dispatchEvent('click'); await loc.evaluate((el) => { if (el.matches('input, textarea')) el.focus(); }); }
  };
  return p;
}
const closeSheet = (p) => p.evaluate(() => document.querySelector('.scrim')?.remove());
const keys = async (p, s) => { for (const ch of s) { if (ch === ' ') await p.keyboard.press('Space'); else await p.keyboard.type(ch); await p.waitForTimeout(40); } };
/** a change from another phone, then what the app does on its poll and on coming back to the front: refresh() with something new */
const otherPhone = (p) => p.api('POST', '/api/actions', { actions: [{ kind: 'create', product: { name: `מטלפון אחר ${++other}`, count_type: 'units', qty: 1 } }] });

/**
 * One box: open it, then the steps. `box`: { id, name, sel, open(p), main (in #main), keeps (kept across screens),
 * back (another screen and back), sheetOpen(p) (a window opened and closed over it), enter: 'send'|'newline'|'submit'|null,
 * extra(p, L, want) (steps of its own) }.
 */
async function runBox(p, box) {
  const bad = [], cfg = p.kind;
  const step = (name, cond, info) => { steps.push([box.id, `${BR} ${cfg}`, name, !!cond, cond ? '' : info]); if (!cond) bad.push(`${name}: ${info}`); };
  const L = () => p.locator(box.sel).first();
  const st = () => L().evaluate((el) => ({ v: el.value, f: document.activeElement === el, s: el.selectionStart, e: el.selectionEnd }));
  const toEnd = () => L().evaluate((el) => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
  const neutral = () => (box.main ? p.locator('.band h1') : p.locator('.scrim .sheet h2').first());
  await closeSheet(p); await box.open(p); await L().waitFor();
  await L().evaluate((el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(250);
  // 1. key by key: right after the space, and after the rest
  await p.press(L()); await p.waitForTimeout(150);
  await keys(p, 'חומץ '); await p.waitForTimeout(250);
  let r = await st(); step('אחרי הרווח', r.v === 'חומץ ' && r.f && r.s === 5, JSON.stringify(r));
  await keys(p, 'בלסמי'); await p.waitForTimeout(250);
  r = await st(); let want = WORD;
  step('אחרי עוד אותיות', r.v === want && r.f && r.s === want.length, JSON.stringify(r));
  if (r.v !== want) { await L().evaluate((el, w) => { el.value = w; }, want); }
  // 2. a change from another phone while typing (refresh: what the poll and visibilitychange do), the caret where it was
  await toEnd(); await L().evaluate((el) => el.setSelectionRange(3, 3)); await otherPhone(p);
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(900);
  r = await st(); step('שינוי מטלפון אחר (refresh)', r.v === want && r.f && r.s === 3 && r.e === 3, JSON.stringify(r));
  await toEnd(); await keys(p, ' 2'); want += ' 2'; await p.waitForTimeout(200);
  r = await st(); step('המשך אחרי ה-refresh', r.v === want && r.f, JSON.stringify(r));
  // 3. out of the box (what waited is drawn now: renderLater) and back into it
  await otherPhone(p); await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(600);
  await p.press(neutral()); await p.waitForTimeout(900);
  r = await st(); step('יציאה מהתיבה (renderLater)', r.v === want, JSON.stringify(r));
  if (r.v !== want) await L().evaluate((el, w) => { el.value = w; }, want);
  await p.press(L()); await toEnd(); await keys(p, ' x'); want += ' x'; await p.waitForTimeout(200);
  r = await st(); step('חזרה לתיבה והמשך', r.v === want && r.f, JSON.stringify(r));
  // 4. `online` (setOnline, flushQueue and refresh) while typing
  await otherPhone(p); await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(900);
  r = await st(); step('online', r.v === want && r.f && r.s === want.length, JSON.stringify(r));
  // 5. in the middle: a letter typed after the second one, then deleted; the caret stays there
  await L().evaluate((el) => { el.focus(); el.setSelectionRange(2, 2); });
  await p.keyboard.type('Z'); await p.waitForTimeout(150);
  r = await st(); step('אות באמצע', r.v === `${want.slice(0, 2)}Z${want.slice(2)}` && r.s === 3, JSON.stringify(r));
  await p.keyboard.press('Backspace'); await p.waitForTimeout(150);
  r = await st(); step('מחיקה באמצע', r.v === want && r.s === 2 && r.f, JSON.stringify(r));
  // a box with a maxlength (a store: 20) takes no more: from here on, a short word in it
  const short = await L().evaluate((el, n) => el.maxLength > 0 && el.maxLength < n, want.length + 30);
  if (short) { await L().evaluate((el) => { el.value = 'חומץ'; el.dispatchEvent(new Event('input', { bubbles: true })); }); want = 'חומץ'; }
  // 6. a paste at the end (the system's paste; where the clipboard can't be written, text inserted as a paste does)
  await toEnd();
  const paste = short ? ' Ok 5' : ' Ok 500ml חומץ';
  const pasted = await p.evaluate((t) => navigator.clipboard?.writeText(t).then(() => true, () => false) ?? false, paste).catch(() => false);
  if (pasted) await p.keyboard.press('ControlOrMeta+V'); else await p.keyboard.insertText(paste);
  await p.waitForTimeout(200); want += paste;
  r = await st(); step(pasted ? 'הדבקה' : 'הדבקה (insertText)', r.v === want && r.f && r.s === want.length, JSON.stringify(r));
  // 7. Hebrew with English and numbers, key by key
  const mixed = short ? ' a1 אב' : ' abc 12 אב';
  await keys(p, mixed); want += mixed; await p.waitForTimeout(200);
  r = await st(); step('עברית, אנגלית ומספרים', r.v === want && r.f, JSON.stringify(r));
  // 8. another screen and back (the searches keep what was typed)
  if (box.back) {
    await p.go(box.back); await p.go(box.screen); await p.waitForTimeout(300);
    r = await st(); step('מסך אחר ובחזרה', box.keeps ? r.v === want : true, `${JSON.stringify(r)}${box.keeps ? '' : ' (not kept by design)'}`);
    if (r.v !== want) await L().evaluate((el, w) => { el.value = w; el.dispatchEvent(new Event('input', { bubbles: true })); }, want);
  }
  // 9. a window over the screen, opened and closed
  if (box.sheetOpen) {
    await p.press(L()); await toEnd();
    await box.sheetOpen(p); await p.waitForSelector('.scrim'); await p.waitForTimeout(300);
    await p.locator('.scrim .sheet-x').first().click(); await p.waitForTimeout(500);
    r = await st(); step('חלון נפתח ונסגר', r.v === want, JSON.stringify(r));
  }
  if (box.extra) await box.extra(p, L, want, step, st);
  // 10. Enter
  if (box.enter) {
    await p.press(L()); await toEnd();
    const before = (await st()).v;
    await p.keyboard.press('Enter'); await p.waitForTimeout(box.enter === 'send' && cfg !== 'iphone' ? 1500 : 500);
    r = await st();
    const enter = box.enter === 'send' && cfg === 'iphone' ? 'newline' : box.enter; // in the phone, Enter is a new line (pointer: coarse)
    if (enter === 'newline') step('Enter: שורה חדשה', r.v === `${before}\n` && r.f, JSON.stringify(r));
    if (enter === 'send') {
      const sent = await p.evaluate((t) => [...document.querySelectorAll('.msg.me')].some((m) => m.textContent.includes(t)), before.trim());
      step('Enter: שליחה', r.v === '' && r.f && sent, `${JSON.stringify(r)} sent ${sent}`);
      // and typing on while Shuki answers, and after his answer is drawn
      await keys(p, 'חומץ '); await p.waitForTimeout(2500); await keys(p, 'בלסמי'); await p.waitForTimeout(300);
      r = await st(); step('הקלדה בזמן התשובה', r.v === WORD && r.f, JSON.stringify(r));
    }
    if (box.enter === 'submit') step('Enter: נשלח, והפוקוס נשאר', r.v === '' && r.f, `${JSON.stringify(r)} toast ${await p.evaluate(() => document.querySelector('.toast')?.textContent)}`);
  }
  await L().evaluate((el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }).catch(() => {});
  ok(!bad.length, bad.join(' | '));
  return `${steps.filter((x) => x[0] === box.id && x[1] === `${BR} ${cfg}`).length} צעדים`;
}

/** Numbers: digits with a space, a redraw from another phone, a delete. */
async function runNum(p, box) {
  const bad = [], cfg = p.kind;
  const step = (name, cond, info) => { steps.push([box.id, `${BR} ${cfg}`, name, !!cond, cond ? '' : info]); if (!cond) bad.push(`${name}: ${info}`); };
  const L = () => p.locator(box.sel).first();
  const st = () => L().evaluate((el) => ({ v: el.value, f: document.activeElement === el, s: el.selectionStart }));
  await closeSheet(p); await box.open(p); await L().waitFor();
  await L().evaluate((el) => { el.value = ''; }); await p.press(L()); await p.waitForTimeout(150);
  await keys(p, '12 5'); await p.waitForTimeout(200);
  let r = await st(); step('ספרות עם רווח', r.v === '12 5' && r.f, JSON.stringify(r));
  await otherPhone(p); await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(900);
  r = await st(); step('שינוי מטלפון אחר (refresh)', r.v === '12 5' && r.f && r.s === 4, JSON.stringify(r));
  await p.keyboard.press('Backspace'); await p.keyboard.press('Backspace'); await p.waitForTimeout(150);
  r = await st(); step('מחיקה', r.v === '12' && r.f, JSON.stringify(r));
  await L().evaluate((el) => { el.value = ''; }).catch(() => {});
  ok(!bad.length, bad.join(' | '));
}

const sheetOf = (screen, ...clicks) => async (p) => {
  await closeSheet(p); if (screen) await p.go(screen);
  for (const c of clicks) { if (typeof c === 'function') await c(p); else { await p.locator(c).first().waitFor(); await p.press(p.locator(c).first()); await p.waitForTimeout(350); } }
};
const onScreen = (screen) => async (p) => { await p.go(screen); };
const productRow = (p) => p.press(p.locator('#invList [data-p]', { hasText: 'שמן זית' }).first());
const firstRecipe = async (p) => { await p.locator('#recQ').evaluate((el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(300); await p.press(p.locator('.rlist [data-rec]', { hasText: 'סלט' }).first()); await p.waitForSelector('#rEdit'); };

// the product window draws itself again from what was read (the type of count, "מוצר קבוע", a photo): what was typed stays
const productRedraw = async (p, L, want, step, st) => {
  await L().evaluate((el, w) => { el.value = w; }, 'חומץ '); await p.press(L()); await L().evaluate((el) => el.setSelectionRange(5, 5));
  await p.locator('#f-basic').evaluate((c) => { c.checked = !c.checked; c.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(300);
  await p.locator('#f-basic').evaluate((c) => { c.checked = !c.checked; c.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(300);
  let r = await st(); step('החלון מצטייר מחדש (מוצר קבוע)', r.v === 'חומץ ', JSON.stringify(r));
  await L().evaluate((el) => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }); await keys(p, 'בלסמי'); await p.waitForTimeout(150);
  r = await st(); step('המשך אחרי הציור', r.v === WORD, JSON.stringify(r));
};

const BOXES = [
  { id: 'T-1', name: "הצ'אט (#say)", sel: '#say', screen: '#chat', main: true, open: onScreen('#chat'), back: '#inventory', keeps: false, sheetOpen: (p) => p.locator('[data-down]').last().dispatchEvent('click') /* in the iPhone the 👎 is under the composer while it has the focus */, enter: 'send' },
  { id: 'T-2', name: 'חיפוש במלאי (#invQ)', sel: '#invQ', screen: '#inventory', main: true, open: onScreen('#inventory'), back: '#list', keeps: true, sheetOpen: (p) => p.press(p.locator('#addP')) },
  { id: 'T-3', name: 'חיפוש במתכונים (#recQ)', sel: '#recQ', screen: '#recipes', main: true, open: onScreen('#recipes'), back: '#inventory', keeps: true, sheetOpen: (p) => p.press(p.locator('#addR')) },
  { id: 'T-4', name: 'רשימה: הוספה חופשית (#addTxt)', sel: '#addTxt', screen: '#list', main: true, open: onScreen('#list'), back: '#chat', keeps: false, enter: 'submit' },
  { id: 'T-5', name: 'מוצר חדש: שם', sel: '#f-name', open: sheetOf('#inventory', '#addP'), extra: productRedraw },
  { id: 'T-6', name: 'מוצר חדש: במה זה בא', sel: '#f-unit', open: sheetOf('#inventory', '#addP') },
  { id: 'T-7', name: 'מוצר חדש: מותג', sel: '#f-brand', open: sheetOf('#inventory', '#addP') },
  { id: 'T-8', name: 'עריכת מוצר: שם', sel: '#f-name', open: sheetOf('#inventory', productRow), extra: productRedraw },
  { id: 'T-9', name: 'עריכת מוצר: במה זה בא', sel: '#f-unit', open: sheetOf('#inventory', productRow) },
  { id: 'T-10', name: 'עריכת מוצר: מותג', sel: '#f-brand', open: sheetOf('#inventory', productRow) },
  { id: 'T-11', name: 'מתכון חדש: שם', sel: '#rName', open: sheetOf('#recipes', '#addR', '[data-way="write"]') },
  { id: 'T-12', name: 'מתכון חדש: מצרכים', sel: '#rIngs', open: sheetOf('#recipes', '#addR', '[data-way="write"]'), enter: 'newline' },
  { id: 'T-13', name: 'מתכון חדש: הוראות', sel: '#rText', open: sheetOf('#recipes', '#addR', '[data-way="write"]'), enter: 'newline' },
  { id: 'T-14', name: 'מתכון חדש: קטגוריה משלכם', sel: '#catName', open: sheetOf('#recipes', '#addR', '[data-way="write"]', '#catAdd') },
  { id: 'T-15', name: 'מתכון: הדבקה', sel: '#rPaste', open: sheetOf('#recipes', '#addR', '[data-way="paste"]'), enter: 'newline' },
  { id: 'T-16', name: 'עריכת מתכון: שם', sel: '#rName', open: sheetOf('#recipes', firstRecipe, '#rEdit') },
  { id: 'T-17', name: 'עריכת מתכון: מצרך', sel: '[data-ing]', open: sheetOf('#recipes', firstRecipe, '#rEdit') },
  { id: 'T-18', name: 'עריכת מתכון: הוראות', sel: '#rText', open: sheetOf('#recipes', firstRecipe, '#rEdit'), enter: 'newline' },
  { id: 'T-19', name: 'הגדרות: שם הבית', sel: '#houseName input', screen: '#settings', main: true, open: onScreen('#settings') },
  { id: 'T-20', name: 'הגדרות: חבר חדש (#m-name)', sel: '#m-name', screen: '#settings', main: true, open: onScreen('#settings') },
  { id: 'T-21', name: 'הגדרות: הערות לבית', sel: '#h-notes', screen: '#settings', main: true, open: onScreen('#settings'), enter: 'newline' },
  { id: 'T-22', name: 'הגדרות: מפתח', sel: '#k-key', screen: '#settings', main: true, open: onScreen('#settings') },
  { id: 'T-23', name: 'הגדרות: מיקום חדש', sel: '#newLoc input', screen: '#settings', main: true, open: onScreen('#settings'), enter: 'submit' },
  { id: 'T-24', name: 'הגדרות: חנות חדשה', sel: '#newStore input', screen: '#settings', main: true, open: onScreen('#settings'), enter: 'submit' },
  { id: 'T-25', name: 'הגדרות: קטגוריה חדשה', sel: '#newCat input', screen: '#settings', main: true, open: onScreen('#settings'), enter: 'submit' },
  { id: 'T-26', name: 'הגדרות: חיבור לעוזר (#c-name)', sel: '#c-name', screen: '#settings', main: true, open: onScreen('#settings') },
  { id: 'T-27', name: 'הגדרות: עריכת חבר (#e-name)', sel: '#e-name', open: sheetOf('#settings', '[data-mem="2"]') },
  { id: 'T-28', name: 'הגדרות: מחיקת הבית (#delName)', sel: '#delName', open: sheetOf('#settings', '#houseDel') },
  { id: 'T-29', name: 'הגדרות: מה למדתי (#l-text)', sel: '#l-text', open: sheetOf('#settings', '[data-lesson]'), enter: 'newline' },
  { id: 'T-30', name: "צ'אט: 👎 מה לא היה טוב (#fb-note)", sel: '#fb-note', open: sheetOf('#chat', (p) => p.press(p.locator('[data-down]').last())), enter: 'newline' },
  { id: 'T-31', name: 'רשימה בקנייה: רגע, יש לנו…? (#haveQ)', sel: '#haveQ', screen: '#list', main: true, open: onScreen('#list'), back: '#inventory', keeps: false },
];
const NUMS = [
  { id: 'N-1', name: 'מוצר חדש: עוד במקום נוסף', sel: '#f-rq', open: sheetOf('#inventory', '#addP') },
  { id: 'N-2', name: 'מוצר חדש: כמה ימים מחזיק', sel: '#f-shelf', open: sheetOf('#inventory', '#addP') },
  { id: 'N-3', name: 'מוצר חדש: אחרי פתיחה', sel: '#f-opend', open: sheetOf('#inventory', '#addP') },
  { id: 'N-4', name: 'הגדרות: תקרה (#capIn)', sel: '#capIn', open: sheetOf('#settings', '#costRow') },
];

(async () => {
  const b = await browser.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
  for (const cfg of CONFIGS) {
    d1("DELETE FROM settings WHERE key = 'stores'"); // the store the computer added ("כבר יש חנות כזו" for the iPhone's)
    const p = await open(b, cfg);
    await check(`P-1 ${cfg}`, `${BR} ${cfg}: קוד החיבור, "944 080" מקש-מקש: הספרות נשארות, הפוקוס בתיבה`, async () => {
      steps.push(['P-1', `${BR} ${cfg}`, 'ספרות עם רווח', p.pairBox.v === '944080' && p.pairBox.f, JSON.stringify(p.pairBox)]);
      ok(p.pairBox.v === '944080' && p.pairBox.f, JSON.stringify(p.pairBox));
    });
    if (cfg === CONFIGS[0]) { // the house: once
      await p.api('POST', '/api/actions', { actions: [{ kind: 'create', product: { name: 'חומץ', count_type: 'units', qty: 1, unit: 'בקבוק' } }, { kind: 'create', product: { name: 'שמן זית', count_type: 'units', qty: 1 } }] });
      await p.api('POST', '/api/recipes', { name: 'סלט', ingredients: '2 עגבניות\nשמן זית', text: 'חותכים.' });
      d1(`INSERT INTO lessons (text, added, added_by) VALUES ('חלב זה חלב סויה', ${Date.now()}, 1)`);
      d1(`INSERT INTO chat (ts, user_id, role, thread, content) VALUES (${Date.now()}, NULL, 'shuki', 1, '${JSON.stringify({ reply: 'שלום, מה נשמע?', face: 'happy', ai: true, for: 1 })}')`);
    }
    await p.reload(); await p.waitForSelector('#say'); await p.waitForTimeout(800);
    // the app's own poll (30 seconds), once, while typing in the chat: drawn when the box is left, and the rest goes after the space
    await check(`T-0 ${cfg}`, `${BR} ${cfg}: הצ'אט, "חומץ ", ה-poll של האפליקציה (30 שניות) עם שינוי מטלפון אחר, והמשך "בלסמי"`, async () => {
      await p.go('#chat'); await p.press(p.locator('#say')); await keys(p, 'חומץ ');
      d1(`INSERT INTO products (name, aliases, count_type, qty, created, updated) VALUES ('מטלפון אחר בזמן ה-poll ${cfg}', '[]', 'units', 1, 0, 0)`);
      d1(`INSERT INTO chat (ts, user_id, role, thread, content) VALUES (${Date.now()}, NULL, 'shuki', 1, '${JSON.stringify({ reply: 'עוד הודעה', face: 'happy', ai: true, for: 1 })}')`);
      await p.waitForTimeout(31000);
      const mid = await p.locator('#say').evaluate((el) => ({ v: el.value, f: document.activeElement === el, s: el.selectionStart }));
      steps.push(['T-0', `${BR} ${cfg}`, 'poll של 30 שניות', mid.v === 'חומץ ' && mid.f && mid.s === 5, JSON.stringify(mid)]);
      ok(mid.v === 'חומץ ' && mid.f && mid.s === 5, `after the poll: ${JSON.stringify(mid)}`);
      await keys(p, 'בלסמי'); const end = await p.locator('#say').evaluate((el) => el.value);
      ok(end === WORD, JSON.stringify(end));
      await p.locator('#say').evaluate((el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
    });
    for (const box of BOXES) {
      if (box.id === 'T-31') { d1(`INSERT INTO shopping (user_id, store, started) VALUES (1, 'super', ${Date.now()})`); await p.reload(); await p.waitForSelector('#say'); await p.waitForTimeout(800); }
      await check(`${box.id} ${cfg}`, `${BR} ${cfg}: ${box.name}`, () => runBox(p, box));
      if (box.id === 'T-31') d1('UPDATE shopping SET ended = 1 WHERE ended IS NULL');
    }
    for (const box of NUMS) await check(`${box.id} ${cfg}`, `${BR} ${cfg}: ${box.name}`, () => runNum(p, box));
    await check(`E-${cfg}`, `${BR} ${cfg}: אין שגיאות JavaScript`, async () => ok(!p.errors.length, p.errors.join(' | ')));
    await p.ctx.close();
  }
  require('node:fs').writeFileSync(`/tmp/shuki-test/home19-typing-steps-${BR}.json`, JSON.stringify(steps, null, 1));
  await finish(b, `/tmp/shuki-test/home19-typing-${BR}.json`);
})();
