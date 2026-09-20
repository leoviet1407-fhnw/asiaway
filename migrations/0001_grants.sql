-- =============================================================================
-- Layer 2 of append-only enforcement: privileges.
--
-- The application connects as asiaway_app, which can INSERT and SELECT history
-- but has no UPDATE or DELETE on it. Even a bug in application code cannot
-- rewrite the audit trail. Migrations run as a separate, more privileged role.
--
-- Applied in production/staging only: PGlite runs single-user, so these grants
-- have nothing to enforce there. Local verification relies on the triggers in
-- 0000_init.sql, which catch the same mistake.
-- =============================================================================

-- Expects the role to exist already, created by the operator with a password
-- from the environment. Documented in docs/DEPLOYMENT.md.
--   CREATE ROLE asiaway_app LOGIN PASSWORD '...';

GRANT USAGE ON SCHEMA public TO asiaway_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  users, menu_categories, menu_items, allergens,
  restaurant_tables, table_groups, table_group_members,
  dining_sessions, customer_devices,
  orders, order_items, order_notes,
  notifications, idempotency_keys
TO asiaway_app;

-- History: insert and read only. No UPDATE. No DELETE. Deliberate.
GRANT SELECT, INSERT ON audit_events, order_revisions TO asiaway_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events, order_revisions FROM asiaway_app;
-- TRUNCATE is revoked explicitly: row-level triggers do not fire on TRUNCATE, so
-- privileges are the only thing standing in its way.

GRANT USAGE, SELECT ON SEQUENCE order_number_seq, session_number_seq, audit_events_id_seq
TO asiaway_app;

-- ---------- workforce planning (0007, 0008) ----------------------------------
-- Ordinary mutable operational data: a roster is edited until it is published,
-- and an employee revises their availability until the deadline. The history
-- that must not be rewritten lives in audit_events, which is already locked
-- down above and is where roster and timesheet changes are recorded.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  employments, stations, roster_periods, availability, absences
TO asiaway_app;

-- The corridor a past month was settled against must stay as it was, so the
-- application may add a new policy but never rewrite or remove an old one.
GRANT SELECT, INSERT ON work_time_policy TO asiaway_app;
REVOKE UPDATE, DELETE, TRUNCATE ON work_time_policy FROM asiaway_app;
