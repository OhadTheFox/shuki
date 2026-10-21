// Migration 0013 on a house with data (the rule since round 13): a round-20 database with an old recipe and the Siri
// key, then 0013, then the server loads it — the recipe becomes structured, the key gets its new name.
// Run: node --disable-warning=ExperimentalWarning test/migration21.itest.js
import './fetch-retry.js';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DIR = '/tmp/shuki-test/shuki-mig21'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const db = new DatabaseSync(`${DIR}/shuki.db`);
db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql') && x < '0013').sort()) { db.exec(readFileSync(`migrations/${f}`, 'utf8')); db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f); }
db.exec(readFileSync('test/fixture-house.sql', 'utf8'));
db.exec("INSERT INTO products (id, name, count_type, unit, qty, created, updated) VALUES (501, 'ביצים', 'units', NULL, 5, 1, 1)");
db.exec("INSERT INTO recipes (id, name, ingredients, text, added_by, added, serves, cooked) VALUES (7, 'שקשוקה', '6 ביצים, 3 עגבניות, מלח', 'מבשלים', 1, 1, 4, 2)");
db.exec("INSERT INTO devices (user_id, token_hash, name, kind, created) VALUES (1, 'h1', 'קיצורי דרך', 'shortcut', 1)");
db.exec("INSERT INTO pairing_codes (code, user_id, expires) VALUES ('135135', 1, 9999999999999)");
db.close();
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/node.js'], { env: { ...process.env, PORT: '8771', DB_PATH: `${DIR}/shuki.db` }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
let ok = false;
try {
  for (let i = 0; i < 40; i++) { try { await fetch('http://127.0.0.1:8771/'); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  assert.match(log, /migration 0013_round21\.sql/);
  const tok = (await (await fetch('http://127.0.0.1:8771/api/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: '135135', name: 'x' }) })).json()).token;
  const s = await (await fetch('http://127.0.0.1:8771/api/state', { headers: { authorization: `Bearer ${tok}` } })).json();
  const r = s.recipes.find((x) => x.id === 7);
  assert.deepEqual(r.ings.map((i) => [i.qty, i.name, i.product_id]), [[6, 'ביצים', 501], [3, 'עגבניות', null], [null, 'מלח', null]]);
  assert.equal(r.cooked, 2, 'kept'); assert.equal(r.serves, 4);
  const d = new DatabaseSync(`${DIR}/shuki.db`);
  assert.equal(d.prepare("SELECT name FROM devices WHERE kind = 'shortcut'").get().name, 'סירי (קיצורי דרך)');
  assert.equal(d.prepare('SELECT parsed FROM recipes WHERE id = 7').get().parsed, 1);
  ok = true; console.log('✓ M21 מיגרציה 0013 על בית עם נתונים: מתכון ישן הומר, שמות נשמרו, הקיצור קיבל את השם החדש');
} catch (e) { console.log('✗ M21', e.message, log.slice(-500)); }
srv.kill(); process.exit(ok ? 0 : 1);
