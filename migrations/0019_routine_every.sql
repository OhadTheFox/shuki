-- r0t d101 (the owner 03/10): a regular buy every N days, from the last purchase ("פילטר לבריטה כל 3 חודשים" = 90).
-- A weekly buy keeps weekday 0-6 and every NULL; an every-N-days one has weekday -1.
ALTER TABLE routines ADD COLUMN every INTEGER;
