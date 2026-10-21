-- Stage 0b (the owner 04/10): a reminder or a weekly buy can be private, like a product: private_to = users.id of the only one
-- who sees it (one made after a message marked secret, or with a name from the fixed list). Every place that reads
-- maybe or routines checks this column, not the text.
ALTER TABLE maybe ADD COLUMN private_to INTEGER;
ALTER TABLE routines ADD COLUMN private_to INTEGER;

-- What's already there: one about a private product is private to that product's owner; one with a name from the fixed
-- list (the same LIKE patterns as 0018) is private to the grown-up who added it. A child's stays shared (the owner 02/10, 4).
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
UPDATE maybe SET private_to = (SELECT private_to FROM products WHERE id = maybe.product_id)
  WHERE private_to IS NULL AND product_id IN (SELECT id FROM products WHERE private_to IS NOT NULL);
UPDATE maybe SET private_to = added_by
  WHERE private_to IS NULL AND product_id IS NULL AND added_by IN (SELECT id FROM users WHERE role != 'child')
    AND EXISTS (SELECT 1 FROM private_patterns WHERE replace(replace(replace(replace(replace(replace(maybe.text, ' ', ''), '''', ''), '״', ''), '"', ''), '-', ''), '׳', '') LIKE p);
UPDATE routines SET private_to = (SELECT private_to FROM products WHERE id = routines.product_id)
  WHERE private_to IS NULL AND product_id IN (SELECT id FROM products WHERE private_to IS NOT NULL);
UPDATE routines SET private_to = added_by
  WHERE private_to IS NULL AND product_id IS NULL AND added_by IN (SELECT id FROM users WHERE role != 'child')
    AND EXISTS (SELECT 1 FROM private_patterns WHERE replace(replace(replace(replace(replace(replace(routines.text, ' ', ''), '''', ''), '״', ''), '"', ''), '-', ''), '׳', '') LIKE p);
DROP TABLE private_patterns;
