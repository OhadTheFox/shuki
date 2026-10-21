// the owner 05/10 (question 66): a "שמתי לב" that waited in the queue and expired is asked again only when the pattern is seen
// anew: what the morning's scan counts comes back only once its window holds nothing from before (61 days); a turned-down
// one counts again from zero. notice() of worker/instincts.js on SQLite, with a D1-like wrapper.
// Run: node --test test/noticed-expired.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { notice, toAsk } from '../worker/instincts.js';

const d1 = (db) => ({ prepare: (q) => { const st = db.prepare(q); let args = []; const o = { bind: (...a) => { args = a; return o; }, first: async () => st.get(...args) ?? null, all: async () => ({ results: st.all(...args) }), run: async () => st.run(...args) }; return o; } });
const DAY = 86400e3;

test('an expired "שמתי לב" comes back only with new evidence', async () => {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  db.exec("INSERT INTO users (id, name, gender, role, active, created) VALUES (1, 'אבי', 'm', 'admin', 1, 0)");
  db.exec("INSERT INTO products (id, name, count_type, qty, created, updated) VALUES (5, 'חלב', 'units', 1, 0, 0)");
  const D = d1(db), t0 = Date.now();
  db.exec(`INSERT INTO noticed (id, key, kind, product_id, data, count, first, last, status) VALUES (1, 'weekly:5', 'weekly', 5, '{"v":2}', 3, 0, ${t0}, 'expired'), (2, 'rejects:5', 'rejects', 5, '{"v":null}', 0, 0, ${t0}, 'expired')`);
  // the next morning's scan, on the same purchases: not back
  await notice(D, { key: 'weekly:5', kind: 'weekly', productId: 5, value: 2, count: 3, now: t0 + DAY });
  assert.equal(db.prepare("SELECT status FROM noticed WHERE id = 1").get().status, 'expired');
  assert.equal(await toAsk(D, { id: 1 }), null, 'asked again the next day');
  // two months on, the window holds only new purchases: back
  await notice(D, { key: 'weekly:5', kind: 'weekly', productId: 5, value: 2, count: 3, now: t0 + 62 * DAY });
  assert.equal(db.prepare("SELECT status FROM noticed WHERE id = 1").get().status, 'watching');
  // turned down: from zero, one new rejection isn't enough to ask
  await notice(D, { key: 'rejects:5', kind: 'rejects', productId: 5, same: false, now: t0 + DAY });
  const r = db.prepare("SELECT status, count FROM noticed WHERE id = 2").get();
  assert.equal(r.count, 1); assert.equal(r.status, 'watching');
});

test('מ31 (decision 4): an expired pattern comes back after its kind\'s window; "who buys" takes the buyer it has now', async () => {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  db.exec("INSERT INTO users (id, name, gender, role, active, created) VALUES (1, 'אבי', 'm', 'admin', 1, 0), (2, 'מיכל', 'f', 'member', 1, 0)");
  db.exec("INSERT INTO products (id, name, count_type, qty, created, updated) VALUES (5, 'חלב', 'units', 1, 0, 0)");
  const D = d1(db), t0 = Date.now();
  const back = async (id, key, kind, days, extra = {}) => {
    db.exec(`UPDATE noticed SET status = 'expired', last = ${t0} WHERE id = ${id}`);
    await notice(D, { key, kind, value: 2, count: 3, now: t0 + days * DAY, ...extra });
    return db.prepare('SELECT status, user_id FROM noticed WHERE id = ?').get(id);
  };
  db.exec(`INSERT INTO noticed (id, key, kind, product_id, user_id, data, count, first, last, status) VALUES (1, 'weekly:5', 'weekly', 5, NULL, '{"v":2}', 3, 0, ${t0}, 'expired'),
    (2, 'regular:5', 'regular', 5, NULL, '{"v":2}', 3, 0, ${t0}, 'expired'), (3, 'buyer:super', 'buyer', NULL, 1, '{"v":2}', 3, 0, ${t0}, 'expired')`);
  assert.equal((await back(1, 'weekly:5', 'weekly', 21, { productId: 5 })).status, 'expired');
  assert.equal((await back(1, 'weekly:5', 'weekly', 22, { productId: 5 })).status, 'watching');
  assert.equal((await back(2, 'regular:5', 'regular', 59, { productId: 5 })).status, 'expired');
  assert.equal((await back(2, 'regular:5', 'regular', 60, { productId: 5 })).status, 'watching');
  assert.equal((await back(2, 'regular:5', 'regular', 62, { productId: 5 })).status, 'watching');
  const b = await back(3, 'buyer:super', 'buyer', 61, { userId: 2 });
  assert.equal(b.status, 'watching'); assert.equal(b.user_id, 2);
});

test('מ31 after the reviewer: "who buys" already said yes to keeps its person', async () => {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  db.exec("INSERT INTO users (id, name, gender, role, active, created) VALUES (1, 'אבי', 'm', 'admin', 1, 0), (2, 'מיכל', 'f', 'member', 1, 0)");
  db.exec(`INSERT INTO noticed (id, key, kind, user_id, data, count, first, last, status) VALUES (1, 'buyer:super', 'buyer', 1, '{"v":"super"}', 3, 0, ${Date.now()}, 'yes')`);
  await notice(d1(db), { key: 'buyer:super', kind: 'buyer', userId: 2, value: 'super', count: 3 });
  assert.equal(db.prepare('SELECT user_id FROM noticed WHERE id = 1').get().user_id, 1);
});
