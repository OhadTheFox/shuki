// Times in Israel for the tests, by the real offset (+3 in summer, +2 in winter: Intl with Asia/Jerusalem), never a fixed +3.
// Not from worker/: a test doesn't lean on the code it tests. The morning run is by the house's hour (ROUTINE_HOUR), so "07:30
// today" must be 07:30 on Israel's clock, also after the change to winter time (25/10/2026).
const TZ = 'Asia/Jerusalem';
const parts = (ts) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  .formatToParts(ts).map((p) => [p.type, p.value]));
/** The date in Israel at a moment: "YYYY-MM-DD". */
export const israelDateOf = (ts) => { const p = parts(ts); return `${p.year}-${p.month}-${p.day}`; };
/** Today's date in Israel, or `days` from it (a calendar day, not 24 hours). */
export const israelDate = (days = 0, now = Date.now()) => {
  const [y, m, d] = israelDateOf(now).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
/** The weekday (0 = Sunday) of a date. */
export const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
/** The moment when Israel's clock shows `time` ("H:MM") on `date`; on the night of a change, the first one. */
export const israelAt = (date, time) => {
  const [y, m, d] = date.split('-').map(Number), [h, mi] = time.split(':').map(Number);
  for (const off of [3, 2]) {
    const t = Date.UTC(y, m - 1, d, h - off, mi), p = parts(t);
    if (`${p.year}-${p.month}-${p.day}` === date && Number(p.hour) === h && Number(p.minute) === mi) return t;
  }
  throw new Error(`no ${time} in Israel on ${date}`);
};
