-- Shopping mode: someone says "I'm going shopping"; the other gets a push and their additions reach the shopper live.
CREATE TABLE shopping (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  store TEXT NOT NULL DEFAULT 'super',
  started INTEGER NOT NULL,
  ended INTEGER
);
CREATE INDEX shopping_open ON shopping (ended, started);

-- One row per product per out/purchase, so Shuki can learn how fast things run out.
-- event_id ties it to the journal, so undo removes it too.
CREATE TABLE product_log (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('out', 'purchase'))
);
CREATE INDEX product_log_p ON product_log (product_id, ts);

-- One live list line per product, even when two phones report the same thing at the same moment.
CREATE UNIQUE INDEX list_one_per_product ON list_items (product_id) WHERE product_id IS NOT NULL AND status != 'done';
