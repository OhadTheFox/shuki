-- a copy of the house every day (the same content as "download a backup"), in parts; the last 7 are kept
CREATE TABLE IF NOT EXISTS backups (
  day TEXT NOT NULL,                 -- YYYY-MM-DD, or 'before:<ts>' just before a restore
  part INTEGER NOT NULL,
  data TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (day, part)
);
-- 👎 on one of Shuki's answers: what was asked, what he said, and what he saw
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  user_id INTEGER,
  chat_id INTEGER,
  question TEXT,
  reply TEXT,
  note TEXT,
  state TEXT
);
