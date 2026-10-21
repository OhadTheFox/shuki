-- the brand the house always buys ("Tnuva"), shown on the list
ALTER TABLE products ADD COLUMN brand TEXT;
-- roommates: whose it is (NULL = everyone's)
ALTER TABLE products ADD COLUMN owner INTEGER;
-- a weight on the list line ("half a kilo of ground beef"): want = 0.5, want_unit = kilograms
ALTER TABLE list_items ADD COLUMN want_unit TEXT;
-- a child asked for it: waiting for a grown-up (0), or approved (1)
ALTER TABLE list_items ADD COLUMN approved INTEGER NOT NULL DEFAULT 1;
-- shopping trips in its store that ended without it (after three, Shuki asks)
ALTER TABLE list_items ADD COLUMN skipped INTEGER NOT NULL DEFAULT 0;
-- 'away' = nobody home (quiet, not learned); 'guests' = more people home (not learned, everything else as usual)
ALTER TABLE away ADD COLUMN kind TEXT NOT NULL DEFAULT 'away';
