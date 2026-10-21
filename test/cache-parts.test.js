// Stage 0e (docs/stage0-0e-proposal.md, "השעה ומצב הרוח מחוץ לבלוק שבמטמון"): an hour later, with another mood, the
// cached parts (2, the house; 3, the catalog and the list) are the same, character for character; only part 4 changes.
// Without the server: the node server has no FIXED_NOW, so this is checked on the functions that build the parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { houseText, catalogText, messageText } from '../worker/shuki.js';

const NOW = Date.parse('2026-10-06T12:10:00Z');
const state = (now, mood) => ({
  now, house: 'הבית של אבי ומיכל', me: { id: 1, name: 'אבי' },
  users: [{ id: 1, name: 'אבי', gender: 'm', role: 'admin' }, { id: 2, name: 'מיכל', gender: 'f', role: 'member' }],
  categories: [{ id: 1, name: 'מוצרי חלב' }], locations: [{ id: 1, name: 'מקרר' }],
  products: [{ id: 7, name: 'חלב', aliases: [], category_id: 1, location_id: 1, count_type: 'units', text: 'קרטון אחד', is_basic: 1, target: 1, store: 'super', updated: NOW - 86400e3, updated_by: 2 }],
  list: [], recipes: [], lessons: [{ id: 1, text: 'לא קונים במבה' }], leftovers: [], routines: [], facts: [],
  settings: {}, mood: { mood }, shopping: [], away: null, guests: null, pesach: false,
});

test('an hour later, another mood: parts 2 and 3 are the same, part 4 is not', () => {
  const a = state(NOW, 'happy'), b = state(NOW + 3600e3, 'hungry');
  assert.equal(houseText(b), houseText(a));
  assert.equal(catalogText(b), catalogText(a));
  assert.notEqual(messageText(b), messageText(a));
  assert.match(messageText(b), /השעה \d{2}:\d{2}\. מצב רוח: hungry/); // with the minutes (stage 9, מ36)
  for (const t of [houseText(a), catalogText(a)]) assert.doesNotMatch(t, /היום: יום|מצב רוח/);
});
