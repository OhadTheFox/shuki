// Stage 5, b01 (the owner 05/10): migration 0025 makes "see a child's chat" each grown-up's own. A house that had it off for a
// child has it off for every grown-up there; the old key goes; a grown-up who joins later sees. Run: node --test test/child-chat-migration.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

test('migration 0025: child_chat:<child> = 0 becomes child_chat:<grown-up>:<child> = 0 for each active grown-up', () => {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql') && x < '0025').sort()) db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  db.exec(`INSERT INTO users (id, name, gender, role, active, created) VALUES (1, 'אבי', 'm', 'admin', 1, 0), (2, 'מיכל', 'f', 'member', 1, 0),
    (3, 'יואבי', 'm', 'child', 1, 0), (4, 'אורית', 'f', 'child', 1, 0), (5, 'דנה', 'f', 'member', 0, 0)`);
  db.exec("INSERT INTO settings (key, value) VALUES ('child_chat:3', '0'), ('child_chat:4', '1'), ('notify:1', 'x')");
  db.exec(readFileSync('migrations/0025_child_chat_each.sql', 'utf8'));
  const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'child_chat:%' ORDER BY key").all().map((r) => `${r.key}=${r.value}`);
  assert.deepEqual(rows, ['child_chat:1:3=0', 'child_chat:2:3=0']);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'notify:1'").get().value, 'x');
});
