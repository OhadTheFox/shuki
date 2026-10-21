// Stage 0b, part 2 (docs/stage0-0b-proposal.md §2, "כלל לקוד"): every query on `chat` knows whose chat it reads.
// A static check over worker/*.js: each SQL line that reads, changes or deletes chat rows names the thread (`thread`,
// MINE), picks one row by id or a card by proposal.id, or says on the line why it spans every thread ("// all threads: …").
// Rows are written only through worker/thread.js (chatRows), so a new row always gets its thread.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const files = readdirSync('worker').filter((f) => f.endsWith('.js'));
const lines = files.flatMap((f) => readFileSync(`worker/${f}`, 'utf8').split('\n').map((text, i) => ({ where: `worker/${f}:${i + 1}`, text })));
const SQL = /\b(?:FROM|JOIN|UPDATE|DELETE FROM)\s+chat\b/i;
const IN_CODE = /\bthread\b|\$\{MINE\}|\bid (?:= \?|IN \()|\$\.proposal\.id/;
// the code part must name the thread; only the comment may say why it spans all (a comment can't vouch for the code)
const OK = (text) => { const i = text.indexOf(' // '); const code = (i < 0 ? text : text.slice(0, i)).split('.bind(')[0], note = i < 0 ? '' : text.slice(i); return IN_CODE.test(code) || /^ \/\/ all threads: \S/.test(note); };

test('every read, change or delete of chat rows names the thread (or says why it spans all)', () => {
  const bad = lines.filter((l) => SQL.test(l.text) && !OK(l.text)).map((l) => `${l.where}: ${l.text.trim().slice(0, 140)}`);
  assert.deepEqual(bad, [], `chat queries without a thread:\n${bad.join('\n')}`);
});

test('rows are written to chat only through worker/thread.js', () => {
  const bad = lines.filter((l) => /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+chat\b/i.test(l.text) && !l.where.startsWith('worker/thread.js:')).map((l) => l.where);
  assert.deepEqual(bad, [], `INSERT INTO chat outside thread.js:\n${bad.join('\n')}`);
});

test('the check itself catches a query with no thread', () => {
  for (const q of ["db.prepare('SELECT id FROM chat WHERE user_id = ?')", "db.prepare('SELECT * FROM chat WHERE user_id = ?'); // the user's thread", "db.prepare('SELECT * FROM chat WHERE user_id = ?').bind(row.thread)"]) assert.ok(SQL.test(q) && !OK(q), q);
  assert.ok(OK("db.prepare('DELETE FROM chat WHERE ts < ?'); // all threads: the 90-day cleanup"));
});

// פ6 (question 49, the seed): a user row with an empty thread can only come from an empty user_id. No code writes thread: null
// on purpose, and threadsOf gives a user row its writer's thread
test('no `thread: null` in worker/*.js; a user row is its writer\'s (threadsOf)', async () => {
  const bad = lines.filter((l) => /thread:\s*null/.test(l.text)).map((l) => l.where);
  assert.deepEqual(bad, []);
  const { threadsOf } = await import('../worker/thread.js');
  assert.deepEqual(threadsOf(5, 'user', {}), [5]);
});
