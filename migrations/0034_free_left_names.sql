-- Stage 13, d4 (question 107): someone who joins under the name of someone who left gets a new user id, not theirs.
-- users.name stays UNIQUE (a rebuild of the table can't pass the foreign keys), so whoever left frees the name: it gets
-- an invisible WORD JOINER (U+2060) at its end, one more for each earlier person who left with the same name. It reads the
-- same everywhere. From now on worker/house.js (freeName) does this when someone leaves.
UPDATE users SET name = name || replace(printf('%.*c', 1 + (SELECT COUNT(*) FROM users u2 WHERE u2.id < users.id AND u2.active = 0
  AND (u2.name = users.name OR u2.name LIKE users.name || char(8288) || '%')), 'x'), 'x', char(8288))
WHERE active = 0;
