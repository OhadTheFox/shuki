// פ22 (the owner 06/10, r7b), G0: every word Shuki chooses by a person goes through one helper, byPerson(u, m, f, p) in
// public/hebrew.js, shared by the server and the app, so stage 7ב's plural finds every place. No `gender === 'f'` is
// left in worker/ and public/, the old helpers are gone, and every call gives all four forms. Stage 7ב's first step: p is
// given everywhere (the m form until the plural's words are approved); only isWoman passes null.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { byPerson, isWoman } from '../public/hebrew.js';

const files = ['worker', 'public'].flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.js')).map((f) => `${d}/${f}`));
const src = Object.fromEntries(files.map((f) => [f, readFileSync(f, 'utf8')]));

/** The top-level arguments of each call `name(…)` in a source: quotes, templates (with ${…}) and brackets are skipped. */
function calls(s, name) {
  const out = [], re = new RegExp(`(?<![\\w$.])${name}\\(`, 'g');
  for (let m; (m = re.exec(s));) {
    let i = m.index + m[0].length, args = 1, empty = true;
    const stack = [], commas = []; // what is open: quotes, a template, ${ (as '{'), ( [ {
    for (; i < s.length; i++) {
      const c = s[i], top = stack.at(-1);
      if (top === "'" || top === '"') { if (c === '\\') i++; else if (c === top) stack.pop(); continue; }
      if (top === '`') { if (c === '\\') i++; else if (c === '`') stack.pop(); else if (c === '$' && s[i + 1] === '{') { stack.push('{'); i++; } continue; }
      if (!/\s/.test(c)) empty = false;
      if (c === "'" || c === '"' || c === '`' || c === '(' || c === '[' || c === '{') { stack.push(c); continue; }
      if (c === ')' || c === ']' || c === '}') { if (!stack.length) break; stack.pop(); continue; }
      if (c === ',' && !stack.length) { args++; commas.push(i); }
    }
    out.push({ at: s.slice(0, m.index).split('\n').length, args: empty ? 0 : args, last: commas.length ? s.slice(commas.at(-1) + 1, i).trim() : null });
  }
  return out;
}

test('G0: no `gender === \'f\'` / `!== \'f\'` in worker/ and public/: the words go through byPerson', () => {
  for (const [f, s] of Object.entries(src)) {
    const lines = s.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /gender\s*[!=]==?\s*['"]f['"]/.test(l));
    assert.deepEqual(lines.map(([n]) => `${f}:${n}`), [], 'a choice by gender outside byPerson');
  }
});
test('G0: the old helpers are gone (g, he, v, mf, noFish)', () => {
  const old = [/const g = \(u, m, f\)/, /const he = \(u, m, f\)/, /const v = \(m, f\)/, /const mf = \(m, f\)/, /\bnoFish\b/];
  for (const [f, s] of Object.entries(src)) for (const re of old) assert.ok(!re.test(s), `${f}: ${re}`);
});
test('G0: every byPerson call gives all four forms (m, f, p)', () => {
  let n = 0;
  for (const [f, s] of Object.entries(src)) {
    for (const c of calls(s, 'byPerson')) { n++; assert.equal(c.args, 4, `${f}:${c.at}: ${c.args} arguments`); }
  }
  assert.ok(n > 120, `only ${n} calls: did the parser miss them?`);
});
test('7ב: every byPerson call gives p (not null), but isWoman', () => {
  const nulls = [];
  for (const [f, s] of Object.entries(src)) for (const c of calls(s, 'byPerson')) if (c.last === 'null') nulls.push(`${f}:${c.at}`);
  const isWomanAt = src['public/hebrew.js'].split('\n').findIndex((l) => l.includes('export const isWoman')) + 1;
  assert.deepEqual(nulls, [`public/hebrew.js:${isWomanAt}`]);
});
test('byPerson: a user or a gender; p only once it is written (7ב), m until then; isWoman counts', () => {
  assert.equal(byPerson({ gender: 'f' }, 'תרצה', 'תרצי', null), 'תרצי');
  assert.equal(byPerson({ gender: 'm' }, 'תרצה', 'תרצי', null), 'תרצה');
  assert.equal(byPerson('f', 'a', 'b', null), 'b');
  assert.equal(byPerson(null, 'a', 'b', null), 'a');
  assert.equal(byPerson({ gender: 'p' }, 'a', 'b', null), 'a');
  assert.equal(byPerson({ gender: 'p' }, 'a', 'b', 'c'), 'c');
  assert.equal(byPerson('p', 'a', 'b', 'c'), 'c');
  assert.equal(isWoman({ gender: 'f' }), true); assert.equal(isWoman({ gender: 'm' }), false); assert.equal(isWoman({ gender: 'p' }), false);
});
