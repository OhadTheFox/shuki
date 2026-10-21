-- stage 9, מ27 (decision 2, q064): a guest who keeps coming, kept only after a "כן, תזכור": a name and what they eat, nothing
-- else (not who told, not why). Not "guests" (the sleeping-over kind of away, and /api/state's field of that name)
CREATE TABLE house_guests (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, eats TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL);
