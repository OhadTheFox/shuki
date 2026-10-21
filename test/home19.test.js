// home19 (the owner's use on 17/10, evening): rules without a server. Each test fails on 6142af5 (there, the functions aren't there,
// or say otherwise).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const sh = () => import('../worker/shuki.js');

test('ה19-11: "שמתי לב ש…" למי שזה עליו: בגוף שני, אף פעם לא בשם (17/10: "שמתי לב שthe owner עושה כמעט תמיד את הסופר", לthe owner)', async () => {
  const { noticedText } = await import('../worker/instincts.js');
  const users = [{ id: 1, name: 'the owner', gender: 'm' }, { id: 2, name: 'הילה', gender: 'f' }];
  const row = { kind: 'buyer', user_id: 1, data: JSON.stringify({ v: 'super' }) };
  assert.equal(noticedText(row, { users, products: [], me: users[0] }), 'אתה עושה כמעט תמיד את הסופר.');
  assert.equal(noticedText({ ...row, user_id: 2 }, { users, products: [], me: users[1] }), 'את עושה כמעט תמיד את הסופר.');
  assert.equal(noticedText(row, { users, products: [], me: users[1] }), 'the owner עושה כמעט תמיד את הסופר.', 'to another: by the name');
  const want = { kind: 'want', user_id: 2, product_id: 5, data: JSON.stringify({ v: 2 }) };
  assert.match(noticedText(want, { users, products: [{ id: 5, name: 'חלב', count_type: 'units', unit: 'קרטון' }], me: users[1] }), /^כשאת מוסיפה חלב לרשימה, את תמיד מוסיפה /);
});

test('ה19-1: מה ההודעה מזכירה: יחיד ורבים, ה- ו-ו-, ומילה ראשונה; "שום" לא בתוך "שומשום"', async () => {
  const { namedIn } = await sh();
  assert.ok(namedIn('והבננות גם שם', ['6 בננות']));
  assert.ok(namedIn('נגמרה העגבנייה', ['עגבניות']));
  assert.ok(namedIn('יש 5 לימונים', ['לימון']));
  assert.ok(!namedIn('יש במזווה רכז רימונים. יש 5 לימונים על השולחן', ['עגבניות']));
  assert.ok(!namedIn('יש שומשום', ['שום סיני מארז']));
});

test('ה19-1: שורה על מוצר שלא הוזכר יורדת, והזזה למקום שבו הוא כבר נמצא יורדת; "הכל" / בלי שום שם: הכרטיס כמו שהוא', async () => {
  const { unsaidDrop, countedSaid } = await sh();
  const state = { products: [{ id: 1, name: 'עגבניות', location_id: 1, aliases: [] }, { id: 2, name: '6 בננות', location_id: 3, aliases: [] }, { id: 3, name: 'לימון כבוש', location_id: 3, aliases: [] }], locations: [{ id: 1, name: 'מקרר' }, { id: 3, name: 'מזווה' }], list: [] };
  const text = 'יש במזווה רכז רימונים. יש 5 לימונים על השולחן בפינת אוכל, והבננות גם שם';
  const acts = [{ kind: 'create', product: { name: 'רכז רימונים', location_id: 'מזווה' } }, { kind: 'edit', product_id: 2, fields: { location_id: 'מזווה', place_said: 'פינת אוכל' } }, { kind: 'edit', product_id: 1, fields: { location_id: 'מקרר', qty: 5 } }];
  const u = unsaidDrop(text, acts, state);
  assert.deepEqual(u.dropped, ['עגבניות']);
  assert.equal(unsaidDrop(text, [{ kind: 'edit', product_id: 1, fields: { location_id: 'מקרר' } }], state).actions.length, 0, 'a move to where it is');
  assert.equal(unsaidDrop('תוסיף את הכל', [{ kind: 'list_add', product_id: 1 }, { kind: 'list_add', product_id: 3 }], state).actions.length, 2);
  assert.equal(unsaidDrop('כן', [{ kind: 'list_add', product_id: 1 }], state).actions.length, 1);
  assert.equal(unsaidDrop('לא נגמר היין', [{ kind: 'create', product: { name: 'יין לבן' } }, { kind: 'create', product: { name: 'קולה זירו' } }], state, ['לרשום שיש 1.5 בקבוקי קולה זירו']).actions.length, 2, 'what the last card named');
  const c = countedSaid(text, u.actions, state, null);
  const lemon = c.actions.find((a) => a.kind === 'create' && a.product.name === 'לימונים');
  assert.ok(lemon, JSON.stringify(c.actions));
  assert.equal(lemon.product.qty, 5); assert.equal(lemon.product.place_said, 'פינת אוכל');
});

