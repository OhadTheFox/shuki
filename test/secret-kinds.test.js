// After a secret, only what can be the writer's alone is kept (worker/secret.js, the owner 04/10). Every kind that reaches
// execute() or applyProposal(), from the model's respond schema or added by the server, is decided: allowed or dropped.
// A new kind with no decision fails here.
// Run: node --test test/secret-kinds.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECRET_ALLOWED, SECRET_DROPPED, secretGate, secretReply } from '../worker/secret.js';

const shuki = readFileSync('worker/shuki.js', 'utf8');
const store = readFileSync('worker/store.js', 'utf8');
const between = (src, from, to) => { const i = src.indexOf(from); assert.ok(i >= 0, from); return src.slice(i, src.indexOf(to, i + from.length)); };

test('every kind is allowed or dropped, never both', () => {
  const decided = new Set([...SECRET_ALLOWED, ...SECRET_DROPPED]);
  assert.equal(decided.size, SECRET_ALLOWED.length + SECRET_DROPPED.length, 'a kind is in both lists');
  const kinds = new Set();
  // the model's actions (respond schema)
  const schema = shuki.match(/kind: \{ type: 'string', enum: \[([^\]]+)\]/);
  assert.ok(schema, 'the respond schema\'s kinds');
  for (const k of schema[1].matchAll(/'([a-z_]+)'/g)) kinds.add(k[1]);
  // the model's answer fields that change the house (everything but the words, the buttons and the flags)
  const tool = between(shuki, 'const TOOL = {', '\n};');
  const fields = [...between(tool, 'properties: {', 'required:').matchAll(/^ {6}([a-z_]+):/gm)].map((m) => m[1]);
  const NOT_SAVED = ['reply', 'face', 'distress', 'actions', 'options', 'store', 'personal', 'correction', 'eating', 'fixed', 'idea']; // idea (stage 8, ג3): a flag, the server adds the owner's sentence and keeps nothing. eating (פ5): a flag; its fact is kept only after "כן", through the gate. fixed (stage 7): which fixed words the server writes
  for (const f of fields) if (!NOT_SAVED.includes(f)) kinds.add(f);
  // what execute() does (store.js), and what applyProposal() does (shuki.js), also the kinds only the server adds
  for (const k of store.matchAll(/case '([a-z_]+)':/g)) kinds.add(k[1]);
  for (const k of between(shuki, 'export async function applyProposal', '\n}\n').matchAll(/kind === '([a-z_]+)'/g)) kinds.add(k[1]);
  // a question of Shuki's own whose "yes" keeps a state of the house
  for (const k of between(shuki, '\nasync function chatTurn(', '\n}\n').matchAll(/ask\.(away|kitniyot)\b/g)) kinds.add(k[1]);
  const undecided = [...kinds].filter((k) => !decided.has(k));
  assert.deepEqual(undecided, [], `kinds with no decision after a secret: ${undecided.join(', ')}`);
  for (const k of ['confirm', 'check', 'keep', 'approve', 'shopping', 'catalog_area', 'fact_confirm', 'fact_keep', 'fact_share', 'finish', 'away', 'guests', 'hosting', 'kitniyot']) assert.ok(kinds.has(k), `${k} wasn't found where it's used`);
});

