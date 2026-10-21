// Stage 10 screens (docs/stage10-plan.md): Shuki's character in the app. Each check names its task.
// Run under tools/runall.sh (UIS="test/stage10-ui.cjs", also "test/stage10-ui.cjs@webkit").
const browser = require(process.env.PW)[process.env.PW_BROWSER || 'chromium'];
const lib = require('./sweep-lib.cjs');
const { check, ok, phone, finish, d1, d1q } = lib;
// points are days since 16/10 (worker/index.js xpOf): a day with an update, and one more on a day a trip was finished
const dayOf = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
const xpOf = (uid) => { const rows = d1q(`SELECT ts, type FROM events WHERE user_id = ${uid} AND undone IS NULL AND waste = 0 AND type NOT IN ('undo', 'delete', 'discard') AND source IS NULL`); return new Set(rows.map((r) => dayOf(r.ts))).size + new Set(rows.filter((r) => r.type === 'finish').map((r) => dayOf(r.ts))).size; };
// n more points: n updates on n days long ago, none of them a day already counted
let back = 1000;
const bulk = (uid, n) => { if (!(n > 0)) return; d1(`INSERT INTO events (id, ts, user_id, type, summary) SELECT -(${uid} * 100000 + ${back} + k), ${Date.now()} - (${back} + k) * 86400000, ${uid}, 'edit', 's10' FROM (WITH RECURSIVE c(k) AS (SELECT 1 UNION ALL SELECT k + 1 FROM c WHERE k < ${n}) SELECT k FROM c)`); back += n + 1; };
// today's updates moved to one day long ago, so the next update today is the one that adds a point
const notToday = (uid) => { d1(`UPDATE events SET ts = ts - 3000 * 86400000 WHERE user_id = ${uid} AND ts > ${Date.now() - 20 * 3600e3}`); };
(async () => {
  const b = await browser.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
  d1("INSERT OR REPLACE INTO users (id, name, gender, role, active, created) VALUES (3, 'יואבי', 'm', 'child', 1, 0)");
  const p = await phone(b, { w: 390, h: 844 }); // Avi, the admin
  const toast = () => p.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));

  // a Shuki of its own on the page, for what the app doesn't drive by itself: fn(mount, d, arg) runs in the page (no eval:
  // the app's CSP), with a fresh 200×200 box
  const solo = (fn, arg) => p.evaluate(async ([fn, arg]) => {
    const { mount } = await import('./shuki.js'); const { REACTIONS } = await import('./reactions.js'); // here, not in the helpers: WebKit can't import from an init script
    document.querySelector('#s10solo')?.remove();
    const d = document.createElement('div'); d.id = 's10solo'; d.style.cssText = 'position:fixed;top:0;left:0;width:200px;height:200px;z-index:9999'; document.body.append(d);
    return window[fn](mount, d, arg, REACTIONS);
  }, [fn, arg]);
  // the page's helpers, added before the app loads (addInitScript): each takes (mount, d, arg)
  await p.ctx.addInitScript(() => {
    const wait = (ms) => new Promise((x) => setTimeout(x, ms));
    window.s10_u1 = async (mount, d) => {
      const m = mount(d, 'sad'); const svg = d.firstElementChild;
      await wait(400);
      const tear = svg.querySelector('.fx-tear');
      const shown = [...svg.querySelectorAll('.fx > g')].filter((g) => getComputedStyle(g).opacity !== '0').map((g) => g.getAttribute('class'));
      m.react('sad', 3000, { fx: 'cry', move: 'droop' });
      await wait(400);
      const cry = getComputedStyle(svg.querySelector('.fx-cry')).opacity;
      m.destroy(); return { tear: !!tear, shown, cry };
    };
    window.s10_u8 = async (mount, d, arg, REACTIONS) => {
      const m = mount(d, 'ecstatic'); const svg = d.firstElementChild;
      const lasting = svg.classList.contains('afro-on');
      const moments = {};
      for (const n of ['shopDone', 'listEmpty', 'learned', 'settled', 'skipped', 'poke', 'allStocked', 'levelUp']) {
        const [mood, ms, fx, move] = REACTIONS[n]; m.react(mood, ms, { fx, move }); moments[n] = svg.classList.contains('afro-on');
      }
      m.react('laughing', 2600, { fx: 'afro' }); moments.run = svg.classList.contains('afro-on'); // celebrate(), as app.js plays it
      m.destroy();
      // the lasting full stock: no afro during a passing excited, and back after it (the reviewer of bebc689)
      const e = mount(d, 'ecstatic'); const es = d.firstElementChild;
      e.react('excited', 60); const during = es.classList.contains('afro-on');
      await new Promise((x) => setTimeout(x, 150)); const after = es.classList.contains('afro-on');
      e.destroy(); return { lasting, moments, during, after };
    };
    // t10: the medal a small pin on the side of the chest, the tie whole next to it (viewBox units)
    window.s10_u6 = async (mount, d) => {
      const m = mount(d, 'happy', { level: 21, wear: { chest: 'medal', neck: 'tie' } }); const svg = d.firstElementChild;
      const box = (sel) => svg.querySelector(sel).getBBox();
      const md = box('.acc-medal'), tie = box('.acc-tie');
      m.destroy(); return { cx: md.x + md.width / 2, w: md.width, tieRight: tie.x + tie.width };
    };
    // t9 and question 16: on the afro the hats go up and the band is above the hair; while strong the hat is off
    window.s10_u7 = async (mount, d) => {
      const out = {};
      for (const head of ['chef', 'crown', 'cap']) {
        const m = mount(d, 'happy', { level: 21, wear: { head } }); const svg = d.firstElementChild; const g = svg.querySelector(`.acc-${head}`);
        const top0 = g.getBoundingClientRect().top;
        m.react('laughing', 3200, { fx: 'confetti afro' }); await new Promise((x) => setTimeout(x, 700));
        out[head] = (top0 - g.getBoundingClientRect().top) / (d.getBoundingClientRect().height / 200); // in viewBox units
        m.destroy();
      }
      const m = mount(d, 'happy', { level: 21, wear: { head: 'band' } }); const svg = d.firstElementChild;
      out.upBefore = getComputedStyle(svg.querySelector('.acc-band-up')).display;
      m.react('laughing', 3200, { fx: 'afro' });
      out.band = getComputedStyle(svg.querySelector('.acc-band')).display; out.bandUp = getComputedStyle(svg.querySelector('.acc-band-up')).display;
      m.destroy();
      const s = mount(d, 'happy', { level: 21, wear: { head: 'crown' } }); const sv = d.firstElementChild;
      s.react('strong', 2600, { fx: 'sweat', move: 'jump' });
      out.strongCrown = getComputedStyle(sv.querySelector('.acc-crown')).display; out.strongBand = getComputedStyle(sv.querySelector('.acc-band')).display;
      await new Promise((x) => setTimeout(x, 2800));
      out.afterCrown = getComputedStyle(sv.querySelector('.acc-crown')).display; out.afterBand = getComputedStyle(sv.querySelector('.acc-band')).display;
      s.destroy(); return out;
    };
    // t5: random faces with short intervals (opts: tests only). Records each face that showed (data-funny and data-mood)
    window.s10_u9 = async (mount, d, { mood = 'happy', night = false, calm = false, ms = 6000, thinking = false } = {}) => {
      // the faces in a fixed order (funnyOrder), so what's seen doesn't depend on chance (the reviewer of 1ccb57c)
      const m = mount(d, mood, 1, { tick: [80, 160], funnyEvery: [300, 500], funnyOrder: ['yawn', 'hic', 'achoo', 'hum'] }); const svg = d.firstElementChild;
      m.setNight(night); m.setCalm(calm);
      const seen = new Set(), fx = new Set(), order = [];
      const ob = new MutationObserver(() => { if (['hic', 'achoo', 'yawn', 'hum'].includes(svg.dataset.mood)) { seen.add(svg.dataset.mood); if (order.at(-1) !== svg.dataset.mood) order.push(svg.dataset.mood); } for (const f of (svg.dataset.fx || '').split(' ')) if (f) fx.add(f); });
      ob.observe(svg, { attributes: true, attributeFilter: ['data-mood', 'data-fx'] });
      const think = thinking ? setInterval(() => m.react('neutral', 60000, { fx: 'dots' }), 1000) : 0;
      if (thinking) m.react('neutral', 60000, { fx: 'dots' });
      await new Promise((x) => setTimeout(x, ms));
      clearInterval(think); ob.disconnect(); m.destroy();
      return { seen: [...seen], fx: [...fx], order };
    };
    // t8: the lenses clear
    window.s10_u8b = async (mount, d) => { const m = mount(d, 'happy', { level: 21, wear: { eyes: 'shades' } }); const o = getComputedStyle(d.firstElementChild.querySelector('.acc-shades > g')).fillOpacity; m.destroy(); return o; };
  });
  await p.reload2();

  await check('S10-U1', 't2: עצוב בלי דמעה; הדמעות רק בבכי של "זרקנו" (cry)', async () => {
    const r = await solo('s10_u1');
    ok(!r.tear, 'fx-tear is still there'); ok(!r.shown.length, `shown while sad: ${r.shown}`); ok(r.cry === '1', `cry ${r.cry}`);
  });

  await check('S10-U5', 't6: אין קליטה: ישנוני, "שוקי. מצב הרוח שלי: ישנוני. אין קליטה", והכדור "אין קליטה"', async () => {
    await p.reload2(); await p.go('#chat');
    await p.ctx.setOffline(true); await p.evaluate(() => window.dispatchEvent(new Event('offline'))); await p.waitForTimeout(500);
    const svg = await p.evaluate(() => { const s = document.querySelector('.band .mascot svg'); return { mood: s.dataset.mood, label: s.getAttribute('aria-label') }; });
    const pill = await p.textContent('.band');
    await p.ctx.setOffline(false); await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(300);
    ok(svg.mood === 'sleepy', svg.mood); ok(svg.label === 'שוקי. מצב הרוח שלי: ישנוני. אין קליטה', svg.label); ok(pill.includes('אין קליטה'), 'the pill');
  });

  const band = (pg = p) => pg.evaluate(() => { const s = document.querySelector('.band .mascot svg'); const g = s.querySelector('.m-understanding'); return { mood: s.dataset.mood, label: s.getAttribute('aria-label'), face: g && getComputedStyle(g).opacity, fx: s.getAttribute('data-fx') || '' }; });
  const watchPop = (pg = p) => pg.evaluate(() => { window.s10pops = 0; new MutationObserver(() => { const sv = document.querySelector('.band .mascot svg'); if (sv.classList.contains('pop') && sv.dataset.mood === 'understanding') window.s10pops++; /* "thinking" pops, as always */ }).observe(document.querySelector('.band .mascot svg'), { attributes: true, attributeFilter: ['class'] }); });
  const send = async (pg, text) => { await pg.fill('#say', text); await pg.click('#send'); };

  await check('S10-U2', 't1: אחרי משפט מצוקה, "מבין" בלי pop ובלי אפקט, עם "שוקי. מצב הרוח שלי: מבין. אני כאן איתך."; נשאר אחרי רענון ובלי קליטה; נגמר בהודעה הבאה', async () => {
    await p.reload2(); await p.go('#chat'); await watchPop();
    await send(p, 'אני לא רוצה לחיות יותר'); await p.waitForTimeout(1500);
    let b1 = await band();
    ok(b1.mood === 'understanding' && b1.face === '1' && !b1.fx, JSON.stringify(b1));
    ok(b1.label === 'שוקי. מצב הרוח שלי: מבין. אני כאן איתך.', b1.label);
    ok(await p.evaluate(() => window.s10pops) === 0, `pop ${await p.evaluate(() => window.s10pops)}`);
    await p.reload2(); b1 = await band(); ok(b1.mood === 'understanding', `after a reload: ${b1.mood}`);
    await p.ctx.setOffline(true); await p.evaluate(() => window.dispatchEvent(new Event('offline'))); await p.waitForTimeout(400);
    b1 = await band(); ok(b1.mood === 'understanding' && /מבין\. אני כאן איתך\.$/.test(b1.label), `offline: ${JSON.stringify(b1)}`);
    await p.ctx.setOffline(false); await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(400);
    await p.go('#chat'); await send(p, 'תודה');
    await p.waitForTimeout(150); const waiting = await band(); ok(waiting.mood !== 'understanding', `while waiting: ${waiting.mood}`);
    await p.waitForTimeout(3500); b1 = await band(); ok(b1.mood !== 'understanding', `after the answer: ${b1.mood}`);
  });

  await check('S10-U3', 't1: ילד במצוקה: "מבין" אצלו; אבי שפותח את הלשונית של יואבי לא רואה "מבין"', async () => {
    const kid = await phone(b, { w: 390, h: 844, user: 3 });
    await kid.go('#chat'); await send(kid, 'אני רוצה להתאבד'); await kid.waitForTimeout(1500);
    const k = await band(kid); ok(k.mood === 'understanding', `the child: ${k.mood}`);
    await p.reload2(); await p.go('#chat');
    const tab = await p.$('.chattabs [data-tab="3"]'); ok(tab, 'no tab for Yoavi'); await tab.click(); await p.waitForTimeout(600);
    const a = await band(); ok(a.mood !== 'understanding', `the parent: ${a.mood}`);
    await kid.ctx.close();
  });

  await check('S10-U4', 't1, שאלה 4: ב"מבין" אין תנועות סרק (20 שניות), רק מצמוץ', async () => {
    await send(p, 'אני לא רוצה לחיות יותר'); await p.waitForTimeout(1500);
    ok((await band()).mood === 'understanding', 'not understanding');
    await p.evaluate(() => { window.s10moves = []; new MutationObserver(() => { for (const c of document.querySelector('.band .mascot svg').classList) if (/^i-/.test(c)) window.s10moves.push(c); }).observe(document.querySelector('.band .mascot svg'), { attributes: true, attributeFilter: ['class'] }); });
    await p.waitForTimeout(20000);
    const moves = await p.evaluate(() => window.s10moves);
    ok(!moves.length, `moves: ${moves}`);
    await send(p, 'תודה'); await p.waitForTimeout(2500);
  });

  await check('S10-U8', 't7: נגיעה: נלהב בלי אפרו; סיום קניות, רשימה ריקה, למד, מיפוי, ויתור: בלי אפרו; מלאי מלא, רצף, עלייה ברמה: עם אפרו; ecstatic של המודל: נלהב', async () => {
    const r = await solo('s10_u8');
    ok(r.lasting, 'the lasting full stock has no afro'); ok(!r.during && r.after, `a passing excited: during ${r.during}, after ${r.after}`);
    for (const [n, on] of Object.entries(r.moments)) ok(on === ['allStocked', 'levelUp', 'run'].includes(n), `${n}: afro ${on}`);
    await p.reload2(); await p.go('#chat'); await p.waitForTimeout(2600);
    await p.click('.band .mascot'); await p.waitForTimeout(500);
    let x = await p.evaluate(() => { const s = document.querySelector('.band .mascot svg'); return { mood: s.dataset.mood, afro: s.classList.contains('afro-on') }; });
    ok(x.mood === 'excited' && !x.afro, `poke ${JSON.stringify(x)}`);
    await p.waitForTimeout(2400);
    await p.route('**/api/chat', (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: 'יש!', face: 'ecstatic' }) }) : route.fallback()));
    await send(p, 'קניתי הכל!'); await p.waitForTimeout(900);
    x = await p.evaluate(() => { const s = document.querySelector('.band .mascot svg'); return { mood: s.dataset.mood, afro: s.classList.contains('afro-on') }; });
    await p.unroute('**/api/chat');
    ok(x.mood === 'excited' && !x.afro, `the model's ecstatic ${JSON.stringify(x)}`);
  });

  await check('S10-U6', 't10: מדליה קטנה בצד החזה (סיכה), והעניבה נראית לידה', async () => {
    const r = await solo('s10_u6');
    ok(r.cx > 120 && r.w < 20, JSON.stringify(r)); ok(r.tieRight < r.cx - 5, `the tie under the pin ${JSON.stringify(r)}`);
  });
  await check('S10-U7', 't9: על האפרו הכובעים עולים (שף, כתר, מצחייה) והסרט מעל השיער; שאלה 16: בזמן "שרירי" הכובע יורד, ואחרי זה חוזר', async () => {
    const r = await solo('s10_u7');
    for (const h of ['chef', 'crown', 'cap']) ok(r[h] >= 25, `${h} up by ${r[h]}`);
    ok(r.band === 'none' && r.bandUp === 'inline' && r.upBefore === 'none', `band ${r.band} / up ${r.bandUp} / up with no afro ${r.upBefore}`);
    ok(r.strongCrown === 'none' && r.strongBand === 'inline', `strong: crown ${r.strongCrown}, band ${r.strongBand}`);
    ok(r.afterCrown === 'inline' && r.afterBand === 'none', `after: crown ${r.afterCrown}, band ${r.afterBand}`);
  });
  await check('S10-U14', 't8: עדשות משקפי השמש שקופות', async () => {
    const o = await solo('s10_u8b'); ok(Number(o) < 0.5, `fill-opacity ${o}`);
  });

  await check('S10-U15', 't1 ו-t7 (הבודקים של 67f9002 ו-d149d4a): הבית מתמלא: "allStocked" (קונפטי ואפרו) פעם אחת; בית מלא ומצוקה: לא מעל "מבין", ולא כש"מבין" נגמר', async () => {
    const watch = () => p.evaluate(() => { window.s10stocked = 0; new MutationObserver(() => { const s = document.querySelector('.band .mascot svg'); if (/confetti afro/.test(s.getAttribute('data-fx') || '')) window.s10stocked++; }).observe(document.querySelector('.band .mascot svg'), { attributes: true, attributeFilter: ['data-fx'] }); });
    const stocked = () => p.evaluate(() => window.s10stocked);
    const op = (actions) => p.api('POST', '/api/actions', { op_id: `s10-${Date.now()}-${Math.random()}`, ts: Date.now(), by: 1, actions });
    await op([{ kind: 'create', product: { name: 'מלח', category_id: 'אחר', count_type: 'units', unit: 'שקית', qty: 0, is_basic: 1, target: 1 } }]);
    await p.reload2(); await p.go('#chat'); await p.waitForTimeout(800); await watch();
    ok((await p.state()).mood.mood !== 'ecstatic', 'the house is full already');
    const salt = (await p.state()).products.find((x) => x.name === 'מלח').id;
    await op([{ kind: 'edit', product_id: salt, fields: { qty: 3 } }]);
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(1500);
    ok((await p.state()).mood.mood === 'ecstatic', 'the house is not full');
    ok(await stocked() === 1, `allStocked when the house filled up: ${await stocked()}`);
    // a cold load (no state kept on the phone), watched from before the app runs (the reviewer of 66933fc)
    await p.ctx.addInitScript(() => { window.s10coldStocked = 0; new MutationObserver((ms) => { for (const m of ms) if (/confetti afro/.test(m.target.getAttribute?.('data-fx') || '')) window.s10coldStocked++; }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-fx'] }); });
    await p.evaluate(() => { localStorage.removeItem('shuki.state'); localStorage.removeItem('shuki.chat'); });
    await p.reload2(); await p.go('#chat'); await p.waitForTimeout(1500);
    ok(await p.evaluate(() => window.s10coldStocked) === 0, `on a cold load: ${await p.evaluate(() => window.s10coldStocked)}`);
    await watch();
    await send(p, 'אני לא רוצה לחיות יותר'); await p.waitForTimeout(1500);
    for (let i = 0; i < 4; i++) { await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(500); }
    ok(await stocked() === 0, `over "מבין": ${await stocked()}`);
    ok((await band()).mood === 'understanding', 'not understanding');
    await send(p, 'טוב'); await p.waitForTimeout(3500);
    ok((await band()).mood !== 'understanding', 'still understanding');
    ok(await stocked() === 0, `when "מבין" ends: ${await stocked()}`);
    d1("DELETE FROM products WHERE name = 'מלח'");
  });


  // a house time zone where it is now `hour` o'clock (Etc/GMT∓N), so the night is real time, with no fake clock
  const zoneAt = (hour) => { let k = (hour - new Date().getUTCHours() + 24) % 24; if (k > 14) k -= 24; return k === 0 ? 'Etc/GMT' : `Etc/GMT${k > 0 ? '-' : '+'}${Math.abs(k)}`; };
  const homeTz = () => d1("INSERT OR REPLACE INTO settings (key, value) VALUES ('tz', 'Asia/Jerusalem')");
  const houseTz = async (tz) => { d1(`INSERT OR REPLACE INTO settings (key, value) VALUES ('tz', '${tz}')`); d1('DELETE FROM chat'); await p.reload2(); await p.go('#chat'); await p.waitForTimeout(600); };
  const last = () => p.evaluate(() => document.body.dataset.lastReaction || '');

  await check('S10-U11', 't3: ההודעה הראשונה בלילה של הבית: "קם משינה" 2.5 שניות, ואז הפרצוף של התשובה; השנייה לא; ביום לא', async () => { try {
    await houseTz(zoneAt(2));
    await send(p, 'יש לנו חלב?'); await p.waitForTimeout(300);
    let b1 = await band(); ok((await last()) === 'wake:waking' && b1.mood === 'waking', `${await last()} ${b1.mood}`);
    await p.waitForTimeout(1500); ok((await band()).mood === 'waking', 'the yawn ended before 2.5s');
    await p.waitForTimeout(1200); b1 = await band(); ok(b1.mood === 'happy', `after 2.5s, the answer's face (the fake model: happy): ${b1.mood}`);
    await p.waitForTimeout(2600);
    await send(p, 'ומה עם ביצים?'); await p.waitForTimeout(300);
    ok((await last()) !== 'wake:waking', `the second message: ${await last()}`);
    await p.waitForTimeout(2600);
    await houseTz(zoneAt(12));
    await send(p, 'יש לנו חלב?'); await p.waitForTimeout(300);
    ok((await last()) !== 'wake:waking', `by day: ${await last()}`);
    await p.waitForTimeout(2600);
  } finally { homeTz(); } });

  await check('S10-U12', 't3, שאלה 8: מצוקה בהודעה הראשונה בלילה: "מבין" מיד, בלי לחכות לסוף הפיהוק', async () => { try {
    await houseTz(zoneAt(2));
    await send(p, 'אני לא רוצה לחיות יותר'); await p.waitForTimeout(1200);
    ok((await band()).mood === 'understanding', `at 1.2s: ${(await band()).mood}`);
    await send(p, 'תודה'); await p.waitForTimeout(2600);
  } finally { homeTz(); } });

  await check('S10-U9', 't5: פרצופים רנדומליים במקום תנועה: שיהוק, עיטוש וזמזום ביום (בלי פיהוק); בלילה או בישנוני גם פיהוק; HIC!, ACHOO! והתווים', async () => {
    const day = await solo('s10_u9', { ms: 8500 }); // hic 1.6 + achoo 1.8 + hum 3 (and the gaps)
    ok(['hic', 'achoo', 'hum'].every((x) => day.seen.includes(x)) && !day.seen.includes('yawn'), `by day: ${day.seen} (${day.order})`);
    ok(['hic', 'achoo', 'notes'].every((f) => day.fx.includes(f)), `effects: ${day.fx}`);
    const night = await solo('s10_u9', { night: true, ms: 2500 });
    ok(night.order[0] === 'yawn', `at night: ${night.order}`);
    const sleepy = await solo('s10_u9', { mood: 'sleepy', ms: 2500 });
    ok(sleepy.order[0] === 'yawn', `sleepy: ${sleepy.order}`);
  });

  await check('S10-U10', 't5: אף פרצוף רנדומלי במצוקה, בעצב, אחרי תקלה, כששוקי חושב, וב-Reduce Motion', async () => {
    for (const [name, arg] of [['understanding', { mood: 'understanding' }], ['sad', { mood: 'sad' }], ['calm', { calm: true }], ['thinking', { thinking: true }]]) {
      const r = await solo('s10_u9', { ...arg, ms: 5000 }); ok(!r.seen.length, `${name}: ${r.seen}`);
    }
    await p.emulateMedia({ reducedMotion: 'reduce' });
    const r = await solo('s10_u9', { ms: 5000 }); ok(!r.seen.length, `Reduce Motion: ${r.seen}`);
    await p.emulateMedia({ reducedMotion: 'no-preference' });
  });

  await check('S10-U16', 'שאלה 19: אחרי תשובת מצוקה, בועה של שוקי לכל הבית או אליי (לא בתשובה להודעה שלי) לא מסיימת את "מבין"; הודעה חדשה שלי מסיימת אותו', async () => {
    d1('DELETE FROM chat'); await p.reload2(); await p.go('#chat');
    await send(p, 'אני לא רוצה לחיות יותר'); await p.waitForTimeout(1500);
    ok((await band()).mood === 'understanding', 'not understanding');
    const q = (s) => s.replace(/'/g, "''");
    d1(`INSERT INTO chat (ts, user_id, role, content, thread) VALUES (${Date.now()}, NULL, 'shuki', '${q(JSON.stringify({ reply: 'בוקר טוב! נשאר מעט חלב. האם להוסיף אותו לרשימה?', face: 'happy', card: 1, options: ['כן', 'לא'] }))}', NULL)`);
    d1(`INSERT INTO chat (ts, user_id, role, content, thread) VALUES (${Date.now() + 1}, NULL, 'shuki', '${q(JSON.stringify({ reply: 'יואבי ביקש במבה. האם לאשר?', face: 'happy', for: 1 }))}', 1)`);
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(1500);
    const shown = await p.evaluate(() => document.querySelector('#thread').textContent);
    ok(/יואבי ביקש במבה/.test(shown), 'the bubble to me is not in the chat');
    ok((await band()).mood === 'understanding', `after Shuki's bubbles: ${(await band()).mood}`);
    await send(p, 'טוב'); await p.waitForTimeout(3500);
    ok((await band()).mood !== 'understanding', `after my message: ${(await band()).mood}`);
    // and when the chat doesn't load after my message (the reviewer of aaf46af): my message ends it all the same
    await send(p, 'אני לא רוצה לחיות יותר'); await p.waitForTimeout(1500);
    ok((await band()).mood === 'understanding', 'not understanding again');
    await p.route('**/api/chat', (route) => (route.request().method() === 'GET' ? route.abort() : route.fallback()));
    await send(p, 'בסדר, תודה'); await p.waitForTimeout(3500);
    const after = (await band()).mood;
    await p.unroute('**/api/chat');
    ok(after !== 'understanding', `my message, the chat not loaded: ${after}`);
  });

  await check('S10-U17', 'שאלה 21: פעולה עם "לבטל" שמעבירה רמה: "עודכן" עם "לבטל" נשארת עד שהיא נעלמת, ורק אחריה "גדלתי!"', async () => {
    const AT = [3, 7, 14, 21, 30, 45, 60, 80, 100, 125, 150, 180, 210, 250, 300, 365, 430, 500, 600, 730]; // days (16/10)
    await p.api('POST', '/api/actions', { op_id: `s10-u17-${Date.now()}`, ts: Date.now(), by: 1, actions: [{ kind: 'create', product: { name: 'פלפל שחור', category_id: 'אחר', count_type: 'units', unit: 'צנצנת', qty: 1 } }] }); // at home (one at 0 is put on the list by itself)
    notToday(1); const xp = xpOf(1), next = AT.find((x) => x > xp + 1);
    bulk(1, next - 1 - xp); // one point before the next level: the first update today crosses it
    await p.reload2(); await p.waitForTimeout(1200); await p.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 8000 }).catch(() => {});
    await p.go('#inventory'); await p.waitForTimeout(500);
    await p.evaluate(() => { window.s10toasts = []; let last = ''; setInterval(() => { const t = document.querySelector('.toast'); const s = t ? `${t.querySelector('span')?.textContent}|${t.querySelector('button')?.textContent || ''}` : ''; if (s !== last) { window.s10toasts.push([Date.now(), s]); last = s; } }, 100); });
    // the product's window → "נגמר": an action with "לבטל" (act, not silent)
    await p.evaluate(() => [...document.querySelectorAll('.fr')].find((x) => x.textContent.includes('פלפל שחור'))?.click()); await p.waitForSelector('#outBtn'); await p.click('#outBtn');
    await p.waitForTimeout(8000);
    const seq = (await p.evaluate(() => window.s10toasts)).filter(([, s]) => s);
    const updated = seq.findIndex(([, s]) => s === 'עודכן|לבטל'), grew = seq.findIndex(([, s]) => s.startsWith('גדלתי!'));
    ok(updated >= 0, `no "עודכן" with "לבטל": ${JSON.stringify(seq)}`);
    ok(grew > updated, `the party: ${JSON.stringify(seq)}`);
    ok(seq.slice(updated + 1, grew).every(([, s]) => s === 'עודכן|לבטל'), `in between: ${JSON.stringify(seq)}`);
    ok(seq[grew][0] - seq[updated][0] >= 4000, `"עודכן" with "לבטל" was shown ${seq[grew][0] - seq[updated][0]} ms (its own 4.5 s, then the party)`);
    ok(xpOf(1) >= next, `the level wasn't crossed: ${xpOf(1)} < ${next}`);
  });

  await check('S10-U18', 'שאלה 21 (הבודק של bf7de10): "לבטל" שמחזיר את הרמה: אין "גדלתי!" אחרי', async () => {
    const AT = [3, 7, 14, 21, 30, 45, 60, 80, 100, 125, 150, 180, 210, 250, 300, 365, 430, 500, 600, 730]; // days (16/10)
    await p.api('POST', '/api/actions', { op_id: `s10-u18-${Date.now()}`, ts: Date.now(), by: 1, actions: [{ kind: 'create', product: { name: 'פפריקה', category_id: 'אחר', count_type: 'units', unit: 'צנצנת', qty: 1 } }] });
    notToday(1); const xp = xpOf(1), next = AT.find((x) => x > xp + 1);
    bulk(1, next - 1 - xp);
    await p.reload2(); await p.waitForTimeout(1200); await p.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 8000 }).catch(() => {});
    const seen0 = await p.evaluate(() => localStorage.getItem('shuki.seenGrowth'));
    await p.go('#inventory'); await p.waitForTimeout(500);
    await p.evaluate(() => { window.s10toasts = []; let last = ''; setInterval(() => { const t = document.querySelector('.toast'); const s = t ? t.querySelector('span')?.textContent || '' : ''; if (s !== last) { window.s10toasts.push(s); last = s; } }, 50); });
    // stage 13, d9: after the reload the app first draws the phone's copy of the state, which doesn't have פפריקה yet; the click
    // found no row, and no "לבטל" came (2 of 3 Chromium runs on 15/10). Wait for the row, with no sheet open
    await p.waitForFunction(() => !document.querySelector('.scrim') && [...document.querySelectorAll('.fr')].some((x) => x.textContent.includes('פפריקה')), null, { timeout: 8000 });
    await p.evaluate(() => [...document.querySelectorAll('.fr')].find((x) => x.textContent.includes('פפריקה')).click()); await p.waitForFunction(() => document.querySelector('.sheet h2')?.textContent.includes('פפריקה')); await p.click('#outBtn');
    await p.waitForSelector('.toast button'); await p.waitForTimeout(400);
    ok(xpOf(1) >= next, `the action didn't cross the level: ${xpOf(1)} < ${next}`); // the level was crossed, before the undo
    // the undo takes a second (a phone's network): the moment with no toast is long enough for the party to slip in
    await p.route('**/api/undo', async (route) => { await new Promise((x) => setTimeout(x, 1200)); await route.continue(); });
    await p.click('.toast button'); // לבטל
    await p.waitForTimeout(8000); await p.unroute('**/api/undo');
    const seq = (await p.evaluate(() => window.s10toasts)).filter(Boolean);
    ok(!seq.some((t) => t.startsWith('גדלתי!')), `a party after the undo: ${JSON.stringify(seq)}`);
    ok(seq.includes('בוטל'), `no "בוטל": ${JSON.stringify(seq)}`);
    ok(xpOf(1) < next, `the undo didn't take the level back: ${xpOf(1)}`);
    ok(await p.evaluate(() => localStorage.getItem('shuki.seenGrowth')) === seen0, 'seenGrowth moved');
  });

  await check('S10-U13', 't13: אחרי 21 רמות, מכשיר עם seenLevel הישן לא חוגג עלייה שלא הייתה; עלייה אמיתית: "גדלתי! עליתי לרמה 10: צייד המבצעים. וקיבלתי עיפרון מאחורי האוזן!"', async () => {
    bulk(1, 80 - xpOf(1)); // 80 days: level 9 (16/10)
    await p.evaluate(() => { localStorage.removeItem('shuki.seenGrowth'); localStorage.setItem('shuki.seenLevel', '5'); });
    await p.reload2(); await p.waitForTimeout(1200);
    ok(!/גדלתי/.test(await toast()), `a party: ${await toast()}`);
    const seen = await p.evaluate(() => JSON.parse(localStorage.getItem('shuki.seenGrowth')));
    ok(seen === 80, `seenGrowth ${seen}`);
    ok(await p.evaluate(() => localStorage.getItem('shuki.seenLevel') === null), 'seenLevel was not deleted');
    bulk(1, 100 - xpOf(1));
    await p.reload2();
    const t = await p.waitForSelector('.toast:has-text("גדלתי")', { timeout: 5000 }).then((e) => e.textContent());
    ok(t.includes('גדלתי! עליתי לרמה 10: צייד המבצעים. וקיבלתי עיפרון מאחורי האוזן!'), t);
    return t;
  });

  await check('S10-U19', '16/10: הנקודות הן ימים, והרמה בבית קיים יורדת: בלי "גדלתי!", seenGrowth יורד איתה, והפריטים שלא פתוחים יורדים בשקט מהמלתחה', async () => {
    d1(`INSERT OR REPLACE INTO settings (key, value) VALUES ('outfit:1', '${JSON.stringify({ level: 21, wear: { head: 'crown', neck: 'tie', chin: 'beard' } })}')`);
    await p.evaluate(() => localStorage.setItem('shuki.seenGrowth', '1320')); // the old points
    await p.reload2(); await p.waitForTimeout(1500);
    ok(!/גדלתי/.test(await toast()), `a party: ${await toast()}`);
    const g = await p.evaluate(() => JSON.parse(localStorage.getItem('shuki.state') || 'null')?.growth);
    const seen = await p.evaluate(() => JSON.parse(localStorage.getItem('shuki.seenGrowth')));
    ok(g && seen === g.from && g.level < 21, `seenGrowth ${seen}, growth ${JSON.stringify(g)}`);
    const o = JSON.parse(d1q("SELECT value FROM settings WHERE key = 'outfit:1'")[0].value);
    ok(o.level === g.level && !['crown', 'beard'].some((x) => Object.values(o.wear).includes(x)), JSON.stringify(o));
    await p.go('#settings'); await p.click('#closetGo'); await p.waitForTimeout(600);
    ok(await p.locator('.scrim').count() === 1, 'the closet did not open');
    ok(!p.errors.length, p.errors.join(' | '));
  });

  await finish(b, '/tmp/shuki-test/stage10-ui.json');
})().catch((e) => { console.error(e); process.exit(1); });
