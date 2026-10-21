-- Stage 5, b01 (the owner 02/10, 05/10): whether a grown-up sees a child's chat is each grown-up's own, child_chat:<grown-up>:<child>
-- ('0' off, '1' on; no row: on, so a new grown-up sees). Where the house had turned it off for a child (child_chat:<child>
-- = '0'), it is off for every grown-up there now, and whoever wants turns it on for themselves. The old key goes.
INSERT OR REPLACE INTO settings (key, value)
  SELECT 'child_chat:' || u.id || ':' || substr(s.key, 12), '0'
  FROM settings s JOIN users u ON u.role != 'child' AND u.active = 1
  WHERE s.key LIKE 'child_chat:%' AND instr(substr(s.key, 12), ':') = 0 AND s.value = '0';
DELETE FROM settings WHERE key LIKE 'child_chat:%' AND instr(substr(key, 12), ':') = 0;
