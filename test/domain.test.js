import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../public/wardrobe.js';
const await_import = W;
import { applyOp, isMissing, suggestedBuy, mood, expiring, findProducts, digestMessages, monthStart, local, DAY, learn, runningOutSoon, growth, recountPick, awayNow, tripSummaryLines } from '../worker/domain.js';

const NOW = Date.UTC(2026, 8, 26, 12);
const P = (o) => ({ id: 1, name: 'x', aliases: '[]', count_type: 'units', qty: 0, level: null, is_open: 0, is_basic: 0, target: null, pack_size: null, shelf_days: null, expires: null, ...o });

test('units: out, purchase to target, expiry from shelf life', () => {
  const milk = P({ name: 'חלב', qty: 2, is_basic: 1, target: 2, shelf_days: 7 });
  assert.equal(isMissing(milk), false);
  const out = applyOp(milk, { type: 'out' }, NOW).product;
  assert.equal(out.qty, 0);
  assert.equal(isMissing(out), true);
  assert.equal(suggestedBuy(out), 2);
  const bought = applyOp(out, { type: 'purchase', amount: 2 }, NOW).product;
  assert.equal(bought.qty, 2);
  assert.equal(bought.expires, NOW + 7 * DAY);
});

test('pack: purchase counts packs, stock in units', () => {
  const eggs = P({ count_type: 'pack', pack_size: 12, qty: 3, is_basic: 1, target: 12 });
  assert.equal(suggestedBuy(eggs), 1);
  assert.equal(applyOp(eggs, { type: 'purchase', amount: 1 }, NOW).product.qty, 15);
});

test('level: low -> little -> on list; purchase -> plenty', () => {
  const tom = P({ count_type: 'level', level: 'plenty', is_basic: 1 });
  const low = applyOp(tom, { type: 'low' }, NOW).product;
  assert.equal(low.level, 'little');
  assert.equal(isMissing(low), true);
  assert.equal(applyOp(low, { type: 'purchase' }, NOW).product.level, 'plenty');
});

test('inuse: finishing the open one opens a spare; nothing left -> missing (home18: a full open one counts as one)', () => {
  const soap = P({ count_type: 'inuse', is_open: 1, qty: 1, is_basic: 1, target: 1 });
  const a = applyOp(soap, { type: 'out' }, NOW).product;
  assert.deepEqual([a.is_open, a.qty], [1, 0]);
  assert.equal(isMissing(a), false);
  const b = applyOp(a, { type: 'out' }, NOW).product;
  assert.deepEqual([b.is_open, b.qty], [0, 0]);
  assert.equal(isMissing(b), true);
  const c = applyOp(b, { type: 'purchase', amount: 2 }, NOW).product;
  assert.deepEqual([c.is_open, c.qty], [1, 1]);
});

test('batches: purchase adds a batch, use takes the earliest expiry', () => {
  const chicken = P({ count_type: 'batches', shelf_days: 90 });
  let r = applyOp(chicken, { type: 'purchase', amount: 2 }, NOW - 30 * DAY, []);
  r = applyOp(r.product, { type: 'purchase', amount: 1 }, NOW, r.batches);
  assert.equal(r.product.qty, 3);
  r = applyOp(r.product, { type: 'use', amount: 1 }, NOW, r.batches);
  assert.equal(r.product.qty, 2);
  assert.deepEqual(r.batches.map((b) => b.qty).sort(), [1, 1]);
  assert.equal(Math.min(...r.batches.map((b) => b.expires)), NOW + 60 * DAY);
});

test('mood: sleepy > ratio; afro only when perfect; throwing away is a moment, not a sad day', () => {
  const basics = [P({ id: 1, is_basic: 1, target: 1, qty: 1 }), P({ id: 2, is_basic: 1, target: 1, qty: 1 })];
  assert.equal(mood({ products: basics, lastUpdate: NOW - DAY, lastWaste: null, now: NOW }).mood, 'ecstatic');
  // r0t d131: a toss is only the moment's cry; the afro stays
  assert.equal(mood({ products: basics, lastUpdate: NOW - DAY, lastWaste: NOW - 3 * DAY, now: NOW }).mood, 'ecstatic');
  assert.equal(mood({ products: basics, lastUpdate: NOW - DAY, lastWaste: NOW - 3600e3, now: NOW }).mood, 'ecstatic');
  assert.equal(mood({ products: basics, lastUpdate: NOW - 4 * DAY, lastWaste: null, now: NOW }).mood, 'sleepy');
  // r7c (question 100): never updated is sleepy too, marked `never` so the label says no "3 ימים"
  assert.deepEqual([mood({ products: basics, lastUpdate: null, lastWaste: null, now: NOW })].map((m) => [m.mood, m.never]), [['sleepy', true]]);
  assert.equal(mood({ products: basics, lastUpdate: NOW - 4 * DAY, lastWaste: null, now: NOW }).never, undefined);
  const half = [...basics, P({ id: 3, is_basic: 1, target: 1, qty: 0 }), P({ id: 4, is_basic: 1, target: 1, qty: 0 })];
  assert.equal(mood({ products: half, lastUpdate: NOW, lastWaste: null, now: NOW }).mood, 'neutral');
  const bad = [...half, P({ id: 5, is_basic: 1, target: 1, qty: 0 })];
  assert.equal(mood({ products: bad, lastUpdate: NOW, lastWaste: null, now: NOW }).mood, 'hungry');
});

test('expiring within two days, soonest first', () => {
  const a = P({ id: 1, qty: 1, expires: NOW + 1.5 * DAY });
  const b = P({ id: 2, qty: 1, expires: NOW + 5 * DAY });
  const c = P({ id: 3, qty: 1, expires: NOW + 0.5 * DAY });
  assert.deepEqual(expiring([a, b, c], {}, NOW, 2).map((x) => x.p.id), [3, 1]);
});

test('findProducts matches aliases and the definite article', () => {
  const ps = [P({ id: 1, name: 'גבינה צהובה', aliases: '["צהובה"]' }), P({ id: 2, name: 'חלב 3%' })];
  assert.deepEqual(findProducts(ps, 'הצהובה').map((p) => p.id), [1]);
  assert.deepEqual(findProducts(ps, 'גבינה').map((p) => p.id), [1]);
});

test('digest: expiry facts on any day; on the 1st the month (off-list, thrown away) and the freezer', () => {
  assert.deepEqual(digestMessages({ expiring: [], day: 5, offListLastMonth: null }), []);
  const one = digestMessages({ expiring: [{ name: 'שמנת', days: 1 }], day: 5 });
  assert.equal(one[0].body, 'התוקף של השמנת עומד לפוג מחר.');
  const a = digestMessages({ expiring: [{ name: 'שמנת', days: 1 }, { name: 'חלב 3%', days: 2 }, { name: 'אקמול', days: 25, date: '22.10' }], day: 5 });
  assert.equal(a[0].body, 'התוקף של השמנת עומד לפוג מחר, של החלב 3% בעוד יומיים ושל האקמול ב-22.10.'); // r0t d91
  const b = digestMessages({ expiring: [], day: 1, offListLastMonth: 3, wasted: ["קוטג'", 'עגבניות'], month: 'ספטמבר' });
  assert.equal(b[0].body, "בספטמבר קניתם 3 מוצרים מחוץ לרשימה ונזרקו 2: קוטג' ועגבניות.");
  assert.equal(digestMessages({ expiring: [], day: 1, offListLastMonth: 0, month: 'ספטמבר' })[0].body, 'בספטמבר כל מה שקניתם היה ברשימה ולא נזרק כלום.');
  const f = digestMessages({ expiring: [], day: 1, offListLastMonth: 1, freezer: [{ name: 'עוף', months: 4 }, { name: 'קציצות', months: 2 }] });
  // one notification on the 1st (the owner 02/10, question 28): the freezer joins the month's summary
  assert.equal(f.length, 1);
  assert.equal(f[0].title, 'סיכום החודש');
  assert.ok(f[0].body.endsWith(' הכי הרבה זמן במקפיא: עוף (4 חודשים) וקציצות (חודשיים). האם הגיע הזמן לבשל אותם?'), f[0].body);
  const g = digestMessages({ expiring: [], day: 1, offListLastMonth: null, freezer: [{ name: 'עוף', months: 4 }] });
  assert.deepEqual(g.map((m) => m.title), ['מה במקפיא'], 'no summary: the freezer alone');
  assert.ok(!/כדאי|אלופים/.test(JSON.stringify([one, a, b, f])), 'no advice');
});

