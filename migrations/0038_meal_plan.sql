-- home20 (section 16, docs/home19-proposals.md; the owner 18/10: "אחלה"): the weekly plan. A dish on a day of the house (its local
-- date, as daily_q), a saved recipe or a dish without one ("דגים"). What went onto the shopping list only because of a dish is
-- kept in meal_plan_items, so it can come off when the dish is cancelled or cooked. The house's, like cooked_log: nothing private.
CREATE TABLE IF NOT EXISTS meal_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,              -- YYYY-MM-DD, the house's local date
  pos INTEGER NOT NULL DEFAULT 0, -- the order within the day (two dishes on Friday)
  recipe_id INTEGER,              -- a saved recipe, or NULL
  text TEXT,                      -- a dish without a recipe, when recipe_id is NULL
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','cooked','skipped')),
  cooked_log_id INTEGER,          -- its row in cooked_log once it was made
  added_by INTEGER,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS meal_plan_day ON meal_plan (day);
CREATE TABLE IF NOT EXISTS meal_plan_items (
  plan_id INTEGER NOT NULL,
  list_item_id INTEGER NOT NULL,
  qty REAL,                       -- how much of the line is for this dish (a counted product), or NULL
  PRIMARY KEY (plan_id, list_item_id)
);