test('ה19-15: "בקבוק וחצי", "חצי קילו": הכמות לפי מה שנאמר, רק במוצר חדש בשם הזה', async () => {
  const { amountsSaid } = await sh();
  const c = (n, o) => ({ kind: 'create', product: { name: n, ...o } });
  const out = amountsSaid('בוא נמפה את המקרר: תפוח אדמה 1, בקבוק וחצי קולה זירו וחצי קילו בורגול', [c('קולה זירו', { count_type: 'level', level: 'little' }), c('בורגול', { count_type: 'units', qty: 1, unit: 'ק"ג' })]);
  assert.deepEqual(out[0].product, { name: 'קולה זירו', count_type: 'units', qty: 1.5, unit: 'בקבוק' });
  assert.equal(out[1].product.qty, 0.5);
  assert.deepEqual(amountsSaid('וחצי קילו בורגול', [c('בורגול', { count_type: 'level', level: 'plenty' })])[0].product.count_type, 'level', 'by level: stays');
});

test('ה19-2: "מיוקל זה סוג של מיונז": כינוי על המוצר שבבית (edit aliases), לא lesson', async () => {
  const { aliasSaid } = await sh();
  const ps = [{ id: 13, name: 'מיוקל', aliases: [] }, { id: 14, name: 'חלב', aliases: [] }];
  assert.deepEqual(aliasSaid('מיוקל זה סוג של מיונז', [{ kind: 'lesson', text: 'מיוקל הוא סוג של מיונז.' }], ps), [{ kind: 'edit', product_id: 13, fields: { aliases: ['מיונז'] } }]);
  assert.deepEqual(aliasSaid('חלב זה חשוב', [], ps), [], 'not a name');
});

test('ה19-13: edit עם item_id של שורה ברשימה: המוצר של השורה', async () => {
  const { productIds } = await sh();
  const state = { products: [{ id: 7, name: 'ביצים', aliases: [] }], list: [{ id: 3, product_id: 7 }] };
  assert.deepEqual(productIds([{ kind: 'edit', item_id: 3, fields: { qty: 6 } }], state), [{ kind: 'edit', product_id: 7, fields: { qty: 6 } }]);
  assert.deepEqual(productIds([{ kind: 'edit', item_id: 9, fields: { qty: 6 } }], state), [{ kind: 'edit', item_id: 9, fields: { qty: 6 } }], 'no such row: as it was');
});

test('ה19-8: "לשמור את המתכון למנה של אושרי", לא "להמנה" (h19-a, המודל האמיתי)', async () => {
  const { describeActions } = await sh();
  const l = describeActions([{ kind: 'recipe', name: 'המנה של אושרי', ingredients: '4 ביצים\nעגבנייה סחוטה' }], { products: [], locations: [], categories: [], users: [], list: [] });
  assert.equal(l[0].text, 'לשמור את המתכון למנה של אושרי?');
  assert.equal(describeActions([{ kind: 'recipe', name: 'שקשוקה', ingredients: 'ביצים' }], { products: [], locations: [], categories: [], users: [], list: [] })[0].text, 'לשמור את המתכון לשקשוקה?');
});