test('time zone: 20:00 digest and month start stay right across the October DST change', () => {
  assert.equal(local(Date.UTC(2026, 9, 24, 17), 'Asia/Jerusalem').hour, 20); // summer time, UTC+3
  assert.equal(local(Date.UTC(2026, 9, 26, 18), 'Asia/Jerusalem').hour, 20); // winter time, UTC+2
  assert.equal(monthStart(Date.UTC(2026, 9, 30, 12)), Date.UTC(2026, 8, 30, 21)); // Oct 1 00:00 IDT
  assert.equal(monthStart(Date.UTC(2026, 10, 3, 12)), Date.UTC(2026, 9, 31, 22)); // Nov 1 00:00 IST
  assert.equal(monthStart(Date.UTC(2026, 9, 31, 21, 30)), Date.UTC(2026, 9, 31, 22) - 31 * DAY + 3600e3 * 0 - 3600e3); // 23:30 on Oct 31 local is still October
});

test('learn: two purchase→run-out cycles give the pace and the next run-out', () => {
  const t0 = NOW - 30 * DAY;
  const log = [
    { product_id: 1, ts: t0, kind: 'purchase' }, { product_id: 1, ts: t0 + 5 * DAY, kind: 'out' },
    { product_id: 1, ts: t0 + 6 * DAY, kind: 'purchase' }, { product_id: 1, ts: t0 + 6 * DAY + 3600e3, kind: 'purchase' }, // two buys in one trip = one cycle
    { product_id: 1, ts: t0 + 13 * DAY, kind: 'out' },
    { product_id: 1, ts: t0 + 14 * DAY, kind: 'purchase' },
    { product_id: 2, ts: t0, kind: 'purchase' }, { product_id: 2, ts: t0 + 4 * DAY, kind: 'out' }, // one cycle is not enough
  ];
  const L = learn(log);
  assert.equal(L[1].every, 6); // median of 5 and 7
  assert.equal(L[1].next, t0 + 20 * DAY);
  assert.equal(L[2], undefined);
});

test('learn: without purchases on record, three run-outs are enough', () => {
  const L = learn([0, 7, 14].map((d) => ({ product_id: 3, ts: NOW - 20 * DAY + d * DAY, kind: 'out' })));
  assert.equal(L[3].every, 7);
});

test('runningOutSoon: only in-stock products not already on the list, within 2 days', () => {
  const learned = { 1: { every: 6, next: NOW + 1 * DAY }, 2: { every: 6, next: NOW + 1 * DAY }, 3: { every: 6, next: NOW + 5 * DAY }, 4: { every: 6, next: NOW + DAY } };
  const products = [P({ id: 1, name: 'חלב', qty: 1 }), P({ id: 2, name: 'לחם', qty: 0 }), P({ id: 3, name: 'אורז', qty: 1 }), P({ id: 4, name: 'קפה', qty: 1 })];
  const soon = runningOutSoon(products, learned, new Set([4]), NOW);
  assert.deepEqual(soon.map((x) => x.name), ['חלב']);
  assert.equal(soon[0].in, 1);
});

test('growth: 21 levels and their items; points are days from 16/10 (the owner), each level at least as hard as the one before', () => {
  const { LEVELS, ITEMS, catchUp, cleanOutfit } = await_import;
  assert.equal(LEVELS.length, 21); assert.equal(ITEMS.length, 14); assert.equal(LEVELS.at(-1).at, 730);
  assert.deepEqual(LEVELS.map((l) => l.at), [0, 3, 7, 14, 21, 30, 45, 60, 80, 100, 125, 150, 180, 210, 250, 300, 365, 430, 500, 600, 730]);
  assert.ok(LEVELS.slice(1).every((l, i) => l.at > LEVELS[i].at), 'the thresholds go up');
  assert.ok(LEVELS.slice(2).every((l, i) => l.at - LEVELS[i + 1].at >= LEVELS[i + 1].at - LEVELS[i].at), 'each level at least as hard as the one before');
  assert.deepEqual(LEVELS.map((l) => l.name), ['טירון', 'מלצר', 'בריסטה', 'עוזר מטבח', 'טבח', 'קונדיטור', 'מנהל רשימות', 'שומר המקרר', 'מומחה המזווה', 'צייד המבצעים', 'סו-שף', 'שף', 'מנהל המחסן', 'אלוף הקניות', 'קוסם הרשימות', 'ראש המטבח', 'חכם הבית', 'אלוף המקרר', 'כוכב מישלן', 'אגדת המזווה', 'מלך הבית']);
  // every item opens at the same level as before; its days (16/10)
  const BEFORE = { bow: 14, glasses: 45, band: 60, mustache: 80, pencil: 100, chef: 125, tie: 180, shades: 210, earrings: 250, scarf: 300, beard: 365, medal: 430, cap: 600, crown: 730 };
  for (const x of ITEMS) assert.equal(LEVELS[x.level - 1].at, BEFORE[x.id], x.id);
  assert.deepEqual(ITEMS.map((x) => x.level), [4, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 20, 21]);
  assert.equal(growth(0).level, 1); assert.equal(growth(0).next, 'פפיון');
  assert.equal(growth(2).level, 1); assert.equal(growth(3).level, 2); assert.equal(growth(13).level, 3); assert.equal(growth(14).level, 4);
  const g = growth(60); assert.equal(g.level, 8); assert.equal(g.name, 'שומר המקרר'); assert.equal(g.next, 'שפם');
  assert.equal(growth(130).next, 'עניבה', 'level 11, the next item is at 13: no item at 12');
  assert.equal(growth(99999).level, 21); assert.equal(growth(99999).to, null); assert.equal(growth(99999).next, null);
  // outfit: first time = newest per spot; a level-up puts the new thing on and keeps the rest as chosen
  assert.deepEqual(catchUp(null, 8).wear, { neck: 'bow', eyes: 'glasses', head: 'band' });
  const mine = { level: 10, wear: { head: 'band', mouth: 'mustache' } }; // took off the glasses, the bow and the pencil
  const up = catchUp(mine, 13);
  assert.deepEqual(up.wear, { head: 'chef', mouth: 'mustache', neck: 'tie' }); assert.equal(up.changed, true);
  assert.equal(catchUp(up, 13).changed, false, 'same level: nothing new');
  const down = catchUp(up, 12); assert.equal(down.level, 12, 'a lower level is kept (16/10: points are days)'); assert.ok(!Object.values(down.wear).some((id) => ['tie'].includes(id)), 'what no longer opens comes off');
  assert.deepEqual(catchUp({ level: 11, wear: { head: 'band' } }, 12).wear, { head: 'band' }, 'level 12 has no item of its own: nothing is put on');
  // can't wear what isn't unlocked, or put it in the wrong spot
  assert.deepEqual(cleanOutfit({ head: 'crown', neck: 'bow', eyes: 'bow' }, 7), { neck: 'bow' });
});

test('open: milk keeps 4 days once opened; a new carton does not hide the opened one; finishing clears it', () => {
  const t0 = 1_700_000_000_000;
  const milk = { count_type: 'units', qty: 2, shelf_days: 7, open_days: 4, expires: t0 + 7 * DAY };
  let { product: p } = applyOp(milk, { type: 'open' }, t0 + DAY);
  assert.equal(p.expires, t0 + 5 * DAY, 'opened on day 1 → day 5, sooner than day 7');
  assert.equal(p.opened, t0 + DAY);
  ({ product: p } = applyOp(p, { type: 'purchase', amount: 1 }, t0 + 2 * DAY));
  assert.equal(p.expires, t0 + 5 * DAY, 'the opened carton still expires first');
  ({ product: p } = applyOp(p, { type: 'out' }, t0 + 3 * DAY));
  assert.equal(p.opened, null); assert.equal(p.expires, null);
  // no open_days: opening changes nothing about expiry
  const tuna = { count_type: 'units', qty: 3, shelf_days: null };
  assert.equal(applyOp(tuna, { type: 'open' }, t0).product.expires, undefined);
  // inuse still moves a spare to open
  const soap = { count_type: 'inuse', qty: 1, is_open: 0, open_days: 30 };
  const r = applyOp(soap, { type: 'open' }, t0).product;
  assert.equal(r.qty, 0); assert.equal(r.is_open, 1); assert.equal(r.expires, t0 + 30 * DAY);
});

