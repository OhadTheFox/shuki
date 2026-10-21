// home19, recipes (the owner's list after home18, items 2-5 and 9, and the infrastructure for 7): the ingredients' links to the
// inventory, the recipe screen and the recipe card, without a server. Each test fails on 6142af5.
// Run: node --test test/home19-recipes.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingFor } from '../worker/recipes.js';

const P = (id, name, o = {}) => ({ id, name, aliases: '[]', deleted: null, private_to: null, count_type: 'units', qty: 1, level: null, is_open: 0, unit: null, ...o });

test('ה19-ת: missingFor, אחת לשרת ולאפליקציה: לכל מצרך אם יש, באיזה מוצר ואיזו חלופה', () => {
  const products = [P(1, 'שמן קנולה', { count_type: 'inuse', qty: 0, is_open: 1 }), P(2, 'ביצים', { count_type: 'pack', qty: 4 }), P(3, 'שום סיני מארז')];
  const r = missingFor('6 ביצים\nשמן חמניות או קנולה\n3 שיני שום פרוסות\nכוסברה', products);
  const by = Object.fromEntries(r.items.map((x) => [x.name, x]));
  assert.equal(by['ביצים'].have, false, '4 eggs, 6 needed');
  assert.equal(by['ביצים'].short, 2);
  assert.deepEqual(by['ביצים'].product, { id: 2, name: 'ביצים' });
  assert.equal(by['שמן חמניות או קנולה'].have, true);
  assert.equal(by['שמן חמניות או קנולה'].alt, 'שמן קנולה', 'which of the two is at home');
  assert.deepEqual(by['שום'].product, { id: 3, name: 'שום סיני מארז' });
  assert.equal(by['כוסברה'].have, false);
  assert.equal(by['כוסברה'].product, null);
  assert.equal(r.missing, 2);
  // a saved recipe: the links it has stay (null = unlinked by hand), and "how many people" scales
  const saved = { serves: 2, ings: [{ id: 7, name: 'ביצים', qty: 2, unit: null, product_id: 2 }, { id: 8, name: 'שום', qty: 1, unit: 'שן', product_id: null }] };
  const s = missingFor(saved, products, 6);
  assert.equal(s.items[0].short, 2, '2 eggs for 2 → 6 for 6, 4 at home');
  assert.equal(s.items[1].product, null, 'unlinked by hand stays unlinked');
});

import { parseLine, linkProduct, recipeStatus, lineOf, isStaple } from '../public/recipes.js';
const link = (line, products) => { const i = parseLine(line); return linkProduct(i.name, products)?.name ?? null; };

test('ה19-3א: "3 פילה אנשובי" הוא אנשובי: "פילה", "נתחי", "פילטים" אחרי מספר הם יחידה, ובלי מספר הקישור קורא דרכם', () => {
  assert.deepEqual(['qty', 'unit', 'name'].map((k) => parseLine('3 פילה אנשובי')[k]), [3, 'פילה', 'אנשובי']);
  assert.deepEqual(['qty', 'unit', 'name'].map((k) => parseLine('4 נתחי עוף')[k]), [4, 'נתח', 'עוף']);
  assert.deepEqual(['qty', 'unit', 'name'].map((k) => parseLine('2 פילטים סלמון')[k]), [2, 'פילה', 'סלמון']);
  assert.equal(parseLine('פילה סלמון').name, 'פילה סלמון', 'no number: the name as written (the ⚠ lines say "פילה סלמון")');
  const home = [P(1, 'פילה אנשובי'), P(2, 'סלמון'), P(3, 'עוף')];
  assert.equal(link('3 פילה אנשובי', home), 'פילה אנשובי', 'the product\'s "פילה" is read through too');
  assert.equal(link('פילה סלמון', home), 'סלמון');
  assert.equal(link('נתחי עוף', home), 'עוף');
  assert.equal(link('אנשובי', home), 'פילה אנשובי');
  // a can of anchovy fillets at home, three fillets in the recipe: ✓, not "1 of 3"
  const st = recipeStatus({}, [{ id: 1, ...parseLine('3 פילה אנשובי'), product_id: 1 }], home);
  assert.equal(st.items[0].ok, true);
  assert.equal(st.items[0].counted, false);
  const was = recipeStatus({}, [{ id: 1, name: 'פילה אנשובי', qty: 3, unit: null, product_id: 1 }], home);
  assert.equal(was.items[0].ok, true, 'as a recipe saved before kept it: "פילה אנשובי", 3, no unit');
  // the line reads back the same
  for (const l of ['3 פילה אנשובי', '1 פילה אנשובי', '4 נתחי עוף']) { const i = parseLine(l); assert.deepEqual(parseLine(lineOf(i)), { ...i, line: lineOf(i) }, l); }
  assert.equal(lineOf({ qty: 1, unit: 'פילה', name: 'אנשובי' }), '1 פילה אנשובי');
});

