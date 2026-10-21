-- c11 (r0t trim, the owner 03/10): kitniyot (rice, corn, legumes) are classified like chametz, once per product. In a house that
-- answered it doesn't eat kitniyot on Passover, the server treats them like chametz in Passover mode.
ALTER TABLE products ADD COLUMN kitniyot INTEGER;
