// r0t (docs/stage0-trace-decisions.md): what can be checked without a server.
// Run: node --test test/r0t.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { introBubbles, ask, nameGender, habitQuestion } from '../worker/onboarding.js';
import { recountPick, DAY, isFreezer, routinesDue, learn, sameTimeNextDay } from '../worker/domain.js';
import { everyText } from '../public/hebrew.js';
import { taughtAway } from '../worker/shuki.js';
import { factProblem, factsText } from '../worker/facts.js';
import { placeText } from '../worker/instincts.js';

test('k1: "מי אני" word for word as decision 179, without "היי!", commas only in bubble 3', () => {
  assert.deepEqual(introBubbles().map((b) => b.reply), [
    'אני שוקי, הרובוט החמוד שעוזר לכם לנהל את המצרכים בבית ולבשל איתם דברים טעימים.',
    'אפשר לדבר איתי חופשי: לספר לי מה יש בבית, מה עומד להיגמר, מה חסר ומה תרצו לקנות. אני אעזור לכם לנהל את המלאי בכיף ואפילו אכין לכם רשימה לסופר.',
    'אני גם אזכיר לכם כשהתוקף של מוצר, או של אוכל שהכנתם, עומד לפוג ואעזור לכם להחליט מה לבשל לפי ספר המתכונים שלכם.',
    'אני שמח ללמוד את הבית שלכם ואני אוהב שמטפלים בי. האם נתחיל? ספרו לי קצת עליכם: מי מנהל את האפליקציה ומי עוד גר בבית?',
  ]);
});

test('d46: the weekly check keeps a place for what nobody touched in more than two months, the oldest first', () => {
  const now = 1_800_000_000_000;
  const p = (id, daysAgo, basic = 0) => ({ id, qty: 1, count_type: 'units', is_basic: basic, target: basic ? 1 : null, updated: now - daysAgo * DAY, created: 0 });
  const basics = [1, 2, 3, 4, 5, 6].map((id) => p(id, 10, 1));
  const picked = recountPick([...basics, p(20, 70), p(21, 200)], now);
  assert.equal(picked.length, 5);
  assert.ok(picked.includes(21), `nothing untouched for months: ${picked}`);
  assert.ok(!picked.includes(20), 'one place, the oldest');
  assert.deepEqual(recountPick([p(30, 90)], now), [30], 'alone');
  assert.deepEqual(recountPick(basics.slice(0, 3), now).sort(), [1, 2, 3], 'nothing old: as before');
});

test('d83: "מה במקפיא" counts every place with "מקפיא" in its name', () => {
  assert.deepEqual(['מקפיא', 'המקפיא', 'מקפיא במרפסת', 'מקפיא קטן', 'מקרר', 'מזווה'].map(isFreezer), [true, true, true, true, false, false]);
});

test('d127: a rule about one person\'s milk stops "which milk?" only for them; a rule for the whole house, for everyone', () => {
  const users = [{ id: 1, name: 'אבי' }, { id: 2, name: 'מיכל' }];
  const amb = { word: 'חלב', names: ['חלב 3%', 'חלב סויה'] };
  const st = (me, lessons) => ({ me: users[me - 1], users, lessons: lessons.map((text, i) => ({ id: i + 1, text })) });
  const avis = ['כשאבי אומר חלב הוא מתכוון לחלב סויה'];
  assert.equal(taughtAway(amb, st(1, avis)), null, 'Avi\'s own rule');
  assert.deepEqual(taughtAway(amb, st(2, avis)), amb, 'Avi\'s rule stopped the question for Michal');
  assert.equal(taughtAway(amb, st(2, ['אצלנו חלב זה חלב 3%'])), null, 'a rule for the whole house');
});

test('d101: "כל N ימים" in the approved words, and due a day before the time comes, from the last purchase', () => {
  assert.deepEqual([1, 2, 10, 30, 60, 90, 180, 365, 45].map(everyText), ['כל יום', 'כל 2 ימים', 'כל 10 ימים', 'כל חודש', 'כל חודשיים', 'כל 3 חודשים', 'כל 6 חודשים', 'כל שנה', 'כל 45 ימים']);
  const now = Date.parse('2030-06-15T09:00:00Z');
  const r = { id: 1, product_id: 7, weekday: -1, every: 90, added: now - 200 * DAY, last_added: null };
  assert.equal(routinesDue([r], now, 'Asia/Jerusalem', { 7: now - 88 * DAY }).length, 0, 'too early');
  assert.equal(routinesDue([r], now, 'Asia/Jerusalem', { 7: now - 89 * DAY }).length, 1, 'a day before');
  assert.equal(routinesDue([{ ...r, last_added: '2030-06-15' }], now, 'Asia/Jerusalem', { 7: now - 89 * DAY }).length, 0, 'once a day');
});