test('ה19-3ג: "שמן חמניות או קנולה" מתקשר אם יש אחת החלופות, ומראה איזו', () => {
  const canola = P(1, 'שמן קנולה', { count_type: 'inuse', qty: 0, is_open: 1 });
  assert.equal(link('שמן חמניות או קנולה', [canola]), 'שמן קנולה');
  assert.equal(link('חמאה או מרגרינה', [P(2, 'מרגרינה')]), 'מרגרינה');
  assert.equal(link('פלפל אדום או צהוב', [P(3, 'פלפל צהוב')]), 'פלפל צהוב');
  // both in the inventory, the first ran out: the one at home
  const sun = P(4, 'שמן חמניות', { count_type: 'inuse', qty: 0, is_open: 0 });
  assert.equal(link('שמן חמניות או קנולה', [sun, canola]), 'שמן קנולה');
  const st = recipeStatus({}, [{ id: 1, name: 'שמן חמניות או קנולה', qty: null, unit: null, product_id: 4 }], [sun, canola]);
  assert.equal(st.items[0].ok, true, 'linked to the one that ran out, the other is at home');
  assert.equal(st.items[0].alt, 'שמן קנולה');
  assert.equal(isStaple('שמן חמניות או קנולה'), true, 'oil either way is a staple');
  const none = recipeStatus({}, [{ id: 1, name: 'חמאה או מרגרינה', qty: null, unit: null, product_id: null }], [P(5, 'חלב')]);
  assert.equal(none.items[0].ok, false, 'neither at home');
  assert.equal(none.items[0].alt, null);
});

test('ה19-3ד: "עגבנייה סחוטה", "גזר מגורר", "חמאה מומסת": החומר הגלם; "עגבניות מרוסקות" רק בקישור', () => {
  const home = [P(1, 'עגבניות'), P(2, 'גזר'), P(3, 'חמאה'), P(4, 'לימון'), P(5, 'תפוחי אדמה')];
  assert.equal(parseLine('עגבנייה סחוטה').name, 'עגבנייה');
  assert.equal(link('עגבנייה סחוטה', home), 'עגבניות');
  assert.equal(linkProduct('עגבנייה סחוטה', home)?.name, 'עגבניות', 'the name as the recipe kept it');
  assert.equal(link('2 גזרים מגוררים', home), 'גזר');
  assert.equal(link('50 גרם חמאה מומסת', home), 'חמאה');
  assert.equal(link('3 תפוחי אדמה קלופים', home), 'תפוחי אדמה');
  assert.equal(link('מיץ לימון סחוט', home), 'לימון', 'squeezed from lemons');
  assert.equal(parseLine('קופסת עגבניות מרוסקות').name, 'עגבניות מרוסקות', 'a can: the name keeps it');
  assert.equal(link('קופסת עגבניות מרוסקות', home), 'עגבניות');
  assert.equal(link('קופסת עגבניות מרוסקות', [...home, P(9, 'עגבניות מרוסקות')]), 'עגבניות מרוסקות', 'the can, when it is at home');
});

test('ה19-3ה: בלי קישורים שגויים: שם המוצר הוא קודם כול המילה הראשונה', () => {
  const home = [P(1, 'שומשום'), P(2, 'עגבניות'), P(3, 'לימון'), P(4, 'שום סיני מארז'), P(5, 'חלב'), P(6, 'בצל')];
  for (const [line, not] of [['שמן שומשום', 'שומשום'], ['2 כפות רסק עגבניות', 'עגבניות'], ['מיץ לימון', 'לימון'], ['אבקת שום', 'שום סיני מארז'], ['שומשום', 'שום סיני מארז'],
    ['חלב קוקוס', 'חלב'], ['אבקת בצל', 'בצל'], ['לימון כבוש', 'לימון'], ['שמן חמניות או קנולה', 'לימון']]) assert.notEqual(link(line, home), not, line);
  assert.equal(link('שמן שומשום', [P(1, 'שומשום'), P(7, 'שמן שומשום')]), 'שמן שומשום');
  assert.equal(link('שומשום', [P(7, 'שמן שומשום')]), null);
  assert.equal(link('עגבניות', [P(8, 'רסק עגבניות')]), null);
  assert.equal(link('לימון', [P(9, 'לימון פרסי שחור'), P(10, 'לימון כבוש')]), null);
  assert.equal(link("ג'ינג'ר", [P(11, "ג'ינג'ר כבוש")]), null);
  assert.equal(link('2 מלפפונים', [P(15, 'מלפפון כבוש ביתי')]), null);
  assert.equal(link('עגבניות משומרות', [P(16, 'עגבניות')]), null, 'a can is not tomatoes');
  assert.equal(link('עלי גפן', [P(17, 'עלי גפן משומרים')]), 'עלי גפן משומרים', 'vine leaves from a jar are vine leaves');
  assert.equal(link('2 כפיות שמרים יבשים', [P(12, 'שמרים')]), 'שמרים', 'dry yeast is what the house calls yeast');
  assert.equal(link('פטרוזיליה קצוצה', [P(13, 'צרור פטרוזיליה'), P(14, 'פטרוזיליה')]), 'פטרוזיליה', 'the name itself before the one after a unit word');
});

