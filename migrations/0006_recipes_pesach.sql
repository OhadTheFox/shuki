-- saved recipes: "what can we cook?" answers from them too
CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  ingredients TEXT,
  text TEXT,
  added_by INTEGER,
  added INTEGER NOT NULL
);
-- the household's own store (a butcher, a deli) for a product. products.store keeps its super/pharm/greengrocer check
-- (D1 can't rebuild a table other tables point at), so a product bought at the butcher has store='super', shop='s...'
ALTER TABLE products ADD COLUMN shop TEXT;
-- Passover mode: which products are chametz (NULL = not classified yet)
ALTER TABLE products ADD COLUMN chametz INTEGER;
-- bought once for guests / a holiday: running out doesn't put it back on the list
ALTER TABLE products ADD COLUMN occasional INTEGER NOT NULL DEFAULT 0;
