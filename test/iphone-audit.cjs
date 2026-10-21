// iPhone audit (30/09, after the first real use): looks for the kinds of faults the owner found on his phone, on every
// screen and every window, at two phone sizes, and prints each one found. It doesn't pass or fail: it lists.
//   fields too narrow to type in ("ש"), a save bar with content showing under it, sideways scroll, English words on
//   screen, text cut off, small tap targets, the mascot over content, fields with only a placeholder, fonts that fell
//   back or fake bold, numbers that disagree, and what the setup screen asks.
// Run: test/ui-qa.sh test/iphone-audit.cjs   (Chromium with a phone viewport; Safari itself: the simulator)
// PW_BROWSER=webkit: Safari's engine (stage 5); its browser under $PW_HOME/browsers (PLAYWRIGHT_BROWSERS_PATH, set by tools/runall.sh)
const chromium = require(process.env.PW)[process.env.PW_BROWSER || 'chromium'];
const { phone, d1 } = require('./sweep-lib.cjs');
const fs = require('node:fs');
const OUT = `/tmp/shuki-test/iphone-audit${process.env.PW_BROWSER === 'webkit' ? '-webkit' : ''}`; fs.mkdirSync(OUT, { recursive: true });
const found = [];
const note = (size, view, kind, what) => found.push({ size, view, kind, what });

