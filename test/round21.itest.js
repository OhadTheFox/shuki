// Round 21 (30/09): recipes with structured ingredients — the migration of old recipes, ✓/✗ against the house,
// how many people, "we made it", what's missing onto the list, planning a week, a child's suggestion, the same recipe
// twice, a kosher house, reading a recipe (text / link / video / photo) and three ideas. Against a fake model.
// Run: node test/round21.itest.js
import './fetch-retry.js';
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';

const STATE = '/tmp/shuki-test/shuki-r21';
const PORT = 8789, MOCK = 8788;
const d1 = (sql) => JSON.parse(execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --json --command "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^[^[]*/, ''))[0].results;
rmSync(STATE, { recursive: true, force: true });
// an old house first: migrations up to round 20, with a recipe saved the old way (one free-text line)
execSync(`npx wrangler d1 migrations apply shuki --local --persist-to ${STATE}`, { stdio: 'ignore' });
execSync(`npx wrangler d1 execute shuki --local --persist-to ${STATE} --file test/fixture-house.sql`, { stdio: 'ignore' });
d1(`INSERT INTO pairing_codes (code, user_id, expires) VALUES ('481516', 1, 9999999999999), ('234234', 2, 9999999999999)`);

const script = []; const calls = [];
const mock = http.createServer((req, res) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { const b = Buffer.concat(parts).toString('utf8'); // bytes first: a Hebrew letter can be split between chunks (question 29)

  const body = JSON.parse(b || '{}'); calls.push(body);
  const input = script.shift() || { reply: 'ok', face: 'happy' };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'tool_use', id: 'tu1', name: body.tools?.[0]?.name || 'respond', input }], usage: { input_tokens: 100, output_tokens: 10 } }));
}); }).listen(MOCK);
const dev = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(PORT), '--persist-to', STATE, '--var', `ANTHROPIC_URL:http://127.0.0.1:${MOCK}/v1/messages`, '--var', 'ANTHROPIC_API_KEY:t', '--var', 'TEST_RESET:1', '--var', 'VAPID_SUBJECT:mailto:t@example.com'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = ''; dev.stdout.on('data', (d) => (log += d)); dev.stderr.on('data', (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
const call = async (t, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const txt = await r.text(); let data = null; try { data = JSON.parse(txt); } catch { /* text */ } return { status: r.status, data, text: txt }; };
const state = async (t) => (await call(t, 'GET', '/api/state')).data;
const results = [];
async function check(id, name, fn) {
  try { const note = await fn(); results.push({ id, name, ok: true, note: note || '' }); console.log('✓', id, name, note ? `— ${note}` : ''); }
  catch (e) { results.push({ id, name, ok: false, error: e.message.slice(0, 500) }); console.log('✗', id, name, '\n   ', e.message.slice(0, 500)); }
}
const act = (t, actions) => call(t, 'POST', '/api/actions', { actions, op_id: `op-${Math.random()}` });
const P = (s, name) => s.products.find((p) => p.name === name);
const R = (s, name) => s.recipes.find((r) => r.name === name);
const { recipeStatus } = await import('../public/recipes.js');
let avi, michal, kid;
try {
  for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  avi = (await call(null, 'POST', '/api/pair', { code: '481516', name: 'iPhone' })).data.token;
  michal = (await call(null, 'POST', '/api/pair', { code: '234234', name: 'iPhone' })).data.token;
  await call(avi, 'POST', '/api/settings', { costCap: 1000 });
  await act(avi, [
    { kind: 'create', product: { name: 'ביצים L', count_type: 'pack', pack_size: 12, qty: 4, is_basic: 1, target: 12 } },
    { kind: 'create', product: { name: 'עגבניות', count_type: 'level', level: 'plenty', store: 'greengrocer' } },
    { kind: 'create', product: { name: 'שמן זית', count_type: 'inuse', is_open: 1, qty: 0 } },
    { kind: 'create', product: { name: 'רסק עגבניות', count_type: 'units', unit: 'קופסה', qty: 1 } },
    { kind: 'create', product: { name: 'פלפל אדום', count_type: 'level', level: 'none', store: 'greengrocer' } },
    { kind: 'create', product: { name: 'מלח', count_type: 'units', unit: 'שקית', qty: 1 } },
    { kind: 'create', product: { name: 'בצל', count_type: 'level', level: 'little', store: 'greengrocer' } },
    { kind: 'create', product: { name: 'פסטה', count_type: 'units', unit: 'חבילה', qty: 3 } },
  ]);

  await check('M1', 'מתכון ישן (שורה עם פסיקים) עובר למצרכים מובנים בפעם הראשונה, ומקושר למלאי', async () => {
    await call(avi, 'POST', '/api/__recipes', { recipes: [{ name: 'שקשוקה', ingredients: '6 ביצים, 4 עגבניות, 2 כפות שמן זית, 2 קופסאות רסק עגבניות, 2 פלפלים אדומים, מלח, כוסברה', text: 'מטגנים, מוסיפים ביצים', serves: 4 }] });
    const s = await state(avi); const r = R(s, 'שקשוקה');
    assert.equal(r.ings.length, 7, JSON.stringify(r.ings));
    const by = Object.fromEntries(r.ings.map((i) => [i.name, i]));
    assert.equal(by['ביצים'].qty, 6); assert.equal(by['ביצים'].product_id, P(s, 'ביצים L').id);
    assert.equal(by['שמן זית'].unit, 'כף'); assert.equal(by['שמן זית'].product_id, P(s, 'שמן זית').id);
    assert.equal(by['רסק עגבניות'].unit, 'קופסה'); assert.equal(by['כוסברה'].product_id, null);
    assert.equal(d1('SELECT parsed FROM recipes')[0].parsed, 1);
    assert.equal(r.ingredients, '6 ביצים\n4 עגבניות\n2 כפות שמן זית\n2 קופסאות רסק עגבניות\n2 פלפלים אדומים\nמלח\nכוסברה');
    const again = await state(avi); assert.deepEqual(R(again, 'שקשוקה').ings.map((i) => i.id), r.ings.map((i) => i.id), 'converted once, not every time');
  });

  await check('M2', '✓/✗: חסר = אין מספיק (4 ביצים, צריך 6 = חסרות 2); מלח לא נחשב חסר; מה שנגמר חסר; ל-8 הכמויות כפולות', async () => {
    const s = await state(avi); const r = R(s, 'שקשוקה');
    const st = recipeStatus(r, r.ings, s.products, 4); const it = Object.fromEntries(st.items.map((i) => [i.name, i]));
    assert.equal(it['ביצים'].ok, false); assert.equal(it['ביצים'].short, 2);
    assert.equal(it['מלח'].ok, true); assert.equal(it['עגבניות'].ok, true);
    assert.equal(it['פלפלים אדומים'].ok, false, 'ran out'); assert.equal(it['כוסברה'].ok, false, 'not at home');
    assert.equal(it['רסק עגבניות'].short, 1);
    assert.equal(st.missing, 4);
    const big = recipeStatus(r, r.ings, s.products, 8); assert.equal(big.items.find((i) => i.name === 'ביצים').short, 8);
  });

  await check('M3', 'מלח שנגמר במלאי כן חסר', async () => {
    const s0 = await state(avi); await act(avi, [{ kind: 'op', product_id: P(s0, 'מלח').id, op: { type: 'out' } }]);
    const s = await state(avi); const r = R(s, 'שקשוקה');
    assert.equal(recipeStatus(r, r.ings, s.products, 4).items.find((i) => i.name === 'מלח').ok, false);
    await act(avi, [{ kind: 'op', product_id: P(s, 'מלח').id, op: { type: 'purchase', amount: 1 } }]);
  });

  await check('M4', '"להוסיף את מה שחסר לרשימה": נכנס מיד, עם כמות כשחסר יותר מאחד, ומה שכבר ברשימה לא פעמיים', async () => {
    let s = await state(avi); const r = R(s, 'שקשוקה');
    const before = s.list.filter((i) => i.status === 'open').length;
    // the eggs are a regular product under its minimum: already on the list by themselves, so not added twice
    assert.ok(s.list.some((i) => i.product_id === P(s, 'ביצים L').id && i.status === 'open'));
    const x = await call(avi, 'POST', `/api/recipes/${r.id}/missing`, { people: 4 });
    assert.equal(x.status, 200, x.text); assert.equal(x.data.added, 3, JSON.stringify(x.data));
    s = await state(avi);
    assert.equal(s.list.filter((i) => i.product_id === P(s, 'ביצים L').id).length, 1);
    for (const n of ['ביצים L', 'רסק עגבניות', 'פלפל אדום']) assert.ok(s.list.some((i) => i.product_id === P(s, n).id && i.status === 'open'), n);
    assert.ok(s.list.some((i) => i.text === 'כוסברה'), 'not at home: as text');
    const again = await call(avi, 'POST', `/api/recipes/${r.id}/missing`, { people: 4 });
    assert.equal(again.data.added, 0, 'already on the list');
  });

  await check('M5', '"הכנו את זה": כרטיס עם סימני שאלה; ביצים וקופסאות יורדות; "נשאר מעט?" לא מסומן מראש; אחרי אישור: נספר פעם אחת', async () => {
    let s = await state(avi); const r = R(s, 'שקשוקה');
    const c = await call(avi, 'POST', `/api/recipes/${r.id}/cooked`, { people: 4 });
    assert.equal(c.status, 200, c.text); const card = c.data.proposal;
    const texts = card.lines.map((l) => l.text);
    assert.ok(texts.every((t) => t.endsWith('?')), texts.join(' | '));
    assert.ok(texts.includes('לסמן שהשתמשנו ב-4 ביצים L?'), texts.join(' | '));
    assert.ok(texts.includes('לסמן שהשתמשנו בקופסת רסק עגבניות?') || texts.some((t) => /רסק/.test(t)), texts.join(' | '));
    const low = texts.findIndex((t) => t === 'לעדכן שנשאר מעט עגבניות?');
    assert.ok(low >= 0, texts.join(' | ')); assert.ok(card.off.includes(low), 'unticked');
    const oil = texts.findIndex((t) => /שמן זית/.test(t)); assert.ok(card.off.includes(oil), 'the last open oil: unticked');
    const ap = await call(avi, 'POST', `/api/proposals/${card.id}/apply`, { skip: card.off });
    assert.equal(ap.data.status, 'applied', ap.text);
    s = await state(avi);
    assert.equal(P(s, 'ביצים L').qty, 0); assert.equal(P(s, 'רסק עגבניות').qty, 0); assert.equal(P(s, 'עגבניות').level, 'plenty', 'unticked stays');
    assert.equal(R(s, 'שקשוקה').cooked, 1); assert.ok(R(s, 'שקשוקה').last_cooked);
  });

  await check('M6', 'שמירה מהטופס: מצרך בשורה, קטגוריות, תמונה; אותו שם או קישור שוב → "כבר שמור" (dup)', async () => {
    const img = Buffer.from('fake-jpeg').toString('base64');
    const r = await call(avi, 'POST', '/api/recipes', { name: 'פסטה ברוטב עגבניות', ingredients: 'חבילה של פסטה\nקופסת רסק עגבניות\n2 שיני שום\nקורט מלח', text: 'מבשלים', tags: 'איטלקי, פסטה, רטבים', serves: 2, photo: img, url: 'https://example.com/pasta' });
    assert.equal(r.status, 200, r.text); assert.ok(r.data.id);
    const s = await state(avi); const x = R(s, 'פסטה ברוטב עגבניות');
    assert.deepEqual(x.tags.split(', '), ['איטלקי', 'פסטה', 'רטבים'], 'a category of their own stays');
    assert.equal(x.photo, 1); assert.equal(x.ings[0].qty, 1); assert.equal(x.ings[0].unit, 'חבילה'); assert.equal(x.ings[0].product_id, P(s, 'פסטה').id);
    const ph = await fetch(`${base}/api/recipes/${x.id}/photo`, { headers: { authorization: `Bearer ${avi}` } });
    assert.equal(ph.status, 200); assert.equal(Buffer.from(await ph.arrayBuffer()).toString(), 'fake-jpeg');
    const d = await call(avi, 'POST', '/api/recipes', { name: 'פסטה ברוטב עגבניות', ingredients: 'פסטה' });
    assert.equal(d.data.dup, x.id);
    const d2 = await call(avi, 'POST', '/api/recipes', { name: 'משהו אחר', ingredients: 'פסטה', url: 'https://example.com/pasta' });
    assert.equal(d2.data.dup, x.id, 'the same link');
    assert.equal((await call(avi, 'POST', '/api/recipes', { name: '', ingredients: 'פסטה' })).data.error, 'name');
    assert.equal((await call(avi, 'POST', '/api/recipes', { name: 'ריק', ingredients: '  ' })).data.error, 'ingredients');
  });

  await check('M7', 'עריכה: שם, מצרכים עם קישור שתוקן ביד, קטגוריות; מחיקת התמונה; מחיקת המתכון עם המצרכים', async () => {
    let s = await state(avi); const x = R(s, 'פסטה ברוטב עגבניות');
    const ings = x.ings.map((i) => ({ qty: i.qty, unit: i.unit, name: i.name, product_id: i.product_id }));
    ings[2].product_id = P(s, 'בצל').id; // fixed by hand (a wrong link on purpose)
    ings.push({ qty: 100, unit: 'גרם', name: 'פרמזן' });
    const e = await call(avi, 'POST', `/api/recipes/${x.id}/edit`, { name: 'פסטה עגבניות', ings, tags: 'פסטה', photo: null });
    assert.equal(e.status, 200, e.text);
    s = await state(avi); const y = R(s, 'פסטה עגבניות');
    assert.equal(y.ings.length, 5); assert.equal(y.ings[2].product_id, P(s, 'בצל').id, 'the link kept as fixed'); assert.equal(y.tags, 'פסטה'); assert.equal(y.photo, null);
    assert.equal(y.ings[4].product_id, null);
    await call(avi, 'POST', `/api/recipes/${y.id}/delete`, {});
    s = await state(avi); assert.ok(!R(s, 'פסטה עגבניות'));
    assert.equal(d1(`SELECT COUNT(*) AS n FROM recipe_ingredients WHERE recipe_id = ${y.id}`)[0].n, 0);
  });

  await check('M8', 'ילד מציע מתכון: מחכה, מבוגרים מקבלים "{שם} הציע מתכון: …. האם לשמור?", רק מבוגר מאשר; "לא צריך" מוחק', async () => {
    const SUB = { endpoint: 'https://push.example.com/x', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } };
    await call(avi, 'POST', '/api/push/subscribe', { subscription: SUB });
    const a = await call(avi, 'POST', '/api/members', { add: { name: 'יובל', gender: 'm', role: 'child' } });
    kid = (await call(null, 'POST', '/api/pair', { code: a.data.code })).data.token;
    const r = await call(kid, 'POST', '/api/recipes', { name: 'טוסט', ingredients: '2 פרוסות לחם\nגבינה צהובה' });
    assert.equal(r.data.suggested, true);
    assert.ok(r.data.notify.some((x) => x.to === 'אבי' && x.body === 'יובל הציע מתכון: טוסט. האם לשמור?'), JSON.stringify(r.data.notify));
    let s = await state(avi); assert.equal(R(s, 'טוסט').status, 'suggested'); assert.equal(R(s, 'טוסט').by_name, 'יובל');
    assert.equal((await call(kid, 'POST', `/api/recipes/${R(s, 'טוסט').id}/approve`, { yes: true })).status, 403);
    await call(michal, 'POST', `/api/recipes/${R(s, 'טוסט').id}/approve`, { yes: true });
    s = await state(avi); assert.equal(R(s, 'טוסט').status, null);
    const r2 = await call(kid, 'POST', '/api/recipes', { name: 'במבה בשוקולד', ingredients: 'במבה\nשוקולד' });
    await call(avi, 'POST', `/api/recipes/${r2.data.id}/approve`, { yes: false });
    s = await state(avi); assert.ok(!R(s, 'במבה בשוקולד'));
    assert.equal((await call(kid, 'POST', `/api/recipes/${R(s, 'טוסט').id}/delete`, {})).status, 403, 'a child deletes only their own waiting one');
  });

  await check('M9', 'בית כשר (הערות הבית): מתכון עם עוף ושמנת מסומן, חלב קוקוס לא; בלי "כשר" בהערות לא מסומן', async () => {
    await call(avi, 'POST', '/api/recipes', { name: 'עוף בשמנת', ingredients: 'חזה עוף\nשמנת מתוקה' });
    await call(avi, 'POST', '/api/recipes', { name: 'עוף בקארי', ingredients: 'חזה עוף\nחלב קוקוס' });
    let s = await state(avi); assert.equal(R(s, 'עוף בשמנת').kosher, null);
    await call(avi, 'POST', '/api/settings', { house_notes: 'הכל כשר' });
    s = await state(avi); assert.equal(R(s, 'עוף בשמנת').kosher, 'meatMilk'); assert.equal(R(s, 'עוף בקארי').kosher, null);
    // and the chat is told not to suggest such things
    script.push({ reply: 'אפשר עוף בקארי', face: 'happy' });
    await call(avi, 'POST', '/api/chat', { text: 'מה לבשל?' });
    const sys = (calls.at(-1).system || []).map((x) => x.text).join('\n');
    assert.match(sys, /בית כשר: אל תציע מעצמך בשר וחלב/); /* the words of c6 (r0t trim) */ assert.match(sys, /עוף בשמנת.*לא מתאים לבית כשר/);
  });

  await check('M10', 'קריאת מתכון מטקסט: קריאה אחת למודל, חוזר מסודר לשדות ולא נשמר; טיקטוק: שומרים קישור בלי מודל', async () => {
    const n0 = calls.length;
    script.push({ found: true, name: 'עוגת שוקולד', ingredients: '3 ביצים\nכוס סוכר\n200 גרם שוקולד', text: 'אופים 30 דקות', tags: 'עוגות, קינוחים', serves: 8 });
    const r = await call(avi, 'POST', '/api/recipes/read', { text: 'עוגת שוקולד: 3 ביצים, כוס סוכר, 200 גרם שוקולד. אופים 30 דקות' });
    assert.equal(r.status, 200, r.text); assert.equal(r.data.recipe.name, 'עוגת שוקולד'); assert.equal(r.data.recipe.serves, 8);
    assert.equal(calls.length, n0 + 1, 'one call'); assert.equal(calls.at(-1).tools[0].name, 'recipe');
    assert.match(calls.at(-1).system[0].text, /בית כשר/);
    let s = await state(avi); assert.ok(!R(s, 'עוגת שוקולד'), 'not saved');
    const v = await call(avi, 'POST', '/api/recipes/read', { text: 'https://www.tiktok.com/@chef/video/123' });
    assert.equal(v.data.video, true); assert.equal(calls.length, n0 + 1, 'no model for a video');
    script.push({ found: false });
    const bad = await call(avi, 'POST', '/api/recipes/read', { text: 'סתם טקסט בלי מתכון בכלל, רק מילים' });
    assert.equal(bad.data.error, 'unreadable');
    script.push({ found: true, name: 'סלט', ingredients: 'עגבנייה\nמלפפון', text: 'חותכים' });
    const img = await call(avi, 'POST', '/api/recipes/read', { image: { media_type: 'image/jpeg', data: Buffer.from('x').toString('base64') } });
    assert.equal(img.data.recipe.name, 'סלט'); assert.equal(calls.at(-1).messages[0].content[0].type, 'image');
  });

  await check('M11', '"רוצים שאכתוב מתכון?": קריאה אחת, 3 רעיונות לפי מה שיש, לא נשמר; "רעיונות אחרים" שולח את מה שכבר הוצע', async () => {
    const n0 = calls.length;
    script.push({ ideas: [
      { name: 'פסטה ברסק', blurb: 'מהיר', ingredients: 'חבילה של פסטה\nקופסת רסק', text: 'מבשלים', tags: 'פסטה', serves: 2 },
      { name: 'חביתה', blurb: 'קלאסי', ingredients: '2 ביצים\nמלח', text: 'מטגנים', tags: 'ארוחות בוקר', serves: 1 },
      { name: 'סלט עגבניות', blurb: 'רענן', ingredients: '3 עגבניות\nשמן זית', text: 'חותכים', tags: 'סלט', serves: 2 }] });
    const r = await call(avi, 'POST', '/api/recipes/ideas', {});
    assert.equal(r.data.ideas.length, 3); assert.equal(calls.length, n0 + 1); assert.equal(calls.at(-1).tools[0].name, 'ideas');
    assert.match(calls.at(-1).messages[0].content, /פסטה/, 'what is at home goes to the model');
    const s = await state(avi); assert.ok(!R(s, 'חביתה'));
    script.push({ ideas: [{ name: 'מרק', ingredients: 'בצל', text: 'מבשלים' }] });
    await call(avi, 'POST', '/api/recipes/ideas', { not: ['פסטה ברסק', 'חביתה', 'סלט עגבניות'] });
    assert.match(calls.at(-1).messages[0].content, /לא: פסטה ברסק, חביתה, סלט עגבניות/);
  });

  await check('M12', '"לתכנן שבוע": כרטיס אחד עם כל מה שחסר לכמה מתכונים, בלי כפילויות', async () => {
    await call(avi, 'POST', '/api/recipes', { name: 'חביתה', ingredients: '3 ביצים\nבצל' });
    let s = await state(avi);
    for (const i of s.list.filter((x) => x.status === 'open')) await act(avi, [{ kind: 'list_remove', item_id: i.id }]);
    s = await state(avi);
    const c = await call(avi, 'POST', '/api/recipes/plan', { ids: [R(s, 'שקשוקה').id, R(s, 'חביתה').id] });
    const lines = c.data.proposal.lines.map((l) => l.text);
    // home20 (section 16): two recipes' eggs are summed, one after the other (6 + 3), not the larger amount
    assert.equal(lines.filter((t) => /ביצים/.test(t)).length, 1, lines.join(' | ')); assert.ok(lines.some((t) => /(^|\s)9\s/.test(t) && /ביצים/.test(t)), lines.join(' | '));
    assert.ok(lines.every((t) => t.endsWith('?')));
  });

  await check('M13', 'גיבוי ושחזור כוללים את המצרכים', async () => {
    const ex = await call(avi, 'GET', '/api/export');
    assert.ok(ex.status === 200, ex.text.slice(0, 200));
    assert.ok(Array.isArray((ex.data.tables || ex.data).recipe_ingredients), Object.keys(ex.data.tables || ex.data).join(','));
  });
  await check('M14', 'בית כשר: רעיון עם עוף וגבינה לא מגיע; "הכנתי שקשוקה": "2 כפות שמן זית" לא הופך ל-2 בקבוקים (השורה יורדת)', async () => {
    script.push({ ideas: [{ name: 'פסטה אלפרדו עם עוף', ingredients: 'חבילה של פסטה\nחזה עוף\nגבינה צהובה', text: 'x' }, { name: 'חביתה', ingredients: '3 ביצים', text: 'x' }] });
    const r = await call(avi, 'POST', '/api/recipes/ideas', {});
    assert.deepEqual(r.data.ideas.map((i) => i.name), ['חביתה']);
    const s = await state(avi); const shak = R(s, 'שקשוקה'); const oil = P(s, 'שמן זית'), eggs = P(s, 'ביצים L');
    await act(avi, [{ kind: 'op', product_id: eggs.id, op: { type: 'purchase', amount: 1 } }]);
    const c = (await call(avi, 'POST', '/api/chat', { text: 'הכנתי שקשוקה' }));
    script.length = 0; script.push({ reply: 'לעדכן?', face: 'happy', actions: [{ kind: 'op', product_id: eggs.id, op: { type: 'use', amount: 6 } }, { kind: 'op', product_id: oil.id, op: { type: 'use', amount: 2 } }] });
    const r2 = (await call(avi, 'POST', '/api/chat', { text: 'כן, ככה' })).data;
    const lines = r2.proposal.lines.map((l) => l.text);
    assert.ok(lines.some((t) => /6 ביצים/.test(t)) && !lines.some((t) => /שמן זית/.test(t)), lines.join(' | '));
    assert.ok(shak && c.status === 200);
  });
} finally {
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} round-21 checks passed`);
  writeFileSync(new URL('./round21-results.json', import.meta.url), JSON.stringify(results, null, 1));
  if (results.some((r) => !r.ok)) console.log(log.split('\n').filter((l) => /error|Error/.test(l)).slice(-10).join('\n'));
  mock.close(); try { process.kill(-dev.pid, 'SIGKILL'); } catch { /* gone */ }
  process.exit(ok === results.length ? 0 : 1);
}
