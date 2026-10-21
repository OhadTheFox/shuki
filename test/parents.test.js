// Decision 5 (the owner 06/10, r7b): a child's parents in words, by the grown-ups in the house (parentsOr, parentWord).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parentsOr, byPerson } from '../public/hebrew.js';
import { parentWord } from '../worker/shuki.js';

const u = (id, name, gender, extra = {}) => ({ id, name, gender, role: id === 1 ? 'admin' : 'member', active: 1, ...extra });
const kid = { id: 3, name: 'יואבי', gender: 'm', role: 'child', active: 1 };
const avi = u(1, 'אבי', 'm'), michal = u(2, 'מיכל', 'f'), dani = u(4, 'דני', 'm'), orit = u(1, 'דנה', 'f');

test('parentsOr: a father and a mother, two of the same by id, 3 or more, one, none; a child and who left are not parents', () => {
  assert.deepEqual(parentsOr([michal, avi, kid]), { two: 'אבא או אמא' });
  assert.equal(parentsOr([dani, avi, kid]).two, 'אבא אבי או אבא דני');
  assert.equal(parentsOr([michal, orit]).two, 'אמא דנה או אמא מיכל');
  assert.equal(parentsOr([michal, orit]).f, true);
  assert.deepEqual(parentsOr([avi, michal, dani]), { many: true });
  assert.equal(parentsOr([avi, { ...michal, active: 0 }, kid]).one, avi);
  assert.equal(parentsOr([kid]), null);
});
test('parentWord: "ביקשתי מ…" by the same rule (r7b)', () => {
  const asked = (xs) => `ביקשתי מ${parentWord(xs, 'מ')} לאשר`;
  assert.equal(asked([avi, michal]), 'ביקשתי מאבא או מאמא לאשר');
  assert.equal(asked([avi, dani]), 'ביקשתי מאבא אבי או מאבא דני לאשר');
  assert.equal(asked([orit, michal]), 'ביקשתי מאמא דנה או מאמא מיכל לאשר');
  assert.equal(asked([avi, michal, dani]), 'ביקשתי מההורים לאשר');
  assert.equal(asked([michal]), 'ביקשתי ממיכל לאשר');
});
// the app's toast for a child's saved recipe (public/app.js kidRecipeText), by the same rule (the reviewer, stage 7): its
// source is read from the app and run with parentsOr, the words not changed
test('kidRecipeText: one parent by name, a father and a mother, two fathers, two mothers, 3 or more', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const body = src.match(/\nfunction kidRecipeText\(\) \{\n[\s\S]*?\n\}\n/)[0];
  const text = (users) => new Function('S', 'parentsOr', 'byPerson', `${body}; return kidRecipeText();`)({ users }, parentsOr, byPerson);
  // the owner's words (07/10, r7c): the pronoun in the third person
  assert.equal(text([avi, kid]), 'שמרתי והראיתי לאבא אבי. ברגע שהוא יאשר, האישור יופיע כאן.');
  assert.equal(text([michal, kid]), 'שמרתי והראיתי לאמא מיכל. ברגע שהיא תאשר, האישור יופיע כאן.');
  assert.equal(text([avi, michal, kid]), 'שמרתי והראיתי לאבא או לאמא. ברגע שאחד מהם יאשר, האישור יופיע כאן.');
  assert.equal(text([avi, dani, kid]), 'שמרתי והראיתי לאבא אבי או לאבא דני. ברגע שאחד מהם יאשר, האישור יופיע כאן.');
  // two mothers, as two fathers (the owner 07/10, question 104)
  assert.equal(text([orit, michal]), 'שמרתי והראיתי לאמא דנה או לאמא מיכל. ברגע שאחת מהן תאשר, האישור יופיע כאן.');
  assert.equal(text([avi, michal, dani, kid]), 'שמרתי והראיתי להורים. ברגע שאחד מהם יאשר, האישור יופיע כאן.');
});

// 7ב (the owner r7d 08/10, questions 8, 8ב, 18): who chose the plural is named, not counted as a father or a mother
const noam = u(5, 'נועם', 'p'), adi = u(6, 'עדי', 'p');
test('7ב: parentsOr and parentWord with a parent who chose the plural ("אבא או נועם", "נועם או עדי", one by name)', () => {
  assert.deepEqual(parentsOr([avi, noam, kid]), { two: 'אבא או נועם', parts: ['אבא', 'נועם'] });
  assert.deepEqual(parentsOr([noam, michal, kid]), { two: 'אמא או נועם', parts: ['אמא', 'נועם'] }, 'the father or mother first');
  assert.deepEqual(parentsOr([noam, adi, kid]), { two: 'נועם או עדי', parts: ['נועם', 'עדי'] });
  assert.equal(parentsOr([noam, kid]).one, noam);
  assert.deepEqual(parentsOr([avi, noam, michal]), { many: true });
  const asked = (xs) => `ביקשתי מ${parentWord(xs, 'מ')} לאשר`;
  assert.equal(asked([avi, noam]), 'ביקשתי מאבא או מנועם לאשר');
  assert.equal(asked([michal, noam]), 'ביקשתי מאמא או מנועם לאשר');
  assert.equal(asked([noam]), 'ביקשתי מנועם לאשר');
  assert.equal(asked([noam, adi]), 'ביקשתי מנועם או מעדי לאשר');
});
test('7ב: kidRecipeText with a parent who chose the plural ("לנועם. ברגע שהם יאשרו", "אחד מהם")', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const body = src.match(/\nfunction kidRecipeText\(\) \{\n[\s\S]*?\n\}\n/)[0];
  const text = (users) => new Function('S', 'parentsOr', 'byPerson', `${body}; return kidRecipeText();`)({ users }, parentsOr, byPerson);
  assert.equal(text([noam, kid]), 'שמרתי והראיתי לנועם. ברגע שהם יאשרו, האישור יופיע כאן.');
  assert.equal(text([avi, noam, kid]), 'שמרתי והראיתי לאבא או לנועם. ברגע שאחד מהם יאשר, האישור יופיע כאן.');
  assert.equal(text([michal, noam, kid]), 'שמרתי והראיתי לאמא או לנועם. ברגע שאחד מהם יאשר, האישור יופיע כאן.');
  assert.equal(text([noam, adi, kid]), 'שמרתי והראיתי לנועם או לעדי. ברגע שאחד מהם יאשר, האישור יופיע כאן.');
});