test('the gate: a fact only about the writer, a tell only with a recipient, alias and photo only on the writer\'s own', () => {
  const S = { users: [{ id: 1, name: 'אבי', role: 'admin', active: 1 }, { id: 2, name: 'מיכל', role: 'member', active: 1 }], products: [{ id: 5, name: 'טבליות', private_to: null }, { id: 6, name: 'קונדומים', private_to: 2 }], facts: [{ id: 9, about: 'person', about_id: 2, key: 'likes', value: 'x', private: 1 }, { id: 10, about: 'person', about_id: 1, key: 'likes', value: 'y', private: 0 }, { id: 11, about: 'person', about_id: 2, key: 'diet', value: 'צמחונית', private: 0 }, { id: 12, about: 'person', about_id: 2, key: 'shabbat', value: 'כן', private: 0 }] };
  const me = S.users[1];
  const { kept, dropped, nothing } = secretGate([
    { kind: 'fact', key: 'avoid', about: 'מיכל', value: 'קשיו' }, { kind: 'fact', key: 'avoid', about: 'אבי', value: 'פיסטוק' }, { kind: 'fact', key: 'habit', about: 'הבית', value: 'x' },
    { kind: 'tell', text: 'היי' }, { kind: 'tell', to: 'אבי', text: 'היי' }, { kind: 'alias', product_id: 5, alias: 'x' }, { kind: 'alias', product_id: 6, alias: 'y' },
    { kind: 'fact_end', ids: [9] }, { kind: 'fact_end', ids: [10] }, { kind: 'lesson', text: 'לא לקנות' }, { kind: 'op', product_id: 5, op: { type: 'out' } }, { kind: 'whatever' },
    // a shared fact about her doesn't change after a secret (the owner 04/10), but a private row of hers wins over it (פ6):
    // ended, written over or Shabbat off are kept, private; only what changes nothing she sees is "לא היה מה לעדכן."
    { kind: 'fact_end', ids: [11] }, { kind: 'fact', key: 'diet', about: 'מיכל', value: 'טבעונית' }, { kind: 'shabbat', on: false },
    { kind: 'fact', key: 'diet', about: 'מיכל', value: 'צמחונית' }, { kind: 'shabbat', on: true },
  ], me, S);
  assert.deepEqual(nothing.map((a) => a.kind), ['fact', 'shabbat']);
  assert.deepEqual(kept.map((a) => `${a.kind}:${a.about || a.to || a.product_id || a.ids || ''}:${a.private ?? ''}`), ['fact:מיכל:true', 'tell:אבי:', 'alias:6:true', 'fact_end:9:true', 'op:5:true', 'fact_end:11:true', 'fact:מיכל:true', 'shabbat::true']);
  assert.equal(dropped.length, 9);
  // once she stopped keeping Shabbat in a secret (a private ended row), "I keep Shabbat" is a change again
  const S2 = { ...S, facts: [...S.facts, { id: 13, about: 'person', about_id: 2, key: 'shabbat', value: 'כן', private: 1, ended: 1 }] };
  assert.deepEqual(secretGate([{ kind: 'shabbat', on: true }], me, S2).nothing, []);
});

test('the answer: "I\'ll remember" stays only about what is kept; buttons of "remember?" go; empty is "בסדר" (decision 7, r7b)', () => {
  const kept = [{ kind: 'list_add', text: 'טסט הריון' }], dropped = [{ kind: 'lesson', text: 'לא לקנות במבה' }];
  assert.deepEqual(secretReply('להוסיף טסט הריון לרשימה ולשמור את זה בינינו? אזכור שלא לקנות במבה.', ['כן, תזכור', 'לא צריך'], kept, dropped, []), { reply: 'להוסיף טסט הריון לרשימה ולשמור את זה בינינו?', options: undefined });
  assert.deepEqual(secretReply('אזכור.', [], [], [{ kind: 'fact', value: 'פיסטוק' }], []), { reply: 'בסדר', options: undefined });
});

test('the answer is split before a "ו" stuck to a word of saving; what stays ends with a period (פ29)', () => {
  assert.equal(secretReply('אוסיף חלב לרשימה ואזכור שאבי לא אוכל גלוטן.', [], [{ kind: 'list_add', text: 'חלב' }], [{ kind: 'fact', value: 'גלוטן' }], []).reply, 'אוסיף חלב לרשימה.');
  // both parts stay: the sentence as it was
  assert.equal(secretReply('אוסיף חלב ואזכור את החלב.', [], [{ kind: 'list_add', text: 'חלב' }], [{ kind: 'lesson', text: 'לא לקנות במבה' }], []).reply, 'אוסיף חלב ואזכור את החלב.');
  // a sentence that doesn't say it saved anything stays as it is (r7b)
  assert.equal(secretReply('נסעתם לאילת, איזה כיף! אזכור את זה.', [], [], [{ kind: 'away', text: 'חופשה' }], []).reply, 'נסעתם לאילת, איזה כיף!');
});

test('a long value of a multi-valued fact is compared as it is saved (200 characters): the shared one is found (the owner 04/10)', () => {
  const long = 'שקשוקה עם הרבה פלפל חריף ועגבניות טריות '.repeat(6).trim(); // over 200 characters
  assert.ok(long.length > 200);
  const S = { users: [{ id: 2, name: 'מיכל', role: 'member', active: 1 }], products: [], facts: [{ id: 1, about: 'person', about_id: 2, key: 'likes', value: long.slice(0, 200), private: 0 }] };
  const { nothing } = secretGate([{ kind: 'fact', key: 'likes', about: 'מיכל', value: long, text: 'x' }], S.users[0], S);
  assert.equal(nothing.length, 1);
});
