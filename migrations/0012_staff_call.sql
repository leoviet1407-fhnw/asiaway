-- A guest calling a member of staff to their table.
--
-- Numbered 0012, not 0007: a database that once ran the withdrawn workforce
-- migrations already has 0007-0011 in its ledger, and a new file reusing one of
-- those numbers would read as if it belonged with them.
--
-- Adding an enum value is safe to repeat and needs no data change: the call
-- rides on the existing notification queue, exactly as a bill request does.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'STAFF_CALLED';
