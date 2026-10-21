// 17/10, the last round for home use: the parts that need no server.
//   ש4: buttons only for a closed choice (OPEN_Q, the first meeting's open questions: "לא" / "כן, אכתוב לך", none on the regulars)
//   ש1+ש7: "יש כבר פפריקה מעושנת במזווה. האם זו אותה פפריקה?" in the product's four forms; one product or two
//   ש5: the tone table's words
import test from 'node:test';
import assert from 'node:assert/strict';
import { OPEN_Q, twinOf, twinQuestion, twinMerge, twinApart, idleQuestion, NO_BLOCK } from '../worker/shuki.js';
import { ask, OPEN_OPTIONS } from '../worker/onboarding.js';
import { noticedText } from '../worker/instincts.js';
import { FIXED } from '../worker/fixed.js';

const avi = { id: 1, name: 'אבי', gender: 'm', role: 'admin' };
test('ש4: שאלה פתוחה בלי כפתורים, בחירה סגורה עם כפתורים', () => {
  for (const q of ['מה יש במקרר?', 'יש! המזווה ממופה. מה יש בארון המטבח?', 'מה מבדיל ביניהם?', 'מה ההבדל בין שתי הפפריקות?', 'מה עוד יש במזווה?']) assert.ok(OPEN_Q.test(q), q);
  for (const q of ['איזה חלב?', 'האם נגמר החלב או שצריך לקנות?', 'האם הגיע הכל?', 'מה מכל זה תמיד צריך להיות בבית?']) assert.ok(!OPEN_Q.test(q), q);
});
test('ש4: בהיכרות "מה קונים כל הזמן?" בלי כפתורים; "יותר מאחד?", "עוד משהו?" ו"מישהו שלא אוכל?" עם "לא" / "כן, אכתוב לך"', () => {
  const state = { users: [avi], locations: [] };
  assert.equal(ask({ step: 'basics', basics: [], mapped: ['מקרר'] }, state, avi).options, undefined);
  assert.deepEqual(OPEN_OPTIONS, ['לא', 'כן, אכתוב לך']);
  for (const step of ['targets', 'more', 'food']) assert.deepEqual(ask({ step, basics: [{ name: 'חלב' }, { name: 'לחם' }] }, state, avi).options, ['לא', 'כן, אכתוב לך'], step);
});
test('ש1: "יש כבר X ב<מקום>. האם זה/זו/אלה אותו/אותה/אותם/אותן X?"', () => {
  const state = { locations: [{ id: 3, name: 'מזווה' }, { id: 1, name: 'מקרר' }], products: [] };
  const q = (name, loc) => twinQuestion({ a: { p: { id: 9, name, location_id: loc } }, b: {} }, state);
  assert.equal(q('מלח', 3), 'יש כבר מלח במזווה. האם זה אותו מלח?');
  assert.equal(q('פפריקה מעושנת', 3), 'יש כבר פפריקה מעושנת במזווה. האם זו אותה פפריקה?');
  assert.equal(q('צנוברים', 3), 'יש כבר צנוברים במזווה. האם אלה אותם צנוברים?');
  assert.equal(q('עגבניות', 1), 'יש כבר עגבניות במקרר. האם אלה אותן עגבניות?');
});
test('ש7: "כן, אותו מוצר": פתוח ועוד אחד סגור; "לא, מוצר אחר": שני מוצרים עם מה שמבדיל ליד השם', () => {
  const pap = { id: 5, name: 'פפריקה מעושנת', count_type: 'inuse', is_open: 1, level: 'little', qty: 0, location_id: 3 };
  const state = { products: [pap], locations: [{ id: 3, name: 'מזווה' }] };
  const closed = { kind: 'create', product: { name: 'פפריקה מעושנת סגורה', count_type: 'units', qty: 1 } };
  const t = twinOf([closed], state);
  assert.ok(t && t.a.p === pap && t.b === closed);
  assert.deepEqual(twinMerge([closed], t), [{ kind: 'edit', product_id: 5, fields: { count_type: 'inuse', is_open: true, qty: 1, level: 'little' } }]);
  assert.equal(twinApart([closed], t)[0].product.name, 'פפריקה מעושנת נוספת');
  // both in one card (as on 16/10): one create, open and one closed
  const open = { kind: 'create', product: { name: 'פפריקה מעושנת', count_type: 'level', level: 'little' } };
  const t2 = twinOf([open, closed], { products: [] });
  const one = twinMerge([open, closed], t2);
  assert.equal(one.length, 1); assert.deepEqual({ ...one[0].product }, { name: 'פפריקה מעושנת', count_type: 'inuse', level: 'little', is_open: true, qty: 1 });
  const jar = { kind: 'create', product: { name: 'פפריקה מעושנת בצנצנת', count_type: 'units', qty: 1 } };
  assert.equal(twinApart([open, jar], twinOf([open, jar], { products: [] }))[1].product.name, 'פפריקה מעושנת בצנצנת');
  assert.equal(twinOf([{ kind: 'create', bought: true, product: { name: 'פפריקה מעושנת סגורה', count_type: 'units' } }], state), null, 'a purchase');
});
test('ש5: הנוסחים מטבלת הטון', () => {
  assert.equal(idleQuestion({ name: 'חלב סויה' }), 'אגב, נראה שלא היה צריך חלב סויה בחודשיים האחרונים. האם להשאיר אותו במוצרים הקבועים?');
  assert.equal(NO_BLOCK, 'אצלי כל מבוגר בבית יכול להוסיף לרשימה מה שהוא רוצה.');
  assert.equal(FIXED.curse.words(), 'אני מעדיף בלי קללות.');
  const products = [{ id: 7, name: 'במבה', is_basic: 0 }];
  assert.equal(noticedText({ kind: 'rejects', product_id: 7, count: 3, data: '{}' }, { users: [avi], products }), 'נראה שאתם לא צריכים במבה ברשימה.');
  assert.equal(noticedText({ kind: 'regular', product_id: 7, data: '{}' }, { users: [avi], products }), 'אתם קונים במבה הרבה. האם להפוך אותה למוצר קבוע?');
});
