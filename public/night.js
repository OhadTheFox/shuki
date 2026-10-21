// One night for the whole app (stage 10, decision 4, the owner 03/10): 23:00–07:00 on the house's clock, the same hours as the
// quiet of the notifications (isQuiet, worker/index.js), with no Shabbat and no setting per person. Shared by the server
// (the notifications) and the app (Shuki waking up, his yawn).
export const NIGHT = [23, 7];

const hourOf = (now, tz) => Number(new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }).format(new Date(now)));

/** Is it night in the house (by its time zone, not the phone's)? */
export function isNight(now, tz) {
  const h = hourOf(now, tz);
  return h >= NIGHT[0] || h < NIGHT[1];
}

/** When tonight began: the last 23:00 on the house's clock (today's, or yesterday's after midnight). Only meaningful at night. */
export function nightStart(now, tz) {
  const zone = tz || 'Asia/Jerusalem';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const h = Number(p.hour), m = Number(p.minute), s = Number(p.second);
  // back to the hour's start on the house's clock, then back to 23:00; on the night of a clock change the clock skipped or
  // repeated an hour (or half an hour, in a few zones), so the moment found is checked to read 23:00 and moved if not
  const hoursBack = h >= NIGHT[0] ? h - NIGHT[0] : h + 24 - NIGHT[0];
  const t = now - (now % 1000) - ((m * 60 + s) * 1000) - hoursBack * 3600e3;
  const at23 = (x) => { const q = new Intl.DateTimeFormat('en-CA', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(x)); return q === `${NIGHT[0]}:00`; };
  for (const d of [0, -3600e3, 3600e3, -1800e3, 1800e3]) if (at23(t + d)) return t + d;
  return t;
}
