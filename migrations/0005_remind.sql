-- "remind me in a few days": a maybe with its own time, and what kind it is
ALTER TABLE maybe ADD COLUMN due_at INTEGER;
ALTER TABLE maybe ADD COLUMN kind TEXT NOT NULL DEFAULT 'maybe';
-- how many to buy, when someone said ("add 2 milk"); otherwise the usual amount
ALTER TABLE list_items ADD COLUMN want REAL;
