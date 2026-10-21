// Shuki's points are days (the owner 16/10): one for each day with an update that counts, one more on a day a shopping trip was
// finished (at most one a day); a level that goes down takes off what no longer opens, quietly. Run: node --test test/levels16.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xpOf } from '../worker/index.js';
import { growth, catchUp } from '../public/wardrobe.js';

const at = (d, h) => Date.parse(`2026-10-${d}T${String(h).padStart(2, '0')}:00:00+03:00`);
test('a day with 50 updates is one point; a finished trip that day one more, at most one', () => {
  assert.equal(xpOf(Array.from({ length: 50 }, (_, k) => ({ ts: at(16, 8) + k * 60e3, type: 'out' })), 'Asia/Jerusalem'), 1);
  assert.equal(xpOf([{ ts: at(16, 8), type: 'out' }, { ts: at(16, 18), type: 'finish' }], 'Asia/Jerusalem'), 2);
  assert.equal(xpOf([{ ts: at(16, 9), type: 'finish' }, { ts: at(16, 19), type: 'finish' }], 'Asia/Jerusalem'), 2, 'two trips a day: one more point');
  assert.equal(xpOf([{ ts: at(16, 8), type: 'out' }, { ts: at(17, 8), type: 'out' }, { ts: at(19, 8), type: 'purchase' }], 'Asia/Jerusalem'), 3);
  assert.equal(xpOf([], 'Asia/Jerusalem'), 0);
});
test('the rows the server reads, one an hour (h, f): the same days and trips', () => {
  const h = (d, hr) => Math.floor(at(d, hr) / 3600000);
  assert.equal(xpOf([{ h: h(16, 8), f: 0 }, { h: h(16, 9), f: 1 }, { h: h(16, 23), f: 0 }, { h: h(17, 0), f: 0 }], 'Asia/Jerusalem'), 3);
});
test('the day is the house\'s: 23:30 and 00:30 in Israel are two days', () => {
  assert.equal(xpOf([{ ts: at(16, 23) + 30 * 60e3, type: 'out' }, { ts: at(17, 0) + 30 * 60e3, type: 'out' }], 'Asia/Jerusalem'), 2);
});
test('a level that goes down: what no longer opens comes off quietly, and the next level up puts its item on again', () => {
  const down = catchUp({ level: 13, wear: { head: 'chef', neck: 'tie', eyes: 'glasses' } }, growth(20).level);
  assert.deepEqual(down, { level: 4, wear: {}, changed: true });
  assert.deepEqual(catchUp(down, 7).wear, { eyes: 'glasses' });
});
