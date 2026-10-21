-- Stage 5, p7 (the owner 02/10, 05/10): a phone whose person was taken out of the house by someone else is told who did it.
-- One row per phone (the hash of its token, as in devices), with the name and gender of who took them out (not an id: the
-- words stay right if that person leaves or is renamed later). Gone after 30 days (runSchedule); not in the backups.
CREATE TABLE removed (
  token_hash TEXT PRIMARY KEY,
  by_name TEXT NOT NULL,
  by_gender TEXT NOT NULL DEFAULT 'm',
  ts INTEGER NOT NULL
);