// a D1 over node:sqlite, with the house's tables from the migrations
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => db.prepare(sql).run(...args),
  });
  return { raw: db, prepare: (sql) => stmt(sql), batch: async (xs) => { for (const x of xs) await x.run(); } };
}
const product = (db, id, name, aliases = []) => db.raw.prepare("INSERT INTO products (id, name, aliases, count_type, qty, created, updated) VALUES (?, ?, ?, 'units', 1, 0, 0)").run(id, name, JSON.stringify(aliases));
const ingredient = (db, id, name, pid = null) => db.raw.prepare('INSERT INTO recipe_ingredients (id, recipe_id, pos, name, product_id, line) VALUES (?, 1, ?, ?, ?, ?)').run(id, id, name, pid, name);
const linkOf = (db, id) => db.raw.prepare('SELECT product_id FROM recipe_ingredients WHERE id = ?').get(id).product_id;

test('ה19-2: "מיונז" במתכון מתקשר ל"מיוקל" שקיבל כינוי "מיונז", גם כשהמתכון נשמר לפני הכינוי', async () => {
  const { linkNew } = await import('../worker/restart.js');
  const db = d1();
  db.raw.exec("INSERT INTO recipes (id, name, added) VALUES (1, 'סלט', 0)");
  product(db, 100, 'מיוקל');
  ingredient(db, 1, 'מיונז'); ingredient(db, 2, 'מיונז לייט'); ingredient(db, 3, 'ספייסי מיונז');
  const all = async () => (await db.prepare('SELECT id, name, aliases, deleted, private_to FROM products').all()).results;
  await linkNew(db, await all()); // the first look: the mark
  await linkNew(db, await all());
  assert.equal(linkOf(db, 1), null, 'no alias yet');
  // "מיוקל זה סוג של מיונז": the alias on the product (the manager session's part), not a new product
  db.raw.prepare('UPDATE products SET aliases = ? WHERE id = 100').run(JSON.stringify(['מיונז']));
  await linkNew(db, await all());
  assert.equal(linkOf(db, 1), 100);
  assert.equal(linkOf(db, 2), 100, '"מיונז לייט" is mayonnaise');
  assert.equal(linkOf(db, 3), null, '"ספייסי מיונז": the head noun is another word');
  // looked at once: unlinked by hand afterwards, it stays so until the aliases change again
  db.raw.prepare('UPDATE recipe_ingredients SET product_id = NULL WHERE id = 1').run();
  await linkNew(db, await all());
  assert.equal(linkOf(db, 1), null);
  // and the screen, with the aliases as the state sends them (an array)
  assert.equal(linkProduct('מיונז', [{ ...P(100, 'מיוקל'), aliases: ['מיונז'] }])?.id, 100);
});

