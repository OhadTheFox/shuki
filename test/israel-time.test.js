// The tests' clock in Israel (test/israel-time.js): the right hour on both sides of a change, and the right date late at night.
import test from 'node:test';
import assert from 'node:assert/strict';
import { israelAt, israelDate, israelDateOf, weekdayOf } from './israel-time.js';

test('07:30 in Israel: summer, the day of the change to winter time, winter, and after the change to summer time', () => {
  assert.equal(new Date(israelAt('2026-10-14', '7:30')).toISOString(), '2026-10-14T04:30:00.000Z');
  assert.equal(new Date(israelAt('2026-10-25', '7:30')).toISOString(), '2026-10-25T05:30:00.000Z'); // the change was at 02:00
  assert.equal(new Date(israelAt('2026-10-27', '7:30')).toISOString(), '2026-10-27T05:30:00.000Z');
  assert.equal(new Date(israelAt('2026-03-27', '7:30')).toISOString(), '2026-03-27T04:30:00.000Z'); // summer time from 27/03 02:00
  assert.equal(new Date(israelAt('2026-10-14', '0:30')).toISOString(), '2026-10-13T21:30:00.000Z', 'an hour before the offset');
});

test('the date in Israel at 21:30Z: the same day in winter (23:30), the next day in summer (00:30)', () => {
  assert.equal(israelDateOf(Date.parse('2026-11-01T21:30:00Z')), '2026-11-01');
  assert.equal(israelDateOf(Date.parse('2026-10-14T21:30:00Z')), '2026-10-15');
  assert.equal(israelDate(0, Date.parse('2026-11-01T21:30:00Z')), '2026-11-01');
  assert.equal(israelDate(1, Date.parse('2026-10-24T21:30:00Z')), '2026-10-26', 'a calendar day on, over the change');
  assert.equal(weekdayOf('2026-10-16'), 5, 'Friday');
});
