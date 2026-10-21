-- Failed pairing attempts, for rate limiting code guessing (6 digits = 1,000,000 codes).
CREATE TABLE pair_attempts (
  id INTEGER PRIMARY KEY,
  ip TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX pair_attempts_ts ON pair_attempts(ts);
