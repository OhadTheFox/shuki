// 16/10 (the owner): an ingredient's name without how it's cut and without the unit's size, linked singular or plural and by
// another name; the line stays as written, and what goes on the list is the product's name or the base name.
// Run: node --test test/ingredients16.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, parseIngredients, lineOf, linkProduct, recipeStatus, basePrep } from '../public/recipes.js';

const P = [{ id: 1, name: 'פלפל אדום' }, { id: 2, name: 'עגבנייה' }, { id: 3, name: 'שום' }, { id: 4, name: 'בצל' }, { id: 5, name: 'סוכר' }, { id: 6, name: 'ביצים' }, { id: 7, name: 'חלב' }, { id: 8, name: 'שמן' }, { id: 9, name: 'קמח' }, { id: 10, name: 'מלח' }];
test('the unit\'s size is the unit\'s: "כף גדושה סוכר" is sugar, and the line stays', () => {
  for (const [line, name, unit] of [['כף גדושה סוכר', 'סוכר', 'כף'], ['כפית שטוחה מלח', 'מלח', 'כפית'], ['כוס מלאה קמח', 'קמח', 'כוס'], ['2 כפות גדושות סוכר', 'סוכר', 'כף'], ['כף עגולה סוכר', 'סוכר', 'כף'], ['כוס נדיבה קמח', 'קמח', 'כוס']]) {
    const p = parseLine(line); assert.deepEqual([p.name, p.unit], [name, unit], line);
    assert.equal(lineOf(p), line, `the line of ${line}`); assert.equal(parseLine(lineOf(p)).name, name, `round trip ${line}`);
  }
});
test('how it is cut is not its name: "2 גמבות ברצועות" is גמבות; "בשר טחון" and "עגבניות מרוסקות" stay', () => {
  for (const [line, name] of [['2 גמבות ברצועות', 'גמבות'], ['3 שיני שום פרוסות', 'שום'], ['בצל קצוץ דק', 'בצל'], ['עגבנייה חתוכה לקוביות', 'עגבנייה'], ['גזר מגורד', 'גזר'], ['כוסברה טרייה', 'כוסברה'], ['פטרוזיליה טרייה קצוצה', 'פטרוזיליה'], ['חומוס מבושל', 'חומוס'],
    ['חצי קילו בשר טחון', 'בשר טחון'], ['200 גרם שקדים טחונים', 'שקדים טחונים'], ['25 גרם שמרים טריים', 'שמרים טריים'], ['קופסת עגבניות מרוסקות', 'עגבניות מרוסקות'], ['פטה (לא חובה)', 'פטה (לא חובה)'], ['פטרוזיליה קצוצה (לא חובה)', 'פטרוזיליה (לא חובה)']]) {
    const p = parseLine(line); assert.equal(p.name, name, line); assert.equal(p.line, line);
    assert.equal(lineOf(p), line, `the line of ${line}`);
  }
  assert.equal(parseIngredients('2 גמבות ברצועות\nבצל קצוץ').map((x) => x.name).join(','), 'גמבות,בצל');
});
test('linked singular or plural and by another name, not by a look-alike', () => {
  for (const [n, want] of [['גמבות', 'פלפל אדום'], ['גמבה', 'פלפל אדום'], ['עגבניות', 'עגבנייה'], ['שיני שום', 'שום'], ['בצלים', 'בצל'], ['ביצה', 'ביצים'], ['גמבות ברצועות', 'פלפל אדום'], ['גדושה סוכר', null], ['שמנת', null], ['חלבה', null], ['סוכריות', null]]) {
    assert.equal(linkProduct(n, P)?.name ?? null, want, n);
  }
  assert.equal(basePrep('שום פרוסות'), 'שום');
});
test('what goes on the list: the product\'s name, or the base name', () => {
  const ings = ['2 גמבות ברצועות', 'פטרוזיליה קצוצה', '3 שיני שום פרוסות'].map(parseLine).map((x, k) => ({ ...x, id: k, product_id: linkProduct(x.name, P)?.id ?? null }));
  const st = recipeStatus({ serves: 2 }, ings, P.map((p) => ({ ...p, count_type: 'level', level: p.id === 1 ? 'none' : 'plenty' })), 2);
  assert.deepEqual(st.items.map((i) => i.listName), ['פלפל אדום', 'פטרוזיליה', 'שום']);
  assert.equal(recipeStatus({}, [{ id: 9, name: 'שום פרוסות', unit: null, qty: 2, product_id: null }], P, 0).items[0].listName, 'שום'); // an old name, stored before
});
