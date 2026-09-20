-- =============================================================================
-- Serving size for drinks.
--
-- The drinks menu prices many items by volume ("50 cl", "1 dl", "30 cl") and
-- some not at all (a Cappuccino has no stated size). Folding that into the name
-- would corrupt the name; a nullable column keeps it as the separate fact it is,
-- and food simply leaves it NULL.
-- =============================================================================
ALTER TABLE menu_items ADD COLUMN volume text;
