// Visual audit: nothing drawn on top of anything else, no clipped button text, nothing past the screen edge.
// Every screen and sheet, at 320 / 375 / 390 / 430 wide, scrolled to the top and to the bottom.
// Run: test/ui-qa.sh test/overlap.cjs   (screenshots of problems: /tmp/shuki-test/ov-*.png)
const { chromium } = require(process.env.PW);
const { execSync } = require('node:child_process');
const BASE = process.env.BASE || 'http://127.0.0.1:8791';
const S = '/tmp/shuki-test/shuki-uiqa';
const d1 = (sql) => execSync(`npx wrangler d1 execute shuki --local --persist-to ${S} --command "${sql.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });

// runs in the page: pairs of visible boxes that overlap and aren't nested
function audit(pos) {
  const SEL = 'button, input, select, textarea, label, h1, h2, h3, h4, p, small, b, bdi, code, output, li, a, .vd, .bdg, .exp, .new, .oneoff, .stamp, .cat, .chip, .qty, .nm, .pct, .msg, .gray, .sub, .offline, .rc span, .rq > span, .hv > span, .jrow span, .rowline > span, .keyrow span, .serv span, img.thumb, img.photo, .more, .paircode b';
  const scrim = document.querySelector('.scrim');
  const skip = (el) => el.closest('.toast, .mascot, .mini, details[style], [aria-hidden=true], svg') || (scrim && !el.closest('.scrim'))
    || (el.closest('details:not([open])') && !el.closest('summary'));
  // the part of an element you can actually see: clipped by scroll boxes and by the screen
  const vis = (el) => {
    const b = el.getBoundingClientRect(); if (b.width < 2 || b.height < 2) return null;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity < .05) return null;
    let r = { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const c = getComputedStyle(e);
      if (c.display === 'none') return null;
      if (c.overflowX !== 'visible' || c.overflowY !== 'visible') { const q = e.getBoundingClientRect(); r = { left: Math.max(r.left, q.left), right: Math.min(r.right, q.right), top: Math.max(r.top, q.top), bottom: Math.min(r.bottom, q.bottom) }; }
    }
    r = { left: r.left, right: r.right, top: Math.max(r.top, 0), bottom: Math.min(r.bottom, innerHeight) };
    return r.right - r.left > 2 && r.bottom - r.top > 2 ? r : null;
  };
  const fixedRoot = (el) => { for (let e = el; e; e = e.parentElement) { const q = getComputedStyle(e).position; if (q === 'fixed' || q === 'sticky') return e; } return null; };
  const name = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}「${(el.value || el.textContent || el.placeholder || '').trim().slice(0, 18)}」`;
  const els = [...document.querySelectorAll(SEL)].filter((el) => !skip(el)).map((el) => ({ el, r: vis(el) })).filter((x) => x.r);
  const out = [];
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const a = els[i], b = els[j];
    if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
    if ((a.el.tagName === 'LABEL' && a.el.control === b.el) || (b.el.tagName === 'LABEL' && b.el.control === a.el)) continue;
    // wrapped inline text is several line boxes, not one big rectangle
    const boxes = (x) => (getComputedStyle(x.el).display === 'inline' ? [...x.el.getClientRects()].map((q) => ({ left: Math.max(q.left, x.r.left), right: Math.min(q.right, x.r.right), top: Math.max(q.top, x.r.top), bottom: Math.min(q.bottom, x.r.bottom) })) : [x.r]);
    let w = 0, h = 0;
    for (const p of boxes(a)) for (const q of boxes(b)) {
      const ww = Math.min(p.right, q.right) - Math.max(p.left, q.left), hh = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
      if (ww > 3 && hh > 3 && ww * hh > w * h) { w = ww; h = hh; }
    }
    if (w <= 3 || h <= 3) continue;
    if ((a.el.matches('.sheet-x') && b.el.matches('.sheet > h2:first-child')) || (b.el.matches('.sheet-x') && a.el.matches('.sheet > h2:first-child'))) {
      const h = a.el.matches('h2') ? a.el : b.el; const x = a.el.matches('h2') ? b.el : a.el; const rg = document.createRange(); rg.selectNodeContents(h); const t = rg.getBoundingClientRect(); const xr = x.getBoundingClientRect();
      if (t.left >= xr.right - 1 || t.right <= xr.left + 1) continue; // the title text itself is clear of the ✕
    }
    // scrolled content that is behind the sheet's sticky title (it has its own background) is hidden, not under the ✕
    const xEl = a.el.matches('.sheet-x') ? a : b.el.matches('.sheet-x') ? b : null;
    if (xEl) { const other = xEl === a ? b : a; const h2 = document.querySelector('.sheet > h2:first-child'); if (h2 && !h2.contains(other.el)) { const hr = h2.getBoundingClientRect(); const top = Math.max(xEl.r.top, other.r.top), bot = Math.min(xEl.r.bottom, other.r.bottom); if (bot <= hr.bottom + 1 && top >= hr.top - 1) continue; } }
    const fa = fixedRoot(a.el), fb = fixedRoot(b.el);
    if (fa !== fb) {
      // content passing under the header or the bottom bars is scrolling, not a bug — unless it can't scroll out of there:
      // under the header at the top of the page, under the bottom bars at the end of the page
      const f = [fa, fb].find((x) => x && getComputedStyle(x).position === 'sticky') || fa || fb; const fr = f.getBoundingClientRect(); const sh = f.closest?.('.sheet'); const atTop = sh && getComputedStyle(f).position === 'sticky' ? f.matches('h2') : fr.top < innerHeight / 2;
      if (sh && getComputedStyle(f).position === 'sticky') { const scrolled = sh.scrollTop > 2, end = sh.scrollTop + sh.clientHeight >= sh.scrollHeight - 2; if (atTop ? scrolled : !end) continue; }
      const floating = fr.width < innerWidth * 0.6; // a round + over the content, not a full-width bar: it covers text at rest too
      if (!floating && (atTop ? (pos !== 'top' || scrollY > 5) : pos !== 'bottom')) continue;
    }
    out.push({ kind: 'overlap', a: name(a.el), b: name(b.el), px: `${Math.round(w)}×${Math.round(h)}`, fixed: fa !== fb });
  }
  for (const { el, r } of els) {
    if (r.right > innerWidth + 1 || r.left < -1) out.push({ kind: 'edge', a: name(el), px: `${Math.round(r.left)}..${Math.round(r.right)} / ${innerWidth}` });
    if ((el.tagName === 'BUTTON' || el.tagName === 'A' || el.matches('.chip, .vd, .cat')) && el.scrollWidth > el.clientWidth + 2) out.push({ kind: 'clipped', a: name(el), px: `${el.scrollWidth}>${el.clientWidth}` });
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) { const w = [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 || e.getBoundingClientRect().left < -1).filter((e, _, all) => !all.some((o) => o !== e && e.contains(o)))[0]; out.push({ kind: 'sideways', a: w ? name(w) : 'page', px: `${document.documentElement.scrollWidth}` }); }
  return out;
}

