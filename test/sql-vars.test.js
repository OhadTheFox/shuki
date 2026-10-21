// D1 takes at most 100 SQL variables in a query (X8, stage 7). upsert() binds one per column, so a table it writes
// must stay under that; undoLast binds the touched products as one JSON value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const cols = (table) => {
  let n = 0;
  for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) {
    const s = readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8');
    const m = s.match(new RegExp(`CREATE TABLE ${table} \\(([\\s\\S]*?)\\n\\);`));
    if (m) n += m[1].split('\n').filter((l) => /^\s+[a-z_][a-z0-9_]*\s/.test(l) && !/^\s+(PRIMARY|UNIQUE|FOREIGN|CHECK)\b/.test(l)).length;
    n += (s.match(new RegExp(`ALTER TABLE ${table} ADD COLUMN`, 'g')) || []).length;
  }
  return n;
};

test('upsert: every table it writes has fewer than 100 columns', () => {
  for (const t of ['products', 'list_items', 'batches']) {
    const n = cols(t);
    assert.ok(n > 3 && n < 100, `${t}: ${n} columns`);
  }
});

test('undoLast: the touched products are one bound value, not one per product', () => {
  const s = readFileSync(new URL('../worker/store.js', import.meta.url), 'utf8');
  const undo = s.slice(s.indexOf('export async function undoLast'), s.indexOf('export async function undoLast') + 2500);
  assert.match(undo, /IN \(SELECT value FROM json_each\(\?\)\)/);
  assert.doesNotMatch(undo, /touched\.map\(\(\) => '\?'\)/);
});
