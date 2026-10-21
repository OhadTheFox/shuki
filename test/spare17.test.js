// 17/10 (ש15): something closed at home is no reason to buy, even of a regular product, unless what is closed is below its
// minimum; a pack is bought when half of its last pack is left (one box by default, a minimum kept as boxes or as units);
// a regular in use with nothing closed: "a little left" on the open one goes on the list. Every place that decides the list
// uses isMissing (listNeed, the chat's "missing", the mood, the shopping push), and runningOutSoon skips what has a spare.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isMissing, listNeed, runningOutSoon, defaultTarget } from '../worker/domain.js';

const basic = (p) => ({ is_basic: 1, deleted: null, ...p });
test('ש15-א: פפריקה מעושנת פתוחה שנגמרת ועוד קופסה סגורה, מינימום קופסה: לא לרשימה; בלי הסגורה: כן', () => {
  const pap = basic({ name: 'פפריקה מעושנת', count_type: 'inuse', is_open: 1, level: 'little', qty: 1, target: 1 }); // as in the live house
  assert.equal(isMissing(pap), false); assert.equal(listNeed(pap), null);
  assert.equal(isMissing({ ...pap, qty: 0 }), true);
  assert.equal(isMissing({ ...pap, target: 2 }), true, 'one closed, minimum two: below the minimum');
  assert.equal(isMissing(basic({ name: 'חומץ', count_type: 'units', qty: 2, level: 'little', target: 1 })), false, 'two bottles, the open one low: one closed');
  assert.equal(isMissing(basic({ name: 'חומץ', count_type: 'units', qty: 1, level: 'little', target: 1 })), true, 'the last one low');
});
test('ש15-ב: ביצים בקופסה של 12, מינימום קופסה (12 או 1): 11 ו-7 לא, 6 ומטה כן; שתי קופסאות (24 או 2): 18 ומטה; בלי מינימום: קופסה', () => {
  for (const target of [12, 1, null]) {
    const egg = (qty) => basic({ name: 'ביצים', count_type: 'pack', pack_size: 12, qty, target });
    assert.equal(isMissing(egg(11)), false, `${target}: 11`); assert.equal(isMissing(egg(7)), false, `${target}: 7`);
    assert.equal(isMissing(egg(6)), true, `${target}: 6`); assert.equal(isMissing(egg(0)), true, `${target}: 0`);
  }
  for (const target of [24, 2]) {
    const egg = (qty) => basic({ name: 'ביצים', count_type: 'pack', pack_size: 12, qty, target });
    assert.equal(isMissing(egg(19)), false, `${target}: 19`); assert.equal(isMissing(egg(18)), true, `${target}: 18`);
  }
  assert.equal(isMissing(basic({ name: 'ביצים', count_type: 'pack', pack_size: 12, qty: 10, target: 12 })), false, 'the live house: 10 eggs, minimum 12');
  assert.equal(defaultTarget({ count_type: 'pack', pack_size: 12 }), 12);
});
test('ש15-ג: חלב פתוח בלי סגור, "חצי" (נשאר מעט): לרשימה; מוצר שאינו קבוע לעולם לא', () => {
  const milk = basic({ name: 'חלב', count_type: 'inuse', is_open: 1, level: 'little', qty: 0, target: 0 });
  assert.equal(isMissing(milk), true);
  assert.equal(isMissing({ ...milk, is_basic: 0 }), false);
});
test('ש15: runningOutSoon לא מציע מוצר שיש ממנו סגור בבית', () => {
  const now = Date.now();
  const pap = { id: 1, name: 'פפריקה מעושנת', count_type: 'inuse', is_open: 1, qty: 1, is_basic: 0 };
  const salt = { id: 2, name: 'מלח', count_type: 'inuse', is_open: 1, qty: 0, is_basic: 0 };
  const learned = { 1: { next: now + 3600e3, every: 30 }, 2: { next: now + 3600e3, every: 30 } };
  assert.deepEqual(runningOutSoon([pap, salt], learned, new Set(), now).map((x) => x.name), ['מלח']);
});
