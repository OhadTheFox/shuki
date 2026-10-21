-- Round 21: recipes with structured ingredients, a photo, a child's suggestion, a warning for the house.
-- One row per ingredient: quantity, unit, name, and the product at home it is (NULL = not in the inventory).
CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL,
  pos INTEGER NOT NULL DEFAULT 0,
  qty REAL,
  unit TEXT,
  name TEXT NOT NULL,
  product_id INTEGER,
  line TEXT
);
CREATE INDEX IF NOT EXISTS recipe_ingredients_recipe ON recipe_ingredients (recipe_id, pos);
-- 1 = the ingredients above exist; old recipes (0) are converted from the free-text line the first time they load
ALTER TABLE recipes ADD COLUMN parsed INTEGER NOT NULL DEFAULT 0;
-- 1 = a photo in recipe_photos
ALTER TABLE recipes ADD COLUMN photo INTEGER;
-- 'suggested' = a child's recipe waiting for a grown-up; NULL = saved
ALTER TABLE recipes ADD COLUMN status TEXT;
ALTER TABLE recipes ADD COLUMN suggested_by INTEGER;
-- what doesn't fit the house notes ("יש בו בוטנים"), written when it's saved
ALTER TABLE recipes ADD COLUMN warn TEXT;
-- and what to swap it for ("אפשר להחליף את הבוטנים בשקדים")
ALTER TABLE recipes ADD COLUMN swap TEXT;
CREATE TABLE IF NOT EXISTS recipe_photos (
  recipe_id INTEGER PRIMARY KEY,
  data TEXT NOT NULL
);
-- the Siri key's name in the list of phones (round 20 text)
UPDATE devices SET name = 'סירי (קיצורי דרך)' WHERE kind = 'shortcut' AND name = 'קיצורי דרך';
