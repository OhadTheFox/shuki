// ו2 (stage 8, question 11): the holiday of a day by the house's religion (worker/domain.js holidayToday, religionOf)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holidayToday, religionOf } from '../worker/domain.js';

const at = (d) => Date.parse(`${d}T09:00:00Z`); // noon in Jerusalem
test('holidayToday: Jewish (no fasts; Purim in Adar II of a leap year), Muslim (Umm al-Qura), Christian and Orthodox', () => {
  for (const [d, rel, want] of [
    ['2026-09-12', 'jewish', 'ראש השנה'], ['2026-09-26', 'jewish', 'סוכות'], ['2026-12-05', 'jewish', 'חנוכה'], ['2026-12-06', 'jewish', null],
    ['2026-03-03', 'jewish', 'פורים'], ['2027-02-21', 'jewish', null], ['2027-03-23', 'jewish', 'פורים'], ['2026-04-02', 'jewish', 'פסח'],
    ['2026-05-22', 'jewish', 'שבועות'], ['2026-09-21', 'jewish', null], ['2026-03-20', 'jewish', null],
    ['2026-03-20', 'muslim', 'עיד אל-פיטר'], ['2026-05-27', 'muslim', 'עיד אל-אדחא'], ['2026-04-02', 'muslim', null],
    ['2026-12-25', 'christian', 'חג המולד'], ['2026-04-05', 'christian', 'פסחא'], ['2027-03-28', 'christian', 'פסחא'],
    ['2027-01-07', 'orthodox', 'חג המולד'], ['2026-04-12', 'orthodox', 'פסחא'], ['2026-12-25', 'orthodox', null],
    ['2026-04-02', null, null],
  ]) assert.equal(holidayToday(at(d), rel), want, `${d} ${rel}`);
});
test('holidayToday: ט"ו בשבט, ל"ג בעומר, and יום העצמאות by the rules (r8z 11/10)', () => {
  for (const [d, want] of [
    ['2026-02-02', 'ט״ו בשבט'], ['2026-02-01', null], ['2027-01-23', 'ט״ו בשבט'],
    ['2026-05-05', 'ל״ג בעומר'], ['2026-05-04', null], ['2027-05-25', 'ל״ג בעומר'],
    // ה' באייר on Wednesday: that day (5786)
    ['2026-04-22', 'יום העצמאות'], ['2026-04-21', null], ['2026-04-23', null],
    // on Monday: Tuesday, ו' באייר (5784)
    ['2024-05-14', 'יום העצמאות'], ['2024-05-13', null],
    // on Saturday: Thursday, ג' באייר (5785)
    ['2025-05-01', 'יום העצמאות'], ['2025-05-02', null], ['2025-05-03', null],
    // on Friday: Thursday, ד' באייר (5789)
    ['2029-04-19', 'יום העצמאות'], ['2029-04-20', null],
    // Muslim and Christian houses: none of these
  ]) assert.equal(holidayToday(at(d), 'jewish'), want, d);
  for (const rel of ['muslim', 'christian', 'orthodox']) assert.equal(holidayToday(at('2026-04-22'), rel), null, rel);
});
test('religionOf: Jewish unless the house said otherwise; the last word wins', () => {
  const habit = (value) => ({ about: 'house', key: 'habit', value });
  assert.equal(religionOf([]), 'jewish');
  assert.equal(religionOf([habit('משתמשים באייר פרייר גם במנות של תנור')]), 'jewish');
  assert.equal(religionOf([habit('חוגגים חגים מוסלמיים')]), 'muslim');
  assert.equal(religionOf([habit('חוגגים את חג המולד')]), 'christian');
  assert.equal(religionOf([habit('חוגגים חגים נוצריים אורתודוקסים')]), 'orthodox');
  assert.equal(religionOf([habit('לא חוגגים חגים')]), null);
  assert.equal(religionOf([habit('חוגגים חגים מוסלמיים'), habit('חוגגים חגים יהודיים')]), 'jewish');
  // a habit about a holiday's food isn't the house's religion
  assert.equal(religionOf([habit('חוגגים חגים מוסלמיים'), habit('בחג שבועות אוכלים חלבי')]), 'muslim');
  assert.equal(religionOf([habit('לא חוגגים חגים'), habit('בחגים מבשלים הרבה')]), null);
  assert.equal(religionOf([habit('בחנוכה לא חוגגים עם סופגניות')]), 'jewish');
  assert.equal(religionOf([habit('משפחה מוסלמית')]), 'muslim');
  assert.equal(religionOf([habit('חוגגים חגים נוצריים'), habit('אנחנו יהודים אורתודוקסים')]), 'jewish', 'Orthodox Jews');
});
