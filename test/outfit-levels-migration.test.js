// Stage 10, t13: migration 0033 moves a saved outfit's level to the new level of the same points (21 levels), so the next
// catchUp() doesn't put on by force what "opened" between the two numbers. Run: node --test test/outfit-levels-migration.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { catchUp, growth } from '../public/wardrobe.js';

test('migration 0033: outfit:<user> level in the old numbers → the new level of the same points; nothing else changes', () => {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql') && x < '0033').sort()) db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  const put = (k, v) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(k, typeof v === 'string' ? v : JSON.stringify(v));
  put('outfit:1', { level: 5, wear: { head: 'band' } }); // took off the glasses and the bow; at 100 points
  put('outfit:2', { level: 15, wear: { head: 'crown' } });
  put('outfit:3', { level: 1, wear: {} });
  put('outfit:4', 'not json');
  put('notify:1', { level: 5 });
  db.exec(readFileSync('migrations/0033_outfit_levels.sql', 'utf8'));
  const get = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k).value;
  assert.deepEqual(JSON.parse(get('outfit:1')), { level: 9, wear: { head: 'band' } });
  assert.equal(JSON.parse(get('outfit:2')).level, 21);
  assert.equal(JSON.parse(get('outfit:3')).level, 1);
  assert.equal(get('outfit:4'), 'not json');
  assert.equal(JSON.parse(get('notify:1')).level, 5, 'not an outfit');
  // at level 9 (what 100 points were then; points are days since 16/10): nothing is put on by force, the choice stays
  const stored = JSON.parse(get('outfit:1'));
  const c = catchUp(stored, 9);
  assert.equal(c.changed, false); assert.deepEqual(c.wear, { head: 'band' });
  // without the migration it would have been: the glasses, the band and the mustache by force
  assert.equal(catchUp({ level: 5, wear: { head: 'band' } }, 9).changed, true);
});
