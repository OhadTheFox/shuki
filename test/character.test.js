// Stage 10 (docs/stage10-plan.md): Shuki's character, the parts that need no server. Run: node --test test/character.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { israelAt } from './israel-time.js';

const nyAt = (iso) => Date.parse(iso); // a UTC instant, written out (the zone is named where it's used)

test('C1 (t4): one night 23:00–07:00 by the house\'s time zone, in summer and in winter time; and when tonight began', async () => {
  const { isNight, nightStart, NIGHT } = await import('../public/night.js');
  assert.deepEqual(NIGHT, [23, 7]);
  for (const date of ['2026-10-01', '2026-11-01']) { // summer time (+3), winter time (+2)
    const at = (t) => israelAt(date, t);
    assert.equal(isNight(at('22:59'), 'Asia/Jerusalem'), false, `${date} 22:59`);
    assert.equal(isNight(at('23:00'), 'Asia/Jerusalem'), true, `${date} 23:00`);
    assert.equal(isNight(at('3:00'), 'Asia/Jerusalem'), true, `${date} 03:00`);
    assert.equal(isNight(at('6:59'), 'Asia/Jerusalem'), true, `${date} 06:59`);
    assert.equal(isNight(at('7:00'), 'Asia/Jerusalem'), false, `${date} 07:00`);
    assert.equal(nightStart(at('23:40'), 'Asia/Jerusalem'), at('23:00'), `${date} 23:40 → tonight 23:00`);
  }
  // after midnight: yesterday's 23:00
  assert.equal(nightStart(israelAt('2026-11-02', '4:15'), 'Asia/Jerusalem'), israelAt('2026-11-01', '23:00'));
  // the night of the change to winter time (25/10/2026, 02:00 → 01:00): seven real hours from 23:00 to 05:00
  assert.equal(nightStart(israelAt('2026-10-25', '5:00'), 'Asia/Jerusalem'), israelAt('2026-10-24', '23:00'));
  // and to summer time (27/03/2026, 02:00 → 03:00): five real hours
  assert.equal(nightStart(israelAt('2026-03-27', '5:00'), 'Asia/Jerusalem'), israelAt('2026-03-26', '23:00'));
  // another zone: 01:30 in New York (05:30Z, EDT) → 23:00 there (03:00Z)
  assert.equal(nightStart(Date.parse('2026-10-02T05:30:00Z'), 'America/New_York'), Date.parse('2026-10-02T03:00:00Z'));
  // a half-hour change (Lord Howe, 05/04/2026 02:00 → 01:30): 01:57 there → 23:00 the evening before (12:00Z, +11)
  assert.equal(nightStart(Date.parse('2026-04-04T15:27:00Z'), 'Australia/Lord_Howe'), Date.parse('2026-04-04T12:00:00Z'));
  // the house's zone, not the phone's or Israel's: 23:30 in New York is night there, and 06:30 the next morning in Israel
  const ny = nyAt('2026-10-02T03:30:00Z'); // 23:30 EDT, 06:30 in Israel
  assert.equal(isNight(ny, 'America/New_York'), true);
  const noonNy = nyAt('2026-10-02T16:00:00Z'); // 12:00 EDT, 19:00 in Israel
  assert.equal(isNight(noonNy, 'America/New_York'), false);
  assert.equal(isNight(nyAt('2026-10-01T21:00:00Z'), 'America/New_York'), false, '17:00 in New York, midnight in Israel');
  // the notifications' quiet is the same night (and Shabbat stays only there)
  const { isQuiet } = await import('../worker/index.js');
  assert.equal(isQuiet(israelAt('2026-10-01', '23:30'), 'Asia/Jerusalem', false), true);
  assert.equal(isQuiet(israelAt('2026-10-01', '22:30'), 'Asia/Jerusalem', false), false);
  assert.equal(isQuiet(israelAt('2026-10-02', '16:30'), 'Asia/Jerusalem', true), true, 'Friday 16:30, keeping Shabbat');
  assert.equal(isNight(israelAt('2026-10-02', '16:30'), 'Asia/Jerusalem'), false, 'Shabbat is not night');
});
