// Stage 0b, part 3 (docs/stage0-0b-proposal.md §3, "סינון במקום אחד"): every caller of loadAll says whom it reads for.
// The list below is every caller, with its kind. A new caller, or one that changes its reader, fails here until it is
// added on purpose. Only execute() reads everything ({ all: true }): it must see the whole house to change it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { loadAll } from '../worker/store.js';
import { isPrivateName } from '../worker/private.js';

const CALLERS = [
  // [file, the reader as written, why]
  ['worker/house.js', 'SHARED', 'idleRecount: the whole house is asked'],
  ['worker/index.js', 'user', 'buildState: what this person sees'],
  ['worker/index.js', 'user', 'markChametz: the names go back to whoever turned Passover on'],
  ['worker/index.js', 'user', 'Siri at the store: the list read back to this person'],
  ['worker/index.js', 'user', '"I noticed…" answered by this person'],
  ['worker/index.js', 'u', 'before Shabbat: each keeper, their own push'],
  ['worker/index.js', '{ id: uid }', 'the 20:00 push: each phone, its person'],
  ['worker/index.js', 'SHARED', 'the weekly recount: asked of everyone'],
  ['worker/index.js', '{ all: true }', 'Passover off: the regular chametz back on the list, a private one too (on its owner\'s line, by execute; r0t r10-8)'],
  ['worker/plan.js', 'user', 'home20: what the week needs, to know whether a dish\'s list line is still needed: what this person sees'],
  ['worker/store.js', '{ all: true }', 'execute: which actions are private'],
  ['worker/store.js', '{ all: true }', 'execute: the whole house, to change it'],
];

const found = readdirSync('worker').filter((f) => f.endsWith('.js')).flatMap((f) =>
  [...readFileSync(`worker/${f}`, 'utf8').matchAll(/(?<!function )\bloadAll\(\s*[\w.]+\s*(?:,\s*([^)]*?))?\s*\)/g)].map((m) => [`worker/${f}`, (m[1] || '(none)').trim()]));

test('every caller of loadAll is on the list, with the reader it was meant to have', () => {
  const key = (x) => `${x[0]} ← ${x[1]}`;
  assert.deepEqual(found.map(key).sort(), CALLERS.map(key).sort());
});

test('loadAll without a reader throws, and someone else\'s private product is left out', async () => {
  const rows = { products: [{ id: 1, name: 'חלב', private_to: null }, { id: 2, name: 'בדיקת הריון', private_to: 7 }], batches: [{ product_id: 2, qty: 1 }], items: [{ id: 5, product_id: 2, private_to: 7 }, { id: 6, product_id: null, text: 'קונדומים', private_to: 7 }, { id: 8, product_id: 1, private_to: null }] };
  const db = { prepare: (q) => ({ q }), batch: async (qs) => qs.map(({ q }) => ({ results: /FROM products/.test(q) && !/batches/.test(q) ? rows.products : /batches/.test(q) ? rows.batches : /list_items/.test(q) ? rows.items : [] })) };
  await assert.rejects(() => loadAll(db));
  const other = await loadAll(db, { id: 3 });
  assert.deepEqual(other.products.map((p) => p.id), [1]);
  assert.deepEqual(other.items.map((i) => i.id), [8]);
  assert.equal(other.batches.length, 0);
  const mine = await loadAll(db, { id: 7 });
  assert.deepEqual(mine.products.map((p) => p.id), [1, 2]);
  assert.deepEqual(mine.items.map((i) => i.id), [5, 6, 8]);
  assert.equal((await loadAll(db, { all: true })).products.length, 2);
});

test('the fixed list (r11 q050, q051, q055, q056): its forms, and nothing ordinary', () => {
  for (const t of ['קונדומים', 'הקונדום', 'וקונדומים', 'אמצעי מניעה', 'גלולות נגד היריון', 'גלולה למחרת', 'חומר סיכה', 'חומרי סיכה', "ג'ל סיכה", 'צעצוע מין', 'ויברטור', 'ויאגרה', 'בדיקת הריון', 'בדיקות היריון', 'טסט הריון', 'בדיקת ביוץ'])
    assert.ok(isPrivateName(t), t);
  for (const t of ['חלב', 'טמפונים', 'תחבושות', 'דאודורנט', 'בדיקת דם', 'גלולות שינה', 'ויטמינים', 'סבון'])
    assert.ok(!isPrivateName(t), t);
});

