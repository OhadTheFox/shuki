-- ordered online ("ordered, on the way"): stays on the list, greyed, until it arrives
ALTER TABLE list_items ADD COLUMN ordered INTEGER;
-- bought every week on the same day ("challah every Friday"): on the list by itself the day before
CREATE TABLE IF NOT EXISTS routines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER,
  text TEXT,
  weekday INTEGER NOT NULL,          -- the day it's bought: 0 = Sunday ... 6 = Saturday
  store TEXT,
  added_by INTEGER,
  added INTEGER NOT NULL,
  last_added TEXT                    -- local date it last went on the list
);
-- a return to the store is logged too, so the buy it undoes doesn't teach the pace (nothing references this table)
CREATE TABLE product_log_new (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('out', 'purchase', 'return'))
);
INSERT INTO product_log_new (id, event_id, ts, product_id, kind) SELECT id, event_id, ts, product_id, kind FROM product_log;
DROP TABLE product_log;
ALTER TABLE product_log_new RENAME TO product_log;
CREATE INDEX product_log_p ON product_log (product_id, ts);
-- a second place with more of it ("6 more on the balcony"): "out" then isn't out
ALTER TABLE products ADD COLUMN reserve_location_id INTEGER;
ALTER TABLE products ADD COLUMN reserve_qty REAL;
-- leftovers (cooked food, not products): Shuki asks after three days whether they're still there
CREATE TABLE IF NOT EXISTS leftovers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  made INTEGER NOT NULL,             -- when it was cooked (from "yesterday's"), else when it was said
  added_by INTEGER,
  asked INTEGER,                     -- last time Shuki asked "still in the fridge?"
  gone INTEGER
);
-- pets: a fixed category of its own
INSERT INTO categories (name, sort) SELECT 'חיות מחמד', 16 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'חיות מחמד');
-- what kind of dish a saved recipe is ("Asian, gyoza wrappers"), so "something Asian" finds it
ALTER TABLE recipes ADD COLUMN tags TEXT;
-- the month's cost in millionths of a dollar, priced per provider (Claude or ChatGPT) when the call was made
ALTER TABLE usage ADD COLUMN micro INTEGER NOT NULL DEFAULT 0;
