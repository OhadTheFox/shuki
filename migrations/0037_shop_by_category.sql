-- home18 (5, the owner 17/10): a tab of the list is a shopping trip. Existing products:
-- (1) a category by the name, for what has none or "אחר" (cleaning, medicines, care; produce by its first word), as
--     categoryByName in worker/domain.js does for new ones;
-- (2) until the house answers where it buys produce and care (worker/shops.js), the default: the supermarket, with the other store
--     as store2, so nothing is hidden; medicines at the pharmacy.
-- Neither touches a product that was made or edited in the app's form (any such event: there is no other way to tell a store
-- that was chosen there).
UPDATE products SET category_id = (SELECT id FROM categories WHERE name = 'ניקיון וכביסה')
WHERE deleted IS NULL AND id NOT IN (SELECT product_id FROM events WHERE product_id IS NOT NULL AND type IN ('create', 'edit') AND COALESCE(op_id, '') NOT LIKE 'proposal:%' AND COALESCE(source, '') NOT IN ('onboarding', 'mapping'))
  AND (category_id IS NULL OR category_id = (SELECT id FROM categories WHERE name = 'אחר'))
  AND (name LIKE '%ניקוי%' OR name LIKE '%תרסיס%' OR name LIKE '%אקונומיקה%' OR name LIKE '%סבון כלים%' OR name LIKE '%נוזל כלים%'
    OR name LIKE '%מרכך כביסה%' OR name LIKE '%אבקת כביסה%' OR name LIKE '%ג''ל כביסה%' OR name LIKE '%נוזל כביסה%' OR name LIKE '%מגבוני ניקוי%'
    OR name LIKE '%נוזל רצפות%' OR name LIKE '%דיזטול%' OR name LIKE '%דזיטול%' OR name LIKE '%פיירי%' OR name LIKE '%כלורקס%' OR name = 'סנו' OR name LIKE 'סנו %' OR name LIKE '% סנו');

UPDATE products SET category_id = (SELECT id FROM categories WHERE name = 'תרופות ועזרה ראשונה')
WHERE deleted IS NULL AND id NOT IN (SELECT product_id FROM events WHERE product_id IS NOT NULL AND type IN ('create', 'edit') AND COALESCE(op_id, '') NOT LIKE 'proposal:%' AND COALESCE(source, '') NOT IN ('onboarding', 'mapping'))
  AND (category_id IS NULL OR category_id = (SELECT id FROM categories WHERE name = 'אחר'))
  AND (name LIKE '%אקמול%' OR name LIKE '%נורופן%' OR name LIKE '%אדוויל%' OR name LIKE '%אופטלגין%' OR name LIKE '%דקסמול%' OR name LIKE '%סטרפסילס%'
    OR name LIKE '%פלסטר%' OR name LIKE '%תחבושת%' OR name LIKE '%תרופ%');

UPDATE products SET category_id = (SELECT id FROM categories WHERE name = 'טואלטיקה והיגיינה')
WHERE deleted IS NULL AND id NOT IN (SELECT product_id FROM events WHERE product_id IS NOT NULL AND type IN ('create', 'edit') AND COALESCE(op_id, '') NOT LIKE 'proposal:%' AND COALESCE(source, '') NOT IN ('onboarding', 'mapping'))
  AND (category_id IS NULL OR category_id = (SELECT id FROM categories WHERE name = 'אחר'))
  AND (name LIKE '%שמפו%' OR name LIKE '%מרכך שיער%' OR name LIKE '%משחת שיניים%' OR name LIKE '%מברשת שיניים%' OR name LIKE '%דאודורנט%'
    OR name LIKE '%סבון ידיים%' OR name LIKE '%ג''ל רחצה%' OR name LIKE '%טמפונים%' OR name LIKE '%חוט דנטלי%');