test('ה19-3ב: פעם אחת ("7 שיני שום פרוסות" נשמר בלי מוצר), מצרכים שנשמרו בלי מוצר מתקשרים לפי הכללים של היום; קישור קיים נשאר, חוץ מקישור לדבר אחר ("לימון" ל"לימון פרסי שחור")', async () => {
  const { relinkRecipes } = await import('../worker/recipes.js');
  // "7 שיני שום פרוסות" (the owner's ✗): today's rules link it to "שום סיני מארז"; the recipe kept "שום פרוסות" with no product
  const garlic = [P(1, 'שום סיני מארז'), P(2, 'גבינת שמנת עם שום'), P(3, 'אבקת שום')];
  assert.equal(link('7 שיני שום פרוסות', garlic), 'שום סיני מארז');
  assert.equal(linkProduct('שום פרוסות', garlic)?.name, 'שום סיני מארז');

  const db = d1();
  db.raw.exec("INSERT INTO recipes (id, name, added) VALUES (1, 'דגים חריפים', 0)");
  product(db, 1, 'שום סיני מארז'); product(db, 2, 'שמן קנולה'); product(db, 3, 'פילה אנשובי'); product(db, 4, 'עגבניות'); product(db, 5, 'שומשום'); product(db, 6, 'לימון כבוש');
  ingredient(db, 11, 'שום פרוסות'); ingredient(db, 12, 'שמן חמניות או קנולה'); ingredient(db, 13, 'פילה אנשובי'); ingredient(db, 14, 'עגבנייה סחוטה');
  ingredient(db, 15, 'שמן שומשום'); ingredient(db, 16, 'לימון כבוש קצוץ', 6); ingredient(db, 17, 'כוסברה');
  // links the old rules made to another thing: to what today's rules find, or to none
  product(db, 7, 'לימון פרסי שחור'); product(db, 8, "ג'ינג'ר כבוש"); product(db, 9, "ג'ינג'ר");
  ingredient(db, 18, 'לימון', 7); ingredient(db, 19, 'לימון', 6); ingredient(db, 20, "ג'ינג'ר", 8); ingredient(db, 21, 'לימון פרסי שחור', 7);
  assert.deepEqual(await relinkRecipes(db), { linked: 5, unlinked: 2 });
  assert.deepEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map((id) => linkOf(db, id)), [1, 2, 3, 4, null, 6, null, null, null, 9, 7]);
  assert.equal(await relinkRecipes(db), null, 'once');
});

test('ה19-4: "שימו לב: יש במתכון כוסברה" לא נשאר אחרי שהכוסברה הוחלפה בפטרוזיליה; בשמירה ובכל הצגה', async () => {
  const { warnNow } = await import('../public/recipes.js');
  const I = (...xs) => xs.map((name) => ({ name }));
  assert.equal(warnNow('יש במתכון כוסברה', I('כוסברה קצוצה', 'לימון')), 'יש במתכון כוסברה');
  assert.equal(warnNow('יש במתכון כוסברה', I('פטרוזיליה קצוצה', 'לימון')), null);
  assert.equal(warnNow('שימו לב: יש במתכון כוסברה', I('פטרוזיליה')), null);
  assert.equal(warnNow('יש במתכון בוטנים', I('חמאת בוטנים')), 'יש במתכון בוטנים', 'peanuts in peanut butter');
  assert.equal(warnNow('יש במתכון בוטנים ושקדים', I('שקדים')), 'יש במתכון בוטנים ושקדים', 'one of them is still there');
  assert.equal(warnNow('יש במתכון כוסברה, ויש במתכון בוטנים', I('בוטנים')), 'יש במתכון בוטנים');
  assert.equal(warnNow('יש במתכון דגים', I('לברק טרי')), 'יש במתכון דגים', 'a group, by the code\'s words');
  assert.equal(warnNow('יש במתכון דגים', I('חזה עוף')), null);
  assert.equal(warnNow('יש במתכון גלוטן', I('קמח')), 'יש במתכון גלוטן', 'a group the code doesn\'t know stays');
  assert.equal(warnNow('לא מתאים לבית שלכם', I('קמח')), 'לא מתאים לבית שלכם', 'another sentence stays');
  // saving: the edit takes the warning (and its swap) away; a new recipe keeps only what is in it
  const { editRecipe, saveRecipe } = await import('../worker/recipes.js');
  const db = d1();
  db.raw.exec("INSERT INTO users (id, name, gender, role, active, created) VALUES (1, 'אבי', 'm', 'admin', 1, 0)");
  db.raw.exec("INSERT INTO recipes (id, name, added, warn, swap) VALUES (1, 'דגים חריפים', 0, 'יש במתכון כוסברה', 'אפשר להחליף את הכוסברה בפטרוזיליה')");
  product(db, 1, 'פטרוזיליה');
  await editRecipe(db, 1, { ings: [{ qty: 1, unit: 'שקית', name: 'פטרוזיליה' }, { name: 'לימון', qty: null }] }, { id: 1 });
  assert.deepEqual({ ...db.raw.prepare('SELECT warn, swap FROM recipes WHERE id = 1').get() }, { warn: null, swap: null });
  assert.equal(db.raw.prepare("SELECT product_id FROM recipe_ingredients WHERE recipe_id = 1 AND name = 'פטרוזיליה'").get().product_id, 1, 'a row with no product_id given is linked');
  const r = await saveRecipe(db, { id: 1, role: 'admin' }, { name: 'סלט', ingredients: 'כוסברה\nבוטנים', warn: 'יש במתכון בוטנים, ויש במתכון אגוזי מלך', swap: 'אפשר בלי' });
  assert.deepEqual({ ...db.raw.prepare('SELECT warn, swap FROM recipes WHERE id = ?').get(r.id) }, { warn: 'יש במתכון בוטנים', swap: 'אפשר בלי' });
});

