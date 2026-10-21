// q11 (16/10): "X כבר ברשימה" when X is not on the list (worker/shuki.js alreadyListedClaims), and the cases the reviewer
// gave where it must not fire (each would cost a needless second call). Run: node --test test/already-listed.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alreadyListedClaims } from '../worker/shuki.js';

const state = {
  products: [{ id: 1, name: 'נייר טואלט' }, { id: 2, name: 'ביצים' }, { id: 3, name: 'במבה' }, { id: 4, name: 'תה' }, { id: 5, name: 'חלב' }, { id: 6, name: 'חלב סויה' },
    { id: 7, name: 'שמן' }, { id: 8, name: 'אורז' }, { id: 9, name: 'נייר סופג' }, { id: 10, name: 'קפה' }, { id: 11, name: 'קפה', private_to: 1 }, { id: 12, name: 'סוכר', deleted: 1 }],
  list: [{ product_id: 2, status: 'open' }, { product_id: 6, status: 'open' }, { product_id: 7, status: 'checked' }, { product_id: null, text: 'נייר סופג', status: 'open' }, { product_id: 11, status: 'open' }, { product_id: 8, status: 'done' }],
};
const names = (reply) => alreadyListedClaims(reply, state).map((p) => p.name);

test('a product said to be on the list that is not', () => {
  assert.deepEqual(names('נייר טואלט כבר ברשימה. האם להוסיף במבה?'), ['נייר טואלט']);
  assert.deepEqual(names('האורז כבר ברשימה.'), ['אורז']); // done is not on the list
});
test('not when it is on the list, or the words are about something else (the reviewer)', () => {
  assert.deepEqual(names('הביצים כבר ברשימה, ואם תרצה אוסיף גם במבה?'), []); // another clause
  assert.deepEqual(names('שמן כבר ברשימה, אבל אורז עוד לא.'), []); // checked in the cart counts; "אבל" ends the clause
  assert.deepEqual(names('חלב סויה כבר ברשימה.'), []); // the longest name, not "חלב"
  assert.deepEqual(names('נייר סופג כבר ברשימה.'), []); // a one-off line by its text
  assert.deepEqual(names('הקפה כבר ברשימה.'), []); // a private product of the same name is on it
  assert.deepEqual(names('הסוכר כבר ברשימה.'), []); // a deleted product
  assert.deepEqual(names('אתה צודק, זה כבר ברשימה.'), []); // "תה" inside "אתה"
  assert.deepEqual(names('האם להוסיף נייר טואלט לרשימה?'), []);
});
