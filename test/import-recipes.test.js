// Stage 11: the parts of importing recipes that need no server. linkNew (i1) against a fake D1 that writes down every query
// (S11-05, S11-16, S11-17). Run: node --test test/import-recipes.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkNew } from '../worker/restart.js';

/** A fake D1: answers by the start of the query, and keeps every query and its values. */
function fakeDb({ mark = null, ings = [], relink = null } = {}) {
  const seen = [];
  const stmt = (sql) => {
    const s = { sql, vals: [] };
    s.bind = (...v) => { s.vals = v; return s; };
    s.first = async () => { seen.push(s); if (/key = 'recipe_link_at'/.test(sql)) return mark && { value: JSON.stringify(mark) }; if (/key = 'relink'/.test(sql)) return relink && { value: JSON.stringify(relink) }; return null; };
    s.all = async () => { seen.push(s); return { results: /FROM recipe_ingredients/.test(sql) ? ings : [] }; };
    s.run = async () => { seen.push(s); return {}; };
    return s;
  };
  return { prepare: stmt, batch: async (xs) => { seen.push(...xs); return []; }, seen };
}
// product ids are the server's clock: ms × 1000 (newId, worker/store.js)
const T = 1_800_000_000_000_000, MIN = 60e3 * 1000;
const P = (id, name, more = {}) => ({ id, name, aliases: '[]', private_to: null, deleted: null, ...more });
const updates = (db) => db.seen.filter((s) => /^UPDATE recipe_ingredients/.test(s.sql)).map((s) => [s.vals[0], JSON.parse(s.vals[1])]);
const markOf = (db) => JSON.parse(db.seen.find((s) => /INTO settings/.test(s.sql)).vals[0]);

test('S11-05: with nothing new since the mark, recipe_ingredients is not read at all', async () => {
  const db = fakeDb({ mark: { at: T, seen: [T] }, ings: [{ id: 9, name: 'ביצים' }] });
  await linkNew(db, [P(T, 'ביצים'), P(T - 60 * MIN, 'חלב')]);
  assert.ok(!db.seen.some((s) => /recipe_ingredients/.test(s.sql)), db.seen.map((s) => s.sql).join('\n'));
  assert.ok(!db.seen.some((s) => /^INSERT|^UPDATE/.test(s.sql)));
});

test('S11-16: the first look in a house only sets the mark: nothing is linked, even when a product fits', async () => {
  const db = fakeDb({ ings: [{ id: 9, name: 'ביצים' }] });
  await linkNew(db, [P(T, 'ביצים'), P(T - 60 * MIN, 'חלב')]);
  assert.ok(!db.seen.some((s) => /recipe_ingredients/.test(s.sql)));
  assert.deepEqual(markOf(db), { at: T, seen: [T] });
});

test('S11-17: a product made 5 minutes before the mark, not yet seen, is tried and links; the mark keeps it as seen', async () => {
  const db = fakeDb({ mark: { at: T, seen: [] }, ings: [{ id: 9, name: 'ביצים' }, { id: 10, name: 'בצל' }] });
  await linkNew(db, [P(T - 5 * MIN, 'ביצים L'), P(T - 60 * MIN, 'חלב')]);
  assert.deepEqual(updates(db), [[T - 5 * MIN, [9]]]);
  assert.deepEqual(markOf(db), { at: T, seen: [T - 5 * MIN] });
});

test('S11-17ב: another person\'s private product and a deleted one are never tried', async () => {
  const db = fakeDb({ mark: { at: T - 60 * MIN, seen: [] }, ings: [{ id: 9, name: 'שמנת' }, { id: 10, name: 'ביצים' }] });
  await linkNew(db, [P(T, 'שמנת', { private_to: 2 }), P(T + 1, 'ביצים', { deleted: 1 })]);
  assert.ok(!db.seen.some((s) => /recipe_ingredients/.test(s.sql)));
});

test('S11-03ב: linked here, the ingredient leaves the "relink" list; the others wait in it', async () => {
  const db = fakeDb({ mark: { at: T - 60 * MIN, seen: [] }, ings: [{ id: 9, name: 'עגבניות' }], relink: [{ id: 9, name: 'עגבניות' }, { id: 11, name: 'מלפפון' }] });
  await linkNew(db, [P(T, 'עגבניות שרי')]);
  const w = db.seen.find((s) => /UPDATE settings SET value = \? WHERE key = 'relink'/.test(s.sql));
  assert.deepEqual(JSON.parse(w.vals[0]), [{ id: 11, name: 'מלפפון' }]);
});

