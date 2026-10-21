-- Stage 8, ג10 (docs/stage8-plan.md, approved r8p: option ב, a star): a dish the house loves, marked on the recipe
-- (the house's, as the recipes are; question 9)
ALTER TABLE recipes ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
