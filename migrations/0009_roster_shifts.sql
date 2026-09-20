-- =============================================================================
-- Workforce planning, phase B2: the roster itself.
--
-- ONE table holds the plan. The station view and the person view are two
-- queries over it, never two documents. The September 2026 Arbeitsplan kept
-- both by hand and they drifted: Sunday 13.09 had APRIL and EDMOND's four
-- shifts exactly swapped between the pages, and a buffet cleaning duty was
-- assigned to someone not rostered that lunch. Neither is expressible here.
--
-- Background: docs/ASIAWAY_PHASE2_WORKFORCE_PLAN.md
-- =============================================================================

-- ---------- the recurring skeleton -------------------------------------------
-- A month is generated from these and then adjusted, so nobody retypes a
-- fortnightly pattern thirty times.
CREATE TABLE shift_templates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id       uuid NOT NULL REFERENCES stations(id),
  /** ISO-8601: 1 = Monday .. 7 = Sunday, matching how the roster is read. */
  weekday          smallint NOT NULL,
  starts_at        time NOT NULL,
  ends_at          time NOT NULL,
  headcount        smallint NOT NULL DEFAULT 1,
  role_label       text,
  break_minutes    smallint NOT NULL DEFAULT 0,
  -- Overrides the station's default for this band alone: the food pass is
  -- self-serve at lunch and staffed at dinner, and the September plan could
  -- only say that in prose.
  staffing_policy  station_staffing_policy,
  effective_from   date NOT NULL,
  effective_to     date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shift_templates_weekday   CHECK (weekday BETWEEN 1 AND 7),
  CONSTRAINT shift_templates_window    CHECK (ends_at > starts_at),
  CONSTRAINT shift_templates_headcount CHECK (headcount > 0),
  CONSTRAINT shift_templates_period    CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX shift_templates_lookup_idx ON shift_templates (weekday, station_id);

-- ---------- the plan ----------------------------------------------------------
CREATE TYPE shift_state AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');

CREATE TABLE shifts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id              uuid NOT NULL REFERENCES roster_periods(id) ON DELETE CASCADE,
  on_date                date NOT NULL,
  station_id             uuid NOT NULL REFERENCES stations(id),
  /** NULL is an OPEN shift: published, needed, nobody on it yet. */
  user_id                uuid REFERENCES users(id),

  -- timestamptz, not time. An end time is mandatory, which is the whole point:
  -- the literal "END" of the old plan is not a value this column can hold. And
  -- a Saturday that finishes after midnight is an ordinary Saturday.
  starts_at              timestamptz NOT NULL,
  ends_at                timestamptz NOT NULL,

  planned_break_minutes  smallint NOT NULL DEFAULT 0,
  /** "Foodrunner", "Drinks", "Lager" — what the old plan wrote into the cell. */
  role_label             text,
  state                  shift_state NOT NULL DEFAULT 'DRAFT',
  revision               integer NOT NULL DEFAULT 1,
  /** Set when the assignee confirms they have seen it. */
  acknowledged_at        timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT shifts_window CHECK (ends_at > starts_at),
  CONSTRAINT shifts_break  CHECK (planned_break_minutes >= 0),
  -- Only a real person can acknowledge, and only something published.
  CONSTRAINT shifts_acknowledgement CHECK (
    acknowledged_at IS NULL OR (user_id IS NOT NULL AND state = 'PUBLISHED')
  )
);

CREATE INDEX shifts_period_idx  ON shifts (period_id, on_date);
CREATE INDEX shifts_station_idx ON shifts (on_date, station_id);
CREATE INDEX shifts_person_idx  ON shifts (user_id, starts_at) WHERE user_id IS NOT NULL;
-- The station view and the person view, both served from here.
CREATE INDEX shifts_open_idx    ON shifts (period_id, on_date) WHERE user_id IS NULL;

-- ---------- the rules ----------------------------------------------------------
-- Thresholds live in the database, not in code, so that correcting one is a
-- configuration change rather than a deployment.
--
-- PROVISIONAL. The values below are placeholders pending an authoritative
-- reading of the ArG and the L-GAV Gastgewerbe (open question 4 of the plan).
-- They are deliberately not presented as legal advice anywhere in the UI.
--
-- Versioning by validity, so a past month can be re-checked against the limits
-- in force then, waits until those real numbers land; adding valid_from here is
-- a smaller change than guessing the history now.
CREATE TYPE rule_severity AS ENUM ('BLOCK', 'WARN', 'INFO');

CREATE TABLE roster_rules (
  code        text PRIMARY KEY,
  severity    rule_severity NOT NULL,
  is_enabled  boolean NOT NULL DEFAULT true,
  /** Shape differs per rule; the validator reads its own key. */
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  note        text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO roster_rules (code, severity, config, note) VALUES
  ('R2_MIN_REST',        'BLOCK', '{"minutes": 660}',
   'Rest between the end of one shift and the start of the next. PROVISIONAL.'),
  ('R3_MAX_DAILY_SPAN',  'BLOCK', '{"minutes": 840}',
   'First clock-in to last clock-out on one day, breaks included. PROVISIONAL.'),
  ('R4_MAX_CONSECUTIVE', 'BLOCK', '{"days": 6}',
   'Consecutive working days before a rest day. YEN worked six in Sept 2026.'),
  ('R5_BREAKS',          'BLOCK',
   '{"tiers": [{"afterMinutes": 330, "breakMinutes": 15}, {"afterMinutes": 420, "breakMinutes": 30}, {"afterMinutes": 540, "breakMinutes": 60}]}',
   'Break owed by shift length. PROVISIONAL, pending the L-GAV reading.'),
  ('R6_NO_OVERLAP',      'BLOCK', '{}',
   'One person cannot stand at two stations at once.'),
  ('R7_UNDERSTAFFED',    'WARN',  '{}',
   'A STAFFED station below its headcount. SELF_SERVE and CLOSED are answers.'),
  ('R8A_ON_CALL_OUTSIDE','BLOCK', '{}',
   'An Aushilfe assigned outside the availability they offered.'),
  ('R8B_AGAINST_PREF',   'WARN',  '{}',
   'A contracted employee assigned against a stated preference.'),
  ('R8C_ON_ABSENCE',     'BLOCK', '{}',
   'Anyone assigned during an approved absence. PATRICIA''s blank week in Sept 2026 could not say whether it was leave.'),
  ('R9_CORRIDOR',        'WARN',  '{}',
   'Monthly hours outside the pensum corridor. Planning only, never pay.'),
  ('R10_SPLIT_FAIRNESS', 'WARN',  '{"maxPerWeek": 3}',
   'Split shifts concentrated on one person. EDMOND had four of five in Sept.'),
  ('R11_UNACKNOWLEDGED', 'INFO',  '{}',
   'Published but not yet confirmed as seen by the assignee.');