test('S11-19: a new product wins only when it is the best of all: "חלב" stays unlinked next to an old "חלב", not "חלב שקדים"', async () => {
  const db = fakeDb({ mark: { at: T - 60 * MIN, seen: [] }, ings: [{ id: 9, name: 'חלב' }, { id: 10, name: 'חלב שקדים קר' }] });
  await linkNew(db, [P(T - 120 * MIN, 'חלב'), P(T, 'חלב שקדים')]);
  assert.deepEqual(updates(db), [[T, [10]]]);
});

test('S11-20: one statement for each product, whatever the number of ingredients; at most 40 products a look', async () => {
  const names = Array.from({ length: 45 }, (_, k) => `מוצר${String.fromCharCode(1488 + (k % 22))}${k}`);
  const ings = names.flatMap((n, k) => [{ id: 100 + 2 * k, name: n }, { id: 101 + 2 * k, name: n }]);
  const db = fakeDb({ mark: { at: T - 60 * MIN, seen: [] }, ings });
  await linkNew(db, names.map((n, k) => P(T + k, n)));
  const up = updates(db);
  assert.equal(up.length, 40);
  assert.ok(up.every(([, ids]) => ids.length === 2));
  assert.equal(markOf(db).at, T + 39);
});

/* ---- the tool, tools/import-recipes.mjs, with no server (I10–I13) ---- */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const runTool = (args, env = {}) => {
  const e = { ...process.env, ...env }; delete e.SHUKI_URL; delete e.SHUKI_TOKEN; Object.assign(e, env);
  try { return { rc: 0, out: execFileSync('node', ['tools/import-recipes.mjs', ...args], { env: e, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (x) { return { rc: x.status, out: `${x.stdout || ''}${x.stderr || ''}` }; }
};
const FIX = 'test/import-recipes.fixture.json';

test('I10: --dry-run on the invented file, no server: 6 in, 2 twice in the file, 2 turned away, one house category; no cuts', () => {
  const r = runTool([FIX, '--dry-run']);
  assert.equal(r.rc, 0, r.out);
  assert.match(r.out, /^ייכנסו: 6\nכבר בבית: 0\nכפולים בקובץ: 2\nיידחו: 2\nשגיאות רשת: 0\nקטגוריות של הבית: רטבים \(1\)\n/);
  assert.match(r.out, /#2 חביתה: כפול בקובץ, של #1/);
  assert.match(r.out, /#3 חביתת ירק: כפול בקובץ, של #1/);
  assert.match(r.out, /#4 מרק בלי מצרכים: אין מצרכים/);
  assert.match(r.out, /#5: אין שם/);
  assert.ok(!/ייחתך|ייחתכו/.test(r.out));
});

test('I11: the tool takes the rules from public/recipes.js and has none of its own, nor anything from worker/', () => {
  const src = readFileSync('tools/import-recipes.mjs', 'utf8');
  assert.match(src, /import \{ sameRecipe, categoriesOf, CATEGORIES, norm \} from '\.\.\/public\/recipes\.js';/);
  assert.ok(!/function (sameRecipe|categoriesOf|norm)\b/.test(src));
  assert.ok(!/from '\.\.\/worker\//.test(src));
});

test('I12: SHUKI_URL=http://example.com: refused before any request', () => {
  const r = runTool([FIX], { SHUKI_URL: 'http://example.com', SHUKI_TOKEN: 'x' });
  assert.equal(r.rc, 2);
  assert.equal(r.out.trim(), 'SHUKI_URL חייב להתחיל ב-https:// (או http:// רק למחשב הזה).');
});

test('I13: by the parsed host, not how the string starts: http://127.0.0.1.example.com is refused; --only of a name twice stops', () => {
  assert.equal(runTool([FIX], { SHUKI_URL: 'http://127.0.0.1.example.com', SHUKI_TOKEN: 'x' }).rc, 2);
  assert.equal(runTool([FIX], { SHUKI_URL: 'http://localhost.example.com:8751', SHUKI_TOKEN: 'x' }).rc, 2);
  const r = runTool([FIX, '--dry-run', '--only=חביתה']);
  assert.equal(r.rc, 2);
  assert.equal(r.out.trim(), 'יש שני מתכונים בשם הזה: #1 ו-#2. איזה מהם? אפשר לכתוב --only=<מספר>.');
});

/* ---- question 4 (approved 15/10): quantities in an ingredient line ---- */
import { lineOf, parseLine } from '../public/recipes.js';

test('Q4-1: רבע, שליש, 3/4 and 2/3 instead of 0.25, 0.33, 0.75 and 0.67; the rest as before', () => {
  const L = (qty, unit, name) => lineOf({ qty, unit, name });
  assert.equal(L(0.25, 'כפית', 'מלח'), 'רבע כפית מלח');
  assert.equal(L(1 / 3, 'כוס', 'שמן'), 'שליש כוס שמן');
  assert.equal(L(0.333, 'כוס', 'שמן'), 'שליש כוס שמן');
  assert.equal(L(0.75, 'כוס', 'סוכר'), '3/4 כוס סוכר');
  assert.equal(L(2 / 3, 'כוס', 'מים'), '2/3 כוס מים');
  assert.equal(L(0.5, 'כוס', 'סוכר'), 'חצי כוס סוכר');
  assert.equal(L(1.5, 'כוס', 'מים'), '1.5 כוסות מים');
  assert.equal(L(0.13, 'כפית', 'מלח'), '0.13 כפית מלח');
  assert.equal(L(0.25, null, 'כרוב'), 'רבע כרוב');
  assert.equal(L(null, null, 'מלח'), 'מלח');
  assert.equal(L(null, 'קורט', 'קינמון'), 'קורט קינמון');
});

test('Q4-2: one of a weight says the 1 ("1 גרם שמרים", "1 ק"ג עוף"); one of anything else stays "כוס קמח", "קופסת טונה"', () => {
  assert.equal(lineOf({ qty: 1, unit: 'גרם', name: 'שמרים' }), '1 גרם שמרים');
  assert.equal(lineOf({ qty: 1, unit: 'ק"ג', name: 'עוף' }), '1 ק"ג עוף');
  assert.equal(lineOf({ qty: 1, unit: 'כוס', name: 'קמח' }), 'כוס קמח');
  assert.equal(lineOf({ qty: 1, unit: 'קופסה', name: 'טונה' }), 'קופסת טונה');
  assert.equal(lineOf({ qty: 1, unit: null, name: 'בצל' }), 'בצל');
});

test('Q4-3: every new line reads back to the same quantity, unit and name (the recipe\'s edit)', () => {
  for (const [qty, unit, name] of [[0.25, 'כפית', 'מלח'], [1 / 3, 'כוס', 'שמן'], [0.75, 'כוס', 'סוכר'], [2 / 3, 'כוס', 'מים'], [1, 'גרם', 'שמרים'], [1, 'ק"ג', 'עוף']]) {
    const p = parseLine(lineOf({ qty, unit, name }));
    assert.equal(Math.round(p.qty * 100) / 100, Math.round(qty * 100) / 100);
    assert.equal(p.unit, unit);
    assert.equal(p.name, name);
  }
});

/* ---- question 13 (the owner 15/10): an ingredient line goes out (lineOf) and back (parseIngredients, the recipe's edit) whole ---- */
import { parseIngredients, unitWord } from '../public/recipes.js';
const UNIT_LIST = ['כוס', 'כף', 'כפית', 'גרם', 'ק"ג', 'ליטר', 'מ"ל', 'קורט', 'שן', 'צרור', 'ענף', 'פרוסה', 'קופסה', 'פחית', 'שקית', 'חבילה', 'גביע', 'מיכל', 'צנצנת', 'בקבוק', 'יחידה', 'קרטון', 'אריזה', 'חופן', 'קוביה'];

test('Q13-1: every unit, with any quantity, comes back with the same quantity, unit and name ("כוס קמח" is one cup)', () => {
  for (const u of UNIT_LIST) assert.ok(u === unitWord(u, 1), u); // the list is the singulars
  const items = UNIT_LIST.flatMap((unit) => [1, 2, 3, 0.5, 0.25, 1 / 3, 0.75, 2 / 3, 1.5].map((qty) => ({ qty, unit, name: 'קמח מלא' })));
  const back = []; // parseIngredients takes up to 60 lines, a recipe's most
  for (let k = 0; k < items.length; k += 60) back.push(...parseIngredients(items.slice(k, k + 60).map(lineOf).join('\n')));
  assert.equal(back.length, items.length);
  items.forEach((x, k) => {
    const y = back[k];
    assert.deepEqual([Math.round(y.qty * 100) / 100, y.unit, y.name], [Math.round(x.qty * 100) / 100, x.unit, x.name], lineOf(x));
  });
});

test('Q13-2: a unit with no quantity keeps its unit and name ("קורט מלח", "ענף נענע": as one, "פרוסה" as "פרוסת"; "גרם נענע": still none)', () => {
  for (const unit of UNIT_LIST) {
    const x = { qty: null, unit, name: 'נענע' };
    const [y] = parseIngredients(lineOf(x));
    const weight = ['גרם', 'ק"ג'].includes(unit);
    // as one, it reads as one does: "פרוסה נענע" (no quantity) comes back "פרוסת נענע"
    assert.equal(lineOf(y), lineOf(weight ? x : { ...x, qty: 1 }), unit);
    assert.deepEqual([y.qty, y.unit, y.name], [weight ? null : 1, unit, 'נענע'], unit);
  }
});

test('Q13-3: a name that starts with a unit word doesn\'t break: the line the page shows is the same after an edit', () => {
  const xs = [{ qty: 4, unit: null, name: 'קוביות קרח' }, { qty: null, unit: null, name: 'קוביות קרח' }, { qty: null, unit: null, name: 'שיני שום' }, { qty: null, unit: null, name: 'כפות תמרים' }, { qty: 2, unit: null, name: 'כוסות נייר' }, { qty: null, unit: null, name: 'כוס קפה' }, { qty: 3, unit: null, name: 'כוסברה' }, { qty: null, unit: null, name: 'שן הארי' }, { qty: 1, unit: 'כוס', name: 'כוסברה קצוצה' }];
  for (const x of xs) {
    const [y] = parseIngredients(lineOf(x));
    assert.equal(lineOf(y), lineOf(x), lineOf(x));
  }
  // and the forms with no number keep the whole name, not a unit
  for (const n of ['קוביות קרח', 'שיני שום', 'כפות תמרים']) assert.deepEqual(parseIngredients(n).map((y) => [y.qty, y.unit, y.name]), [[null, null, n]]);
});

test('Q13-4: what people type with no number: one of the unit ("כף שמן", "קופסא של רסק"), a weight with none ("קילו עוף"); "כוס וחצי" is still 1.5', () => {
  const p = (t) => { const [y] = parseIngredients(t); return [y.qty, y.unit, y.name]; };
  assert.deepEqual(p('כף שמן'), [1, 'כף', 'שמן']);
  assert.deepEqual(p('קילו עוף'), [null, 'ק"ג', 'עוף']);
  assert.deepEqual(p('קופסא של רסק'), [1, 'קופסה', 'רסק']);
  assert.deepEqual(p('כוס וחצי סוכר'), [1.5, 'כוס', 'סוכר']);
  assert.deepEqual(p('2 כפות שמן זית'), [2, 'כף', 'שמן זית']);
  assert.deepEqual(p('שום 3 שיניים'), [3, 'שן', 'שום']);
});

test('Q13-5: a number at the end with the unit at the start keeps the unit; a plural unit with no number stays in the name but still links and is still a staple', async () => {
  const { isStaple, linkProduct } = await import('../public/recipes.js');
  const p = (t) => { const [y] = parseIngredients(t); return [y.qty, y.unit, y.name]; };
  assert.deepEqual(p('שיני שום 3'), [3, 'שן', 'שום']);
  assert.deepEqual(p('כפות סוכר 2'), [2, 'כף', 'סוכר']);
  assert.deepEqual(p("גר' סוכר"), [null, 'גרם', 'סוכר']);
  const old = parseIngredients('קמח, שיני שום, כפות שמן זית, מלח');
  assert.deepEqual(old.map((y) => y.name), ['קמח', 'שיני שום', 'כפות שמן זית', 'מלח']);
  assert.ok(isStaple('כפות שמן זית', null));
  assert.ok(!isStaple('כפות תמרים', null));
  const products = [{ id: 1, name: 'שום', aliases: '[]' }, { id: 2, name: 'לחם', aliases: '[]' }];
  assert.equal(linkProduct('שיני שום', products)?.id, 1);
  assert.equal(linkProduct('פרוסות לחם', products)?.id, 2);
  assert.equal(linkProduct('כוסברה', products), null);
});
