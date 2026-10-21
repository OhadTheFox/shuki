-- Round 19 (decisions 120-149).
-- What Shuki noticed on his own (decisions 120-124): a pattern he watches, until the house says yes or no.
-- kind: want (someone adds the same amount), buy (the same amount is bought), weekly, rejects, buyer.
CREATE TABLE IF NOT EXISTS noticed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  user_id INTEGER,
  product_id INTEGER,
  data TEXT,
  count INTEGER NOT NULL DEFAULT 1,
  first INTEGER NOT NULL,
  last INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'watching' -- watching, asked, yes, no
);
-- recipes: how many it serves, how often it was made, where it came from (decisions 135, 137, 139)
ALTER TABLE recipes ADD COLUMN serves INTEGER;
ALTER TABLE recipes ADD COLUMN cooked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recipes ADD COLUMN last_cooked INTEGER;
ALTER TABLE recipes ADD COLUMN url TEXT;
-- another assistant (Claude, ChatGPT...) talking to Shuki over MCP for one person (decision 145); only the hash is kept
CREATE TABLE IF NOT EXISTS connectors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT,
  created INTEGER NOT NULL,
  last_used INTEGER
);
