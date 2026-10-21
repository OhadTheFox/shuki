// Stage 11 (docs/stage11-plan.md, i5): the recipes screen with 253 recipes, in the measure house's catalog (its 40 products,
// a kosher house). The recipes go in through tools/import-recipes.mjs, as they will in stage 12.
// Run under tools/runall.sh (UIS="test/stage11-ui.cjs", also "test/stage11-ui.cjs@webkit"). The recipes are invented ("מתכון 1"…).
//   S11_RECIPES=<file>: someone's real file instead, for the numbers only (S11-U1–U3, S11-U9): nothing about the recipes
//   themselves is printed or kept, and no picture is taken (the owner 15/10, question 10).
//   S11_SHOTS=<dir>: the pictures (390×844) into that folder.
const browser = require(process.env.PW)[process.env.PW_BROWSER || 'chromium'];
const { execFileSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const zlib = require('node:zlib');
const { BASE, check, ok, phone, finish, d1, d1q } = require('./sweep-lib.cjs');

const REAL = process.env.S11_RECIPES || null;
const SHOTS = REAL ? null : process.env.S11_SHOTS || null;
const nums = {}; // what is measured, printed at the end

// the invented 253: categories from the approved list and the five a house may add, 28 with no steps, 228 with no "for how
// many", 21 that don't fit a kosher house (9 meat with milk, 7 pork, 5 seafood), TikTok links but one
function invented() {
  const { CATEGORIES } = { CATEGORIES: ['ארוחות בוקר', "בראנץ'", 'ארוחות ערב', 'אוכל ביתי', 'ישראלי', 'מזרחי', 'אסייתי', 'סיני', 'יפני', 'תאילנדי', 'הודי', 'קארי', 'נודלס', 'מרקים אסייתים', 'כיסונים', 'סושי', 'איטלקי', 'פסטה', 'פיצה', 'אמריקאי', 'המבורגר', 'מקסיקני', 'אירופאי', 'ברביקיו', 'קבב', 'עוף', 'דגים', 'מאכלי ים', 'חומוס', 'פלאפל', "סנדוויץ'", 'סלט', 'מרקים', 'בולז', 'טבעוני', 'צמחוני', 'אוכל בריא', 'ללא גלוטן', 'כשר', 'קינוחים'] };
  const CATS = [...CATEGORIES, 'רטבים', 'אוכל גבוה', 'ביצים', 'יווני', 'קוקטיילים']; // 45
  const ING = ['ביצים', 'בצל', 'שום', 'עגבניות', 'פלפל אדום', 'מלפפון', 'גזר', 'תפוחי אדמה', 'קמח', 'סוכר', 'מלח', 'שמן זית', 'חלב 3%', 'גבינה צהובה', "קוטג'", 'אורז', 'פסטה', 'לימון', 'פטרוזיליה', 'כוסברה', 'כמון', 'פפריקה', 'רסק עגבניות', 'טחינה גולמית', 'חומוס', 'עדשים', 'קישוא', 'חציל', 'שעועית ירוקה', 'טונה']; // no meat here: only 1–9 are meat with milk
  const Q = [[2, null], [1, 'כף'], [0.25, 'כפית'], [1 / 3, 'כוס'], [200, 'גרם'], [null, null], [0.5, 'כוס'], [3, 'שן'], [1, 'כוס'], [1, 'גרם']];
  return Array.from({ length: 253 }, (_, k) => {
    const n = k + 1;
    const ings = Array.from({ length: 6 + (n % 9) }, (_, j) => { const [qty, unit] = Q[(n + j) % Q.length]; return { qty, unit, name: ING[(n * 7 + j * 3) % ING.length] }; })
      .filter((x, j, a) => a.findIndex((y) => y.name === x.name) === j);
    if (n <= 9) ings.push({ qty: 500, unit: 'גרם', name: 'בשר טחון' }, { qty: 50, unit: 'גרם', name: 'חמאה' });
    else if (n <= 16) ings.push({ qty: 100, unit: 'גרם', name: 'בייקון' });
    else if (n <= 21) ings.push({ qty: 300, unit: 'גרם', name: 'שרימפס' });
    if (n === 30) ings.unshift({ qty: 0.25, unit: 'כפית', name: 'מלח' });
    const tags = [CATS[k % CATS.length], ...(n % 3 ? [CATS[(k * 7 + 3) % CATS.length]] : [])].filter((c, j, a) => a.indexOf(c) === j).join(', ');
    return {
      name: `מתכון ${n}`, ings, tags,
      text: n % 9 === 0 && n <= 252 ? '' : 'מכינים את המצרכים.\nמבשלים 20 דקות.\nמגישים.',
      serves: n % 9 === 1 ? 4 : null,
      url: n === 253 ? 'https://example.com/recipe-253' : `https://www.tiktok.com/@shuki.test/video/7${String(n).padStart(18, '0')}`,
    };
  });
}

(async () => {
  const b = await browser.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
  // the measure house's catalog and notes (test/measure-house.mjs): its 40 products, "הכל כשר"
  const sqlFile = '/tmp/shuki-test/s11-ui-house.sql';
  execFileSync('node', ['test/measure-house.mjs', sqlFile], { stdio: 'ignore' });
  const products = fs.readFileSync(sqlFile, 'utf8').split('\n').filter((l) => l.startsWith('INSERT INTO products '));
  fs.writeFileSync(sqlFile, `${products.join('\n')}\nINSERT OR REPLACE INTO settings (key, value) VALUES ('house_notes', 'הכל כשר. מיכל צמחונית ואוכלת דגים.');\n`);
  execSync(`npx wrangler d1 execute shuki --local --persist-to /tmp/shuki-test/shuki-uiqa --file ${sqlFile}`, { stdio: 'ignore' });

  const p = await phone(b, { w: 390, h: 844 }); // Avi, the admin
  const token = await p.evaluate(() => JSON.parse(localStorage.getItem('shuki.token')));
  const file = REAL || '/tmp/shuki-test/s11-ui-recipes.json';
  if (!REAL) fs.writeFileSync(file, JSON.stringify(invented()));
  const N = JSON.parse(fs.readFileSync(file, 'utf8')).length;
  // the import, as in stage 12; its report (names) is not printed here
  // its report has names: never printed, not even when it fails (only the exit code); and this house's progress file goes
  let rep = '';
  try { rep = execFileSync('node', ['tools/import-recipes.mjs', file, '--fresh', '--delay=0'], { env: { ...process.env, SHUKI_URL: BASE, SHUKI_TOKEN: token }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { console.log(`✗ the import stopped, rc=${e.status}`); }
  finally { const u = new URL(BASE); fs.rmSync(`${file}.progress-${u.hostname}-${u.port}.json`, { force: true }); }
  const inN = Number(/^נכנסו: (\d+)/m.exec(rep)?.[1]);
  nums.imported = inN;
  await p.reload2();
  await check('S11-U0', 'the house: the measure house\'s 40 products and its kosher notes', async () => {
    const st = await p.state();
    ok(st.products.length === 40, `${st.products.length} products`);
    ok(/כשר/.test(d1q("SELECT value FROM settings WHERE key = 'house_notes'")[0]?.value || ''), 'no notes');
  });

  await check('S11-U1', `the recipes tab opens with all ${REAL ? 'of the file' : '253'}`, async () => {
    const r = await p.evaluate(async () => {
      const t0 = performance.now(); location.hash = '#recipes';
      for (;;) { await new Promise((x) => requestAnimationFrame(x)); const n = document.querySelectorAll('.rcard').length; if (n > 0 && performance.now() - t0 > 50) return { ms: Math.round(performance.now() - t0), n }; if (performance.now() - t0 > 20000) return { ms: -1, n }; }
    });
    nums.U1_open_ms = r.ms; nums.U1_cards = r.n;
    ok(r.n === inN, `${r.n} cards, ${inN} imported`);
    return `${r.ms}ms, ${r.n} cards`;
  });

  await check('S11-U2', 'scrolling to the end in 10 steps: the longest frame', async () => {
    const r = await p.evaluate(async () => {
      const el = [document.scrollingElement, document.querySelector('#main')].find((e) => e && e.scrollHeight > e.clientHeight + 10);
      const total = el.scrollHeight - el.clientHeight; let worst = 0;
      for (let k = 1; k <= 10; k++) { const t = performance.now(); el.scrollTop = (total * k) / 10; await new Promise((x) => requestAnimationFrame(() => requestAnimationFrame(x))); worst = Math.max(worst, performance.now() - t); }
      el.scrollTop = 0; return { worst: Math.round(worst), total };
    });
    nums.U2_longest_frame_ms = r.worst; nums.U2_height_px = r.total;
    return `${r.worst}ms, ${r.total}px`;
  });

  await check('S11-U3', 'search, letter by letter: the time of each (the whole list is drawn again)', async () => {
    const word = REAL ? 'עגבני' : 'עגבני';
    const r = await p.evaluate(async (word) => {
      const times = [];
      for (let k = 1; k <= word.length; k++) {
        const q = document.querySelector('#recQ'); q.value = word.slice(0, k);
        const t = performance.now(); q.dispatchEvent(new Event('input')); times.push(Math.round(performance.now() - t));
        await new Promise((x) => requestAnimationFrame(x));
      }
      const found = document.querySelectorAll('.rcard').length;
      const q = document.querySelector('#recQ'); q.value = ''; q.dispatchEvent(new Event('input'));
      return { times, found };
    }, word);
    nums.U3_ms_per_letter = r.times; nums.U3_results = r.found;
    return `${r.times.join(', ')}ms; ${r.found} found`;
  });

  await check('S11-U9', 'the state: its size, how long it takes, and saving it on the phone', async () => {
    const r = await p.evaluate(async (t) => {
      const t0 = performance.now(); const res = await fetch('/api/state', { headers: { authorization: `Bearer ${t}`, 'x-levels': '21' } }); const text = await res.text(); const t1 = performance.now();
      const t2 = performance.now(); const s = JSON.parse(text); const t3 = performance.now();
      const t4 = performance.now(); localStorage.setItem('shuki.s11probe', JSON.stringify(s)); const t5 = performance.now(); localStorage.removeItem('shuki.s11probe');
      const recipes = new TextEncoder().encode(JSON.stringify(s.recipes || [])).length;
      return { text, fetchMs: Math.round(t1 - t0), parseMs: Math.round(t3 - t2), storeMs: Math.round(t5 - t4), recipes };
    }, token);
    const bytes = Buffer.byteLength(r.text), gz = zlib.gzipSync(r.text).length;
    Object.assign(nums, { U9_state_bytes: bytes, U9_state_gzip: gz, U9_recipes_bytes: r.recipes, U9_fetch_ms: r.fetchMs, U9_parse_ms: r.parseMs, U9_localStorage_ms: r.storeMs });
    return `${Math.round(bytes / 1024)}KB (${Math.round(gz / 1024)}KB gzip; recipes ${Math.round(r.recipes / 1024)}KB), fetch ${r.fetchMs}ms, parse ${r.parseMs}ms, localStorage ${r.storeMs}ms`;
  });

  if (!REAL) {
    const card = (name) => p.locator('.rcard', { has: p.locator('.rname', { hasText: new RegExp(`^${name}$`) }) });
    const open = async (name) => { await card(name).click(); await p.waitForSelector('[data-recipe]'); };
    const close = async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(300); if (await p.$('[data-recipe]')) await p.evaluate(() => document.querySelector('.scrim')?.click()); await p.waitForTimeout(300); };

    await check('S11-U4', 'the categories bar: "אפשר להכין עכשיו" and the 45 categories, the house\'s five last', async () => {
      const chips = await p.$$eval('.rfilters .chip', (xs) => xs.map((x) => x.textContent.trim()));
      ok(chips.length === 46, `${chips.length}`);
      ok(chips[0] === 'אפשר להכין עכשיו', chips[0]);
      ok(JSON.stringify(chips.slice(-5).sort()) === JSON.stringify(['אוכל גבוה', 'ביצים', 'יווני', 'קוקטיילים', 'רטבים'].sort()), chips.slice(-5).join(', '));
      // the house's five, at the end of the bar (right to left: the end is the most negative scrollLeft)
      if (SHOTS) { await p.evaluate(() => { const r = document.querySelector('.rfilters'); r.scrollLeft = -(r.scrollWidth - r.clientWidth); }); await p.waitForTimeout(200); await p.screenshot({ path: `${SHOTS}/S11-U4-bar.png` }); await p.evaluate(() => { document.querySelector('.rfilters').scrollLeft = 0; }); }
      return `${chips.length}`;
    });

    await check('S11-U5', '"אפשר להכין עכשיו": what has everything at home, or the words for none', async () => {
      await p.click('.rfilters .chip >> nth=0'); await p.waitForTimeout(300);
      const n = await p.$$eval('.rcard', (xs) => xs.length);
      const empty = await p.textContent('.rlist');
      nums.U5_now = n;
      ok(n > 0 || /אין מתכון שיש בשבילו את כל המוצרים בבית/.test(empty), empty.slice(0, 80));
      await p.click('.rfilters .chip >> nth=0'); await p.waitForTimeout(300);
      return `${n}`;
    });

    await check('S11-U6', 'a recipe with no steps and no "for how many": no "מצב בישול", no "אופן ההכנה", no "כמה אנשים?"', async () => {
      await open('מתכון 9');
      ok(!(await p.$('#rCook')) && !(await p.$('.rbox.steps')) && !(await p.$('.people')), 'something is there');
      ok(await p.$('#rMade'), 'no "הכנו את זה"');
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/S11-U6-no-steps.png` });
      await close();
    });

    await check('S11-U7', '"למתכון המקורי" goes to TikTok, in a new tab', async () => {
      await open('מתכון 10');
      const a = await p.$eval('a.rfrom', (x) => ({ href: x.href, target: x.target, text: x.textContent.trim() }));
      ok(a.href.startsWith('https://www.tiktok.com/') && a.target === '_blank' && a.text === 'למתכון המקורי', JSON.stringify(a));
      await close();
    });

    await check('S11-U8', 'a kosher house: "שימו לב" on the card of meat with milk, and the line on its page', async () => {
      ok(await card('מתכון 1').locator('.rwarn').count() === 1, 'no "שימו לב" on the card');
      await open('מתכון 1');
      const lines = await p.$$eval('.rwarnline', (xs) => xs.map((x) => x.textContent.trim()));
      ok(lines.includes('שימו לב: יש במתכון ערבוב של בשר וחלב'), lines.join(' | '));
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/S11-U8-kosher.png` });
      await close();
      const k = (await p.state()).recipes.filter((x) => x.kosher);
      ok(k.length === 21, `${k.length} with a kosher note`);
    });

    await check('S11-U10', 'question 5: "מתכון מטיקטוק" for a TikTok link, "מתכון מאתר" for any other', async () => {
      ok((await card('מתכון 10').locator('.rfrom').textContent()).trim() === 'מתכון מטיקטוק', 'TikTok');
      ok((await card('מתכון 253').locator('.rfrom').textContent()).trim() === 'מתכון מאתר', 'another site');
    });

    await check('S11-U11', 'question 4: "רבע כפית מלח" on the page, not "0.25"', async () => {
      await open('מתכון 30');
      const ings = await p.$$eval('.ings li', (xs) => xs.map((x) => x.textContent.replace(/^[✓✗]\s*/, '').trim()));
      ok(ings.some((x) => x.startsWith('רבע כפית מלח')), ings.join(' | '));
      ok(!ings.some((x) => /\b0\.\d/.test(x)), ings.join(' | '));
      await close();
    });

    if (SHOTS) {
      await p.evaluate(() => (document.scrollingElement.scrollTop = 0));
      await p.screenshot({ path: `${SHOTS}/S11-U1-list.png` });
    }
  }
  console.log(`S11 numbers: ${JSON.stringify(nums)}`);
  ok(!p.errors.length, p.errors.join(' | '));
  await finish(b, 'test/stage11-ui-results.json');
})();
