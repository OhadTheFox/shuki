-- what Shuki learned in this house: rules the people approved (from a 👎, or "remember that..."). They go into every chat.
CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  added INTEGER NOT NULL,
  added_by INTEGER,
  edited INTEGER
);
-- 👍 as well as 👎
ALTER TABLE feedback ADD COLUMN kind TEXT NOT NULL DEFAULT 'down';