test('set counts: a correction stamps counted', () => {
  const t = 1_700_000_000_000;
  assert.equal(applyOp({ count_type: 'units', qty: 4 }, { type: 'set', qty: 2 }, t).product.counted, t);
  assert.equal(applyOp({ count_type: 'units', qty: 4 }, { type: 'use', amount: 1 }, t).product.counted, undefined);
});

test('learn: a vacation in the middle of a cycle does not teach that milk lasts two weeks', () => {
  const t0 = 1_700_000_000_000;
  const log = [
    { product_id: 1, ts: t0, kind: 'purchase' }, { product_id: 1, ts: t0 + 4 * DAY, kind: 'out' },
    { product_id: 1, ts: t0 + 5 * DAY, kind: 'purchase' }, { product_id: 1, ts: t0 + 21 * DAY, kind: 'out' }, // away days 6-19
    { product_id: 1, ts: t0 + 22 * DAY, kind: 'purchase' }, { product_id: 1, ts: t0 + 26 * DAY, kind: 'out' },
  ];
  const away = [{ start: t0 + 6 * DAY, end: t0 + 19 * DAY }];
  assert.equal(learn(log).at, undefined);
  assert.equal(learn(log)[1].every, 4, 'median of 4, 16, 4 is 4 anyway');
  const two = log.slice(0, 4);
  assert.equal(learn(two)[1].every, 10, 'without vacations: (4 + 16) / 2');
  assert.equal(learn(two, away)[1], undefined, 'with the vacation only one real cycle is left: not enough to guess');
  assert.equal(learn(log, away)[1].every, 4);
  assert.ok(awayNow(away, t0 + 10 * DAY)); assert.equal(awayNow(away, t0 + 20 * DAY), null);
});

test('recount: in stock, untouched for 5+ days, basics first, oldest first, at most 5', () => {
  const now = 1_700_000_000_000;
  const mk = (id, daysAgo, extra = {}) => ({ id, count_type: 'units', qty: 2, updated: now - daysAgo * DAY, ...extra });
  const ps = [mk(1, 30), mk(2, 10, { is_basic: 1 }), mk(3, 2), mk(4, 40, { qty: 0 }), mk(5, 20, { counted: now - DAY }), mk(6, 9), mk(7, 8), mk(8, 7), mk(9, 6)];
  assert.deepEqual(recountPick(ps, now), [2, 1, 6, 7, 8]);
});

