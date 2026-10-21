// Visual check (30/09): no two fonts that differ without a reason. Walks every screen and window, and lists
// each text's font, weight and size by role, so the odd ones out stand out. Run: test/ui-qa.sh test/fonts-audit.cjs
const { chromium } = require(process.env.PW);
const { phone } = require('./sweep-lib.cjs');
const fs = require('node:fs');
const collect = (p, where) => p.evaluate((where) => {
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
    const isField = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
    if (!own && !isField) continue;
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); if (!r.width) continue;
    const fam = cs.fontFamily.split(',')[0].replace(/"/g, '').trim();
    const cls = (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
    const key = `${fam}|${cs.fontWeight}|${cs.fontSize}|${el.tagName}${cls}`;
    if (seen.has(key)) continue; seen.add(key);
    out.push({ where, fam, w: cs.fontWeight, size: cs.fontSize, tag: el.tagName.toLowerCase() + cls, text: (own || el.placeholder || el.value || '').slice(0, 40) });
  }
  return out;
}, where);
(async () => {
  const b = await chromium.launch();
  const p = await phone(b, { w: 390, h: 844 });
  await p.api('POST', '/api/actions', { op_id: 'fa', actions: [
    { kind: 'create', product: { name: 'ביצים L', count_type: 'pack', pack_size: 12, qty: 4, is_basic: 1, target: 12 } },
    { kind: 'create', product: { name: 'עגבניות', count_type: 'level', level: 'plenty' } },
    { kind: 'create', product: { name: 'שמן', count_type: 'inuse', is_open: 1, qty: 1 } },
  ] });
  await p.api('POST', '/api/recipes', { name: 'שקשוקה', serves: 4, tags: 'ארוחות בוקר', ingredients: '6 ביצים\n4 עגבניות\nמלח', text: 'מטגנים.\nמוסיפים.' });
  const all = [];
  for (const r of ['chat', 'list', 'inventory', 'recipes', 'settings']) { await p.go(`#${r}`); await p.waitForTimeout(400); all.push(...await collect(p, r)); }
  await p.go('#recipes'); await p.click('.rcard'); await p.waitForSelector('.ings'); all.push(...await collect(p, 'recipe page'));
  await p.click('#rCook'); await p.waitForSelector('.cook'); all.push(...await collect(p, 'cook')); await p.click('.cook .sheet-x');
  await p.click('#addR'); all.push(...await collect(p, 'new recipe')); await p.click('[data-way="write"]'); await p.waitForSelector('#rForm'); all.push(...await collect(p, 'recipe form')); await p.click('.sheet-x');
  await p.click('#planR'); all.push(...await collect(p, 'plan')); await p.click('.sheet-x');
  await p.go('#inventory'); await p.click('.fr'); await p.waitForSelector('.sheet'); all.push(...await collect(p, 'product')); await p.click('.sheet-x');
  fs.writeFileSync('/tmp/shuki-test/fonts.json', JSON.stringify(all, null, 1));
  const by = {};
  for (const x of all) (by[`${x.fam} ${x.w}`] ||= []).push(x);
  for (const [k, xs] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) console.log(`${k}: ${xs.length}`);
  await b.close();
})();
