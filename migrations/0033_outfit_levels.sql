-- Stage 10, t13 (decision 13, the owner 03/10): 21 levels instead of 15, each item at the points it opened at before. The saved
-- outfit (outfit:<user>, { level, wear }) holds the level in the old numbers; it becomes the new level of the same points,
-- so catchUp() doesn't put on, by force, what "opened" between the two numbers. A restore keeps today's outfits (restoreDay).
UPDATE settings SET value = json_set(value, '$.level', CASE json_extract(value, '$.level')
  WHEN 2 THEN 4 WHEN 3 THEN 7 WHEN 4 THEN 8 WHEN 5 THEN 9 WHEN 6 THEN 10 WHEN 7 THEN 11 WHEN 8 THEN 13
  WHEN 9 THEN 14 WHEN 10 THEN 15 WHEN 11 THEN 16 WHEN 12 THEN 17 WHEN 13 THEN 18 WHEN 14 THEN 20 WHEN 15 THEN 21
  ELSE json_extract(value, '$.level') END)
WHERE key LIKE 'outfit:%' AND json_valid(value) AND json_extract(value, '$.level') IS NOT NULL;
