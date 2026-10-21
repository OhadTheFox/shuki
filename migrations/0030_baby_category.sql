-- Stage 8, ו6 (docs/stage8-plan.md, question 12 as recommended): a "תינוק" category, like "חיות מחמד"; products made from now
-- on go into it, nothing is moved
INSERT INTO categories (name, sort) SELECT 'תינוק', 17 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'תינוק');