test('ה19-9: הכרטיס "לשמור את המתכון" מפריד את המצרכים בפסיקים', async () => {
  const { recipeDetail } = await import('../worker/shuki.js');
  assert.equal(recipeDetail('4 ביצים\nשמן לטיגון\nלימון כבוש קצוץ\nפלפל חריף קצוץ'), '4 ביצים, שמן לטיגון, לימון כבוש קצוץ, פלפל חריף קצוץ');
  assert.equal(recipeDetail('• 2 כוסות קמח\n- 1,5 כפות סוכר\n\nמלח'), '2 כוסות קמח, 1,5 כפות סוכר, מלח', 'bullets out, "1,5" whole');
  assert.equal(recipeDetail('ביצים, חלב, קמח'), 'ביצים, חלב, קמח', 'commas already');
  const long = recipeDetail(Array.from({ length: 30 }, (_, k) => `מצרך מספר ${k + 1}`).join('\n'));
  assert.ok(long.length <= 141 && long.endsWith('…') && /, מצרך מספר \d+…$/.test(long), long);
});

test('ה19-4ב (18/10): מצרך שנוסף בעריכה ומישהו בבית אלרגי לו או לא אוכל אותו: "שימו לב: יש במתכון X", בקוד, כמו ה-⚠', async () => {
  const { factWarnHits } = await import('../worker/shuki.js');
  const { withFacts, warnNow } = await import('../public/recipes.js');
  const users = [{ id: 1, name: 'אבי' }, { id: 2, name: 'מיכל' }];
  const F = (key, value, o = {}) => ({ id: Math.random(), about: 'person', about_id: 2, key, value, private: 0, confirmed_by: 2, ...o });
  const st = (facts) => ({ facts, users });
  const x = (...names) => ({ ings: names.map((name) => ({ name })) });
  assert.deepEqual(factWarnHits(x('קמח', 'בוטנים', 'סוכר'), st([F('allergy', 'בוטנים', { confirmed_by: null })])), ['בוטנים'], 'an allergy, even not confirmed yet (as the ⚠)');
  assert.deepEqual(factWarnHits(x('חמאת בוטנים (לא חובה)', 'קמח'), st([F('allergy', 'בוטנים')])), ['חמאת בוטנים']);
  assert.deepEqual(factWarnHits(x('כוסברה קצוצה', 'לימון'), st([F('avoid', 'כוסברה')])), ['כוסברה קצוצה'], '"doesn\'t eat"');
  assert.deepEqual(factWarnHits(x('חזה עוף', 'אורז'), st([F('diet', 'צמחונית')])), ['חזה עוף'], 'a diet the code knows');
  assert.deepEqual(factWarnHits(x('סלמון', 'אורז'), st([F('diet', 'צמחונית ואוכלת דגים')])), [], 'eats fish');
  assert.deepEqual(factWarnHits(x('בוטנים'), st([F('avoid', 'בוטנים', { confirmed_by: null })])), [], 'not confirmed: not yet (as the ⚠)');
  assert.deepEqual(factWarnHits(x('בוטנים'), st([F('allergy', 'בוטנים', { private: 1 })])), [], 'a private fact: not on the shared screen');
  assert.deepEqual(factWarnHits(x('בוטנים'), st([F('allergy', 'בוטנים', { about_id: 9 })])), [], 'someone no longer in the house');
  // with Shuki's own words: the same wording, nothing twice, and a stale one still goes
  assert.equal(withFacts(null, ['בוטנים']), 'יש במתכון בוטנים');
  assert.equal(withFacts('יש במתכון בוטנים', ['בוטנים']), 'יש במתכון בוטנים');
  assert.equal(warnNow(withFacts('יש במתכון כוסברה', ['בוטנים']), x('בוטנים', 'פטרוזיליה').ings), 'יש במתכון בוטנים', 'the cilantro was edited out, the peanuts in');
  assert.equal(withFacts(null, []), null);
});
