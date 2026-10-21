-- Stage 8, א4 (docs/stage8-plan.md): what a period changed in the products and their pace while it lasts (מ11–מ15 build
-- on it), as JSON: [{ product_id, change: 'basic_off' | 'target', from, to }]. When the period ends it goes with the
-- record that it ended (settings period_done:<id>).
ALTER TABLE facts ADD COLUMN links TEXT;
