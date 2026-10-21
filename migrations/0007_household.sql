-- A household of its own: whoever sets it up (with the one-time setup code) is its admin and adds the others.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member';   -- 'admin' | 'member'
ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1;      -- 0 = left the house (history keeps the name)
ALTER TABLE users ADD COLUMN created INTEGER;
-- a new install starts empty: early installs had two example people (ids 1 and 2); they go unless the house uses them
DELETE FROM users WHERE id IN (1, 2)
  AND NOT EXISTS (SELECT 1 FROM devices d WHERE d.user_id = users.id)
  AND NOT EXISTS (SELECT 1 FROM events e WHERE e.user_id = users.id)
  AND NOT EXISTS (SELECT 1 FROM pairing_codes c WHERE c.user_id = users.id);
-- a house that is already running: its first person is the admin, and it gets a name
UPDATE users SET role = 'admin' WHERE id = (SELECT MIN(id) FROM users);
INSERT OR IGNORE INTO settings (key, value) SELECT 'house_name', 'הבית של ' || group_concat(name, ' ו') FROM users HAVING COUNT(*) > 0;
