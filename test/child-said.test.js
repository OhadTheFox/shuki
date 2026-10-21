// 16/10: in the first meeting a child only when it was said (worker/onboarding.js childSaid), and two names that are the
// same product but for a container (worker/shuki.js sameBase), with the reviewer's cases. Run: node --test test/child-said.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { childSaid } from '../worker/onboarding.js';
import { sameBase } from '../worker/shuki.js';

const kid = (name, text, age) => childSaid({ name, child: true, age }, text);
test('a child only when said, even when the model marked everyone a child', () => {
  for (const [n, t] of [['הילה', 'אני גר עם הילה'], ['הילה', 'אשתי הילה'], ['הילה', 'הילה ואיתי בן 4'], ['הילה', 'בת הזוג שלי הילה'], ['הילה', 'בת-זוגי הילה'], ['הילה', 'הילה בת 30'],
    ['מיכל', 'גרים איתי אשתי מיכל והבן שלנו איתי'], ['הילה', 'אשתי הילה והילדים יואב ומאיה'], ['הילה', 'אני גר עם אשתי הילה, והילדים בצבא']]) assert.equal(kid(n, t), false, `${n}: ${t}`);
  for (const [n, t] of [['איתי', 'הילה ואיתי בן 4'], ['מאיה', 'הבת שלנו מאיה'], ['יואב', 'אשתי הילה והילדים יואב ומאיה'], ['יואב', 'אשתי מיכל והבן שלנו יואב'], ['מאיה', 'אשתי ובתי מאיה'],
    ['איתי', 'גרים איתי אשתי מיכל והבן שלנו איתי'], ['מאיה', 'אשתי הילה והילדים יואב ומאיה']]) assert.equal(kid(n, t), true, `${n}: ${t}`);
  assert.equal(kid('איתי', 'איתי', 4), true); assert.equal(kid('רון', 'רון', 17), true); assert.equal(kid('רון', 'הבן שלי רון', 19), false); // an age decides
  assert.equal(childSaid({ name: 'הילה', child: false }, 'הבת שלנו הילה'), false); // the model said grown-up: stays
});
test('the same product but for its container: one name is the other plus container words', () => {
  assert.equal(sameBase('פפריקה מעושנת', 'פפריקה מעושנת סגורה'), true);
  assert.equal(sameBase('קופסת מלח', 'מלח'), true);
  assert.equal(sameBase('שקיות הקפאה', 'קופסאות הקפאה'), false);
  assert.equal(sameBase('שמן זית', 'שמן זית סורי'), false);
});
