-- Stage 0b: a private product (the owner 01/10: only who added it sees it, everywhere; docs/stage0-0b-proposal.md §3).
-- private_to = users.id of the only one who sees it. A list line and a journal line carry it too.
ALTER TABLE products ADD COLUMN private_to INTEGER;
ALTER TABLE list_items ADD COLUMN private_to INTEGER;
ALTER TABLE events ADD COLUMN private_to INTEGER;


-- What's already in the house from the fixed list becomes private to whoever added it (the owner 02/10). The names are
-- worker/private.js isPrivateName as LIKE patterns, since D1 has no regular expressions; test/private-static.test.js
-- checks the two agree. Who added a product: the person whose journal line created it; a list line: its added_by.
-- A child's stays shared (the owner 02/10, 4). A product with no line that created it (made before the journal kept that,
-- or by the server) stays shared: docs/stage0-questions.md 27.
CREATE TABLE private_patterns (p TEXT NOT NULL);
INSERT INTO private_patterns (p) VALUES
  ('%קונדומ%'),
  ('%קונדום%'),
  ('%כונדומ%'),
  ('%כונדום%'),
  ('%אמצעימניעה%'),
  ('%גלולותלמניעתהריונ%'),
  ('%גלולותלמניעתהריון%'),
  ('%גלולותלמניעתהיריונ%'),
  ('%גלולותלמניעתהיריון%'),
  ('%גלולותנגדהריונ%'),
  ('%גלולותנגדהריון%'),
  ('%גלולותנגדהיריונ%'),
  ('%גלולותנגדהיריון%'),
  ('%גלולתלמניעתהריונ%'),
  ('%גלולתלמניעתהריון%'),
  ('%גלולתלמניעתהיריונ%'),
  ('%גלולתלמניעתהיריון%'),
  ('%גלולתנגדהריונ%'),
  ('%גלולתנגדהריון%'),
  ('%גלולתנגדהיריונ%'),
  ('%גלולתנגדהיריון%'),
  ('%גלולהלמחרת%'),
  ('%גלולהשלהיוםשאחרי%'),
  ('%חומרסיכה%'),
  ('%חומריסיכה%'),
  ('%גלסיכה%'),
  ('%צעצועמינ%'),
  ('%צעצועמין%'),
  ('%צעצועימינ%'),
  ('%צעצועימין%'),
  ('%ויברטור%'),
  ('%ויאגרה%'),
  ('%ויאגרא%'),
  ('%בדיקתהריונ%'),
  ('%בדיקתהריון%'),
  ('%בדיקתהיריונ%'),
  ('%בדיקתהיריון%'),
  ('%בדיקותהריונ%'),
  ('%בדיקותהריון%'),
  ('%בדיקותהיריונ%'),
  ('%בדיקותהיריון%'),
  ('%טסטהריונ%'),
  ('%טסטהריון%'),
  ('%טסטהיריונ%'),
  ('%טסטהיריון%'),
  ('%בדיקתביוץ%'),
  ('%בדיקתביוצ%'),
  ('%בדיקותביוץ%'),
  ('%בדיקותביוצ%');
UPDATE products SET private_to = (
    SELECT e.user_id FROM events e, json_each(e.before, '$.created.products') j JOIN users u ON u.id = e.user_id
    WHERE json_valid(e.before) AND j.value = products.id AND u.role != 'child' ORDER BY e.ts LIMIT 1)
  WHERE private_to IS NULL AND EXISTS (SELECT 1 FROM private_patterns
    WHERE replace(replace(replace(replace(replace(replace(products.name, ' ', ''), '''', ''), '״', ''), '"', ''), '-', ''), '׳', '') LIKE p);
UPDATE list_items SET private_to = (SELECT private_to FROM products WHERE id = list_items.product_id)
  WHERE private_to IS NULL AND product_id IN (SELECT id FROM products WHERE private_to IS NOT NULL);
UPDATE list_items SET private_to = added_by
  WHERE private_to IS NULL AND product_id IS NULL AND status != 'done' AND added_by IN (SELECT id FROM users WHERE role != 'child')
    AND EXISTS (SELECT 1 FROM private_patterns WHERE replace(replace(replace(replace(replace(replace(list_items.text, ' ', ''), '''', ''), '״', ''), '"', ''), '-', ''), '׳', '') LIKE p);
DROP TABLE private_patterns;
