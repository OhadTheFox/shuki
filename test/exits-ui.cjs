// Every window (sheet) has a way out and its main button is on screen. 9 windows × 3 phone sizes.
// Run: test/ui-qa.sh test/exits-ui.cjs
const { chromium } = require(process.env.PW);
const { execSync } = require('node:child_process');
const BASE = 'http://127.0.0.1:8791';
const S = '/tmp/shuki-test/shuki-uiqa';
const d1 = (sql) => execSync(`npx wrangler d1 execute shuki --local --persist-to ${S} --command "${sql.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
const results = [];
const check = async (id, name, fn) => {
  try { const note = await fn(); results.push({ id, name, ok: true, note: note || '' }); console.log('✓', id, name, note ? `— ${note}` : ''); }
  catch (e) { results.push({ id, name, ok: false, error: e.message.split('\n')[0] }); console.log('✗', id, name, '\n   ', e.message.split('\n')[0]); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };
(async () => {
  const b = await chromium.launch();
  const SIZES = [[375, 667, 'SE מסך הבית'], [402, 874, '17 מסך הבית'], [320, 568, 'צר']];
  let first = true;
  for (const [w, h, label] of SIZES) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block', hasTouch: true });
    const p = await ctx.newPage(); const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    d1(`INSERT OR REPLACE INTO pairing_codes (code, user_id, expires) VALUES ('${w}${h}', 1, 9999999999999)`);
    await p.goto(BASE + '/'); await p.fill('#code', `${w}${h}`); await p.click('#pair button[type=submit]'); await p.waitForSelector('#say');
    const api = (m, u, bd) => p.evaluate(async ([m, u, bd]) => (await fetch(u, { method: m, headers: { 'content-type': 'application/json', authorization: `Bearer ${JSON.parse(localStorage.getItem('shuki.token'))}` }, body: bd ? JSON.stringify(bd) : undefined })).json(), [m, u, bd]);
    if (first) {
      first = false;
      await api('POST', '/api/actions', { actions: [
        { kind: 'create', product: { name: 'חלב 3%', count_type: 'units', unit: 'קרטון', qty: 2, is_basic: 1, target: 2, shelf_days: 7, open_days: 4 } },
        { kind: 'create', product: { name: 'ביצים', count_type: 'pack', pack_size: 12, qty: 0, is_basic: 1, target: 12 } },
        { kind: 'create', product: { name: 'טבסקו אדום', count_type: 'units', qty: 1 } }, { kind: 'create', product: { name: 'טבסקו ירוק', count_type: 'units', qty: 1 } },
      ] });
      await api('POST', '/api/actions', { actions: [{ kind: 'list_add', text: 'נרות', store: 'super' }] });
      d1(`INSERT INTO events (ts, user_id, type, summary) SELECT ${Date.now()}, 1, 'edit', 'x' FROM (WITH RECURSIVE c(k) AS (SELECT 1 UNION ALL SELECT k+1 FROM c WHERE k < 400) SELECT k FROM c)`);
    }
    const go = async (hash) => { await p.evaluate((x) => { location.hash = x; }, hash); await p.waitForTimeout(350); };
    await p.reload(); await p.waitForTimeout(800);
    // how to open each window
    const OPEN = {
      'ארון': async () => { await go('#settings'); await p.click('#closetGo'); },
      'מוצר חדש': async () => { await go('#inventory'); await p.click('#addP'); },
      'דף מוצר': async () => { await go('#inventory'); await p.click('.fr:has-text("חלב 3%")'); },
      'כמה קניתם': async () => { await go('#list'); const b = await p.waitForSelector('.item:has-text("ביצים")'); const x = await b.boundingBox(); await p.mouse.move(x.x + x.width / 2, x.y + x.height / 2); await p.mouse.down(); await p.waitForTimeout(750); await p.mouse.up(); }, // a long press (decision 171)
      '⋯ בשורה': async () => { await go('#list'); await p.click('[data-more]'); },
      'איזה?': async () => { await go('#list'); await p.fill('#addTxt', 'טבסקו'); await p.click('#adder button[type=submit]'); },
      'אזהרה בהוספה': async () => { await go('#list'); await p.fill('#addTxt', 'טבסקו אדום'); await p.click('#adder button[type=submit]'); },
      'כמה יש (תקן)': async () => { await go('#list'); await p.click('[data-more]:near(.item:has-text("ביצים"))').catch(() => p.click('.itemw:has-text("ביצים") [data-more]')); await p.click('[data-m=have]'); },
      'מה בתמונה': async () => { await go('#chat'); await p.setInputFiles('#photo', { name: 'x.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('/9j/4AAQ', 'base64') }); },
    };
    for (const [name, open] of Object.entries(OPEN)) {
      await check(`${w}×${h}`, `${name} (${label})`, async () => {
        {
          await open(); await p.waitForSelector('.scrim .sheet', { timeout: 3000 });
        }
        await p.waitForTimeout(300);
        const r = await p.evaluate(() => {
          const hit = (el) => { if (!el) return 'missing'; const b = el.getBoundingClientRect(); if (b.bottom > innerHeight || b.top < 0 || b.right > innerWidth || b.left < 0) return `off screen ${Math.round(b.top)}..${Math.round(b.bottom)} of ${innerHeight}`; const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return t && (t === el || el.contains(t)) ? 'ok' : `covered by ${t?.className || t?.tagName}`; };
          const main = document.querySelector('.sheet .acts .go, .sheet #clSave');
          const sh = document.querySelector('.sheet');
          return { x: hit(document.querySelector('.sheet-x')), main: main ? hit(main) : 'none', sideways: sh.scrollWidth > sh.clientWidth + 1 };
        });
        ok(r.x === 'ok', `✕: ${r.x}`); ok(r.main === 'ok' || r.main === 'none', `main button: ${r.main}`); ok(!r.sideways, 'scrolls sideways');
        if (w === 402) await p.screenshot({ path: `/tmp/shuki-test/x-${name.replace(/[^א-תa-z]/g, '')}.png` });
        // three ways out
        await p.click('.sheet-x'); await p.waitForTimeout(150); ok(!(await p.$('.scrim')), '✕ did not close');
        await open(); await p.waitForSelector('.scrim'); await p.mouse.click(w / 2, 8); await p.waitForTimeout(150); ok(!(await p.$('.scrim')), 'tap outside did not close');
        await open(); await p.waitForSelector('.scrim'); await p.keyboard.press('Escape'); await p.waitForTimeout(150); ok(!(await p.$('.scrim')), 'Esc did not close');
        // the screen behind still works: a nav tab responds
        await p.click('.nav a[href="#inventory"]'); await p.waitForTimeout(200); ok(await p.$('#invQ'), 'app stuck after closing');
        return r.main === 'none' ? 'אין כפתור ראשי' : 'יציאה ✓ כפתור ראשי ✓';
      });
    }
    await check(`${w}×${h}`, `בלי שגיאות JS (${label})`, async () => ok(!errors.length, errors.join(' | ')));
    await ctx.close();
  }
  const n = results.filter((r) => r.ok).length;
  console.log(`\n${n}/${results.length} exit checks passed`);
  require('node:fs').writeFileSync('test/exits-ui-results.json', JSON.stringify(results, null, 1));
  await b.close(); process.exit(n === results.length ? 0 : 1);
})();