(async () => {
  const b = await chromium.launch();
  const found = new Map();
  // the audit must catch what it's for: an empty house (the + over the empty-inventory text) and a planted overlap
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }); await ctx.addInitScript(() => { new MutationObserver(() => document.querySelectorAll('details.fold:not([data-t])').forEach((d) => { d.dataset.t = 1; d.open = true; })).observe(document, { childList: true, subtree: true }); });
    const p = await ctx.newPage();
    d1(`INSERT OR REPLACE INTO pairing_codes (code, user_id, expires) VALUES ('777001', 2, 9999999999999)`);
    await p.goto(BASE + '/'); await p.fill('#code', '777001'); await p.click('#pair button[type=submit]'); await p.waitForSelector('#say');
    await p.evaluate(() => { location.hash = '#inventory'; }); await p.waitForTimeout(500);
    const empty = await p.evaluate(audit, 'top');
    console.log('EMPTY HOUSE:', empty.map((x) => `${x.kind} ${x.a} ⟷ ${x.b || ''} [${x.px}]`).join('\n  ') || 'nothing');
    await p.screenshot({ path: '/tmp/shuki-test/ov-empty-inventory.png' });
    await p.evaluate(() => { const b = document.createElement('button'); b.textContent = 'PLANTED'; b.style.cssText = 'position:absolute;top:150px;right:30px;width:200px'; document.querySelector('#main').append(b); });
    const planted = await p.evaluate(audit, 'top');
    const caught = planted.some((x) => /PLANTED/.test(x.a + x.b)); console.log('PLANTED CAUGHT:', caught);
    if (!caught) process.exitCode = 1; // question 51: an audit that can't see fails
    await ctx.close();
  }
  const SIZES = [[320, 454], [375, 548], [390, 664], [402, 690], [430, 740], [375, 667], [402, 874]]; // Safari (bars take ~170pt) and home screen
  for (const [width, height] of SIZES) {
    const ctx = await b.newContext({ viewport: { width, height }, serviceWorkers: 'block', hasTouch: true }); await ctx.addInitScript(() => { new MutationObserver(() => document.querySelectorAll('details.fold:not([data-t])').forEach((d) => { d.dataset.t = 1; d.open = true; })).observe(document, { childList: true, subtree: true }); });
    // BIGTEXT=23: the iPhone's biggest text size outside the accessibility sizes (the page's text follows it)
    if (process.env.BIGTEXT) await ctx.addInitScript((px) => document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = `html { font-size: ${px}px !important }`; document.head.append(st); }), +process.env.BIGTEXT);
    const p = await ctx.newPage();
    await p.goto(BASE + '/');
    if (await p.$('#code')) {
      // pairing codes are single-use in this DB; re-seed one per width
      d1(`INSERT OR REPLACE INTO pairing_codes (code, user_id, expires) VALUES ('${width}${height}', 1, 9999999999999)`);
      d1(`INSERT OR REPLACE INTO settings (key, value) VALUES ('shop_produce', 'both'), ('shop_care', 'both')`); // home18 (5): the greengrocer's and pharmacy's tabs are there (else hidden)
      await p.fill('#code', `${width}${height}`); await p.click('#pair button[type=submit]'); await p.waitForSelector('.nav a.on'); // mid-shopping it opens on the list
    }
    const api = (m, u, bd) => p.evaluate(async ([m, u, bd]) => (await fetch(u, { method: m, headers: { 'content-type': 'application/json', authorization: `Bearer ${JSON.parse(localStorage.getItem('shuki.token'))}` }, body: bd ? JSON.stringify(bd) : undefined })).json(), [m, u, bd]);
    if (width === 320) {
      d1(`INSERT INTO events (ts, user_id, type, summary) SELECT ${Date.now()}, 1, 'edit', 'x' FROM (WITH RECURSIVE c(k) AS (SELECT 1 UNION ALL SELECT k+1 FROM c WHERE k < 700) SELECT k FROM c)`); // level 16 (21 levels since stage 10): most of the closet open
      await p.evaluate(() => { location.hash = '#inventory'; }); await p.waitForTimeout(400);
      for (const pos of ['top', 'bottom']) { await p.evaluate((x) => window.scrollTo(0, x === 'top' ? 0 : 1e6), pos); for (const x of await p.evaluate(audit, pos)) found.set(`empty inventory | ${x.kind} | ${x.a} ⟷ ${x.b || ''}`, { widths: [`${width}×${height}`], px: x.px }); }
      await api('POST', '/api/actions', { actions: [
        { kind: 'create', product: { name: 'טונה', count_type: 'units', unit: 'קופסה', qty: 4, is_basic: 1, target: 2, location_id: 'מזווה' } },
        { kind: 'create', product: { name: 'חטיף אנרגיה בטעם שוקולד מריר ואגוזי לוז מיובאים מאיטליה', count_type: 'units', unit: 'חבילה', qty: 3, location_id: 'ארון מטבח' } },
        { kind: 'create', product: { name: 'ביצים L', count_type: 'pack', pack_size: 12, qty: 0, is_basic: 1, target: 12, location_id: 'מקרר', shelf_days: 21 } },
        { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 2, shelf_days: 7, open_days: 4, is_basic: 1, target: 2, location_id: 'מקרר' } },
        { kind: 'create', product: { name: 'עגבניות', count_type: 'level', level: 'little', is_basic: 1, location_id: 'מקרר', store: 'greengrocer', store2: 'super' } },
        { kind: 'create', product: { name: 'סבון כלים', count_type: 'inuse', is_open: 1, qty: 0, is_basic: 1, target: 1, location_id: 'ארון ניקיון' } },
        { kind: 'create', product: { name: 'עוף טרי', count_type: 'batches', qty: 2, shelf_days: 2, location_id: 'מקפיא' } },
      ] });
      await api('POST', '/api/actions', { actions: [{ kind: 'list_add', text: 'נייר אפייה עם שם ארוך במיוחד לבדיקה של שבירת שורות' }] });
      await api('POST', '/api/maybe', { text: 'מכונת קפה' });
      d1(`UPDATE maybe SET added = added - ${49 * 3600e3} WHERE id = (SELECT MIN(id) FROM maybe)`);
      await api('POST', '/api/maybe', { text: 'כיסא בר' });
    }
    const ids = await api('GET', '/api/state').then((s) => s.products.filter((x) => !x.out).slice(0, 4).map((x) => x.id));
    if (width === 320) {
      // real small JPEGs on two products, and milk past its date
      const all = (await api('GET', '/api/state')).products;
      for (const n of ['טונה', 'חטיף אנרגיה בטעם שוקולד מריר ואגוזי לוז מיובאים מאיטליה', 'ביצים L']) {
        const data = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#fd2'; g.fillRect(16, 8, 32, 48); return c.toDataURL('image/jpeg', .7).split(',')[1]; });
        await api('POST', `/api/photo/${all.find((x) => x.name === n).id}`, { data });
      }
      d1(`UPDATE products SET expires = ${Date.now() - 864e5} WHERE name = 'חלב 3%'`);
    }
    d1(`INSERT OR REPLACE INTO settings (key, value) VALUES ('recount_at', '${Date.now() - 1000}'), ('recount_ids', '${JSON.stringify(ids)}')`);
    const go = async (h) => { await p.evaluate((x) => { location.hash = x; }, h); await p.waitForTimeout(350); };
    const run = async (state) => {
      for (const pos of ['top', 'bottom']) {
        await p.evaluate((x) => { const sh = document.querySelector('.sheet'); if (sh) sh.scrollTop = x === 'top' ? 0 : 1e6; window.scrollTo(0, x === 'top' ? 0 : 1e6); }, pos);
        await p.waitForTimeout(250);
        const probs = await p.evaluate(audit, pos);
        for (const x of probs) {
          const key = `${state} | ${x.kind} | ${x.a}${x.b ? ' ⟷ ' + x.b : ''}`;
          if (!found.has(key)) { found.set(key, { widths: [], px: x.px, fixed: x.fixed }); await p.screenshot({ path: `/tmp/shuki-test/ov-${found.size}.png` }); }
          const f = found.get(key); const tag = `${width}×${height}${pos === 'bottom' ? '↓' : ''}`; if (!f.widths.includes(tag)) f.widths.push(tag);
        }
      }
    };
    await p.reload(); await p.waitForTimeout(900);
    await go('#chat'); await run('chat + recount + expired');
    await p.setInputFiles('#photo', { name: 'x.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('/9j/4AAQ', 'base64') }).catch(() => {}); await p.waitForTimeout(300); await run('camera: receipt or product'); await p.click('.sheet [data-close]').catch(() => {});
    await p.fill('#say', 'מתחילים מהמקרר, הכל קבוע'); await p.click('#send'); await p.waitForSelector('.coupon.pending', { timeout: 8000 }).catch(() => {});
    await run('chat + coupon');
    await p.click('.rq [data-rc-fix]').catch(() => {}); await p.waitForTimeout(300); await run('count sheet'); await p.click('.sheet [data-close]').catch(() => {});
    await go('#list'); await run('list');
    const mo = await p.$('[data-more]'); if (mo) { await mo.click(); await p.waitForTimeout(300); await run('list line menu'); await p.click('.sheet [data-close]').catch(() => {}); }
    const oneoff = await p.$('.itemw:has(.oneoff) [data-more]'); if (oneoff) { await oneoff.click(); await p.waitForTimeout(300); await run('one-off menu'); await p.click('.sheet [data-close]').catch(() => {}); }
    await p.fill('#addTxt', 'טונ'); await p.waitForTimeout(200); await run('list + suggestions');
    await p.click('.chip[data-add]').catch(() => {}); await p.waitForTimeout(300); await run('warn sheet'); await p.click('#w-no').catch(() => {});
    if (!(await p.$('.trip.mine'))) await p.click('#tripGo').catch(() => {});
    await p.waitForSelector('#haveQ').catch(() => {});
    await p.fill('#haveQ', 'ט').catch(() => {}); await p.waitForTimeout(200); await run('shopping + יש לנו');
    await p.fill('#haveQ', 'אננס').catch(() => {}); await run('shopping + לא רשום'); await p.fill('#haveQ', '').catch(() => {});
    const eg = await p.$('.item:not(.done):has-text("ביצים")'); if (eg) { await eg.click(); await p.waitForTimeout(300); await run('qty sheet pack'); await p.click('.sheet [data-close]').catch(() => {}); }
    const it = await p.$('.item:not(.done)[data-item]'); if (it) { await it.click(); await p.waitForTimeout(300); await run('qty sheet'); if (await p.$('#ok')) await p.click('#ok'); await p.waitForTimeout(700); }
    await run('list in cart');
    if (await p.$('#finish')) { await p.click('#finish'); await p.waitForSelector('.receipt').catch(() => {}); await run('receipt'); await p.click('.sheet [data-close]').catch(() => {}); }
    await p.click('.flap[data-store=greengrocer]').catch(() => {}); await p.waitForTimeout(300); await run('list ירקן');
    await p.click('.flap[data-store=pharm]').catch(() => {}); await p.waitForTimeout(300); await run('list empty store');
    await p.click('.flap[data-store=super]').catch(() => {});
    await go('#inventory'); await run('inventory');
    await p.fill('#invQ', 'אין כזה'); await p.waitForTimeout(300); await run('inventory search empty'); await p.fill('#invQ', ''); await p.waitForTimeout(300);
    for (const n of ['חלב 3%', 'עגבניות', 'סבון כלים', 'ביצים L', 'עוף טרי']) { await p.click(`.fr:has-text("${n}")`).catch(() => {}); await p.waitForTimeout(300); await run(`product sheet ${n}`); await p.click('.sheet [data-close]').catch(() => {}); }
    await p.click('.fr:has-text("טונה")').catch(() => {}); await p.waitForTimeout(500); await run('product sheet with photo'); await p.click('.sheet [data-close]').catch(() => {});
    await p.click('#addP'); await p.waitForTimeout(300); await run('new product sheet');
    await p.fill('#f-name', 'טונה').catch(() => {}); await p.click('#save').catch(() => {}); await p.waitForTimeout(200); await run('new product twin name'); await p.click('.sheet [data-close]').catch(() => {});
    await go('#settings'); await run('settings');
    await p.click('#closetGo').catch(() => {}); await p.waitForSelector('.closet-prev').catch(() => {}); await run('closet'); await p.click('.sheet [data-close]').catch(() => {});
    await p.waitForTimeout(600); await run('settings + devices');
    await p.click('[data-code]').catch(() => {}); await p.waitForTimeout(500); await run('settings + pairing code');
    await p.click('#mkKey').catch(() => {}); await p.waitForTimeout(500); await run('settings + siri key');
    await p.fill('#awayUntil', new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10)).catch(() => {}); await run('settings + away date');
    await ctx.close();
  }
  await b.close();
  const rows = [...found.entries()];
  console.log(rows.length ? rows.map(([k, v]) => `${k}  [${v.px}] @ ${v.widths.join(',')}${v.fixed ? '  (fixed/flow)' : ''}`).join('\n') : 'no problems');
  console.log(`\n${rows.length} distinct problems`);
  if (rows.length) process.exitCode = 1; // question 51 (stage 5): a problem fails the run
})().catch((e) => { console.error(e); process.exit(1); });
