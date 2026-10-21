-- 16/10 (the owner): an ingredient saved as "גדושה סוכר" (from "כף גדושה סוכר") is sugar: the word after the unit tells the
-- unit's size (public/recipes.js UNIT_SIZE). Only what is certain: a kitchen unit, and the name's first word one of these.
-- The name loses that word, and a product of exactly that name is linked if it had none. The line stays as it was.
UPDATE recipe_ingredients
SET name = trim(substr(name, instr(name, ' ') + 1))
WHERE unit IN ('כף', 'כפית', 'כוס') AND instr(name, ' ') > 0
  AND substr(name, 1, instr(name, ' ') - 1) IN ('גדושה', 'גדושות', 'גדוש', 'גדושים', 'שטוחה', 'שטוחות', 'שטוח', 'שטוחים', 'מלאה', 'מלאות', 'עגולה', 'עגולות', 'נדיבה', 'נדיבות');
UPDATE recipe_ingredients
SET product_id = (SELECT p.id FROM products p WHERE p.name = recipe_ingredients.name AND p.deleted IS NULL AND p.private_to IS NULL LIMIT 1)
WHERE product_id IS NULL AND unit IN ('כף', 'כפית', 'כוס') AND ((' ' || line || ' ') LIKE '% גדושה %' OR (' ' || line || ' ') LIKE '% גדושות %' OR (' ' || line || ' ') LIKE '% גדוש %' OR (' ' || line || ' ') LIKE '% גדושים %' OR (' ' || line || ' ') LIKE '% שטוחה %' OR (' ' || line || ' ') LIKE '% שטוחות %' OR (' ' || line || ' ') LIKE '% שטוח %' OR (' ' || line || ' ') LIKE '% שטוחים %' OR (' ' || line || ' ') LIKE '% מלאה %' OR (' ' || line || ' ') LIKE '% מלאות %' OR (' ' || line || ' ') LIKE '% עגולה %' OR (' ' || line || ' ') LIKE '% עגולות %' OR (' ' || line || ' ') LIKE '% נדיבה %' OR (' ' || line || ' ') LIKE '% נדיבות %')
  AND EXISTS (SELECT 1 FROM products p WHERE p.name = recipe_ingredients.name AND p.deleted IS NULL AND p.private_to IS NULL);
