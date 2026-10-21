-- 0004: weekly recount, "let's think about it" list, expiry after opening, vacation, Siri shortcuts, per-trip summary.

-- recount: when someone last confirmed or corrected the amount (a "set" or a "yes, that's right")
ALTER TABLE products ADD COLUMN counted INTEGER;
-- keeps this many days once opened (milk 3, cream 3, juice 5); `opened` = when the current one was opened
ALTER TABLE products ADD COLUMN open_days INTEGER;
ALTER TABLE products ADD COLUMN opened INTEGER;

-- wanted, not needed: waits 48 hours, then Shuki asks if it's still wanted
CREATE TABLE maybe (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  product_id INTEGER REFERENCES products(id),
  store TEXT NOT NULL DEFAULT 'super',
  added_by INTEGER REFERENCES users(id),
  added INTEGER NOT NULL,
  asked INTEGER,          -- when the 48h push went out
  decided INTEGER,
  decision TEXT CHECK (decision IN ('list', 'drop'))
);
CREATE INDEX maybe_open ON maybe (decided, added);

-- away from home: no reminders, and learning skips these days
CREATE TABLE away (
  id INTEGER PRIMARY KEY,
  start INTEGER NOT NULL,
  end INTEGER NOT NULL,
  set_by INTEGER REFERENCES users(id)
);

-- a Siri / Shortcuts key is a device of its own, so it can be replaced without logging the phone out
ALTER TABLE devices ADD COLUMN kind TEXT NOT NULL DEFAULT 'app';

-- what a closed trip came to: bought from the list, off the list, forgotten (JSON)
ALTER TABLE shopping ADD COLUMN summary TEXT;

-- a photo per product (small JPEG, base64), to tell two sauces apart in the store. products.photo = when it was taken
ALTER TABLE products ADD COLUMN photo INTEGER;
CREATE TABLE product_photos (
  product_id INTEGER PRIMARY KEY REFERENCES products(id),
  data TEXT NOT NULL,
  updated INTEGER NOT NULL
);

-- bought a different pack size (30 eggs when it's usually 12): what was really added, so un-checking takes it back
ALTER TABLE list_items ADD COLUMN bought_units REAL;
