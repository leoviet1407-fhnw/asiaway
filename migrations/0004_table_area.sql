-- =============================================================================
-- Where a table physically is.
--
-- The terrace is a different walk and closes in bad weather, so grouping the
-- waiter's table grid by area is worth a column rather than being encoded in
-- the table's name. Nullable, because a venue may not make the distinction.
-- =============================================================================
CREATE TYPE table_area AS ENUM ('INSIDE', 'OUTSIDE');

ALTER TABLE restaurant_tables ADD COLUMN area table_area;
