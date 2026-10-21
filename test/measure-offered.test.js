// Round 2 of home20 (the owner 19/10): the vegetarian checks of the measurement (s8-d5-healthy, s8-d5-healthy2) catch food that is
// offered, not food said away. Run: node --test test/measure-offered.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offered, S8 } from '../tools/measure/set.mjs';

const FISH = /עוף|בשר|שניצל|טונה|סלמון|(^|\s)דג|דגים|פסטרמה|נקניק/;
test('an offer is caught; a negation is not', () => {
  for (const t of ['יש דג בתנור, רוצה?', 'אפשר סלמון עם ירקות.', 'מה דעתך על שניצל?', 'בלי בשר, אבל אפשר טונה.', 'חומוס, או דג אפוי']) assert.ok(offered(FISH, t), t);
  for (const t of ['אין לי בשבילך דג מוכן, אבל יש חומוס עם ירקות, או קוטג\' עם עגבניות. מה מתאים לך?', 'בלי בשר, כמובן: יש חביתה.', 'לא דגים ולא עוף, אז הנה סלט.', 'יש חומוס עם ירקות.']) assert.ok(!offered(FISH, t), t);
});
test('s8-d5-healthy2 run 2 of h20-safe-s8 (the stop) passes now, and an offer of fish still fails it', async () => {
  const all = S8;
  const x = all.find((m) => m.id === 's8-d5-healthy2'); assert.ok(x, 'no s8-d5-healthy2');
  const c = (reply) => ({ reply, res: {}, options: [], tool: {}, actions: [] });
  assert.deepEqual(await x.check(c('אין לי בשבילך דג מוכן, אבל יש חומוס עם ירקות, או קוטג\' עם עגבניות. מה מתאים לך?')), []);
  assert.equal((await x.check(c('יש דג בתנור, רוצה?'))).length, 1);
});
