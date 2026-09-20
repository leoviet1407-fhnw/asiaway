-- =============================================================================
-- Roles for people who are not waiters.
--
-- MANAGER plans the roster, approves absences and closes the month.
-- STAFF is everyone rostered who does not serve tables — kitchen, cleaning —
-- and who therefore has no waiter tablet.
--
-- This file contains NOTHING ELSE, and that is deliberate.
--
-- A migration file is executed as a single multi-statement unit, which Postgres
-- runs in one implicit transaction. ALTER TYPE ... ADD VALUE is allowed there,
-- but the new value CANNOT BE USED until that transaction commits — and if a
-- later statement in the same file fails on "unsafe use of new value", the
-- rollback takes the ADD VALUE with it and the enum is left unchanged. Keeping
-- the additions alone means the next migration can rely on them.
--
-- Add the next role here in its own file too. Do not append usage to this one.
-- =============================================================================

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'MANAGER';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'STAFF';
