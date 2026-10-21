-- Stage 0c: one table for what Shuki knows about the people and the house (docs/stage0-0c-proposal.md).
-- about: 'person' (about_id = users.id) or 'house' (about_id = 0). The keys are a closed list in worker/facts.js,
-- not a CHECK here (a CHECK can't change without rebuilding the table). Times in milliseconds, like the rest.
CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  about TEXT NOT NULL,
  about_id INTEGER NOT NULL DEFAULT 0,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  since INTEGER NOT NULL,
  until INTEGER,                 -- empty = no end; past it, the fact isn't used
  ask_again INTEGER,             -- when to ask again ("check again in…"), not an end
  told_by INTEGER,
  confirmed_by INTEGER,          -- empty = waiting for the person it's about
  private INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'chat',
  chat_id INTEGER,               -- the message it was learned from ("forget what I said" removes both)
  event_id INTEGER,              -- the journal line it wrote, if any (removed with it)
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS facts_about ON facts(about, about_id);
CREATE INDEX IF NOT EXISTS facts_chat ON facts(chat_id);

-- "keeps Shabbat" was a setting per person: it becomes a fact (the settings rows stay, nothing reads them now)
INSERT INTO facts (about, about_id, key, value, since, told_by, confirmed_by, private, source, created, updated)
  SELECT 'person', CAST(substr(s.key, 9) AS INTEGER), 'shabbat', 'כן', CAST(strftime('%s', 'now') AS INTEGER) * 1000,
    CAST(substr(s.key, 9) AS INTEGER), CAST(substr(s.key, 9) AS INTEGER), 0, 'migration',
    CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM settings s JOIN users u ON u.id = CAST(substr(s.key, 9) AS INTEGER)
  WHERE s.key LIKE 'shabbat:%' AND s.value = '1';

-- product columns only for what is filtered by (0c)
ALTER TABLE products ADD COLUMN kosher_kind TEXT;               -- 'meat' | 'dairy' | 'parve'
ALTER TABLE products ADD COLUMN only_brand INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN responsible INTEGER;            -- users.id
