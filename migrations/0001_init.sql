-- Shuki: shared home inventory. All times are epoch milliseconds.

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  gender TEXT NOT NULL DEFAULT 'm'   -- for Hebrew verbs in the journal
);

CREATE TABLE devices (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT,
  push_sub TEXT,            -- JSON web-push subscription
  push_on INTEGER NOT NULL DEFAULT 1,
  digest_sent TEXT,         -- local date (YYYY-MM-DD) of the last daily digest
  created INTEGER NOT NULL,
  last_seen INTEGER
);

CREATE TABLE pairing_codes (
  code TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires INTEGER NOT NULL,
  used INTEGER
);

CREATE TABLE locations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0
);

-- count_type:
--   units   : qty = number of items                       (tuna, batteries)
--   pack    : qty = number of units, pack_size units/pack (eggs 12, toilet paper 32)
--   level   : level = plenty | little | none              (produce, spices)
--   inuse   : is_open = 0/1, qty = closed spares          (dish soap, rice)
--   batches : qty = sum of rows in `batches`, each with its own expiry (freezer, meds)
CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',     -- JSON array of other names
  category_id INTEGER REFERENCES categories(id),
  location_id INTEGER REFERENCES locations(id),
  count_type TEXT NOT NULL DEFAULT 'units' CHECK (count_type IN ('units','pack','level','inuse','batches')),
  unit TEXT,                               -- display unit: unit, carton, bag...
  pack_size REAL,
  qty REAL NOT NULL DEFAULT 0,
  level TEXT CHECK (level IN ('plenty','little','none')),
  is_open INTEGER NOT NULL DEFAULT 0,
  is_basic INTEGER NOT NULL DEFAULT 0,
  target REAL,                             -- basic products: minimum to keep (units / spares)
  store TEXT NOT NULL DEFAULT 'super' CHECK (store IN ('super','pharm','greengrocer')),
  store2 TEXT CHECK (store2 IN ('super','pharm','greengrocer')),
  shelf_days INTEGER,
  expires INTEGER,                         -- non-batch products: expiry of the latest purchase
  deleted INTEGER,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  updated_by INTEGER REFERENCES users(id)
);
CREATE INDEX products_live ON products(deleted);

CREATE TABLE batches (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL,
  bought INTEGER NOT NULL,
  expires INTEGER
);
CREATE INDEX batches_product ON batches(product_id);

-- Shopping list. Either a product or a one-off text.
-- source: auto (basic below target), reported (someone said it ran out), manual
-- status: open -> checked (bought, in the cart) -> done (shopping finished)
CREATE TABLE list_items (
  id INTEGER PRIMARY KEY,
  product_id INTEGER REFERENCES products(id),
  text TEXT,
  store TEXT NOT NULL DEFAULT 'super',
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','checked','done')),
  added_by INTEGER REFERENCES users(id),
  added INTEGER NOT NULL,
  checked_by INTEGER REFERENCES users(id),
  checked INTEGER,
  bought_qty REAL
);
CREATE INDEX list_status ON list_items(status);

-- Journal of every change. `before` holds the rows to restore on undo.
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  op_id TEXT UNIQUE,                 -- client-generated, makes offline replays idempotent
  ts INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id),
  type TEXT NOT NULL,                -- create, edit, delete, out, low, use, discard, purchase, list_add, list_remove, finish, undo, catalog
  product_id INTEGER,
  summary TEXT,                      -- human line: "Dana marked the milk as out" (in Hebrew)
  off_list INTEGER NOT NULL DEFAULT 0,
  waste INTEGER NOT NULL DEFAULT 0,
  before TEXT,                       -- JSON {products:[...], list_items:[...], batches:[...]} + created ids
  undone INTEGER
);
CREATE INDEX events_ts ON events(ts);
CREATE INDEX events_user ON events(user_id, ts);

CREATE TABLE receipt_aliases (
  alias TEXT PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id)
);

CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created INTEGER NOT NULL,
  actions TEXT NOT NULL,             -- JSON
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE chat (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  user_id INTEGER,
  role TEXT NOT NULL,                -- user | shuki
  content TEXT NOT NULL              -- JSON
);

CREATE TABLE usage (
  month TEXT PRIMARY KEY,            -- YYYY-MM
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES ('digest_hour', '20'), ('catalog_area', '');

INSERT INTO locations (name, sort) VALUES
  ('מקרר', 1), ('מקפיא', 2), ('מזווה', 3), ('ארון מטבח', 4), ('ארון אמבטיה', 5), ('ארון ניקיון', 6), ('מחסן', 7);

INSERT INTO categories (name, sort) VALUES
  ('ירקות ופירות', 1),
  ('מוצרי חלב, גבינות וביצים', 2),
  ('בשר, עוף ודגים', 3),
  ('תחליפי בשר', 4),
  ('לחם ומאפים', 5),
  ('יבשים', 6),
  ('שימורים ורטבים', 7),
  ('תבלינים ושמנים', 8),
  ('חטיפים ומתוקים', 9),
  ('משקאות', 10),
  ('ניקיון וכביסה', 11),
  ('טואלטיקה והיגיינה', 12),
  ('תרופות ועזרה ראשונה', 13),
  ('חד-פעמי ונייר', 14),
  ('תחזוקת בית', 15),
  ('אחר', 99);
