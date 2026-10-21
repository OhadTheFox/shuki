// home20 (section 16): the week against the house, and the plan's words (docs/home20-wordings.md).
// Run: node --test test/home20.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekNeeds, findDish, planLine, planOffLine, forDish, forDishes, unlistQuestion, whichDish, planDays, plannable, planView, planText, addDays, todayOf } from '../worker/plan.js';
import { missingActions } from '../worker/shuki.js';

const eggs = (qty) => ({ id: 1, name: 'ביצים', count_type: 'units', qty, unit: null, deleted: null });
const milk = { id: 2, name: 'חלב', count_type: 'level', level: 'none', deleted: null };
const ing = (name, qty, product_id) => ({ name, qty, unit: null, product_id, line: name });
const shakshuka = { id: 10, name: 'שקשוקה', serves: null, ings: [ing('ביצים', 3, 1)] };
const quiche = { id: 11, name: 'פשטידת התרד של דנה', serves: null, ings: [ing('ביצים', 3, 1), ing('חלב', null, 2), ing('תרד', 1, null)] };
const st = (products, list = []) => ({ recipes: [shakshuka, quiche], products, list });

test('two dishes of 3 eggs with 4 at home: the second misses them, the week misses 2 (the sum, not the larger one)', () => {
  const { per, actions } = weekNeeds(st([eggs(4), milk]), [{ id: 1, recipe_id: 10 }, { id: 2, recipe_id: 11 }]);
  assert.equal(per.get(1).miss, 0);
  assert.equal(per.get(2).miss, 3); // eggs, milk, spinach
  const e = actions.find((a) => a.action.product_id === 1);
  assert.deepEqual(e.action, { kind: 'list_add', product_id: 1, amount: 2 });
  assert.deepEqual(e.for, [[2, 2]]);
  assert.equal(actions.filter((a) => a.action.product_id === 1).length, 1, 'counted once');
});
test('none at home: both dishes miss eggs, one line of 6, for both', () => {
  const { actions } = weekNeeds(st([eggs(0), milk]), [{ id: 1, recipe_id: 10 }, { id: 2, recipe_id: 11 }]);
  const e = actions.filter((a) => a.action.product_id === 1);
  assert.equal(e.length, 1);
  assert.equal(e[0].action.amount, 6);
  assert.deepEqual(e[0].for, [[1, 3], [2, 3]]);
});
test('what is on the list (or in the cart) is not counted, and the dish says it is listed', () => {
  const list = [{ id: 5, product_id: 2, status: 'open' }, { id: 6, product_id: null, text: 'תרד', status: 'checked' }];
  const { per, actions } = weekNeeds(st([eggs(4), milk], list), [{ id: 1, recipe_id: 10 }, { id: 2, recipe_id: 11 }]);
  assert.deepEqual(actions.map((a) => a.key), ['p1']);
  assert.equal(per.get(2).listed, 2);
  // a bought line (done) isn't on the list any more
  const done = weekNeeds(st([eggs(4), milk], [{ id: 5, product_id: 2, status: 'done' }]), [{ id: 2, recipe_id: 11 }]);
  assert.ok(done.actions.some((a) => a.key === 'p2'));
  // ignoreList: what the dishes need whatever is on the list
  assert.equal(weekNeeds(st([eggs(4), milk], list), [{ id: 2, recipe_id: 11 }], { ignoreList: true }).actions.length, 2); // milk, spinach (4 eggs are enough)
});
test('a dish without a recipe needs nothing; the order of the days decides who misses', () => {
  const { per, actions } = weekNeeds(st([eggs(4), milk]), [{ id: 2, recipe_id: 11 }, { id: 3, recipe_id: null }, { id: 1, recipe_id: 10 }]);
  assert.equal(per.get(3).miss, 0);
  assert.equal(per.get(2).miss, 2); // the quiche first: its 3 eggs are there
  assert.equal(per.get(1).miss, 1); // the shakshuka after it: 1 left of 3
  assert.equal(actions.find((a) => a.key === 'p1').action.amount, 2);
});
test('missingActions of two recipes sums too (was the larger amount, worker/shuki.js)', () => {
  const acts = missingActions({ products: [eggs(4), milk], list: [] }, [shakshuka, quiche]);
  assert.deepEqual(acts.find((a) => a.product_id === 1), { kind: 'list_add', product_id: 1, amount: 2 });
  assert.deepEqual(missingActions({ products: [eggs(4), milk], list: [] }, [shakshuka]), []); // one recipe as before
});
test('the words: card lines, "בשביל", the question on the list (docs/home20-wordings.md)', () => {
  const now = Date.parse('2026-10-18T09:00:00Z'); // Sunday
  assert.equal(planLine({ name: 'דגים', recipe_id: null }, '2026-10-18', now), 'לתכנן דגים להיום');
  assert.equal(planLine({ name: 'פשטידת התרד של דנה', recipe_id: 11 }, '2026-10-19', now), 'לתכנן את פשטידת התרד של דנה למחר');
  assert.equal(planLine({ name: 'שקשוקה', recipe_id: 10 }, '2026-10-21', now), 'לתכנן את השקשוקה ליום רביעי');
  assert.equal(planLine({ name: 'קציצות ברוטב', recipe_id: 9 }, '2026-10-23', now), 'לתכנן את הקציצות ברוטב ליום שישי');
  assert.equal(planOffLine({ name: 'דגים' }, '2026-10-18', now), 'להוריד את הדגים מהתכנון של היום');
  assert.equal(planOffLine({ name: 'שקשוקה' }, '2026-10-21', now), 'להוריד את השקשוקה מהתכנון של יום רביעי');
  assert.equal(forDish('פשטידת התרד של דנה'), 'בשביל הפשטידה');
  assert.equal(forDish('קציצות ברוטב'), 'בשביל הקציצות');
  assert.equal(forDishes(['פשטידת התרד', 'עוף בתנור']), 'בשביל הפשטידה והעוף');
  assert.equal(unlistQuestion('פשטידה'), 'האם להוריד מהרשימה את מה שנכנס בשבילה?');
  assert.equal(unlistQuestion('חמין'), 'האם להוריד מהרשימה את מה שנכנס בשבילו?');
  assert.equal(unlistQuestion('קציצות ברוטב'), 'האם להוריד מהרשימה את מה שנכנס בשבילן?');
  assert.equal(unlistQuestion('דגים'), 'האם להוריד מהרשימה את מה שנכנס בשבילם?');
  assert.equal(whichDish('דנה'), 'איזו מנה של דנה?');
});
test('the days: seven from today by the house\'s date; what can be planned', () => {
  const now = Date.parse('2026-10-17T22:30:00Z'); // Sunday 01:30 in Israel
  assert.equal(todayOf(now), '2026-10-18');
  assert.deepEqual(planDays(now), ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.ok(plannable('2026-10-18', now) && plannable('2026-10-31', now));
  assert.ok(!plannable('2026-10-17', now) && plannable('2026-10-17', now, -1));
  assert.ok(!plannable('2026-11-01', now) && !plannable('2026-02-30', now) && !plannable('מחר', now));
});
test('"המנה של דנה": hers by who added it or by its name; several: the question; none: a dish without a recipe', () => {
  const users = [{ id: 1, name: 'אבי' }, { id: 2, name: 'דנה' }];
  const recipes = [{ id: 1, name: 'פשטידת התרד של דנה', added_by: 1 }, { id: 2, name: 'עוגת גזר', added_by: 2 }, { id: 3, name: 'שקשוקה', added_by: 1 }];
  assert.deepEqual(findDish({ users, recipes }, { name: 'שקשוקה' }), { recipe_id: 3, name: 'שקשוקה' });
  const two = findDish({ users, recipes }, { text: 'המנה של דנה' });
  assert.equal(two.ask, 'איזו מנה של דנה?'); assert.deepEqual(two.options, ['פשטידת התרד של דנה', 'עוגת גזר']);
  assert.deepEqual(findDish({ users, recipes: recipes.slice(0, 1) }, { text: 'המנה של דנה' }), { recipe_id: 1, name: 'פשטידת התרד של דנה' });
  assert.deepEqual(findDish({ users, recipes }, { text: 'המנה של אושרי' }), { recipe_id: null, name: 'המנה של אושרי' });
  assert.deepEqual(findDish({ users, recipes }, { text: 'דגים' }), { recipe_id: null, name: 'דגים' });
  assert.equal(findDish({ users, recipes: [{ id: 4, name: 'מרק', status: 'suggested' }] }, { name: 'מרק' }).recipe_id, null, 'a suggestion is not a saved recipe');
});
test('planView: the week from today, yesterday\'s question only for a recipe, and the model\'s line', () => {
  const now = Date.parse('2026-10-18T09:00:00Z');
  const rows = [
    { id: 1, day: '2026-10-17', pos: 0, recipe_id: 10, name: 'שקשוקה', status: 'planned' },
    { id: 2, day: '2026-10-18', pos: 0, recipe_id: 11, name: 'פשטידת התרד של דנה', status: 'planned' },
    { id: 3, day: '2026-10-19', pos: 0, recipe_id: null, text: 'דגים', name: 'דגים', status: 'planned' },
  ];
  const v = planView(rows, st([eggs(4), milk]), now);
  assert.deepEqual(v.yesterday, { id: 1, recipe_id: 10, name: 'שקשוקה', ask: 'האם הכנתם אתמול את השקשוקה?' });
  assert.equal(planView([{ ...rows[0], name: 'קציצות ברוטב' }], st([]), now).yesterday.ask, 'האם הכנתם אתמול את הקציצות ברוטב?');
  assert.deepEqual(v.dishes.map((d) => d.id), [2, 3]);
  assert.equal(v.dishes[0].miss, 2); assert.equal(v.missing, 2);
  assert.equal(planView([{ ...rows[0], recipe_id: null, text: 'פיצה', name: 'פיצה' }], st([]), now).yesterday, null);
  assert.equal(planText(v), 'התכנון לשבוע (date: מנות): 2026-10-18 (ראשון, היום): פשטידת התרד של דנה; 2026-10-19 (שני, מחר): דגים (בלי מתכון)');
});

// ---- round 2 (the owner 19/10) ----
import { describeActions } from '../worker/shuki.js';
test('fix 1: a recipe\'s single eggs against eggs kept as a pack of 12: the list gets one pack, the card says "9 ביצים L"', () => {
  const pack = { id: 1, name: 'ביצים L', count_type: 'pack', pack_size: 12, qty: 0, deleted: null };
  const r1 = { id: 20, name: 'שקשוקה', ings: [ing('ביצים', 6, 1)] }, r2 = { id: 21, name: 'חביתה', ings: [ing('ביצים', 3, 1)] };
  const { actions } = weekNeeds({ recipes: [r1, r2], products: [pack], list: [] }, [{ id: 1, recipe_id: 20 }, { id: 2, recipe_id: 21 }]);
  assert.deepEqual(actions[0].action, { kind: 'list_add', product_id: 1, units: 9 }); // one pack: no amount
  const lines = describeActions(actions.map((a) => a.action), { products: [pack], list: [], locations: [], categories: [], users: [] }).map((l) => l.text);
  assert.deepEqual(lines, ['להוסיף 9 ביצים L לרשימה?']);
  // 30 eggs: 3 packs on the list, the card says the eggs
  const big = weekNeeds({ recipes: [{ id: 22, name: 'פשטידה', ings: [ing('ביצים', 30, 1)] }], products: [pack], list: [] }, [{ id: 1, recipe_id: 22 }]).actions[0].action;
  assert.deepEqual(big, { kind: 'list_add', product_id: 1, amount: 3, units: 30 });
  assert.ok(!/אריזות/.test(describeActions([big], { products: [pack], list: [], locations: [], categories: [], users: [] })[0].text));
  // missingActions (the recipe page's "להוסיף את מה שחסר לרשימה", the old planCard) the same way
  assert.deepEqual(missingActions({ products: [pack], list: [] }, [r1, r2]), [{ kind: 'list_add', product_id: 1, units: 9 }]);
});