// everything measured inside the page, for the current view
const inspect = (p) => p.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.top < innerHeight; };
  const name = (el) => (el.id ? `#${el.id}` : '') + (el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '') || el.tagName.toLowerCase();
  const txt = (el) => (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const out = [];
  const root = document.querySelector('.scrim .sheet') || document.querySelector('.cook') || document.body;
  // fields too narrow to type in
  for (const el of root.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([hidden]), select, textarea')) {
    if (!vis(el)) continue; const w = el.getBoundingClientRect().width;
    if (w < 90) out.push(['narrow field', `${name(el)} ${Math.round(w)}px "${txt(el)}"`]);
    // a field with only a placeholder to say what it is
    // aria-labelledby pointing at something on screen is a label too (פ27, "הערות לבית")
    const by = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id));
    const labelled = el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.previousElementSibling?.matches?.('.lbl, label, h3, h4, p') || (by.length && by.every((x) => x && vis(x)));
    if (!labelled && el.placeholder && !el.closest('#composer') && !el.closest('.invq') && el.id !== 'recQ') out.push(['placeholder only', `${name(el)} "${el.placeholder}"`]);
  }
  // sideways
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push(['sideways scroll', `page ${document.documentElement.scrollWidth}px > ${innerWidth}px`]);
  const sh = document.querySelector('.scrim .sheet'); if (sh && sh.scrollWidth > sh.clientWidth + 1) out.push(['sideways scroll', `window ${sh.scrollWidth}px > ${sh.clientWidth}px`]);
  // English on screen (names of the providers and units are fine)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const OK = /^(Claude|ChatGPT|OpenAI|Anthropic|MCP|CSV|JSON|Siri|PWA|API|L|XL|M|S|ml|kg|g|SIM|sk-ant-\.\.\.|iPhone|iOS|Safari|Android|Chrome|TikTok|Instagram|Docker|Cloudflare|GitHub|Tnuva|Asia|Jerusalem)$/i;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement; if (!el || !vis(el) || el.closest('script,style,[dir=ltr].num,code,.sim')) continue;
    const words = (n.textContent.match(/[A-Za-z][A-Za-z'-]{2,}/g) || []).filter((w) => !OK.test(w));
    if (words.length) out.push(['english on screen', `${name(el)}: "${n.textContent.trim().slice(0, 50)}"`]);
  }
  for (const el of root.querySelectorAll('input[type=file]')) if (vis(el)) out.push(['english on screen', `${name(el)}: the browser's own file button ("Choose File")`]);
  for (const el of root.querySelectorAll('select')) if (vis(el) && /^[A-Za-z_]+\/[A-Za-z_]+/.test(el.value)) out.push(['english on screen', `${name(el)}: "${el.value}"`]);
  // text cut off
  for (const el of root.querySelectorAll('button, .chip, label, .rname, bdi, .rstat, small, h2, h3, .flap')) {
    if (!vis(el)) continue; const cs = getComputedStyle(el);
    if ((cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis' || cs.whiteSpace === 'nowrap') && el.scrollWidth > el.clientWidth + 2) out.push(['text cut off', `${name(el)} "${txt(el)}"`]);
  }
  // small tap targets
  for (const el of root.querySelectorAll('button, a[href], [role=tab], input[type=checkbox]')) {
    if (!vis(el) || el.closest('.sim')) continue;
    // HANDOFF item 20 (v33): the inventory rows stay as they are (the owner, stage 7 decision 9)
    if (el.matches('.fr')) continue;
    // a box inside its label: the label is what the finger hits (פ27, the owner 06/10, r7b, question 13)
    const r = (el.matches('input[type=checkbox]') && el.closest('label') || el).getBoundingClientRect();
    if (r.height < 34 || r.width < 34) out.push(['small tap target', `${name(el)} ${Math.round(r.width)}×${Math.round(r.height)} "${txt(el)}"`]);
  }
  // a window's save bar: sits on the window's bottom edge, with nothing showing below it
  if (sh) {
    const bar = [...sh.querySelectorAll(':scope > .acts, .rform > .acts')].find((a) => getComputedStyle(a).position === 'sticky');
    if (bar) {
      sh.scrollTop = Math.max(0, (sh.scrollHeight - sh.clientHeight) / 2);
      const b = bar.getBoundingClientRect(), s = sh.getBoundingClientRect();
      if (sh.scrollHeight > sh.clientHeight + 4 && s.bottom - b.bottom > 2) out.push(['floating save bar', `${Math.round(s.bottom - b.bottom)}px of the window show under "${txt(bar)}"`]);
    }
  }
  // the mascot over what's under the header (after scrolling the page)
  const mascot = document.querySelector('.band .shuki, .band .mini, header .shuki');
  if (mascot && !sh) {
    const m = mascot.getBoundingClientRect(), band = document.querySelector('.band')?.getBoundingClientRect();
    if (band && m.bottom > band.bottom + 2) {
      for (const el of document.querySelectorAll('#main button, #main input, #main a')) {
        if (!vis(el)) continue; const r = el.getBoundingClientRect();
        if (r.top < m.bottom && r.bottom > band.bottom && r.left < m.right && r.right > m.left) { out.push(['mascot over content', `${name(el)} "${txt(el)}"`]); break; }
      }
    }
  }
  // fonts: a field or text in the browser's own font, or a bold the font doesn't have
  const loaded = { 'Plex Hebrew': [400, 500, 700], 'Secular One': [400], Karantina: [700] };
  for (const el of root.querySelectorAll('*')) {
    if (!vis(el) || !(el.childNodes.length && [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) && !/INPUT|TEXTAREA|SELECT/.test(el.tagName)) continue;
    const cs = getComputedStyle(el); const fam = cs.fontFamily.split(',')[0].replace(/"/g, '').trim();
    if (el.closest('.sim')) continue;
    if (!loaded[fam]) out.push(['font fell back', `${name(el)} ${fam} "${txt(el)}"`]);
    else if (!loaded[fam].includes(+cs.fontWeight)) out.push(['fake bold', `${name(el)} ${fam} ${cs.fontWeight} "${txt(el)}"`]);
  }
  return out;
});

(async () => {
  const b = await chromium.launch();
  for (const [w, h, size] of [[375, 667, 'iPhone SE'], [393, 852, 'iPhone 17']]) {
    const p = await phone(b, { w, h });
    if (size === 'iPhone SE') {
      await p.api('POST', '/api/actions', { op_id: 'audit-seed', actions: [
        { kind: 'create', product: { name: 'ביצים L', count_type: 'pack', pack_size: 12, qty: 4, is_basic: 1, target: 12 } },
        { kind: 'create', product: { name: 'חלב נטול לקטוז', count_type: 'units', unit: 'קרטון', qty: 1, is_basic: 1, target: 2 } },
        { kind: 'create', product: { name: 'פלפל חריף', count_type: 'level', level: 'none' } },
        { kind: 'list_add', text: 'במבה' },
      ] });
      await p.api('POST', '/api/recipes', { name: 'שקשוקה', serves: 4, tags: 'ארוחות בוקר', ingredients: '6 ביצים\n4 עגבניות\n2 פלפלים חריפים\nמלח', text: 'מטגנים.\nמוסיפים.\nשוברים ביצים.' });
    }
    const seen = new Set();
    const shot = (view) => p.screenshot({ path: `${OUT}/${size.replace(/\W+/g, '-')}-${view.replace(/[^\p{L}\p{N}]+/gu, '-')}.png` });
    const look = async (view) => {
      await p.waitForTimeout(350);
      for (const [kind, what] of await inspect(p)) { const k = `${kind}|${what}`; if (!seen.has(`${view}|${k}`)) { seen.add(`${view}|${k}`); note(size, view, kind, what); } }
      await shot(view);
    };
    const close = async () => { await p.evaluate(() => { document.querySelector('.scrim')?.remove(); document.querySelector('.cook .sheet-x')?.click(); }); await p.waitForTimeout(200); };
    const open = async (route, sel, view) => { await close(); await p.go(route); const el = await p.$(sel); if (!el) { note(size, view, 'not found', sel); return false; } await el.click(); await p.waitForTimeout(500); await look(view); return true; };

    for (const r of ['chat', 'list', 'inventory', 'recipes', 'settings']) {
      await close(); await p.go(`#${r}`); await look(r);
      // and scrolled, for what stays on top
      await p.evaluate(() => window.scrollTo(0, 260)); await look(`${r} (scrolled)`);
      await p.evaluate(() => window.scrollTo(0, 0));
    }
    // the numbers on the list: the header and the tab
    await p.go('#list');
    const sub = await p.textContent('.band .sub').catch(() => ''), tab = await p.textContent('.nav a[href="#list"]').catch(() => '');
    note(size, 'list', 'numbers (to compare)', `header "${sub.trim()}" · tab "${tab.replace(/\s+/g, ' ').trim()}"`);

    await open('#inventory', '.fr', 'product window');
    await open('#inventory', '#addP', 'new product');
    await open('#list', '[data-more]', 'list item menu');
    await open('#recipes', '#addR', 'new recipe');
    if (await open('#recipes', '#addR', 'new recipe → write')) { await p.click('[data-way="write"]'); await p.waitForTimeout(500); await look('recipe form'); }
    if (await open('#recipes', '.rcard', 'recipe page')) { await p.click('#rCook'); await p.waitForTimeout(400); await look('cooking mode'); }
    await open('#recipes', '#planR', 'plan the week');
    await open('#settings', '#costRow', 'cost cap');
    await open('#settings', '[data-mem]', 'member window');
    await open('#settings', '#houseDel', 'delete the house');
    await open('#settings', '#restoreDay', 'back to an earlier day');
    await close();
    await p.ctx.close();
  }
  // the setup screen: what a new house is asked
  d1('DELETE FROM devices'); d1('UPDATE users SET active = 0');
  const q = await b.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, serviceWorkers: 'block' });
  const s = await q.newPage(); await s.goto(require('./sweep-lib.cjs').BASE + '/'); await s.waitForTimeout(1500);
  const fields = await s.$$eval('#setup input, #setup select, #setup textarea', (xs) => xs.map((x) => x.id)).catch(() => []);
  note('iPhone 17', 'setup', 'setup asks', fields.length ? fields.join(', ') : '(no setup screen shown: the house exists)');
  await b.close();

  // the report
  const by = {};
  for (const f of found) (by[f.kind] ||= []).push(f);
  const lines = [];
  for (const [k, xs] of Object.entries(by)) {
    lines.push(`\n## ${k} (${xs.length})`);
    const uniq = new Map(); for (const x of xs) { const key = `${x.view}: ${x.what}`; uniq.set(key, [...(uniq.get(key) || []), x.size]); }
    for (const [key, sizes] of uniq) lines.push(`- ${key} [${[...new Set(sizes)].join(', ')}]`);
  }
  lines.push('\n- not measured: .fr (inventory rows), decided: docs/HANDOFF.md item 20');
  fs.writeFileSync(`${OUT}/report.md`, lines.join('\n'));
  console.log(lines.join('\n'));
  console.log(`\n${found.length} findings; screenshots in ${OUT}`);
})();