test('trip summary lines: from the list, off the list, still on the list', () => {
  assert.deepEqual(tripSummaryLines({ bought: ['חלב', 'ביצים', 'לחם'], offList: ['במבה'], forgot: ['טונה'] }),
    ['מהרשימה: חלב, ביצים ולחם', 'מחוץ לרשימה: במבה', 'נשאר ברשימה: טונה']);
  assert.deepEqual(tripSummaryLines({}), []);
  assert.equal(tripSummaryLines({ bought: ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז'] })[0], 'מהרשימה: א, ב, ג, ד, ה ועוד 2');
});

test('נשאר מעט: counted things can run low, and it is not "out"', async () => {
  const { levelToCount, applyOp, describe, isOut, isMissing, runningLow } = await import('../worker/domain.js');
  const now = Date.now();
  // new, told as a level
  const milk = levelToCount({ name: 'חלב נטול לקטוז', count_type: 'units', unit: 'קרטון', is_basic: 1, target: 1, level: 'little' }, false);
  assert.equal(milk.qty, 1); assert.ok(!isOut(milk)); assert.equal(describe(milk), 'נשאר מעט'); assert.ok(isMissing(milk), 'basic running low goes on the list');
  assert.equal(levelToCount({ count_type: 'units', level: 'none' }, false).qty, 0);
  assert.equal(levelToCount({ count_type: 'units', level: 'plenty', target: 2 }, false).qty, 2);
  // existing, one carton, "almost out"
  let p = applyOp({ count_type: 'units', unit: 'קרטון', qty: 1, is_basic: 1, target: 1 }, { type: 'low' }, now).product;
  assert.ok(runningLow(p) && !isOut(p) && isMissing(p));
  p = applyOp(p, { type: 'purchase', amount: 2 }, now).product;
  assert.ok(!runningLow(p) && p.qty === 3, 'buying clears it');
  // "set level little" on a counted product = low; nothing at all → one left
  p = applyOp({ count_type: 'units', qty: 0 }, { type: 'set', level: 'little' }, now).product;
  assert.equal(p.qty, 1); assert.ok(runningLow(p));
  // amount sent as qty
  assert.equal(applyOp({ count_type: 'pack', qty: 6, pack_size: 12 }, { type: 'use', qty: 2 }, now).product.qty, 4);
});

test('round 18: weekly buys, the weekly pattern, out of season, a return cancels the buy it undoes', async () => {
  const { routinesDue, weeklyPatterns, offSeason, local: loc } = await import('../worker/domain.js');
  const now = Date.UTC(2026, 8, 24, 5, 0); // Thursday 08:00 in Israel
  assert.equal(loc(now, 'Asia/Jerusalem').wd, 4);
  const rs = [{ id: 1, weekday: 5, last_added: null }, { id: 2, weekday: 0, last_added: null }, { id: 3, weekday: 5, last_added: '2026-09-24' }];
  assert.deepEqual(routinesDue(rs, now, 'Asia/Jerusalem').map((r) => r.id), [1]);
  const fri = (w) => Date.UTC(2026, 8, 18 - 7 * w, 8); // Fridays
  assert.deepEqual(weeklyPatterns([7, 8, 9].map(() => 0).map((_, i) => ({ product_id: 5, ts: fri(i) })), [], now, 'Asia/Jerusalem'), [{ product_id: 5, weekday: 5 }]);
  assert.deepEqual(weeklyPatterns([0, 1].map((w) => ({ product_id: 5, ts: fri(w) })), [], now, 'Asia/Jerusalem'), [], 'two weeks is not a pattern');
  assert.deepEqual(weeklyPatterns([0, 1, 2].map((w) => ({ product_id: 5, ts: fri(w) })), [{ product_id: 5 }], now, 'Asia/Jerusalem'), [], 'already weekly');
  assert.equal(offSeason({ lastBuy: now - 61 * DAY }, now), true); assert.equal(offSeason({ lastBuy: now - 30 * DAY }, now), false);
  const log = [[0, 'purchase'], [5, 'out'], [6, 'purchase'], [7, 'return'], [9, 'purchase'], [12, 'out']].map(([d, kind]) => ({ product_id: 1, ts: d * DAY, kind }));
  assert.equal(learn(log)[1].every, 4, 'the returned buy on day 6 is not a cycle start (else 5.5)');
});

test('ChatGPT: reasoning off for the models that need it, and not sent to the ones that don\'t know it', async () => {
  const { reasoningFor } = await import('../worker/llm.js');
  assert.equal(reasoningFor('gpt-5.6-terra'), 'none'); assert.equal(reasoningFor('gpt-5.1'), 'none');
  assert.equal(reasoningFor('gpt-5'), 'minimal'); assert.equal(reasoningFor('gpt-5-mini'), 'minimal');
  assert.equal(reasoningFor('gpt-5-chat-latest'), undefined); assert.equal(reasoningFor('gpt-4.1'), undefined); assert.equal(reasoningFor('gpt-4o'), undefined);
});

test('recipes: "פטה (לא חובה)" is never missing; ✓ only when at home (approved 30/09)', async () => {
  const { recipeStatus, parseIngredients, linkProduct } = await import('../public/recipes.js');
  const feta = { id: 1, name: 'פטה', count_type: 'units', qty: 0 };
  const ings = parseIngredients('6 ביצים\nפטה (לא חובה)').map((i, n) => ({ ...i, id: n, product_id: linkProduct(i.name, [feta])?.id ?? null }));
  assert.equal(ings[1].product_id, 1);
  let s = recipeStatus({ serves: 4 }, ings, [feta], 4);
  assert.equal(s.missing, 1); // the eggs only
  assert.deepEqual([s.items[1].optional, s.items[1].ok, s.items[1].here], [true, true, false]);
  s = recipeStatus({ serves: 4 }, ings, [{ ...feta, qty: 1 }], 4);
  assert.equal(s.items[1].here, true);
});

test('recipes: "פלפל שחור" is not linked to "פלפל חריף" that ran out, so it stays ✓ (01/10)', async () => {
  const { recipeStatus, parseIngredients, linkProduct } = await import('../public/recipes.js');
  const hot = { id: 1, name: 'פלפל חריף', count_type: 'level', level: 'none' }, eggs = { id: 2, name: 'ביצים', count_type: 'units', qty: 6 };
  assert.equal(linkProduct('פלפל שחור', [hot]), null);
  assert.equal(linkProduct('2 פלפלים חריפים'.replace(/^2 /, ''), [hot])?.id, 1);
  const ings = parseIngredients('פלפל שחור').map((i, n) => ({ ...i, id: n, product_id: linkProduct(i.name, [hot])?.id ?? null }));
  assert.equal(recipeStatus({}, ings, [hot]).items[0].ok, true);
});

// r7c (the owner 07/10, question 100): the mascot's label for a screen reader (public/app.js moodLabel), read from the app and run
test('moodLabel: "אשמח לשמוע מה חדש בבית" (17/10; "לא עדכנו אותי כבר 3 ימים" before) only after a first update', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('\nfunction basicsLine('), src.indexOf('\nfunction renderBand(')); // basicsLine, moodShown, moodLabel
  const { byPerson } = await import('../public/hebrew.js');
  const NAMES = { sleepy: 'ישנוני', understanding: 'מבין' };
  const label = (m, distressLast = () => false, online = true, me = { gender: 'm' }) => new Function('S', 'online', 'MOOD_NAMES', 'distressLast', 'byPerson', `${body}; return moodLabel();`)({ brain: true, mood: m, me }, online, NAMES, distressLast, byPerson);
  const sleepy = mood({ products: [], lastUpdate: NOW - 4 * DAY, lastWaste: null, now: NOW });
  assert.equal(label(sleepy), 'שוקי. מצב הרוח שלי: ישנוני. אשמח לשמוע מה חדש בבית'); // 17/10, ש5
  assert.equal(label(mood({ products: [], lastUpdate: null, lastWaste: null, now: NOW })), 'שוקי. מצב הרוח שלי: ישנוני');
  // t1, n1 (the owner r10p): in distress, by who reads it; before no reception (question 2)
  assert.equal(label(sleepy, () => true), 'שוקי. מצב הרוח שלי: מבין. אני כאן איתך.');
  assert.equal(label(sleepy, () => true, false, { gender: 'f' }), 'שוקי. מצב הרוח שלי: מבין. אני כאן איתך.');
  assert.equal(label(sleepy, () => true, false, { gender: 'p' }), 'שוקי. מצב הרוח שלי: מבין. אני כאן איתכם.');
  assert.equal(label(sleepy, () => false, false), 'שוקי. מצב הרוח שלי: ישנוני. אין קליטה');
});

test('definite (stage 9): the article where Hebrew puts it — one word, a construct, a noun and its adjective', async () => {
  const { definite } = await import('../worker/domain.js');
  const want = { 'תירס משומר': 'התירס המשומר', 'יין ורוד': 'היין הורוד', 'סוכר וניל': 'סוכר הוניל', 'פסטה ורודה': 'הפסטה הורודה', 'מיץ תפוז': 'מיץ התפוז', 'שמן אגוז': 'שמן האגוז', 'עוגת תפוז': 'עוגת התפוז', 'שקית מזון': 'שקית המזון', 'שמפו ומרכך': 'השמפו והמרכך', 'מלח ופלפל': 'המלח והפלפל', 'לחם פרוס': 'הלחם הפרוס', 'אורז עגול': 'האורז העגול', 'בצל מטוגן': 'הבצל המטוגן', 'מלח גס': 'המלח הגס', 'חלב עמיד': 'החלב העמיד', 'פלפל שחור גרוס': 'הפלפל השחור הגרוס', 'קפה עלית': 'הקפה עלית', 'שמן זית': 'שמן הזית', 'שמנת חמוצה': 'השמנת החמוצה', 'שעועית ירוקה': 'השעועית הירוקה', 'נייר טואלט': 'נייר הטואלט', 'פסטה פנה': 'הפסטה פנה', 'מים מינרליים': 'המים המינרליים', 'קפה שחור': 'הקפה השחור', 'תה ירוק': 'התה הירוק', 'שוקולד חלב': 'שוקולד החלב', 'שניצל עוף': 'שניצל העוף', 'טונה בשמן': 'הטונה בשמן', 'מזון לחתול': 'המזון לחתול', 'שמפו לשיער': 'השמפו לשיער', 'יוגורט בטעם תות': 'היוגורט בטעם תות', 'קפה של אבי': 'הקפה של אבי', 'קוקה קולה': 'הקוקה קולה', 'קולה זירו': 'הקולה זירו', 'גבינה צהובה עמק': 'הגבינה הצהובה עמק', 'רוטב עגבניות': 'רוטב העגבניות', 'גבינה לבנה 5%': 'הגבינה הלבנה 5%', 'סבון כלים': 'סבון הכלים', 'יוגורט טבעי': 'היוגורט הטבעי', 'לחם אחיד': 'הלחם האחיד', 'לחם מלא': 'הלחם המלא',
    'שוקו': 'השוקו', 'חלב סויה': 'חלב הסויה', 'דגני בוקר': 'דגני הבוקר', 'עוגת שמרים': 'עוגת השמרים', 'שמן זית': 'שמן הזית', 'גבינה בולגרית': 'הגבינה הבולגרית', 'אורז לבן': 'האורז הלבן', 'ביצים אורגניות': 'הביצים האורגניות', 'תפוחי אדמה': 'תפוחי האדמה', 'חלב שקדים': 'חלב השקדים', 'חזה עוף טחון': 'חזה העוף הטחון', 'חלב 3%': 'החלב 3%', 'הלחם': 'הלחם' };
  for (const [k, v] of Object.entries(want)) assert.equal(definite(k), v, k);
});


test('genderOf (stage 9, for the new wordings): "מים" and a construct plural in "-י" are plural; "חזה" masculine', async () => {
  const { genderOf } = await import('../public/hebrew.js');
  for (const [n, g] of [['מים מינרליים', 'p'], ['מים', 'p'], ['תפוחי אדמה', 'p'], ['עלי בייבי', 'p'], ['דגני בוקר', 'p'], ['חזה עוף', 'm'], ['חלב סויה', 'm'], ['גבינה בולגרית', 'f'], ['ביצים', 'p'], ['קפה', 'm'], ['ברוקולי קפוא', 'm'], ['ספגטי מלא', 'm'], ['מי סודה', 'p'], ['מגבוני תינוקות', 'p']]) assert.equal(genderOf(n), g, n);
});

test('U18 (stage 9, מ33): unitsSaid on a line checked in the cart (check), as on a purchase', async () => {
  const { unitsSaid } = await import('../worker/shuki.js');
  const state = { products: [{ id: 1, name: 'ביצים', count_type: 'pack', pack_size: 12, aliases: [] }], list: [{ id: 7, product_id: 1 }] };
  assert.deepEqual(unitsSaid([{ kind: 'check', item_id: 7, amount: 10 }], 'לקחתי 10 ביצים', state), [{ kind: 'check', item_id: 7, amount: 1, units: 10 }]);
  assert.deepEqual(unitsSaid([{ kind: 'check', item_id: 7, amount: 2 }], 'לקחתי 2 חבילות ביצים', state), [{ kind: 'check', item_id: 7, amount: 2 }]);
  // the number said on its own too isn't the price (the reviewer of 18cf749): ten eggs for ten shekels are ten eggs
  const buy = (n) => [{ kind: 'op', product_id: 1, op: { type: 'purchase', amount: n } }];
  assert.deepEqual(unitsSaid(buy(10), 'קניתי 10 ביצים ב-10 שקל', state)[0].op, { type: 'purchase', amount: 1, units: 10 });
  for (const t of ['קניתי ביצים ב 10 ₪', 'קניתי ביצים ב-10 שקל', 'קניתי ביצים ב- 10 שקל', 'קניתי ביצים ב־10 שקל']) assert.deepEqual(unitsSaid(buy(10), t, state)[0].op, { type: 'purchase', amount: 1 }, t);
});

test('מ12 (stage 9): learn skips a period\'s window on its products (settings.pace_skip), only on them', () => {
  const D = 86400e3, now = 200 * D;
  const log = [];
  for (const pid of [1, 2]) for (const [b, o] of [[10, 17], [20, 50], [51, 81], [90, 97]]) log.push({ product_id: pid, kind: 'purchase', ts: b * D }, { product_id: pid, kind: 'out', ts: o * D });
  const plain = learn(log, [], now), skipped = learn(log, [], now, [{ product_id: 1, from: 19 * D, to: 82 * D }]);
  assert.equal(skipped[1]?.every, 7, JSON.stringify(skipped[1])); assert.notEqual(plain[1]?.every, 7, 'the window changed nothing'); assert.equal(skipped[2]?.every, plain[2]?.every);
});


test('מ33 after the reviewer: "32 גלילים וחלב", a six-pack of one product, "ב-2 חבילות" is a count, "ב 10 שקל" a price, "שתיים עשרה"', async () => {
  const { unitsSaid } = await import('../worker/shuki.js');
  const st = { products: [{ id: 1, name: 'ביצים', count_type: 'pack', pack_size: 12, aliases: [] }, { id: 2, name: 'מים', count_type: 'pack', pack_size: 6, aliases: [] }, { id: 5, name: 'נייר טואלט', count_type: 'pack', pack_size: 32, aliases: [] }, { id: 6, name: 'חלב', count_type: 'units', aliases: [] }, { id: 7, name: 'יוגורט', count_type: 'pack', pack_size: 4, aliases: [] }], list: [] };
  const op = (id, amount) => ({ kind: 'op', product_id: id, op: { type: 'purchase', amount } });
  const run = (text, acts) => unitsSaid(acts, text, st).map((a) => a.op);
  assert.deepEqual(run('קניתי 32 גלילים וחלב', [op(5, 32), op(6, 1)])[0], { type: 'purchase', amount: 1, units: 32 });
  assert.deepEqual(run('קניתי 4 יוגורטים ושישיית מים', [op(7, 4), op(2, 1)]), [{ type: 'purchase', amount: 1, units: 4 }, { type: 'purchase', amount: 1 }]);
  assert.deepEqual(run('קניתי שישייה מים וביצים', [op(2, 1), op(1, 1)]), [{ type: 'purchase', amount: 1 }, { type: 'purchase', amount: 1 }]);
  assert.deepEqual(run('קניתי 24 ביצים ב-2 חבילות', [op(1, 2)]), [{ type: 'purchase', amount: 2 }]);
  assert.deepEqual(run('קניתי ביצים ב 10 שקל', [op(1, 10)]), [{ type: 'purchase', amount: 1 }]);
  assert.deepEqual(run('קניתי שתיים עשרה ביצים', [op(1, 12)]), [{ type: 'purchase', amount: 1, units: 12 }]);
});

test('מ14 (stage 9): "קמח מצה", "מצות", what is "לפסח" are not chametz', async () => {
  const { CHAMETZ_WORDS } = await import('../worker/domain.js');
  for (const n of ['קמח מצה', 'מצות', 'עוגה לפסח', 'קמח תפוחי אדמה לפסח']) assert.ok(!CHAMETZ_WORDS.test(n), n);
  for (const n of ['קמח', 'לחם', 'פסטה', 'עוגיות']) assert.ok(CHAMETZ_WORDS.test(n), n);
});


test('מ13 after the reviewer: isAnimal — what says it\'s made of plants isn\'t from an animal; cottage, free-range eggs, ice cream, mayonnaise are', async () => {
  const { isAnimal } = await import('../worker/shuki.js');
  for (const n of ['יוגורט סויה', 'נקניק צמחוני', 'שניצל צמחוני', 'המבורגר טבעוני', 'יוגורט קוקוס', 'תחליף ביצים', 'חלב סויה', 'חלב שקדים', 'גבינה טבעונית', 'שמנת צמחית', 'מרגרינה', 'לחם', 'טחינה']) assert.equal(isAnimal(n), false, n);
  for (const n of ['ביצים', 'דבש', "קוטג'", 'קוטג׳', 'ביצי חופש', 'גלידה', 'מיונז', 'חלב', 'חזה עוף', 'יוגורט', 'חזה עוף ברוטב קוקוס', 'שוקולד חלב עם שקדים']) assert.equal(isAnimal(n), true, n);
});

test('after the reviewer of 18cf749: definite keeps nouns in מ_ו__ out ("ג\'ל המכונה"), "היין הוורוד"; genderOf: singulars in -י', async () => {
  const { definite } = await import('../worker/domain.js');
  assert.equal(definite("ג'ל מכונה"), "ג'ל המכונה"); assert.equal(definite('יין וורוד'), 'היין הוורוד'); assert.equal(definite('קמח מנופה'), 'הקמח המנופה');
  const { genderOf } = await import('../public/hebrew.js');
  for (const n of ['טחיני גולמי', 'פוזילי מלא', 'רביולי גבינה', 'סלרי טרי']) assert.equal(genderOf(n), 'm', n);
  assert.equal(genderOf('מיני פיצות'), 'p'); assert.equal(genderOf('מיני במבה'), 'f'); // as the rest of the name
});

test('I42 (stage 9, מ16, q048): a baby\'s product learns from the last month', () => {
  const D = 86400e3, now = 200 * D, log = [];
  for (const [b, o] of [[140, 147], [148, 155], [156, 163], [164, 171], [175, 177], [180, 182], [185, 187], [190, 192]]) log.push({ product_id: 1, kind: 'purchase', ts: b * D }, { product_id: 1, kind: 'out', ts: o * D });
  assert.equal(learn(log, [], now, [], new Set([1]))[1].every, 2);
  assert.notEqual(learn(log, [], now)[1].every, 2);
});

test('after the reviewer of 87a7259 and c98b8aa: a baby\'s product bought every two weeks learns from 60 days, not 180; kosherKindOf; isAnimal of three words', async () => {
  const D = 86400e3, now = 200 * D, log = [];
  for (const [b, o] of [[20, 45], [46, 71], [72, 97], [98, 123], [130, 140], [144, 154], [158, 168], [172, 182], [186, 196]]) log.push({ product_id: 1, kind: 'purchase', ts: b * D }, { product_id: 1, kind: 'out', ts: o * D });
  assert.equal(learn(log, [], now, [], new Set([1]))[1].every, learn(log, [], now)[1].every);
  assert.equal(learn(log, [], now, [], new Set([1]))[1].every, 10);
  const { kosherKindOf } = await import('../worker/recipes.js');
  for (const [n, c, k] of [['שניצל תירס', 'תחליפי בשר', 'parve'], ['נקניקיות טבעוניות', 'תחליפי בשר', 'parve'], ['שעועית לבנה', 'יבשים', 'parve'], ['עגבנייה צהובה', 'ירקות ופירות', 'parve'],
    ['לבנה', 'מוצרי חלב, גבינות וביצים', 'dairy'], ['גבינה צהובה', 'מוצרי חלב, גבינות וביצים', 'dairy'], ['אבקת מרק בטעם עוף', 'שימורים ורטבים', null], ['רוטב פסטו', 'שימורים ורטבים', null],
    ['ביצים L', 'מוצרי חלב, גבינות וביצים', 'parve'], ['חזה עוף', 'בשר, עוף ודגים', 'meat'], ['חלב סויה', 'מוצרי חלב, גבינות וביצים', 'parve']]) assert.equal(kosherKindOf(n, c), k, n);
  const { isAnimal } = await import('../worker/shuki.js');
  for (const n of ['גבינה צהובה טבעונית', 'חזה עוף צמחי', 'שניצל תירס', 'שניצל מן הצומח']) assert.equal(isAnimal(n), false, n);
});

test('מ23: the month\'s summary ends with the same product bought twice on one day; without, as before', () => {
  const base = { day: 1, offListLastMonth: 0, month: 'מרץ' };
  const body = (doubles) => digestMessages({ ...base, doubles }).find((m) => m.title === 'סיכום החודש').body;
  assert.equal(body([]), 'במרץ כל מה שקניתם היה ברשימה ולא נזרק כלום.');
  assert.equal(body(['גבינה']), 'במרץ כל מה שקניתם היה ברשימה ולא נזרק כלום. קרה פעם אחת שהגבינה נקנתה פעמיים באותו יום.');
  assert.equal(body(['ביצים']), 'במרץ כל מה שקניתם היה ברשימה ולא נזרק כלום. קרה פעם אחת שהביצים נקנו פעמיים באותו יום.');
  assert.equal(body(['חלב 3%', 'לחם', 'ביצים']), 'במרץ כל מה שקניתם היה ברשימה ולא נזרק כלום. קרה 3 פעמים שמוצר נקנה פעמיים באותו יום: חלב 3%, לחם וביצים.');
  assert.match(body(['חלב 3%', 'חלב 3%']), /קרה פעמיים שמוצר נקנה פעמיים באותו יום: חלב 3%\.$/);
});

test('after the reviewer of 4bb0c3a: chicken in soy sauce is meat; a plant cheese or yogurt is parve', async () => {
  const { kosherKindOf } = await import('../worker/recipes.js');
  for (const [n, c, k] of [['עוף ברוטב סויה', 'בשר, עוף ודגים', 'meat'], ['כנפיים ברוטב סויה', null, 'meat'], ['פרגיות במרינדת סויה', 'בשר, עוף ודגים', 'meat'], ['חזה עוף בציפוי צמחי', 'בשר, עוף ודגים', 'meat'],
    ['גבינה צהובה טבעונית', 'מוצרי חלב, גבינות וביצים', 'parve'], ['יוגורט סויה', 'מוצרי חלב, גבינות וביצים', 'parve'], ['שמנת לבישול צמחית', null, 'parve'], ['תחליף חלב', null, 'parve'],
    ['יוגורט קוקוס', null, 'parve'], ['שניצל תירס', null, 'parve'], ['חלב (לא חובה)', null, 'dairy'], ['עוף קוקוס', null, 'meat'], ['עוף שקדים', null, 'meat'], ['עוף צמחי', null, 'parve'], ['הודו טבעוני', null, 'parve'], ['חזה עוף בציפוי צמחי', null, 'meat'], ['עוף ברוטב צמחי', null, 'meat'], ['חזה עוף צמחי', null, 'parve'], ['כבד קצוץ צמחי', null, 'parve'], ['בקר צמחי', null, 'parve'], ['עוף בציפוי פירורים צמחי', null, 'meat']]) assert.equal(kosherKindOf(n, c), k, n);
});

test('r9z (2): kosherKindOf finds an animal anywhere in the name; not clear = not parve; every case of the reviews', async () => {
  const { kosherKindOf } = await import('../worker/recipes.js');
  for (const [n, k] of [['שניצל עוף בציפוי צמחי', 'meat'], ['נקניקיות עוף ברוטב צמחי', 'meat'], ['חזה בקר צמחי', 'meat'], ['כבד בקר צמחי', 'meat'], ['עוף ביתי צמחי', 'meat'],
    ['חזה עוף בציפוי צמחי', 'meat'], ['עוף ברוטב צמחי', 'meat'], ['עוף בציפוי פירורים צמחי', 'meat'], ['עוף ברוטב סויה', 'meat'], ['כנפיים ברוטב סויה', 'meat'], ['עוף קוקוס', 'meat'], ['עוף שקדים', 'meat'],
    ['עוף צמחי', 'parve'], ['הודו טבעוני', 'parve'], ['חזה עוף צמחי', 'parve'], ['כבד קצוץ צמחי', 'parve'], ['בקר צמחי', 'parve'], ['שניצל תירס', 'parve'], ['שניצל מן הצומח', 'parve'],
    ['גבינה צהובה טבעונית', 'parve'], ['יוגורט סויה', 'parve'], ['שמנת לבישול צמחית', 'parve'], ['תחליף חלב', 'parve'], ['יוגורט קוקוס', 'parve'],
    ['אבקת מרק בטעם עוף', null], ['רוטב פסטו', null], ['עוגת שמרים', null], ['שניצל', 'meat'], ['חזה עוף', 'meat'],
    // the review of 80844b4: meat with a plant word anywhere but right after it is meat
    ['שניצל בציפוי צמחי', 'meat'], ['נקניקיות ברוטב צמחי', 'meat'], ['קציצות בשר ברוטב צמחי', 'meat'], ['המבורגר ברוטב טבעוני', 'meat'], ['קבב ברוטב צמחי', 'meat'], ['בשר טחון עם טופו', 'meat'],
    ['עוף עם טופו', 'meat'], ['עוף עם רוטב טבעוני', 'meat'], ['מוקפץ עוף טופו', 'meat'], ['עוף טופו', 'meat'], ['קוביות עוף תחליף שמנת', 'meat'], ['צמחי עוף', 'meat'],
    ['נקניקיות טבעוניות', 'parve'], ['המבורגר סויה', 'parve']]) assert.equal(kosherKindOf(n, null), k, n);
});

test('r9z, question 41: one product in the plural and feminine takes "טובות" / "אותן" / "הן" / "ועומדות" in every wording of stage 9', async () => {
  const { isFemPlural, byGender } = await import('../public/hebrew.js');
  for (const n of ['ביצים', 'ביצים L', 'עגבניות', 'עגבניות שרי', 'פיתות', 'עוגיות', 'לחמניות', 'שקיות אשפה', 'סוללות']) assert.ok(isFemPlural(n), n);
  for (const n of ['ירקות קפואים', 'פירות', 'ביסקוויטים', 'מלפפונים', 'חלב', 'גבינה', 'דגני בוקר']) assert.ok(!isFemPlural(n), n);
  assert.equal(byGender('ביצים', 'טוב', 'טובה', 'טובים', 'טובות'), 'טובות'); assert.equal(byGender('ביצים', 'טוב', 'טובה', 'טובים'), 'טובים'); // no fifth form: as before
  const { BACK_HOME, PESACH_LEFT, RESPONSIBLE_PUSH, SHOPDAY_BODY } = await import('../worker/index.js');
  assert.equal(BACK_HOME(['ביצים']), 'ברוכים השבים! הביצים כנראה כבר לא טובות אחרי החופשה. האם לסמן שזרקתם אותן?');
  assert.equal(BACK_HOME(['חלב']), 'ברוכים השבים! החלב כנראה כבר לא טוב אחרי החופשה. האם לסמן שזרקתם אותו?');
  assert.equal(BACK_HOME(['גבינה']), 'ברוכים השבים! הגבינה כנראה כבר לא טובה אחרי החופשה. האם לסמן שזרקתם אותה?');
  assert.equal(PESACH_LEFT(['מצות']), 'סגור! נשארו מפסח: מצות. מה לעשות איתן?');
  assert.equal(PESACH_LEFT(['קמח מצה']), 'סגור! נשארו מפסח: קמח מצה. מה לעשות איתו?');
  const michal = { name: 'מיכל', gender: 'f' };
  assert.equal(RESPONSIBLE_PUSH(michal, { name: 'ביצים', listed: true }).body, 'מיכל סימנה שהביצים נגמרו. הן כבר ברשימה.');
  assert.equal(RESPONSIBLE_PUSH(michal, { name: 'קפה', listed: true }).body, 'מיכל סימנה שהקפה נגמר. הוא כבר ברשימה.');
  const { idleQuestion, substituteQuestion, soonSentence } = await import('../worker/shuki.js');
  assert.equal(idleQuestion({ name: 'עוגיות' }), 'אגב, נראה שלא היה צריך עוגיות בחודשיים האחרונים. האם להשאיר אותן במוצרים הקבועים?'); // 17/10, ש5
  assert.equal(substituteQuestion({ name: 'פיתות' }, { name: 'לחמניות' }, michal), 'האם הלחמניות מחליפות אצלך פיתות?');
  assert.equal(soonSentence(['עגבניות']), 'ועומדות להיגמר בקרוב: עגבניות. האם להוסיף אותן לרשימה?');
  assert.equal(soonSentence(['טחינה']), 'ועומדת להיגמר בקרוב: טחינה. האם להוסיף אותה לרשימה?');
  // question 39: up to three by name, four and more by the count
  assert.equal(SHOPDAY_BODY(['חלב 3%']), 'ברשימה יש חלב 3%.');
  assert.equal(SHOPDAY_BODY(['חלב 3%', 'לחם']), 'ברשימה יש חלב 3% ולחם.');
  assert.equal(SHOPDAY_BODY(['חלב 3%', 'לחם', 'ביצים']), 'ברשימה יש חלב 3%, לחם וביצים.');
  assert.equal(SHOPDAY_BODY(['a', 'b', 'c', 'd']), 'ברשימה יש 4 מוצרים.');
});

test('r9z (2), the review of cfe36aa: "ועוף" anywhere is meat, a plant word not right after the meat is meat, "צמחוני" keeps dairy', async () => {
  const { kosherKindOf } = await import('../worker/recipes.js');
  for (const n of ['טופו ועוף', 'מוקפץ טופו ובקר', 'פיתה עם טופו ובשר', 'קציצות סויה ובשר', 'המבורגר סויה ובקר', 'שניצל סויה ועוף', 'נקניקיות צמחיות ועוף', 'שווארמה צמחית והודו',
    'שמנת צמחית ובשר', 'סלט טופו ופרגיות', 'גבינה צהובה טבעונית ונקניק', 'שניצל עוף ציפוי צמחי', 'עוף רוטב צמחי', 'כנפיים רוטב טבעוני', 'עוף טריאקי רוטב צמחי',
    'חזה עוף פירורים צמחיים', 'נקניקיות עוף מעטפת טבעונית', 'עוף צמחי טבעוני ממולא בבשר', 'נקניק צמחי ונקניק סלמי', 'קבב טבעוני וקבב רגיל']) assert.equal(kosherKindOf(n, null), 'meat', n);
  for (const n of ['תחליף בשר', 'תחליף בשר טחון', 'הודו מעושן צמחי']) assert.equal(kosherKindOf(n, null), 'parve', n);
  for (const n of ['בורקס גבינה צמחוני', 'פיצה צמחונית עם גבינה']) assert.equal(kosherKindOf(n, null), 'dairy', n);
  for (const n of ['לזניה צמחונית', 'קיש צמחוני']) assert.equal(kosherKindOf(n, null), null, n); // "צמחוני": no meat, maybe dairy: not clear
});

test('r9z, the review of de2fa0d: plural feminine by a closed list (41), not by "-ות"', async () => {
  const { isFemPlural } = await import('../public/hebrew.js');
  for (const n of ['ביצי חופש', 'שוקיים', 'כנפי עוף', 'מיני פיצות', 'ביצים', 'עגבניות שרי']) assert.ok(isFemPlural(n), n);
  for (const n of ['נרות שבת', 'מקלות אוזניים', 'לבבות עוף', 'ירקות קפואים', 'תותים']) assert.ok(!isFemPlural(n), n);
});

test('r9z (2), the review of f15b26a: fish isn\'t meat, cheese anywhere is dairy, "אגוזי הודו" aren\'t meat', async () => {
  const { kosherKindOf } = await import('../worker/recipes.js');
  for (const [n, c, k] of [['פילה סלמון', null, null], ['דג מושט', null, null], ['בייגל סלמון וגבינת שמנת', null, 'dairy'], ['תחליף בשר עם גבינה', null, 'dairy'], ['תחליף בשר ופטה', null, 'dairy'],
    ['המבורגר צמחי עם גבינה', null, 'dairy'], ['שניצל טבעוני וגבינה צהובה', null, 'dairy'], ['עוף צמחי וגבינה', null, 'dairy'], ['שניצל ממולא גבינה', 'תחליפי בשר', 'dairy'],
    ['פסטה ברוטב שמנת צמחית ופרמזן', null, 'dairy'], ['קפה חלב סויה ושמנת', null, 'dairy'], ['פיצה טבעונית וגבינה', null, 'dairy'], ['טורטיה צמחית בגבינה', null, 'dairy'], ['פסטה ושמנת', null, 'dairy'],
    ['אגוזי הודו', 'יבשים', null], ['תה הודו', null, null], ['שמנת צמחית', null, 'parve'], ['חלב סויה', null, 'parve'], ['גבינה טבעונית', null, 'parve']]) assert.equal(kosherKindOf(n, c), k, n);
});

test('r9z (2), the review of c2f14cb: punctuation, the geresh, more dairy and meat words, infant formula', async () => {
  const { kosherKindOf } = await import('../worker/recipes.js');
  for (const [n, k] of [['קוטג׳', 'dairy'], ["קוטג' 5%", 'dairy'], ['פסטה, גבינה.', 'dairy'], ['חלומי', 'dairy'], ['קשקבל', 'dairy'], ['לאבנה', 'dairy'], ['קרם פרש', 'dairy'], ['שוקו', 'dairy'], ['קפיר', 'dairy'], ['רוטב בשמל', 'dairy'],
    ['נקניקייה', 'meat'], ['קבנוס', 'meat'], ['פיצה פפרוני', 'meat'], ['בייקון', 'meat'], ['חזה אווז', 'meat'], ['שניצלונים', 'meat'], ['כרעיים', 'meat'], ['פיתה עם בשר.', 'meat'],
    ['תחליף חלב אם', null], ['תחליף חלב לתינוקות', null], ['תחליף חלב', 'parve'], ['גבינה ולבנה', 'dairy']]) assert.equal(kosherKindOf(n, null), k, n);
});

test('44א (the owner 12/10): the plural feminine in "רעיון למנה איתן?", "הוספתי אותן", "האם צריך מהן"', async () => {
  const { readFileSync } = await import('node:fs');
  assert.ok(readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8').includes("רעיון למנה ${byGender(soon.p.name, 'איתו', 'איתה', 'איתם', 'איתן')}?"));
  const ob = readFileSync(new URL('../worker/onboarding.js', import.meta.url), 'utf8');
  for (const t of ["byGender(missing[0], 'אותו', 'אותה', 'אותם', 'אותן')", "byGender(b[0], 'ממנו', 'ממנה', 'מהם', 'מהן')", "'כשייגמרו, הם ייכנסו', 'כשייגמרו, הן ייכנסו')"]) assert.ok(ob.includes(t), t);
  assert.ok(readFileSync(new URL('../worker/shuki.js', import.meta.url), 'utf8').includes("byGender(unsaid[0].name, 'אותו', 'אותה', 'אותם', 'אותן')")); // the review of 45abe9a
  assert.ok(readFileSync(new URL('../worker/shuki.js', import.meta.url), 'utf8').includes("byGender(p0.name, 'הוא', 'היא', 'הם', 'הן')")); // "הן כבר ברשימה" (the review of d937c3e)
  const { byGender } = await import('../public/hebrew.js');
  assert.equal(byGender('ביצים', 'אותו', 'אותה', 'אותם', 'אותן'), 'אותן'); assert.equal(byGender('קמח', 'אותו', 'אותה', 'אותם', 'אותן'), 'אותו');
});

test('44ב (the owner 12/10): parve by the category only in vegetables and fruit, and spices and oils', async () => {
  const { kosherKindOf } = await import('../worker/recipes.js');
  for (const [n, c, k] of [['נוטלה', 'יבשים', null], ['שוקולד', 'יבשים', null], ['שוקולד', 'חטיפים ומתוקים', null], ['רוטב בולונז', 'שימורים ורטבים', null],
    ['עגבנייה', 'ירקות ופירות', 'parve'], ['שמן זית', 'תבלינים ושמנים', 'parve'], ['רוטב בשמל', 'שימורים ורטבים', 'dairy'], ['חלב סויה', 'יבשים', 'parve']]) assert.equal(kosherKindOf(n, c), k, `${n} ${c}`);
});

test('46 (the owner 12/10): a closed list of basic dry goods is parve, only as the word itself or with an adjective that changes nothing', async () => {
  const { kosherKindOf } = await import('../worker/recipes.js');
  for (const [n, k] of [['קמח מלא', 'parve'], ['אורז בסמטי', 'parve'], ['סוכר חום', 'parve'], ['קמח', 'parve'], ['מלח', 'parve'], ['שיבולת שועל', 'parve'], ['עדשים כתומות', 'parve'], ['פסטה', 'parve'],
    ['עוגיות חמאה', 'dairy'], ['קרקר גבינה', 'dairy'], ['נוטלה', null], ['אורז עם עוף', 'meat'], ['פסטה ברוטב שמנת', 'dairy'], ['קמח תופח', 'parve'], ['אורז מוקפץ עם ירקות', null], ['פסטה פסטו', null], ['מלח ים', 'parve'], ['אורז דגנים מלאים', 'parve'], ['קמח 1 ק"ג', null], ['פסטה אסם', null], ['סוכר וניל', null]]) assert.equal(kosherKindOf(n, 'יבשים'), k, n); // a size or a brand: no mark (the review of 913a774)
});

test('r9z, question 42: the plural feminine in the older wordings too; 43: the roommates sentences', async () => {
  const { noticedText } = await import('../worker/instincts.js');
  const p = { id: 7, name: 'ביצים', store: 'super', is_basic: 0 };
  assert.match(noticedText({ kind: 'regular', product_id: 7, data: '{"v":null}' }, { users: [], products: [p] }), /האם להפוך אותן למוצר קבוע\?$/); // 17/10, ש5
  assert.match(noticedText({ kind: 'store', product_id: 7, data: '{"v":"pharm"}' }, { users: [], products: [p] }), /אני מכניס אותן/);
  const { readFileSync } = await import('node:fs');
  const app = readFileSync('public/app.js', 'utf8'), shuki = readFileSync('worker/shuki.js', 'utf8');
  for (const t of ["'איתם', 'איתן')", "'אותם', 'אותן')"]) assert.ok(app.includes(t), t);
  assert.ok(shuki.includes("'אותן למוצרים קבועים, שייכנסו לרשימה לבד כשייגמרו'"));
  assert.ok(app.includes('<p>דירת שותפים: מה חסר והצעות אוכל לכל אחד רק מהמשותף ומשלו.</p>') && app.includes("'דירת שותפים: מה חסר והצעות אוכל לכל אחד רק מהמשותף ומשלו'"));
});

test('48 (the owner 12/10): the general question only for "אני בדיאטה" alone; with "בלי X", never', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../worker/shuki.js', import.meta.url), 'utf8');
  assert.ok(src.includes('רק כשאמרו "אני בדיאטה" לבד, אחרי "לכמה זמן?": שאלה אחת, "האם לשנות משהו במוצרים הקבועים בתקופה הזו?". כשאמרו "בלי X", לא שואלים אותה אף פעם: רק את השאלה על X.'));
  assert.ok(!src.includes('"אני בדיאטה" בלי פרטים, אחרי'));
});

test('49 (the owner 13/10): the hosting by its own day, not "עד" (the day after it); an older list from its midnight; no date: "עד"', async () => {
  const { localToTs } = await import('../worker/domain.js');
  const { hostDay } = await import('../worker/shuki.js');
  const u = localToTs('2026-10-09', '00:00') + 2 * 86400e3; // as ensureHosting keeps a hosting on Friday 09/10
  assert.equal(hostDay({ until: u, date: '2026-10-09' }), 'לאירוח ביום שישי 2026-10-09');
  assert.equal(hostDay({ until: u }), 'לאירוח ביום שישי 2026-10-09');
  assert.equal(hostDay({ until: localToTs('2026-10-13', '15:00') }), 'עד 2026-10-13');
});

test('52 (the owner 14/10): "האם צריך מהן יותר מאחת בבית?" by the product, and the Ramadan question\'s order', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../worker/onboarding.js', import.meta.url), 'utf8');
  assert.ok(src.includes("יותר ${byGender(b[0], 'מאחד', 'מאחת', 'מאחד', 'מאחת')} בבית?"));
  // t53 (stage 10, the owner r10p n2): the button by the product's gender too, the first time and when going on after a pause
  // 17/10 (ש4): an open question with only a "no" gets "לא" / "כן, אכתוב לך" (the product's gender stays in the question)
  assert.ok(src.includes("case 'targets': return { reply: targetsQuestion(s), face: 'happy', options: targetsOptions(s) }"));
  assert.ok(src.includes('const targetsOptions = () => OPEN_OPTIONS;'));
  const { ONE_ENOUGH, ONE_ENOUGH_F } = await import('../worker/onboarding.js');
  assert.equal(ONE_ENOUGH, 'לא, אחד מספיק'); assert.equal(ONE_ENOUGH_F, 'לא, אחת מספיקה');
  const { byGender } = await import('../public/hebrew.js');
  const q = (n) => `האם צריך ${byGender(n, 'ממנו', 'ממנה', 'מהם', 'מהן')} יותר ${byGender(n, 'מאחד', 'מאחת', 'מאחד', 'מאחת')} בבית?`;
  assert.equal(q('ביצים'), 'האם צריך מהן יותר מאחת בבית?');
  assert.equal(q('קמח'), 'האם צריך ממנו יותר מאחד בבית?');
  const btn = (n) => byGender(n, ONE_ENOUGH, ONE_ENOUGH_F, ONE_ENOUGH, ONE_ENOUGH_F);
  assert.equal(btn('ביצים'), 'לא, אחת מספיקה'); assert.equal(btn('גבינה'), 'לא, אחת מספיקה');
  assert.equal(btn('קמח'), 'לא, אחד מספיק'); assert.equal(btn('תפוחים'), 'לא, אחד מספיק');
  const { RAMADAN_ASK } = await import('../worker/shuki.js');
  assert.equal(RAMADAN_ASK, 'האם יש מוצרים שצריך מהם יותר ברמדאן?');
});