UPDATE products SET category_id = (SELECT id FROM categories WHERE name = 'ירקות ופירות')
WHERE deleted IS NULL AND id NOT IN (SELECT product_id FROM events WHERE product_id IS NOT NULL AND type IN ('create', 'edit') AND COALESCE(op_id, '') NOT LIKE 'proposal:%' AND COALESCE(source, '') NOT IN ('onboarding', 'mapping'))
  AND (category_id IS NULL OR category_id = (SELECT id FROM categories WHERE name = 'אחר'))
  -- the first word, or the second after a number or a word of amount ("2 פלפל חריף", "צרור פטרוזיליה")
  AND (CASE WHEN instr(name, ' ') > 0 AND (substr(name, 1, instr(name, ' ') - 1) GLOB '[0-9]*' OR substr(name, 1, instr(name, ' ') - 1) IN ('צרור', 'מארז', 'שקית', 'ארגז', 'קילו'))
        THEN (CASE WHEN instr(substr(name, instr(name, ' ') + 1), ' ') > 0 THEN substr(substr(name, instr(name, ' ') + 1), 1, instr(substr(name, instr(name, ' ') + 1), ' ') - 1) ELSE substr(name, instr(name, ' ') + 1) END)
        WHEN instr(name, ' ') > 0 THEN substr(name, 1, instr(name, ' ') - 1) ELSE name END) IN ('עגבניה', 'עגבנייה', 'עגבניות', 'מלפפון', 'מלפפונים', 'בצל', 'בצלים',
    'שום', 'תפוח', 'תפוחים', 'תפוחי', 'גזר', 'פלפל', 'פלפלים', 'חסה', 'כרוב', 'קישוא', 'קישואים', 'חציל', 'חצילים', 'ברוקולי', 'כרובית', 'פטרוזיליה', 'כוסברה', 'שמיר',
    'נענע', 'לימון', 'לימונים', 'בננה', 'בננות', 'תפוז', 'תפוזים', 'קלמנטינה', 'קלמנטינות', 'אבוקדו', 'ענבים', 'אבטיח', 'מלון', 'אגס', 'אפרסק', 'שזיף', 'תות', 'תותים',
    'מנגו', 'סלק', 'בטטה', 'בטטות', 'דלעת', 'צנונית', 'פטריות', 'סלרי', 'תרד', 'קולורבי')
  AND name NOT LIKE '%מיובש%' AND name NOT LIKE '%יבש%' AND name NOT LIKE '%כבוש%' AND name NOT LIKE '%שימורי%' AND name NOT LIKE '%אבקת%' AND name NOT LIKE '%רסק%'
  AND name NOT LIKE '%מיץ%' AND name NOT LIKE '%טחון%' AND name NOT LIKE '%מעושן%' AND name NOT LIKE '%שחור%' AND name NOT LIKE '%לבן%' AND name NOT LIKE '%קפוא%';

UPDATE products SET store = 'super', store2 = 'greengrocer'
WHERE deleted IS NULL AND id NOT IN (SELECT product_id FROM events WHERE product_id IS NOT NULL AND type IN ('create', 'edit') AND COALESCE(op_id, '') NOT LIKE 'proposal:%' AND COALESCE(source, '') NOT IN ('onboarding', 'mapping')) AND store = 'super' AND store2 IS NULL
  AND category_id = (SELECT id FROM categories WHERE name = 'ירקות ופירות');
UPDATE products SET store = 'super', store2 = 'pharm'
WHERE deleted IS NULL AND id NOT IN (SELECT product_id FROM events WHERE product_id IS NOT NULL AND type IN ('create', 'edit') AND COALESCE(op_id, '') NOT LIKE 'proposal:%' AND COALESCE(source, '') NOT IN ('onboarding', 'mapping')) AND store = 'super' AND store2 IS NULL
  AND category_id IN (SELECT id FROM categories WHERE name IN ('טואלטיקה והיגיינה', 'ניקיון וכביסה'));
UPDATE products SET store = 'pharm', store2 = NULL
WHERE deleted IS NULL AND id NOT IN (SELECT product_id FROM events WHERE product_id IS NOT NULL AND type IN ('create', 'edit') AND COALESCE(op_id, '') NOT LIKE 'proposal:%' AND COALESCE(source, '') NOT IN ('onboarding', 'mapping')) AND store <> 'pharm'
  AND category_id = (SELECT id FROM categories WHERE name = 'תרופות ועזרה ראשונה');
UPDATE list_items SET store = 'pharm' WHERE status = 'open' AND product_id IN (SELECT id FROM products WHERE store = 'pharm' AND category_id = (SELECT id FROM categories WHERE name = 'תרופות ועזרה ראשונה'));

