-- Stage 0b: a chat for each person (docs/stage0-0b-proposal.md §2, approved 02/10). chat.thread = whose chat (users.id);
-- NULL = a house message from the server (shown to all); a negative number = a connected assistant's own thread.
-- The shared chat becomes threads: only → each `to` (a row per recipient, minus notFor) → for → NULL. No guessing from
-- "the message before". `migrated` marks what was converted, so a copy is never made twice.
ALTER TABLE chat ADD COLUMN thread INTEGER;
ALTER TABLE chat ADD COLUMN migrated INTEGER;
ALTER TABLE lessons ADD COLUMN chat_id INTEGER; -- "forget what I said" removes a rule learned from that message too

UPDATE chat SET thread = user_id, migrated = 1 WHERE migrated IS NULL AND role = 'user';
UPDATE chat SET thread = CAST(json_extract(content, '$.only') AS INTEGER), migrated = 1
  WHERE migrated IS NULL AND json_extract(content, '$.only') IS NOT NULL;
-- `to` with more than one: a copy for each recipient after the first (not the one in notFor)
INSERT INTO chat (ts, user_id, role, content, thread, migrated)
  SELECT c.ts, c.user_id, c.role, c.content, CAST(j.value AS INTEGER), 1
  FROM chat c, json_each(c.content, '$.to') j
  WHERE c.migrated IS NULL AND json_type(c.content, '$.to') = 'array' AND j.key > 0
    AND (json_extract(c.content, '$.notFor') IS NULL OR j.value != json_extract(c.content, '$.notFor'));
UPDATE chat SET thread = CAST(json_extract(content, '$.to[0]') AS INTEGER), migrated = 1
  WHERE migrated IS NULL AND json_type(content, '$.to') = 'array' AND json_array_length(content, '$.to') > 0;
UPDATE chat SET thread = CAST(json_extract(content, '$.for') AS INTEGER), migrated = 1
  WHERE migrated IS NULL AND json_extract(content, '$.for') IS NOT NULL;
UPDATE chat SET migrated = 1 WHERE migrated IS NULL;
-- whoever already left: their chat goes (r11 q015)
DELETE FROM chat WHERE thread IN (SELECT id FROM users WHERE active = 0);
CREATE INDEX IF NOT EXISTS chat_thread ON chat(thread, ts);