test('migration 0018: what was already in the house from the fixed list becomes its adder\'s; it agrees with isPrivateName', () => {
  const names = ['קונדומים', 'הקונדום', 'קונדומים דורקס', 'אמצעי מניעה', 'גלולות למניעת היריון', 'גלולה למחרת', 'חומר סיכה', 'חומרי סיכה', "ג'ל סיכה", 'צעצוע מין', 'צעצועי מין', 'ויברטור',
    'ויאגרה', 'בדיקת הריון', 'בדיקות היריון', 'בדיקת-הריון', 'טסט הריון', 'בדיקת ביוץ', 'בדיקות ביוץ',
    'חלב', 'טמפונים', 'תחבושות', 'דאודורנט', 'בדיקת דם', 'גלולות שינה', 'ויטמינים', 'סבון', 'מין טעים של גבינה'];
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql') && x < '0018').sort()) db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  db.exec("INSERT INTO users (id, name, gender, role, active) VALUES (1, 'אבי', 'm', 'admin', 1), (2, 'מיכל', 'f', 'member', 1), (3, 'יואבי', 'm', 'child', 1)");
  const add = db.prepare("INSERT INTO products (id, name, created, updated) VALUES (?, ?, 1, 1)");
  const ev = db.prepare("INSERT INTO events (id, ts, user_id, type, summary, before) VALUES (?, 1, ?, 'create', 'x', ?)");
  names.forEach((n, k) => { add.run(k + 1, n); ev.run(k + 1, 2, JSON.stringify({ created: { products: [k + 1], list_items: [] } })); });
  add.run(100, 'קונדומים של יואבי'); ev.run(100, 3, JSON.stringify({ created: { products: [100] } })); // a child's: stays shared
  add.run(101, 'ויאגרה ישנה'); // no line that created it: stays shared (question 27)
  db.exec("INSERT INTO list_items (id, product_id, text, store, source, status, added_by, added) VALUES (1, 1, NULL, 'super', 'manual', 'open', 2, 1), (2, NULL, 'בדיקת הריון', 'super', 'manual', 'open', 1, 1), (3, NULL, 'חלב', 'super', 'manual', 'open', 1, 1)");
  db.exec(readFileSync('migrations/0018_private.sql', 'utf8'));
  const got = Object.fromEntries(db.prepare('SELECT id, private_to FROM products').all().map((r) => [r.id, r.private_to]));
  names.forEach((n, k) => assert.equal(got[k + 1], isPrivateName(n) ? 2 : null, n));
  assert.equal(got[100], null, 'a child\'s');
  assert.equal(got[101], null, 'with no adder');
  assert.deepEqual(db.prepare('SELECT id, private_to FROM list_items ORDER BY id').all().map((r) => [r.id, r.private_to]), [[1, 2], [2, 1], [3, null]]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'private_patterns'").get().n, 0, 'the helper table was left');
});

test('migration 0024: an existing reminder or weekly buy of a private product, or with a name from the fixed list, becomes private (the owner 04/10)', () => {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql') && x < '0024').sort()) db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  db.exec("INSERT INTO users (id, name, gender, role, active) VALUES (1, 'אבי', 'm', 'admin', 1), (2, 'מיכל', 'f', 'member', 1), (3, 'יואבי', 'm', 'child', 1)");
  db.exec("INSERT INTO products (id, name, created, updated, private_to) VALUES (10, 'ויטמינים', 1, 1, 2), (11, 'חלב', 1, 1, NULL)");
  const m = db.prepare("INSERT INTO maybe (id, text, product_id, store, added_by, added, kind) VALUES (?, ?, ?, 'super', ?, 1, 'remind')");
  m.run(1, 'ויטמינים', 10, 1); m.run(2, 'בדיקת הריון', null, 2); m.run(3, 'בדיקת הריון', null, 3); m.run(4, 'חלב', 11, 2); m.run(5, 'לקחת כדור', null, 2);
  const r = db.prepare("INSERT INTO routines (id, product_id, text, weekday, store, added_by, added) VALUES (?, ?, ?, 1, 'super', ?, 1)");
  r.run(1, 10, null, 1); r.run(2, null, 'טסט הריון', 2); r.run(3, null, 'קונדומים', 3); r.run(4, 11, null, 2);
  db.exec(readFileSync('migrations/0024_private_reminders.sql', 'utf8'));
  // of a private product: its owner; from the fixed list: the grown-up who added it; a child's or anything else: shared
  assert.deepEqual(db.prepare('SELECT id, private_to FROM maybe ORDER BY id').all().map((x) => [x.id, x.private_to]), [[1, 2], [2, 2], [3, null], [4, null], [5, null]]);
  assert.deepEqual(db.prepare('SELECT id, private_to FROM routines ORDER BY id').all().map((x) => [x.id, x.private_to]), [[1, 2], [2, 2], [3, null], [4, null]]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'private_patterns'").get().n, 0, 'the helper table was left');
});