test('d152: "who needs a phone?" in the approved words, for one and for several', () => {
  const q = (phones) => ask({ step: 'phones', phones }, { users: [], locations: [] }, { name: 'אבי', gender: 'm' });
  assert.deepEqual(q([{ name: 'איתי', gender: 'm' }]), { reply: 'האם איתי צריך קוד לטלפון?', face: 'happy', options: ['כן', 'לא צריך'] });
  assert.equal(q([{ name: 'אורית', gender: 'f' }]).reply, 'האם אורית צריכה קוד לטלפון?');
  assert.deepEqual(q([{ name: 'מיכל', gender: 'f' }, { name: 'טל', gender: 'f' }]), { reply: 'למי מהם צריך קוד לטלפון?', face: 'happy', options: ['מיכל', 'טל', 'לכולם', 'לאף אחד'] });
});

test('d153: the admin is asked how to talk to them only when the name fits both; no model, or a failed call: asked', async () => {
  const env = { ANTHROPIC_API_KEY: 'k' };
  const say = (g) => ({ think: async () => ({ out: { gender: g }, usage: {} }), record: async () => {} });
  assert.equal(await nameGender(env, 'מיכל', say('f')), 'f');
  assert.equal(await nameGender(env, 'אבי', say('m')), 'm');
  assert.equal(await nameGender(env, 'נועם', say('both')), 'both');
  assert.equal(await nameGender({}, 'מיכל', say('f')), 'both', 'no key: ask, as before');
  assert.equal(await nameGender(env, 'מיכל', { think: async () => { throw new Error('down'); } }), 'both');
});

test('d181: every habit in the answer, in one question', () => {
  assert.equal(habitQuestion(['אבי שותה קפה בבוקר']), 'האם תרצה שאזכור שאבי שותה קפה בבוקר?');
  assert.equal(habitQuestion(['אבי שותה קפה בבוקר', 'מיכל לא אוכלת גלוטן']), 'האם תרצה שאזכור שאבי שותה קפה בבוקר ושמיכל לא אוכלת גלוטן?');
  assert.equal(habitQuestion(['א', 'ב', 'ג']), 'האם תרצה שאזכור שא, שב ושג?');
  assert.equal(ask({ step: 'habit', habits: ['אבי שותה קפה', 'יואב אוהב פסטה'] }, {}, {}).reply, 'האם תרצה שאזכור שאבי שותה קפה ושיואב אוהב פסטה?');
});

test('r9-7: the first meeting\'s last questions open with "האם"', () => {
  assert.equal(ask({ step: 'more' }, {}, { gender: 'm' }).reply, 'והאם יש עוד משהו שתרצה להגיד לי? למשל אלרגיה, כשרות או משהו שכדאי שאדע.');
  assert.equal(ask({ step: 'more' }, {}, { gender: 'f' }).reply, 'והאם יש עוד משהו שתרצי להגיד לי? למשל אלרגיה, כשרות או משהו שכדאי שאדע.');
});

test('r10-9: the pace from the last two months; with fewer than 3 purchases in them, from all 180 days', () => {
  const now = Date.parse('2030-06-15T09:00:00Z');
  const log = [];
  for (let d = 180; d > 60; d -= 20) log.push({ product_id: 1, ts: now - d * DAY, kind: 'purchase' }, { product_id: 1, ts: now - (d - 19) * DAY, kind: 'out' });
  const old = [...log];
  for (const d of [30, 20, 10]) log.push({ product_id: 1, ts: now - d * DAY, kind: 'purchase' }, { product_id: 1, ts: now - (d - 5) * DAY, kind: 'out' });
  assert.equal(learn(log, [], now)[1].every, 5, 'the last two months');
  assert.equal(learn(old, [], now)[1].every, 19, 'nothing recent: as before');
});

test('r10-14: no substitute for cleaning or toiletries; for food, as before', () => {
  const state = { users: [{ id: 1, name: 'אבי', active: 1 }], categories: [{ id: 2, name: 'מוצרי חלב, גבינות וביצים' }, { id: 11, name: 'ניקיון וכביסה' }, { id: 12, name: 'טואלטיקה והיגיינה' }],
    products: [{ id: 1, name: 'חלב', category_id: 2 }, { id: 2, name: 'חלב שקדים', category_id: 2 }, { id: 3, name: 'סבון כלים', category_id: 11 }, { id: 4, name: 'שמפו', category_id: 12 }] };
  const me = state.users[0];
  assert.equal(factProblem({ key: 'substitute', value: 'חלב → חלב שקדים', text: 'אבי שותה חלב שקדים כשאין חלב' }, state, me), '');
  assert.match(factProblem({ key: 'substitute', value: 'סבון כלים → ג\'ל', text: 'x' }, state, me), /אין תחליף במוצרי ניקיון וטואלטיקה \(סבון כלים\)/);
  assert.match(factProblem({ key: 'substitute', value: 'שמפו → סבון', text: 'x' }, state, me), /אין תחליף/);
});