test('d9 (stage 13): localToTs in a zone more than 12 hours from UTC (Tonga +13, Kiritimati +14, Baker Island -12): the same day, not one off', async () => {
  const { localToTs } = await import('../worker/domain.js');
  assert.equal(localToTs('2026-10-15', '04:00', 'Etc/GMT-13'), Date.UTC(2026, 9, 14, 15));
  assert.equal(localToTs('2026-10-15', '04:00', 'Etc/GMT-14'), Date.UTC(2026, 9, 14, 14));
  assert.equal(localToTs('2026-10-15', '04:00', 'Pacific/Tongatapu'), Date.UTC(2026, 9, 14, 15));
  assert.equal(localToTs('2026-10-15', '04:00', 'Etc/GMT+12'), Date.UTC(2026, 9, 15, 16));
  assert.equal(localToTs('2026-10-15', '04:00', 'Asia/Kolkata'), Date.UTC(2026, 9, 14, 22, 30));
  assert.equal(localToTs('2026-10-15', '04:00', 'America/New_York'), Date.UTC(2026, 9, 15, 8));
  assert.equal(localToTs('2026-10-15', '04:00', 'Asia/Jerusalem'), Date.UTC(2026, 9, 15, 1));
  assert.equal(localToTs('2026-10-15', '23:30', 'Etc/GMT-14'), Date.UTC(2026, 9, 15, 9, 30));
});

test('d9 after the review: localToTs on a night the clock changes, and a date that does not exist', async () => {
  const { localToTs } = await import('../worker/domain.js');
  const { israelAt } = await import('./israel-time.js');
  for (const [d, t] of [['2026-10-24', '23:00'], ['2026-10-25', '00:30'], ['2026-03-27', '00:00'], ['2026-03-27', '01:30'], ['2026-03-26', '23:30'], ['2026-10-25', '04:00']]) assert.equal(localToTs(d, t, 'Asia/Jerusalem'), israelAt(d, t), `${d} ${t}`);
  assert.equal(localToTs('2026-11-01', '00:30', 'America/New_York'), Date.UTC(2026, 10, 1, 4, 30)); // EDT, before the change
  assert.equal(localToTs('2026-03-08', '01:30', 'America/New_York'), Date.UTC(2026, 2, 8, 6, 30)); // EST, before the change
  assert.equal(localToTs('2026-02-30', '09:00'), null);
  assert.equal(localToTs('2026-13-01', '09:00'), null);
});
