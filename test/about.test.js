// What Shuki tells someone who just joined (approved 01/10, walkthrough finding 2): the wording and its edge cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aboutHouse } from '../worker/onboarding.js';

const orit = { name: 'דנה', gender: 'f' }, yuval = { name: 'יובל', gender: 'm' };
const PLACES = ['מקרר', 'מקפיא', 'מזווה'];
const NOTES = 'דנה לא אוכלת חריף. דני לא אוכל חצילים';

test('aboutHouse: a joiner who is in the notes hears it as "את"', () => {
  const [a, b] = aboutHouse(orit, { house: 'הבית של דנה ודני', others: ['דני'], products: 4, places: PLACES, notes: NOTES });
  assert.equal(a.reply, 'אני רוצה לספר לך מה אני יודע על הבית. קוראים לו "הבית של דנה ודני". את גרה בו עם דני. במלאי יש 4 מוצרים ב-3 מקומות: מקרר, מקפיא ומזווה.');
  assert.equal(b.reply, 'מה שאני יודע על האוכל בבית: את לא אוכלת חריף. דני לא אוכל חצילים.');
});
test('aboutHouse: a joiner who isn\'t in the notes hears everyone by name', () => {
  const [a, b] = aboutHouse(yuval, { house: 'הבית של דנה ודני', others: ['דני', 'דנה'], products: 4, places: PLACES, notes: NOTES });
  assert.match(a.reply, / אתה גר בו עם דני ודנה\. /);
  assert.equal(b.reply, 'מה שאני יודע על האוכל בבית: דנה לא אוכלת חריף. דני לא אוכל חצילים.');
});
test('aboutHouse: two joiners, each hears the others and their own line', () => {
  const notes = 'דנה לא אוכלת חצילים. יובל לא אוכל חריף';
  const forNoa = aboutHouse(orit, { house: 'הבית', others: ['דני', 'יובל'], products: 4, places: PLACES, notes });
  const forYuval = aboutHouse(yuval, { house: 'הבית', others: ['דני', 'דנה'], products: 4, places: PLACES, notes });
  assert.match(forNoa[0].reply, / את גרה בו עם דני ויובל\. /);
  assert.equal(forNoa[1].reply, 'מה שאני יודע על האוכל בבית: את לא אוכלת חצילים. יובל לא אוכל חריף.');
  assert.match(forYuval[0].reply, / אתה גר בו עם דני ודנה\. /);
  assert.equal(forYuval[1].reply, 'מה שאני יודע על האוכל בבית: דנה לא אוכלת חצילים. אתה לא אוכל חריף.');
  assert.match(aboutHouse(orit, { house: 'הבית', others: ['דני', 'יובל', 'דנה'], products: 1, places: ['מקרר'] })[0].reply, /את גרה בו עם דני, יובל ודנה\. במלאי יש מוצר אחד במקום אחד: מקרר\.$/);
});
test('aboutHouse: an empty stock, many places, no notes (no second bubble)', () => {
  assert.match(aboutHouse(orit, { house: 'הבית', others: ['דני'], products: 0 })[0].reply, /את גרה בו עם דני\. המלאי עוד ריק\.$/);
  assert.match(aboutHouse(orit, { house: 'הבית', others: ['דני'], products: 9, places: ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'] })[0].reply, /ב-9 מקומות: א, ב, ג ועוד 6\.$/);
  assert.equal(aboutHouse(orit, { house: 'הבית', others: ['דני'], products: 2, places: ['מקרר'], notes: '  ' }).length, 1);
  // a name only as the start of a word: "נעמה" isn't "דנה"
  assert.equal(aboutHouse(orit, { house: 'הבית', others: ['דני'], notes: 'נעמה לא אוכלת בשר' })[1].reply, 'מה שאני יודע על האוכל בבית: נעמה לא אוכלת בשר.');
});
