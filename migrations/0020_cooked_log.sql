-- r0t r9-37 (the owner 03/10): a line for every time a recipe was made, with its date, for "what did we make on Friday?".
-- recipes.cooked / last_cooked stay as they are (the favourites first, decision 137).
CREATE TABLE IF NOT EXISTS cooked_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  user_id INTEGER
);
CREATE INDEX IF NOT EXISTS cooked_log_ts ON cooked_log (ts);
