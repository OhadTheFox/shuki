-- פ6 (stage 7, question 50): a private fact that wins over a shared one, for its person alone. A row with private = 1 and
-- ended = 1 says "for me, this is over": its key (and value, on a key with many values) as the shared one's.
ALTER TABLE facts ADD COLUMN ended INTEGER;