test('d122, text 12 (approved 03/10): the place of a category, in the owner\'s words', () => {
  assert.equal(placeText('מוצרי חלב, גבינות וביצים', 'מקרר במרפסת'), 'אתם שמים מוצרי חלב במקרר במרפסת, אז אני כותב מעכשיו מוצרי חלב חדשים למקרר במרפסת.');
  assert.equal(placeText('תרופות ועזרה ראשונה', 'ארון אמבטיה'), 'אתם שמים תרופות בארון אמבטיה, אז אני כותב מעכשיו תרופות חדשות לארון אמבטיה.');
  assert.equal(placeText('חיות מחמד', 'מחסן'), 'אתם שמים מוצרי חיות מחמד במחסן, אז אני כותב מעכשיו מוצרי חיות מחמד חדשים למחסן.');
  assert.equal(placeText('תינוק', 'ארון אמבטיה'), 'אתם שמים מוצרי תינוק בארון אמבטיה, אז אני כותב מעכשיו מוצרי תינוק חדשים לארון אמבטיה.'); // stage 8, question 44
  assert.equal(placeText('תחזוקת בית', 'מחסן'), 'אתם שמים מוצרי תחזוקה במחסן, אז אני כותב מעכשיו מוצרי תחזוקה חדשים למחסן.');
  // a category the house added, and a place with ה: no "בהמחסן"
  assert.equal(placeText('ציוד קמפינג', 'המחסן הקטן'), 'אתם שמים ציוד קמפינג במחסן הקטן, אז אני כותב מעכשיו מוצרים חדשים מהסוג הזה למחסן הקטן.');
  assert.equal(placeText('אחר', 'מזווה'), '', '"אחר": no sentence');
});

test('r9-12 (r0t trim): "צמחוני" doesn\'t eat fish until they say otherwise: the server says it in the line', () => {
  const users = [{ id: 1, name: 'אבי', gender: 'm', active: 1 }, { id: 2, name: 'מיכל', gender: 'f', active: 1 }];
  const f = (about_id, value) => ({ about: 'person', about_id, key: 'diet', value, confirmed_by: about_id, private: 0 });
  const t = factsText([f(1, 'צמחוני'), f(2, 'צמחונית')], users, users[0]);
  assert.match(t.cached, /אבי: diet: צמחוני \(לא אוכל דגים\)/); assert.match(t.cached, /מיכל: diet: צמחונית \(לא אוכלת דגים\)/);
  assert.match(t.writer, /diet: צמחוני \(לא אוכל דגים\)/);
  assert.doesNotMatch(factsText([f(2, 'צמחונית, אוכלת דגים'), f(1, 'טבעוני')], users, users[0]).cached, /לא אוכל/, 'said otherwise, or vegan');
});

test('r10-4 (r0t trim): the writer\'s own substitute is marked "(התחליף שלך)", not anyone else\'s', () => {
  const users = [{ id: 1, name: 'אבי', gender: 'm', active: 1 }, { id: 2, name: 'מיכל', gender: 'f', active: 1 }];
  const sub = { about: 'person', about_id: 2, key: 'substitute', value: JSON.stringify({ from: { id: 7, name: 'חלב 3%' }, to: { id: 9, name: 'חלב שקדים' } }), confirmed_by: 2, private: 0 };
  assert.match(factsText([sub], users, users[1]).writer, /substitute: חלב 3% → חלב שקדים \(התחליף שלך\)/);
  assert.doesNotMatch(factsText([sub], users, users[0]).cached, /התחליף שלך/, 'to Avi it\'s Michal\'s');
});

test('r0t-7: a daily reminder keeps its local hour across the clock change (Israel, 25.10.2026)', () => {
  const at = Date.parse('2026-10-24T16:00:00Z'); // 19:00 in Israel, summer time
  assert.equal(sameTimeNextDay(at, 'Asia/Jerusalem'), Date.parse('2026-10-25T17:00:00Z'), '19:00 again, winter time (25 hours later)');
  assert.equal(sameTimeNextDay(Date.parse('2026-10-05T16:00:00Z'), 'Asia/Jerusalem'), Date.parse('2026-10-06T16:00:00Z'), 'an ordinary day');
});
